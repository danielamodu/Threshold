-- Threshold — the Clerk-user-to-driver_id identity link (§11 Phase 7 follow-up)
--
-- WHY THIS EXISTS
-- The signed-off permission matrix (packages/accounts/src/roles.ts) gives the
-- `driver` role `read: 'own'` on audit_log, thermal_events, and
-- compliance_records — scoped to records for THAT driver. Enforcing 'own'
-- requires knowing which `drivers` row corresponds to the signed-in Clerk
-- user, and no such link existed: `drivers` had org_id/driver_id/name and
-- nothing tying a row to a human's account. GET /api/audit therefore returned
-- an honestly empty feed to every driver session rather than guess (matching
-- on name) or leak (showing every driver's records) — see the KNOWN GAP note
-- that apps/api/src/routes/audit.ts carried until this migration landed.
-- A role that structurally cannot show its own user anything is not finished,
-- so this is the column that makes 'own' mean something.
--
-- NULLABLE, deliberately
-- A driver row legitimately exists before any Clerk user is attached to it:
-- a dispatcher creates routes against `driver-42` (and `routes_driver_fk`
-- requires that row to exist) long before that person signs up, accepts an
-- org invite, and gets linked. Backfilling a value here would mean inventing
-- an identity. NULL is the honest state for "this driver has no account yet",
-- and it is also why the existing demo seed row survives this migration
-- untouched.
--
-- WHY unique (org_id, clerk_user_id) AND NOT unique (clerk_user_id)
--   * Per-org, because Clerk users are cross-org: the same human can be a
--     driver in two different fleets, and a globally-unique column would make
--     the second link fail. This mirrors `drivers_org_driver_key`, which
--     scopes driver_id the same way for the same reason.
--   * Unique at all, because within one org a Clerk user must map to at most
--     ONE driver identity. Two rows sharing a clerk_user_id would make
--     "records for this driver" ambiguous, and the 'own' check would silently
--     resolve to whichever row the query happened to return first.
--   * Postgres treats NULLs as distinct for uniqueness purposes, so this
--     constraint permits unlimited unlinked rows while still forbidding two
--     linked rows for the same user. That is exactly the wanted behaviour and
--     is why no partial index is needed.
--   * The constraint's backing index is also the lookup path for
--     DriverStore.getByClerkUser(org_id, clerk_user_id) — the query GET
--     /api/audit runs on every driver request — so no separate index is added.
--
-- STRICTLY ADDITIVE
-- One new nullable column and one new constraint. No existing column is
-- altered, renamed, or dropped; `drivers_org_driver_key` and
-- `routes_driver_fk` (which references `(org_id, driver_id)`, not this
-- column) are untouched; no existing row is rewritten. Every insert that was
-- legal before this file is still legal after it. Phases 0-6 do not read the
-- `drivers` table at all.
--
-- NOT DONE HERE, deliberately: nothing in this migration grants a driver the
-- ability to link THEMSELVES. Self-service claiming of an arbitrary driver_id
-- would let any driver-role user read another driver's records simply by
-- claiming their id — the exact leak the empty feed was avoiding. Assignment
-- is an org_admin action (POST /api/drivers/:driver_id/link).

alter table public.drivers
  add column clerk_user_id text;

alter table public.drivers
  add constraint drivers_org_clerk_user_key unique (org_id, clerk_user_id);

comment on column public.drivers.clerk_user_id is
  'Clerk user id (`user_...`) of the human who signs in as this driver, or NULL if nobody is linked yet. Makes the driver role''s read=''own'' permission enforceable. Unique per org, never globally — one Clerk user can drive for more than one fleet.';
