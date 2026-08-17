/**
 * Human Compliance Evaluator (§2).
 *
 *   "NWS heat-index formula against OSHA thresholds, generates work/rest
 *    schedule, flags threshold breaches."
 *
 * Produces a `ComplianceRecord` per §3. `heat_index_c` is computed HERE, not
 * read from the event — §8 decision 2 removed it from the ingestion contract
 * precisely so this stays the one place it is derived.
 */

import { randomUUID } from 'node:crypto';
import type {
  ComplianceAction,
  ComplianceRecord,
  ComplianceScheduleEntry,
  ThermalExposureEvent,
} from '@threshold/types';
import { heatIndexWithDomain } from './heat-index.js';
import {
  bandFor,
  DRY_BULB_FALLBACK_BANDS_C,
  HEAT_INDEX_BANDS_C,
  WORK_REST_BY_BAND,
  type HeatRiskBand,
} from './osha.js';
import type { RouteContextProvider } from './route-context.js';
import { UnknownRouteError } from './route-context.js';

const MS_PER_MINUTE = 60_000;

export interface ComplianceEvaluation {
  record: ComplianceRecord;
  band: HeatRiskBand;
  /** True when humidity was unavailable and the dry-bulb fallback was used. */
  usedFallback: boolean;
  /** Plain-English reason, reused by the Phase 3 rationale. */
  explanation: string;
}

export interface ComplianceEvaluatorOptions {
  routes: RouteContextProvider;
  /** Length of the scheduled window, minutes. Defaults to one hour. */
  windowMinutes?: number;
  newId?: () => string;
  now?: () => Date;
}

export class HumanComplianceEvaluator {
  private readonly routes: RouteContextProvider;
  private readonly windowMinutes: number;
  private readonly newId: () => string;
  private readonly now: () => Date;

  constructor(options: ComplianceEvaluatorOptions) {
    this.routes = options.routes;
    this.windowMinutes = options.windowMinutes ?? 60;
    this.newId = options.newId ?? randomUUID;
    this.now = options.now ?? (() => new Date());
  }

  evaluate(event: ThermalExposureEvent): ComplianceEvaluation {
    const context = this.routes.get(event.route_id);
    if (!context) throw new UnknownRouteError(event.route_id);

    const degraded = event.data_quality === 'degraded_no_humidity' || event.humidity_pct === null;

    let heat_index_c: number | null;
    let band: HeatRiskBand;
    let explanation: string;

    if (degraded) {
      // §8 decision 3 — the NWS formula needs humidity, so fall back to a
      // conservative dry-bulb rule rather than dropping the event or, worse,
      // treating missing humidity as zero.
      heat_index_c = null;
      band = bandFor(event.temp_c, DRY_BULB_FALLBACK_BANDS_C);
      explanation =
        `Humidity was unavailable for this waypoint, so the NWS heat index could not be ` +
        `computed. Fell back to the conservative dry-bulb rule: ${event.temp_c}°C places ` +
        `this in the ${band} band. Humidity was recorded as unavailable rather than ` +
        `assumed, since assuming it would understate the risk.`;
    } else {
      const humidity = event.humidity_pct as number;
      const hi = heatIndexWithDomain(event.temp_c, humidity);
      heat_index_c = round1(hi.value);
      band = bandFor(heat_index_c, HEAT_INDEX_BANDS_C);
      explanation = hi.extrapolated
        ? `Dry-bulb ${event.temp_c}°C is beyond the range the NWS heat index formula was ` +
          `validated for, so the index is reported as at least ${heat_index_c}°C rather than ` +
          `extrapolated to a precise figure. Dry bulb alone already clears the OSHA ` +
          `${band} threshold.`
        : `Dry-bulb ${event.temp_c}°C at ${humidity}% relative humidity gives an NWS heat ` +
          `index of ${heat_index_c}°C, which is in the OSHA ${band} band.`;
    }

    const rule = WORK_REST_BY_BAND[band];
    const action = actionFor(band);
    const schedule = this.buildSchedule(event.timestamp, band);

    const record: ComplianceRecord = {
      record_id: this.newId(),
      driver_id: context.driver_id,
      event_id: event.event_id,
      heat_index_c,
      action,
      schedule,
      generated_at: this.now().toISOString(),
      // Phase 4 renders the PDF; nothing has been exported yet.
      exported_pdf_url: null,
    };

    return {
      record,
      band,
      usedFallback: degraded,
      explanation:
        `${explanation} ${
          rule.restMinutesPerHour === 0
            ? 'No additional rest is scheduled at this level.'
            : `Scheduled ${rule.restMinutesPerHour} minutes of ${rule.scheduleType === 'rest' ? 'rest' : 'reduced load'} in the following hour.`
        }`,
    };
  }

  /**
   * One window following the event. Rest is placed at the END of the window:
   * a break is a response to accumulated exposure, so scheduling it first would
   * misrepresent when the driver is actually at risk.
   */
  private buildSchedule(eventTimestamp: string, band: HeatRiskBand): ComplianceScheduleEntry[] {
    const rule = WORK_REST_BY_BAND[band];
    if (rule.restMinutesPerHour <= 0) return [];

    const windowStart = new Date(eventTimestamp).getTime();
    const windowEnd = windowStart + this.windowMinutes * MS_PER_MINUTE;
    const restStart = windowEnd - rule.restMinutesPerHour * MS_PER_MINUTE;

    return [
      {
        start: new Date(restStart).toISOString(),
        end: new Date(windowEnd).toISOString(),
        type: rule.scheduleType,
      },
    ];
  }
}

function actionFor(band: HeatRiskBand): ComplianceAction {
  switch (band) {
    case 'caution':
      return 'none';
    case 'moderate':
    case 'high':
      return 'rest_break_scheduled';
    case 'extreme':
      return 'work_limit_reduced';
  }
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
