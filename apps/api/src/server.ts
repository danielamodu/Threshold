import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';

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
      database_url: Boolean(process.env.DATABASE_URL?.trim()),
    };
    const ready = Object.values(checks).every(Boolean);
    return reply.code(ready ? 200 : 503).send({ ready, checks });
  });

  return app;
}
