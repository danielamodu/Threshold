/**
 * Runs one simulated route through the full pipeline and prints the audit log.
 *
 * Default sink is IN-MEMORY. Synthetic events are stamped
 * `source: "fortyguard_api"` because §3 permits no other value, so writing them
 * to the real append-only log would assert a provenance that is untrue — and
 * could not be deleted afterwards. Pass --persist <url> to override, only ever
 * at a scratch database.
 *
 * Also runs the Phase 3 hard-coded-threshold fallback (§9) on every event's
 * combined evaluator output. It is not the LLM orchestrator — that reads
 * both evaluator outputs via Claude or Gemini and is a separate, still-open
 * decision per §10 — this is the deterministic safety net that runs whether
 * or not that later layer ever lands.
 *
 * And Phase 4's Output/Integration Layer (§6): every compliance record gets a
 * real PDF (written to artifacts/pdfs/, gitignored), a breach gets a claim
 * draft PDF too, an elevated (not yet breaching) event gets a mocked reroute
 * suggestion, and every decision fires a webhook — recorded here rather than
 * sent, since nothing external subscribes yet (pass --webhook-url to send
 * for real).
 *
 *   npm run simulate --workspace @threshold/api
 *   npm run simulate --workspace @threshold/api -- --spike wp-3=20
 *   npm run simulate --workspace @threshold/api -- --spike wp-3=20 --auto-execute
 *   npm run simulate --workspace @threshold/api -- --spike wp-3=20 --webhook-url https://example.com/hook
 */

import { resolve } from 'node:path';
import { InMemoryAuditSink, PostgresAuditSink, type AuditSink } from '@threshold/audit';
import { HardCodedThresholdDecider } from '@threshold/decision-layer';
import {
  SimulatedTelemetryAdapter,
  SyntheticThermalReadingSource,
  type RouteSpec,
} from '@threshold/ingestion';
import {
  HttpWebhookEmitter,
  LocalFilePdfStore,
  RecordingWebhookEmitter,
  type WebhookEmitter,
} from '@threshold/output';
import { RiskPipeline } from '@threshold/pipeline';
import { RouteRegistry } from '@threshold/risk-engine';
import { DEMO_ORG_ID } from '@threshold/accounts';

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
  const allowAutoExecute = process.argv.includes('--auto-execute');
  const webhookUrl = arg('webhook-url');

  let sink: AuditSink;
  if (persistUrl) {
    console.log('!! PERSISTING to a real database. Entries can never be deleted.');
    console.log(
      `!! audit_log.org_id has a foreign key to orgs(${DEMO_ORG_ID}) — run ` +
        `\`npm run seed --workspace @threshold/accounts\` against this same database first.`,
    );
    sink = new PostgresAuditSink({ connectionString: persistUrl });
  } else {
    sink = new InMemoryAuditSink();
  }

  const routes = new RouteRegistry().register({
    route_id: ROUTE.route_id,
    driver_id: ROUTE.driver_id,
    cargo_class: ROUTE.cargo_class,
  });

  const pdfDir = resolve(import.meta.dirname, '../../../artifacts/pdfs');
  const webhookEmitter: WebhookEmitter = webhookUrl
    ? new HttpWebhookEmitter(webhookUrl)
    : new RecordingWebhookEmitter();

  const pipeline = new RiskPipeline({
    sink,
    org_id: DEMO_ORG_ID,
    routes,
    initialExposureHours: 1,
    decider: new HardCodedThresholdDecider({ allowAutoExecute }),
    pdfStore: new LocalFilePdfStore(pdfDir, '/pdfs'),
    webhookEmitter,
  });
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
  console.log(`  auto-execute : ${allowAutoExecute ? 'ALLOWED (--auto-execute)' : 'capped at draft (default)'}`);
  console.log(`  sink         : ${persistUrl ? 'Postgres (PERSISTED)' : 'in-memory'}`);
  console.log(`  PDFs         : ${pdfDir}`);
  console.log(`  webhook      : ${webhookUrl ? `POST ${webhookUrl}` : 'recorded only (no --webhook-url given)'}`);
  line();

  const { events, compliance, cargo, decisions, claimDrafts } = await pipeline.run(telemetry, readings);

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const h = compliance[i];
    const c = cargo[i];
    const d = decisions[i];
    if (!e || !h || !c || !d) continue;

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
    console.log(`            compliance PDF: ${h.record.exported_pdf_url}`);

    if (c.assessment.claim_draft_id) {
      const draft = claimDrafts.find((d2) => d2.claim_draft_id === c.assessment.claim_draft_id);
      console.log(`            claim draft:    ${draft?.exported_pdf_url ?? '(pending)'}`);
    } else if (c.assessment.reroute_suggestion) {
      const r = c.assessment.reroute_suggestion as { suggested_action: string; advisory: string };
      console.log(`            reroute (mock): ${r.suggested_action} — "${r.advisory}"`);
    }

    console.log(
      `    DECIDE  ${d.action_tier.toUpperCase().padEnd(8)} confidence ${d.confidence}  (fallback rule, no model)`,
    );
    console.log(`            "${d.rationale}"`);
  }

  line();
  console.log('Audit log — one event, three responses, correlated by event_id');
  line();
  const entries = await sink.read();
  for (const entry of entries) {
    console.log(
      `  seq ${String(entry.seq).padStart(3)}  ${entry.entry_type.padEnd(24)} ${entry.event_id.slice(0, 8)}…`,
    );
  }
  line();
  console.log(`${entries.length} entries for ${events.length} events (1 event + 2 evaluations + 1 decision each).`);
  console.log(`${claimDrafts.length} claim draft(s) generated (breach events only).`);
  if (webhookEmitter instanceof RecordingWebhookEmitter) {
    console.log(`${webhookEmitter.deliveries.length} webhook payload(s) recorded (nothing sent — no --webhook-url).`);
  }
  if (!persistUrl) console.log('Nothing was written to a real database.');
  console.log(`PDFs written under ${pdfDir}`);
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
