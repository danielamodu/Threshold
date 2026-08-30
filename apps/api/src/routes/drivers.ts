/**
 * Driver identity administration (§11 Phase 7 follow-up) — the assignment step
 * that makes the driver role's `read: 'own'` permission usable.
 *
 * WHY THESE ENDPOINTS EXIST
 * `drivers.clerk_user_id` is what GET /api/audit resolves to scope a driver's
 * feed, but a column nobody can populate is not a working feature. Before
 * this file, the only way a `drivers` row came into existence at all was the
 * seed script (packages/accounts/scripts/seed-demo-org.ts) — so a real org
 * signing up had no path to a driver record, and therefore none to a driver
 * who can see anything.
 *
 * WHY ADMIN-ASSIGNED AND NOT SELF-CLAIMED
 * The obvious shortcut — let a driver-role user claim a driver_id themselves —
 * is a privilege-escalation hole: `read: 'own'` is only a boundary if the
 * caller cannot choose which "own" means. Claiming `driver-42` would hand the
 * claimant every record belonging to that driver. So linking is gated on
 * `org_management` write, which the signed-off permission matrix grants to
 * `org_admin` alone. GET /api/drivers/me is the one endpoint any role may
 * call, and it only ever reports the caller's OWN link — it cannot be used to
 * discover or claim anyone else's.
 *
 * Reusing `org_management` rather than adding a `drivers` resource to the
 * permission matrix is deliberate: managing which human is which driver IS org
 * membership administration, and the matrix in packages/accounts/src/roles.ts
 * was signed off — widening its `Resource` union to gate one new endpoint
 * would edit approved Phase 7 policy for no behavioural gain.
 *
 * 404-not-403 for a driver_id absent from the caller's org, matching
 * routes.ts's reasoning: confirming a row exists in an org you are not acting
 * in leaks its existence.
 */

import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from 'fastify';
import { createClerkClient } from '@clerk/backend';
import { DriverStore, canRead, canWrite } from '@threshold/accounts';
import { requireAuth } from '../auth.js';
import { makeEnsureOrg } from '../org-ensure.js';

interface CreateDriverBody {
  driver_id?: string;
  name?: string;
  clerk_user_id?: string;
}

interface LinkDriverBody {
  /** null explicitly unlinks — the undo for a mis-assignment. */
  clerk_user_id?: string | null;
}

interface InviteDriverBody {
  email?: string;
}

/** Postgres SQLSTATEs this file translates into HTTP rather than a 500. */
const UNIQUE_VIOLATION = '23505';

function pgErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const { code } = error as { code: unknown };
  return typeof code === 'string' ? code : undefined;
}

function requireOrgManagement(need: 'read' | 'write') {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const role = request.auth?.role;
    if (!role) {
      reply.code(403).send({ error: 'No recognized role on this session.' });
      return;
    }
    const access =
      need === 'read' ? canRead(role, 'org_management') : canWrite(role, 'org_management');
    if (access === 'none') {
      reply.code(403).send({ error: `Role '${role}' cannot ${need} driver assignments.` });
    }
  };
}

function requireOrg(request: FastifyRequest, reply: FastifyReply): string | undefined {
  const orgId = request.auth?.orgId;
  if (!orgId) {
    reply.code(403).send({ error: 'No active organization on this session.' });
    return undefined;
  }
  return orgId;
}

export function registerDriverRoutes(
  app: FastifyInstance,
  options: { connectionString: string; authenticate?: preHandlerHookHandler },
): void {
  const authenticate = options.authenticate ?? requireAuth;
  const store = new DriverStore(options.connectionString);
  const ensureOrg = makeEnsureOrg(options.connectionString);
  app.addHook('onClose', async () => {
    await store.close();
    await ensureOrg.close();
  });

  /**
   * The caller's own driver link — every role may ask, and the answer is
   * always about themselves. This is what a driver-facing screen calls to tell
   * "you are not linked to a driver record yet" apart from "you have no
   * records yet", the same distinction GET /api/audit reports as
   * `driver_unlinked`.
   *
   * Registered before the parameterised routes below purely for readability;
   * Fastify's router matches the static `/me` segment ahead of a parameter
   * regardless of declaration order, so `me` can never be read as a driver_id.
   */
  app.get('/api/drivers/me', { preHandler: [authenticate, ensureOrg.preHandler] }, async (request, reply) => {
    const orgId = requireOrg(request, reply);
    if (!orgId) return;
    const userId = request.auth?.userId;
    if (!userId) {
      reply.code(403).send({ error: 'No user identity on this session.' });
      return;
    }
    const existing = await store.getByClerkUser(orgId, userId);
    if (existing) return { driver: existing };

    // Fallback auto-link: if webhook hasn't fired (or isn't configured), check
    // the Clerk membership for this user/org. If the membership's publicMetadata
    // contains a driver_id that matches an unlinked driver row, link it now.
    // This makes the invite flow work even when the webhook endpoint isn't yet
    // configured in the Clerk dashboard, or when Svix delivery is delayed.
    const secretKey = process.env.CLERK_SECRET_KEY?.trim();
    if (secretKey && request.auth?.role === 'driver') {
      try {
        const clerkClient = createClerkClient({ secretKey });
        // Fetch the membership for this user in this org
        const memberships = await clerkClient.organizations.getOrganizationMembershipList({
          organizationId: orgId,
          userId: [userId],
        });
        const membership = memberships.data?.[0];
        const driverId =
          (membership?.publicMetadata as Record<string, unknown> | undefined)?.driver_id ??
          (membership?.privateMetadata as Record<string, unknown> | undefined)?.driver_id;
        if (typeof driverId === 'string' && driverId) {
          const candidate = await store.get(orgId, driverId);
          if (candidate && !candidate.clerk_user_id) {
            try {
              const linked = await store.linkClerkUser({
                org_id: orgId,
                driver_id: driverId,
                clerk_user_id: userId,
              });
              if (linked) return { driver: linked };
            } catch {
              // If link fails (e.g., race, already linked elsewhere), fall through to null
            }
          }
        }
      } catch {
        // Clerk lookup failure is non-fatal for this endpoint — return unlinked
      }
    }
    return { driver: null };
  });

  app.get(
    '/api/drivers',
    { preHandler: [authenticate, ensureOrg.preHandler, requireOrgManagement('read')] },
    async (request, reply) => {
      const orgId = requireOrg(request, reply);
      if (!orgId) return;
      return { drivers: await store.listForOrg(orgId) };
    },
  );

  /**
   * Creating the driver row is part of this feature, not a bonus: `routes`
   * has a foreign key onto `(org_id, driver_id)`, so POST /api/routes for an
   * unknown driver_id fails at the database. Without this endpoint a real org
   * could not create its first route, let alone link a driver to it.
   */
  app.post<{ Body: CreateDriverBody }>(
    '/api/drivers',
    { preHandler: [authenticate, ensureOrg.preHandler, requireOrgManagement('write')] },
    async (request, reply) => {
      const orgId = requireOrg(request, reply);
      if (!orgId) return;
      const { driver_id, name, clerk_user_id } = request.body ?? {};
      if (!driver_id) {
        reply.code(400).send({ error: 'driver_id is required.' });
        return;
      }
      try {
        const driver = await store.create({
          org_id: orgId,
          driver_id,
          ...(name ? { name } : {}),
          ...(clerk_user_id ? { clerk_user_id } : {}),
        });
        reply.code(201).send(driver);
      } catch (error) {
        if (pgErrorCode(error) === UNIQUE_VIOLATION) {
          // Either driver_id already exists in this org
          // (drivers_org_driver_key) or that Clerk user is already another
          // driver here (drivers_org_clerk_user_key). Both are real conflicts
          // the caller has to resolve, not something to overwrite silently.
          reply.code(409).send({
            error: `Conflict: driver_id '${driver_id}' or that Clerk user is already assigned in this organization.`,
          });
          return;
        }
        throw error;
      }
    },
  );

  app.post<{ Params: { driver_id: string }; Body: LinkDriverBody }>(
    '/api/drivers/:driver_id/link',
    { preHandler: [authenticate, ensureOrg.preHandler, requireOrgManagement('write')] },
    async (request, reply) => {
      const orgId = requireOrg(request, reply);
      if (!orgId) return;

      // `undefined` (key absent) is rejected; explicit `null` is the
      // deliberate unlink. Collapsing the two would make a typo'd body
      // silently detach a working driver.
      const raw = request.body?.clerk_user_id;
      if (raw === undefined) {
        reply
          .code(400)
          .send({ error: 'clerk_user_id is required — pass null explicitly to unlink.' });
        return;
      }
      const clerk_user_id = raw === null ? null : raw.trim();
      if (clerk_user_id !== null && clerk_user_id.length === 0) {
        reply.code(400).send({ error: 'clerk_user_id cannot be blank — pass null to unlink.' });
        return;
      }

      try {
        const driver = await store.linkClerkUser({
          org_id: orgId,
          driver_id: request.params.driver_id,
          clerk_user_id,
        });
        if (!driver) {
          reply.code(404).send({ error: 'Driver not found in your organization.' });
          return;
        }
        return driver;
      } catch (error) {
        if (pgErrorCode(error) === UNIQUE_VIOLATION) {
          reply.code(409).send({
            error: 'That Clerk user is already linked to a different driver in this organization.',
          });
          return;
        }
        throw error;
      }
    },
  );

  /**
   * Invite-based linking — the primary, low-friction path. Admin enters an
   * email, we create a Clerk organization invitation with role `org:driver`
   * and publicMetadata `{ driver_id }`. When the invitee accepts, the
   * `/api/webhooks/clerk` handler (organizationMembership.created) reads that
   * metadata and auto-links. This avoids the manual "paste Clerk User ID" step.
   *
   * Keeps the manual paste as fallback — this is the easier path, not the only one.
   * If a driver is already linked, we 409 — show who's linked instead.
   */
  app.post<{ Params: { driver_id: string }; Body: InviteDriverBody }>(
    '/api/drivers/:driver_id/invite',
    { preHandler: [authenticate, ensureOrg.preHandler, requireOrgManagement('write')] },
    async (request, reply) => {
      const orgId = requireOrg(request, reply);
      if (!orgId) return;

      const email = request.body?.email?.trim();
      if (!email) {
        reply.code(400).send({ error: 'email is required.' });
        return;
      }
      // Basic email format check — Clerk will validate thoroughly, but failing fast
      // gives a clearer 400 without an extra round-trip.
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        reply.code(400).send({ error: 'Invalid email address.' });
        return;
      }

      const driver = await store.get(orgId, request.params.driver_id);
      if (!driver) {
        reply.code(404).send({ error: 'Driver not found in your organization.' });
        return;
      }
      if (driver.clerk_user_id) {
        reply.code(409).send({
          error: `Driver '${driver.driver_id}' is already linked to ${driver.clerk_user_id}. Unlink first or use a different driver.`,
        });
        return;
      }

      const secretKey = process.env.CLERK_SECRET_KEY?.trim();
      if (!secretKey) {
        reply.code(500).send({ error: 'CLERK_SECRET_KEY is not configured on this server.' });
        return;
      }

      try {
        const clerkClient = createClerkClient({ secretKey });
        const invitation = await clerkClient.organizations.createOrganizationInvitation({
          organizationId: orgId,
          emailAddress: email,
          role: 'org:driver' as const,
          publicMetadata: { driver_id: driver.driver_id },
          // Also set privateMetadata as fallback — webhook checks both
          privateMetadata: { driver_id: driver.driver_id },
          inviterUserId: request.auth?.userId,
          redirectUrl: `https://trythreshold.vercel.app/organization?invite_driver=${encodeURIComponent(driver.driver_id)}`,
        });
        reply.code(201).send({
          invitation_id: invitation.id,
          email_address: invitation.emailAddress,
          status: invitation.status,
          driver_id: driver.driver_id,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Clerk returns 422 for already invited / already a member — map to 409
        if (message.toLowerCase().includes('already') || message.toLowerCase().includes('exists')) {
          reply.code(409).send({ error: message });
          return;
        }
        request.log.error({ err: error, orgId, driverId: driver.driver_id, email }, 'Failed to create Clerk invitation');
        reply.code(502).send({ error: `Failed to create invitation: ${message}` });
      }
    },
  );

  app.patch<{ Params: { driver_id: string }; Body: { name?: string | null } }>(
    '/api/drivers/:driver_id',
    { preHandler: [authenticate, ensureOrg.preHandler, requireOrgManagement('write')] },
    async (request, reply) => {
      const orgId = requireOrg(request, reply);
      if (!orgId) return;
      const raw = request.body?.name;
      // Allow null/empty to clear the name; otherwise trim and keep
      const name = raw === null || raw === undefined ? null : String(raw).trim() || null;
      if (name !== null && name.length > 80) {
        reply.code(400).send({ error: 'Name must be 80 characters or fewer.' });
        return;
      }
      const driver = await store.updateName({ org_id: orgId, driver_id: request.params.driver_id, name });
      if (!driver) {
        reply.code(404).send({ error: 'Driver not found in your organization.' });
        return;
      }
      return driver;
    },
  );
}
