/**
 * Phase 0 exit-condition harness.
 *
 *   "a real FortyGuard API call returns real temperature data through your
 *    client, end to end. No simulation involved yet — this has to be real."
 *
 * It runs the two job cycles a single ThermalExposureEvent needs, captures the
 * raw payloads, and reports which §3 fields the live API can actually source.
 * It does NOT rewrite any contract — a mismatch is reported, never patched.
 *
 *   npm run verify:fortyguard
 *   npm run verify:fortyguard -- --lat 33.4484 --lng -112.0740 --at 2026-08-13T18:00
 *   npm run verify:fortyguard -- --skip-env-params
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';

import {
  FortyGuardClient,
  describeKey,
  redactSecret,
  squareAoiAreaSqMiles,
  squareAoiAround,
  summarizeTemperature,
  type EnvParamsResult,
  type HeatmapResult,
  type JobResult,
} from '../src/index.js';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');
loadDotenv({ path: resolve(REPO_ROOT, '.env') });

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

const lat = Number(arg('lat') ?? 40.7115);
const lng = Number(arg('lng') ?? -74.01);
const sideKm = Number(arg('side-km') ?? 2);
const skipEnvParams = flag('skip-env-params');

/** UTC date/time parts the API expects: YYYY-MM-DD and HH:MM. */
function splitUtc(date: Date): { start_date: string; start_time: string } {
  const iso = date.toISOString();
  return { start_date: iso.slice(0, 10), start_time: iso.slice(11, 16) };
}

const atRaw = arg('at');
const target = atRaw ? new Date(atRaw) : new Date();
if (Number.isNaN(target.getTime())) {
  console.error(`--at "${atRaw}" is not a parseable date`);
  process.exit(2);
}
const { start_date, start_time } = splitUtc(target);

// ---------------------------------------------------------------------------
// Reporting helpers
// ---------------------------------------------------------------------------

const line = (): void => console.log('─'.repeat(72));
const ok = (s: string): string => `  OK   ${s}`;
const bad = (s: string): string => `  MISS ${s}`;

interface FieldFinding {
  field: string;
  contract: string;
  source: string;
  present: boolean;
  value?: unknown;
  note?: string;
}

const findings: FieldFinding[] = [];

function record(f: FieldFinding): void {
  findings.push(f);
}

/** First non-null entry of a time-aligned env_params array. */
function firstValue(series: (number | null)[] | undefined): number | undefined {
  if (!series) return undefined;
  for (const v of series) {
    // null means "unavailable upstream"; -999 is the legacy sentinel for the
    // same thing. Neither is a real measurement.
    if (v !== null && v !== undefined && v !== -999) return v;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  line();
  console.log('Threshold — Phase 0 FortyGuard verification');
  line();
  console.log(`  API key            : ${describeKey(process.env.FORTYGUARD_API_KEY)}`);
  console.log(`  Base URL           : ${process.env.FORTYGUARD_BASE_URL ?? '(default)'}`);
  console.log(`  Coordinate         : ${lat}, ${lng}`);
  console.log(
    `  AOI                : ${sideKm} km square ≈ ${squareAoiAreaSqMiles(sideKm).toFixed(2)} mi²`,
  );
  console.log(`  Target time (UTC)  : ${start_date} ${start_time}`);
  console.log(`  Now (UTC)          : ${new Date().toISOString()}`);
  line();

  const client = FortyGuardClient.fromEnv();
  const aoi = squareAoiAround(lat, lng, sideKm);

  // -- Job 1: temperature -----------------------------------------------------
  console.log('\n[1/2] POST /heatmap  (analytic_type: tcm → °C)');
  const heatmapJob: JobResult<HeatmapResult> = await client.runHeatmap(
    {
      polygon_aoi: aoi,
      date_time: { start_date, start_time, filter_type: 1 },
      granularity: 100,
      analytic_type: 'tcm',
    },
    {
      onProgress: ({ attempt, state, elapsedMs }) => {
        process.stdout.write(`\r      poll ${attempt} · ${state} · ${Math.round(elapsedMs / 1000)}s   `);
      },
    },
  );
  process.stdout.write('\n');

  const temps = summarizeTemperature(heatmapJob.result);
  console.log(`      activity_id : ${heatmapJob.activityId}`);
  console.log(`      completed in: ${Math.round(heatmapJob.elapsedMs / 1000)}s over ${heatmapJob.pollCount} polls`);
  console.log(`      tiles       : ${temps.tileCount}`);
  console.log(`      temperature : min ${temps.min} · mean ${temps.mean} · max ${temps.max} ${temps.units}`);

  const haveTemp = typeof temps.mean === 'number' || typeof temps.max === 'number';
  record({
    field: 'temp_c',
    contract: 'ThermalExposureEvent',
    source: 'heatmap → stats_data.Temperature_stats',
    present: haveTemp,
    value: temps.mean ?? temps.max,
  });
  record({
    field: 'forecasted_temp_c',
    contract: 'WaypointTelemetry',
    source: 'heatmap → stats_data.Temperature_stats (forecast window ≤ 12h)',
    present: haveTemp,
    value: temps.mean ?? temps.max,
  });

  // -- Job 2: heat index + humidity ------------------------------------------
  let envJob: JobResult<EnvParamsResult> | undefined;

  if (skipEnvParams) {
    console.log('\n[2/2] POST /env_params  — SKIPPED (--skip-env-params)');
    record({
      field: 'heat_index_c',
      contract: 'ThermalExposureEvent',
      source: 'env_params → parameters.heat_index_celsius',
      present: false,
      note: 'not attempted',
    });
    record({
      field: 'humidity_pct',
      contract: 'ThermalExposureEvent / WaypointTelemetry',
      source: 'env_params → parameters.relative_humidity_percent',
      present: false,
      note: 'not attempted',
    });
  } else {
    const seedTemp = temps.mean ?? temps.max;
    if (typeof seedTemp !== 'number') {
      throw new Error('Cannot call /env_params: the heatmap returned no usable temperature.');
    }

    console.log('\n[2/2] POST /env_params  (temperature is an INPUT here, from job 1)');
    envJob = await client.runEnvParams(
      {
        latitude: lat,
        longitude: lng,
        temperature: seedTemp,
        date_time: { start_date, start_time, filter_type: 1 },
        // Exactly 3 — API Basic's per-request ceiling.
        analysis: [
          'heat_index_celsius',
          'relative_humidity_percent',
          'wet_bulb_temperature_celsius',
        ],
      },
      {
        onProgress: ({ attempt, state, elapsedMs }) => {
          process.stdout.write(`\r      poll ${attempt} · ${state} · ${Math.round(elapsedMs / 1000)}s   `);
        },
      },
    );
    process.stdout.write('\n');

    const loc = envJob.result?.locations?.[0];
    const heatIndex = firstValue(loc?.parameters?.heat_index_celsius);
    const humidity = firstValue(loc?.parameters?.relative_humidity_percent);

    console.log(`      activity_id : ${envJob.activityId}`);
    console.log(`      completed in: ${Math.round(envJob.elapsedMs / 1000)}s over ${envJob.pollCount} polls`);
    console.log(`      heat index  : ${heatIndex} °C`);
    console.log(`      humidity    : ${humidity} %`);

    record({
      field: 'heat_index_c',
      contract: 'ThermalExposureEvent',
      source: 'env_params → parameters.heat_index_celsius',
      present: typeof heatIndex === 'number',
      value: heatIndex,
    });
    record({
      field: 'humidity_pct',
      contract: 'ThermalExposureEvent / WaypointTelemetry',
      source: 'env_params → parameters.relative_humidity_percent',
      present: typeof humidity === 'number',
      value: humidity,
    });
  }

  // -- Fields the API is not expected to supply ------------------------------
  for (const f of [
    { field: 'event_id', contract: 'ThermalExposureEvent', source: 'generated locally (uuid)' },
    { field: 'route_id', contract: 'ThermalExposureEvent', source: 'telemetry adapter (Phase 1)' },
    { field: 'waypoint_id', contract: 'ThermalExposureEvent', source: 'telemetry adapter (Phase 1)' },
    { field: 'timestamp', contract: 'ThermalExposureEvent', source: 'echoed from the request' },
    { field: 'source', contract: 'ThermalExposureEvent', source: "literal 'fortyguard_api'" },
  ]) {
    record({ ...f, present: true, note: 'not API-sourced by design' });
  }

  // -- Report ----------------------------------------------------------------
  line();
  console.log('§3 contract coverage against the live API');
  line();
  for (const f of findings) {
    const label = `${f.contract}.${f.field}`.padEnd(46);
    const detail = f.note ?? (f.value === undefined ? '' : String(f.value));
    console.log(`${f.present ? ok(label) : bad(label)} ${detail}`);
    console.log(`       ← ${f.source}`);
  }

  const missing = findings.filter((f) => !f.present);
  line();

  // -- Capture ---------------------------------------------------------------
  const artifactDir = resolve(REPO_ROOT, 'artifacts');
  mkdirSync(artifactDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const artifactPath = resolve(artifactDir, `phase0-verification-${stamp}.json`);

  const capture = {
    captured_at: new Date().toISOString(),
    request: { lat, lng, sideKm, start_date, start_time, granularity: 100, analytic_type: 'tcm' },
    heatmap: {
      activity_id: heatmapJob.activityId,
      elapsed_ms: heatmapJob.elapsedMs,
      poll_count: heatmapJob.pollCount,
      submit_raw: heatmapJob.submitRaw,
      status_raw: heatmapJob.statusRaw,
    },
    env_params: envJob
      ? {
          activity_id: envJob.activityId,
          elapsed_ms: envJob.elapsedMs,
          poll_count: envJob.pollCount,
          submit_raw: envJob.submitRaw,
          status_raw: envJob.statusRaw,
        }
      : null,
    contract_coverage: findings,
  };

  // Belt and braces: the key is only ever a header, but scrub the artifact anyway.
  const serialized = redactSecret(JSON.stringify(capture, null, 2), process.env.FORTYGUARD_API_KEY);
  writeFileSync(artifactPath, serialized, 'utf8');
  console.log(`Raw payloads captured → ${artifactPath}`);
  console.log('(artifacts/ is gitignored — it holds unredacted response bodies)');
  line();

  if (missing.length > 0) {
    console.log(`RESULT: ${missing.length} §3 field(s) NOT satisfied by the live API:`);
    for (const f of missing) console.log(`  · ${f.contract}.${f.field}  (${f.source})`);
    console.log('\nPhase 0 exit condition NOT met for the full event shape.');
    console.log('Do not adapt §3 to fit this — report the mismatch and reconcile the spec first.');
    return 1;
  }

  console.log('RESULT: real temperature data returned end to end, and every §3 field');
  console.log('        has a confirmed source. Phase 0 exit condition MET.');
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('\nVERIFICATION FAILED');
    console.error(redactSecret(message, process.env.FORTYGUARD_API_KEY));
    if (error instanceof Error && error.stack) {
      console.error(redactSecret(error.stack, process.env.FORTYGUARD_API_KEY));
    }
    process.exit(1);
  });
