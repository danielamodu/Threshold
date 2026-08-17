import { strict as assert } from 'node:assert';
import { beforeEach, describe, it } from 'node:test';
import { assertValid, validateAgentDecision } from '@threshold/types';
import type { CargoRiskAssessment, ComplianceRecord } from '@threshold/types';
import { HardCodedThresholdDecider, MismatchedEventError } from '../src/fallback.js';

let counter = 0;
function uuid(): string {
  return `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
}
const SHARED_EVENT_ID = '11111111-1111-4111-8111-111111111111';

function compliance(overrides: Partial<ComplianceRecord> = {}): ComplianceRecord {
  return {
    record_id: uuid(),
    driver_id: 'driver-42',
    event_id: SHARED_EVENT_ID,
    heat_index_c: 30,
    action: 'none',
    schedule: [],
    generated_at: '2026-08-17T14:05:00.000Z',
    exported_pdf_url: null,
    ...overrides,
  };
}

function cargo(overrides: Partial<CargoRiskAssessment> = {}): CargoRiskAssessment {
  return {
    assessment_id: uuid(),
    cargo_class: 'pharma',
    event_id: SHARED_EVENT_ID,
    cumulative_exposure_score: 0,
    threshold: 12,
    risk_level: 'nominal',
    recommended_action: 'none',
    claim_draft_id: null,
    reroute_suggestion: null,
    ...overrides,
  };
}

function decider(allowAutoExecute = false) {
  return new HardCodedThresholdDecider({
    allowAutoExecute,
    newId: uuid,
    now: () => new Date('2026-08-17T14:06:00.000Z'),
  });
}

describe('HardCodedThresholdDecider (§9 Phase 3 fallback)', () => {
  beforeEach(() => (counter = 0));

  it('produces a §3-valid AgentDecision', () => {
    const { decision } = decider().decide(compliance(), cargo());
    assertValid('AgentDecision', validateAgentDecision(decision));
  });

  it('references the actual record ids, not the event id', () => {
    const c = compliance();
    const g = cargo();
    const { decision } = decider().decide(c, g);
    assert.equal(decision.inputs.compliance_record_id, c.record_id);
    assert.equal(decision.inputs.cargo_assessment_id, g.assessment_id);
    assert.equal(decision.event_id, c.event_id);
  });

  describe('action_tier — worst-of-two, capped at draft by default', () => {
    it('both nominal: alert', () => {
      const { decision } = decider().decide(
        compliance({ action: 'none' }),
        cargo({ risk_level: 'nominal' }),
      );
      assert.equal(decision.action_tier, 'alert');
    });

    it('one side mid, other low: still alert — neither reached the top', () => {
      const { decision } = decider().decide(
        compliance({ action: 'rest_break_scheduled' }),
        cargo({ risk_level: 'nominal' }),
      );
      assert.equal(decision.action_tier, 'alert');
    });

    it('compliance at its worst alone: draft, not auto_execute', () => {
      const { decision } = decider().decide(
        compliance({ action: 'work_limit_reduced' }),
        cargo({ risk_level: 'nominal' }),
      );
      assert.equal(decision.action_tier, 'draft');
    });

    it('cargo at its worst alone: draft, not auto_execute', () => {
      const { decision } = decider().decide(
        compliance({ action: 'none' }),
        cargo({ risk_level: 'breach' }),
      );
      assert.equal(decision.action_tier, 'draft');
    });

    it('BOTH at their worst, allowAutoExecute false (the default): still capped at draft', () => {
      const { decision } = decider(false).decide(
        compliance({ action: 'work_limit_reduced' }),
        cargo({ risk_level: 'breach' }),
      );
      assert.equal(decision.action_tier, 'draft');
    });

    it('BOTH at their worst, allowAutoExecute explicitly true: auto_execute', () => {
      const { decision } = decider(true).decide(
        compliance({ action: 'work_limit_reduced' }),
        cargo({ risk_level: 'breach' }),
      );
      assert.equal(decision.action_tier, 'auto_execute');
    });

    it('only ONE side at its worst, even with allowAutoExecute true: draft, not auto_execute', () => {
      // auto_execute requires BOTH evaluators to independently concur at the
      // top — a single severe signal is not enough even when the flag is on.
      const { decision } = decider(true).decide(
        compliance({ action: 'work_limit_reduced' }),
        cargo({ risk_level: 'elevated' }),
      );
      assert.equal(decision.action_tier, 'draft');
    });
  });

  describe('confidence — agreement between the two evaluators, not a model score', () => {
    it('is high when both sides land on the same severity', () => {
      const { decision, split } = decider().decide(
        compliance({ action: 'rest_break_scheduled' }),
        cargo({ risk_level: 'elevated' }),
      );
      assert.equal(decision.confidence, 0.9);
      assert.equal(split, false);
    });

    it('is moderate when the two sides are one rank apart', () => {
      const { decision, split } = decider().decide(
        compliance({ action: 'none' }),
        cargo({ risk_level: 'elevated' }),
      );
      assert.equal(decision.confidence, 0.7);
      assert.equal(split, false);
    });

    it('is low and flagged split when the two sides are two ranks apart', () => {
      const { decision, split } = decider().decide(
        compliance({ action: 'none' }),
        cargo({ risk_level: 'breach' }),
      );
      assert.equal(decision.confidence, 0.5);
      assert.equal(split, true);
    });

    it('stays within 0..1 across the full severity matrix', () => {
      const actions: ComplianceRecord['action'][] = ['none', 'rest_break_scheduled', 'work_limit_reduced'];
      const levels: CargoRiskAssessment['risk_level'][] = ['nominal', 'elevated', 'breach'];
      for (const action of actions) {
        for (const risk_level of levels) {
          const { decision } = decider().decide(compliance({ action }), cargo({ risk_level }));
          assert.ok(decision.confidence >= 0 && decision.confidence <= 1);
        }
      }
    });
  });

  describe('rationale — readable by a stranger without explanation', () => {
    it('is always a non-empty string, across the full severity matrix', () => {
      // This is also what the audit_log check constraint requires.
      const actions: ComplianceRecord['action'][] = ['none', 'rest_break_scheduled', 'work_limit_reduced'];
      const levels: CargoRiskAssessment['risk_level'][] = ['nominal', 'elevated', 'breach'];
      for (const action of actions) {
        for (const risk_level of levels) {
          const { decision } = decider().decide(compliance({ action }), cargo({ risk_level }));
          assert.ok(decision.rationale.trim().length > 0);
        }
      }
    });

    it('cites the concrete numbers from both records, not just labels', () => {
      const { decision } = decider().decide(
        compliance({ action: 'work_limit_reduced', heat_index_c: 46.2 }),
        cargo({ risk_level: 'breach', cumulative_exposure_score: 14.5, threshold: 12, cargo_class: 'pharma' }),
      );
      assert.match(decision.rationale, /46\.2/);
      assert.match(decision.rationale, /14\.5/);
      assert.match(decision.rationale, /12/);
      assert.match(decision.rationale, /pharma/);
    });

    it('states plainly that this is a rule, not a model', () => {
      const { decision } = decider().decide(compliance(), cargo());
      assert.match(decision.rationale, /hard-coded-threshold decision \(no model involved\)/i);
    });

    it('explains the degraded-humidity case without inventing a heat index', () => {
      const { decision } = decider().decide(
        compliance({ action: 'work_limit_reduced', heat_index_c: null }),
        cargo({ risk_level: 'nominal' }),
      );
      assert.match(decision.rationale, /heat index unavailable/i);
      assert.doesNotMatch(decision.rationale, /heat index null/i);
    });

    it('names the split explicitly when the two evaluators disagree sharply', () => {
      const { decision } = decider().decide(
        compliance({ action: 'work_limit_reduced' }),
        cargo({ risk_level: 'nominal' }),
      );
      assert.match(decision.rationale, /disagree sharply/i);
    });
  });

  it('refuses to combine records from two different events', () => {
    assert.throws(
      () => decider().decide(compliance({ event_id: 'event-a' }), cargo({ event_id: 'event-b' })),
      MismatchedEventError,
    );
  });

  it('is deterministic given injected id/time factories', () => {
    const a = decider().decide(compliance(), cargo());
    counter = 0;
    const b = decider().decide(compliance(), cargo());
    assert.deepEqual(a.decision, b.decision);
  });
});
