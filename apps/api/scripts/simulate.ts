/**
 * Runs one simulated route through the full pipeline and prints the audit log.
 *
 * Default sink is IN-MEMORY. Synthetic events are stamped
 * `source: "fortyguard_api"` because §3 permits no other value, so writing them
 * to the real append-only log would assert a provenance that is untrue — and
 * could not be deleted afterwards. Pass --persist <url> to override, only ever
 * at a scratch database.
 *
 *   npm run simulate --workspace @threshold/api
 *   npm run simulate --workspace @threshold/api -- --spike wp-3=20
 */

import { InMemoryAuditSink, PostgresAuditSink, type AuditSink } from '@threshold/audit';
import {
  SimulatedTelemetryAdapter,
  SyntheticThermalReadingSource,
  type RouteSpec,
} from '@threshold/ingestion';
import { RouteRegistry } from '@threshold/risk-engine';
import { RiskPipeline } from '../src/pipeline.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

/** --spike wp-3=20 --spike wp-4=6 */
function parseSpikes(): Record<string, number> {
  const out: Record<string, number> = {};
  process.argv.forEach((a, i) => {
    if (a !== '--spike') return;
    const raw = process.argv[i + 1];
    if (!raw) return;
    const [id, delta] = raw.split('=');
    if (id && delta && Number.isFinite(Number(delta))) out[id] = Number(delta);
  });
  return out;
}

const ROUTE: RouteSpec = {
  route_id: 'route-phx-01',
  driver_id: 'driver-42',
  cargo_class: (arg('cargo') as RouteSpec['cargo_class']) ?? 'pharma',
  departs_at: '2026-08-17T13:00:00.000Z',
  leg_minutes: 60,
  waypoints: [
    { waypoint_id: 'wp-1', lat: 33.4484, lng: -112.074 },
    { waypoint_id: 'wp-2', lat: 33.5, lng: -112.1 },
    { waypoint_id: 'wp-3', lat: 33.56, lng: -112.15 },
    { waypoint_id: 'wp-4', lat: 33.62, lng: -112.2 },
  ],
};

const line = (): void => console.log('─'.repeat(96));

async function main(): Promise<number> {
  const persistUrl = arg('persist');
  const spikes = parseSpikes();
  const degraded = (arg('no-humidity') ?? '').split(',').filter(Boolean);

  let sink: AuditSink;
  if (persistUrl) {
    console.log('!! PERSISTING to a real database. Entries can never be deleted.');
    sink = new PostgresAuditSink({ connectionString: persistUrl });
  } else {
    sink = new InMemoryAuditSink();
  }

  const routes = new RouteRegistry().register({
    route_id: ROUTE.route_id,
    driver_id: ROUTE.driver_id,
    cargo_class: ROUTE.cargo_class,
  });

  const pipeline = new RiskPipeline({ sink, routes, initialExposureHours: 1 });
  const telemetry = new SimulatedTelemetryAdapter({ route: ROUTE, seed: 1234 });
  const readings = new SyntheticThermalReadingSource({
    seed: 99,
    spikes,
    humidityUnavailableAt: degraded,
  });

  line();
  console.log(`Threshold — simulated route  (SYNTHETIC DATA, no FortyGuard call)`);
  line();
  console.log(`  route        : ${ROUTE.route_id}`);
  console.log(`  cargo        : ${ROUTE.cargo_class}`);
  console.log(`  driver       : ${ROUTE.driver_id}`);
  console.log(`  waypoints    : ${ROUTE.waypoints.length} @ ${ROUTE.leg_minutes} min legs`);
  console.log(`  spikes       : ${Object.keys(spikes).length ? JSON.stringify(spikes) : 'none'}`);
  console.log(`  no humidity  : ${degraded.length ? degraded.join(', ') : 'none'}`);
  console.log(`  sink         : ${persistUrl ? 'Postgres (PERSISTED)' : 'in-memory'}`);
  line();

  const { events, compliance, cargo } = await pipeline.run(telemetry, readings);

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const h = compliance[i];
    const c = cargo[i];
    if (!e || !h || !c) continue;

    console.log(`\n▸ ${e.waypoint_id}  ${e.timestamp}`);
    console.log(
      `    event   temp_c ${e.temp_c}°C  (stats mean ${e.temp_stats.mean} / min ${e.temp_stats.min} / sd ${e.temp_stats.stddev})`,
    );
    console.log(
      `            humidity ${e.humidity_pct === null ? 'null' : `${e.humidity_pct}%`}  ·  ${e.data_quality}`,
    );
    console.log(
      `    HUMAN   band ${h.band.toUpperCase().padEnd(8)} heat_index ${
        h.record.heat_index_c === null ? 'null (degraded)' : `${h.record.heat_index_c}°C`
      }  → ${h.record.action}`,
    );
    console.log(
      `    CARGO   ${c.assessment.risk_level.toUpperCase().padEnd(8)} exposure ${c.assessment.cumulative_exposure_score}/${c.assessment.threshold} °C·h  → ${c.assessment.recommended_action}`,
    );
  }

  line();
  console.log('Audit log — one event, two liability responses, correlated by event_id');
  line();
  const entries = await sink.read();
  for (const entry of entries) {
    console.log(
      `  seq ${String(entry.seq).padStart(3)}  ${entry.entry_type.padEnd(24)} ${entry.event_id.slice(0, 8)}…`,
    );
  }
  line();
  console.log(`${entries.length} entries for ${events.length} events (1 event + 2 responses each).`);
  if (!persistUrl) console.log('Nothing was written to a real database.');
  line();

  await sink.close();
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error('\nSIMULATION FAILED');
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exit(1);
  });
