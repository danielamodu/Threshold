import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { requireAuth } from './auth.js';
import { registerDemoRoutes } from './routes/demo.js';
import { registerRouteRoutes } from './routes/routes.js';

/**
 * Phase 0 scope: a deployable skeleton with liveness/readiness only.
 *
 * Deliberately absent until Phase 1+: ingestion, the event bus, and both
 * evaluators. Routes for those land with the phases that own them.
 */
export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      // The FortyGuard key travels as a request header to an upstream service and
      // is never attached to a request this server handles. Redaction paths are
      // declared anyway so a future proxy route cannot leak one by accident.
      redact: {
        paths: ['req.headers["api-key"]', 'req.headers.authorization', 'req.headers.cookie'],
        censor: '[REDACTED]',
      },
    },
  });

  await app.register(cors, { origin: true });

  app.get('/health', async () => ({
    status: 'ok',
    service: 'threshold-api',
    phase: 0,
    uptime_s: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  }));

  /**
   * Readiness reports whether required configuration is present. It reports
   * presence only — never a value, never a fragment of the key.
   */
  app.get('/ready', async (_request, reply) => {
    const checks = {
      fortyguard_api_key: Boolean(process.env.FORTYGUARD_API_KEY?.trim()),
      // Neon (§4). DATABASE_URL is accepted as a local-verification fallback,
      // matching the resolution order in db/migrate.ts.
      neon_database_url: Boolean(
        (process.env.NEON_DATABASE_URL || process.env.DATABASE_URL || '').trim(),
      ),
      clerk_secret_key: Boolean(process.env.CLERK_SECRET_KEY?.trim()),
    };
    const ready = Object.values(checks).every(Boolean);
    return reply.code(ready ? 200 : 503).send({ ready, checks });
  });

  registerDemoRoutes(app);

  /**
   * Proof-of-plumbing only, mirroring apps/web's /dashboard — NOT a real
   * product endpoint. Verified end to end against a live Clerk session; see
   * auth.ts's header for what that testing actually covered.
   */
  app.get('/api/me', { preHandler: requireAuth }, async (request) => request.auth);

  // Real, org-scoped, role-gated route CRUD — only mounted when a database is
  // actually configured, so buildServer() (used directly by tests with no DB
  // env set) doesn't fail just for existing.
  const connectionString = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;
  if (connectionString) {
    registerRouteRoutes(app, { connectionString });
  }

  return app;
}
