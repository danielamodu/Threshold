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

  async close(): Promise<void> {
    if (this.client) {
      const c = this.client;
      this.client = undefined;
      await c.end();
    }
  }
}
