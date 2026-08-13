-- Threshold — Audit Layer (§2 of thermal-liability-architecture.md)
--
--   "Append-only Postgres log of every event, evaluation, and agent decision.
--    Non-negotiable for a liability product."
--
-- Design notes:
--   * ONE table, not three. §2 specifies a single log; a single monotonic `seq`
--     is what lets Phase 1 assert "logged, in order" across mixed entry types,
--     which three sibling tables could not do without a join and a merge sort.
--   * The §3 contract objects are stored unmodified in `payload` (jsonb). The
--     surrounding columns are envelope/index only — they never restate a field
--     in a way that could drift from §3.
--   * Append-only is enforced twice: by trigger (applies even to the table
--     owner) and by privilege revocation. Only a superuser explicitly disabling
--     triggers can defeat it.

create extension if not exists pgcrypto;

create table public.audit_log (
  -- Monotonic insertion order. This is the ordering guarantee, not `recorded_at`,
  -- which can tie under concurrent writes.
  seq         bigint generated always as identity primary key,
  entry_id    uuid not null default gen_random_uuid(),

  entry_type  text not null,

  -- Correlation key. Every §3 contract carries an `event_id`, so one heat event
  -- and both of its liability responses share a value here. This column is what
  -- makes "one event → two responses" queryable, which is the core insight (§1).
  event_id    uuid not null,
  route_id    text,

  -- The §3 contract object, verbatim.
  payload     jsonb not null,

  -- §2: "Every decision writes a rationale string to the audit log — this is
  -- what makes the output defensible as actual liability documentation."
  rationale   text,

  -- The contract's own timestamp / generated_at, when it has one.
  occurred_at timestamptz,
  -- Server-side write time.
  recorded_at timestamptz not null default now(),

  constraint audit_log_entry_id_key unique (entry_id),

  constraint audit_log_entry_type_check check (
    entry_type in (
      'thermal_exposure_event',
      'compliance_record',
      'cargo_risk_assessment',
      'agent_decision'
    )
  ),

  constraint audit_log_payload_is_object check (jsonb_typeof(payload) = 'object'),

  -- An agent decision without a rationale is not auditable, so the database
  -- refuses to store one.
  constraint audit_log_decision_requires_rationale check (
    entry_type <> 'agent_decision'
    or (rationale is not null and length(btrim(rationale)) > 0)
  )
);

comment on table public.audit_log is
  'Append-only liability audit log (§2). Every event, evaluation, and agent decision. UPDATE/DELETE/TRUNCATE are blocked by trigger.';
comment on column public.audit_log.seq is
  'Monotonic insertion order — the "logged, in order" guarantee.';
comment on column public.audit_log.event_id is
  'Correlation key joining a ThermalExposureEvent to every downstream evaluation and decision.';
comment on column public.audit_log.payload is
  'The §3 contract object, stored verbatim.';

create index audit_log_event_id_idx on public.audit_log (event_id);
create index audit_log_entry_type_idx on public.audit_log (entry_type);
create index audit_log_recorded_at_idx on public.audit_log (recorded_at desc);
create index audit_log_route_id_idx on public.audit_log (route_id) where route_id is not null;

-- ---------------------------------------------------------------------------
-- Append-only enforcement
-- ---------------------------------------------------------------------------

create or replace function public.audit_log_reject_mutation()
returns trigger
language plpgsql
as $$
begin
  -- Statement-level TRUNCATE triggers have no OLD row, so handle it first.
  if tg_op = 'TRUNCATE' then
    raise exception 'audit_log is append-only: TRUNCATE denied'
      using errcode = '42501';
  end if;

  raise exception 'audit_log is append-only: % denied on seq=%', tg_op, old.seq
    using errcode = '42501';
end;
$$;

comment on function public.audit_log_reject_mutation() is
  'Blocks UPDATE/DELETE/TRUNCATE on audit_log. Applies to the table owner too.';

create trigger audit_log_no_update
  before update on public.audit_log
  for each row execute function public.audit_log_reject_mutation();

create trigger audit_log_no_delete
  before delete on public.audit_log
  for each row execute function public.audit_log_reject_mutation();

create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function public.audit_log_reject_mutation();

-- ---------------------------------------------------------------------------
-- Privileges — belt and braces alongside the triggers above.
-- ---------------------------------------------------------------------------

revoke update, delete, truncate on public.audit_log from public;
revoke update, delete, truncate on public.audit_log from anon, authenticated, service_role;

grant select, insert on public.audit_log to authenticated, service_role;
-- `anon` may read for the judge-facing dashboard (§2) but never write.
grant select on public.audit_log to anon;

alter table public.audit_log enable row level security;

-- Only SELECT and INSERT policies exist. With RLS on, the absence of UPDATE and
-- DELETE policies denies those operations independently of the triggers.
create policy audit_log_select on public.audit_log
  for select to anon, authenticated, service_role
  using (true);

create policy audit_log_insert on public.audit_log
  for insert to authenticated, service_role
  with check (true);
