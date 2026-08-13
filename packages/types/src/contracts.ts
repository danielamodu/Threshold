/**
 * Data contracts — a verbatim mirror of §3 of `thermal-liability-architecture.md`.
 *
 * RULE: this file is a mirror, not a design surface. Field names, unions, and
 * nullability here must match §3 exactly. If a real upstream payload disagrees
 * with these shapes, that is a stop-and-report moment (§10) — reconcile the spec
 * first, then change this file. Do not silently adapt.
 */

/** ISO8601 timestamp string, e.g. `2026-08-13T14:00:00Z`. */
export type ISO8601 = string;

/** RFC 4122 UUID string. */
export type UUID = string;

/** §3 — shared across WaypointTelemetry and CargoRiskAssessment. */
export type CargoClass = 'pharma' | 'produce' | 'general_reefer';

/** WaypointTelemetry — ingestion */
export interface WaypointTelemetry {
  route_id: string;
  waypoint_id: string;
  lat: number;
  lng: number;
  timestamp: ISO8601;
  forecasted_temp_c: number;
  humidity_pct: number;
  cargo_class: CargoClass;
  driver_id: string;
}

/** ThermalExposureEvent — canonical event on the bus */
export interface ThermalExposureEvent {
  event_id: UUID;
  route_id: string;
  waypoint_id: string;
  temp_c: number;
  heat_index_c: number;
  humidity_pct: number;
  timestamp: ISO8601;
  source: 'fortyguard_api';
}

/** §3 — ComplianceRecord.action */
export type ComplianceAction = 'rest_break_scheduled' | 'work_limit_reduced' | 'none';

/** §3 — ComplianceRecord.schedule[].type */
export type ComplianceScheduleType = 'rest' | 'reduced_load';

/** §3 — one entry of ComplianceRecord.schedule */
export interface ComplianceScheduleEntry {
  start: ISO8601;
  end: ISO8601;
  type: ComplianceScheduleType;
}

/** ComplianceRecord — human module output */
export interface ComplianceRecord {
  record_id: UUID;
  driver_id: string;
  event_id: UUID;
  heat_index_c: number;
  action: ComplianceAction;
  schedule: ComplianceScheduleEntry[];
  generated_at: ISO8601;
  exported_pdf_url: string | null;
}

/** §3 — CargoRiskAssessment.risk_level */
export type CargoRiskLevel = 'nominal' | 'elevated' | 'breach';

/** §3 — CargoRiskAssessment.recommended_action */
export type CargoRecommendedAction = 'none' | 'reroute' | 'claim_draft';

/** CargoRiskAssessment — cargo module output */
export interface CargoRiskAssessment {
  assessment_id: UUID;
  cargo_class: CargoClass;
  event_id: UUID;
  cumulative_exposure_score: number;
  threshold: number;
  risk_level: CargoRiskLevel;
  recommended_action: CargoRecommendedAction;
  claim_draft_id: UUID | null;
  /** §3 declares this as `object | null`; shape is defined in Phase 4. */
  reroute_suggestion: Record<string, unknown> | null;
}

/** §3 — AgentDecision.action_tier */
export type AgentActionTier = 'alert' | 'draft' | 'auto_execute';

/** §3 — AgentDecision.inputs */
export interface AgentDecisionInputs {
  compliance_record_id: UUID;
  cargo_assessment_id: UUID;
}

/** AgentDecision — decision layer output, drives audit trail */
export interface AgentDecision {
  decision_id: UUID;
  event_id: UUID;
  inputs: AgentDecisionInputs;
  confidence: number;
  action_tier: AgentActionTier;
  rationale: string;
  timestamp: ISO8601;
}
