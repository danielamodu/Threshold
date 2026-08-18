import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { CargoRiskAssessment } from '@threshold/types';
import { generateClaimDraft } from '../src/claim-draft.js';

function assessment(overrides: Partial<CargoRiskAssessment> = {}): CargoRiskAssessment {
  return {
    assessment_id: '11111111-1111-4111-8111-111111111111',
    cargo_class: 'pharma',
    event_id: '22222222-2222-4222-8222-222222222222',
    cumulative_exposure_score: 14.5,
    threshold: 12,
    risk_level: 'breach',
    recommended_action: 'claim_draft',
    claim_draft_id: null,
    reroute_suggestion: null,
    ...overrides,
  };
}

describe('generateClaimDraft', () => {
  it('links back to the source assessment and event', () => {
    const draft = generateClaimDraft(assessment(), 'route-a', { newId: () => 'draft-1' });
    assert.equal(draft.claim_draft_id, 'draft-1');
    assert.equal(draft.assessment_id, '11111111-1111-4111-8111-111111111111');
    assert.equal(draft.event_id, '22222222-2222-4222-8222-222222222222');
    assert.equal(draft.route_id, 'route-a');
  });

  it('never fabricates a loss value', () => {
    const draft = generateClaimDraft(assessment(), 'route-a');
    assert.equal(draft.estimated_loss_value, null);
    assert.match(draft.estimated_loss_note, /not available/i);
    assert.match(draft.estimated_loss_note, /no cargo valuation/i);
  });

  it('summarises the actual exposure numbers, not placeholder text', () => {
    const draft = generateClaimDraft(
      assessment({ cumulative_exposure_score: 14.5, threshold: 12, cargo_class: 'pharma' }),
      'route-a',
    );
    assert.match(draft.incident_summary, /14\.5/);
    assert.match(draft.incident_summary, /12/);
    assert.match(draft.incident_summary, /pharma/);
    assert.match(draft.incident_summary, /2\.5 over/); // 14.5 - 12
  });

  it('has a generated_at timestamp from the injected clock', () => {
    const draft = generateClaimDraft(assessment(), 'route-a', {
      now: () => new Date('2026-08-18T12:00:00.000Z'),
    });
    assert.equal(draft.generated_at, '2026-08-18T12:00:00.000Z');
  });

  it('starts with no PDF attached — that is filled in by the caller', () => {
    const draft = generateClaimDraft(assessment(), 'route-a');
    assert.equal(draft.exported_pdf_url, null);
  });
});
