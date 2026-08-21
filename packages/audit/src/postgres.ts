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

    const { rows } = await client.query<{
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
  }

  async read(): Promise<AuditLogEntry[]> {
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

  async close(): Promise<void> {
    if (this.client) {
      const c = this.client;
      this.client = undefined;
      await c.end();
    }
  }
}
