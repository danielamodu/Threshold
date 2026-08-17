/**
 * Cargo Risk Evaluator (§2).
 *
 *   "cumulative exposure score against a per-cargo-class spoilage curve
 *    (pharma / produce / general reefer configs), flags breach + severity."
 *
 * Produces a `CargoRiskAssessment` per §3.
 *
 * ── On "cumulative" ──────────────────────────────────────────────────────────
 * This evaluator is stateful, unlike the compliance one. Exposure accrues
 * across a route, so the score for waypoint 7 depends on waypoints 1–6. Each
 * event contributes degree-hours over the interval SINCE the previous event on
 * that route, which is the only interval we can actually justify from the event
 * stream itself.
 *
 * The first event on a route has no predecessor and therefore no elapsed time.
 * Scoring it as zero would be defensible but useless — a single injected breach
 * event, which is exactly what §6 Phase 2's exit condition calls for, would
 * score 0 and read as nominal. So the first event is charged
 * `initialExposureHours`, defaulting to one hour, and that assumption is
 * explicit rather than hidden.
 */

import { randomUUID } from 'node:crypto';
import type { CargoRiskAssessment, CargoRecommendedAction, ThermalExposureEvent } from '@threshold/types';
import type { RouteContextProvider } from './route-context.js';
import { UnknownRouteError } from './route-context.js';
import {
  degreeHours,
  riskLevelFor,
  SPOILAGE_CURVES,
  type SpoilageCurve,
} from './spoilage.js';

const MS_PER_HOUR = 3_600_000;

export interface CargoEvaluation {
  assessment: CargoRiskAssessment;
  /** Degree-hours this single event contributed. */
  contributed_degree_hours: number;
  /** Hours charged for this event. */
  exposure_hours: number;
  explanation: string;
}

export interface CargoEvaluatorOptions {
  routes: RouteContextProvider;
  curves?: Partial<Record<keyof typeof SPOILAGE_CURVES, SpoilageCurve>>;
  /** Hours charged to the first event on a route. See the header. */
  initialExposureHours?: number;
  newId?: () => string;
}

interface RouteAccumulator {
  score: number;
  lastTimestampMs: number;
}

export class CargoRiskEvaluator {
  private readonly routes: RouteContextProvider;
  private readonly curves: typeof SPOILAGE_CURVES;
  private readonly initialExposureHours: number;
  private readonly newId: () => string;
  private readonly accumulators = new Map<string, RouteAccumulator>();

  constructor(options: CargoEvaluatorOptions) {
    this.routes = options.routes;
    this.curves = { ...SPOILAGE_CURVES, ...options.curves };
    this.initialExposureHours = options.initialExposureHours ?? 1;
    this.newId = options.newId ?? randomUUID;
  }

  /** Running score for a route, for inspection and tests. */
  scoreFor(route_id: string): number {
    return this.accumulators.get(route_id)?.score ?? 0;
  }

  /** Forget a route's accumulated exposure — a new shipment on the same lane. */
  reset(route_id?: string): void {
    if (route_id === undefined) this.accumulators.clear();
    else this.accumulators.delete(route_id);
  }

  evaluate(event: ThermalExposureEvent): CargoEvaluation {
    const context = this.routes.get(event.route_id);
    if (!context) throw new UnknownRouteError(event.route_id);

    const curve = this.curves[context.cargo_class];
    const nowMs = new Date(event.timestamp).getTime();

    const previous = this.accumulators.get(event.route_id);
    const exposure_hours = previous
      ? Math.max(0, (nowMs - previous.lastTimestampMs) / MS_PER_HOUR)
      : this.initialExposureHours;

    const contributed = degreeHours(event.temp_c, exposure_hours, curve);
    const score = round2((previous?.score ?? 0) + contributed);

    this.accumulators.set(event.route_id, { score, lastTimestampMs: nowMs });

    const risk_level = riskLevelFor(score, curve);
    const recommended_action = actionFor(risk_level);

    const assessment: CargoRiskAssessment = {
      assessment_id: this.newId(),
      cargo_class: context.cargo_class,
      event_id: event.event_id,
      cumulative_exposure_score: score,
      threshold: curve.breach_degree_hours,
      risk_level,
      recommended_action,
      // Phase 4 generates both of these; nothing is drafted yet.
      claim_draft_id: null,
      reroute_suggestion: null,
    };

    const over = round2(Math.max(0, event.temp_c - curve.ceiling_c));
    const explanation =
      over > 0
        ? `${event.temp_c}°C is ${over}°C above the ${context.cargo_class} ceiling of ` +
          `${curve.ceiling_c}°C; held for ${round2(exposure_hours)}h that adds ` +
          `${round2(contributed)} degree-hours, bringing cumulative exposure to ${score} ` +
          `against a breach threshold of ${curve.breach_degree_hours}. Risk is ${risk_level}.`
        : `${event.temp_c}°C is at or below the ${context.cargo_class} ceiling of ` +
          `${curve.ceiling_c}°C, so no exposure accrued. Cumulative exposure remains ` +
          `${score}. Risk is ${risk_level}.`;

    return { assessment, contributed_degree_hours: round2(contributed), exposure_hours, explanation };
  }
}

function actionFor(level: CargoRiskAssessment['risk_level']): CargoRecommendedAction {
  switch (level) {
    case 'nominal':
      return 'none';
    case 'elevated':
      return 'reroute';
    case 'breach':
      return 'claim_draft';
  }
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
