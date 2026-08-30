/**
 * Postgres audit sink — the real Audit Layer (§2), writing to `audit_log`.
 *
 * DELIBERATE DESIGN CHOICE: this class does NOT read NEON_DATABASE_URL from the
 * environment. The connection string must be passed in explicitly. You cannot
 * end up writing to the production audit log by importing the wrong thing or by
 * having a stray env var set — you have to hand it a target on purpose.
 *
 * That guard exists because `audit_log` blocks DELETE by trigger. Anything
 * written here is permanent. A simulator run pointed at the production database
 * would embed synthetic fixtures in a real liability record with no way to
 * remove them. Point synthetic runs at a scratch database or a Neon branch.
 */

import { Client, type ClientConfig } from 'pg';
import type { AuditLogEntry, AuditLogInsert } from '@threshold/types';
import { assertLoggable, type AuditSink } from './sink.js';

const needsSsl = (url: string): boolean =>
  /sslmode=require/i.test(url) || /\.neon\.tech/i.test(url);

/**
 * Transaction-local tenant isolation for Neon + PgBouncer (transaction mode).
 * See packages/accounts/src/db.ts and the Phase 11 migration header for the
 * full verification. SET LOCAL ROLE + SET LOCAL GUC are pooler-safe; session
 * SET is not (verified live: a session SET leaked across Clients sharing a
 * backend PID). Every org-scoped audit operation wraps through this.
 */
async function withTenantContext<T>(
  client: Client,
  orgId: string,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  await client.query('begin');
  try {
    await client.query('set local role threshold_app');
    await client.query('select set_config($1, $2, true)', ['app.current_org_id', orgId]);
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      // secondary
    }
    throw error;
  }
}

interface PostgresAuditSinkOptions {
  /** Required, explicitly. Never defaulted from the environment — see above. */
  connectionString: string;
}

export class PostgresAuditSink implements AuditSink {
  private client: Client | undefined;
  private readonly config: ClientConfig;

  constructor({ connectionString }: PostgresAuditSinkOptions) {
    if (!connectionString || connectionString.trim() === '') {
      throw new Error(
        'PostgresAuditSink requires an explicit connectionString. It is never read ' +
          'from the environment, so that synthetic runs cannot reach the real ' +
          'append-only log by accident.',
      );
    }
    this.config = {
      connectionString,
      ...(needsSsl(connectionString) ? { ssl: { rejectUnauthorized: true } } : {}),
    };
  }

  private async connected(): Promise<Client> {
    if (!this.client) {
      this.client = new Client(this.config);
      await this.client.connect();
    }
    return this.client;
  }

  async append(entry: AuditLogInsert): Promise<AuditLogEntry> {
    assertLoggable(entry);
    const client = await this.connected();

    return withTenantContext(client, entry.org_id, async (tx) => {
      const { rows } = await tx.query<{
        seq: string;
        entry_id: string;
        recorded_at: Date;
      }>(
        `insert into public.audit_log
           (entry_type, event_id, route_id, org_id, payload, rationale, occurred_at)
         values ($1, $2, $3, $4, $5::jsonb, $6, $7)
         returning seq::text, entry_id, recorded_at`,
        [
          entry.entry_type,
          entry.event_id,
          entry.route_id ?? null,
          entry.org_id,
          JSON.stringify(entry.payload),
          entry.rationale ?? null,
          entry.occurred_at ?? null,
        ],
      );

      const row = rows[0];
      if (!row) throw new Error('audit_log insert returned no row');

      return {
        ...entry,
        seq: Number(row.seq),
        entry_id: row.entry_id,
        route_id: entry.route_id ?? null,
        rationale: entry.rationale ?? null,
        occurred_at: entry.occurred_at ?? null,
        recorded_at: row.recorded_at.toISOString(),
      } as AuditLogEntry;
    });
  }

  async read(): Promise<AuditLogEntry[]> {
    // Operator/maintenance path — intentionally bypasses RLS (runs as
    // neondb_owner with BYPASSRLS) so scripts like verify-org-scoped.ts can
    // inspect all tenants. Tenant-facing reads MUST use readForOrg, which
    // enforces RLS via withTenantContext below. Keeping read() as bypass is
    // what lets Phase 7's permanent demo rows remain inspectable without
    // fabricating a tenant context.
    const client = await this.connected();
    const { rows } = await client.query<{
      seq: string;
      entry_id: string;
      entry_type: AuditLogInsert['entry_type'];
      event_id: string;
      route_id: string | null;
      org_id: string;
      payload: unknown;
      rationale: string | null;
      occurred_at: Date | null;
      recorded_at: Date;
    }>(
      `select seq::text, entry_id, entry_type, event_id, route_id, org_id, payload,
              rationale, occurred_at, recorded_at
       from public.audit_log
       order by seq`,
    );

    return rows.map(
      (r) =>
        ({
          seq: Number(r.seq),
          entry_id: r.entry_id,
          entry_type: r.entry_type,
          event_id: r.event_id,
          route_id: r.route_id,
          org_id: r.org_id,
          payload: r.payload,
          rationale: r.rationale,
          occurred_at: r.occurred_at ? r.occurred_at.toISOString() : null,
          recorded_at: r.recorded_at.toISOString(),
        }) as AuditLogEntry,
    );
  }

  /**
   * Org-scoped read (§11 Phase 7 follow-up) — filters at the SQL level, never
   * by fetching every org's rows into Node and filtering after. `driverId`
   * restricts further to routes assigned to that driver (via the `routes`
   * table, not a jsonb payload scan) — the row-level check the `driver` role
   * needs (audit_log read='own' in the signed-off permission table).
   */
  async readForOrg(orgId: string, options: { driverId?: string } = {}): Promise<AuditLogEntry[]> {
    const client = await this.connected();
    return withTenantContext(client, orgId, async (tx) => {
      const { rows } = await tx.query<{
        seq: string;
        entry_id: string;
        entry_type: AuditLogInsert['entry_type'];
        event_id: string;
        route_id: string | null;
        org_id: string;
        payload: unknown;
        rationale: string | null;
        occurred_at: Date | null;
        recorded_at: Date;
      }>(
        `select seq::text, entry_id, entry_type, event_id, route_id, org_id, payload,
                rationale, occurred_at, recorded_at
         from public.audit_log
         where org_id = $1
           and ($2::text is null or route_id in (
             select route_id from public.routes where org_id = $1 and driver_id = $2
           ))
         order by seq`,
        [orgId, options.driverId ?? null],
      );

      return rows.map(
        (r) =>
          ({
            seq: Number(r.seq),
            entry_id: r.entry_id,
            entry_type: r.entry_type,
            event_id: r.event_id,
            route_id: r.route_id,
            org_id: r.org_id,
            payload: r.payload,
            rationale: r.rationale,
            occurred_at: r.occurred_at ? r.occurred_at.toISOString() : null,
            recorded_at: r.recorded_at.toISOString(),
          }) as AuditLogEntry,
      );
    });
  }

  async close(): Promise<void> {
    if (this.client) {
      const c = this.client;
      this.client = undefined;
      await c.end();
    }
  }
}
