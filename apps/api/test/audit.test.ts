/**
 * Real integration tests for GET /api/audit — a genuine HTTP request through
 * the real Fastify route and the real Postgres-backed PostgresAuditSink.
 *
 * audit_log is append-only (trigger-enforced, blocks DELETE even for the
 * table owner — confirmed the hard way: an earlier version of this file
 * tried to clean up test-inserted rows and the trigger correctly rejected
 * it). So this never inserts NEW audit_log rows for a disposable org: it
 * asserts against the real, permanent rows already produced for
 * DEMO_ORG_ID/DEMO_ROUTE_ID by the Phase 7 proof run
 * (apps/api/scripts/verify-org-scoped.ts) instead, and uses a separate org
 * — ORG_B — ONLY for the cross-org isolation check, since ORG_B never
 * receives any audit_log row and so can still be fully cleaned up.
 *
 * `drivers`, by contrast, is an ordinary table: the Clerk-user-to-driver_id
 * link tests below really do UPDATE and DELETE it, and after() restores the
 * seeded demo driver to the unlinked state it was found in.
 */

import { resolve } from 'node:path';
import { strict as assert } from 'node:assert';
import { describe, it, before, after } from 'node:test';
import { config as loadDotenv } from 'dotenv';
import Fastify from 'fastify';
import { Client } from 'pg';
import {
  DEMO_DRIVER_ID,
  DEMO_ORG_ID,
  DEMO_ROUTE_ID,
  DriverStore,
  OrgStore,
  type Role,
} from '@threshold/accounts';
import { registerAuditRoutes } from '../src/routes/audit.js';
import type { ThresholdAuth } from '../src/auth.js';

loadDotenv({ path: resolve(import.meta.dirname, '../../../.env') });

const connectionString =
  process.env.THRESHOLD_TEST_DB_URL ?? process.env.NEON_DATABASE_URL ?? process.env.DATABASE_URL;

const needsSsl = (url: string) => /sslmode=require/i.test(url) || /\.neon\.tech/i.test(url);

const ORG_B = 'org_test_audit_isolation_b';

/**
 * A driver in the REAL demo org that deliberately owns no routes. Linking the
 * test user to it proves the 'own' filter actually filters: same org, real
 * audit_log rows present, but none reachable through this driver.
 */
const ROUTELESS_DRIVER_ID = 'driver-test-no-routes';

/** The userId every asRole() session carries — what the driver link is made against. */
const TEST_USER_ID = 'user_test';

function fakeAuth(auth: ThresholdAuth) {
  return async (request: { auth?: ThresholdAuth }) => {
    request.auth = auth;
  };
}

function asRole(role: Role | null, orgId: string | null): ThresholdAuth {
  return { userId: TEST_USER_ID, orgId, role };
}

async function buildTestApp(authenticate: ReturnType<typeof fakeAuth>) {
  const app = Fastify();
  registerAuditRoutes(app, { connectionString: connectionString ?? '', authenticate });
  await app.ready();
  return app;
}

function pgClient(): Client {
  return new Client({
    connectionString,
    ...(connectionString && needsSsl(connectionString) ? { ssl: { rejectUnauthorized: true } } : {}),
  });
}

/**
 * Points TEST_USER_ID at one driver in the demo org, or at none (null).
 *
 * Always clears the user's existing link first: `drivers_org_clerk_user_key`
 * forbids one Clerk user holding two driver identities in the same org, so
 * link-without-clearing would fail the second time and make these tests
 * order-dependent. Raw SQL rather than DriverStore because this is fixture
 * setup, matching how packages/accounts/test/persistence.test.ts prepares its
 * own state.
 */
async function setDriverLink(driverId: string | null): Promise<void> {
  const client = pgClient();
  await client.connect();
  await client.query(
    'update public.drivers set clerk_user_id = null where org_id = $1 and clerk_user_id = $2',
    [DEMO_ORG_ID, TEST_USER_ID],
  );
  if (driverId) {
    await client.query(
      'update public.drivers set clerk_user_id = $3 where org_id = $1 and driver_id = $2',
      [DEMO_ORG_ID, driverId, TEST_USER_ID],
    );
  }
  await client.end();
}

describe('/api/audit (requires a real Postgres)', { skip: !connectionString }, () => {
  before(async () => {
    // ORG_B never receives an audit_log row, so — unlike audit_log itself —
    // it's safe to create and fully delete.
    const orgs = new OrgStore(connectionString ?? '');
    const existing = await orgs.get(ORG_B);
    if (!existing) {
      await orgs.create({ id: ORG_B, name: 'Audit Isolation Test Org B', slug: 'test-audit-isolation-b' });
    }
    await orgs.close();

    // A real driver row in the real demo org that owns no routes. Safe to
    // delete afterwards precisely because nothing references it.
    const drivers = new DriverStore(connectionString ?? '');
    if (!(await drivers.get(DEMO_ORG_ID, ROUTELESS_DRIVER_ID))) {
      await drivers.create({
        org_id: DEMO_ORG_ID,
        driver_id: ROUTELESS_DRIVER_ID,
        name: 'Scope Test Driver (no routes)',
      });
    }
    await drivers.close();

    await setDriverLink(null);
  });

  after(async () => {
    // Leave the seeded demo driver exactly as it was found: unlinked.
    await setDriverLink(null);
    const client = pgClient();
    await client.connect();
    await client.query('delete from public.drivers where org_id = $1 and driver_id = $2', [
      DEMO_ORG_ID,
      ROUTELESS_DRIVER_ID,
    ]);
    await client.query('delete from public.orgs where id = $1', [ORG_B]);
    await client.end();
  });

  it('org_admin sees real, permanent audit entries for the real demo org', async () => {
    const app = await buildTestApp(fakeAuth(asRole('org_admin', DEMO_ORG_ID)));
    const res = await app.inject({ method: 'GET', url: '/api/audit' });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(body.entries.length > 0, 'expected the real Phase 7 proof-run rows to still be present');
    assert.ok(body.entries.every((e: { org_id: string }) => e.org_id === DEMO_ORG_ID));
    assert.ok(body.entries.some((e: { route_id: string | null }) => e.route_id === DEMO_ROUTE_ID));
    await app.close();
  });

  it("a different org never sees the demo org's entries", async () => {
    const app = await buildTestApp(fakeAuth(asRole('org_admin', ORG_B)));
    const res = await app.inject({ method: 'GET', url: '/api/audit' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json().entries, []);
    await app.close();
  });

  it('dispatcher and compliance_officer can also read (org_wide)', async () => {
    for (const role of ['dispatcher', 'compliance_officer'] as const) {
      const app = await buildTestApp(fakeAuth(asRole(role, DEMO_ORG_ID)));
      const res = await app.inject({ method: 'GET', url: '/api/audit' });
      assert.equal(res.statusCode, 200, `${role} should read audit_log`);
      assert.ok(res.json().entries.length > 0);
      await app.close();
    }
  });

  it('an UNLINKED driver gets an empty feed plus driver_unlinked — never the org-wide feed', async () => {
    await setDriverLink(null);
    const app = await buildTestApp(fakeAuth(asRole('driver', DEMO_ORG_ID)));
    const res = await app.inject({ method: 'GET', url: '/api/audit' });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.deepEqual(body.entries, []);
    assert.equal(body.driver_unlinked, true, 'the empty feed must be explained, not silently empty');
    await app.close();
  });

  it('a LINKED driver sees their own real entries — the whole point of the link (§11)', async () => {
    await setDriverLink(DEMO_DRIVER_ID);
    const app = await buildTestApp(fakeAuth(asRole('driver', DEMO_ORG_ID)));
    const res = await app.inject({ method: 'GET', url: '/api/audit' });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.driver_unlinked, undefined, 'a linked driver is not unlinked');
    assert.equal(body.driver_id, DEMO_DRIVER_ID);
    assert.ok(body.entries.length > 0, 'the demo driver owns DEMO_ROUTE_ID, which has real rows');
    assert.ok(body.entries.every((e: { org_id: string }) => e.org_id === DEMO_ORG_ID));
    // readForOrg({ driverId }) filters by the routes this driver owns, so every
    // returned row must belong to one of them — DEMO_ROUTE_ID is the only one.
    assert.ok(body.entries.every((e: { route_id: string | null }) => e.route_id === DEMO_ROUTE_ID));
    await app.close();
  });

  it("the 'own' filter really filters: a driver with no routes sees nothing, in an org that has rows", async () => {
    await setDriverLink(ROUTELESS_DRIVER_ID);
    const app = await buildTestApp(fakeAuth(asRole('driver', DEMO_ORG_ID)));
    const res = await app.inject({ method: 'GET', url: '/api/audit' });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.deepEqual(body.entries, [], 'no routes owned => no entries, even though the org has many');
    // Empty for a legitimate reason (nothing assigned yet), NOT a missing link —
    // the two states must stay distinguishable to the client.
    assert.equal(body.driver_unlinked, undefined);
    assert.equal(body.driver_id, ROUTELESS_DRIVER_ID);
    await app.close();
  });

  it('a driver link is org-scoped — the same Clerk user is unlinked in another org', async () => {
    await setDriverLink(DEMO_DRIVER_ID);
    const app = await buildTestApp(fakeAuth(asRole('driver', ORG_B)));
    const res = await app.inject({ method: 'GET', url: '/api/audit' });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.deepEqual(body.entries, []);
    assert.equal(body.driver_unlinked, true, 'the link belongs to DEMO_ORG_ID, not ORG_B');
    await app.close();
  });

  it('a session with no active organization gets 403, not a crash', async () => {
    const app = await buildTestApp(fakeAuth(asRole('org_admin', null)));
    const res = await app.inject({ method: 'GET', url: '/api/audit' });
    assert.equal(res.statusCode, 403);
    await app.close();
  });

  it('production wiring defaults to the real requireAuth — real 401 with no token', async () => {
    const app = Fastify();
    registerAuditRoutes(app, { connectionString: connectionString ?? '' });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/audit' });
    assert.equal(res.statusCode, 401);
    await app.close();
  });
});
