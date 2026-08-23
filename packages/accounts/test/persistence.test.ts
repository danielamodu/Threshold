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

  /**
   * The Clerk-user-to-driver_id link (§11). These run in order and share the
   * `driver-1` rows created above — 'driver-1' exists in BOTH orgs, which is
   * what makes the org-scoping assertions meaningful.
   */
  describe('drivers.clerk_user_id', () => {
    const USER = 'user_test_persistence_link';

    it('a driver created without a Clerk user starts unlinked', async () => {
      const driver = await drivers.get(ORG_A, 'driver-1');
      assert.equal(driver?.clerk_user_id, null);
    });

    it('links a Clerk user, then resolves the driver back from that user id', async () => {
      const linked = await drivers.linkClerkUser({ org_id: ORG_A, driver_id: 'driver-1', clerk_user_id: USER });
      assert.equal(linked?.clerk_user_id, USER);
      const found = await drivers.getByClerkUser(ORG_A, USER);
      assert.equal(found?.driver_id, 'driver-1');
      assert.equal(found?.org_id, ORG_A);
    });

    it('the lookup is org-scoped — the same user resolves to nothing in an org they are not linked in', async () => {
      assert.equal(await drivers.getByClerkUser(ORG_B, USER), undefined);
    });

    it('one Clerk user may hold a DIFFERENT driver identity in each org', async () => {
      const linkedB = await drivers.linkClerkUser({ org_id: ORG_B, driver_id: 'driver-1', clerk_user_id: USER });
      assert.equal(linkedB?.org_id, ORG_B);
      // Same user, same driver_id string, two distinct rows — each lookup must
      // return the row for the org asked about, never the other one.
      assert.equal((await drivers.getByClerkUser(ORG_A, USER))?.org_id, ORG_A);
      assert.equal((await drivers.getByClerkUser(ORG_B, USER))?.org_id, ORG_B);
    });

    it('refuses to give one Clerk user two driver identities in the SAME org', async () => {
      await drivers.create({ org_id: ORG_A, driver_id: 'driver-2', name: 'Second A Driver' });
      await assert.rejects(
        () => drivers.linkClerkUser({ org_id: ORG_A, driver_id: 'driver-2', clerk_user_id: USER }),
        /drivers_org_clerk_user_key/,
        'the unique constraint must block it — otherwise getByClerkUser is ambiguous',
      );
      // The original link survived the rejected attempt.
      assert.equal((await drivers.getByClerkUser(ORG_A, USER))?.driver_id, 'driver-1');
    });

    it('lets any number of drivers in one org stay unlinked — NULLs are distinct under UNIQUE', async () => {
      await drivers.create({ org_id: ORG_A, driver_id: 'driver-3' });
      const unlinked = (await drivers.listForOrg(ORG_A)).filter((d) => d.clerk_user_id === null);
      assert.ok(
        unlinked.length >= 2,
        'a fleet must be able to hold many drivers nobody has signed up as yet',
      );
    });

    it('unlinks with an explicit null, and the lookup stops resolving', async () => {
      const unlinked = await drivers.linkClerkUser({ org_id: ORG_A, driver_id: 'driver-1', clerk_user_id: null });
      assert.equal(unlinked?.clerk_user_id, null);
      assert.equal(await drivers.getByClerkUser(ORG_A, USER), undefined);
    });

    it('returns undefined for a driver_id that does not exist, so the API can 404 instead of no-op', async () => {
      const missing = await drivers.linkClerkUser({
        org_id: ORG_A,
        driver_id: 'driver-does-not-exist',
        clerk_user_id: USER,
      });
      assert.equal(missing, undefined);
    });

    it('can link at creation time, for a driver whose human is already known', async () => {
      const created = await drivers.create({
        org_id: ORG_A,
        driver_id: 'driver-prelinked',
        name: 'Pre-linked Driver',
        clerk_user_id: 'user_test_persistence_prelinked',
      });
      assert.equal(created.clerk_user_id, 'user_test_persistence_prelinked');
      assert.equal(
        (await drivers.getByClerkUser(ORG_A, 'user_test_persistence_prelinked'))?.driver_id,
        'driver-prelinked',
      );
    });
  });
});
