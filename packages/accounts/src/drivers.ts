/**
 * Driver persistence (§11 Phase 7).
 *
 * Previously `driver_id` was a bare string with no backing entity anywhere in
 * the system — WaypointTelemetry and ComplianceRecord both just carry the
 * string. This is the first-class row it now points at.
 */

import { LazyClient } from './db.js';

export interface Driver {
  id: string;
  org_id: string;
  driver_id: string;
  name: string | null;
  created_at: string;
}

export class DriverStore {
  private readonly conn: LazyClient;

  constructor(connectionString: string) {
    this.conn = new LazyClient(connectionString);
  }

  async create(driver: { org_id: string; driver_id: string; name?: string }): Promise<Driver> {
    const client = await this.conn.get();
    const { rows } = await client.query<Driver>(
      `insert into public.drivers (org_id, driver_id, name) values ($1, $2, $3)
       returning id, org_id, driver_id, name, created_at`,
      [driver.org_id, driver.driver_id, driver.name ?? null],
    );
    const row = rows[0];
    if (!row) throw new Error('drivers insert returned no row');
    return { ...row, created_at: new Date(row.created_at).toISOString() };
  }

  async get(org_id: string, driver_id: string): Promise<Driver | undefined> {
    const client = await this.conn.get();
    const { rows } = await client.query<Driver>(
      `select id, org_id, driver_id, name, created_at from public.drivers
       where org_id = $1 and driver_id = $2`,
      [org_id, driver_id],
    );
    const row = rows[0];
    return row ? { ...row, created_at: new Date(row.created_at).toISOString() } : undefined;
  }

  async listForOrg(org_id: string): Promise<Driver[]> {
    const client = await this.conn.get();
    const { rows } = await client.query<Driver>(
      `select id, org_id, driver_id, name, created_at from public.drivers
       where org_id = $1 order by created_at`,
      [org_id],
    );
    return rows.map((r) => ({ ...r, created_at: new Date(r.created_at).toISOString() }));
  }

  async close(): Promise<void> {
    await this.conn.close();
  }
}
