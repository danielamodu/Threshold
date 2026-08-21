import type { FastifyInstance } from 'fastify';
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
import { DEMO_ORG_ID } from '@threshold/accounts';

/**
 * Real HTTP surface for the demo pipeline (§6 Phase 5, exposed for external
 * frontends — added when the in-house dashboard's UI was being replaced and
 * the replacement needed something to actually call).
 *
 * Same demo route and pipeline wiring as apps/web/app/actions.ts's Server
 * Action — that action runs the identical logic in-process inside Next.js;
 * this exposes it over plain HTTP for any other frontend. Not shared as a
 * function because the two call sites have different framework constraints
 * (Next.js Server Actions vs Fastify handlers) around a genuinely small
 * amount of demo-specific wiring — the actual shared logic (RiskPipeline) is
 * already the one place this couldn't be duplicated.
 */

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

const DEFAULT_SPIKE_WAYPOINT = 'wp-3';
const DEFAULT_SPIKE_C = 20;

interface SimulateBody {
  /** True applies a spike at spike_waypoint_id. False (default) is the clean baseline. */
  spike?: boolean;
  /** Which waypoint gets the spike. Defaults to wp-3. Must be one of the four ids above. */
  spike_waypoint_id?: string;
  /** Degrees C added at that waypoint. Defaults to 20. */
  spike_amount_c?: number;
}

async function runDemoRoute(options: {
  spike: boolean;
  spikeWaypointId: string;
  spikeAmountC: number;
}) {
  const sink = new InMemoryAuditSink();
  const routes = new RouteRegistry().register({
    route_id: DEMO_ROUTE.route_id,
    driver_id: DEMO_ROUTE.driver_id,
    cargo_class: DEMO_ROUTE.cargo_class,
  });

  const pipeline = new RiskPipeline({
    sink,
    org_id: DEMO_ORG_ID,
    routes,
    initialExposureHours: 1,
    decider: new HardCodedThresholdDecider(),
    pdfStore: new InMemoryPdfStore(),
    webhookEmitter: new RecordingWebhookEmitter(),
  });

  const telemetry = new SimulatedTelemetryAdapter({ route: DEMO_ROUTE, seed: 1234 });
  const readings = new SyntheticThermalReadingSource({
    seed: 99,
    spikes: options.spike ? { [options.spikeWaypointId]: options.spikeAmountC } : {},
  });

  const { events, compliance, cargo, decisions } = await pipeline.run(telemetry, readings);

  const waypoints = events.map((event, i) => {
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
    spiked: options.spike,
    spike_waypoint_id: options.spike ? options.spikeWaypointId : null,
    waypoints,
  };
}

export function registerDemoRoutes(app: FastifyInstance): void {
  /** Static route metadata — enough to draw a map before running anything. */
  app.get('/api/route', async () => ({
    route_id: DEMO_ROUTE.route_id,
    cargo_class: DEMO_ROUTE.cargo_class,
    driver_id: DEMO_ROUTE.driver_id,
    waypoints: DEMO_ROUTE.waypoints,
  }));

  /**
   * Runs the pipeline and returns the full result: one entry per waypoint,
   * each carrying the thermal event, both evaluator outputs, the fallback
   * decision, and pre-computed severity buckets for coloring. Synthetic data
   * only — this is the demo path, not Phase 0/1's real-API harness.
   */
  app.post<{ Body: SimulateBody }>('/api/simulate', async (request, reply) => {
    const body = request.body ?? {};
    const spike = body.spike ?? false;
    const spikeWaypointId = body.spike_waypoint_id ?? DEFAULT_SPIKE_WAYPOINT;
    const spikeAmountC = body.spike_amount_c ?? DEFAULT_SPIKE_C;

    const validIds = DEMO_ROUTE.waypoints.map((w) => w.waypoint_id);
    if (!validIds.includes(spikeWaypointId)) {
      return reply.code(400).send({
        error: `spike_waypoint_id must be one of ${validIds.join(', ')}`,
      });
    }

    const result = await runDemoRoute({ spike, spikeWaypointId, spikeAmountC });
    return result;
  });
}
