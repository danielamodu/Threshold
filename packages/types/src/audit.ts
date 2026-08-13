/**
 * Audit Layer types — derived from §2 ("Append-only Postgres log of every event,
 * evaluation, and agent decision"), NOT from §3.
 *
 * These describe the storage envelope around the §3 contracts. The contracts
 * themselves travel unmodified in `payload`.
 */

import type {
  AgentDecision,
  CargoRiskAssessment,
  ComplianceRecord,
  ISO8601,
  ThermalExposureEvent,
  UUID,
} from './contracts.js';

/**
 * The three things §2 requires be logged. `compliance_record` and
 * `cargo_risk_assessment` together are the "evaluation" case.
 */
export type AuditEntryType =
  | 'thermal_exposure_event'
  | 'compliance_record'
  | 'cargo_risk_assessment'
  | 'agent_decision';

/** Discriminated union binding each entry type to its §3 payload. */
export type AuditPayload =
  | { entry_type: 'thermal_exposure_event'; payload: ThermalExposureEvent }
  | { entry_type: 'compliance_record'; payload: ComplianceRecord }
  | { entry_type: 'cargo_risk_assessment'; payload: CargoRiskAssessment }
  | { entry_type: 'agent_decision'; payload: AgentDecision };

/** A row as written. `seq` and `recorded_at` are assigned by Postgres. */
export type AuditLogEntry = AuditPayload & {
  /** Monotonic insertion order — the "in order" guarantee Phase 1 asserts. */
  seq: number;
  entry_id: UUID;
  /** Correlation key. Every §3 contract carries an `event_id`. */
  event_id: UUID;
  route_id: string | null;
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
  rationale?: string | null;
  occurred_at?: ISO8601 | null;
};
