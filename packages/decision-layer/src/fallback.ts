/**
 * Hard-coded-threshold fallback decision path (§6/§9 Phase 3, item 1 of 3).
 *
 *   "Build the hard-coded-threshold fallback path now, not as a last-minute
 *    rescue — this is the safety net if the agent layer doesn't land in
 *    time... if this phase slips, you degrade to the fallback and move on."
 *
 * ── Scope ─────────────────────────────────────────────────────────────────
 * This file is ONLY the fallback (§9 Phase 3 items 1 and 3). The LLM
 * orchestrator — item 2, reading both evaluator outputs via Claude or Gemini
 * — is a separate, still-open decision per §10 ("which LLM API powers the
 * Phase 3 agent layer") and is deliberately not built here. Building it ahead
 * of that call would mean throwing away work the moment the decision lands
 * the other way.
 *
 * ── Confidence is not a model score ──────────────────────────────────────
 * There is no model here, so "confidence" cannot mean predictive uncertainty.
 * It is instead a deterministic measure of how much the two INDEPENDENT
 * evaluators agree: concordant severities (both low, both high, ...) are
 * reported with high confidence; a split verdict — driver fine but cargo
 * already breached from earlier exposure, or vice versa — is reported with
 * low confidence, because a rule combining two disagreeing signals is
 * genuinely less certain than one combining two that agree. That is an
 * honest, explainable signal properly grounded in what the rule actually
 * knows, not manufactured precision dressed up as a probability.
 *
 * ── auto_execute stays capped by default ─────────────────────────────────
 * §10 leaves "whether the agent layer ships as auto-execute-capable" as an
 * open call. A hard-coded rule — no model, no human in the loop — reaching
 * for autonomous action by default would be answering that question
 * silently, which is exactly what was asked not to happen. `allowAutoExecute`
 * defaults to false; the rule is fully capable of reaching that tier the
 * moment the flag is flipped, once the call is actually made.
 */

import { randomUUID } from 'node:crypto';
import type {
  AgentActionTier,
  AgentDecision,
  CargoRiskAssessment,
  ComplianceRecord,
} from '@threshold/types';
import { cargoSeverity, complianceSeverity, higher, rank, type SeverityBucket } from './severity.js';

export interface FallbackDecisionOptions {
  /** Defaults to false — see the file header. */
  allowAutoExecute?: boolean;
  newId?: () => string;
  now?: () => Date;
}

export interface FallbackDecisionResult {
  decision: AgentDecision;
  complianceSeverity: SeverityBucket;
  cargoSeverity: SeverityBucket;
  /** True when the two evaluators landed two ranks apart (low vs high). */
  split: boolean;
}

export class MismatchedEventError extends Error {
  constructor(complianceEventId: string, cargoEventId: string) {
    super(
      `Cannot combine a ComplianceRecord for event ${complianceEventId} with a ` +
        `CargoRiskAssessment for event ${cargoEventId} — the Agent Decision Layer ` +
        `only ever reasons about both responses to the SAME event (§2).`,
    );
    this.name = 'MismatchedEventError';
  }
}

export class HardCodedThresholdDecider {
  private readonly allowAutoExecute: boolean;
  private readonly newId: () => string;
  private readonly now: () => Date;

  constructor(options: FallbackDecisionOptions = {}) {
    this.allowAutoExecute = options.allowAutoExecute ?? false;
    this.newId = options.newId ?? randomUUID;
    this.now = options.now ?? (() => new Date());
  }

  decide(compliance: ComplianceRecord, cargo: CargoRiskAssessment): FallbackDecisionResult {
    if (compliance.event_id !== cargo.event_id) {
      throw new MismatchedEventError(compliance.event_id, cargo.event_id);
    }

    const human = complianceSeverity(compliance.action);
    const cargoSev = cargoSeverity(cargo.risk_level);
    const worst = higher(human, cargoSev);
    const rankGap = Math.abs(rank(human) - rank(cargoSev));
    const split = rankGap >= 2;

    // Agreement is the whole confidence model — see the file header.
    const confidence = rankGap === 0 ? 0.9 : rankGap === 1 ? 0.7 : 0.5;

    const action_tier: AgentActionTier =
      worst !== 'high'
        ? 'alert'
        : human === 'high' && cargoSev === 'high' && this.allowAutoExecute
          ? 'auto_execute'
          : 'draft';

    const rationale = buildRationale({
      compliance,
      cargo,
      human,
      cargoSev,
      action_tier,
      confidence,
      split,
    });

    const decision: AgentDecision = {
      decision_id: this.newId(),
      event_id: compliance.event_id,
      inputs: {
        compliance_record_id: compliance.record_id,
        cargo_assessment_id: cargo.assessment_id,
      },
      confidence,
      action_tier,
      rationale,
      timestamp: this.now().toISOString(),
    };

    return { decision, complianceSeverity: human, cargoSeverity: cargoSev, split };
  }
}

interface RationaleInput {
  compliance: ComplianceRecord;
  cargo: CargoRiskAssessment;
  human: SeverityBucket;
  cargoSev: SeverityBucket;
  action_tier: AgentActionTier;
  confidence: number;
  split: boolean;
}

/**
 * Builds the rationale a stranger has to be able to read and understand
 * without anyone explaining it (§6/§9 Phase 3 exit condition). Deliberately
 * cites only fields present on the two audited §3 records — see the file
 * header on why the severity buckets themselves are computed that way.
 */
function buildRationale(input: RationaleInput): string {
  const { compliance, cargo, human, cargoSev, action_tier, confidence, split } = input;

  const humanPart =
    compliance.heat_index_c === null
      ? `the driver side scheduled "${compliance.action}" (heat index unavailable; humidity was ` +
        `missing for this reading, so a conservative dry-bulb rule was used instead) — ${human} severity`
      : `the driver side scheduled "${compliance.action}" (heat index ${compliance.heat_index_c}°C) — ${human} severity`;

  const cargoPart =
    `the cargo side reports "${cargo.risk_level}" ` +
    `(${cargo.cumulative_exposure_score}/${cargo.threshold} °C·h cumulative exposure for ` +
    `${cargo.cargo_class}) — ${cargoSev} severity`;

  const tierPart =
    action_tier === 'alert'
      ? 'Neither side has reached its most severe level, so this stays at alert only — logged, no drafted action.'
      : action_tier === 'draft'
        ? 'At least one side reached its most severe level, so this is escalated to a draft response for a human to review before anything is sent.'
        : 'Both sides independently reached their most severe level, so this is escalated to auto-execute.';

  const agreementPart = split
    ? `The two evaluators disagree sharply here (one low, one high), which is itself worth a ` +
      `reviewer's attention — confidence is reported low (${confidence}) to reflect that split ` +
      `rather than overstating certainty in a combined call.`
    : confidence >= 0.9
      ? `The two evaluators agree closely, so this combined call is reported with high confidence (${confidence}).`
      : `The two evaluators are one severity level apart, so this combined call is reported with ` +
        `moderate confidence (${confidence}).`;

  return (
    `This is a hard-coded-threshold decision (no model involved): ${humanPart}; ${cargoPart}. ` +
    `${tierPart} ${agreementPart}`
  );
}
