/**
 * Ingestion Layer seams (§2).
 *
 * Two interfaces, because the layer has two independent sources that happen to
 * meet at the event boundary:
 *
 *   TelemetryAdapter      — route, cargo class, driver assignment, timestamps.
 *                           Simulated for the demo, but shaped so a real TMS
 *                           (Samsara/Motive) drops in without a rewrite. §2
 *                           calls this adapter "the 'not siloed' argument".
 *
 *   ThermalReadingSource  — the thermal numbers for one waypoint. This is THE
 *                           swap point for tomorrow's real key: synthetic today,
 *                           FortyGuard (two chained jobs per §8 decision 4)
 *                           once access opens. Nothing downstream changes,
 *                           because both produce the same shape.
 */

import type { CargoClass, TempStats, WaypointTelemetry } from '@threshold/types';

/** One route's assignment metadata. */
export interface RouteSpec {
  route_id: string;
  driver_id: string;
  cargo_class: CargoClass;
  /** Ordered waypoints. At least two — a route with one point is not a route. */
  waypoints: { waypoint_id: string; lat: number; lng: number }[];
  /** ISO8601 departure. Must sit inside the 12h forecast horizon (§8). */
  departs_at: string;
  /** Minutes between consecutive waypoints. */
  leg_minutes: number;
}

/** GPS/ELD-style feed. A real TMS adapter implements this and nothing else. */
export interface TelemetryAdapter {
  readonly route: RouteSpec;
  /** Waypoints in travel order. */
  stream(): Iterable<WaypointTelemetry>;
}

/**
 * The thermal numbers for one waypoint, in the shape §3 needs.
 *
 * `humidity_pct` is nullable because the upstream genuinely returns null
 * (§8 decision 3). Null is carried through and recorded, never zero-filled —
 * zero-filling would falsely deflate the heat index computed downstream.
 */
export interface ThermalReading {
  temp_stats: TempStats;
  humidity_pct: number | null;
}

export interface ThermalReadingSource {
  read(waypoint: WaypointTelemetry): Promise<ThermalReading>;
}

/** §8: the forecast horizon is 12 hours. Beyond it the forecast runs dry. */
export const FORECAST_HORIZON_HOURS = 12;

export class ForecastHorizonError extends Error {
  constructor(spanHours: number) {
    super(
      `Route spans ${spanHours.toFixed(1)}h, beyond FortyGuard's ${FORECAST_HORIZON_HOURS}h ` +
        `forecast horizon (§8). Keep the simulated route inside the window, or the ` +
        `forecast portion of the pipeline runs dry.`,
    );
    this.name = 'ForecastHorizonError';
  }
}
