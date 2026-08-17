/**
 * Migration runner for the Neon Postgres target (Â§4).
 *
 * Â§2 requires migration FILES, not manual SQL, so this applies the ordered
 * contents of db/migrations against a connection string and records what it
 * applied. It replaced the Supabase CLI when the DB moved to Neon: Neon is
 * plain Postgres reached over a connection string, so a CLI that downloads
 * binaries and manages a local stack bought nothing.
 *
 *   npm run db:migrate              # apply pending
 *   npm run db:migrate -- --dry-run # list pending, change nothing
 *   npm run db:migrate -- --url postgresql://...   # explicit target
 *
 * Connection string resolution: --url, then NEON_DATABASE_URL, then
 * DATABASE_URL. Never hardcoded, and the runner prints only the host and
 * database â€” never the credentials embedded in the URL.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { Client } from 'pg';

const REPO_ROOT = resolve(import.meta.dirname, '..');
loadDotenv({ path: resolve(REPO_ROOT, '.env') });

const MIGRATIONS_DIR = resolve(import.meta.dirname, 'migrations');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const dryRun = process.argv.includes('--dry-run');

function resolveConnectionString(): string {
  const url = arg('url') ?? process.env.NEON_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'No connection string. Set NEON_DATABASE_URL in .env (see .env.example) or pass --url.',
    );
  }
  return url;
}

/** Host + database only. Never the password. */
function describeTarget(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.port ? `:${u.port}` : ''}${u.pathname}`;
  } catch {
    return '(unparseable connection string)';
  }
}

/** Neon requires TLS; a local Postgres generally has none configured. */
function needsSsl(url: string): boolean {
  return /sslmode=require/i.test(url) || /\.neon\.tech/i.test(url);
}

interface Migration {
  version: string;
  filename: string;
  sql: string;
  checksum: string;
}

function loadMigrations(): Migration[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((filename) => {
      const raw = readFileSync(resolve(MIGRATIONS_DIR, filename), 'utf8');
      // Normalise CRLF so a Windows checkout and a Linux runner agree.
      const sql = raw.replace(/\r\n/g, '\n');
      return {
        filename,
        version: filename.replace(/\.sql$/, ''),
        sql,
        checksum: createHash('sha256').update(sql).digest('hex').slice(0, 16),
      };
    });
}

const LEDGER = `
  create table if not exists public.schema_migrations (
    version    text primary key,
    checksum   text not null,
    applied_at timestamptz not null default now()
  )
`;

async function main(): Promise<number> {
  const connectionString = resolveConnectionString();
  const client = new Client({
    connectionString,
    ...(needsSsl(connectionString) ? { ssl: { rejectUnauthorized: true } } : {}),
  });

  console.log(`target      : ${describeTarget(connectionString)}`);
  console.log(`migrations  : ${MIGRATIONS_DIR}`);
  console.log(`mode        : ${dryRun ? 'dry run' : 'apply'}`);
  console.log('â”€'.repeat(66));

  await client.connect();
  try {
    await client.query(LEDGER);

    const applied = new Map<string, string>();
    const { rows } = await client.query<{ version: string; checksum: string }>(
      'select version, checksum from public.schema_migrations',
    );
    for (const r of rows) applied.set(r.version, r.checksum);

    const migrations = loadMigrations();
    if (migrations.length === 0) {
      console.log('No migration files found.');
      return 0;
    }

    // Drift check first. For an append-only audit product, an already-applied
    // migration whose file has since changed is a real problem, not a warning.
    const drifted = migrations.filter(
      (m) => applied.has(m.version) && applied.get(m.version) !== m.checksum,
    );
    if (drifted.length > 0) {
      console.error('CHECKSUM DRIFT â€” these applied migrations have been edited since:');
      for (const m of drifted) {
        console.error(`  ${m.version}  recorded ${applied.get(m.version)} â†’ file ${m.checksum}`);
      }
      console.error('\nEditing an applied migration desyncs environments. Add a new one instead.');
      return 1;
    }

    const pending = migrations.filter((m) => !applied.has(m.version));

    for (const m of migrations) {
      if (applied.has(m.version)) console.log(`  skip   ${m.version}  (already applied)`);
    }

    if (pending.length === 0) {
      console.log('\nNothing to apply â€” schema is up to date.');
      return 0;
    }

    if (dryRun) {
      console.log(`\n${pending.length} pending:`);
      for (const m of pending) console.log(`  pending ${m.version}`);
      return 0;
    }

    for (const m of pending) {
      process.stdout.write(`  apply  ${m.version} ... `);
      // Each migration is atomic: DDL in Postgres is transactional, so a
      // failure part-way leaves nothing behind.
      await client.query('begin');
      try {
        await client.query(m.sql);
        await client.query(
          'insert into public.schema_migrations (version, checksum) values ($1, $2)',
          [m.version, m.checksum],
        );
        await client.query('commit');
        console.log('ok');
      } catch (error) {
        await client.query('rollback');
        console.log('FAILED');
        throw error;
      }
    }

    console.log(`\nApplied ${pending.length} migration(s).`);
    return 0;
  } finally {
    await client.end();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error('\nMIGRATION FAILED');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
