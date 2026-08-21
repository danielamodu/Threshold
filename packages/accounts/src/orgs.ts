/**
 * Org persistence (§11 Phase 7).
 *
 * `id` is Clerk's own organization id, stored verbatim — see the migration
 * comment for why there is deliberately no separate id-mapping table.
 */

import { LazyClient } from './db.js';

export interface Org {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

export class OrgStore {
  private readonly conn: LazyClient;

  constructor(connectionString: string) {
    this.conn = new LazyClient(connectionString);
  }

  async create(org: { id: string; name: string; slug: string }): Promise<Org> {
    const client = await this.conn.get();
    const { rows } = await client.query<Org>(
      `insert into public.orgs (id, name, slug) values ($1, $2, $3)
       returning id, name, slug, created_at`,
      [org.id, org.name, org.slug],
    );
    const row = rows[0];
    if (!row) throw new Error('orgs insert returned no row');
    return { ...row, created_at: new Date(row.created_at).toISOString() };
  }

  async get(id: string): Promise<Org | undefined> {
    const client = await this.conn.get();
    const { rows } = await client.query<Org>(
      `select id, name, slug, created_at from public.orgs where id = $1`,
      [id],
    );
    const row = rows[0];
    return row ? { ...row, created_at: new Date(row.created_at).toISOString() } : undefined;
  }

  async list(): Promise<Org[]> {
    const client = await this.conn.get();
    const { rows } = await client.query<Org>(
      `select id, name, slug, created_at from public.orgs order by created_at`,
    );
    return rows.map((r) => ({ ...r, created_at: new Date(r.created_at).toISOString() }));
  }

  async close(): Promise<void> {
    await this.conn.close();
  }
}
