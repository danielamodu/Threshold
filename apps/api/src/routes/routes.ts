/**
 * Real route CRUD, org-scoped and role-gated (§11 Phase 7 follow-up).
 *
 * Distinct from GET /api/route (singular, in demo.ts) — that's the
 * hard-coded hackathon demo route, deliberately public, untouched. This is
 * the real, org-scoped resource: every read is confined to the caller's own
 * org, every write requires a role the signed-off permission table (§11
 * Phase 7, packages/accounts/src/roles.ts) actually grants it to.
 *
 * `authenticate` is injectable (defaults to the real `requireAuth`) purely so
 * tests can exercise this file's own role-gating and org-scoping logic
 * against real Postgres without needing a live Clerk session per role —
 * requireAuth's Clerk token verification is proven separately (live, against
 * a real signed-up account). Production always uses the real one; only test
 * code overrides it.
 */

import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from 'fastify';
import { RouteStore, canRead, canWrite } from '@threshold/accounts';
import type { CargoClass } from '@threshold/types';
import { requireAuth } from '../auth.js';

interface CreateRouteBody {
  route_id?: string;
  driver_id?: string;
  cargo_class?: CargoClass;
}

/**
 * 403 for "wrong role, right org" (the caller can see the org exists, so
 * there's nothing to hide). 404 for cross-org access, deliberately not 403 —
 * confirming a route exists in an org the caller isn't a member of would leak
 * its existence; from the caller's point of view it should look exactly like
 * it doesn't exist, same as a truly-nonexistent route_id.
 */
function requireRouteAccess(need: 'read' | 'write') {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const role = request.auth?.role;
    if (!role) {
      reply.code(403).send({ error: 'No recognized role on this session.' });
      return;
    }
    const access = need === 'read' ? canRead(role, 'routes') : canWrite(role, 'routes');
    if (access === 'none') {
      reply.code(403).send({ error: `Role '${role}' cannot ${need} routes.` });
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

export function registerRouteRoutes(
  app: FastifyInstance,
  options: { connectionString: string; authenticate?: preHandlerHookHandler },
): void {
  const authenticate = options.authenticate ?? requireAuth;
  const store = new RouteStore(options.connectionString);
  app.addHook('onClose', async () => {
    await store.close();
  });

  app.get(
    '/api/routes',
    { preHandler: [authenticate, requireRouteAccess('read')] },
    async (request, reply) => {
      const orgId = requireOrg(request, reply);
      if (!orgId) return;
      return { routes: await store.listForOrg(orgId) };
    },
  );

  app.get<{ Params: { route_id: string } }>(
    '/api/routes/:route_id',
    { preHandler: [authenticate, requireRouteAccess('read')] },
    async (request, reply) => {
      const orgId = requireOrg(request, reply);
      if (!orgId) return;
      const routes = await store.listForOrg(orgId);
      const route = routes.find((r) => r.route_id === request.params.route_id);
      if (!route) {
        reply.code(404).send({ error: 'Route not found in your organization.' });
        return;
      }
      return route;
    },
  );

  app.post<{ Body: CreateRouteBody }>(
    '/api/routes',
    { preHandler: [authenticate, requireRouteAccess('write')] },
    async (request, reply) => {
      const orgId = requireOrg(request, reply);
      if (!orgId) return;
      const { route_id, driver_id, cargo_class } = request.body ?? {};
      if (!route_id || !driver_id || !cargo_class) {
        reply.code(400).send({ error: 'route_id, driver_id, and cargo_class are required.' });
        return;
      }
      const route = await store.create({ org_id: orgId, route_id, driver_id, cargo_class });
      reply.code(201).send(route);
    },
  );
}
