/**
 * Live/forecast-window probe — a retest of the Phase 0 finding, not a repeat.
 *
 * THE FINDING BEING RETESTED (scripts/verify.ts header, recorded 2026-08-18):
 * queries at "now" or anywhere in the ±12h live/forecast window returned ZERO
 * tiles (n_cells: 0) across two cities and ten time offsets, while a fixed
 * historical date (2024-07-15) returned 150–299 real tiles every time. The
 * hypothesis recorded at the time was a trial-key restriction on live data.
 *
 * WHAT THIS PROBE FOUND — 2026-08-23, key issued 2026-08-18
 * All 14 offset cells returned EMPTY (n_cells: 0), across both cities, at every
 * offset from −168h to +11h. The 2024-07-15 control returned 417 tiles for
 * Phoenix (max 39.37 °C) and 299 for New York (max 33.45 °C) on the same run.
 *
 * That REFUTES the original interpretation. A week-old timestamp is nowhere
 * near the live/forecast window, so this is not a live-data restriction, and
 * there is no recency gradient of any kind — nothing recent works, and a fixed
 * 2024 date works fully. The variable is which DATE is requested, not how
 * fresh it is. Two candidates remain, separated by --dates (see below): a real
 * archive whose coverage ends before 2026, or a key scoped to a canned sample
 * dataset that happens to be the docs' own example day.
 *
 * WHY A SEPARATE SCRIPT RATHER THAN RE-RUNNING verify.ts
 *   1. verify.ts THROWS on a zero-tile result — `runEnvParams` needs a seed
 *      temperature, so `Cannot call /env_params: the heatmap returned no usable
 *      temperature` aborts the process before the artifact is even written.
 *      That is correct for an exit-condition harness and useless for mapping a
 *      boundary: it stops at the first failing cell. This records every cell
 *      and keeps going.
 *   2. verify.ts hardcodes `filter_type: 1` (single hour). The original ten
 *      offsets therefore varied only WHEN, never HOW the window was requested.
 *      A single-hour request for an hour that has not finished yet is a
 *      genuinely different question from a whole-day request covering it, and
 *      that variable has never been tested. It is tested here.
 *   3. The original run could not distinguish "live data is restricted" from
 *      "data needs N hours to land". Negative offsets out to a week locate the
 *      freshness boundary, which is the actual operational question for a demo:
 *      not "is live perfect" but "how fresh can real data be".
 *
 * WHAT A CELL MEANS
 * `n_cells` / tile count is the signal. A completed job with zero tiles is the
 * failure mode being investigated — the API returns success, an activity_id,
 * and an empty FeatureCollection. `stats_data.temperature_stats` is then all
 * `undefined`, which is exactly what made this look like a client bug at first
 * (see the casing note in api-types.ts) and is not one.
 *
 * The 2024-07-15 control cell runs LAST, deliberately. If every live cell is
 * empty AND the control is empty, the problem is the key or the account, not
 * the window — and that is a completely different conversation with FortyGuard.
 * Do not interpret an all-empty matrix without checking the control line.
 *
 *   npm run probe:fortyguard
 *   npm run probe:fortyguard -- --offsets -1,0,3
 *   npm run probe:fortyguard -- --cities phoenix
 *   npm run probe:fortyguard -- --filter-types 1,3
 *   npm run probe:fortyguard -- --no-control
 *
 * Each cell is one submit + poll cycle and takes roughly 10–60s, so the default
 * matrix is deliberately small. Widen it with the flags above once you know
 * which axis is interesting.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';

import {
  FortyGuardClient,
  describeKey,
  redactSecret,
  squareAoiAround,
  summarizeTemperature,
  type FilterType,
  type HeatmapResult,
  type JobResult,
} from '../src/index.js';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');
loadDotenv({ path: resolve(REPO_ROOT, '.env') });

// ---------------------------------------------------------------------------
// Matrix definition
// ---------------------------------------------------------------------------

interface City {
  key: string;
  label: string;
  lat: number;
  lng: number;
}

/**
 * Phoenix is Threshold's own demo route city (route-phx-01) — the one that has
 * to work on stage. New York is the original finding's coordinate, kept so a
 * change in behaviour can be attributed to the API rather than to a coordinate
 * nobody tested before.
 */
const CITIES: City[] = [
  { key: 'phoenix', label: 'Phoenix, AZ', lat: 33.4484, lng: -112.074 },
  { key: 'nyc', label: 'New York, NY', lat: 40.7115, lng: -74.01 },
];

/**
 * Hours relative to now. Negative is past, positive is forecast.
 *   -168 / -24 : is recent-historical data available at all, and how recent?
 *     -3 /  -1 : the near-past edge — the most likely place a boundary sits
 *      0       : "now", the exact case verify.ts defaults to
 *     +3 / +11 : inside the documented forecast window (now + 12h)
 */
const DEFAULT_OFFSETS = [-168, -24, -3, -1, 0, 3, 11];

/** The docs' own example date, known to return 150–299 tiles as of 2026-08-18. */
const CONTROL = { start_date: '2024-07-15', start_time: '13:00', filter_type: 1 as FilterType };

const SIDE_KM = 2;
const GRANULARITY = 100 as const;

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

function numberList(raw: string | undefined, fallback: number[]): number[] {
  if (!raw) return fallback;
  const parsed = raw.split(',').map((part) => Number(part.trim()));
  if (parsed.some((n) => !Number.isFinite(n))) {
    console.error(`Could not parse "${raw}" as a comma-separated number list.`);
    process.exit(2);
  }
  return parsed;
}

const offsets = numberList(arg('offsets'), DEFAULT_OFFSETS);
const filterTypes = numberList(arg('filter-types'), [1]).map((n) => {
  if (n !== 1 && n !== 3) {
    // 2 and 4 need an end_time / end_date this probe does not model, and
    // neither is how the pipeline queries the API.
    console.error(`--filter-types only supports 1 (single hour) and 3 (single day), got ${n}.`);
    process.exit(2);
  }
  return n as FilterType;
});

const cityFilter = arg('cities')?.split(',').map((s) => s.trim().toLowerCase());
const cities = cityFilter ? CITIES.filter((c) => cityFilter.includes(c.key)) : CITIES;
if (cities.length === 0) {
  console.error(`No known cities matched. Available: ${CITIES.map((c) => c.key).join(', ')}`);
  process.exit(2);
}
const withControl = !flag('no-control');

/**
 * Absolute-date mode — added after the 2026-08-23 run.
 *
 * That run found EVERY recent offset empty, including −168h, while 2024-07-15
 * returned 417 tiles. There is therefore no recency gradient to find: the
 * variable is not how fresh the timestamp is, it is WHICH DATE is asked for.
 * Offsets cannot express that question, so pass explicit dates instead and
 * binary-search where the archive actually stops:
 *
 *   npm run probe:fortyguard -- --cities phoenix --dates 2024-07-20,2025-07-15,2026-01-15
 *
 * A nearby-date cell (2024-07-20) is the important one. If it returns tiles,
 * a real archive exists and has a cutoff worth locating. If only the docs'
 * own example date ever works, the key is scoped to one canned sample day and
 * no further probing will change that — it becomes a question for FortyGuard.
 */
const dates = arg('dates')?.split(',').map((s) => s.trim()).filter(Boolean);
const dateTime = arg('time') ?? '13:00';

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/**
 * `offset`   — a time relative to now (the original axis).
 * `absolute` — an explicit calendar date via --dates (the date axis).
 * `control`  — the known-good 2024-07-15 reference cell.
 */
type CellMode = 'offset' | 'absolute' | 'control';

interface Cell {
  city: string;
  cityKey: string;
  mode: CellMode;
  /** Null for absolute-date and control cells — they are not relative to now. */
  offsetHours: number | null;
  filterType: FilterType;
  startDate: string;
  startTime: string | null;
  isControl: boolean;
  /** Inside the documented ±12h live/forecast window. */
  isLiveWindow: boolean;
  activityId: string | null;
  nCells: number | null;
  tileCount: number | null;
  maxC: number | undefined;
  meanC: number | undefined;
  units: string | null;
  elapsedMs: number | null;
  error: string | null;
}

const cells: Cell[] = [];

function splitUtc(date: Date): { start_date: string; start_time: string } {
  const iso = date.toISOString();
  return { start_date: iso.slice(0, 10), start_time: iso.slice(11, 16) };
}

const line = (): void => console.log('─'.repeat(96));

// ---------------------------------------------------------------------------
// One cell
// ---------------------------------------------------------------------------

async function probe(
  client: FortyGuardClient,
  city: City,
  spec: {
    mode: CellMode;
    offsetHours: number | null;
    filterType: FilterType;
    start_date: string;
    start_time: string;
  },
): Promise<void> {
  const isControl = spec.mode === 'control';
  const isLiveWindow =
    spec.offsetHours !== null && spec.offsetHours >= -12 && spec.offsetHours <= 12;

  // filter_type 3 covers a whole day and the API rejects a start_time with it.
  const useTime = spec.filterType === 1;
  const tag =
    spec.mode === 'control'
      ? 'CONTROL'
      : spec.mode === 'absolute'
        ? 'DATE'
        : `${spec.offsetHours! >= 0 ? '+' : ''}${spec.offsetHours}h`;
  const label =
    `${city.key.padEnd(8)} ft${spec.filterType}  ${tag.padStart(7)}  ` +
    `${spec.start_date}${useTime ? ` ${spec.start_time}` : '  (all day)'}`;

  process.stdout.write(`  ${label} … `);

  const cell: Cell = {
    city: city.label,
    cityKey: city.key,
    mode: spec.mode,
    offsetHours: spec.offsetHours,
    filterType: spec.filterType,
    startDate: spec.start_date,
    startTime: useTime ? spec.start_time : null,
    isControl,
    isLiveWindow,
    activityId: null,
    nCells: null,
    tileCount: null,
    maxC: undefined,
    meanC: undefined,
    units: null,
    elapsedMs: null,
    error: null,
  };

  try {
    const job: JobResult<HeatmapResult> = await client.runHeatmap({
      polygon_aoi: squareAoiAround(city.lat, city.lng, SIDE_KM),
      date_time: {
        start_date: spec.start_date,
        filter_type: spec.filterType,
        ...(useTime ? { start_time: spec.start_time } : {}),
      },
      granularity: GRANULARITY,
      analytic_type: 'tcm',
    });

    const t = summarizeTemperature(job.result);
    cell.activityId = job.activityId;
    cell.nCells = job.result?.stats_data?.n_cells ?? null;
    cell.tileCount = t.tileCount;
    cell.maxC = t.max;
    cell.meanC = t.mean;
    cell.units = t.units;
    cell.elapsedMs = job.elapsedMs;

    const verdict =
      t.tileCount > 0
        ? `DATA   ${t.tileCount} tiles · max ${t.max} ${t.units}`
        : `EMPTY  0 tiles (n_cells: ${cell.nCells ?? 'absent'})`;
    console.log(`${verdict}  [${Math.round(job.elapsedMs / 1000)}s]`);
  } catch (error: unknown) {
    // A failed cell is data too — record it and keep the matrix going. This is
    // the whole reason this script exists rather than re-running verify.ts.
    const message = error instanceof Error ? error.message : String(error);
    cell.error = redactSecret(message, process.env.FORTYGUARD_API_KEY);
    console.log(`ERROR  ${cell.error}`);
  }

  cells.push(cell);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  const now = new Date();

  line();
  console.log('Threshold — FortyGuard live/forecast window probe');
  line();
  console.log(`  API key       : ${describeKey(process.env.FORTYGUARD_API_KEY)}`);
  console.log(`  Base URL      : ${process.env.FORTYGUARD_BASE_URL ?? '(default)'}`);
  console.log(`  Now (UTC)     : ${now.toISOString()}`);
  console.log(`  Cities        : ${cities.map((c) => c.key).join(', ')}`);
  console.log(
    dates
      ? `  Dates (UTC)   : ${dates.join(', ')} at ${dateTime}`
      : `  Offsets (h)   : ${offsets.join(', ')}`,
  );
  console.log(`  Filter types  : ${filterTypes.join(', ')}`);
  console.log(`  AOI           : ${SIDE_KM} km square · granularity ${GRANULARITY}m`);
  console.log(`  Control cell  : ${withControl ? `${CONTROL.start_date} ${CONTROL.start_time}` : 'skipped'}`);
  console.log(
    `  Cells to run  : ${cities.length * (dates?.length ?? offsets.length) * filterTypes.length + (withControl ? cities.length : 0)}`,
  );
  line();

  const client = FortyGuardClient.fromEnv();

  if (dates) {
    console.log(`\nAbsolute-date matrix (start_time ${dateTime})`);
    for (const city of cities) {
      for (const filterType of filterTypes) {
        for (const start_date of dates) {
          await probe(client, city, {
            mode: 'absolute',
            offsetHours: null,
            filterType,
            start_date,
            start_time: dateTime,
          });
        }
      }
    }
  } else {
    console.log('\nLive / forecast matrix');
    for (const city of cities) {
      for (const filterType of filterTypes) {
        for (const offsetHours of offsets) {
          const target = new Date(now.getTime() + offsetHours * 3_600_000);
          const { start_date, start_time } = splitUtc(target);
          await probe(client, city, {
            mode: 'offset',
            offsetHours,
            filterType,
            start_date,
            start_time,
          });
        }
      }
    }
  }

  if (withControl) {
    console.log('\nHistorical control (known good: 417 tiles phoenix / 299 nyc, 2026-08-23)');
    for (const city of cities) {
      await probe(client, city, {
        mode: 'control',
        offsetHours: null,
        filterType: CONTROL.filter_type,
        start_date: CONTROL.start_date,
        start_time: CONTROL.start_time,
      });
    }
  }

  // -- Verdict ---------------------------------------------------------------
  const withData = (c: Cell): boolean => (c.tileCount ?? 0) > 0;
  const liveCells = cells.filter((c) => c.isLiveWindow);
  const offsetPastCells = cells.filter((c) => c.mode === 'offset' && !c.isLiveWindow);
  const absoluteCells = cells.filter((c) => c.mode === 'absolute');
  const controlCells = cells.filter((c) => c.isControl);

  line();
  console.log('VERDICT');
  line();

  if (controlCells.length > 0 && !controlCells.some(withData)) {
    console.log('  The historical CONTROL returned no data either.');
    console.log('  Do NOT read this as a live-window restriction — the key, the account, or');
    console.log('  the API itself is the variable. Compare against the 2026-08-18 artifact');
    console.log('  in artifacts/ (which did return real tiles) before contacting FortyGuard.');
  } else if (absoluteCells.length > 0) {
    // Date-axis mode. The question here is not "does live work" but "where does
    // the data stop", so report which dates carry tiles and which don't.
    const ok = absoluteCells.filter(withData);
    const empty = absoluteCells.filter((c) => !withData(c));

    if (ok.length === 0) {
      console.log(`  NO DATA at any of the ${absoluteCells.length} requested dates.`);
      if (controlCells.some(withData)) {
        console.log('  The 2024-07-15 control DID return tiles on this same run, so the key and');
        console.log('  the account are fine. Access looks scoped to a specific dataset rather');
        console.log('  than to a date range — probing more dates will not change that.');
        console.log('  This is now a question for FortyGuard: what does this key actually cover?');
      }
    } else {
      console.log(`  DATA at ${ok.length} of ${absoluteCells.length} requested dates:`);
      for (const c of ok) {
        console.log(
          `    ${c.startDate}  ${c.cityKey} ft${c.filterType} → ${c.tileCount} tiles, max ${c.maxC} ${c.units}`,
        );
      }
      if (empty.length > 0) {
        console.log('  Empty:');
        for (const c of empty) console.log(`    ${c.startDate}  ${c.cityKey} ft${c.filterType}`);
        console.log('  A real archive with a usable boundary exists. Bisect between the latest');
        console.log('  date with data and the earliest without to find the exact cutoff.');
      }
    }
  } else if (liveCells.some(withData)) {
    const ok = liveCells.filter(withData);
    console.log(`  LIVE / FORECAST DATA WORKS — ${ok.length} of ${liveCells.length} in-window cells returned tiles.`);
    console.log('  The 2026-08-18 finding no longer holds. Update the header note in');
    console.log('  scripts/verify.ts and re-evaluate the §8 FortyGuard risk item.');
    console.log('  Working offsets:');
    for (const c of ok) {
      console.log(
        `    ${c.cityKey} ft${c.filterType} ${c.offsetHours! >= 0 ? '+' : ''}${c.offsetHours}h → ${c.tileCount} tiles, max ${c.maxC} ${c.units}`,
      );
    }
  } else {
    console.log(`  STILL ZERO TILES across all ${liveCells.length} in-window cells.`);
    console.log('  The 2026-08-18 finding holds for this key.');
    const freshest = offsetPastCells
      .filter(withData)
      .sort((a, b) => b.offsetHours! - a.offsetHours!)[0];
    if (freshest) {
      console.log(
        `  Freshest offset that DID return data: ${freshest.offsetHours}h ` +
          `(${freshest.cityKey}, ft${freshest.filterType}, ${freshest.tileCount} tiles).`,
      );
      console.log('  That offset is the honest ceiling on data freshness for a demo.');
    } else if (controlCells.some(withData)) {
      console.log('  Only the fixed historical control returned data — no recent offset did.');
    }
  }

  // -- Capture ---------------------------------------------------------------
  const artifactDir = resolve(REPO_ROOT, 'artifacts');
  mkdirSync(artifactDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const artifactPath = resolve(artifactDir, `fortyguard-live-probe-${stamp}.json`);

  // Deliberately excludes map_data: the point of a cell is its tile COUNT, and
  // storing 300 polygons per cell would bury the matrix in noise.
  const capture = {
    captured_at: new Date().toISOString(),
    now_utc: now.toISOString(),
    key: describeKey(process.env.FORTYGUARD_API_KEY),
    request_shape: { side_km: SIDE_KM, granularity: GRANULARITY, analytic_type: 'tcm' },
    matrix: {
      cities: cities.map((c) => c.key),
      mode: dates ? 'absolute' : 'offset',
      offsets: dates ? null : offsets,
      dates: dates ?? null,
      filter_types: filterTypes,
      control: withControl,
    },
    cells,
  };
  writeFileSync(
    artifactPath,
    redactSecret(JSON.stringify(capture, null, 2), process.env.FORTYGUARD_API_KEY),
    'utf8',
  );
  line();
  console.log(`Matrix captured → ${artifactPath}`);
  console.log('(artifacts/ is gitignored)');
  line();

  // Exit 0 whether or not live data works — this is a measurement, not a gate.
  // A non-zero exit is reserved for the probe itself failing to run.
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('\nPROBE FAILED TO RUN (this is not a finding about the live window)');
    console.error(redactSecret(message, process.env.FORTYGUARD_API_KEY));
    if (error instanceof Error && error.stack) {
      console.error(redactSecret(error.stack, process.env.FORTYGUARD_API_KEY));
    }
    process.exit(1);
  });
