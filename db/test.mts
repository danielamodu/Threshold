/**
 * Runs the audit-log assertion suite against any Postgres, including Neon.
 *
 * Why not just psql: it isn't on PATH on Windows, and WSL's psql can't resolve
 * Neon's host without DNS surgery. Driving the same .sql file through `pg`
 * makes `npm run db:test` portable across Windows, Linux, and CI with no extra
 * binary.
 *
 * SAFETY: the suite INSERTS fixture rows, and audit_log is append-only by
 * trigger — inserted rows can never be deleted. So everything runs inside one
 * transaction and is ROLLED BACK by default. Caught exceptions inside PL/pgSQL
 * DO blocks use implicit savepoints, so the outer transaction survives them and
 * the rollback still discards every insert. Pass --commit to keep the rows,
 * which you almost never want against a real database.
 *
 *   npm run db:test
 *   npm run db:test -- --url postgresql://...
 *   npm run db:test -- --commit        # leaves fixtures behind, permanently
 *   npm run db:test -- --suite org_multitenancy_test
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { Client } from 'pg';

const REPO_ROOT = resolve(import.meta.dirname, '..');
loadDotenv({ path: resolve(REPO_ROOT, '.env') });

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const commit = process.argv.includes('--commit');
const SUITE = resolve(import.meta.dirname, `tests/${arg('suite') ?? 'audit_log_test'}.sql`);

function resolveConnectionString(): string {
  const url = arg('url') ?? process.env.NEON_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error('No connection string. Set NEON_DATABASE_URL in .env or pass --url.');
  }
  return url;
}

function describeTarget(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.port ? `:${u.port}` : ''}${u.pathname}`;
  } catch {
    return '(unparseable connection string)';
  }
}

const needsSsl = (url: string): boolean =>
  /sslmode=require/i.test(url) || /\.neon\.tech/i.test(url);

/**
 * Strip psql meta-commands so the file stays runnable by psql directly while
 * also being valid input for the wire protocol. `\echo` lines carry the section
 * headings, so surface them as labels rather than dropping them silently.
 */
function prepare(raw: string): { sql: string; labels: string[] } {
  const labels: string[] = [];
  const sql = raw
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => {
      const t = line.trimStart();
      if (!t.startsWith('\\')) return true;
      const echo = /^\\echo\s+'(.*)'\s*$/.exec(t);
      if (echo?.[1] !== undefined) labels.push(echo[1]);
      return false;
    })
    .join('\n');
  return { sql, labels };
}

async function main(): Promise<number> {
  const connectionString = resolveConnectionString();
  const client = new Client({
    connectionString,
    ...(needsSsl(connectionString) ? { ssl: { rejectUnauthorized: true } } : {}),
  });

  const { sql, labels } = prepare(readFileSync(SUITE, 'utf8'));

  console.log(`target   : ${describeTarget(connectionString)}`);
  console.log(`suite    : ${SUITE}`);
  console.log(`mode     : ${commit ? 'COMMIT (fixtures will persist)' : 'rollback (no rows persist)'}`);
  console.log('─'.repeat(70));
  console.log('sections :');
  for (const l of labels) console.log(`  ${l}`);
  console.log('─'.repeat(70));

  const notices: string[] = [];
  client.on('notice', (n) => {
    const msg = n.message ?? String(n);
    notices.push(msg);
    console.log(`  ${msg}`);
  });

  await client.connect();
  try {
    await client.query('begin');

    let results;
    try {
      results = await client.query(sql);
    } catch (error) {
      await client.query('rollback');
      throw error;
    }

    // Print any result sets the suite's closing SELECTs produced.
    const sets = (Array.isArray(results) ? results : [results]).filter(
      (r) => Array.isArray(r.rows) && r.rows.length > 0,
    );
    for (const set of sets) {
      console.log('');
      console.table(set.rows);
    }

    if (commit) {
      await client.query('commit');
      console.log('\nCOMMITTED — fixture rows are now permanent and cannot be deleted.');
    } else {
      await client.query('rollback');
      console.log('\nRolled back — no fixture rows persist.');
    }

    const passes = notices.filter((n) => n.startsWith('PASS:'));
    console.log('─'.repeat(70));
    console.log(`${passes.length} assertion(s) passed, 0 failed.`);

    const { rows } = await client.query<{ n: string }>(
      'select count(*)::text as n from public.audit_log',
    );
    console.log(`audit_log now holds ${rows[0]?.n ?? '?'} row(s).`);
    return 0;
  } finally {
    await client.end();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error('\nSUITE FAILED');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
