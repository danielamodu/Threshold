/**
 * Real integration tests for /api/routes (§11 Phase 7 follow-up) — a genuine
 * HTTP request through the real Fastify route, the real role-gate in
 * routes.ts, and the real Postgres-backed RouteStore. Requires a real
 * NEON_DATABASE_URL/DATABASE_URL; skips (does not fail) without one.
 *
 * `authenticate` is swapped for a fake preHandler that sets `request.auth`
 * directly to a given role/org, instead of a live Clerk token per role. This
 * is a deliberate scope boundary, not a shortcut: requireAuth's own Clerk
 * token verification (JWT signature, expiry, clock skew, the v1/v2 claim
 * shape fix) was already proven separately against a real live session — see
 * auth.ts's header. What's new and unverified here is routes.ts's own logic
 * (the role gate, the org-scoping, the 403-vs-404 split), and that gets a
 * real HTTP request and a real database on every assertion below. The one
 * "no fake" test at the bottom confirms production wiring still uses the
 * real requireAuth by default.
 */

import { resolve } from 'node:path';
import { strict as assert } from 'node:assert';
import { describe, it, before, after } from 'node:test';
import { config as loadDotenv } from 'dotenv';
import Fastify from 'fastify';
import { Client } from 'pg';
import { OrgStore, DriverStore, type Role } from '@threshold/accounts';
import { registerRouteRoutes } from '../src/routes/routes.js';
import type { ThresholdAuth } from '../src/auth.js';

loadDotenv({ path: resolve(import.meta.dirname, '../../../.env') });

const connectionString =
  process.env.THRESHOLD_TEST_DB_URL ?? process.env.NEON_DATABASE_URL ?? process.env.DATABASE_URL;

const needsSsl = (url: string) => /sslmode=require/i.test(url) || /\.neon\.tech/i.test(url);

const ORG_A = 'org_test_routes_endpoint_a';
const ORG_B = 'org_test_routes_endpoint_b';

function fakeAuth(auth: ThresholdAuth) {
  return async (request: { auth?: ThresholdAuth }) => {
    request.auth = auth;
  };
}

function asRole(role: Role | null, orgId: string | null): ThresholdAuth {
  return { userId: 'user_test', orgId, role };
}

async function buildTestApp(authenticate: ReturnType<typeof fakeAuth>) {
  const app = Fastify();
  registerRouteRoutes(app, { connectionString: connectionString ?? '', authenticate });
  await app.ready();
  return app;
}

describe('/api/routes (requires a real Postgres)', { skip: !connectionString }, () => {
  before(async () => {
    const client = new Client({
      connectionString,
      ...(connectionString && needsSsl(connectionString) ? { ssl: { rejectUnauthorized: true } } : {}),
    });
    await client.connect();
    await client.query('delete from public.routes where org_id in ($1, $2)', [ORG_A, ORG_B]);
    await client.query('delete from public.drivers where org_id in ($1, $2)', [ORG_A, ORG_B]);
    await client.query('delete from public.orgs where id in ($1, $2)', [ORG_A, ORG_B]);
    await client.end();

    const orgs = new OrgStore(connectionString ?? '');
    const drivers = new DriverStore(connectionString ?? '');
    await orgs.create({ id: ORG_A, name: 'Routes Test Org A', slug: 'test-routes-a' });
    await orgs.create({ id: ORG_B, name: 'Routes Test Org B', slug: 'test-routes-b' });
    await drivers.create({ org_id: ORG_A, driver_id: 'driver-a1', name: 'Driver A1' });
    await drivers.create({ org_id: ORG_B, driver_id: 'driver-b1', name: 'Driver B1' });
    await orgs.close();
    await drivers.close();
  });

  after(async () => {
    const client = new Client({
      connectionString,
      ...(connectionString && needsSsl(connectionString) ? { ssl: { rejectUnauthorized: true } } : {}),
    });
    await client.connect();
    await client.query('delete from public.routes where org_id in ($1, $2)', [ORG_A, ORG_B]);
    await client.query('delete from public.drivers where org_id in ($1, $2)', [ORG_A, ORG_B]);
    await client.query('delete from public.orgs where id in ($1, $2)', [ORG_A, ORG_B]);
    await client.end();
  });

  it('org_admin can create a route in their own org — real 201, real row', async () => {
    const app = await buildTestApp(fakeAuth(asRole('org_admin', ORG_A)));
    const res = await app.inject({
      method: 'POST',
      url: '/api/routes',
      payload: { route_id: 'route-a-1', driver_id: 'driver-a1', cargo_class: 'pharma' },
    });
    assert.equal(res.statusCode, 201);
    const body = res.json();
    assert.equal(body.org_id, ORG_A);
    assert.equal(body.route_id, 'route-a-1');
    await app.close();
  });

  it('dispatcher can also create a route — real 201', async () => {
    const app = await buildTestApp(fakeAuth(asRole('dispatcher', ORG_A)));
    const res = await app.inject({
      method: 'POST',
      url: '/api/routes',
      payload: { route_id: 'route-a-2', driver_id: 'driver-a1', cargo_class: 'produce' },
    });
    assert.equal(res.statusCode, 201);
    await app.close();
  });

  it('compliance_officer can read routes but cannot create one — real 200, then real 403', async () => {
    const readApp = await buildTestApp(fakeAuth(asRole('compliance_officer', ORG_A)));
    const readRes = await readApp.inject({ method: 'GET', url: '/api/routes' });
    assert.equal(readRes.statusCode, 200);
    assert.ok(readRes.json().routes.some((r: { route_id: string }) => r.route_id === 'route-a-1'));
    await readApp.close();

    const writeApp = await buildTestApp(fakeAuth(asRole('compliance_officer', ORG_A)));
    const writeRes = await writeApp.inject({
      method: 'POST',
      url: '/api/routes',
      payload: { route_id: 'route-a-3', driver_id: 'driver-a1', cargo_class: 'pharma' },
    });
    assert.equal(writeRes.statusCode, 403);
    await writeApp.close();
  });

  it('driver cannot read or create routes at all — real 403 on both', async () => {
    const readApp = await buildTestApp(fakeAuth(asRole('driver', ORG_A)));
    const readRes = await readApp.inject({ method: 'GET', url: '/api/routes' });
    assert.equal(readRes.statusCode, 403);
    await readApp.close();

    const writeApp = await buildTestApp(fakeAuth(asRole('driver', ORG_A)));
    const writeRes = await writeApp.inject({
      method: 'POST',
      url: '/api/routes',
      payload: { route_id: 'route-a-4', driver_id: 'driver-a1', cargo_class: 'pharma' },
    });
    assert.equal(writeRes.statusCode, 403);
    await writeApp.close();
  });

  it('a driver token from ANOTHER org cannot see org A\'s route — real 404, not a leak', async () => {
    // org_admin in ORG_B has full read/write in their own org, but route-a-1
    // belongs to ORG_A — this is the cross-org isolation case, tested at the
    // most-permissive role specifically so a failure can only mean the
    // org-scoping query itself is wrong, not a role gate hiding it.
    const app = await buildTestApp(fakeAuth(asRole('org_admin', ORG_B)));
    const res = await app.inject({ method: 'GET', url: '/api/routes/route-a-1' });
    assert.equal(res.statusCode, 404);
    await app.close();
  });

  it("org B's route list never includes org A's routes", async () => {
    const app = await buildTestApp(fakeAuth(asRole('org_admin', ORG_B)));
    const res = await app.inject({ method: 'GET', url: '/api/routes' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json().routes, []);
    await app.close();
  });

  it('a session with no active organization gets 403, not a crash', async () => {
    const app = await buildTestApp(fakeAuth(asRole('org_admin', null)));
    const res = await app.inject({ method: 'GET', url: '/api/routes' });
    assert.equal(res.statusCode, 403);
    await app.close();
  });

  it('production wiring defaults to the real requireAuth, not a fake — real 401 with no token', async () => {
    const app = Fastify();
    registerRouteRoutes(app, { connectionString: connectionString ?? '' }); // no authenticate override
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/routes' });
    assert.equal(res.statusCode, 401);
    await app.close();
  });
});
