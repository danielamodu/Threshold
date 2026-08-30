/**
 * Pre-departure forecast endpoint (§11 — forecast-driven risk profile).
 *
 * POST /api/routes/:route_id/forecast
 * Body: { departure_time: ISO8601 }
 *
 * Resolves the route from the org-scoped store, then drives the existing
 * CachedFortyGuardThermalReadingSource + both evaluators with forecast
 * timestamps (departure_time + leg offsets). No audit writes, no side effects —
 * it's a read-only projection. Forecast numbers come from the 2024-07-15
 * historical replay fixture, labelled as such in the response.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { RouteStore, canRead } from '@threshold/accounts';
import { requireAuth } from '../auth.js';
import { makeEnsureOrg } from '../org-ensure.js';
import { FORECAST_SOURCE, runForecast } from '../forecast.js';

interface ForecastBody {
  departure_time?: string;
}

function requireRouteRead(need: 'read' = 'read') {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const role = request.auth?.role;
    if (!role) {
      reply.code(403).send({ error: 'No recognized role on this session.' });
      return;
    }
    const access = canRead(role, 'routes');
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

export function registerForecastRoutes(
  app: FastifyInstance,
  options: { connectionString: string; authenticate?: preHandlerHookHandler },
): void {
  const authenticate = options.authenticate ?? requireAuth;
  const store = new RouteStore(options.connectionString);
  const ensureOrg = makeEnsureOrg(options.connectionString);

  app.addHook('onClose', async () => {
    await store.close();
    await ensureOrg.close();
  });

  app.post<{ Params: { route_id: string }; Body: ForecastBody }>(
    '/api/routes/:route_id/forecast',
    { preHandler: [authenticate, ensureOrg.preHandler, requireRouteRead('read')] },
    async (request, reply) => {
      const orgId = requireOrg(request, reply);
      if (!orgId) return;

      const { departure_time } = request.body ?? {};
      if (!departure_time || typeof departure_time !== 'string') {
        reply.code(400).send({ error: 'departure_time (ISO8601) is required.' });
        return;
      }
      const dep = new Date(departure_time);
      if (Number.isNaN(dep.getTime())) {
        reply.code(400).send({ error: `Invalid departure_time: ${departure_time}` });
        return;
      }

      const routes = await store.listForOrg(orgId);
      const route = routes.find((r) => r.route_id === request.params.route_id);
      if (!route) {
        reply.code(404).send({ error: 'Route not found in your organization.' });
        return;
      }

      try {
        const forecast = await runForecast({
          route_id: route.route_id,
          cargo_class: route.cargo_class,
          driver_id: route.driver_id,
          departure_time: dep.toISOString(),
        });

        // Ensure the response's forecast_source is explicit — the caller must not mistake replay for live.
        if (forecast.forecast_source !== FORECAST_SOURCE) {
          request.log.warn({ forecast_source: forecast.forecast_source }, 'Unexpected forecast source');
        }

        return forecast;
      } catch (error) {
        request.log.error({ err: error, route_id: route.route_id }, 'Forecast failed');
        reply.code(500).send({ error: error instanceof Error ? error.message : String(error) });
      }
    },
  );
}
