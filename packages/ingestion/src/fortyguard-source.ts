/**
 * Real FortyGuard-backed ThermalReadingSource (§8 decision 4, §9 Phase 1).
 *
 * This is the swap point `adapter.ts` was built for: same interface as
 * `SyntheticThermalReadingSource`, so nothing downstream of ingestion — the
 * event bus, both evaluators, the audit sink, the decision layer — changes
 * when this replaces the simulator. One waypoint still costs two chained
 * jobs: `/heatmap` for temperature, `/env_params` for humidity (which takes
 * the heatmap's temperature as an input).
 *
 * ── Why there's a pinned historical anchor date ──────────────────────────────
 * Verified live 2026-08-18: queries anywhere in the ±12h live/forecast window
 * returned zero tiles (`n_cells: 0`) across two cities and ten time offsets,
 * while FortyGuard's own documented example date (2024-07-15) returned real
 * data every time. That looks like a trial-key restriction on live/forecast
 * access, not a coverage gap — escalated to FortyGuard directly. Rather than
 * block Phase 1 on their answer, every query here substitutes a pinned
 * `anchorDate` for the waypoint's actual date while KEEPING its time-of-day —
 * so a route that runs 13:00 → 16:00 today queries FortyGuard for 13:00 →
 * 16:00 on the anchor date instead, preserving the diurnal temperature curve
 * a real route would see. The moment FortyGuard confirms live access works,
 * delete `anchorDate` (or make it optional) and this class queries the
 * waypoint's real timestamp directly — nothing else about it needs to change.
 */

import { firstEnvParamsValue, squareAoiAround } from '@threshold/fortyguard-client';
import type {
  EnvParamsResult,
  FortyGuardClient,
  HeatmapResult,
  JobResult,
  PollOptions,
} from '@threshold/fortyguard-client';
import type { WaypointTelemetry } from '@threshold/types';
import type { ThermalReading, ThermalReadingSource } from './adapter.js';

/**
 * The subset of `FortyGuardClient` this source actually calls. Real
 * `FortyGuardClient` instances satisfy this structurally — this exists so
 * tests can inject a fake without a network, the same reason risk-engine's
 * evaluators take a `RouteContextProvider` rather than a concrete registry.
 */
export interface FortyGuardJobRunner {
  runHeatmap(
    request: Parameters<FortyGuardClient['runHeatmap']>[0],
    options?: PollOptions,
  ): Promise<JobResult<HeatmapResult>>;
  runEnvParams(
    request: Parameters<FortyGuardClient['runEnvParams']>[0],
    options?: PollOptions,
  ): Promise<JobResult<EnvParamsResult>>;
}

export interface FortyGuardThermalReadingSourceOptions {
  client: FortyGuardJobRunner;
  /**
   * A date (YYYY-MM-DD) confirmed to return real FortyGuard tile data. See
   * the file header — this is a workaround for a live-data access issue, not
   * a permanent design choice.
   */
  anchorDate: string;
  /** AOI side length around each waypoint, km. Defaults to 2. */
  sideKm?: number;
  onWaypointProgress?: (info: {
    waypoint: WaypointTelemetry;
    stage: 'heatmap' | 'env_params';
    activityId: string;
    state: string;
  }) => void;
}

export class FortyGuardEmptyResultError extends Error {
  constructor(waypointId: string, start_date: string, start_time: string) {
    super(
      `FortyGuard returned no usable temperature for waypoint "${waypointId}" at ` +
        `${start_date} ${start_time} (0 tiles). If this is the live/forecast window, ` +
        `this is the known trial-key issue — pass a confirmed-working anchorDate instead.`,
    );
    this.name = 'FortyGuardEmptyResultError';
  }
}

export class FortyGuardThermalReadingSource implements ThermalReadingSource {
  private readonly client: FortyGuardJobRunner;
  private readonly anchorDate: string;
  private readonly sideKm: number;
  private readonly onWaypointProgress: FortyGuardThermalReadingSourceOptions['onWaypointProgress'];

  constructor(options: FortyGuardThermalReadingSourceOptions) {
    this.client = options.client;
    this.anchorDate = options.anchorDate;
    this.sideKm = options.sideKm ?? 2;
    this.onWaypointProgress = options.onWaypointProgress;
  }

  async read(waypoint: WaypointTelemetry): Promise<ThermalReading> {
    // Anchor date, waypoint's own time-of-day — see the file header.
    const start_time = new Date(waypoint.timestamp).toISOString().slice(11, 16);
    const start_date = this.anchorDate;
    const aoi = squareAoiAround(waypoint.lat, waypoint.lng, this.sideKm);

    const heatmapJob = await this.client.runHeatmap(
      {
        polygon_aoi: aoi,
        date_time: { start_date, start_time, filter_type: 1 },
        granularity: 100,
        analytic_type: 'tcm',
      },
      {
        onProgress: (p) =>
          this.onWaypointProgress?.({
            waypoint,
            stage: 'heatmap',
            activityId: p.activityId,
            state: p.state,
          }),
      },
    );

    const rawStats = heatmapJob.result?.stats_data?.temperature_stats;
    const max = rawStats?.maximum;
    if (typeof max !== 'number' || !rawStats) {
      throw new FortyGuardEmptyResultError(waypoint.waypoint_id, start_date, start_time);
    }
    // Narrowed and captured before the await below, so it survives the async
    // gap for TypeScript's control-flow analysis.
    const stats = rawStats;

    const envJob = await this.client.runEnvParams(
      {
        latitude: waypoint.lat,
        longitude: waypoint.lng,
        // /env_params enriches a temperature it's given — it does not source
        // one. The heatmap's Max is what feeds it here, same number that will
        // become temp_c downstream (§8 decision 1).
        temperature: max,
        date_time: { start_date, start_time, filter_type: 1 },
        // heat_index_celsius is deliberately not requested — §8 decision 2
        // drops FortyGuard's own formula from the pipeline entirely.
        analysis: ['relative_humidity_percent'],
      },
      {
        onProgress: (p) =>
          this.onWaypointProgress?.({
            waypoint,
            stage: 'env_params',
            activityId: p.activityId,
            state: p.state,
          }),
      },
    );

    const humidity = firstEnvParamsValue(
      envJob.result?.locations?.[0]?.parameters?.['relative_humidity_percent'],
    );

    return {
      temp_stats: {
        mean: stats.mean ?? max,
        max,
        min: stats.minimum ?? max,
        stddev: stats.standard_deviation ?? 0,
      },
      // Null carried through, never zero-filled (§8 decision 3).
      humidity_pct: humidity ?? null,
    };
  }
}
