'use server';

/**
 * Phase 5 demo action (§6).
 *
 * Runs entirely in-process, inside Next.js's own server — not by calling out
 * to the Fastify backend (apps/api). Deliberate choice: §6 Phase 5's exit
 * condition is about the judge-facing INTERACTION working reliably ("a
 * stranger could click the injector and understand what happened without
 * narration"), and requiring two separate servers to both be up during
 * judging is exactly the kind of avoidable reliability risk a demo shouldn't
 * carry. apps/api's Fastify server remains the documented "real backend" per
 * §4's tech stack and is what Phase 6 deploys to its own production URL —
 * this action doesn't replace it, it just doesn't depend on it being alive
 * for the demo to work.
 *
 * Same demo route as apps/api/scripts/simulate.ts's default. Duplicated
 * rather than shared: it's a ten-line literal, not logic — RiskPipeline
 * itself (the thing worth not duplicating) already moved to
 * @threshold/pipeline for exactly this reason.
 *
 * `'use server'` files may only export async functions — INJECTOR_WAYPOINT_ID
 * and every type live in demo-types.ts instead.
 */

import { InMemoryAuditSink } from '@threshold/audit';
import { HardCodedThresholdDecider, cargoSeverity, complianceSeverity } from '@threshold/decision-layer';
import {
  SimulatedTelemetryAdapter,
  SyntheticThermalReadingSource,
  type RouteSpec,
} from '@threshold/ingestion';
import { InMemoryPdfStore, RecordingWebhookEmitter } from '@threshold/output';
import { RiskPipeline } from '@threshold/pipeline';
import { RouteRegistry } from '@threshold/risk-engine';
import { INJECTOR_WAYPOINT_ID, type DemoRunResult, type DemoWaypoint } from './demo-types';

const DEMO_ROUTE: RouteSpec = {
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

const INJECTOR_SPIKE_C = 20;

/**
 * Runs the demo route once, synthetic data (never a real FortyGuard call —
 * this is a UI demo path, not Phase 0/1's verification harness). Pass
 * `spike: true` to inject the heat spike at {@link INJECTOR_WAYPOINT_ID}.
 */
export async function runDemoRoute(spike: boolean): Promise<DemoRunResult> {
  const sink = new InMemoryAuditSink();
  const routes = new RouteRegistry().register({
    route_id: DEMO_ROUTE.route_id,
    driver_id: DEMO_ROUTE.driver_id,
    cargo_class: DEMO_ROUTE.cargo_class,
  });

  const pipeline = new RiskPipeline({
    sink,
    routes,
    initialExposureHours: 1,
    decider: new HardCodedThresholdDecider(),
    pdfStore: new InMemoryPdfStore(),
    webhookEmitter: new RecordingWebhookEmitter(),
  });

  const telemetry = new SimulatedTelemetryAdapter({ route: DEMO_ROUTE, seed: 1234 });
  const readings = new SyntheticThermalReadingSource({
    seed: 99,
    spikes: spike ? { [INJECTOR_WAYPOINT_ID]: INJECTOR_SPIKE_C } : {},
  });

  const { events, compliance, cargo, decisions } = await pipeline.run(telemetry, readings);

  const waypoints: DemoWaypoint[] = events.map((event, i) => {
    const wp = DEMO_ROUTE.waypoints.find((w) => w.waypoint_id === event.waypoint_id);
    const record = compliance[i]?.record;
    const assessment = cargo[i]?.assessment;
    const decision = decisions[i];
    if (!wp || !record || !assessment || !decision) {
      throw new Error(`Demo pipeline produced an incomplete result for waypoint ${event.waypoint_id}`);
    }
    return {
      waypoint_id: event.waypoint_id,
      lat: wp.lat,
      lng: wp.lng,
      event,
      compliance: record,
      cargo: assessment,
      decision,
      human_severity: complianceSeverity(record.action),
      cargo_severity: cargoSeverity(assessment.risk_level),
    };
  });

  await sink.close();

  return {
    route_id: DEMO_ROUTE.route_id,
    cargo_class: DEMO_ROUTE.cargo_class,
    driver_id: DEMO_ROUTE.driver_id,
    spiked: spike,
    waypoints,
  };
}
