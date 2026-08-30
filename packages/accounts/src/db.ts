/**
 * Shared Postgres connection helper for this package's org/driver/route
 * persistence — factored out once three classes (orgs, drivers, routes) each
 * needed the identical lazy-connect + SSL-detection logic PostgresAuditSink
 * already established. Same rule as that class: connectionString is always
 * explicit, never read from the environment here, so a stray env var can't
 * silently point one of these at the wrong database.
 */

import { Client, type ClientConfig } from 'pg';

const needsSsl = (url: string): boolean =>
  /sslmode=require/i.test(url) || /\.neon\.tech/i.test(url);

/**
 * Run `fn` inside a tenant-scoped transaction that enforces Postgres RLS.
 *
 * Neon's pooled endpoint (hostname contains `-pooler`) runs PgBouncer in
 * transaction mode, which reassigns backends between transactions. A
 * session-level `SET app.current_org_id` leaks across checkouts (verified
 * live: one Client's session SET became visible on a second Client sharing
 * the same backend PID). `SET LOCAL` (`set_config(..., true)`) and
 * `SET LOCAL ROLE` are transaction-scoped and reset atomically at COMMIT,
 * which PgBouncer guarantees — see the migration header for the full
 * verification. Every org-scoped query MUST go through this helper.
 *
 * The chain is: BEGIN; SET LOCAL ROLE threshold_app (NOBYPASSRLS, subject to
 * policies); SELECT set_config('app.current_org_id', orgId, true); <work>;
 * COMMIT. Outside the transaction the connection reverts to neondb_owner
 * (BYPASSRLS, for operator/migration use).
 */
export async function withTenantContext<T>(
  client: Client,
  orgId: string,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  await client.query('begin');
  try {
    // Order: role first so the GUC is set as the app role. Both are LOCAL so
    // they vanish at COMMIT/ROLLBACK — pooler-safe.
    await client.query('set local role threshold_app');
    await client.query('select set_config($1, $2, true)', ['app.current_org_id', orgId]);
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      // rollback failure is secondary to the original error
    }
    throw error;
  }
}

export class LazyClient {
  private client: Client | undefined;
  private readonly config: ClientConfig;

  constructor(connectionString: string) {
    if (!connectionString || connectionString.trim() === '') {
      throw new Error('A connectionString is required and is never read from the environment.');
    }
    this.config = {
      connectionString,
      ...(needsSsl(connectionString) ? { ssl: { rejectUnauthorized: true } } : {}),
    };
  }

  async get(): Promise<Client> {
    if (!this.client) {
      this.client = new Client(this.config);
      await this.client.connect();
    }
    return this.client;
  }

  /**
   * Org-scoped transactional wrapper — equivalent to withTenantContext but
   * obtained via this LazyClient's single Client. Do not use for orgs table
   * (no RLS) or for operator/migration queries that intentionally bypass RLS.
   */
  async withTenant<T>(orgId: string, fn: (client: Client) => Promise<T>): Promise<T> {
    const client = await this.get();
    return withTenantContext(client, orgId, fn);
  }

  async close(): Promise<void> {
    if (this.client) {
      const c = this.client;
      this.client = undefined;
      await c.end();
    }
  }
}
