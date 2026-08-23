/**
 * Real integration tests for /api/drivers (§11 Phase 7 follow-up) — genuine
 * HTTP requests through the real Fastify routes, the real role gate in
 * drivers.ts, and the real Postgres-backed DriverStore. Requires a real
 * NEON_DATABASE_URL/DATABASE_URL; skips (does not fail) without one.
 *
 * `authenticate` is faked for the same reason routes.test.ts fakes it: Clerk
 * token verification was proven separately against a live session (see
 * auth.ts's header), and what is new and unverified here is this file's own
 * logic — the org_management gate, the org scoping, and the
 * 400/404/409 boundaries. The last test confirms production wiring still
 * defaults to the real requireAuth.
 *
 * These endpoints are the reason a driver-role session can see anything at
 * all: without a `drivers.clerk_user_id` link, GET /api/audit has no driver_id
 * to scope 'own' to. The privilege-escalation case — a driver linking
 * themselves — is asserted explicitly below, because that is the failure mode
 * that would quietly turn 'own' into 'anyone's'.
 */

import { resolve } from 'node:path';
import { strict as assert } from 'node:assert';
import { describe, it, before, after } from 'node:test';
import { config as loadDotenv } from 'dotenv';
import Fastify from 'fastify';
import { Client } from 'pg';
import { OrgStore, type Role } from '@threshold/accounts';
import { registerDriverRoutes } from '../src/routes/drivers.js';
import type { ThresholdAuth } from '../src/auth.js';

loadDotenv({ path: resolve(import.meta.dirname, '../../../.env') });

const connectionString =
  process.env.THRESHOLD_TEST_DB_URL ?? process.env.NEON_DATABASE_URL ?? process.env.DATABASE_URL;

const needsSsl = (url: string) => /sslmode=require/i.test(url) || /\.neon\.tech/i.test(url);

const ORG_A = 'org_test_drivers_endpoint_a';
const ORG_B = 'org_test_drivers_endpoint_b';

const ADMIN_USER = 'user_test_drivers_admin';
const DRIVER_USER = 'user_test_drivers_human';

function fakeAuth(auth: ThresholdAuth) {
  return async (request: { auth?: ThresholdAuth }) => {
    request.auth = auth;
  };
}

function asRole(role: Role | null, orgId: string | null, userId: string = ADMIN_USER): ThresholdAuth {
  return { userId, orgId, role };
}

async function buildTestApp(authenticate: ReturnType<typeof fakeAuth>) {
  const app = Fastify();
  registerDriverRoutes(app, { connectionString: connectionString ?? '', authenticate });
  await app.ready();
  return app;
}

/** Both orgs are disposable: no audit_log row is ever written for them. */
async function wipe(): Promise<void> {
  const client = new Client({
    connectionString,
    ...(connectionString && needsSsl(connectionString) ? { ssl: { rejectUnauthorized: true } } : {}),
  });
  await client.connect();
  await client.query('delete from public.routes where org_id in ($1, $2)', [ORG_A, ORG_B]);
  await client.query('delete from public.drivers where org_id in ($1, $2)', [ORG_A, ORG_B]);
  await client.query('delete from public.orgs where id in ($1, $2)', [ORG_A, ORG_B]);
  await client.end();
}

describe('/api/drivers (requires a real Postgres)', { skip: !connectionString }, () => {
  before(async () => {
    await wipe();
    const orgs = new OrgStore(connectionString ?? '');
    await orgs.create({ id: ORG_A, name: 'Drivers Test Org A', slug: 'test-drivers-a' });
    await orgs.create({ id: ORG_B, name: 'Drivers Test Org B', slug: 'test-drivers-b' });
    await orgs.close();
  });

  after(wipe);

  it('org_admin creates a driver row — real 201, and it starts unlinked', async () => {
    const app = await buildTestApp(fakeAuth(asRole('org_admin', ORG_A)));
    const res = await app.inject({
      method: 'POST',
      url: '/api/drivers',
      payload: { driver_id: 'driver-a1', name: 'Driver A1' },
    });
    assert.equal(res.statusCode, 201);
    const body = res.json();
    assert.equal(body.org_id, ORG_A);
    assert.equal(body.driver_id, 'driver-a1');
    assert.equal(body.clerk_user_id, null, 'creation must not assume a human exists yet');
    await app.close();
  });

  it('rejects a create with no driver_id — real 400, before touching the database', async () => {
    const app = await buildTestApp(fakeAuth(asRole('org_admin', ORG_A)));
    const res = await app.inject({ method: 'POST', url: '/api/drivers', payload: { name: 'Nameless' } });
    assert.equal(res.statusCode, 400);
    await app.close();
  });

  it('a duplicate driver_id in the same org is a 409, not a 500', async () => {
    const app = await buildTestApp(fakeAuth(asRole('org_admin', ORG_A)));
    const res = await app.inject({
      method: 'POST',
      url: '/api/drivers',
      payload: { driver_id: 'driver-a1' },
    });
    assert.equal(res.statusCode, 409);
    await app.close();
  });

  it('the same driver_id in a DIFFERENT org is fine — drivers are org-scoped', async () => {
    const app = await buildTestApp(fakeAuth(asRole('org_admin', ORG_B)));
    const res = await app.inject({
      method: 'POST',
      url: '/api/drivers',
      payload: { driver_id: 'driver-a1', name: 'Unrelated B Driver' },
    });
    assert.equal(res.statusCode, 201);
    assert.equal(res.json().org_id, ORG_B);
    await app.close();
  });

  it('links a Clerk user to a driver, and /me then resolves it for that user', async () => {
    const adminApp = await buildTestApp(fakeAuth(asRole('org_admin', ORG_A)));
    const linkRes = await adminApp.inject({
      method: 'POST',
      url: '/api/drivers/driver-a1/link',
      payload: { clerk_user_id: DRIVER_USER },
    });
    assert.equal(linkRes.statusCode, 200);
    assert.equal(linkRes.json().clerk_user_id, DRIVER_USER);
    await adminApp.close();

    // The driver themselves — a role with NO org_management permission — can
    // still read their own link. That is the whole point of /me.
    const driverApp = await buildTestApp(fakeAuth(asRole('driver', ORG_A, DRIVER_USER)));
    const meRes = await driverApp.inject({ method: 'GET', url: '/api/drivers/me' });
    assert.equal(meRes.statusCode, 200);
    assert.equal(meRes.json().driver.driver_id, 'driver-a1');
    await driverApp.close();
  });

  it('/me reports null — not an error — for a user with no driver link', async () => {
    const app = await buildTestApp(fakeAuth(asRole('driver', ORG_A, 'user_test_drivers_nobody')));
    const res = await app.inject({ method: 'GET', url: '/api/drivers/me' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().driver, null);
    await app.close();
  });

  it('/me is org-scoped — the same linked user is unlinked when acting in another org', async () => {
    const app = await buildTestApp(fakeAuth(asRole('driver', ORG_B, DRIVER_USER)));
    const res = await app.inject({ method: 'GET', url: '/api/drivers/me' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().driver, null, "ORG_A's link must not follow the user into ORG_B");
    await app.close();
  });

  it("'me' is never read as a driver_id — the static route wins over the parameter", async () => {
    // If Fastify matched /api/drivers/:driver_id/link-style parameters ahead of
    // the static segment, a driver row literally named "me" could shadow this
    // endpoint. Asserting the shape proves /me resolved to the /me handler.
    const app = await buildTestApp(fakeAuth(asRole('org_admin', ORG_A)));
    const res = await app.inject({ method: 'GET', url: '/api/drivers/me' });
    assert.equal(res.statusCode, 200);
    assert.ok('driver' in res.json(), 'expected the /me envelope, not a bare driver row');
    await app.close();
  });

  it('a driver CANNOT link themselves — that would make read:own meaningless', async () => {
    const app = await buildTestApp(fakeAuth(asRole('driver', ORG_A, 'user_test_drivers_attacker')));
    const res = await app.inject({
      method: 'POST',
      url: '/api/drivers/driver-a1/link',
      payload: { clerk_user_id: 'user_test_drivers_attacker' },
    });
    assert.equal(res.statusCode, 403, 'self-claiming a driver_id is privilege escalation');
    await app.close();
  });

  it('dispatcher and compliance_officer cannot list or create drivers — real 403', async () => {
    for (const role of ['dispatcher', 'compliance_officer', 'driver'] as const) {
      const listApp = await buildTestApp(fakeAuth(asRole(role, ORG_A)));
      const listRes = await listApp.inject({ method: 'GET', url: '/api/drivers' });
      assert.equal(listRes.statusCode, 403, `${role} must not enumerate driver identities`);
      await listApp.close();

      const createApp = await buildTestApp(fakeAuth(asRole(role, ORG_A)));
      const createRes = await createApp.inject({
        method: 'POST',
        url: '/api/drivers',
        payload: { driver_id: `driver-${role}-should-not-exist` },
      });
      assert.equal(createRes.statusCode, 403);
      await createApp.close();
    }
  });

  it("org_admin's list shows only their own org's drivers", async () => {
    const app = await buildTestApp(fakeAuth(asRole('org_admin', ORG_A)));
    const res = await app.inject({ method: 'GET', url: '/api/drivers' });
    assert.equal(res.statusCode, 200);
    const drivers = res.json().drivers as { org_id: string; driver_id: string }[];
    assert.ok(drivers.every((d) => d.org_id === ORG_A));
    assert.ok(drivers.some((d) => d.driver_id === 'driver-a1'));
    // ORG_B also has a 'driver-a1' — the assertion above passing means the
    // query filtered by org, not that the ids happened to differ.
    assert.equal(drivers.filter((d) => d.driver_id === 'driver-a1').length, 1);
    await app.close();
  });

  it('linking one Clerk user to a second driver in the same org is a 409', async () => {
    const app = await buildTestApp(fakeAuth(asRole('org_admin', ORG_A)));
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/drivers',
      payload: { driver_id: 'driver-a2' },
    });
    assert.equal(createRes.statusCode, 201);
    const res = await app.inject({
      method: 'POST',
      url: '/api/drivers/driver-a2/link',
      payload: { clerk_user_id: DRIVER_USER },
    });
    assert.equal(res.statusCode, 409);
    await app.close();
  });

  it('an absent clerk_user_id key is a 400, so a typo cannot silently unlink someone', async () => {
    const app = await buildTestApp(fakeAuth(asRole('org_admin', ORG_A)));
    const res = await app.inject({
      method: 'POST',
      url: '/api/drivers/driver-a1/link',
      payload: { clerk_userid: DRIVER_USER },
    });
    assert.equal(res.statusCode, 400);
    // The real link is untouched.
    const meApp = await buildTestApp(fakeAuth(asRole('driver', ORG_A, DRIVER_USER)));
    const meRes = await meApp.inject({ method: 'GET', url: '/api/drivers/me' });
    assert.equal(meRes.json().driver.driver_id, 'driver-a1');
    await meApp.close();
    await app.close();
  });

  it('a blank clerk_user_id is a 400 — unlinking must be explicit null', async () => {
    const app = await buildTestApp(fakeAuth(asRole('org_admin', ORG_A)));
    const res = await app.inject({
      method: 'POST',
      url: '/api/drivers/driver-a1/link',
      payload: { clerk_user_id: '   ' },
    });
    assert.equal(res.statusCode, 400);
    await app.close();
  });

  it('an explicit null unlinks, and /me goes back to null', async () => {
    const app = await buildTestApp(fakeAuth(asRole('org_admin', ORG_A)));
    const res = await app.inject({
      method: 'POST',
      url: '/api/drivers/driver-a1/link',
      payload: { clerk_user_id: null },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().clerk_user_id, null);
    await app.close();

    const meApp = await buildTestApp(fakeAuth(asRole('driver', ORG_A, DRIVER_USER)));
    const meRes = await meApp.inject({ method: 'GET', url: '/api/drivers/me' });
    assert.equal(meRes.json().driver, null);
    await meApp.close();
  });

  it("linking a driver_id that exists only in ANOTHER org is a 404, not a cross-org write", async () => {
    // 'driver-a2' exists in ORG_A only. An ORG_B admin must not be able to
    // reach it, and must not learn that it exists.
    const app = await buildTestApp(fakeAuth(asRole('org_admin', ORG_B)));
    const res = await app.inject({
      method: 'POST',
      url: '/api/drivers/driver-a2/link',
      payload: { clerk_user_id: 'user_test_drivers_crossorg' },
    });
    assert.equal(res.statusCode, 404);
    await app.close();
  });

  it('a session with no active organization gets 403 on every endpoint, not a crash', async () => {
    const app = await buildTestApp(fakeAuth(asRole('org_admin', null)));
    assert.equal((await app.inject({ method: 'GET', url: '/api/drivers/me' })).statusCode, 403);
    assert.equal((await app.inject({ method: 'GET', url: '/api/drivers' })).statusCode, 403);
    assert.equal(
      (await app.inject({ method: 'POST', url: '/api/drivers', payload: { driver_id: 'x' } })).statusCode,
      403,
    );
    await app.close();
  });

  it('production wiring defaults to the real requireAuth, not a fake — real 401 with no token', async () => {
    const app = Fastify();
    registerDriverRoutes(app, { connectionString: connectionString ?? '' }); // no authenticate override
    await app.ready();
    assert.equal((await app.inject({ method: 'GET', url: '/api/drivers/me' })).statusCode, 401);
    assert.equal((await app.inject({ method: 'GET', url: '/api/drivers' })).statusCode, 401);
    await app.close();
  });
});
