/**
 * Route persistence + the org-scoped, Postgres-backed RouteContextProvider
 * (§11 Phase 7).
 *
 * `RouteRegistry` (packages/risk-engine) is an in-memory `Map`, used directly
 * by the demo/synthetic paths. `PostgresRouteRegistry` here is the real
 * persisted equivalent — same `RouteContextProvider` interface, so
 * risk-engine's evaluators cannot tell which one they were handed.
 *
 * ── Why this pre-loads instead of querying per lookup ───────────────────────
 * `RouteContextProvider.get()` is synchronous — both evaluators call it
 * mid-computation, with no `await` in between. A live query per waypoint
 * would need the interface (and both evaluators) to become async, which is
 * both unnecessary and a real risk-engine purity regression. Route/driver
 * assignment is reference data that "does not change per waypoint" (already
 * true of the in-memory registry) — so `load()` fetches every route for one
 * org exactly once, caches it, and `.get()` reads that cache synchronously
 * afterward. Same shape, same contract, no evaluator changes required.
 */

import type { CargoClass } from '@threshold/types';
import type { RouteContext, RouteContextProvider } from '@threshold/risk-engine';
import { LazyClient } from './db.js';

export interface Route {
  id: string;
  org_id: string;
  route_id: string;
  cargo_class: CargoClass;
  driver_id: string;
  created_at: string;
}

export class RouteStore {
  private readonly conn: LazyClient;

  constructor(connectionString: string) {
    this.conn = new LazyClient(connectionString);
  }

  async create(route: {
    org_id: string;
    route_id: string;
    cargo_class: CargoClass;
    driver_id: string;
  }): Promise<Route> {
    return this.conn.withTenant(route.org_id, async (client) => {
      const { rows } = await client.query<Route>(
        `insert into public.routes (org_id, route_id, cargo_class, driver_id)
         values ($1, $2, $3, $4)
         returning id, org_id, route_id, cargo_class, driver_id, created_at`,
        [route.org_id, route.route_id, route.cargo_class, route.driver_id],
      );
      const row = rows[0];
      if (!row) throw new Error('routes insert returned no row');
      return { ...row, created_at: new Date(row.created_at).toISOString() };
    });
  }

  async listForOrg(org_id: string): Promise<Route[]> {
    return this.conn.withTenant(org_id, async (client) => {
      const { rows } = await client.query<Route>(
        `select id, org_id, route_id, cargo_class, driver_id, created_at
         from public.routes where org_id = $1 order by created_at`,
        [org_id],
      );
      return rows.map((r) => ({ ...r, created_at: new Date(r.created_at).toISOString() }));
    });
  }

  async close(): Promise<void> {
    await this.conn.close();
  }
}

export class RouteRegistryNotLoadedError extends Error {
  constructor() {
    super('PostgresRouteRegistry.load() must be awaited before evaluate() runs.');
    this.name = 'RouteRegistryNotLoadedError';
  }
}

export class PostgresRouteRegistry implements RouteContextProvider {
  private readonly conn: LazyClient;
  private readonly org_id: string;
  private readonly cache = new Map<string, RouteContext>();
  private loaded = false;

  constructor(connectionString: string, org_id: string) {
    this.conn = new LazyClient(connectionString);
    this.org_id = org_id;
  }

  /** Loads every route for this org once. Call and await before running a pipeline. */
  async load(): Promise<this> {
    await this.conn.withTenant(this.org_id, async (client) => {
      const { rows } = await client.query<{
        route_id: string;
        driver_id: string;
        cargo_class: CargoClass;
      }>(
        `select route_id, driver_id, cargo_class from public.routes where org_id = $1`,
        [this.org_id],
      );
      this.cache.clear();
      for (const r of rows) {
        this.cache.set(r.route_id, {
          route_id: r.route_id,
          driver_id: r.driver_id,
          cargo_class: r.cargo_class,
        });
      }
    });
    this.loaded = true;
    return this;
  }

  get(route_id: string): RouteContext | undefined {
    if (!this.loaded) throw new RouteRegistryNotLoadedError();
    return this.cache.get(route_id);
  }

  async close(): Promise<void> {
    await this.conn.close();
  }
}
