/**
 * Real integration tests for GET /api/audit — a genuine HTTP request through
 * the real Fastify route and the real Postgres-backed PostgresAuditSink.
 *
 * audit_log is append-only (trigger-enforced, blocks DELETE even for the
 * table owner — confirmed the hard way: an earlier version of this file
 * tried to clean up test-inserted rows and the trigger correctly rejected
 * it). So this never inserts NEW audit_log rows for a disposable org: it
 * asserts against the real, permanent rows already produced for
 * DEMO_ORG_ID/DEMO_ROUTE_ID by the Phase 7 proof run
 * (apps/api/scripts/verify-org-scoped.ts) instead, and uses a separate org
 * — ORG_B — ONLY for the cross-org isolation check, since ORG_B never
 * receives any audit_log row and so can still be fully cleaned up.
 */

import { resolve } from 'node:path';
import { strict as assert } from 'node:assert';
import { describe, it, before, after } from 'node:test';
import { config as loadDotenv } from 'dotenv';
import Fastify from 'fastify';
import { Client } from 'pg';
import { DEMO_ORG_ID, DEMO_ROUTE_ID, OrgStore, type Role } from '@threshold/accounts';
import { registerAuditRoutes } from '../src/routes/audit.js';
import type { ThresholdAuth } from '../src/auth.js';

loadDotenv({ path: resolve(import.meta.dirname, '../../../.env') });

const connectionString =
  process.env.THRESHOLD_TEST_DB_URL ?? process.env.NEON_DATABASE_URL ?? process.env.DATABASE_URL;

const needsSsl = (url: string) => /sslmode=require/i.test(url) || /\.neon\.tech/i.test(url);

const ORG_B = 'org_test_audit_isolation_b';

function fakeAuth(auth: ThresholdAuth) {
  return async (request: { auth?: ThresholdAuth }) => {
    request.auth = auth;
  };
}

function asRole(role: Role | null, orgId: string | null): ThresholdAuth {
  return { userId: 'user_test', orgId, role };
}

async function buildTestApp(authenticate: ReturnType<typeof fakeAuth>) {
  const app = Fastify();
  registerAuditRoutes(app, { connectionString: connectionString ?? '', authenticate });
  await app.ready();
  return app;
}

describe('/api/audit (requires a real Postgres)', { skip: !connectionString }, () => {
  before(async () => {
    // ORG_B never receives an audit_log row, so — unlike audit_log itself —
    // it's safe to create and fully delete.
    const orgs = new OrgStore(connectionString ?? '');
    const existing = await orgs.get(ORG_B);
    if (!existing) {
      await orgs.create({ id: ORG_B, name: 'Audit Isolation Test Org B', slug: 'test-audit-isolation-b' });
    }
    await orgs.close();
  });

  after(async () => {
    const client = new Client({
      connectionString,
      ...(connectionString && needsSsl(connectionString) ? { ssl: { rejectUnauthorized: true } } : {}),
    });
    await client.connect();
    await client.query('delete from public.orgs where id = $1', [ORG_B]);
    await client.end();
  });

  it('org_admin sees real, permanent audit entries for the real demo org', async () => {
    const app = await buildTestApp(fakeAuth(asRole('org_admin', DEMO_ORG_ID)));
    const res = await app.inject({ method: 'GET', url: '/api/audit' });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(body.entries.length > 0, 'expected the real Phase 7 proof-run rows to still be present');
    assert.ok(body.entries.every((e: { org_id: string }) => e.org_id === DEMO_ORG_ID));
    assert.ok(body.entries.some((e: { route_id: string | null }) => e.route_id === DEMO_ROUTE_ID));
    await app.close();
  });

  it("a different org never sees the demo org's entries", async () => {
    const app = await buildTestApp(fakeAuth(asRole('org_admin', ORG_B)));
    const res = await app.inject({ method: 'GET', url: '/api/audit' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json().entries, []);
    await app.close();
  });

  it('dispatcher and compliance_officer can also read (org_wide)', async () => {
    for (const role of ['dispatcher', 'compliance_officer'] as const) {
      const app = await buildTestApp(fakeAuth(asRole(role, DEMO_ORG_ID)));
      const res = await app.inject({ method: 'GET', url: '/api/audit' });
      assert.equal(res.statusCode, 200, `${role} should read audit_log`);
      assert.ok(res.json().entries.length > 0);
      await app.close();
    }
  });

  it("driver gets an honestly empty feed, not an error or another driver's data — no Clerk-user-to-driver_id link exists yet", async () => {
    const app = await buildTestApp(fakeAuth(asRole('driver', DEMO_ORG_ID)));
    const res = await app.inject({ method: 'GET', url: '/api/audit' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json().entries, []);
    await app.close();
  });

  it('a session with no active organization gets 403, not a crash', async () => {
    const app = await buildTestApp(fakeAuth(asRole('org_admin', null)));
    const res = await app.inject({ method: 'GET', url: '/api/audit' });
    assert.equal(res.statusCode, 403);
    await app.close();
  });

  it('production wiring defaults to the real requireAuth — real 401 with no token', async () => {
    const app = Fastify();
    registerAuditRoutes(app, { connectionString: connectionString ?? '' });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/audit' });
    assert.equal(res.statusCode, 401);
    await app.close();
  });
});
