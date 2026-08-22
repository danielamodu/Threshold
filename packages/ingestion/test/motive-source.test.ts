import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { ForecastHorizonError } from '../src/adapter.js';
import {
  MOTIVE_HAS_NO_WEATHER_DATA,
  MotiveEmptyHistoryError,
  MotiveTelemetryAdapter,
  type MotiveVehicleLocationFetcher,
} from '../src/motive-source.js';

function record(overrides: Partial<{ id: string; located_at: string; lat: number; lon: number }> = {}) {
  return {
    id: 'loc-1',
    located_at: '2026-08-17T13:00:00.000Z',
    lat: 33.4484,
    lon: -112.074,
    bearing: null,
    speed: 55,
    type: 'vehicle_moving',
    description: '',
    driver: {
      id: 999,
      first_name: 'Someone',
      last_name: 'Else',
      username: 'someone.else',
      email: null,
      driver_company_id: 'motive-driver-999',
      status: 'active',
      role: 'driver',
    },
    eld_device: null,
    ...overrides,
  };
}

/** A MotiveVehicleLocationFetcher that records the call and returns a scripted response. */
class FakeFetcher implements MotiveVehicleLocationFetcher {
  calls: unknown[] = [];
  constructor(private records: ReturnType<typeof record>[]) {}

  getVehicleLocationHistory(params: unknown) {
    this.calls.push(params);
    return Promise.resolve({
      vehicle_locations: this.records.map((vehicle_location) => ({ vehicle_location })),
    });
  }
}

const ROUTE = { route_id: 'route-real-1', cargo_class: 'pharma' as const, driver_id: 'driver-42' };

describe('MotiveTelemetryAdapter', () => {
  it('streams one WaypointTelemetry per real breadcrumb, in order', async () => {
    const fetcher = new FakeFetcher([
      record({ id: 'a', located_at: '2026-08-17T13:00:00.000Z', lat: 33.0, lon: -112.0 }),
      record({ id: 'b', located_at: '2026-08-17T14:00:00.000Z', lat: 33.1, lon: -112.1 }),
    ]);
    const adapter = await MotiveTelemetryAdapter.create({
      client: fetcher,
      route: ROUTE,
      vehicleId: 42,
      startDate: '2026-08-17',
      endDate: '2026-08-17',
    });

    const stream = [...adapter.stream()];
    assert.equal(stream.length, 2);
    assert.equal(stream[0]?.waypoint_id, 'motive-a');
    assert.equal(stream[0]?.lat, 33.0);
    assert.equal(stream[0]?.lng, -112.0);
    assert.equal(stream[0]?.timestamp, '2026-08-17T13:00:00.000Z');
    assert.equal(stream[1]?.waypoint_id, 'motive-b');
  });

  it("carries THIS org's own route_id/cargo_class/driver_id, never Motive's embedded driver", async () => {
    const fetcher = new FakeFetcher([record({ id: 'a' }), record({ id: 'b' })]);
    const adapter = await MotiveTelemetryAdapter.create({
      client: fetcher,
      route: ROUTE,
      vehicleId: 42,
      startDate: '2026-08-17',
      endDate: '2026-08-17',
    });

    for (const wp of adapter.stream()) {
      assert.equal(wp.route_id, 'route-real-1');
      assert.equal(wp.cargo_class, 'pharma');
      // Not 'motive-driver-999' — this org's own dispatch assignment wins.
      assert.equal(wp.driver_id, 'driver-42');
    }
  });

  it('fills the dead forecasted_temp_c/humidity_pct fields with the named sentinel, never invented weather', async () => {
    const fetcher = new FakeFetcher([record({ id: 'a' }), record({ id: 'b' })]);
    const adapter = await MotiveTelemetryAdapter.create({
      client: fetcher,
      route: ROUTE,
      vehicleId: 42,
      startDate: '2026-08-17',
      endDate: '2026-08-17',
    });

    for (const wp of adapter.stream()) {
      assert.equal(wp.forecasted_temp_c, MOTIVE_HAS_NO_WEATHER_DATA);
      assert.equal(wp.humidity_pct, MOTIVE_HAS_NO_WEATHER_DATA);
    }
  });

  it('throws MotiveEmptyHistoryError on fewer than 2 records, rather than a 1-point "route"', async () => {
    const fetcher = new FakeFetcher([record({ id: 'a' })]);
    await assert.rejects(
      () =>
        MotiveTelemetryAdapter.create({
          client: fetcher,
          route: ROUTE,
          vehicleId: 42,
          startDate: '2026-08-17',
          endDate: '2026-08-17',
        }),
      MotiveEmptyHistoryError,
    );
  });

  it('throws ForecastHorizonError when the REAL span exceeds 12h, computed from actual timestamps', async () => {
    const fetcher = new FakeFetcher([
      record({ id: 'a', located_at: '2026-08-17T00:00:00.000Z' }),
      record({ id: 'b', located_at: '2026-08-17T13:00:00.000Z' }), // 13h > 12h horizon
    ]);
    await assert.rejects(
      () =>
        MotiveTelemetryAdapter.create({
          client: fetcher,
          route: ROUTE,
          vehicleId: 42,
          startDate: '2026-08-17',
          endDate: '2026-08-17',
        }),
      ForecastHorizonError,
    );
  });

  it("derives route.waypoints/departs_at from the real breadcrumbs, not a predetermined list", async () => {
    const fetcher = new FakeFetcher([
      record({ id: 'a', located_at: '2026-08-17T13:00:00.000Z', lat: 33.0, lon: -112.0 }),
      record({ id: 'b', located_at: '2026-08-17T14:30:00.000Z', lat: 33.2, lon: -112.2 }),
    ]);
    const adapter = await MotiveTelemetryAdapter.create({
      client: fetcher,
      route: ROUTE,
      vehicleId: 42,
      startDate: '2026-08-17',
      endDate: '2026-08-17',
    });

    assert.equal(adapter.route.departs_at, '2026-08-17T13:00:00.000Z');
    assert.equal(adapter.route.waypoints.length, 2);
    assert.equal(adapter.route.waypoints[0]?.waypoint_id, 'motive-a');
    assert.equal(adapter.route.leg_minutes, 90); // 1.5h span over 1 gap
  });

  it('passes vehicleId/startDate/endDate through to the client, defaulting updatedAfter to startDate', async () => {
    const fetcher = new FakeFetcher([record({ id: 'a' }), record({ id: 'b' })]);
    await MotiveTelemetryAdapter.create({
      client: fetcher,
      route: ROUTE,
      vehicleId: 4242,
      startDate: '2026-08-01',
      endDate: '2026-08-02',
    });

    assert.deepEqual(fetcher.calls[0], {
      vehicleId: 4242,
      startDate: '2026-08-01',
      endDate: '2026-08-02',
      updatedAfter: undefined,
    });
  });
});
