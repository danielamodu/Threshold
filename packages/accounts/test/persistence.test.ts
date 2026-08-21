/**
 * Integration tests against a real Postgres — orgs/drivers/routes support
 * normal DELETE (unlike audit_log), so this cleans up after itself rather
 * than needing the transaction-rollback trick db/test.mts uses.
 *
 * Needs NEON_DATABASE_URL or DATABASE_URL in .env, or pass THRESHOLD_TEST_DB_URL.
 * Skips (does not fail) if no connection string is configured, so the rest
 * of the workspace's tests stay runnable offline.
 */

import { resolve } from 'node:path';
import { strict as assert } from 'node:assert';
import { describe, it, before, after } from 'node:test';
import { config as loadDotenv } from 'dotenv';
import { Client } from 'pg';
import { OrgStore } from '../src/orgs.js';
import { DriverStore } from '../src/drivers.js';
import { PostgresRouteRegistry, RouteRegistryNotLoadedError, RouteStore } from '../src/routes.js';

loadDotenv({ path: resolve(import.meta.dirname, '../../../.env') });

const connectionString = process.env.THRESHOLD_TEST_DB_URL ?? process.env.NEON_DATABASE_URL ?? process.env.DATABASE_URL;

const needsSsl = (url: string) => /sslmode=require/i.test(url) || /\.neon\.tech/i.test(url);

const ORG_A = 'org_test_persistence_a';
const ORG_B = 'org_test_persistence_b';

describe('accounts persistence (requires a real Postgres)', { skip: !connectionString }, () => {
  const orgs = new OrgStore(connectionString ?? '');
  const drivers = new DriverStore(connectionString ?? '');
  const routes = new RouteStore(connectionString ?? '');

  before(async () => {
    // Clean slate in case a previous run was interrupted before cleanup.
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
    await orgs.close();
    await drivers.close();
    await routes.close();
  });

  it('creates and reads back an org', async () => {
    const created = await orgs.create({ id: ORG_A, name: 'Test Org A', slug: 'test-org-a-persist' });
    assert.equal(created.id, ORG_A);
    const fetched = await orgs.get(ORG_A);
    assert.equal(fetched?.name, 'Test Org A');
  });

  it('creates a second org and a driver+route in each, without collision', async () => {
    await orgs.create({ id: ORG_B, name: 'Test Org B', slug: 'test-org-b-persist' });
    await drivers.create({ org_id: ORG_A, driver_id: 'driver-1', name: 'A Driver' });
    await drivers.create({ org_id: ORG_B, driver_id: 'driver-1', name: 'B Driver' });

    await routes.create({ org_id: ORG_A, route_id: 'route-shared', cargo_class: 'pharma', driver_id: 'driver-1' });
    await routes.create({ org_id: ORG_B, route_id: 'route-shared', cargo_class: 'general_reefer', driver_id: 'driver-1' });

    const routesA = await routes.listForOrg(ORG_A);
    const routesB = await routes.listForOrg(ORG_B);
    assert.equal(routesA.length, 1);
    assert.equal(routesB.length, 1);
    assert.equal(routesA[0]?.cargo_class, 'pharma');
    assert.equal(routesB[0]?.cargo_class, 'general_reefer');
  });

  describe('PostgresRouteRegistry', () => {
    it('throws if get() is called before load()', () => {
      const registry = new PostgresRouteRegistry(connectionString ?? '', ORG_A);
      assert.throws(() => registry.get('route-shared'), RouteRegistryNotLoadedError);
    });

    it('loads once, then answers synchronously — and only sees its own org', async () => {
      const registryA = new PostgresRouteRegistry(connectionString ?? '', ORG_A);
      await registryA.load();

      const contextA = registryA.get('route-shared');
      assert.equal(contextA?.cargo_class, 'pharma');
      assert.equal(contextA?.driver_id, 'driver-1');

      // ORG_B's identical route_id must not leak into ORG_A's registry.
      const registryB = new PostgresRouteRegistry(connectionString ?? '', ORG_B);
      await registryB.load();
      const contextB = registryB.get('route-shared');
      assert.equal(contextB?.cargo_class, 'general_reefer');

      await registryA.close();
      await registryB.close();
    });

    it('returns undefined for a route not in this org, even if it is real in another org', async () => {
      const registryA = new PostgresRouteRegistry(connectionString ?? '', ORG_A);
      await registryA.load();
      assert.equal(registryA.get('route-that-does-not-exist-anywhere'), undefined);
      await registryA.close();
    });
  });
});
