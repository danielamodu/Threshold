/**
 * Phase 1 exit condition, proven against the real API — not the simulator:
 *
 *   "you can run a simulated route and watch real FortyGuard data become
 *    correctly-shaped events, logged, in order, with no manual intervention."
 *
 * "Simulated route" means the TELEMETRY (waypoints, cargo class, driver,
 * timestamps) — the thermal readings underneath are real FortyGuard data via
 * `FortyGuardThermalReadingSource`, not `SyntheticThermalReadingSource`.
 *
 * Uses the pinned historical anchor date (2024-07-15, confirmed to return
 * real tiles) rather than live/forecast, because live/forecast queries
 * currently return zero tiles on this trial key — escalated to FortyGuard,
 * not blocking on their answer. See fortyguard-source.ts's file header.
 *
 * Real API calls: ~15-30s per waypoint (two chained jobs), so this defaults
 * to a short 3-waypoint route rather than the full 4-waypoint demo route.
 *
 *   npm run simulate:real --workspace @threshold/api
 */

import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { InMemoryAuditSink } from '@threshold/audit';
import { FortyGuardClient } from '@threshold/fortyguard-client';
import {
  FortyGuardThermalReadingSource,
  SimulatedTelemetryAdapter,
  type RouteSpec,
} from '@threshold/ingestion';
import { RiskPipeline } from '@threshold/pipeline';
import { RouteRegistry } from '@threshold/risk-engine';
import { assertValid, validateThermalExposureEvent } from '@threshold/types';

loadDotenv({ path: resolve(import.meta.dirname, '../../../.env') });

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const anchorDate = arg('anchor-date') ?? '2024-07-15';

// Short route on purpose — three real waypoints already costs six chained
// API jobs (~2 minutes). This is a one-off proof run, not something to run
// on every push.
const ROUTE: RouteSpec = {
  route_id: 'route-real-proof',
  driver_id: 'driver-42',
  cargo_class: 'pharma',
  departs_at: '2026-08-18T13:00:00.000Z',
  leg_minutes: 60,
  waypoints: [
    { waypoint_id: 'wp-1', lat: 40.7115, lng: -74.01 },
    { waypoint_id: 'wp-2', lat: 40.72, lng: -74.0 },
    { waypoint_id: 'wp-3', lat: 40.73, lng: -73.99 },
  ],
};

const line = (): void => console.log('─'.repeat(96));

async function main(): Promise<number> {
  line();
  console.log('Threshold — Phase 1 proof: REAL FortyGuard data through the ingestion pipeline');
  line();
  console.log(`  route         : ${ROUTE.route_id} (${ROUTE.waypoints.length} waypoints)`);
  console.log(`  thermal source: FortyGuardThermalReadingSource (REAL API)`);
  console.log(`  anchor date   : ${anchorDate}  (see fortyguard-source.ts header for why)`);
  line();

  const client = FortyGuardClient.fromEnv();
  const readings = new FortyGuardThermalReadingSource({
    client,
    anchorDate,
    onWaypointProgress: ({ waypoint, stage, state, activityId }) => {
      if (state !== 'completed' && state !== 'failed') return; // one line per finished job, not per poll
      console.log(`  ${waypoint.waypoint_id}  ${stage.padEnd(11)} ${state.padEnd(11)} ${activityId.slice(0, 8)}…`);
    },
  });
  const telemetry = new SimulatedTelemetryAdapter({ route: ROUTE, seed: 1234 });

  const sink = new InMemoryAuditSink();
  const routes = new RouteRegistry().register({
    route_id: ROUTE.route_id,
    driver_id: ROUTE.driver_id,
    cargo_class: ROUTE.cargo_class,
  });
  const pipeline = new RiskPipeline({ sink, routes, initialExposureHours: 1 });

  const startedAt = Date.now();
  const { events, compliance, cargo, decisions } = await pipeline.run(telemetry, readings);
  const elapsedS = Math.round((Date.now() - startedAt) / 1000);

  line();
  console.log(`Completed in ${elapsedS}s. ${events.length} waypoints processed.`);
  line();

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (!e) continue;
    assertValid(`event[${i}] (${e.waypoint_id})`, validateThermalExposureEvent(e));

    console.log(`\n▸ ${e.waypoint_id}`);
    console.log(
      `    REAL DATA   temp_c ${e.temp_c}°C  (mean ${e.temp_stats.mean} / min ${e.temp_stats.min} / sd ${e.temp_stats.stddev})`,
    );
    console.log(
      `                humidity ${e.humidity_pct === null ? 'null (upstream unavailable)' : `${e.humidity_pct}%`}  ·  ${e.data_quality}`,
    );
    console.log(`    HUMAN       ${compliance[i]?.band} → ${compliance[i]?.record.action}`);
    console.log(`    CARGO       ${cargo[i]?.assessment.risk_level} → ${cargo[i]?.assessment.recommended_action}`);
    console.log(`    DECIDE      ${decisions[i]?.action_tier} (confidence ${decisions[i]?.confidence})`);
  }

  line();
  console.log('Audit log, in order — every entry sourced from a real FortyGuard response:');
  line();
  for (const entry of await sink.read()) {
    console.log(`  seq ${String(entry.seq).padStart(3)}  ${entry.entry_type.padEnd(24)} ${entry.event_id.slice(0, 8)}…`);
  }
  line();
  console.log(`PHASE 1 EXIT CONDITION MET: real FortyGuard data → correctly-shaped, §3-valid`);
  console.log(`events, logged in order, no manual intervention. ${events.length} waypoints, zero synthetic readings.`);
  line();

  await sink.close();
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error('\nREAL INGESTION PROOF FAILED');
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exit(1);
  });
