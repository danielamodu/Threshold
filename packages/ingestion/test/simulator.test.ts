import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { assertValid, validateThermalExposureEvent } from '@threshold/types';
import {
  ForecastHorizonError,
  SimulatedTelemetryAdapter,
  SyntheticThermalReadingSource,
  collect,
  deriveDataQuality,
  routeSpanHours,
  sequentialIdFactory,
  toThermalExposureEvent,
  type RouteSpec,
} from '../src/index.js';

function route(overrides: Partial<RouteSpec> = {}): RouteSpec {
  return {
    route_id: 'route-phx-01',
    driver_id: 'driver-42',
    cargo_class: 'pharma',
    departs_at: '2026-08-17T13:00:00.000Z',
    leg_minutes: 45,
    waypoints: [
      { waypoint_id: 'wp-1', lat: 33.4484, lng: -112.074 },
      { waypoint_id: 'wp-2', lat: 33.5, lng: -112.1 },
      { waypoint_id: 'wp-3', lat: 33.56, lng: -112.15 },
      { waypoint_id: 'wp-4', lat: 33.62, lng: -112.2 },
    ],
    ...overrides,
  };
}

const pipeline = (spec = route(), readingOpts = {}) =>
  collect(
    new SimulatedTelemetryAdapter({ route: spec, seed: 1234 }),
    new SyntheticThermalReadingSource({ seed: 99, ...readingOpts }),
    { newId: sequentialIdFactory() },
  );

describe('route/telemetry simulator', () => {
  describe('telemetry', () => {
    it('emits one waypoint per route point, in travel order', () => {
      const spec = route();
      const stream = [...new SimulatedTelemetryAdapter({ route: spec, seed: 1 }).stream()];
      assert.equal(stream.length, 4);
      assert.deepEqual(
        stream.map((w) => w.waypoint_id),
        ['wp-1', 'wp-2', 'wp-3', 'wp-4'],
      );
    });

    it('advances timestamps by leg_minutes', () => {
      const stream = [...new SimulatedTelemetryAdapter({ route: route(), seed: 1 }).stream()];
      assert.equal(stream[0]?.timestamp, '2026-08-17T13:00:00.000Z');
      assert.equal(stream[1]?.timestamp, '2026-08-17T13:45:00.000Z');
      assert.equal(stream[3]?.timestamp, '2026-08-17T15:15:00.000Z');
    });

    it('carries cargo_class and driver_id onto every waypoint', () => {
      const stream = [...new SimulatedTelemetryAdapter({ route: route(), seed: 1 }).stream()];
      for (const w of stream) {
        assert.equal(w.cargo_class, 'pharma');
        assert.equal(w.driver_id, 'driver-42');
        assert.equal(w.route_id, 'route-phx-01');
      }
    });

    it('is deterministic — same seed, identical output', () => {
      const a = [...new SimulatedTelemetryAdapter({ route: route(), seed: 4242 }).stream()];
      const b = [...new SimulatedTelemetryAdapter({ route: route(), seed: 4242 }).stream()];
      assert.deepEqual(a, b);
    });

    it('differs on a different seed, so the seed actually does something', () => {
      const a = [...new SimulatedTelemetryAdapter({ route: route(), seed: 1 }).stream()];
      const b = [...new SimulatedTelemetryAdapter({ route: route(), seed: 2 }).stream()];
      assert.notDeepEqual(a, b);
    });

    it('rejects a route that outruns the 12h forecast horizon (§8)', () => {
      // 20 legs x 60min = 20h, well past the horizon. Better to fail loudly than
      // to emit forecast data the upstream cannot actually supply.
      const tooLong = route({
        leg_minutes: 60,
        waypoints: Array.from({ length: 21 }, (_, i) => ({
          waypoint_id: `wp-${i + 1}`,
          lat: 33 + i * 0.01,
          lng: -112,
        })),
      });
      assert.equal(routeSpanHours(tooLong), 20);
      assert.throws(() => new SimulatedTelemetryAdapter({ route: tooLong }), ForecastHorizonError);
    });

    it('accepts a route exactly at the horizon', () => {
      const atLimit = route({
        leg_minutes: 60,
        waypoints: Array.from({ length: 13 }, (_, i) => ({
          waypoint_id: `wp-${i + 1}`,
          lat: 33,
          lng: -112,
        })),
      });
      assert.equal(routeSpanHours(atLimit), 12);
      assert.doesNotThrow(() => new SimulatedTelemetryAdapter({ route: atLimit }));
    });

    it('rejects a one-point "route"', () => {
      assert.throws(
        () =>
          new SimulatedTelemetryAdapter({
            route: route({ waypoints: [{ waypoint_id: 'wp-1', lat: 1, lng: 2 }] }),
          }),
        /at least two waypoints/,
      );
    });
  });

  describe('canonical events', () => {
    it('every synthetic event is §3-valid', async () => {
      const events = await pipeline();
      assert.equal(events.length, 4);
      events.forEach((e, i) =>
        assertValid(`event[${i}] (${e.waypoint_id})`, validateThermalExposureEvent(e)),
      );
    });

    it('sets temp_c to temp_stats.max, per §8 decision 1', async () => {
      for (const e of await pipeline()) {
        assert.equal(e.temp_c, e.temp_stats.max);
      }
    });

    it('models a real AOI spread rather than a flat one', async () => {
      // If max == mean the "temp_c is Max" decision would be untestable.
      for (const e of await pipeline()) {
        assert.ok(e.temp_stats.max > e.temp_stats.mean, 'max should exceed mean');
        assert.ok(e.temp_stats.min < e.temp_stats.mean, 'min should be below mean');
        assert.ok(e.temp_stats.stddev > 0);
      }
    });

    it('stamps source as the §3 literal', async () => {
      for (const e of await pipeline()) assert.equal(e.source, 'fortyguard_api');
    });

    it('marks complete data quality when humidity is present', async () => {
      for (const e of await pipeline()) {
        assert.equal(e.data_quality, 'complete');
        assert.equal(typeof e.humidity_pct, 'number');
      }
    });

    it('is deterministic end to end', async () => {
      assert.deepEqual(await pipeline(), await pipeline());
    });

    it('preserves waypoint order in the event stream', async () => {
      const events = await pipeline();
      assert.deepEqual(
        events.map((e) => e.waypoint_id),
        ['wp-1', 'wp-2', 'wp-3', 'wp-4'],
      );
      const times = events.map((e) => Date.parse(e.timestamp));
      assert.deepEqual([...times].sort((a, b) => a - b), times, 'events must be time-ordered');
    });
  });

  describe('injected conditions', () => {
    it('a heat spike raises temp_c at exactly the named waypoint', async () => {
      const baseline = await pipeline();
      const spiked = await pipeline(route(), { spikes: { 'wp-3': 12 } });

      assert.equal(spiked[0]?.temp_c, baseline[0]?.temp_c);
      assert.equal(spiked[1]?.temp_c, baseline[1]?.temp_c);
      assert.ok(
        (spiked[2]?.temp_c ?? 0) > (baseline[2]?.temp_c ?? 0) + 11,
        'wp-3 should be ~12C hotter',
      );
      assert.equal(spiked[3]?.temp_c, baseline[3]?.temp_c);
    });

    it('an unavailable humidity produces a degraded, still-valid event', async () => {
      const events = await pipeline(route(), { humidityUnavailableAt: ['wp-2'] });
      const degraded = events.find((e) => e.waypoint_id === 'wp-2');

      assert.ok(degraded);
      assert.equal(degraded.humidity_pct, null);
      assert.equal(degraded.data_quality, 'degraded_no_humidity');
      assertValid('degraded event', validateThermalExposureEvent(degraded));

      // And it must never be zero-filled (§8 decision 3).
      assert.notEqual(degraded.humidity_pct, 0);

      for (const other of events.filter((e) => e.waypoint_id !== 'wp-2')) {
        assert.equal(other.data_quality, 'complete');
      }
    });
  });

  describe('deriveDataQuality', () => {
    it('maps null to degraded and a number to complete', () => {
      assert.equal(deriveDataQuality(null), 'degraded_no_humidity');
      assert.equal(deriveDataQuality(0), 'complete');
      assert.equal(deriveDataQuality(43.5), 'complete');
    });
  });

  describe('toThermalExposureEvent', () => {
    it('rejects nothing but produces a valid event from minimal input', () => {
      const e = toThermalExposureEvent(
        {
          route_id: 'r',
          waypoint_id: 'w',
          lat: 1,
          lng: 2,
          timestamp: '2026-08-17T14:00:00.000Z',
          forecasted_temp_c: 30,
          humidity_pct: 50,
          cargo_class: 'produce',
          driver_id: 'd',
        },
        { temp_stats: { mean: 30, max: 33, min: 28, stddev: 1.2 }, humidity_pct: 50 },
        { newId: sequentialIdFactory() },
      );
      assertValid('event', validateThermalExposureEvent(e));
      assert.equal(e.temp_c, 33);
    });
  });
});
