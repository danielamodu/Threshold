/**
 * Real, org-scoped, role-gated audit/decision feed (§11 product-shell wiring
 * follow-up). Reads the real `audit_log` table via PostgresAuditSink —
 * nothing synthetic, nothing in-memory.
 *
 * KNOWN GAP, flagged rather than papered over: the `driver` role's
 * permission is `read: 'own'` (packages/accounts/src/roles.ts) — scoped to
 * records for THIS driver only. Enforcing that requires knowing which
 * `driver_id` row corresponds to the signed-in Clerk user, and no such link
 * exists yet: `public.drivers` (db/migrations/20260821220000_org_multitenancy.sql)
 * has no `clerk_user_id` column, and nothing assigns one at sign-up or
 * invite time. Rather than guess (e.g. matching on name) or silently show
 * every driver's records, a driver session gets an honestly empty feed until
 * that identity link exists. Building it is a real, separate piece of work —
 * likely a `drivers.clerk_user_id` column plus an assignment step in the org
 * invite flow — not something to invent unasked inside this wiring pass.
 */

import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { PostgresAuditSink } from '@threshold/audit';
import { canRead } from '@threshold/accounts';
import { requireAuth } from '../auth.js';

export function registerAuditRoutes(
  app: FastifyInstance,
  options: { connectionString: string; authenticate?: preHandlerHookHandler },
): void {
  const authenticate = options.authenticate ?? requireAuth;
  const sink = new PostgresAuditSink({ connectionString: options.connectionString });
  app.addHook('onClose', async () => {
    await sink.close();
  });

  app.get('/api/audit', { preHandler: [authenticate] }, async (request, reply) => {
    const role = request.auth?.role;
    const orgId = request.auth?.orgId;

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
      // See header — no clerk_user_id -> driver_id link exists yet.
      reply.send({ entries: [] });
      return;
    }

    const entries = await sink.readForOrg(orgId);
    reply.send({ entries });
  });
}
