/**
 * Seeds the hackathon demo data as a real org (§11 Phase 7, item 4):
 * route-phx-01 / driver-42 / pharma becomes actual rows in orgs/drivers/
 * routes, not deleted and not left as in-memory-only fixture data.
 *
 * `DEMO_ORG_ID` is a placeholder, not a real Clerk id — Clerk hasn't been
 * wired yet (blocked on CLERK_SECRET_KEY/CLERK_PUBLISHABLE_KEY, which don't
 * exist in .env). Once a real Clerk organization exists, replace this
 * constant with Clerk's actual org id and re-point the demo (Manus's
 * skeleton, /api/simulate, apps/web's action) at it — everything downstream
 * reads org_id from one place, so that is a one-line change, not a rewrite.
 *
 * Idempotent: safe to run more than once, `ON CONFLICT DO NOTHING` throughout.
 *
 *   npm run seed --workspace @threshold/accounts
 *   npm run seed --workspace @threshold/accounts -- --url postgresql://...
 */

import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import {
  DEMO_CARGO_CLASS,
  DEMO_DRIVER_ID,
  DEMO_ORG_ID,
  DEMO_ORG_NAME,
  DEMO_ORG_SLUG,
  DEMO_ROUTE_ID,
} from '../src/demo-org.js';
import { OrgStore } from '../src/orgs.js';
import { DriverStore } from '../src/drivers.js';
import { RouteStore } from '../src/routes.js';

loadDotenv({ path: resolve(import.meta.dirname, '../../../.env') });

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function resolveConnectionString(): string {
  const url = arg('url') ?? process.env.NEON_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('No connection string. Set NEON_DATABASE_URL in .env or pass --url.');
  return url;
}

async function main(): Promise<number> {
  const connectionString = resolveConnectionString();
  const orgs = new OrgStore(connectionString);
  const drivers = new DriverStore(connectionString);
  const routes = new RouteStore(connectionString);

  try {
    let org = await orgs.get(DEMO_ORG_ID);
    if (org) {
      console.log(`org already exists: ${org.id} (${org.name})`);
    } else {
      org = await orgs.create({ id: DEMO_ORG_ID, name: DEMO_ORG_NAME, slug: DEMO_ORG_SLUG });
      console.log(`created org: ${org.id} (${org.name})`);
    }

    let driver = await drivers.get(DEMO_ORG_ID, DEMO_DRIVER_ID);
    if (driver) {
      console.log(`driver already exists: ${driver.driver_id}`);
    } else {
      driver = await drivers.create({ org_id: DEMO_ORG_ID, driver_id: DEMO_DRIVER_ID, name: 'Demo Driver' });
      console.log(`created driver: ${driver.driver_id}`);
    }

    const existingRoutes = await routes.listForOrg(DEMO_ORG_ID);
    const existingRoute = existingRoutes.find((r) => r.route_id === DEMO_ROUTE_ID);
    if (existingRoute) {
      console.log(`route already exists: ${existingRoute.route_id}`);
    } else {
      const route = await routes.create({
        org_id: DEMO_ORG_ID,
        route_id: DEMO_ROUTE_ID,
        cargo_class: DEMO_CARGO_CLASS,
        driver_id: DEMO_DRIVER_ID,
      });
      console.log(`created route: ${route.route_id}`);
    }

    console.log(`\nSeed complete. org_id = ${DEMO_ORG_ID}`);
    return 0;
  } finally {
    await orgs.close();
    await drivers.close();
    await routes.close();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error('\nSEED FAILED');
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exit(1);
  });
