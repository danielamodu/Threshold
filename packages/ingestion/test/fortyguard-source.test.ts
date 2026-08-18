import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type {
  EnvParamsResult,
  HeatmapResult,
  JobResult,
  PollOptions,
} from '@threshold/fortyguard-client';
import type { WaypointTelemetry } from '@threshold/types';
import {
  FortyGuardEmptyResultError,
  FortyGuardThermalReadingSource,
  type FortyGuardJobRunner,
} from '../src/fortyguard-source.js';

function waypoint(overrides: Partial<WaypointTelemetry> = {}): WaypointTelemetry {
  return {
    route_id: 'route-test',
    waypoint_id: 'wp-1',
    lat: 40.7115,
    lng: -74.01,
    timestamp: '2026-08-18T14:30:00.000Z',
    forecasted_temp_c: 30,
    humidity_pct: 50,
    cargo_class: 'pharma',
    driver_id: 'driver-42',
    ...overrides,
  };
}

function job<T>(result: T): JobResult<T> {
  return {
    activityId: 'test-activity',
    result,
    submitRaw: {},
    statusRaw: {},
    pollCount: 1,
    elapsedMs: 0,
  };
}

interface TempStatsOverrides {
  minimum?: number;
  maximum?: number;
  mean?: number;
  standard_deviation?: number;
  /** Pass `null` to simulate the empty-result shape (no temperature_stats key). */
  temperature_stats?: null;
}

function heatmapResult(overrides: TempStatsOverrides = {}): HeatmapResult {
  const { temperature_stats: omit, ...statOverrides } = overrides;
  return {
    map_data: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [] } }] },
    stats_data:
      omit === null
        ? { activity_id: 'test-activity', n_cells: 0 }
        : { temperature_stats: { minimum: 29, maximum: 33, mean: 31, standard_deviation: 1.2, ...statOverrides } },
  };
}

function envParamsResult(humidity: (number | null)[] | undefined): EnvParamsResult {
  return {
    metadata: {},
    locations: [
      {
        lat: 40.7115,
        lon: -74.01,
        parameters: humidity === undefined ? {} : { relative_humidity_percent: humidity },
      },
    ],
  };
}

/** A FortyGuardJobRunner that records calls and returns scripted results. */
class FakeRunner implements FortyGuardJobRunner {
  heatmapCalls: unknown[] = [];
  envParamsCalls: unknown[] = [];
  constructor(
    private heatmap: HeatmapResult,
    private envParams: EnvParamsResult,
  ) {}

  runHeatmap(request: unknown, options?: PollOptions): Promise<JobResult<HeatmapResult>> {
    this.heatmapCalls.push(request);
    options?.onProgress?.({ activityId: 'test-activity', attempt: 1, state: 'completed', elapsedMs: 0 });
    return Promise.resolve(job(this.heatmap));
  }

  runEnvParams(request: unknown, options?: PollOptions): Promise<JobResult<EnvParamsResult>> {
    this.envParamsCalls.push(request);
    options?.onProgress?.({ activityId: 'test-activity', attempt: 1, state: 'completed', elapsedMs: 0 });
    return Promise.resolve(job(this.envParams));
  }
}

describe('FortyGuardThermalReadingSource', () => {
  it('maps stats_data.temperature_stats onto ThermalReading.temp_stats', async () => {
    const runner = new FakeRunner(heatmapResult(), envParamsResult([55]));
    const source = new FortyGuardThermalReadingSource({ client: runner, anchorDate: '2024-07-15' });

    const reading = await source.read(waypoint());
    assert.deepEqual(reading.temp_stats, { mean: 31, max: 33, min: 29, stddev: 1.2 });
    assert.equal(reading.humidity_pct, 55);
  });

  it('substitutes the anchor date but keeps the waypoint time-of-day', async () => {
    const runner = new FakeRunner(heatmapResult(), envParamsResult([50]));
    const source = new FortyGuardThermalReadingSource({ client: runner, anchorDate: '2024-07-15' });

    await source.read(waypoint({ timestamp: '2026-08-18T16:45:00.000Z' }));

    const req = runner.heatmapCalls[0] as { date_time: { start_date: string; start_time: string } };
    assert.equal(req.date_time.start_date, '2024-07-15');
    assert.equal(req.date_time.start_time, '16:45');
  });

  it('feeds the heatmap Maximum into env_params as the temperature input', async () => {
    const runner = new FakeRunner(heatmapResult({ maximum: 41.7 }), envParamsResult([50]));
    const source = new FortyGuardThermalReadingSource({ client: runner, anchorDate: '2024-07-15' });

    await source.read(waypoint());

    const req = runner.envParamsCalls[0] as { temperature: number };
    assert.equal(req.temperature, 41.7);
  });

  it('does NOT request heat_index_celsius — §8 decision 2', async () => {
    const runner = new FakeRunner(heatmapResult(), envParamsResult([50]));
    const source = new FortyGuardThermalReadingSource({ client: runner, anchorDate: '2024-07-15' });

    await source.read(waypoint());

    const req = runner.envParamsCalls[0] as { analysis: string[] };
    assert.deepEqual(req.analysis, ['relative_humidity_percent']);
  });

  it('carries null humidity through, never zero-filled (§8 decision 3)', async () => {
    const runner = new FakeRunner(heatmapResult(), envParamsResult([null]));
    const source = new FortyGuardThermalReadingSource({ client: runner, anchorDate: '2024-07-15' });

    const reading = await source.read(waypoint());
    assert.equal(reading.humidity_pct, null);
    assert.notEqual(reading.humidity_pct, 0);
  });

  it('treats the -999 legacy sentinel as unavailable, not a measurement', async () => {
    const runner = new FakeRunner(heatmapResult(), envParamsResult([-999]));
    const source = new FortyGuardThermalReadingSource({ client: runner, anchorDate: '2024-07-15' });

    const reading = await source.read(waypoint());
    assert.equal(reading.humidity_pct, null);
  });

  it('throws FortyGuardEmptyResultError on a zero-tile result rather than fabricating a reading', async () => {
    // This is exactly the shape the live/forecast window returned.
    const runner = new FakeRunner(heatmapResult({ temperature_stats: null }), envParamsResult([50]));
    const source = new FortyGuardThermalReadingSource({ client: runner, anchorDate: '2024-07-15' });

    await assert.rejects(() => source.read(waypoint()), FortyGuardEmptyResultError);
    // And it must not have gone on to call env_params with garbage.
    assert.equal(runner.envParamsCalls.length, 0);
  });

  it('builds an AOI around the waypoint coordinate, not a fixed location', async () => {
    const runner = new FakeRunner(heatmapResult(), envParamsResult([50]));
    const source = new FortyGuardThermalReadingSource({ client: runner, anchorDate: '2024-07-15', sideKm: 3 });

    await source.read(waypoint({ lat: 25.7617, lng: -80.1918 }));

    const req = runner.heatmapCalls[0] as {
      polygon_aoi: { features: [{ geometry: { coordinates: number[][][] } }] };
    };
    const ring = req.polygon_aoi.features[0]?.geometry.coordinates[0];
    assert.ok(ring);
    const lngs = ring.map((p) => p[0]).filter((n): n is number => typeof n === 'number');
    const lats = ring.map((p) => p[1]).filter((n): n is number => typeof n === 'number');
    assert.ok(Math.min(...lngs) < -80.1918 && Math.max(...lngs) > -80.1918);
    assert.ok(Math.min(...lats) < 25.7617 && Math.max(...lats) > 25.7617);
  });

  it('reports progress for both the heatmap and env_params legs', async () => {
    const runner = new FakeRunner(heatmapResult(), envParamsResult([50]));
    const seen: string[] = [];
    const source = new FortyGuardThermalReadingSource({
      client: runner,
      anchorDate: '2024-07-15',
      onWaypointProgress: (info) => seen.push(info.stage),
    });

    await source.read(waypoint());
    assert.deepEqual(seen, ['heatmap', 'env_params']);
  });
});
