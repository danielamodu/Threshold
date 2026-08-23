/**
 * Driver persistence (§11 Phase 7).
 *
 * Previously `driver_id` was a bare string with no backing entity anywhere in
 * the system — WaypointTelemetry and ComplianceRecord both just carry the
 * string. This is the first-class row it now points at.
 *
 * `clerk_user_id` (db/migrations/20260822140000_drivers_clerk_user_id.sql) is
 * the identity link that makes the driver role's `read: 'own'` permission
 * enforceable: given a signed-in Clerk user, `getByClerkUser` resolves which
 * driver_id their records are scoped to. NULL means nobody is linked to this
 * driver row yet, which is a normal state — see that migration's header.
 */

import { LazyClient } from './db.js';

export interface Driver {
  id: string;
  org_id: string;
  driver_id: string;
  name: string | null;
  /** Clerk user id of the human who signs in as this driver, or null if unlinked. */
  clerk_user_id: string | null;
  created_at: string;
}

/**
 * Single source of truth for the projection, so a column added to `drivers`
 * cannot be picked up by some queries here and silently missed by others —
 * which is exactly how `clerk_user_id` would have gone missing from one of
 * the three reads below.
 */
const COLUMNS = 'id, org_id, driver_id, name, clerk_user_id, created_at';

/** Rows come back with created_at as a Date; the interface promises an ISO string. */
function hydrate(row: Driver): Driver {
  return { ...row, created_at: new Date(row.created_at).toISOString() };
}

export class DriverStore {
  private readonly conn: LazyClient;

  constructor(connectionString: string) {
    this.conn = new LazyClient(connectionString);
  }

  async create(driver: {
    org_id: string;
    driver_id: string;
    name?: string;
    clerk_user_id?: string;
  }): Promise<Driver> {
    const client = await this.conn.get();
    const { rows } = await client.query<Driver>(
      `insert into public.drivers (org_id, driver_id, name, clerk_user_id)
       values ($1, $2, $3, $4)
       returning ${COLUMNS}`,
      [driver.org_id, driver.driver_id, driver.name ?? null, driver.clerk_user_id ?? null],
    );
    const row = rows[0];
    if (!row) throw new Error('drivers insert returned no row');
    return hydrate(row);
  }

  async get(org_id: string, driver_id: string): Promise<Driver | undefined> {
    const client = await this.conn.get();
    const { rows } = await client.query<Driver>(
      `select ${COLUMNS} from public.drivers
       where org_id = $1 and driver_id = $2`,
      [org_id, driver_id],
    );
    const row = rows[0];
    return row ? hydrate(row) : undefined;
  }

  /**
   * The lookup GET /api/audit runs on every driver-role request to turn a
   * Clerk session into the driver_id its 'own' scope is bounded by.
   *
   * Org-scoped on purpose, and not just for tidiness: `clerk_user_id` is
   * unique per org, not globally, so the same user may hold a driver identity
   * in several orgs. Querying without org_id could return another fleet's row
   * and scope the caller's feed to a driver_id from an org they are not
   * currently acting in. An explicit `is not null` guard keeps a caller with
   * no user id from matching every unlinked row.
   */
  async getByClerkUser(org_id: string, clerk_user_id: string): Promise<Driver | undefined> {
    const client = await this.conn.get();
    const { rows } = await client.query<Driver>(
      `select ${COLUMNS} from public.drivers
       where org_id = $1 and clerk_user_id is not null and clerk_user_id = $2`,
      [org_id, clerk_user_id],
    );
    const row = rows[0];
    return row ? hydrate(row) : undefined;
  }

  /**
   * Attaches (or, with null, detaches) a Clerk user to a driver row — the
   * assignment step an org_admin performs after inviting the person.
   *
   * Returns undefined if the driver row doesn't exist in that org, so the
   * caller can 404 rather than reporting a successful no-op update. A
   * `drivers_org_clerk_user_key` violation surfaces as-is from pg: the caller
   * is trying to link a user who is already another driver in this org, which
   * is a real conflict, not something to swallow.
   *
   * `drivers` is an ordinary table — UPDATE is allowed here. The append-only
   * trigger (§2) is on audit_log alone, and no audit_log row is touched: this
   * changes who a driver IS, never what was recorded about them.
   */
  async linkClerkUser(link: {
    org_id: string;
    driver_id: string;
    clerk_user_id: string | null;
  }): Promise<Driver | undefined> {
    const client = await this.conn.get();
    const { rows } = await client.query<Driver>(
      `update public.drivers set clerk_user_id = $3
       where org_id = $1 and driver_id = $2
       returning ${COLUMNS}`,
      [link.org_id, link.driver_id, link.clerk_user_id],
    );
    const row = rows[0];
    return row ? hydrate(row) : undefined;
  }

  async listForOrg(org_id: string): Promise<Driver[]> {
    const client = await this.conn.get();
    const { rows } = await client.query<Driver>(
      `select ${COLUMNS} from public.drivers
       where org_id = $1 order by created_at`,
      [org_id],
    );
    return rows.map(hydrate);
  }

  async close(): Promise<void> {
    await this.conn.close();
  }
}
