/**
 * Real integration tests for POST /api/routes/:route_id/forecast.
 * Genuine HTTP through the real Fastify route, real role gate, and real
 * Neon-backed RouteStore — backed by the cached 2024-07-15 fixture via the
 * same CachedFortyGuardThermalReadingSource the demo uses. Requires a real
 * NEON_DATABASE_URL; skips without one.
 */

import { resolve } from 'node:path';
import { strict as assert } from 'node:assert';
import { describe, it, before, after } from 'node:test';
import { config as loadDotenv } from 'dotenv';
import Fastify from 'fastify';
import { Client } from 'pg';
import { OrgStore, DriverStore, type Role } from '@threshold/accounts';
import { registerForecastRoutes } from '../src/routes/forecast.js';
import type { ThresholdAuth } from '../src/auth.js';

loadDotenv({ path: resolve(import.meta.dirname, '../../../.env') });

const connectionString =
  process.env.THRESHOLD_TEST_DB_URL ?? process.env.NEON_DATABASE_URL ?? process.env.DATABASE_URL;

const needsSsl = (url: string) => /sslmode=require/i.test(url) || /\.neon\.tech/i.test(url);

const ORG = 'org_test_forecast_endpoint';
const DRIVER = 'driver-forecast-1';
const ROUTE_ID = 'route-forecast-1';

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
  registerForecastRoutes(app, { connectionString: connectionString ?? '', authenticate });
  await app.ready();
  return app;
}

describe('POST /api/routes/:route_id/forecast (requires a real Postgres)', { skip: !connectionString }, () => {
  before(async () => {
    const client = new Client({
      connectionString,
      ...(connectionString && needsSsl(connectionString) ? { ssl: { rejectUnauthorized: true } } : {}),
    });
    await client.connect();
    await client.query('delete from public.routes where org_id = $1', [ORG]);
    await client.query('delete from public.drivers where org_id = $1', [ORG]);
    await client.query('delete from public.orgs where id = $1', [ORG]);
    await client.end();

    const orgs = new OrgStore(connectionString ?? '');
    const drivers = new DriverStore(connectionString ?? '');
    await orgs.create({ id: ORG, name: 'Forecast Test Org', slug: 'test-forecast' });
    await drivers.create({ org_id: ORG, driver_id: DRIVER, name: 'Forecast Driver' });
    // Route needed for the forecast to resolve — waypoints come from the demo template in the forecast scorer.
    const { RouteStore } = await import('@threshold/accounts');
    const routes = new RouteStore(connectionString ?? '');
    await routes.create({ org_id: ORG, route_id: ROUTE_ID, driver_id: DRIVER, cargo_class: 'pharma' });
    await routes.close();
    await orgs.close();
    await drivers.close();
  });

  after(async () => {
    const client = new Client({
      connectionString,
      ...(connectionString && needsSsl(connectionString) ? { ssl: { rejectUnauthorized: true } } : {}),
    });
    await client.connect();
    await client.query('delete from public.routes where org_id = $1', [ORG]);
    await client.query('delete from public.drivers where org_id = $1', [ORG]);
    await client.query('delete from public.orgs where id = $1', [ORG]);
    await client.end();
  });

  it('returns a per-waypoint forecast with the honest replay label', async () => {
    const app = await buildTestApp(fakeAuth(asRole('dispatcher', ORG)));
    const res = await app.inject({
      method: 'POST',
      url: `/api/routes/${ROUTE_ID}/forecast`,
      payload: { departure_time: '2024-07-15T06:00:00.000Z' },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.route_id, ROUTE_ID);
    assert.equal(body.forecast_source, 'historical_replay_2024-07-15');
    assert.equal(body.departure_time, '2024-07-15T06:00:00.000Z');
    assert.equal(body.waypoints.length, 4);
    for (const w of body.waypoints) {
      assert.ok(typeof w.projected_temp_c === 'number');
      assert.ok(['nominal', 'elevated', 'breach'].includes(w.cargo.risk_level));
      assert.ok(['none', 'reroute', 'claim_draft'].includes(w.cargo.recommended_action));
      assert.ok(typeof w.projected_time === 'string');
    }
    // The fixture's natural arc is nominal → elevated → breach → breach for pharma.
    assert.equal(body.waypoints[0].cargo.risk_level, 'nominal');
    assert.equal(body.waypoints[2].cargo.risk_level, 'breach');
    assert.equal(body.route_risk_summary.safe_to_depart, false);
    assert.equal(body.route_risk_summary.first_breach_waypoint, 'wp-3');
    assert.ok(body.route_risk_summary.first_breach_time);
    await app.close();
  });

  it('departure time is reflected in projected_time per waypoint', async () => {
    const app = await buildTestApp(fakeAuth(asRole('dispatcher', ORG)));
    const res = await app.inject({
      method: 'POST',
      url: `/api/routes/${ROUTE_ID}/forecast`,
      payload: { departure_time: '2024-07-15T09:00:00.000Z' },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.waypoints[0].projected_time, '2024-07-15T09:00:00.000Z');
    assert.equal(body.waypoints[1].projected_time, '2024-07-15T10:00:00.000Z');
    assert.equal(body.waypoints[3].projected_time, '2024-07-15T12:00:00.000Z');
    await app.close();
  });

  it('400 when departure_time is missing', async () => {
    const app = await buildTestApp(fakeAuth(asRole('dispatcher', ORG)));
    const res = await app.inject({
      method: 'POST',
      url: `/api/routes/${ROUTE_ID}/forecast`,
      payload: {},
    });
    assert.equal(res.statusCode, 400);
    await app.close();
  });

  it('400 when departure_time is not ISO8601', async () => {
    const app = await buildTestApp(fakeAuth(asRole('dispatcher', ORG)));
    const res = await app.inject({
      method: 'POST',
      url: `/api/routes/${ROUTE_ID}/forecast`,
      payload: { departure_time: 'not-a-date' },
    });
    assert.equal(res.statusCode, 400);
    await app.close();
  });

  it('404 when route does not exist in this org', async () => {
    const app = await buildTestApp(fakeAuth(asRole('dispatcher', ORG)));
    const res = await app.inject({
      method: 'POST',
      url: '/api/routes/does-not-exist/forecast',
      payload: { departure_time: '2024-07-15T06:00:00.000Z' },
    });
    assert.equal(res.statusCode, 404);
    await app.close();
  });

  it('a driver role cannot call forecast — 403', async () => {
    const app = await buildTestApp(fakeAuth(asRole('driver', ORG)));
    const res = await app.inject({
      method: 'POST',
      url: `/api/routes/${ROUTE_ID}/forecast`,
      payload: { departure_time: '2024-07-15T06:00:00.000Z' },
    });
    assert.equal(res.statusCode, 403);
    await app.close();
  });

  it('401 when no token (production wiring)', async () => {
    const app = Fastify();
    registerForecastRoutes(app, { connectionString: connectionString ?? '' });
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: `/api/routes/${ROUTE_ID}/forecast`,
      payload: { departure_time: '2024-07-15T06:00:00.000Z' },
    });
    assert.equal(res.statusCode, 401);
    await app.close();
  });
});
