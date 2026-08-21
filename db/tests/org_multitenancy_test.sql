-- Verification for Phase 7's org multi-tenancy migration (§11).
--
-- Proves: orgs/drivers/routes exist and enforce real referential integrity,
-- audit_log.org_id is genuinely required, and org-scoping actually isolates
-- data (the same route_id string is valid in two different orgs without
-- colliding — that's the whole point of scoping by org, not a coincidence).
--
-- Section 8 inserts a real audit_log row to prove the org_id constraints, and
-- audit_log is append-only by design (§2) — that row, and therefore the two
-- test orgs it references, can never be deleted afterward by a plain DELETE.
--
-- Run this via the rollback-wrapped runner, same reasoning and same tool as
-- audit_log_test.sql:
--     npm run db:test -- --suite org_multitenancy_test
--
-- That wraps the whole file in one transaction and rolls it back by default —
-- a ROLLBACK discards the insert directly, it never issues a DELETE, so the
-- append-only trigger never enters into it and nothing persists. Running this
-- file straight through psql instead COMMITS it, in which case the audit_log
-- row and both test orgs become permanent, same caveat as the other suite.
--
--     psql "postgresql://postgres:postgres@localhost:5432/threshold_verify" \
--       -f db/tests/org_multitenancy_test.sql   # commits — local/throwaway only
--
-- Every assertion below fails loudly. A clean run ends at section 8.

\set ON_ERROR_STOP on

\echo '== 1. create two orgs =='
insert into public.orgs (id, name, slug) values
  ('org_test_alpha', 'Alpha Fleet', 'alpha-fleet-test'),
  ('org_test_beta',  'Beta Fleet',  'beta-fleet-test');

\echo '== 2. a driver in each org =='
insert into public.drivers (org_id, driver_id, name) values
  ('org_test_alpha', 'driver-42', 'A. Driver'),
  ('org_test_beta',  'driver-42', 'B. Driver');

\echo '== 3. the SAME route_id in two different orgs must NOT collide =='
insert into public.routes (org_id, route_id, cargo_class, driver_id) values
  ('org_test_alpha', 'route-phx-01', 'pharma', 'driver-42'),
  ('org_test_beta',  'route-phx-01', 'general_reefer', 'driver-42');

\echo '== 4. a route referencing a driver that does not exist in that org must fail =='
do $$
begin
  insert into public.routes (org_id, route_id, cargo_class, driver_id)
  values ('org_test_alpha', 'route-ghost', 'pharma', 'driver-does-not-exist');
  raise exception 'ASSERT FAILED: route with an unknown driver was accepted';
exception
  when foreign_key_violation then raise notice 'PASS: routes_driver_fk enforced';
end $$;

\echo '== 5. a duplicate (org_id, route_id) must fail =='
do $$
begin
  insert into public.routes (org_id, route_id, cargo_class, driver_id)
  values ('org_test_alpha', 'route-phx-01', 'pharma', 'driver-42');
  raise exception 'ASSERT FAILED: duplicate (org_id, route_id) was accepted';
exception
  when unique_violation then raise notice 'PASS: routes_org_route_key enforced';
end $$;

\echo '== 6. audit_log now requires org_id — a null is rejected =='
do $$
begin
  insert into public.audit_log (entry_type, event_id, route_id, payload, occurred_at)
  values (
    'thermal_exposure_event',
    '33333333-3333-4333-8333-333333333333',
    'route-phx-01',
    '{"event_id":"33333333-3333-4333-8333-333333333333"}'::jsonb,
    now()
  );
  raise exception 'ASSERT FAILED: audit_log accepted a row with no org_id';
exception
  when not_null_violation then raise notice 'PASS: audit_log.org_id is required';
end $$;

\echo '== 7. audit_log rejects an org_id that does not exist =='
do $$
begin
  insert into public.audit_log (entry_type, event_id, route_id, org_id, payload, occurred_at)
  values (
    'thermal_exposure_event',
    '33333333-3333-4333-8333-333333333333',
    'route-phx-01',
    'org_does_not_exist',
    '{"event_id":"33333333-3333-4333-8333-333333333333"}'::jsonb,
    now()
  );
  raise exception 'ASSERT FAILED: audit_log accepted an unknown org_id';
exception
  when foreign_key_violation then raise notice 'PASS: audit_log.org_id foreign key enforced';
end $$;

\echo '== 8. a correctly org-scoped audit_log row succeeds =='
insert into public.audit_log (entry_type, event_id, route_id, org_id, payload, occurred_at)
values (
  'thermal_exposure_event',
  '33333333-3333-4333-8333-333333333333',
  'route-phx-01',
  'org_test_alpha',
  '{"event_id":"33333333-3333-4333-8333-333333333333","route_id":"route-phx-01"}'::jsonb,
  now()
);

\echo '== cleanup: routes and drivers only — the audit_log row from #8 is'
\echo '   permanent by design (append-only) and so, transitively, are the'
\echo '   two test orgs it references. This is expected. Reset the whole'
\echo '   throwaway database between runs instead of relying on cleanup here.'
delete from public.routes where org_id in ('org_test_alpha', 'org_test_beta');
delete from public.drivers where org_id in ('org_test_alpha', 'org_test_beta');

\echo 'All assertions passed.'
