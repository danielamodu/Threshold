-- Verification for the append-only audit log (§2).
--
-- Proves the guarantees §2 depends on: entries append, the correlation key ties
-- one event to both liability responses, decisions cannot be stored without a
-- rationale, and UPDATE / DELETE / TRUNCATE all raise.
--
-- Run against local Supabase:
--     npm run db:reset
--     psql "$DATABASE_URL" -f supabase/tests/audit_log_test.sql
--
-- Or against a throwaway Postgres (see the header of each section — this script
-- creates the Supabase roles itself so a bare postgres:15 image works):
--     docker run -d --name threshold-pg -e POSTGRES_PASSWORD=postgres \
--       -e POSTGRES_DB=threshold -p 55432:5432 postgres:15
--     psql postgresql://postgres:postgres@localhost:55432/threshold \
--       -f supabase/migrations/20260813090000_create_audit_log.sql \
--       -f supabase/tests/audit_log_test.sql
--
-- Every assertion below fails loudly. A clean run ends at section 11.

\set ON_ERROR_STOP on

-- Supabase provides these; a bare Postgres image does not.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;

\echo '== 1. append a ThermalExposureEvent =='
insert into public.audit_log (entry_type, event_id, route_id, payload, occurred_at)
values (
  'thermal_exposure_event',
  '11111111-1111-1111-1111-111111111111',
  'route-a',
  '{"event_id":"11111111-1111-1111-1111-111111111111","route_id":"route-a","temp_c":41.2,"heat_index_c":47.9,"humidity_pct":38,"source":"fortyguard_api"}'::jsonb,
  now()
);

\echo '== 2. append both evaluations for the SAME event_id =='
insert into public.audit_log (entry_type, event_id, payload, occurred_at)
values
  ('compliance_record', '11111111-1111-1111-1111-111111111111',
   '{"record_id":"aaaa1111-1111-1111-1111-111111111111","action":"rest_break_scheduled"}'::jsonb, now()),
  ('cargo_risk_assessment', '11111111-1111-1111-1111-111111111111',
   '{"assessment_id":"bbbb1111-1111-1111-1111-111111111111","risk_level":"breach"}'::jsonb, now());

\echo '== 3. agent_decision WITHOUT rationale must be rejected =='
do $$
begin
  insert into public.audit_log (entry_type, event_id, payload)
  values ('agent_decision', '11111111-1111-1111-1111-111111111111',
          '{"decision_id":"cccc1111-1111-1111-1111-111111111111"}'::jsonb);
  raise exception 'ASSERT FAILED: agent_decision without rationale was accepted';
exception
  when check_violation then raise notice 'PASS: rationale is required for agent_decision';
end $$;

\echo '== 4. agent_decision WITH rationale is accepted =='
insert into public.audit_log (entry_type, event_id, payload, rationale)
values (
  'agent_decision',
  '11111111-1111-1111-1111-111111111111',
  '{"decision_id":"cccc1111-1111-1111-1111-111111111111","action_tier":"draft","confidence":0.82}'::jsonb,
  'Heat index 47.9C exceeded the OSHA high-risk threshold while pharma cargo passed its cumulative exposure limit; drafted both a rest schedule and a claim for human review.'
);

\echo '== 5. unknown entry_type must be rejected =='
do $$
begin
  insert into public.audit_log (entry_type, event_id, payload)
  values ('not_a_real_type', '11111111-1111-1111-1111-111111111111', '{}'::jsonb);
  raise exception 'ASSERT FAILED: unknown entry_type was accepted';
exception
  when check_violation then raise notice 'PASS: entry_type is constrained';
end $$;

\echo '== 6. non-object payload must be rejected =='
do $$
begin
  insert into public.audit_log (entry_type, event_id, payload)
  values ('thermal_exposure_event', '11111111-1111-1111-1111-111111111111', '"a string"'::jsonb);
  raise exception 'ASSERT FAILED: non-object payload was accepted';
exception
  when check_violation then raise notice 'PASS: payload must be a JSON object';
end $$;

\echo '== 7. UPDATE must be blocked =='
do $$
begin
  update public.audit_log set route_id = 'tampered' where seq = 1;
  raise exception 'ASSERT FAILED: UPDATE was allowed';
exception
  when insufficient_privilege then raise notice 'PASS: UPDATE blocked by trigger';
end $$;

\echo '== 8. DELETE must be blocked =='
do $$
begin
  delete from public.audit_log where seq = 1;
  raise exception 'ASSERT FAILED: DELETE was allowed';
exception
  when insufficient_privilege then raise notice 'PASS: DELETE blocked by trigger';
end $$;

\echo '== 9. TRUNCATE must be blocked =='
do $$
begin
  truncate public.audit_log;
  raise exception 'ASSERT FAILED: TRUNCATE was allowed';
exception
  when insufficient_privilege then raise notice 'PASS: TRUNCATE blocked by trigger';
end $$;

\echo '== 10. final contents, in insertion order =='
select seq, entry_type, event_id, route_id, (rationale is not null) as has_rationale
from public.audit_log
order by seq;

\echo '== 11. the core insight: one event -> two liability responses =='
select event_id,
       count(*) filter (where entry_type = 'thermal_exposure_event') as events,
       count(*) filter (where entry_type = 'compliance_record')      as human_side,
       count(*) filter (where entry_type = 'cargo_risk_assessment')  as cargo_side,
       count(*) filter (where entry_type = 'agent_decision')         as decisions
from public.audit_log
group by event_id;
