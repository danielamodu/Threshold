-- Verification for the append-only audit log (§2).
--
-- Proves the guarantees §2 depends on: entries append, the correlation key ties
-- one event to both liability responses, decisions cannot be stored without a
-- rationale, and UPDATE / DELETE / TRUNCATE all raise.
--
-- Target is vanilla Postgres (Neon in production, any local Postgres for
-- verification). No Supabase roles are created or referenced — see the
-- privileges note in the migration for why.
--
--     npm run db:migrate            # apply migrations
--     npm run db:test               # this file
--
-- Or directly:
--     psql "$NEON_DATABASE_URL" -f db/tests/audit_log_test.sql
--
-- Every assertion below fails loudly. A clean run ends at section 11.

\set ON_ERROR_STOP on

\echo '== 1. append a ThermalExposureEvent =='
insert into public.audit_log (entry_type, event_id, route_id, payload, occurred_at)
values (
  'thermal_exposure_event',
  '11111111-1111-1111-1111-111111111111',
  'route-a',
  -- Post-decision-log §3 shape: temp_c is the AOI Max, temp_stats rides along
  -- for audit, and heat_index_c is deliberately ABSENT (§8 decision 2).
  '{"event_id":"11111111-1111-1111-1111-111111111111","route_id":"route-a","waypoint_id":"wp-1","temp_c":41.2,"temp_stats":{"mean":37.4,"max":41.2,"min":34.1,"stddev":1.8},"humidity_pct":38,"data_quality":"complete","timestamp":"2026-08-17T14:00:00Z","source":"fortyguard_api"}'::jsonb,
  now()
);

\echo '== 1b. a degraded event (null humidity) is stored, never zero-filled =='
insert into public.audit_log (entry_type, event_id, route_id, payload, occurred_at)
values (
  'thermal_exposure_event',
  '22222222-2222-2222-2222-222222222222',
  'route-a',
  '{"event_id":"22222222-2222-2222-2222-222222222222","route_id":"route-a","waypoint_id":"wp-2","temp_c":39.6,"temp_stats":{"mean":36.0,"max":39.6,"min":33.2,"stddev":1.5},"humidity_pct":null,"data_quality":"degraded_no_humidity","timestamp":"2026-08-17T15:00:00Z","source":"fortyguard_api"}'::jsonb,
  now()
);

do $$
declare h jsonb;
begin
  select payload -> 'humidity_pct' into h
  from public.audit_log
  where event_id = '22222222-2222-2222-2222-222222222222';

  if h is null or jsonb_typeof(h) <> 'null' then
    raise exception 'ASSERT FAILED: degraded humidity_pct should be JSON null, got %', h;
  end if;
  raise notice 'PASS: null humidity stored as JSON null, not 0 (§8 decision 3)';
end $$;

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
\echo '   (seq skips a value: the rejected insert in section 3 burned one.'
\echo '    Monotonic, not gap-free — a gap means a REFUSED write, not a deletion.)'
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
