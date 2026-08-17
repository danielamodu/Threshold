/**
 * §6 Phase 2 exit condition:
 *
 *   "feed a synthetic breach event in, both evaluators independently produce
 *    correct, audit-logged outputs."
 *
 * Plus §1's core insight made checkable: one event, two liability responses,
 * correlated by event_id in a single append-only log.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { InMemoryAuditSink } from '@threshold/audit';
import {
  SimulatedTelemetryAdapter,
  SyntheticThermalReadingSource,
  type RouteSpec,
} from '@threshold/ingestion';
import { RouteRegistry } from '@threshold/risk-engine';
import {
  assertValid,
  validateCargoRiskAssessment,
  validateComplianceRecord,
  validateThermalExposureEvent,
} from '@threshold/types';
import { RiskPipeline } from '../src/pipeline.js';

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

function build(readingOptions: Record<string, unknown> = {}) {
  const sink = new InMemoryAuditSink();
  const routes = new RouteRegistry().register({
    route_id: ROUTE.route_id,
    driver_id: ROUTE.driver_id,
    cargo_class: ROUTE.cargo_class,
  });
  const pipeline = new RiskPipeline({ sink, routes, initialExposureHours: 1 });
  const telemetry = new SimulatedTelemetryAdapter({ route: ROUTE, seed: 1234 });
  const readings = new SyntheticThermalReadingSource({ seed: 99, ...readingOptions });
  return { sink, pipeline, telemetry, readings };
}

describe('risk pipeline (Phase 2 exit condition)', () => {
  it('runs a whole simulated route with no manual intervention', async () => {
    const { pipeline, telemetry, readings } = build();
    const { events, compliance, cargo } = await pipeline.run(telemetry, readings);

    assert.equal(events.length, 4);
    assert.equal(compliance.length, 4, 'every event must produce a compliance record');
    assert.equal(cargo.length, 4, 'every event must produce a cargo assessment');
  });

  it('both evaluators respond to the SAME event, independently', async () => {
    const { pipeline, telemetry, readings } = build();
    const { events, compliance, cargo } = await pipeline.run(telemetry, readings);

    for (let i = 0; i < events.length; i++) {
      const id = events[i]?.event_id;
      assert.equal(compliance[i]?.record.event_id, id);
      assert.equal(cargo[i]?.assessment.event_id, id);
    }
  });

  it('every logged payload is §3-valid', async () => {
    const { sink, pipeline, telemetry, readings } = build();
    await pipeline.run(telemetry, readings);

    for (const entry of await sink.read()) {
      switch (entry.entry_type) {
        case 'thermal_exposure_event':
          assertValid('logged event', validateThermalExposureEvent(entry.payload));
          break;
        case 'compliance_record':
          assertValid('logged ComplianceRecord', validateComplianceRecord(entry.payload));
          break;
        case 'cargo_risk_assessment':
          assertValid('logged CargoRiskAssessment', validateCargoRiskAssessment(entry.payload));
          break;
        default:
          assert.fail(`unexpected entry_type ${entry.entry_type} in Phase 2`);
      }
    }
  });

  it('logs the event BEFORE its evaluations, so no record dangles', async () => {
    const { sink, pipeline, telemetry, readings } = build();
    await pipeline.run(telemetry, readings);
    const entries = await sink.read();

    const seenEvents = new Set<string>();
    for (const entry of entries) {
      if (entry.entry_type === 'thermal_exposure_event') {
        seenEvents.add(entry.event_id);
      } else {
        assert.ok(
          seenEvents.has(entry.event_id),
          `${entry.entry_type} at seq ${entry.seq} references an unlogged event`,
        );
      }
    }
  });

  it('logs in monotonic order', async () => {
    const { sink, pipeline, telemetry, readings } = build();
    await pipeline.run(telemetry, readings);
    const seqs = (await sink.read()).map((e) => e.seq);
    assert.deepEqual([...seqs].sort((a, b) => a - b), seqs);
  });

  it('writes exactly three entries per event — one event, two responses', async () => {
    const { sink, pipeline, telemetry, readings } = build();
    await pipeline.run(telemetry, readings);
    const entries = await sink.read();

    assert.equal(entries.length, 12); // 4 events x 3
    assert.equal(entries.filter((e) => e.entry_type === 'thermal_exposure_event').length, 4);
    assert.equal(entries.filter((e) => e.entry_type === 'compliance_record').length, 4);
    assert.equal(entries.filter((e) => e.entry_type === 'cargo_risk_assessment').length, 4);
  });

  describe('the core insight (§1): one heat spike, both liabilities fire', () => {
    it('a spike at one waypoint escalates BOTH sides for that event', async () => {
      // 20C above ambient at wp-3: hot enough for OSHA extreme on the human
      // side and far past the pharma ceiling on the cargo side.
      const { sink, pipeline, telemetry, readings } = build({ spikes: { 'wp-3': 20 } });
      const { events, compliance, cargo } = await pipeline.run(telemetry, readings);

      const spikeIndex = events.findIndex((e) => e.waypoint_id === 'wp-3');
      assert.ok(spikeIndex >= 0);

      const humanAtSpike = compliance[spikeIndex];
      const cargoAtSpike = cargo[spikeIndex];
      assert.ok(humanAtSpike && cargoAtSpike);

      assert.equal(humanAtSpike.band, 'extreme');
      assert.equal(humanAtSpike.record.action, 'work_limit_reduced');
      assert.equal(cargoAtSpike.assessment.risk_level, 'breach');
      assert.equal(cargoAtSpike.assessment.recommended_action, 'claim_draft');

      // And the correlation key ties all three rows together — the query the
      // demo actually shows a judge.
      const eventId = events[spikeIndex]?.event_id;
      const related = (await sink.read()).filter((e) => e.event_id === eventId);
      assert.equal(related.length, 3);
      assert.deepEqual(
        related.map((e) => e.entry_type).sort(),
        ['cargo_risk_assessment', 'compliance_record', 'thermal_exposure_event'],
      );
    });
  });

  describe('degraded humidity degrades one side only', () => {
    it('nulls heat_index_c but still scores cargo, which needs no humidity', async () => {
      const { pipeline, telemetry, readings } = build({
        spikes: { 'wp-2': 20 },
        humidityUnavailableAt: ['wp-2'],
      });
      const { events, compliance, cargo } = await pipeline.run(telemetry, readings);

      const i = events.findIndex((e) => e.waypoint_id === 'wp-2');
      assert.ok(i >= 0);
      assert.equal(events[i]?.data_quality, 'degraded_no_humidity');

      // Human side: no heat index, but protection still issued.
      assert.equal(compliance[i]?.record.heat_index_c, null);
      assert.equal(compliance[i]?.usedFallback, true);
      assert.notEqual(compliance[i]?.record.action, 'none');

      // Cargo side: entirely unaffected.
      assert.equal(cargo[i]?.assessment.risk_level, 'breach');
    });
  });

  it('cargo exposure accumulates across the route', async () => {
    const { pipeline, telemetry, readings } = build();
    const { cargo } = await pipeline.run(telemetry, readings);
    const scores = cargo.map((c) => c.assessment.cumulative_exposure_score);
    for (let i = 1; i < scores.length; i++) {
      assert.ok(
        (scores[i] ?? 0) >= (scores[i - 1] ?? 0),
        `cumulative score must never fall: ${scores.join(' -> ')}`,
      );
    }
  });

  it('is deterministic — the same seed yields the same audit log', async () => {
    const first = build();
    await first.pipeline.run(first.telemetry, first.readings);
    const second = build();
    await second.pipeline.run(second.telemetry, second.readings);

    const strip = (entries: Awaited<ReturnType<InMemoryAuditSink['read']>>) =>
      entries.map((e) => ({ type: e.entry_type, route: e.route_id, seq: e.seq }));

    assert.deepEqual(strip(await first.sink.read()), strip(await second.sink.read()));
  });
});
