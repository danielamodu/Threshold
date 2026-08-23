/**
 * Seeds the hackathon demo data as a real org (§11 Phase 7, item 4):
 * route-phx-01 / driver-42 / pharma becomes actual rows in orgs/drivers/
 * routes, not deleted and not left as in-memory-only fixture data.
 *
 * ── Why the ids are arguments and not constants ──────────────────────────────
 * The driver role's `read: 'own'` scope resolves through
 * `DriverStore.getByClerkUser(orgId, userId)`, and both of those come from the
 * verified session token: `orgId` from Clerk's `o.id` claim, `userId` from
 * `sub` (see apps/api/src/auth.ts). Neither can be guessed. `DEMO_ORG_ID` is a
 * placeholder string, not a real Clerk org id, so rows seeded under it are
 * unreachable from any signed-in session — and a fabricated `clerk_user_id`
 * would be worse than a null one, because it would look linked while matching
 * nobody, forever.
 *
 * So both are overridable, and the defaults are unchanged from before:
 *
 *   --org <clerk-org-id>     or DEMO_ORG_ID              (default: the placeholder)
 *   --clerk-user <user-id>   or DEMO_DRIVER_CLERK_USER_ID (default: unlinked)
 *
 * Pass both and the driver role works on a fresh install. Pass neither and the
 * seed still succeeds exactly as it did, and says plainly which link is missing
 * rather than leaving the driver role silently empty. Both ids are printed by
 * Clerk's dashboard, and `GET /api/drivers/me` reports what the current session
 * actually resolves to.
 *
 * Idempotent: every write is get-then-create, and re-running with a
 * `--clerk-user` re-links rather than failing.
 *
 *   npm run seed --workspace @threshold/accounts
 *   npm run seed --workspace @threshold/accounts -- --url postgresql://...
 *   npm run seed --workspace @threshold/accounts -- --org org_2ab... --clerk-user user_2cd...
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

/**
 * `orgs_slug_key` is unique, so seeding a real Clerk org id cannot reuse the
 * placeholder org's slug — that row may already hold it. Clerk org ids are
 * themselves unique, so deriving the slug from the id is collision-free.
 */
function slugFor(orgId: string): string {
  if (orgId === DEMO_ORG_ID) return DEMO_ORG_SLUG;
  return orgId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function main(): Promise<number> {
  const connectionString = resolveConnectionString();
  const orgId = arg('org') ?? process.env.DEMO_ORG_ID ?? DEMO_ORG_ID;
  const clerkUserId = arg('clerk-user') ?? process.env.DEMO_DRIVER_CLERK_USER_ID;

  const orgs = new OrgStore(connectionString);
  const drivers = new DriverStore(connectionString);
  const routes = new RouteStore(connectionString);

  try {
    let org = await orgs.get(orgId);
    if (org) {
      console.log(`org already exists: ${org.id} (${org.name})`);
    } else {
      org = await orgs.create({ id: orgId, name: DEMO_ORG_NAME, slug: slugFor(orgId) });
      console.log(`created org: ${org.id} (${org.name})`);
    }

    let driver = await drivers.get(orgId, DEMO_DRIVER_ID);
    if (driver) {
      console.log(`driver already exists: ${driver.driver_id}`);
    } else {
      driver = await drivers.create({
        org_id: orgId,
        driver_id: DEMO_DRIVER_ID,
        name: 'Demo Driver',
        ...(clerkUserId ? { clerk_user_id: clerkUserId } : {}),
      });
      console.log(
        `created driver: ${driver.driver_id}` +
          (driver.clerk_user_id ? ` (linked to ${driver.clerk_user_id})` : ''),
      );
    }

    // Re-link on re-run, so correcting a wrong id or linking an
    // already-seeded driver doesn't require touching SQL by hand. Skipped when
    // it would be a no-op, so the common re-run stays silent.
    if (clerkUserId && driver.clerk_user_id !== clerkUserId) {
      const relinked = await drivers.linkClerkUser({
        org_id: orgId,
        driver_id: DEMO_DRIVER_ID,
        clerk_user_id: clerkUserId,
      });
      if (!relinked) throw new Error(`driver ${DEMO_DRIVER_ID} vanished between read and update`);
      driver = relinked;
      console.log(`linked driver ${driver.driver_id} to Clerk user ${clerkUserId}`);
    }

    const existingRoutes = await routes.listForOrg(orgId);
    const existingRoute = existingRoutes.find((r) => r.route_id === DEMO_ROUTE_ID);
    if (existingRoute) {
      console.log(`route already exists: ${existingRoute.route_id}`);
    } else {
      const route = await routes.create({
        org_id: orgId,
        route_id: DEMO_ROUTE_ID,
        cargo_class: DEMO_CARGO_CLASS,
        driver_id: DEMO_DRIVER_ID,
      });
      console.log(`created route: ${route.route_id}`);
    }

    console.log(`\nSeed complete. org_id = ${orgId}`);
    reportDriverRole(orgId, driver.clerk_user_id);
    return 0;
  } finally {
    await orgs.close();
    await drivers.close();
    await routes.close();
  }
}

/**
 * The driver role is the one role that can be structurally empty while every
 * other role looks fine, because it is the only one scoped through an identity
 * link. Saying so here is the difference between a seed that "worked" and a
 * demo where a signed-in driver sees nothing and nobody knows why.
 */
function reportDriverRole(orgId: string, clerkUserId: string | null): void {
  const placeholderOrg = orgId === DEMO_ORG_ID;
  if (!placeholderOrg && clerkUserId) {
    console.log(
      `Driver role: ready. A session for Clerk user ${clerkUserId} acting in ${orgId} ` +
        `resolves to driver ${DEMO_DRIVER_ID} and sees that driver's records.`,
    );
    return;
  }

  console.log('Driver role: NOT reachable yet from a signed-in session.');
  if (placeholderOrg) {
    console.log(
      `  - org_id is the placeholder '${DEMO_ORG_ID}', not a Clerk org id. GET /api/audit ` +
        `scopes on the org id in the session token, which will never equal this. ` +
        `Re-run with --org <clerk-org-id>.`,
    );
  }
  if (!clerkUserId) {
    console.log(
      `  - driver ${DEMO_DRIVER_ID} has no clerk_user_id, so getByClerkUser finds nothing and ` +
        `the driver's feed comes back empty with driver_unlinked: true. Re-run with ` +
        `--clerk-user <user-id>, or link it from the admin Drivers page.`,
    );
  }
  console.log('  Everything else (dispatcher, compliance, admin) is unaffected by this.');
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error('\nSEED FAILED');
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exit(1);
  });
