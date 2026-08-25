/**
 * Real, org-scoped, role-gated audit/decision feed (§11 product-shell wiring
 * follow-up). Reads the real `audit_log` table via PostgresAuditSink —
 * nothing synthetic, nothing in-memory.
 *
 * The `driver` role's permission is `read: 'own'`
 * (packages/accounts/src/roles.ts) — scoped to records for THIS driver only.
 * Enforcing that needs to know which `driver_id` row belongs to the signed-in
 * Clerk user, which is what `drivers.clerk_user_id` now provides
 * (db/migrations/20260822140000_drivers_clerk_user_id.sql). A driver request
 * resolves that link, then pushes the filter down into SQL via
 * `readForOrg(orgId, { driverId })` — which joins through the `routes` table
 * rather than scanning jsonb payloads, and which already existed waiting for
 * a caller.
 *
 * An unlinked driver (no `clerk_user_id` matching their session) still gets
 * an empty feed, but the response says so with `driver_unlinked: true` rather
 * than being indistinguishable from "you have no records". That distinction
 * matters operationally: the first is an org_admin who hasn't run the
 * assignment step yet (POST /api/drivers/:driver_id/link), the second is a
 * correctly-configured driver whose routes simply haven't produced anything.
 * Falling back to the org-wide feed here would leak every other driver's
 * records, so unlinked stays empty — it is a configuration gap to surface,
 * not a permission to widen.
 */

import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { PostgresAuditSink } from '@threshold/audit';
import { DriverStore, canRead } from '@threshold/accounts';
import { requireAuth } from '../auth.js';
import { makeEnsureOrg } from '../org-ensure.js';

export function registerAuditRoutes(
  app: FastifyInstance,
  options: { connectionString: string; authenticate?: preHandlerHookHandler },
): void {
  const authenticate = options.authenticate ?? requireAuth;
  const sink = new PostgresAuditSink({ connectionString: options.connectionString });
  const drivers = new DriverStore(options.connectionString);
  const ensureOrg = makeEnsureOrg(options.connectionString);
  app.addHook('onClose', async () => {
    await sink.close();
    await drivers.close();
    await ensureOrg.close();
  });

  app.get(
    '/api/audit',
    { preHandler: [authenticate, ensureOrg.preHandler] },
    async (request, reply) => {
    const role = request.auth?.role;
    const orgId = request.auth?.orgId;
    const userId = request.auth?.userId;

    if (!orgId) {
      reply.code(403).send({ error: 'No active organization on this session.' });
      return;
    }
    if (!role) {
      reply.code(403).send({ error: 'No recognized role on this session.' });
      return;
    }

    const access = canRead(role, 'audit_log');
    if (access === 'none') {
      reply.code(403).send({ error: `Role '${role}' cannot read audit_log.` });
      return;
    }

    if (access === 'own') {
      if (!userId) {
        // requireAuth always sets userId from the token's `sub`, so this is
        // unreachable in production — guarded rather than asserted because an
        // injected test authenticate could omit it, and the failure mode of
        // treating a missing user id as "match anything" is a data leak.
        reply.code(403).send({ error: 'No user identity on this session.' });
        return;
      }

      const driver = await drivers.getByClerkUser(orgId, userId);
      if (!driver) {
        reply.send({ entries: [], driver_unlinked: true });
        return;
      }

      const entries = await sink.readForOrg(orgId, { driverId: driver.driver_id });
      reply.send({ entries, driver_id: driver.driver_id });
      return;
    }

    const entries = await sink.readForOrg(orgId);
    reply.send({ entries });
  });
}
