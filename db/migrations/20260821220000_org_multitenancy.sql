-- Threshold — Phase 7: Accounts & Multi-tenancy (§11)
--
-- Every route, driver, and audit record now belongs to an org. The critical
-- design constraint, signed off before this was written: org_id lives ONLY at
-- this storage envelope — it is never added to any §3 JSON contract
-- (WaypointTelemetry, ThermalExposureEvent, ComplianceRecord,
-- CargoRiskAssessment, AgentDecision all stay byte-identical). This mirrors
-- how `audit_log.route_id` already works today: an indexed envelope column
-- sitting next to `payload`, never inside it, so envelope fields can never
-- drift from the locked §3 shapes. Phases 0-6 are untouched by this file.
--
-- `orgs.id` is `text`, not `uuid`, and deliberately NOT `gen_random_uuid()` —
-- it is meant to hold Clerk's own organization id verbatim (Clerk ids look
-- like `org_2abc...`, not UUIDs). Storing Clerk's id directly as the primary
-- key avoids a separate id-mapping table between Clerk and Postgres.
--
-- `routes` is `RouteRegistry` (packages/risk-engine/src/route-context.ts)
-- promoted from an in-memory-only Map into real, persisted, org-scoped rows.
-- The in-memory RouteRegistry itself is untouched — @threshold/accounts adds
-- a PostgresRouteRegistry implementing the same RouteContextProvider
-- interface, so risk-engine's evaluators never learn Postgres exists.
--
-- audit_log.org_id is NOT NULL with no backfill step: verified empty (0 rows)
-- on live Neon before writing this migration, so there is no legacy data to
-- reconcile. Resolved at write time from the route the entry references,
-- application-enforced rather than a DB-level join, keeping the append-only
-- write path exactly as simple as it was before this migration.
--
-- Real Postgres RLS enforcing org boundaries is explicitly Phase 11's job,
-- not this one's — this migration lands the column and the foreign keys;
-- Phase 11 turns on the policy that makes crossing an org boundary
-- impossible at the database level, not just the application level.

create table public.orgs (
  id         text primary key,
  name       text not null,
  slug       text not null,
  created_at timestamptz not null default now(),

  constraint orgs_slug_key unique (slug)
);

comment on table public.orgs is
  'One row per Clerk organization. id is Clerk''s own org id, stored verbatim — no separate mapping table.';

create table public.drivers (
  id         uuid primary key default gen_random_uuid(),
  org_id     text not null references public.orgs(id),
  driver_id  text not null,
  name       text,
  created_at timestamptz not null default now(),

  constraint drivers_org_driver_key unique (org_id, driver_id)
);

comment on table public.drivers is
  'A driver as a first-class, org-scoped entity. Previously driver_id was a bare string with no backing row anywhere.';

create index drivers_org_id_idx on public.drivers (org_id);

create table public.routes (
  id          uuid primary key default gen_random_uuid(),
  org_id      text not null references public.orgs(id),
  route_id    text not null,
  cargo_class text not null,
  driver_id   text not null,
  created_at  timestamptz not null default now(),

  constraint routes_org_route_key unique (org_id, route_id),

  constraint routes_cargo_class_check check (
    cargo_class in ('pharma', 'produce', 'general_reefer')
  ),

  -- A route cannot reference a driver that doesn't exist in the same org.
  constraint routes_driver_fk foreign key (org_id, driver_id)
    references public.drivers (org_id, driver_id)
);

comment on table public.routes is
  'RouteRegistry (packages/risk-engine) promoted from an in-memory Map into real, org-scoped, persisted rows.';

create index routes_org_id_idx on public.routes (org_id);

-- ---------------------------------------------------------------------------
-- audit_log: add the envelope column. §3 payloads are untouched.
-- ---------------------------------------------------------------------------

alter table public.audit_log
  add column org_id text references public.orgs(id);

-- Safe as a single ALTER ... SET NOT NULL: verified 0 rows on live Neon
-- before this migration was written, so there is no existing row that could
-- violate it.
alter table public.audit_log
  alter column org_id set not null;

comment on column public.audit_log.org_id is
  'Envelope column, resolved from the referenced route at write time — never inside payload. Same pattern as route_id.';

create index audit_log_org_id_idx on public.audit_log (org_id);
