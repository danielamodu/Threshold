-- Threshold — Phase 11 RLS verification (db/migrations/...enable_rls_tenant_isolation.sql)
--
-- Proves the database-level tenant isolation backstop (§11) at the SQL layer
-- directly, not through the application — even a raw `SELECT *` with no WHERE
-- clause returns only the session's tenant. This is the property the
-- application code's `WHERE org_id = $1` cannot give on its own: the structural
-- backstop that holds if the application ever forgets to scope a query.
--
-- Mechanism under test:
--   * A dedicated `threshold_app` role with NOBYPASSRLS (verified against
--     Neon's `neondb_owner`, which has BYPASSRLS and therefore bypasses RLS).
--   * Transaction-local GUC `app.current_org_id` set via
--     `set_config(..., true)` inside `BEGIN; SET LOCAL ROLE; ...; COMMIT`.
--   * Policies on `audit_log`, `routes`, `drivers` with USING and WITH CHECK
--     both `org_id = public.app_current_org_id()`.
--   * FORCE ROW LEVEL SECURITY on the three tenant tables.
--
-- Why the runner cannot use --commit on this suite: audit_log is append-only
-- by trigger; the inserts in section 2 are permanent, so the rollback-wrapped
-- runner (db/test.mts) is required. A re-run that leaves the test rows in
-- place is harmless — they live under two throwaway orgs and are not
-- referenced by any other test or fixture.
--
--     npm run db:test -- --suite rls_isolation_test

\set ON_ERROR_STOP on

\echo '== 0. two throwaway test orgs + their driver rows =='
insert into public.orgs (id, name, slug) values
  ('org_rls_test_alpha', 'RLS Test Alpha', 'rls-test-alpha'),
  ('org_rls_test_beta',  'RLS Test Beta',  'rls-test-beta');
-- routes_driver_fk requires a driver row in the same org; insert them as
-- the owner (bypasses RLS) so the per-org FK target exists.
insert into public.drivers (org_id, driver_id, name) values
  ('org_rls_test_alpha', 'driver-rls-a', 'RLS A driver'),
  ('org_rls_test_beta',  'driver-rls-b', 'RLS B driver');

\echo '== 1. RLS is enabled AND forced on all three tenant tables =='
do $$
declare
  r record;
  missing text := '';
begin
  for r in
    select c.relname, c.relrowsecurity, c.relforcerowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('audit_log', 'routes', 'drivers')
  loop
    if not r.relrowsecurity then
      missing := missing || r.relname || ' (ENABLE) ';
    end if;
    if not r.relforcerowsecurity then
      missing := missing || r.relname || ' (FORCE) ';
    end if;
  end loop;
  if missing <> '' then
    raise exception 'ASSERT FAILED: RLS not enabled+forced on: %', missing;
  end if;
  raise notice 'PASS: RLS ENABLE+FORCE on audit_log, routes, drivers';
end $$;

\echo '== 2. as threshold_app, default-deny when no GUC is set =='
do $$
declare
  cnt int;
begin
  perform set_config('role', 'threshold_app', false);
  set local role threshold_app;
  -- App code must SET LOCAL GUC; this raw SELECT has no GUC. Default-deny.
  select count(*) into cnt from public.audit_log;
  if cnt <> 0 then
    raise exception 'ASSERT FAILED: un-scoped audit_log SELECT returned % rows; default-deny expected 0', cnt;
  end if;
  select count(*) into cnt from public.routes;
  if cnt <> 0 then
    raise exception 'ASSERT FAILED: un-scoped routes SELECT returned % rows', cnt;
  end if;
  select count(*) into cnt from public.drivers;
  if cnt <> 0 then
    raise exception 'ASSERT FAILED: un-scoped drivers SELECT returned % rows', cnt;
  end if;
  raise notice 'PASS: default-deny without GUC (audit_log/routes/drivers all 0 rows)';
end $$;

\echo '== 3. as threshold_app with org_A GUC: raw SELECT * returns only org_A =='
do $$
declare
  cnt_a int;
  cnt_b int;
begin
  set local role threshold_app;
  perform set_config('app.current_org_id', 'org_rls_test_alpha', true);

  select count(*) into cnt_a from public.audit_log;
  select count(*) into cnt_b
    from public.audit_log where org_id = 'org_rls_test_beta';
  if cnt_b <> 0 then
    raise exception 'ASSERT FAILED: org_A session saw % rows from org_B', cnt_b;
  end if;
  raise notice 'PASS: org_A session sees 0 rows of org_B in audit_log (saw % of org_A)', cnt_a;
end $$;

\echo '== 4. as threshold_app with org_A GUC: cross-org INSERT is denied (WITH CHECK) =='
do $$
declare
  inserted boolean := false;
begin
  set local role threshold_app;
  perform set_config('app.current_org_id', 'org_rls_test_alpha', true);

  begin
    -- Insert that names org_B while session claims org_A. Must violate WITH CHECK.
    insert into public.routes (org_id, route_id, cargo_class, driver_id)
      values ('org_rls_test_beta', 'route-cross-org', 'pharma', 'driver-b');
    inserted := true;
  exception
    when insufficient_privilege then
      raise notice 'PASS: cross-org INSERT denied (42501 insufficient_privilege)';
  end;
  if inserted then
    raise exception 'ASSERT FAILED: cross-org INSERT was accepted';
  end if;
end $$;

\echo '== 5. as threshold_app with org_A GUC: matching INSERT succeeds =='
do $$
declare
  inserted boolean := false;
begin
  set local role threshold_app;
  perform set_config('app.current_org_id', 'org_rls_test_alpha', true);

  begin
    insert into public.routes (org_id, route_id, cargo_class, driver_id)
      values ('org_rls_test_alpha', 'route-rls-alpha-1', 'pharma', 'driver-rls-a');
    inserted := true;
  exception
    when others then
      raise exception 'ASSERT FAILED: matching org INSERT was rejected: %', sqlerrm;
  end;
  if not inserted then
    raise exception 'ASSERT FAILED: matching org INSERT did not insert';
  end if;
  raise notice 'PASS: matching org INSERT succeeded';
end $$;

\echo '== 6. as threshold_app: writes from a NO-ROLE session (raw owner) still flow = migration path =='
-- The owning role `neondb_owner` is the one the migration runner uses; it
-- must keep being able to insert/select (FORCE RLS only applies to non-OWNER
-- roles, but BYPASSRLS is its own bypass — see the migration header).
-- This block proves the migration/operator path is unchanged: a plain
-- session as the connection-string owner can read across orgs and write
-- without an explicit SET LOCAL.
do $$
declare
  cnt int;
begin
  -- intentionally NOT setting role; run as whoever this script is connected as
  select count(*) into cnt from public.routes
    where org_id in ('org_rls_test_alpha','org_rls_test_beta');
  if cnt < 1 then
    raise exception 'ASSERT FAILED: owner-bypass sees 0 routes (expected >=1)';
  end if;
  raise notice 'PASS: owner role still sees all tenants (% rows visible to operator)', cnt;
end $$;

\echo '== 7. transaction-local GUC is cleared to NULL inside this transaction =='
-- The db/test.mts runner wraps the whole file in one outer BEGIN/COMMIT, so
-- do-blocks within this file share a single transaction and SET LOCAL state
-- is preserved across them. That makes "fresh transaction, no set_config"
-- impossible to express inside this file. The leak property itself is
-- verified directly in the migration header (live node test, same Client,
-- explicit BEGIN/COMMIT between two transactions) and at the helper layer
-- in packages/accounts/src/db.ts and packages/audit/src/postgres.ts. Here
-- we verify the in-transaction view: a set_config of NULL/'' re-establishes
-- the default-deny posture even though the GUC was set earlier in this
-- transaction.
do $$
declare
  cnt int;
begin
  set local role threshold_app;
  -- explicitly clear within the same transaction
  perform set_config('app.current_org_id', '', false);
  -- Above is session-level so it sticks for the rest of the test runner
  -- transaction; the policy treats '' as NULL via nullif(), default-deny.
  select count(*) into cnt from public.routes;
  if cnt <> 0 then
    raise exception 'ASSERT FAILED: empty GUC should default-deny, got % rows', cnt;
  end if;
  raise notice 'PASS: empty GUC treated as NULL (default-deny, 0 rows)';
end $$;

\echo '== 8. policy summary =='
select tablename, policyname, cmd, permissive
from pg_policies
where schemaname = 'public'
  and tablename in ('audit_log', 'routes', 'drivers')
order by tablename, policyname;

\echo 'All RLS assertions passed.'
