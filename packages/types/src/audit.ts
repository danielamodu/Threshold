/**
 * Audit Layer types — derived from §2 ("Append-only Postgres log of every event,
 * evaluation, and agent decision"), NOT from §3.
 *
 * These describe the storage envelope around the §3 contracts. The contracts
 * themselves travel unmodified in `payload`.
 */

import type {
  AgentDecision,
  CargoClass,
  CargoRiskAssessment,
  CargoRiskLevel,
  ComplianceRecord,
  ISO8601,
  ThermalExposureEvent,
  UUID,
} from './contracts.js';

/**
 * ⚠ PROPOSED SHAPE — not defined by §3, same status the spoilage curves in
 * risk-engine carry: reasoned, not signed off. `CargoRiskAssessment.
 * claim_draft_id` is the only thing §3 itself locks down; this is Phase 4's
 * own design for what that id points at.
 *
 * ── This is the ONLY definition of this shape ────────────────────────────────
 * `packages/output/src/claim-draft.ts` generates the draft and imports this
 * type; it does not declare its own. It used to, and for a while two
 * structurally identical 13-field interfaces existed in parallel — one on the
 * wire (this one, in the audit envelope) and one at the generator. Nothing
 * caught the drift risk because they happened to match, which is exactly the
 * kind of duplication that silently stops matching. The type lives here
 * because this package is the wire contract's source of truth, and because
 * `AuditPayload` below has to name it while @threshold/types cannot depend on
 * @threshold/output (that would be circular).
 *
 * §11 product-shell wiring follow-up: added so a real, durable PDF link can
 * exist for a claim draft at all — previously generateClaimDraft()'s result
 * (exported_pdf_url included) was only ever a pipeline run's in-memory
 * return value, never persisted anywhere queryable.
 */
export interface ClaimDraft {
  claim_draft_id: string;
  assessment_id: string;
  event_id: string;
  route_id: string;
  cargo_class: CargoClass;
  risk_level: CargoRiskLevel;
  cumulative_exposure_score: number;
  threshold: number;
  incident_summary: string;
  /**
   * Deliberately null, always — nothing in this system carries cargo valuation
   * data (no manifest value, no insured amount anywhere in §3), and never
   * fabricated even as a placeholder: a made-up dollar figure on a document
   * titled "claim draft" would be actively wrong, not just incomplete. A real
   * insurer-facing figure has to come from a real manifest value.
   */
  estimated_loss_value: null;
  estimated_loss_note: string;
  generated_at: string;
  exported_pdf_url: string | null;
}

/**
 * The three things §2 requires be logged, plus `claim_draft` (§11 addition —
 * see ClaimDraft's header). `compliance_record` and `cargo_risk_assessment`
 * together are the "evaluation" case.
 */
export type AuditEntryType =
  | 'thermal_exposure_event'
  | 'compliance_record'
  | 'cargo_risk_assessment'
  | 'agent_decision'
  | 'claim_draft';

/** Discriminated union binding each entry type to its payload. */
export type AuditPayload =
  | { entry_type: 'thermal_exposure_event'; payload: ThermalExposureEvent }
  | { entry_type: 'compliance_record'; payload: ComplianceRecord }
  | { entry_type: 'cargo_risk_assessment'; payload: CargoRiskAssessment }
  | { entry_type: 'agent_decision'; payload: AgentDecision }
  | { entry_type: 'claim_draft'; payload: ClaimDraft };

/** A row as written. `seq` and `recorded_at` are assigned by Postgres. */
export type AuditLogEntry = AuditPayload & {
  /** Monotonic insertion order — the "in order" guarantee Phase 1 asserts. */
  seq: number;
  entry_id: UUID;
  /** Correlation key. Every §3 contract carries an `event_id`. */
  event_id: UUID;
  route_id: string | null;
  /**
   * Envelope column added by Phase 7's org-multitenancy migration (§11) —
   * never inside any §3 payload, same reasoning as `route_id`. Required, not
   * nullable: the database column is NOT NULL with no legacy rows to
   * reconcile (verified empty before that migration was written).
   */
  org_id: string;
  /** Human-readable justification. Required for `agent_decision` (§2). */
  rationale: string | null;
  /** The contract's own timestamp / generated_at. */
  occurred_at: ISO8601 | null;
  /** Server-side write time. */
  recorded_at: ISO8601;
};

/** The insertable shape — Postgres fills the rest. */
export type AuditLogInsert = AuditPayload & {
  event_id: UUID;
  route_id?: string | null;
  /** Required — see AuditLogEntry.org_id. Not optional: the DB rejects a missing one anyway. */
  org_id: string;
  rationale?: string | null;
  occurred_at?: ISO8601 | null;
};
