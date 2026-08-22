/**
 * §11 Phase 8 exit-condition harness — mirrors fortyguard-client's
 * scripts/verify.ts: a real API call through this client, no simulation.
 *
 * BLOCKED PENDING CREDENTIALS as of this writing: no MOTIVE_API_TOKEN exists.
 * Motive's own developer-docs.gomotive.com/docs/prerequisites confirms a free
 * self-service developer account is obtainable with no existing fleet-
 * customer relationship (create account → register a test app → create a
 * "dummy fleet" → Motive manually approves the app-to-fleet association) —
 * this is NOT a paywall like Samsara's sandbox, which requires piggybacking
 * on an existing paying customer's org token. But account creation itself is
 * something this assistant does not do on a user's behalf; a human has to
 * complete Motive's signup + approval step. Until then this script self-
 * skips rather than fabricate a response — see motive-source.ts's header for
 * the full tradeoff writeup.
 *
 *   npm run verify --workspace @threshold/motive-client
 *   npm run verify --workspace @threshold/motive-client -- --vehicle-id 12345 --start-date 2026-08-01 --end-date 2026-08-02
 */

import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { loadConfigFromEnv, MotiveClient, MotiveConfigError, describeToken } from '../src/index.js';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');
loadDotenv({ path: resolve(REPO_ROOT, '.env') });

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const line = () => console.log('─'.repeat(90));

async function main(): Promise<number> {
  line();
  console.log('§11 Phase 8 — Motive vehicle-location-history, live-API verification');
  line();
  console.log(`MOTIVE_API_TOKEN: ${describeToken(process.env.MOTIVE_API_TOKEN)}`);

  let config;
  try {
    config = loadConfigFromEnv();
  } catch (error) {
    if (error instanceof MotiveConfigError) {
      line();
      console.log('BLOCKED PENDING CREDENTIALS — this is expected right now, not a failure.');
      console.log(error.message);
      line();
      return 0;
    }
    throw error;
  }

  const vehicleId = Number(arg('vehicle-id'));
  const startDate = arg('start-date');
  const endDate = arg('end-date');
  if (!vehicleId || !startDate || !endDate) {
    console.log('Pass --vehicle-id, --start-date (yyyy-mm-dd), and --end-date once a real');
    console.log('Motive dummy fleet + vehicle exist. Nothing to call against yet.');
    return 0;
  }

  const client = new MotiveClient(config);
  const result = await client.getVehicleLocationHistory({ vehicleId, startDate, endDate });
  console.log(`\n${result.vehicle_locations.length} location records returned:`);
  console.log(JSON.stringify(result, null, 2));

  line();
  console.log('PROOF: a real Motive API call, through this client, returned real data.');
  line();
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error('\nVERIFICATION FAILED');
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exit(1);
  });
