/**
 * Deterministic route/telemetry simulator (§6 Phase 1).
 *
 * Stands in for the real feed until FortyGuard access opens. It produces the
 * SAME event shape the real client will, so swapping the feed is a one-line
 * change at the wiring site and nothing downstream is touched.
 *
 * Everything is seeded. Same seed → byte-identical output, which is what makes
 * the demo repeatable and lets the tests assert exact numbers.
 */

import type { WaypointTelemetry } from '@threshold/types';
import {
  ForecastHorizonError,
  FORECAST_HORIZON_HOURS,
  type RouteSpec,
  type TelemetryAdapter,
  type ThermalReading,
  type ThermalReadingSource,
} from './adapter.js';
import { mulberry32, round, uniform } from './prng.js';

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;

/** Total wall-clock span of a route, in hours. */
export function routeSpanHours(route: RouteSpec): number {
  return ((route.waypoints.length - 1) * route.leg_minutes) / 60;
}

/** §8 — reject routes that outrun the forecast horizon rather than silently degrading. */
export function assertWithinForecastHorizon(route: RouteSpec): void {
  const span = routeSpanHours(route);
  if (span > FORECAST_HORIZON_HOURS) throw new ForecastHorizonError(span);
}

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

export interface SimulatedTelemetryOptions {
  route: RouteSpec;
  seed?: number;
  /** Ambient daily mean in °C, before the diurnal swing. */
  baselineTempC?: number;
  /** Peak-to-mean amplitude of the diurnal curve, °C. */
  diurnalAmplitudeC?: number;
  /** Baseline relative humidity, %. */
  baselineHumidityPct?: number;
}

/**
 * Baseline defaults are chosen so an UNSPIKED route sits in the low bands.
 *
 * This is a demo-quality decision, not a meteorological one. An earlier
 * calibration used a 31°C mean, which put every waypoint of a four-hour
 * afternoon route straight into OSHA extreme and cargo breach. Realistic for
 * Phoenix in August, and useless as a demo: the heat-spike injector had nothing
 * left to escalate, because the route was already maxed before you pressed it.
 *
 * A cooler baseline leaves headroom, so the injector produces a visible
 * nominal → breach transition — which §6 Phase 5 says is the entire interaction
 * model. Override for a realistic desert-summer run.
 */
export const DEFAULT_BASELINE_TEMP_C = 22;
export const DEFAULT_DIURNAL_AMPLITUDE_C = 5;
export const DEFAULT_BASELINE_HUMIDITY_PCT = 45;

export class SimulatedTelemetryAdapter implements TelemetryAdapter {
  readonly route: RouteSpec;
  private readonly seed: number;
  private readonly baselineTempC: number;
  private readonly diurnalAmplitudeC: number;
  private readonly baselineHumidityPct: number;

  constructor(options: SimulatedTelemetryOptions) {
    assertWithinForecastHorizon(options.route);
    if (options.route.waypoints.length < 2) {
      throw new Error('A route needs at least two waypoints.');
    }
    this.route = options.route;
    this.seed = options.seed ?? 1;
    this.baselineTempC = options.baselineTempC ?? DEFAULT_BASELINE_TEMP_C;
    this.diurnalAmplitudeC = options.diurnalAmplitudeC ?? DEFAULT_DIURNAL_AMPLITUDE_C;
    this.baselineHumidityPct = options.baselineHumidityPct ?? DEFAULT_BASELINE_HUMIDITY_PCT;
  }

  *stream(): Iterable<WaypointTelemetry> {
    const rng = mulberry32(this.seed);
    const departs = new Date(this.route.departs_at).getTime();

    for (let i = 0; i < this.route.waypoints.length; i++) {
      const wp = this.route.waypoints[i];
      if (!wp) continue;

      const at = new Date(departs + i * this.route.leg_minutes * MS_PER_MINUTE);

      yield {
        route_id: this.route.route_id,
        waypoint_id: wp.waypoint_id,
        lat: wp.lat,
        lng: wp.lng,
        timestamp: at.toISOString(),
        forecasted_temp_c: round(this.ambientAt(at) + uniform(rng, -0.4, 0.4)),
        humidity_pct: round(this.baselineHumidityPct + uniform(rng, -6, 6), 1),
        cargo_class: this.route.cargo_class,
        driver_id: this.route.driver_id,
      };
    }
  }

  /** Diurnal curve peaking at 15:00 local-ish (UTC here — demo data). */
  private ambientAt(at: Date): number {
    const hours = at.getUTCHours() + at.getUTCMinutes() / 60;
    const phase = ((hours - 15) / 24) * 2 * Math.PI;
    return this.baselineTempC + this.diurnalAmplitudeC * Math.cos(phase);
  }
}

// ---------------------------------------------------------------------------
// Thermal readings — the swap point
// ---------------------------------------------------------------------------

export interface SyntheticReadingOptions {
  seed?: number;
  /**
   * Waypoint ids that get a heat spike, and how many °C to add. This is the
   * lever behind the Phase 5 injector button, exposed early so Phase 2 has
   * breach events to test against.
   */
  spikes?: Record<string, number>;
  /**
   * Waypoint ids whose humidity comes back null, exercising the
   * `degraded_no_humidity` path (§8 decision 3). Explicit rather than random,
   * so tests stay exact.
   */
  humidityUnavailableAt?: readonly string[];
}

/**
 * Synthesises the thermal numbers a FortyGuard `/heatmap` + `/env_params` pair
 * would return for one waypoint.
 *
 * The AOI stat spread is modelled, not faked flat: a real heatmap covers an area
 * and reports Min/Max/Mean/StdDev across its tiles. `temp_c` downstream takes
 * Max (§8 decision 1), so the spread has to be real enough for that choice to
 * mean something — a flat distribution would make Max == Mean and quietly hide
 * whether the pipeline honours the decision.
 */
export class SyntheticThermalReadingSource implements ThermalReadingSource {
  private readonly seed: number;
  private readonly spikes: Record<string, number>;
  private readonly humidityUnavailableAt: ReadonlySet<string>;

  constructor(options: SyntheticReadingOptions = {}) {
    this.seed = options.seed ?? 7;
    this.spikes = options.spikes ?? {};
    this.humidityUnavailableAt = new Set(options.humidityUnavailableAt ?? []);
  }

  read(waypoint: WaypointTelemetry): Promise<ThermalReading> {
    // Seed per waypoint id so a reading depends only on which waypoint it is,
    // not on iteration order or on how many waypoints came before it.
    const rng = mulberry32(this.seed + hash(waypoint.waypoint_id));

    const spike = this.spikes[waypoint.waypoint_id] ?? 0;
    const mean = waypoint.forecasted_temp_c + spike;

    // Urban AOIs are skewed: a few hot tiles pull Max further from Mean than
    // Min sits below it.
    const spread = uniform(rng, 0.8, 2.2);
    const max = mean + spread * 1.9;
    const min = mean - spread * 1.2;

    const humidity = this.humidityUnavailableAt.has(waypoint.waypoint_id)
      ? null
      : round(waypoint.humidity_pct, 1);

    return Promise.resolve({
      temp_stats: {
        mean: round(mean),
        max: round(max),
        min: round(min),
        stddev: round(spread),
      },
      humidity_pct: humidity,
    });
  }
}

/** Stable string hash so per-waypoint seeding is reproducible across runs. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export { MS_PER_HOUR };
