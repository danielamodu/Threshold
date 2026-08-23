/**
 * GET /api/audit returns a flat, append-only list of every entry_type — this
 * groups them back into "one event -> driver action + cargo action +
 * decision" the way the demo pipeline's in-process result already is,
 * because nothing upstream does this for persisted, real audit_log rows.
 */
import type { ApiAuditEntry } from "./api";

export interface GroupedDecision {
  event_id: string;
  route_id: string | null;
  occurred_at: string | null;
  seq: number;
  thermal?: { temp_c: number; humidity_pct: number | null; data_quality: string };
  compliance?: { action: string; heat_index_c: number | null; exported_pdf_url: string | null; driver_id: string | null };
  cargo?: {
    risk_level: string;
    recommended_action: string;
    cumulative_exposure_score: number;
    threshold: number;
    claim_draft_id: string | null;
    cargo_class: string | null;
  };
  decision?: { action_tier: string; confidence: number; rationale: string };
  /**
   * The persisted Phase 4 claim draft (§11). Distinct from `cargo.claim_draft_id`,
   * which is only the id the assessment carries — this is the draft row itself,
   * and it is the only place a durable PDF link for the claim exists.
   */
  claim?: {
    claim_draft_id: string;
    exported_pdf_url: string | null;
    incident_summary: string;
    estimated_loss_note: string;
    generated_at: string;
  };
}

export function groupAuditByEvent(entries: ApiAuditEntry[]): GroupedDecision[] {
  const map = new Map<string, GroupedDecision>();
  for (const e of entries) {
    const existing = map.get(e.event_id);
    const g: GroupedDecision = existing ?? {
      event_id: e.event_id,
      route_id: e.route_id,
      occurred_at: e.occurred_at,
      seq: e.seq,
    };
    if (e.entry_type === "thermal_exposure_event") {
      g.thermal = {
        temp_c: e.payload.temp_c as number,
        humidity_pct: e.payload.humidity_pct as number | null,
        data_quality: e.payload.data_quality as string,
      };
    } else if (e.entry_type === "compliance_record") {
      g.compliance = {
        action: e.payload.action as string,
        heat_index_c: e.payload.heat_index_c as number | null,
        exported_pdf_url: (e.payload.exported_pdf_url as string | null) ?? null,
        // §3 ComplianceRecord carries driver_id; the driver-scoped views read
        // it from here rather than calling /api/routes, which the permission
        // matrix does not grant the driver role at all.
        driver_id: (e.payload.driver_id as string | null) ?? null,
      };
    } else if (e.entry_type === "cargo_risk_assessment") {
      g.cargo = {
        risk_level: e.payload.risk_level as string,
        recommended_action: e.payload.recommended_action as string,
        cumulative_exposure_score: e.payload.cumulative_exposure_score as number,
        threshold: e.payload.threshold as number,
        claim_draft_id: (e.payload.claim_draft_id as string | null) ?? null,
        cargo_class: (e.payload.cargo_class as string | null) ?? null,
      };
    } else if (e.entry_type === "agent_decision") {
      g.decision = {
        action_tier: e.payload.action_tier as string,
        confidence: e.payload.confidence as number,
        rationale: e.payload.rationale as string,
      };
    } else if (e.entry_type === "claim_draft") {
      g.claim = {
        claim_draft_id: e.payload.claim_draft_id as string,
        exported_pdf_url: (e.payload.exported_pdf_url as string | null) ?? null,
        incident_summary: e.payload.incident_summary as string,
        estimated_loss_note: e.payload.estimated_loss_note as string,
        generated_at: e.payload.generated_at as string,
      };
    }
    map.set(e.event_id, g);
  }
  return Array.from(map.values()).sort((a, b) => b.seq - a.seq);
}
