-- Threshold — Phase 11: Postgres RLS tenant isolation (§11, §2 Audit Layer)
--
-- Every tenant-owned row already carries `org_id` (Phase 7) and the
-- application layer already scopes every query by it. This migration adds the
-- database-level backstop so isolation is structural, not just a property of
-- correctly-written application code. Even a `SELECT * FROM audit_log` with no
-- WHERE clause cannot cross an org boundary once the session's org context is
-- set — Postgres itself enforces it.
--
-- ── Why a dedicated app role + SET LOCAL ROLE, not just SET LOCAL org_id ──
-- Neon provisions the connection-string owner (`neondb_owner`) with
-- `ROLBYPASSRLS = true`. A role with BYPASSRLS bypasses every RLS policy even
-- when `FORCE ROW LEVEL SECURITY` is enabled (verified live against Neon:
-- `select rolbypassrls from pg_roles where rolname = current_user` is true).
-- `ALTER ROLE neondb_owner NOBYPASSRLS` would fix it but is an operator-level
-- change to Neon's own bootstrapped owner and would affect every future
-- migration. The established Postgres pattern for managed Postgres with a
-- bypass owner is to create a dedicated, non-bypass app role and have the app
-- `SET LOCAL ROLE` to it inside each transaction — the per-transaction scope
-- is what makes this safe with Neon's PgBouncer in transaction-pooling mode.
--
-- ── Why transaction-local GUC (`SET LOCAL` / `set_config(..., true)`) ──
-- Neon exposes a pooled endpoint (hostname contains `-pooler`, verified live).
-- PgBouncer in transaction mode reassigns backends between transactions and
-- `RESET`s transaction state at COMMIT. A session-level `SET app.current_org_id
-- = '...'` (or `set_config(..., false)`) leaks across checkouts: a live test
-- against Neon showed a session SET on one `Client` became visible on a second
-- `Client` that happened to land on the same backend PID (755). `SET LOCAL`
-- (`set_config(..., true)`) and `SET LOCAL ROLE` are transaction-scoped and
-- reset atomically at COMMIT, which PgBouncer guarantees. Verified live:
--   BEGIN; SELECT set_config('app.current_org_id','org_A', true); SELECT
--   current_setting('app.current_org_id', true); -- => org_A
--   COMMIT; SELECT current_setting('app.current_org_id', true); -- => '' (or null)
-- A `set_config(..., true)` outside an explicit `BEGIN` only survives the
-- implicit single-statement transaction and is gone by the next query, so every
-- org-scoped operation MUST wrap its work in an explicit transaction
-- (BEGIN; SET LOCAL ROLE threshold_app; SELECT set_config(...); ...; COMMIT).
-- The app-layer helpers in `packages/accounts/src/db.ts` and
-- `packages/audit/src/postgres.ts` implement exactly that.
--
-- ── Why FORCE ROW LEVEL SECURITY ──────────────────────────────────────────
-- Without FORCE, the table owner bypasses RLS entirely, so the policies below
-- would be dead code for the very role the app connects as. FORCE makes them
-- apply to the owner as well — but a BYPASSRLS role still bypasses even a
-- forced policy, which is why the SET LOCAL ROLE step above is required. With
-- both in place, the chain is:
--   neondb_owner (BYPASS, sees all — for migrations/operator psql)
--     └─ SET LOCAL ROLE threshold_app (NOBYPASS, subject to policies)
--          └─ SET LOCAL app.current_org_id = 'org_...' (policy's tenant key)
-- A raw `SELECT * FROM audit_log` as threshold_app without a GUC matches
-- nothing (`org_id = NULL` is never true) — default-deny.
--
-- ── Scope ─────────────────────────────────────────────────────────────────
-- Three tables own tenant data: `audit_log`, `routes`, `drivers`. `orgs` is
-- deliberately left without RLS — it is the foreign-key anchor that the
-- provisioning hook (`apps/api/src/org-ensure.ts`) must be able to read
-- before any org context exists, and the `threshold_app` role retains SELECT
-- on it unconditionally. Adding RLS to `orgs` would make that bootstrap query
-- require a context it cannot yet have.
--
-- `audit_log` stays append-only (trigger) and RLS is layered on top of that:
-- UPDATE/DELETE are still blocked by trigger, SELECT/INSERT are additionally
-- gated by tenant policy. RLS and the trigger compose — the trigger fires
-- after the RLS qual has already filtered the row set.
--
-- Idempotent where safe: role creation is wrapped in a DO block, grants are
-- re-issuable, policies are DROP IF EXISTS / CREATE. The FORCE flag and
-- ENABLE are unconditional — re-applying the migration is a no-op (already
-- enabled).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- App role — the only role that is actually subject to the tenant policies.
-- NOLOGIN: it is never used as a connection-string login, only via
-- `SET LOCAL ROLE` from the owning connection.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select from pg_roles where rolname = 'threshold_app') then
    create role threshold_app with nobypassrls nologin;
  end if;
end
$$;

-- Allow the owning connection to assume the app role transaction-locally.
grant threshold_app to neondb_owner;

-- ---------------------------------------------------------------------------
-- Grants — the app role needs exactly the privileges the stores and sink
-- actually use. No broader GRANT ALL, no DDL. Sequences cover the
-- GENERATED ALWAYS AS IDENTITY columns and the uuid default (`gen_random_uuid`)
-- does not need extra grants. Re-issuable.
-- ---------------------------------------------------------------------------

grant usage on schema public to threshold_app;

-- orgs: read-only anchor, no RLS — provisioning and lookups must work without
-- a tenant context. Keep SELECT only.
grant select on table public.orgs to threshold_app;

-- tenant tables — full row access gated by RLS, so grant the DML the app uses
grant select, insert on table public.audit_log to threshold_app;
grant select, insert, update, delete on table public.routes to threshold_app;
grant select, insert, update, delete on table public.drivers to threshold_app;

-- identity sequences (audit_log uses GENERATED ALWAYS AS IDENTITY; drivers/routes
-- use gen_random_uuid() and have no sequence). Use the ALL SEQUENCES form so the
-- grant automatically picks up the actual identity sequence name
-- (audit_log_seq_seq) regardless of Postgres's naming for GENERATED AS IDENTITY.
grant usage, select on all sequences in schema public to threshold_app;

-- schema_migrations is operator-only; the app role does not need it. Keep
-- explicit for clarity: no grant on schema_migrations to threshold_app.

-- ---------------------------------------------------------------------------
-- Helper — single source of truth for the policy expression. Declared STABLE
-- so Postgres can inline it, but defined once so the policy text stays
-- readable and the three policies cannot drift.
-- nullif(..., '') treats a session-cleared GUC (empty string) the same as an
-- unset one (NULL) — both deny. The GUC itself is valid org ids like
-- `org_2abc...`, never empty.
-- ---------------------------------------------------------------------------

create or replace function public.app_current_org_id()
returns text
language sql
stable
as $$
  select nullif(current_setting('app.current_org_id', true), '')
$$;

comment on function public.app_current_org_id() is
  'Current tenant for RLS: nullif(current_setting(''app.current_org_id'', true), ''''). Set transaction-locally via SELECT set_config(''app.current_org_id'', $1, true) inside BEGIN; SET LOCAL ROLE threshold_app; ... COMMIT.';

-- ---------------------------------------------------------------------------
-- Enable + force RLS. FORCE is required or the table owner bypasses the
-- policies; see the header for why SET LOCAL ROLE is also required on Neon.
-- ---------------------------------------------------------------------------

alter table public.audit_log enable row level security;
alter table public.audit_log force row level security;
alter table public.routes enable row level security;
alter table public.routes force row level security;
alter table public.drivers enable row level security;
alter table public.drivers force row level security;

-- ---------------------------------------------------------------------------
-- Policies — one per table, FOR ALL (SELECT/INSERT/UPDATE/DELETE) TO PUBLIC.
-- TO PUBLIC rather than TO threshold_app: any non-bypass role (including a
-- future ad-hoc analyst role) is subject to the same tenant check. The bypass
-- owner (neondb_owner) bypasses regardless of TO clause, which is why the app
-- must SET LOCAL ROLE — the policy's target is not a replacement for that.
-- PERMISSIVE (default): the single tenant check is the allow-list.
-- USING controls which existing rows are visible (SELECT/UPDATE/DELETE);
-- WITH CHECK controls which new rows may be written (INSERT/UPDATE).
-- Both use the same tenant predicate — a row cannot be inserted for org A
-- while the session claims to be org B.
-- ---------------------------------------------------------------------------

drop policy if exists audit_log_tenant_isolation on public.audit_log;
create policy audit_log_tenant_isolation on public.audit_log
  for all
  to public
  using (org_id = public.app_current_org_id())
  with check (org_id = public.app_current_org_id());

drop policy if exists routes_tenant_isolation on public.routes;
create policy routes_tenant_isolation on public.routes
  for all
  to public
  using (org_id = public.app_current_org_id())
  with check (org_id = public.app_current_org_id());

drop policy if exists drivers_tenant_isolation on public.drivers;
create policy drivers_tenant_isolation on public.drivers
  for all
  to public
  using (org_id = public.app_current_org_id())
  with check (org_id = public.app_current_org_id());

comment on policy audit_log_tenant_isolation on public.audit_log is
  'Tenant isolation: row is visible/writable only when org_id equals the transaction-local app.current_org_id GUC (via SET LOCAL ROLE threshold_app; SELECT set_config(...)). Operator bypass: neondb_owner with BYPASSRLS bypasses even FORCE; direct psql as owner sees all.';
comment on policy routes_tenant_isolation on public.routes is
  'Tenant isolation for RouteRegistry persistence — same mechanism as audit_log.';
comment on policy drivers_tenant_isolation on public.drivers is
  'Tenant isolation for driver identities — same mechanism as audit_log.';
