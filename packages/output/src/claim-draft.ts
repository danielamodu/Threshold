/**
 * Claim Draft Generator (§2, §6 Phase 4).
 *
 *   "Claim Draft Generator — structured claim payload for the cargo side...
 *    doesn't need a real insurer integration."
 *
 * The SHAPE is not declared here. `ClaimDraft` lives in @threshold/types
 * alongside the audit envelope that carries it, because that package is the
 * wire contract's source of truth and `AuditPayload` has to name it. This file
 * owns only how one is built. See that type's header for why it is ⚠ PROPOSED
 * rather than a §3 contract, and for the reasoning behind
 * `estimated_loss_value`.
 *
 * Deliberately does NOT invent a dollar figure. Nothing in this system
 * carries cargo valuation data (no manifest value, no insured amount
 * anywhere in §3), so `estimated_loss_value` stays `null` with an explicit
 * note rather than a fabricated number — presenting a made-up figure on a
 * document titled "claim draft" would be actively wrong, not just
 * incomplete.
 */

import { randomUUID } from 'node:crypto';
import type { CargoRiskAssessment, ClaimDraft } from '@threshold/types';

export interface ClaimDraftOptions {
  newId?: () => string;
  now?: () => Date;
}

/**
 * Only called when `recommended_action === 'claim_draft'` (i.e. a breach) —
 * mirrors the exit condition's framing of "one single heat-spike event
 * produces both a real compliance PDF and a real claim draft," not an
 * artifact for every nominal reading.
 */
export function generateClaimDraft(
  assessment: CargoRiskAssessment,
  route_id: string,
  options: ClaimDraftOptions = {},
): ClaimDraft {
  const newId = options.newId ?? randomUUID;
  const now = options.now ?? (() => new Date());

  const over = Math.round((assessment.cumulative_exposure_score - assessment.threshold) * 100) / 100;

  return {
    claim_draft_id: newId(),
    assessment_id: assessment.assessment_id,
    event_id: assessment.event_id,
    route_id,
    cargo_class: assessment.cargo_class,
    risk_level: assessment.risk_level,
    cumulative_exposure_score: assessment.cumulative_exposure_score,
    threshold: assessment.threshold,
    incident_summary:
      `${assessment.cargo_class} cargo on route ${route_id} exceeded its breach threshold: ` +
      `${assessment.cumulative_exposure_score} degree-hours of cumulative ambient exposure against a ` +
      `threshold of ${assessment.threshold} (${over > 0 ? `${over} over` : 'at'}). Full exposure ` +
      `history for this event is recorded in the audit log under event_id ${assessment.event_id}.`,
    estimated_loss_value: null,
    estimated_loss_note:
      'Not available — this system has no cargo valuation or manifest-value data. A real claim ' +
      'requires that figure from an external source; this draft covers only the exposure evidence.',
    generated_at: now().toISOString(),
    exported_pdf_url: null,
  };
}
