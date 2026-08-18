import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type {
  AgentDecision,
  CargoRiskAssessment,
  ComplianceRecord,
  ThermalExposureEvent,
} from '@threshold/types';
import {
  HttpWebhookEmitter,
  RecordingWebhookEmitter,
  WEBHOOK_CONTRACT_VERSION,
  buildWebhookPayload,
} from '../src/webhook.js';

const event: ThermalExposureEvent = {
  event_id: 'e1',
  route_id: 'route-a',
  waypoint_id: 'wp-1',
  temp_c: 40,
  temp_stats: { mean: 38, max: 40, min: 36, stddev: 1 },
  humidity_pct: 50,
  data_quality: 'complete',
  timestamp: '2026-08-18T14:00:00.000Z',
  source: 'fortyguard_api',
};

const compliance: ComplianceRecord = {
  record_id: 'c1',
  driver_id: 'driver-1',
  event_id: 'e1',
  heat_index_c: 44,
  action: 'work_limit_reduced',
  schedule: [],
  generated_at: '2026-08-18T14:00:05.000Z',
  exported_pdf_url: null,
};

const cargo: CargoRiskAssessment = {
  assessment_id: 'g1',
  cargo_class: 'pharma',
  event_id: 'e1',
  cumulative_exposure_score: 14,
  threshold: 12,
  risk_level: 'breach',
  recommended_action: 'claim_draft',
  claim_draft_id: null,
  reroute_suggestion: null,
};

const decision: AgentDecision = {
  decision_id: 'd1',
  event_id: 'e1',
  inputs: { compliance_record_id: 'c1', cargo_assessment_id: 'g1' },
  confidence: 0.9,
  action_tier: 'draft',
  rationale: 'test rationale',
  timestamp: '2026-08-18T14:00:10.000Z',
};

describe('buildWebhookPayload', () => {
  it('carries the version and every referenced object', () => {
    const payload = buildWebhookPayload({
      thermal_event: event,
      compliance_record: compliance,
      cargo_assessment: cargo,
      decision,
      now: () => new Date('2026-08-18T14:00:11.000Z'),
    });
    assert.equal(payload.version, WEBHOOK_CONTRACT_VERSION);
    assert.equal(payload.event, 'agent_decision');
    assert.equal(payload.thermal_event, event);
    assert.equal(payload.compliance_record, compliance);
    assert.equal(payload.cargo_assessment, cargo);
    assert.equal(payload.decision, decision);
    assert.equal(payload.delivered_at, '2026-08-18T14:00:11.000Z');
  });
});

describe('HttpWebhookEmitter', () => {
  it('is a documented no-op with no URL configured, not a silent failure', async () => {
    const emitter = new HttpWebhookEmitter(null);
    const payload = buildWebhookPayload({
      thermal_event: event,
      compliance_record: compliance,
      cargo_assessment: cargo,
      decision,
    });
    const result = await emitter.emit(payload);
    assert.equal(result.delivered, false);
    assert.match(result.error ?? '', /no webhook URL configured/i);
  });

  it('POSTs the payload as JSON when a URL is configured', async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    const fakeFetch = ((url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return Promise.resolve(new Response(null, { status: 200 }));
    }) as typeof fetch;

    const emitter = new HttpWebhookEmitter('https://tms.example.com/hooks/threshold', fakeFetch);
    const payload = buildWebhookPayload({
      thermal_event: event,
      compliance_record: compliance,
      cargo_assessment: cargo,
      decision,
    });
    const result = await emitter.emit(payload);

    assert.equal(result.delivered, true);
    assert.equal(result.status, 200);
    assert.equal(capturedUrl, 'https://tms.example.com/hooks/threshold');
    assert.equal(capturedInit?.method, 'POST');
    assert.equal(
      (capturedInit?.headers as Record<string, string>)['content-type'],
      'application/json',
    );
    const sent = JSON.parse(capturedInit?.body as string) as { decision: { decision_id: string } };
    assert.equal(sent.decision.decision_id, 'd1');
  });

  it('reports delivery failure without throwing when the network call rejects', async () => {
    const failingFetch = (() => Promise.reject(new Error('ECONNREFUSED'))) as typeof fetch;
    const emitter = new HttpWebhookEmitter('https://unreachable.example.com', failingFetch);
    const payload = buildWebhookPayload({
      thermal_event: event,
      compliance_record: compliance,
      cargo_assessment: cargo,
      decision,
    });
    const result = await emitter.emit(payload);
    assert.equal(result.delivered, false);
    assert.match(result.error ?? '', /ECONNREFUSED/);
  });
});

describe('RecordingWebhookEmitter', () => {
  it('records every delivery for inspection', async () => {
    const emitter = new RecordingWebhookEmitter();
    const payload = buildWebhookPayload({
      thermal_event: event,
      compliance_record: compliance,
      cargo_assessment: cargo,
      decision,
    });
    await emitter.emit(payload);
    assert.equal(emitter.deliveries.length, 1);
    assert.equal(emitter.deliveries[0], payload);
  });
});
