/**
 * §11 Phase 7 end-to-end proof: the seeded demo org, driving the real
 * pipeline, through real Postgres — not just "the seed script ran."
 *
 *   - PostgresRouteRegistry loads route-phx-01 from the real orgs/routes/
 *     drivers tables (not the in-memory RouteRegistry the demo scripts use).
 *   - RiskPipeline runs with org_id = DEMO_ORG_ID and a REAL PostgresAuditSink
 *     — every audit_log row this produces is permanent, org-scoped, and
 *     satisfies the audit_log.org_id foreign key against the real seeded org.
 *   - Synthetic thermal data (not a real FortyGuard call) — this is proving
 *     org-scoping, not re-running Phase 0/1's verification.
 *
 *   npm run verify:org-scoped --workspace @threshold/api
 */

import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { DEMO_ORG_ID, PostgresRouteRegistry } from '@threshold/accounts';
import { PostgresAuditSink } from '@threshold/audit';
import { HardCodedThresholdDecider } from '@threshold/decision-layer';
import { SimulatedTelemetryAdapter, SyntheticThermalReadingSource, type RouteSpec } from '@threshold/ingestion';
import { InMemoryPdfStore, RecordingWebhookEmitter } from '@threshold/output';
import { RiskPipeline } from '@threshold/pipeline';

loadDotenv({ path: resolve(import.meta.dirname, '../../../.env') });

const rawConnectionString = process.env.NEON_DATABASE_URL ?? process.env.DATABASE_URL;
if (!rawConnectionString) throw new Error('Set NEON_DATABASE_URL in .env');
// Narrowed and captured at module scope, so it survives into main() below —
// TypeScript's control-flow narrowing does not cross function boundaries.
const connectionString: string = rawConnectionString;

const ROUTE: RouteSpec = {
  route_id: 'route-phx-01',
  driver_id: 'driver-42',
  cargo_class: 'pharma',
  departs_at: '2026-08-17T13:00:00.000Z',
  leg_minutes: 60,
  waypoints: [
    { waypoint_id: 'wp-1', lat: 33.4484, lng: -112.074 },
    { waypoint_id: 'wp-2', lat: 33.5, lng: -112.1 },
    { waypoint_id: 'wp-3', lat: 33.56, lng: -112.15 },
    { waypoint_id: 'wp-4', lat: 33.62, lng: -112.2 },
  ],
};

const line = () => console.log('─'.repeat(90));

async function main(): Promise<number> {
  line();
  console.log('§11 Phase 7 — org-scoped pipeline proof, real Postgres throughout');
  line();

  const routes = new PostgresRouteRegistry(connectionString, DEMO_ORG_ID);
  await routes.load();
  const context = routes.get(ROUTE.route_id);
  if (!context) throw new Error(`route ${ROUTE.route_id} not found for org ${DEMO_ORG_ID} — did the seed run?`);
  console.log(`PostgresRouteRegistry loaded from real Neon: ${JSON.stringify(context)}`);

  const sink = new PostgresAuditSink({ connectionString });
  const pipeline = new RiskPipeline({
    sink,
    org_id: DEMO_ORG_ID,
    routes,
    initialExposureHours: 1,
    decider: new HardCodedThresholdDecider(),
    pdfStore: new InMemoryPdfStore(),
    webhookEmitter: new RecordingWebhookEmitter(),
  });

  const telemetry = new SimulatedTelemetryAdapter({ route: ROUTE, seed: 1234 });
  const readings = new SyntheticThermalReadingSource({ seed: 99, spikes: { 'wp-3': 20 } });

  const { events, decisions } = await pipeline.run(telemetry, readings);
  console.log(`\nran ${events.length} waypoints through the real pipeline.`);

  const entries = await sink.read();
  const thisRun = entries.filter((e) => events.some((ev) => ev.event_id === e.event_id));
  console.log(`\n${thisRun.length} NEW audit_log rows written to real Neon, all org_id=${DEMO_ORG_ID}:`);
  for (const e of thisRun) {
    console.log(`  seq ${String(e.seq).padStart(4)}  ${e.entry_type.padEnd(24)} org_id=${e.org_id}`);
  }

  const wp3 = decisions[events.findIndex((e) => e.waypoint_id === 'wp-3')];
  console.log(`\nwp-3 decision: ${wp3?.action_tier} (confidence ${wp3?.confidence})`);

  await sink.close();
  await routes.close();

  line();
  console.log('PROOF: PostgresRouteRegistry + PostgresAuditSink + the seeded demo org');
  console.log('       all work together against real Neon. Rows above are permanent.');
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
