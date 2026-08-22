/**
 * Product-shell wiring follow-up: the demo org's existing compliance_record/
 * cargo_risk_assessment rows (from verify-org-scoped.ts's Phase 7 proof run)
 * used InMemoryPdfStore — their exported_pdf_url values are memory://…,
 * already-dead the moment that process exited. GET /api/audit now serves
 * real orgs' data to a real product UI, which needs a link that actually
 * resolves. This appends ONE more real pipeline run for the same demo route,
 * using LocalFilePdfStore against the directory apps/api/src/server.ts
 * serves at /pdfs/*, so the new rows carry real, clickable PDF URLs.
 *
 * audit_log is append-only — this adds new rows, it does not and cannot
 * replace the old memory:// ones. That's correct: the old rows are a
 * genuine historical record of that proof run, not something to silently
 * rewrite.
 *
 *   npm run generate:real-pdfs --workspace @threshold/api
 */

import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { DEMO_ORG_ID, PostgresRouteRegistry } from '@threshold/accounts';
import { PostgresAuditSink } from '@threshold/audit';
import { HardCodedThresholdDecider } from '@threshold/decision-layer';
import { SimulatedTelemetryAdapter, SyntheticThermalReadingSource, type RouteSpec } from '@threshold/ingestion';
import { LocalFilePdfStore, RecordingWebhookEmitter } from '@threshold/output';
import { RiskPipeline } from '@threshold/pipeline';

loadDotenv({ path: resolve(import.meta.dirname, '../../../.env') });

const rawConnectionString = process.env.NEON_DATABASE_URL ?? process.env.DATABASE_URL;
if (!rawConnectionString) throw new Error('Set NEON_DATABASE_URL in .env');
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

async function main(): Promise<number> {
  const routes = new PostgresRouteRegistry(connectionString, DEMO_ORG_ID);
  await routes.load();

  const sink = new PostgresAuditSink({ connectionString });
  const pdfStore = new LocalFilePdfStore(resolve(import.meta.dirname, '../artifacts/pdfs'));

  const pipeline = new RiskPipeline({
    sink,
    org_id: DEMO_ORG_ID,
    routes,
    initialExposureHours: 1,
    decider: new HardCodedThresholdDecider(),
    pdfStore,
    webhookEmitter: new RecordingWebhookEmitter(),
  });

  const telemetry = new SimulatedTelemetryAdapter({ route: ROUTE, seed: 1234 });
  const readings = new SyntheticThermalReadingSource({ seed: 99, spikes: { 'wp-3': 20 } });

  const { events } = await pipeline.run(telemetry, readings);
  console.log(`Ran ${events.length} waypoints with LocalFilePdfStore — real PDFs written to artifacts/pdfs/.`);

  const entries = await sink.read();
  const thisRun = entries.filter((e) => events.some((ev) => ev.event_id === e.event_id));
  for (const e of thisRun) {
    const url =
      e.entry_type === 'compliance_record' || e.entry_type === 'cargo_risk_assessment'
        ? (e.payload as { exported_pdf_url?: string }).exported_pdf_url
        : undefined;
    console.log(`  seq ${String(e.seq).padStart(4)}  ${e.entry_type.padEnd(24)}${url ? ` pdf=${url}` : ''}`);
  }

  await sink.close();
  await routes.close();
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exit(1);
  });
