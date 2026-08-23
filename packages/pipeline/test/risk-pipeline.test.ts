/**
 * §6 Phase 2 exit condition:
 *
 *   "feed a synthetic breach event in, both evaluators independently produce
 *    correct, audit-logged outputs."
 *
 * §6/§9 Phase 3 exit condition (fallback only — see the describe block below):
 *
 *   "a breach event produces a logged decision with a rationale string a
 *    human could read and understand without you explaining it."
 *
 * Plus §1's core insight made checkable: one event, two liability responses
 * (now three, with the fallback decision), correlated by event_id in a single
 * append-only log.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { InMemoryAuditSink } from '@threshold/audit';
import { HardCodedThresholdDecider } from '@threshold/decision-layer';
import {
  SimulatedTelemetryAdapter,
  SyntheticThermalReadingSource,
  type RouteSpec,
} from '@threshold/ingestion';
import { InMemoryPdfStore, RecordingWebhookEmitter, type WebhookEmitter } from '@threshold/output';
import { RouteRegistry } from '@threshold/risk-engine';
import {
  assertValid,
  validateAgentDecision,
  validateCargoRiskAssessment,
  validateComplianceRecord,
  validateThermalExposureEvent,
} from '@threshold/types';
import { RiskPipeline } from '../src/risk-pipeline.js';

const ROUTE: RouteSpec = {
  route_id: 'route-phx-01',
  driver_id: 'driver-42',
  cargo_class: 'pharma',
  departs_at: '2026-08-17T13:00:00.000Z',
  leg_minutes: 60,
  waypoints: [
    { waypoint_id: 'wp-1', lat: 33.4484, lng: -112.074 },
    { waypoint_id: 'wp-2', lat: 33.5, lng: -112.1 },
    { waypoint_id: 'wp-3', lat: 33.56, lng: -112.15 },
    { waypoint_id: 'wp-4', lat: 33.62, lng: -112.2 },
  ],
};

interface BuildPipelineOptions {
  decider?: HardCodedThresholdDecider | null;
  pdfStore?: InMemoryPdfStore;
  webhookEmitter?: WebhookEmitter | null;
}

function build(readingOptions: Record<string, unknown> = {}, pipelineOptions: BuildPipelineOptions = {}) {
  const sink = new InMemoryAuditSink();
  const routes = new RouteRegistry().register({
    route_id: ROUTE.route_id,
    driver_id: ROUTE.driver_id,
    cargo_class: ROUTE.cargo_class,
  });
  const pdfStore = pipelineOptions.pdfStore ?? new InMemoryPdfStore();
  const pipeline = new RiskPipeline({
    sink,
    org_id: 'org_test',
    routes,
    initialExposureHours: 1,
    ...pipelineOptions,
    pdfStore,
  });
  const telemetry = new SimulatedTelemetryAdapter({ route: ROUTE, seed: 1234 });
  const readings = new SyntheticThermalReadingSource({ seed: 99, ...readingOptions });
  return { sink, pipeline, telemetry, readings, pdfStore };
}

/** memory://filename -> filename, the InMemoryPdfStore key. */
function pdfFilenameFromUrl(url: string | null): string {
  assert.ok(url, 'expected a non-null exported_pdf_url');
  assert.match(url, /^memory:\/\//);
  return url.replace('memory://', '');
}

describe('risk pipeline (Phase 2 exit condition)', () => {
  it('runs a whole simulated route with no manual intervention', async () => {
    const { pipeline, telemetry, readings } = build();
    const { events, compliance, cargo } = await pipeline.run(telemetry, readings);

    assert.equal(events.length, 4);
    assert.equal(compliance.length, 4, 'every event must produce a compliance record');
    assert.equal(cargo.length, 4, 'every event must produce a cargo assessment');
  });

  it('both evaluators respond to the SAME event, independently', async () => {
    const { pipeline, telemetry, readings } = build();
    const { events, compliance, cargo } = await pipeline.run(telemetry, readings);

    for (let i = 0; i < events.length; i++) {
      const id = events[i]?.event_id;
      assert.equal(compliance[i]?.record.event_id, id);
      assert.equal(cargo[i]?.assessment.event_id, id);
    }
  });

  it('every logged payload is §3-valid', async () => {
    const { sink, pipeline, telemetry, readings } = build();
    await pipeline.run(telemetry, readings);

    for (const entry of await sink.read()) {
      assert.equal(entry.org_id, 'org_test', `every entry must carry the pipeline's org_id (§11)`);
      switch (entry.entry_type) {
        case 'thermal_exposure_event':
          assertValid('logged event', validateThermalExposureEvent(entry.payload));
          break;
        case 'compliance_record':
          assertValid('logged ComplianceRecord', validateComplianceRecord(entry.payload));
          break;
        case 'cargo_risk_assessment':
          assertValid('logged CargoRiskAssessment', validateCargoRiskAssessment(entry.payload));
          break;
        case 'agent_decision':
          assertValid('logged AgentDecision', validateAgentDecision(entry.payload));
          break;
        case 'claim_draft':
          // Deliberately not validated against a §3 validator: ClaimDraft is
          // Phase 4's own shape, not a §3 contract, so no validateClaimDraft
          // exists to call. Named explicitly anyway so the exhaustiveness
          // guarantee below stays real rather than silently absorbing it.
          break;
        default:
          // Exhaustive: every entry_type Phase 3 can produce is handled above.
          // Reaching here means a new entry_type exists that this test (and
          // the pipeline) hasn't been taught about yet.
          assert.fail(`unexpected entry_type: ${JSON.stringify(entry)}`);
      }
    }
  });

  it('logs the event BEFORE its evaluations, so no record dangles', async () => {
    const { sink, pipeline, telemetry, readings } = build();
    await pipeline.run(telemetry, readings);
    const entries = await sink.read();

    const seenEvents = new Set<string>();
    for (const entry of entries) {
      if (entry.entry_type === 'thermal_exposure_event') {
        seenEvents.add(entry.event_id);
      } else {
        assert.ok(
          seenEvents.has(entry.event_id),
          `${entry.entry_type} at seq ${entry.seq} references an unlogged event`,
        );
      }
    }
  });

  it('logs in monotonic order', async () => {
    const { sink, pipeline, telemetry, readings } = build();
    await pipeline.run(telemetry, readings);
    const seqs = (await sink.read()).map((e) => e.seq);
    assert.deepEqual([...seqs].sort((a, b) => a - b), seqs);
  });

  it('writes exactly four entries per event — one event, two evaluations, one decision', async () => {
    const { sink, pipeline, telemetry, readings } = build();
    await pipeline.run(telemetry, readings);
    const entries = await sink.read();

    // No spikes, so nothing breaches and no claim_draft is written — four per
    // event is the floor for every run, and the exact count for a clean one.
    assert.equal(entries.length, 16); // 4 events x 4
    assert.equal(entries.filter((e) => e.entry_type === 'thermal_exposure_event').length, 4);
    assert.equal(entries.filter((e) => e.entry_type === 'compliance_record').length, 4);
    assert.equal(entries.filter((e) => e.entry_type === 'cargo_risk_assessment').length, 4);
    assert.equal(entries.filter((e) => e.entry_type === 'agent_decision').length, 4);
  });

  describe('the core insight (§1): one heat spike, both liabilities fire', () => {
    it('a spike at one waypoint escalates BOTH sides for that event', async () => {
      // 20C above ambient at wp-3: hot enough for OSHA extreme on the human
      // side and far past the pharma ceiling on the cargo side.
      const { sink, pipeline, telemetry, readings } = build({ spikes: { 'wp-3': 20 } });
      const { events, compliance, cargo } = await pipeline.run(telemetry, readings);

      const spikeIndex = events.findIndex((e) => e.waypoint_id === 'wp-3');
      assert.ok(spikeIndex >= 0);

      const humanAtSpike = compliance[spikeIndex];
      const cargoAtSpike = cargo[spikeIndex];
      assert.ok(humanAtSpike && cargoAtSpike);

      assert.equal(humanAtSpike.band, 'extreme');
      assert.equal(humanAtSpike.record.action, 'work_limit_reduced');
      assert.equal(cargoAtSpike.assessment.risk_level, 'breach');
      assert.equal(cargoAtSpike.assessment.recommended_action, 'claim_draft');

      // And the correlation key ties all the rows together — the query the
      // demo actually shows a judge. Five, not four, for a BREACHING event:
      // the §11 claim_draft row is correlated by the same event_id. A
      // non-breaching event still writes exactly four (asserted above, in
      // "writes exactly four entries per event").
      const eventId = events[spikeIndex]?.event_id;
      const related = (await sink.read()).filter((e) => e.event_id === eventId);
      assert.equal(related.length, 5);
      assert.deepEqual(
        related.map((e) => e.entry_type).sort(),
        [
          'agent_decision',
          'cargo_risk_assessment',
          'claim_draft',
          'compliance_record',
          'thermal_exposure_event',
        ],
      );
    });
  });

  describe('degraded humidity degrades one side only', () => {
    it('nulls heat_index_c but still scores cargo, which needs no humidity', async () => {
      const { pipeline, telemetry, readings } = build({
        spikes: { 'wp-2': 20 },
        humidityUnavailableAt: ['wp-2'],
      });
      const { events, compliance, cargo } = await pipeline.run(telemetry, readings);

      const i = events.findIndex((e) => e.waypoint_id === 'wp-2');
      assert.ok(i >= 0);
      assert.equal(events[i]?.data_quality, 'degraded_no_humidity');

      // Human side: no heat index, but protection still issued.
      assert.equal(compliance[i]?.record.heat_index_c, null);
      assert.equal(compliance[i]?.usedFallback, true);
      assert.notEqual(compliance[i]?.record.action, 'none');

      // Cargo side: entirely unaffected.
      assert.equal(cargo[i]?.assessment.risk_level, 'breach');
    });
  });

  it('cargo exposure accumulates across the route', async () => {
    const { pipeline, telemetry, readings } = build();
    const { cargo } = await pipeline.run(telemetry, readings);
    const scores = cargo.map((c) => c.assessment.cumulative_exposure_score);
    for (let i = 1; i < scores.length; i++) {
      assert.ok(
        (scores[i] ?? 0) >= (scores[i - 1] ?? 0),
        `cumulative score must never fall: ${scores.join(' -> ')}`,
      );
    }
  });

  it('is deterministic — the same seed yields the same audit log', async () => {
    const first = build();
    await first.pipeline.run(first.telemetry, first.readings);
    const second = build();
    await second.pipeline.run(second.telemetry, second.readings);

    const strip = (entries: Awaited<ReturnType<InMemoryAuditSink['read']>>) =>
      entries.map((e) => ({ type: e.entry_type, route: e.route_id, seq: e.seq }));

    assert.deepEqual(strip(await first.sink.read()), strip(await second.sink.read()));
  });

  describe('Phase 3 exit condition (§9 fallback only — no LLM orchestrator)', () => {
    it('a breach event produces a logged decision with a readable rationale', async () => {
      const { sink, pipeline, telemetry, readings } = build({ spikes: { 'wp-3': 20 } });
      const { events, decisions } = await pipeline.run(telemetry, readings);

      const spikeIndex = events.findIndex((e) => e.waypoint_id === 'wp-3');
      const decision = decisions[spikeIndex];
      assert.ok(decision);
      assertValid('AgentDecision', validateAgentDecision(decision));

      // "a rationale string a human could read and understand without you
      // explaining it" — check it actually says something, not just that a
      // string exists.
      assert.ok(decision.rationale.length > 40);
      assert.match(decision.rationale, /driver side/i);
      assert.match(decision.rationale, /cargo side/i);
      assert.notEqual(decision.action_tier, 'alert', 'a breach event should escalate past alert');

      const logged = (await sink.read()).find(
        (e) => e.entry_type === 'agent_decision' && e.event_id === decision.event_id,
      );
      assert.ok(logged);
      assert.equal(logged.rationale, decision.rationale);
    });

    it('the decision references the record ids actually written to the audit log', async () => {
      const { sink, pipeline, telemetry, readings } = build({ spikes: { 'wp-3': 20 } });
      const { events, decisions } = await pipeline.run(telemetry, readings);
      const spikeIndex = events.findIndex((e) => e.waypoint_id === 'wp-3');
      const decision = decisions[spikeIndex];
      assert.ok(decision);

      // sink is typed as InMemoryAuditSink by build(), so ofType() narrows
      // .payload properly — a plain .find() over the union would not.
      const loggedCompliance = sink
        .ofType('compliance_record')
        .find((e) => e.event_id === decision.event_id);
      const loggedCargo = sink
        .ofType('cargo_risk_assessment')
        .find((e) => e.event_id === decision.event_id);
      assert.ok(loggedCompliance && loggedCargo);
      assert.equal(decision.inputs.compliance_record_id, loggedCompliance.payload.record_id);
      assert.equal(decision.inputs.cargo_assessment_id, loggedCargo.payload.assessment_id);
    });

    it('defaults to capping at draft even when both sides hit their worst band', async () => {
      // Default pipeline construction — no decider option passed, matching
      // what a real caller gets without opting into anything.
      const { pipeline, telemetry, readings } = build({ spikes: { 'wp-3': 20 } });
      const { events, decisions } = await pipeline.run(telemetry, readings);
      const decision = decisions[events.findIndex((e) => e.waypoint_id === 'wp-3')];
      assert.ok(decision);
      assert.equal(decision.action_tier, 'draft');
      assert.notEqual(decision.action_tier, 'auto_execute');
    });

    it('reaches auto_execute only when explicitly enabled via the injected decider', async () => {
      const { pipeline, telemetry, readings } = build(
        { spikes: { 'wp-3': 20 } },
        { decider: new HardCodedThresholdDecider({ allowAutoExecute: true }) },
      );
      const { events, decisions } = await pipeline.run(telemetry, readings);
      const decision = decisions[events.findIndex((e) => e.waypoint_id === 'wp-3')];
      assert.ok(decision);
      assert.equal(decision.action_tier, 'auto_execute');
    });

    it('a fully nominal route stays at alert with high confidence throughout', async () => {
      const { pipeline, telemetry, readings } = build(); // no spikes, no degraded humidity
      const { decisions } = await pipeline.run(telemetry, readings);
      assert.equal(decisions.length, 4);
      for (const decision of decisions) {
        assert.equal(decision.action_tier, 'alert');
        assert.equal(decision.confidence, 0.9);
      }
    });

    it('passing decider: null disables the Agent Decision Layer entirely', async () => {
      const { sink, pipeline, telemetry, readings } = build(
        { spikes: { 'wp-3': 20 } },
        { decider: null },
      );
      const { decisions } = await pipeline.run(telemetry, readings);
      assert.equal(decisions.length, 0);
      assert.equal((await sink.read()).filter((e) => e.entry_type === 'agent_decision').length, 0);
    });
  });

  describe('Phase 4 exit condition (§6/§9 output/integration layer)', () => {
    it('one breach event produces both a real compliance PDF and a real claim draft, both viewable, both timestamped', async () => {
      const { pipeline, telemetry, readings, pdfStore } = build({ spikes: { 'wp-3': 20 } });
      const { events, compliance, cargo, claimDrafts } = await pipeline.run(telemetry, readings);

      const i = events.findIndex((e) => e.waypoint_id === 'wp-3');
      const record = compliance[i]?.record;
      const assessment = cargo[i]?.assessment;
      assert.ok(record && assessment);
      assert.equal(assessment.risk_level, 'breach', 'sanity: this must actually be a breach event');

      // Compliance PDF — real bytes, not a placeholder string.
      const compliancePdfBytes = pdfStore.get(pdfFilenameFromUrl(record.exported_pdf_url));
      assert.ok(compliancePdfBytes);
      const compliancePdf = await PDFDocument.load(compliancePdfBytes);
      assert.equal(compliancePdf.getPageCount(), 1);
      assert.ok(record.generated_at, 'compliance record must be timestamped');

      // Claim draft — same standard: real PDF bytes, linked back to this event.
      const draft = claimDrafts.find((d) => d.event_id === record.event_id);
      assert.ok(draft);
      assert.equal(draft.claim_draft_id, assessment.claim_draft_id);
      const claimPdfBytes = pdfStore.get(pdfFilenameFromUrl(draft.exported_pdf_url));
      assert.ok(claimPdfBytes);
      const claimPdf = await PDFDocument.load(claimPdfBytes);
      assert.equal(claimPdf.getPageCount(), 1);
      assert.ok(draft.generated_at, 'claim draft must be timestamped');
    });

    it('every compliance record is exportable, not only breaches — it is the standing documentation', async () => {
      const { pipeline, telemetry, readings, pdfStore } = build(); // no spikes at all
      const { compliance } = await pipeline.run(telemetry, readings);

      assert.equal(compliance.length, 4);
      for (const { record } of compliance) {
        assert.equal(record.action, 'none'); // sanity: nothing escalated
        const bytes = pdfStore.get(pdfFilenameFromUrl(record.exported_pdf_url));
        assert.ok(bytes, `expected a PDF even for a nominal record (${record.record_id})`);
      }
    });

    it('no claim draft is generated for a non-breach event', async () => {
      const { sink, pipeline, telemetry, readings } = build(); // no spikes
      const { cargo, claimDrafts } = await pipeline.run(telemetry, readings);

      for (const { assessment } of cargo) assert.equal(assessment.claim_draft_id, null);
      assert.equal(claimDrafts.length, 0);
      // §11: the new entry type must be genuinely additive — a run that never
      // breaches appends exactly the entries it always did, and no claim_draft.
      assert.equal(sink.ofType('claim_draft').length, 0);
    });

    it('persists the claim draft to the audit log, after the assessment that references it (§11)', async () => {
      const { sink, pipeline, telemetry, readings, pdfStore } = build({ spikes: { 'wp-3': 20 } });
      const { claimDrafts } = await pipeline.run(telemetry, readings);

      const draft = claimDrafts[0];
      assert.ok(draft, 'sanity: this spike must actually produce a draft');

      // Every draft the run produced is in the append-only log, exactly once —
      // deliberately not hardcoded to 1. Cumulative exposure stays above the
      // threshold once crossed (see 'cargo exposure accumulates across the
      // route'), so a spike at wp-3 keeps breaching at wp-4 as well. The
      // invariant Task 1 introduces is one logged entry per generated draft,
      // not one draft per run.
      const logged = sink.ofType('claim_draft');
      assert.equal(logged.length, claimDrafts.length);
      assert.deepEqual(
        logged.map((e) => e.payload.claim_draft_id).sort(),
        claimDrafts.map((d) => d.claim_draft_id).sort(),
        'the log must mirror the in-memory drafts exactly — none dropped, none duplicated',
      );

      const entry = logged.find((e) => e.payload.claim_draft_id === draft.claim_draft_id);
      assert.ok(entry, 'the first draft must be findable in the log by its own id');
      assert.equal(entry.event_id, draft.event_id);
      assert.equal(entry.route_id, ROUTE.route_id);
      assert.equal(entry.occurred_at, draft.generated_at);

      // The whole point: a durable link the Claims surface can resolve, whose
      // bytes are really there. Previously this URL existed only in memory.
      assert.ok(entry.payload.exported_pdf_url, 'a persisted draft must carry its PDF URL');
      assert.ok(pdfStore.get(pdfFilenameFromUrl(entry.payload.exported_pdf_url)));

      // Ordering: `payload.assessment_id` must never reference an assessment
      // that is not yet in the log.
      const assessmentEntry = sink
        .ofType('cargo_risk_assessment')
        .find((e) => e.payload.assessment_id === entry.payload.assessment_id);
      assert.ok(assessmentEntry, 'the referenced assessment must itself be logged');
      assert.ok(
        assessmentEntry.seq < entry.seq,
        `claim_draft (seq ${entry.seq}) must be logged after its assessment (seq ${assessmentEntry.seq})`,
      );

      // A claim draft carries no rationale — that requirement is scoped to
      // agent_decision alone, and this must not have widened it.
      assert.equal(entry.rationale, null);
    });

    it('an elevated (not yet breaching) event gets a mocked reroute suggestion instead of a claim draft', async () => {
      // A moderate spike that lands in 'elevated', not 'breach'.
      const { pipeline, telemetry, readings } = build({ spikes: { 'wp-2': 6 } });
      const { events, cargo, claimDrafts } = await pipeline.run(telemetry, readings);

      const i = events.findIndex((e) => e.waypoint_id === 'wp-2');
      const assessment = cargo[i]?.assessment;
      assert.ok(assessment);
      assert.equal(assessment.risk_level, 'elevated');
      assert.equal(assessment.claim_draft_id, null);
      assert.ok(assessment.reroute_suggestion, 'expected a mocked reroute suggestion');
      assert.equal((assessment.reroute_suggestion as { mocked: boolean }).mocked, true);
      assert.equal(claimDrafts.length, 0);
    });

    it('emits a webhook for every decision, carrying the full chain that produced it', async () => {
      const emitter = new RecordingWebhookEmitter();
      const { pipeline, telemetry, readings } = build({ spikes: { 'wp-3': 20 } }, { webhookEmitter: emitter });
      const { events, decisions } = await pipeline.run(telemetry, readings);

      assert.equal(emitter.deliveries.length, events.length);

      const i = events.findIndex((e) => e.waypoint_id === 'wp-3');
      const delivery = emitter.deliveries[i];
      const decision = decisions[i];
      assert.ok(delivery && decision);
      assert.equal(delivery.decision.decision_id, decision.decision_id);
      assert.equal(delivery.thermal_event.event_id, events[i]?.event_id);
      assert.equal(delivery.version, '1');
    });

    it('webhookEmitter: null skips emission entirely', async () => {
      const { pipeline, telemetry, readings } = build({}, { webhookEmitter: null });
      // Should not throw with no emitter configured.
      await pipeline.run(telemetry, readings);
      assert.equal(pipeline.webhookEmitter, null);
    });
  });
});
