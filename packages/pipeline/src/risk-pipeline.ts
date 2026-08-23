/**
 * Composition root for the risk pipeline.
 *
 * Lives in its own package (`@threshold/pipeline`), not inside apps/api, since
 * apps/web's Phase 5 dashboard needed the exact same wiring — duplicating a
 * composition root across two apps would have been the actual DRY violation.
 * It is still not a "real" architecture layer per §2's diagram; it is the glue
 * between the layers, kept out of any of them individually:
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
 *
 * ── Phase 4 outputs happen BEFORE logging, not after ────────────────────────
 * `ComplianceRecord.exported_pdf_url` and `CargoRiskAssessment.claim_draft_id`
 * / `.reroute_suggestion` are fields ON the §3 records — and `audit_log` is
 * append-only, so there is no "log it, then patch in the URL." Each bus
 * subscriber below builds its output artifact (PDF, claim draft, mocked
 * reroute) and folds the result into the record BEFORE that record is pushed
 * anywhere or appended to the sink. Only the finished record is ever logged.
 *
 * ── org_id (§11 Phase 7) is a construction-time concern, not a per-event one ──
 * `audit_log.org_id` is required, but it is NOT threaded through
 * `RouteContextProvider`/the evaluators, and `ThermalExposureEvent` still
 * carries no org_id (§3 stays untouched — signed off explicitly). Two orgs can
 * share the same `route_id` string (enforced only as `unique(org_id,
 * route_id)` at the DB level), so a lookup keyed on bare `route_id` alone is
 * only safe when the registry itself is already scoped to one org. Every
 * `RiskPipeline` and every `RouteRegistry`/`PostgresRouteRegistry` is already
 * constructed fresh per run in this codebase (one demo request, one seeded
 * org) — so `org_id` is a constructor argument here, exactly once, and every
 * audit write in this file uses that single value. This keeps
 * `RouteContextProvider` and both evaluators exactly as they were: pure, and
 * unaware multi-tenancy exists.
 */

import { randomUUID } from 'node:crypto';
import type { AgentDecision, ThermalExposureEvent } from '@threshold/types';
import type { AuditSink } from '@threshold/audit';
import { HardCodedThresholdDecider } from '@threshold/decision-layer';
import { ingest, type TelemetryAdapter, type ThermalReadingSource } from '@threshold/ingestion';
import {
  HttpWebhookEmitter,
  InMemoryPdfStore,
  buildWebhookPayload,
  generateClaimDraft,
  generateRerouteSuggestion,
  renderClaimDraftPdf,
  renderCompliancePdf,
  type ClaimDraft,
  type PdfStore,
  type WebhookEmitter,
} from '@threshold/output';
import {
  CargoRiskEvaluator,
  EventBus,
  HumanComplianceEvaluator,
  type CargoEvaluation,
  type ComplianceEvaluation,
  type RouteContextProvider,
} from '@threshold/risk-engine';

export interface PipelineOptions {
  sink: AuditSink;
  /** Every audit write this pipeline makes is stamped with this org (§11 Phase 7). */
  org_id: string;
  /** RouteRegistry (in-memory) or PostgresRouteRegistry (@threshold/accounts) — either satisfies this. */
  routes: RouteContextProvider;
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
  /** Where generated PDFs are persisted. Defaults to in-memory (no disk I/O). */
  pdfStore?: PdfStore;
  /**
   * Defaults to a real `HttpWebhookEmitter` configured with no URL — a
   * documented no-op, not skipped emission. See webhook.ts's file header:
   * "nothing external consumes it yet" is meant literally, not faked by
   * pretending the emitter doesn't exist. Pass `null` to skip emission
   * entirely (e.g. isolating earlier phases in a test).
   */
  webhookEmitter?: WebhookEmitter | null;
  newId?: () => string;
}

export interface PipelineResult {
  events: ThermalExposureEvent[];
  compliance: ComplianceEvaluation[];
  cargo: CargoEvaluation[];
  decisions: AgentDecision[];
  /** Only present for events that actually breached (§4 exit condition). */
  claimDrafts: ClaimDraft[];
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
  readonly pdfStore: PdfStore;
  readonly webhookEmitter: WebhookEmitter | null;
  readonly org_id: string;

  private readonly sink: AuditSink;
  private readonly newId: () => string;
  private readonly complianceResults: ComplianceEvaluation[] = [];
  private readonly cargoResults: CargoEvaluation[] = [];
  private readonly decisions: AgentDecision[] = [];
  private readonly claimDrafts: ClaimDraft[] = [];

  constructor(options: PipelineOptions) {
    this.sink = options.sink;
    this.org_id = options.org_id;
    this.newId = options.newId ?? randomUUID;
    this.decider =
      options.decider === null ? null : (options.decider ?? new HardCodedThresholdDecider());
    this.pdfStore = options.pdfStore ?? new InMemoryPdfStore();
    this.webhookEmitter =
      options.webhookEmitter === null ? null : (options.webhookEmitter ?? new HttpWebhookEmitter(null));

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

      // §4: every compliance record is exportable — not just breaches. This
      // is the standing documentation, produced whether or not anything fired.
      const pdfBytes = await renderCompliancePdf(evaluation.record, { route_id: event.route_id });
      const exported_pdf_url = await this.pdfStore.save(
        `compliance-${evaluation.record.record_id}.pdf`,
        pdfBytes,
      );
      const finalRecord = { ...evaluation.record, exported_pdf_url };
      const finalEvaluation = { ...evaluation, record: finalRecord };

      this.complianceResults.push(finalEvaluation);
      await this.sink.append({
        entry_type: 'compliance_record',
        event_id: event.event_id,
        route_id: event.route_id,
        org_id: this.org_id,
        payload: finalRecord,
        occurred_at: finalRecord.generated_at,
      });
    });

    this.bus.subscribe('cargo-risk', async (event) => {
      const evaluation = this.cargo.evaluate(event);
      let finalAssessment = evaluation.assessment;
      // §11 addition: held out here only so it can be appended to the sink
      // AFTER the assessment below. Stays null for every non-breach event.
      let loggableDraft: ClaimDraft | null = null;

      if (evaluation.assessment.recommended_action === 'claim_draft') {
        const draft = generateClaimDraft(evaluation.assessment, event.route_id, {
          newId: this.newId,
        });
        const pdfBytes = await renderClaimDraftPdf(draft);
        const exported_pdf_url = await this.pdfStore.save(`claim-${draft.claim_draft_id}.pdf`, pdfBytes);
        const finalDraft = { ...draft, exported_pdf_url };
        this.claimDrafts.push(finalDraft);
        loggableDraft = finalDraft;
        finalAssessment = { ...evaluation.assessment, claim_draft_id: finalDraft.claim_draft_id };
      } else if (evaluation.assessment.recommended_action === 'reroute') {
        // §3 types this field as the deliberately loose `object | null` —
        // RerouteSuggestion is Phase 4's own shape underneath it, so the cast
        // is the actual boundary between the locked contract and Phase 4's design.
        const reroute_suggestion = generateRerouteSuggestion(
          evaluation.assessment.cumulative_exposure_score,
          evaluation.assessment.threshold,
        ) as unknown as Record<string, unknown>;
        finalAssessment = { ...evaluation.assessment, reroute_suggestion };
      }

      const finalEvaluation = { ...evaluation, assessment: finalAssessment };
      this.cargoResults.push(finalEvaluation);
      await this.sink.append({
        entry_type: 'cargo_risk_assessment',
        event_id: event.event_id,
        route_id: event.route_id,
        org_id: this.org_id,
        payload: finalAssessment,
        occurred_at: event.timestamp,
      });

      // §11 addition, strictly after the assessment append above: the draft's
      // `assessment_id` must never point at an assessment that isn't in the
      // log yet — the same ordering discipline handle() applies when it logs
      // the event before either evaluation. Nothing above this line changed
      // behaviour; a non-breach event appends exactly what it always did.
      if (loggableDraft) {
        await this.sink.append({
          entry_type: 'claim_draft',
          event_id: event.event_id,
          route_id: event.route_id,
          org_id: this.org_id,
          payload: loggableDraft,
          occurred_at: loggableDraft.generated_at,
        });
      }
    });
  }

  /**
   * Log the event, fan it out to both evaluators, then — once both have
   * finished and their own audit writes have landed — run the Agent Decision
   * Layer on their combined output, and emit the webhook for that decision.
   */
  async handle(event: ThermalExposureEvent): Promise<AgentDecision | null> {
    await this.sink.append({
      entry_type: 'thermal_exposure_event',
      event_id: event.event_id,
      route_id: event.route_id,
      org_id: this.org_id,
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
      org_id: this.org_id,
      payload: decision,
      rationale: decision.rationale,
      occurred_at: decision.timestamp,
    });

    if (this.webhookEmitter) {
      const payload = buildWebhookPayload({
        thermal_event: event,
        compliance_record: complianceResult.record,
        cargo_assessment: cargoResult.assessment,
        decision,
      });
      await this.webhookEmitter.emit(payload);
    }

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
      claimDrafts: [...this.claimDrafts],
    };
  }

  get results(): PipelineResult {
    return {
      events: [],
      compliance: [...this.complianceResults],
      cargo: [...this.cargoResults],
      decisions: [...this.decisions],
      claimDrafts: [...this.claimDrafts],
    };
  }
}
