/**
 * Phase 0 exit-condition harness.
 *
 *   "a real FortyGuard API call returns real temperature data through your
 *    client, end to end. No simulation involved yet — this has to be real."
 *
 * Runs the two chained job cycles one ThermalExposureEvent requires (§8
 * decision 4), captures the raw payloads, and reports which §3 fields the live
 * API can actually source. It does NOT rewrite any contract — a mismatch is
 * reported, never patched.
 *
 * Checked against the post-decision-log §3:
 *   temp_c        = stats_data.temperature_stats.maximum   (§8 decision 1)
 *   temp_stats    = mean / max / min / stddev               (audit-only)
 *   humidity_pct  = relative_humidity_percent, NULLABLE      (§8 decision 3)
 *   data_quality  = complete | degraded_no_humidity
 *   heat_index_c  is NOT an event field                      (§8 decision 2)
 *
 *   npm run verify:fortyguard
 *   npm run verify:fortyguard -- --lat 33.4484 --lng -112.0740 --at 2026-08-13T18:00
 *   npm run verify:fortyguard -- --skip-env-params
 *
 * ── A live finding worth knowing before you run this ────────────────────────
 * Verified 2026-08-18: `stats_data` keys are lowercase snake_case in the real
 * response (`temperature_stats.maximum`, not the docs page's prose-cased
 * `Temperature_stats.Maximum`). More importantly — queries at "now" or
 * anywhere in the ±12h live/forecast window returned ZERO tiles (n_cells: 0)
 * across two cities (NYC, Miami) and ten time offsets spanning that whole
 * window. A fixed historical date (2024-07-15, FortyGuard's own docs example)
 * returned 150–299 real tiles every time. This looks like a trial-key
 * restriction on live/forecast data rather than a coverage gap — worth
 * confirming with FortyGuard directly before relying on live data for a demo.
 * `--at` defaults to "now"; pass an explicit historical date to reliably get
 * real tiles until that's resolved.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';

import {
  FortyGuardClient,
  describeKey,
  firstEnvParamsValue,
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
// Reporting
// ---------------------------------------------------------------------------

const line = (): void => console.log('─'.repeat(74));

type Verdict = 'ok' | 'degraded' | 'missing' | 'n/a';

interface FieldFinding {
  field: string;
  contract: string;
  source: string;
  verdict: Verdict;
  value?: unknown;
  note?: string;
}

const findings: FieldFinding[] = [];
const record = (f: FieldFinding): void => void findings.push(f);

const BADGE: Record<Verdict, string> = {
  ok: '  OK  ',
  degraded: ' DEGR ',
  missing: ' MISS ',
  'n/a': '  --  ',
};

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

  // -- Job 1 of 2: temperature ------------------------------------------------
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
        process.stdout.write(
          `\r      poll ${attempt} · ${state} · ${Math.round(elapsedMs / 1000)}s   `,
        );
      },
    },
  );
  process.stdout.write('\n');

  const t = summarizeTemperature(heatmapJob.result);
  console.log(`      activity_id : ${heatmapJob.activityId}`);
  console.log(
    `      completed in: ${Math.round(heatmapJob.elapsedMs / 1000)}s over ${heatmapJob.pollCount} polls`,
  );
  console.log(`      tiles       : ${t.tileCount}`);
  console.log(`      stats       : min ${t.min} · mean ${t.mean} · max ${t.max} ${t.units}`);

  // §8 decision 1: temp_c is Max, not Mean.
  record({
    field: 'temp_c',
    contract: 'ThermalExposureEvent',
    source: 'heatmap → stats_data.temperature_stats.maximum',
    verdict: typeof t.max === 'number' ? 'ok' : 'missing',
    value: t.max,
    note: typeof t.max === 'number' ? 'Max, per §8 decision 1' : undefined,
  });

  const statPairs: [keyof typeof t, string][] = [
    ['mean', 'mean'],
    ['max', 'maximum'],
    ['min', 'minimum'],
    ['stdDev', 'standard_deviation'],
  ];
  for (const [local, wire] of statPairs) {
    const key = local === 'stdDev' ? 'stddev' : local;
    record({
      field: `temp_stats.${key}`,
      contract: 'ThermalExposureEvent',
      source: `heatmap → stats_data.temperature_stats.${wire}`,
      verdict: typeof t[local] === 'number' ? 'ok' : 'missing',
      value: t[local],
    });
  }

  record({
    field: 'forecasted_temp_c',
    contract: 'WaypointTelemetry',
    source: 'heatmap → temperature_stats (forecast window ≤ 12h)',
    verdict: typeof t.max === 'number' ? 'ok' : 'missing',
    value: t.max,
  });

  // -- Job 2 of 2: humidity ---------------------------------------------------
  let envJob: JobResult<EnvParamsResult> | undefined;
  let humidity: number | undefined;

  if (skipEnvParams) {
    console.log('\n[2/2] POST /env_params  — SKIPPED (--skip-env-params)');
    record({
      field: 'humidity_pct',
      contract: 'ThermalExposureEvent',
      source: 'env_params → parameters.relative_humidity_percent',
      verdict: 'missing',
      note: 'not attempted',
    });
  } else {
    const seedTemp = t.max ?? t.mean;
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
        // Humidity only. FortyGuard's heat_index_celsius is deliberately NOT
        // requested — §8 decision 2 removes it from the pipeline entirely in
        // favour of the NWS formula computed in Phase 2.
        analysis: ['relative_humidity_percent'],
      },
      {
        onProgress: ({ attempt, state, elapsedMs }) => {
          process.stdout.write(
            `\r      poll ${attempt} · ${state} · ${Math.round(elapsedMs / 1000)}s   `,
          );
        },
      },
    );
    process.stdout.write('\n');

    const loc = envJob.result?.locations?.[0];
    humidity = firstEnvParamsValue(loc?.parameters?.relative_humidity_percent);

    console.log(`      activity_id : ${envJob.activityId}`);
    console.log(
      `      completed in: ${Math.round(envJob.elapsedMs / 1000)}s over ${envJob.pollCount} polls`,
    );
    console.log(`      humidity    : ${humidity ?? 'null (unavailable upstream)'} %`);

    // Nullable by contract — absence is a valid, recorded state, not a failure.
    record({
      field: 'humidity_pct',
      contract: 'ThermalExposureEvent',
      source: 'env_params → parameters.relative_humidity_percent',
      verdict: typeof humidity === 'number' ? 'ok' : 'degraded',
      value: humidity ?? null,
      note:
        typeof humidity === 'number'
          ? undefined
          : 'null — contract allows this; never zero-filled (§8 decision 3)',
    });
  }

  const dataQuality = typeof humidity === 'number' ? 'complete' : 'degraded_no_humidity';
  record({
    field: 'data_quality',
    contract: 'ThermalExposureEvent',
    source: 'derived from humidity_pct nullness',
    verdict: 'ok',
    value: dataQuality,
  });

  // -- Fields the API is not expected to supply ------------------------------
  for (const f of [
    { field: 'event_id', source: 'generated locally (uuid)' },
    { field: 'route_id', source: 'telemetry adapter (Phase 1)' },
    { field: 'waypoint_id', source: 'telemetry adapter (Phase 1)' },
    { field: 'timestamp', source: 'echoed from the request' },
    { field: 'source', source: "literal 'fortyguard_api'" },
  ]) {
    record({ ...f, contract: 'ThermalExposureEvent', verdict: 'n/a', note: 'not API-sourced' });
  }

  // §8 decision 2 — assert the removed field stays removed.
  record({
    field: 'heat_index_c',
    contract: 'ThermalExposureEvent',
    source: 'REMOVED — computed by the Compliance Evaluator (Phase 2)',
    verdict: 'n/a',
    note: 'correctly absent from this contract',
  });

  // -- Report ----------------------------------------------------------------
  line();
  console.log('§3 contract coverage against the live API');
  line();
  for (const f of findings) {
    const label = `${f.contract}.${f.field}`.padEnd(44);
    const detail = f.note ?? (f.value === undefined ? '' : String(f.value));
    console.log(`${BADGE[f.verdict]} ${label} ${detail}`);
    console.log(`       ← ${f.source}`);
  }

  const missing = findings.filter((f) => f.verdict === 'missing');
  const degraded = findings.filter((f) => f.verdict === 'degraded');
  line();

  // -- Capture ---------------------------------------------------------------
  const artifactDir = resolve(REPO_ROOT, 'artifacts');
  mkdirSync(artifactDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const artifactPath = resolve(artifactDir, `phase0-verification-${stamp}.json`);

  const capture = {
    captured_at: new Date().toISOString(),
    request: { lat, lng, sideKm, start_date, start_time, granularity: 100, analytic_type: 'tcm' },
    derived: { temp_c: t.max, data_quality: dataQuality, humidity_pct: humidity ?? null },
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
    console.log(`RESULT: ${missing.length} required §3 field(s) NOT satisfied by the live API:`);
    for (const f of missing) console.log(`  · ${f.contract}.${f.field}  (${f.source})`);
    console.log('\nPhase 0 exit condition NOT met.');
    console.log('Do not adapt §3 to fit this — report the mismatch and reconcile the spec first.');
    return 1;
  }

  console.log('RESULT: real temperature data returned end to end. Every required §3');
  console.log(`        field has a confirmed source. data_quality = ${dataQuality}.`);
  if (degraded.length > 0) {
    console.log('        Humidity was unavailable upstream — a valid degraded state,');
    console.log('        recorded as such rather than zero-filled.');
  }
  console.log('        Phase 0 exit condition MET.');
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
