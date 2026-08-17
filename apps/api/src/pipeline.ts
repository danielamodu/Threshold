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
 */

import type { ThermalExposureEvent } from '@threshold/types';
import type { AuditSink } from '@threshold/audit';
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
}

export interface PipelineResult {
  events: ThermalExposureEvent[];
  compliance: ComplianceEvaluation[];
  cargo: CargoEvaluation[];
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

  private readonly sink: AuditSink;
  private readonly complianceResults: ComplianceEvaluation[] = [];
  private readonly cargoResults: CargoEvaluation[] = [];

  constructor(options: PipelineOptions) {
    this.sink = options.sink;

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

  /** Log the event, then fan it out. */
  async handle(event: ThermalExposureEvent): Promise<void> {
    await this.sink.append({
      entry_type: 'thermal_exposure_event',
      event_id: event.event_id,
      route_id: event.route_id,
      payload: event,
      occurred_at: event.timestamp,
    });
    await this.bus.publish(event);
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
    return { events, compliance: [...this.complianceResults], cargo: [...this.cargoResults] };
  }

  get results(): PipelineResult {
    return {
      events: [],
      compliance: [...this.complianceResults],
      cargo: [...this.cargoResults],
    };
  }
}
