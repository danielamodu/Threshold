/**
 * Pre-departure forecast scoring (§11 — forecast-driven risk profile).
 *
 * Concept: before a truck departs, query FortyGuard for the forecast temperature
 * at each waypoint for the planned departure window, run it through the existing
 * risk evaluators, and return where/when the route will breach — before it happens.
 *
 * Implementation: drives the existing ingestion + risk-engine stack with forecast
 * timestamps, without reinventing the data layer. Waypoints are sourced from the
 * demo route template (the only persisted coordinates in the system today — real
 * waypoint persistence is a future RouteSpec extension, so this is explicit).
 * The thermal numbers come from the cached 2024-07-15 fixture via
 * CachedFortyGuardThermalReadingSource — the same honest historical-replay
 * approach established in §8 decision 7. The response is labelled
 * `forecast_source: "historical_replay_2024-07-15"` so nothing is misrepresented
 * as a live forecast when it's a replay.
 *
 * No audit writes, no PDFs, no webhooks, no pipeline — this is a read-only
 * projection. The evaluators are instantiated fresh per request so cargo
 * accumulation never leaks across calls.
 */

import { resolve } from 'node:path';
import { CachedFortyGuardThermalReadingSource } from '@threshold/ingestion';
import { SimulatedTelemetryAdapter } from '@threshold/ingestion';
import { toThermalExposureEvent } from '@threshold/ingestion';
import type { RouteSpec } from '@threshold/ingestion';
import {
  CargoRiskEvaluator,
  HumanComplianceEvaluator,
  RouteRegistry,
} from '@threshold/risk-engine';
import { cargoSeverity, complianceSeverity } from '@threshold/decision-layer';
import type { CargoClass } from '@threshold/types';

/** Demo waypoints — the only persisted coordinates today. */
export const FORECAST_WAYPOINTS: RouteSpec['waypoints'] = [
  { waypoint_id: 'wp-1', lat: 33.4484, lng: -112.074 },
  { waypoint_id: 'wp-2', lat: 33.5, lng: -112.1 },
  { waypoint_id: 'wp-3', lat: 33.56, lng: -112.15 },
  { waypoint_id: 'wp-4', lat: 33.62, lng: -112.2 },
];

export const FORECAST_SOURCE = 'historical_replay_2024-07-15' as const;
export const FORECAST_LEG_MINUTES = 60;
const FIXTURE_PATH = resolve(import.meta.dirname, './fixtures/fortyguard-2024-07-15.json');

export interface ForecastWaypoint {
  waypoint_id: string;
  lat: number;
  lng: number;
  projected_time: string;
  projected_temp_c: number;
  temp_stats: { mean: number; max: number; min: number; stddev: number };
  humidity_pct: number | null;
  data_quality: 'complete' | 'degraded_no_humidity';
  cargo: {
    risk_level: 'nominal' | 'elevated' | 'breach';
    recommended_action: 'none' | 'reroute' | 'claim_draft';
    cumulative_exposure_score: number;
    threshold: number;
  };
  cargo_severity: 'low' | 'mid' | 'high';
  compliance: {
    action: 'none' | 'rest_break_scheduled' | 'work_limit_reduced';
    heat_index_c: number | null;
  };
  human_severity: 'low' | 'mid' | 'high';
}

export interface ForecastRouteRiskSummary {
  safe_to_depart: boolean;
  highest_risk_level: 'nominal' | 'elevated' | 'breach';
  first_breach_waypoint: string | null;
  first_breach_time: string | null;
  total_waypoints: number;
  breached_waypoints: number;
}

export interface ForecastResult {
  route_id: string;
  cargo_class: CargoClass;
  driver_id: string;
  departure_time: string;
  forecast_source: typeof FORECAST_SOURCE;
  waypoints: ForecastWaypoint[];
  route_risk_summary: ForecastRouteRiskSummary;
}

export interface ForecastOptions {
  route_id: string;
  cargo_class: CargoClass;
  driver_id: string;
  departure_time: string;
  waypoints?: RouteSpec['waypoints'];
  leg_minutes?: number;
}

/**
 * Run a forecast projection for a route. Pure function — no DB, no audit.
 * Uses the cached fixture via the same CachedFortyGuardThermalReadingSource
 * the demo pipeline uses, driven by forecast timestamps.
 */
export async function runForecast(options: ForecastOptions): Promise<ForecastResult> {
  const departure = new Date(options.departure_time);
  if (Number.isNaN(departure.getTime())) {
    throw new Error(`Invalid departure_time: ${options.departure_time}`);
  }

  const waypoints = options.waypoints ?? FORECAST_WAYPOINTS;
  const legMinutes = options.leg_minutes ?? FORECAST_LEG_MINUTES;

  const routeSpec: RouteSpec = {
    route_id: options.route_id,
    driver_id: options.driver_id,
    cargo_class: options.cargo_class,
    departs_at: departure.toISOString(),
    leg_minutes: legMinutes,
    waypoints,
  };

  const telemetry = new SimulatedTelemetryAdapter({ route: routeSpec, seed: 1234 });
  const readings = new CachedFortyGuardThermalReadingSource(FIXTURE_PATH);

  const registry = new RouteRegistry().register({
    route_id: routeSpec.route_id,
    driver_id: routeSpec.driver_id,
    cargo_class: routeSpec.cargo_class,
  });

  const complianceEvaluator = new HumanComplianceEvaluator({ routes: registry });
  const cargoEvaluator = new CargoRiskEvaluator({ routes: registry });

  const result: ForecastWaypoint[] = [];

  for (const waypointTelemetry of telemetry.stream()) {
    const reading = await readings.read(waypointTelemetry);
    const event = toThermalExposureEvent(waypointTelemetry, reading);

    const compliance = complianceEvaluator.evaluate(event);
    const cargoEval = cargoEvaluator.evaluate(event);

    result.push({
      waypoint_id: waypointTelemetry.waypoint_id,
      lat: waypointTelemetry.lat,
      lng: waypointTelemetry.lng,
      projected_time: waypointTelemetry.timestamp,
      projected_temp_c: event.temp_c,
      temp_stats: event.temp_stats,
      humidity_pct: event.humidity_pct,
      data_quality: event.data_quality,
      cargo: {
        risk_level: cargoEval.assessment.risk_level,
        recommended_action: cargoEval.assessment.recommended_action,
        cumulative_exposure_score: cargoEval.assessment.cumulative_exposure_score,
        threshold: cargoEval.assessment.threshold,
      },
      cargo_severity: cargoSeverity(cargoEval.assessment.risk_level),
      compliance: {
        action: compliance.record.action,
        heat_index_c: compliance.record.heat_index_c,
      },
      human_severity: complianceSeverity(compliance.record.action),
    });
  }

  // Summary derived from the per-waypoint cargo risk — breach is what blocks departure.
  const breached = result.filter((w) => w.cargo.risk_level === 'breach');
  const elevated = result.filter((w) => w.cargo.risk_level === 'elevated');
  const highest: ForecastRouteRiskSummary['highest_risk_level'] = breached.length
    ? 'breach'
    : elevated.length
      ? 'elevated'
      : 'nominal';

  const firstBreach = breached[0] ?? null;

  const summary: ForecastRouteRiskSummary = {
    safe_to_depart: breached.length === 0,
    highest_risk_level: highest,
    first_breach_waypoint: firstBreach?.waypoint_id ?? null,
    first_breach_time: firstBreach?.projected_time ?? null,
    total_waypoints: result.length,
    breached_waypoints: breached.length,
  };

  return {
    route_id: options.route_id,
    cargo_class: options.cargo_class,
    driver_id: options.driver_id,
    departure_time: departure.toISOString(),
    forecast_source: FORECAST_SOURCE,
    waypoints: result,
    route_risk_summary: summary,
  };
}
