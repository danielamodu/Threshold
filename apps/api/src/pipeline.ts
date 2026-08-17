/**
 * Composition root for the risk pipeline.
 *
 * This is the only place the layers are wired together, and it is deliberately
 * in the app rather than in a package:
 *
 *   - The evaluators stay PURE. They return their assessment and never write to
 *     the audit log themselves. §2 requires that evaluations be logged; it does
 *     not require that the evaluator be the thing that logs them. Keeping the
 *     write here is what lets the evaluators be unit-tested with no database
 *     and no sink at all.
 *   - `risk-engine` therefore has no dependency on `audit`, and `ingestion` has
 *     no dependency on `risk-engine`. The arrows only point inward, to `types`.
 *
 * Swapping the simulator for the real FortyGuard feed is a change to the
 * `ThermalReadingSource` handed in here. Nothing else moves.
 *
 * ── The Agent Decision Layer is NOT a third bus subscriber ──────────────────
 * §2: "Orchestrator agent reads both evaluator outputs" — it runs AFTER both
 * evaluators, on their combined output, not concurrently alongside them. It is
 * wired as a sequential step in `handle()`, once `bus.publish()` has resolved
 * (which only happens after both evaluators — and their audit writes — have
 * completed). Only the fallback decider (§9 Phase 3 item 1) is wired here; the
 * LLM orchestrator (item 2) is a separate, still-open decision per §10 and has
 * no wiring yet.
 */

import type { AgentDecision, ThermalExposureEvent } from '@threshold/types';
import type { AuditSink } from '@threshold/audit';
import { HardCodedThresholdDecider } from '@threshold/decision-layer';
import { ingest, type TelemetryAdapter, type ThermalReadingSource } from '@threshold/ingestion';
import {
  CargoRiskEvaluator,
  EventBus,
  HumanComplianceEvaluator,
  RouteRegistry,
  type CargoEvaluation,
  type ComplianceEvaluation,
} from '@threshold/risk-engine';

export interface PipelineOptions {
  sink: AuditSink;
  routes: RouteRegistry;
  /** Minutes of the scheduling window handed to the compliance evaluator. */
  windowMinutes?: number;
  /** Hours charged to the first event on a route. See CargoRiskEvaluator. */
  initialExposureHours?: number;
  /**
   * Phase 3 hard-coded-threshold fallback (§9 item 1) — this IS the safety
   * net, so it runs by default rather than needing to be opted into. Pass an
   * explicit `HardCodedThresholdDecider` to change its options (e.g.
   * `allowAutoExecute`), or `null` to disable the Agent Decision Layer
   * entirely (useful for isolating Phase 1/2 behaviour in a test).
   */
  decider?: HardCodedThresholdDecider | null;
}

export interface PipelineResult {
  events: ThermalExposureEvent[];
  compliance: ComplianceEvaluation[];
  cargo: CargoEvaluation[];
  decisions: AgentDecision[];
}

/**
 * Wires both evaluators onto one bus and logs everything through the sink.
 *
 * Order per event is deliberate: the EVENT is logged before either evaluation.
 * An evaluation that references an event_id absent from the log would be an
 * un-auditable record, which is the one thing §2 cannot tolerate.
 */
export class RiskPipeline {
  readonly bus = new EventBus();
  readonly compliance: HumanComplianceEvaluator;
  readonly cargo: CargoRiskEvaluator;
  readonly decider: HardCodedThresholdDecider | null;

  private readonly sink: AuditSink;
  private readonly complianceResults: ComplianceEvaluation[] = [];
  private readonly cargoResults: CargoEvaluation[] = [];
  private readonly decisions: AgentDecision[] = [];

  constructor(options: PipelineOptions) {
    this.sink = options.sink;
    this.decider =
      options.decider === null ? null : (options.decider ?? new HardCodedThresholdDecider());

    this.compliance = new HumanComplianceEvaluator({
      routes: options.routes,
      ...(options.windowMinutes === undefined ? {} : { windowMinutes: options.windowMinutes }),
    });
    this.cargo = new CargoRiskEvaluator({
      routes: options.routes,
      ...(options.initialExposureHours === undefined
        ? {}
        : { initialExposureHours: options.initialExposureHours }),
    });

    // Both subscribers receive the same event object — §2's "don't fork the
    // pipeline" made structural rather than aspirational.
    this.bus.subscribe('human-compliance', async (event) => {
      const evaluation = this.compliance.evaluate(event);
      this.complianceResults.push(evaluation);
      await this.sink.append({
        entry_type: 'compliance_record',
        event_id: event.event_id,
        route_id: event.route_id,
        payload: evaluation.record,
        occurred_at: evaluation.record.generated_at,
      });
    });

    this.bus.subscribe('cargo-risk', async (event) => {
      const evaluation = this.cargo.evaluate(event);
      this.cargoResults.push(evaluation);
      await this.sink.append({
        entry_type: 'cargo_risk_assessment',
        event_id: event.event_id,
        route_id: event.route_id,
        payload: evaluation.assessment,
        occurred_at: event.timestamp,
      });
    });
  }

  /**
   * Log the event, fan it out to both evaluators, then — once both have
   * finished and their own audit writes have landed — run the Agent Decision
   * Layer on their combined output.
   */
  async handle(event: ThermalExposureEvent): Promise<AgentDecision | null> {
    await this.sink.append({
      entry_type: 'thermal_exposure_event',
      event_id: event.event_id,
      route_id: event.route_id,
      payload: event,
      occurred_at: event.timestamp,
    });
    await this.bus.publish(event);

    if (!this.decider) return null;

    // publish() only resolves after both subscribers have finished, so the
    // last entry each pushed is guaranteed to be this event's pair — handle()
    // is only ever run to completion for one event at a time (see run()).
    const complianceResult = this.complianceResults.at(-1);
    const cargoResult = this.cargoResults.at(-1);
    if (
      !complianceResult ||
      !cargoResult ||
      complianceResult.record.event_id !== event.event_id ||
      cargoResult.assessment.event_id !== event.event_id
    ) {
      throw new Error(
        `Agent Decision Layer: no matching evaluator outputs found for event ${event.event_id} ` +
          `after publish() resolved. This should be unreachable.`,
      );
    }

    const { decision } = this.decider.decide(complianceResult.record, cargoResult.assessment);
    this.decisions.push(decision);
    await this.sink.append({
      entry_type: 'agent_decision',
      event_id: event.event_id,
      route_id: event.route_id,
      payload: decision,
      rationale: decision.rationale,
      occurred_at: decision.timestamp,
    });
    return decision;
  }

  /** Drive a whole route through the pipeline, in order. */
  async run(
    telemetry: TelemetryAdapter,
    readings: ThermalReadingSource,
  ): Promise<PipelineResult> {
    const events: ThermalExposureEvent[] = [];
    for await (const event of ingest(telemetry, readings)) {
      events.push(event);
      await this.handle(event);
    }
    return {
      events,
      compliance: [...this.complianceResults],
      cargo: [...this.cargoResults],
      decisions: [...this.decisions],
    };
  }

  get results(): PipelineResult {
    return {
      events: [],
      compliance: [...this.complianceResults],
      cargo: [...this.cargoResults],
      decisions: [...this.decisions],
    };
  }
}
