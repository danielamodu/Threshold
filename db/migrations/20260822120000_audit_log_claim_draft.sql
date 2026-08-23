-- Threshold — additive audit_log entry type: `claim_draft` (§11 follow-up)
--
-- WHY THIS EXISTS
-- Phase 4 already generates a real claim-draft PDF for every breach
-- (packages/pipeline/src/risk-pipeline.ts, cargo-risk subscriber) and folds
-- its URL onto the draft as `exported_pdf_url`. That draft was then only ever
-- a PipelineResult return value held in memory — nothing persisted it, so
-- there was no durable, queryable link to the PDF once the run ended. The
-- Claims surface therefore had to say "not yet generated" about a document
-- that genuinely existed. This lands the fifth entry type so the draft is
-- recorded next to the assessment that produced it.
--
-- STRICTLY ADDITIVE — the standing rule on Phase 0-6 code
-- The four entry types Phases 0-6 depend on are re-listed here byte-identical:
-- 'thermal_exposure_event', 'compliance_record', 'cargo_risk_assessment',
-- 'agent_decision'. No existing entry type is renamed, removed, or given new
-- required columns; no existing row is read, rewritten, or migrated; every
-- insert that was legal before this file is still legal after it. Postgres has
-- no `ALTER ... ADD VALUE` for a CHECK constraint, so widening one requires a
-- drop + re-add of the same constraint name. That pair is the mechanism for
-- adding a value, not a redefinition of the existing four — and it is
-- deliberately the whole of the change to that constraint.
--
-- The drop is unqualified (no IF EXISTS): if `audit_log_entry_type_check` is
-- somehow already absent, this migration must fail loudly inside its
-- transaction rather than quietly install a constraint whose predecessor was
-- something other than what this file assumes it is replacing.
--
-- NOT TOUCHED, deliberately:
--   * `audit_log_decision_requires_rationale` — still scoped to
--     'agent_decision' alone. A claim draft carries no rationale (the
--     narrative lives in `payload.incident_summary`), and widening the
--     rationale requirement to a new type would change what Phase 3's
--     decision rows mean.
--   * The append-only UPDATE/DELETE trigger and the privilege revocations.
--     DDL on a constraint does not touch either, and a `claim_draft` row is
--     as permanent as every other row here.
--   * §3 contract payloads. ClaimDraft is Phase 4's own shape (it is not a §3
--     contract), stored verbatim in `payload` like every other entry type —
--     the envelope columns stay exactly as they are.

alter table public.audit_log
  drop constraint audit_log_entry_type_check;

alter table public.audit_log
  add constraint audit_log_entry_type_check check (
    entry_type in (
      'thermal_exposure_event',
      'compliance_record',
      'cargo_risk_assessment',
      'agent_decision',
      'claim_draft'
    )
  );

comment on constraint audit_log_entry_type_check on public.audit_log is
  'The four §2 entry types (event, both evaluations, decision) plus claim_draft (§11) — the persisted Phase 4 claim-draft artifact, added additively.';
