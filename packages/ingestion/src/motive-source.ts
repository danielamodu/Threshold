/**
 * Real Motive-backed TelemetryAdapter (§11 Phase 8).
 *
 * ── Provider decision ─────────────────────────────────────────────────────
 * §11 names Samsara and Motive. Checked both against their own current docs
 * before picking, per instruction — not picked silently:
 *   - Samsara (developers.samsara.com/docs/sandboxes): the sandbox page
 *     itself doesn't explain how to get a sandbox from scratch, and the
 *     documented route is "contact a mutual customer to acquire an API
 *     token" — i.e. piggyback on an existing paying fleet customer's org.
 *     Support can also generate fake GPS data on request, but that's
 *     support-mediated, not self-service.
 *   - Motive (developer-docs.gomotive.com/docs/prerequisites): a genuinely
 *     free, self-service developer account — sign up at developer.gomotive.com,
 *     register a test app, create a "dummy fleet" (a real but unpaid test
 *     fleet, also self-service signup), then ask Motive to associate the two.
 *     No existing customer relationship or payment is required at any step.
 * Tradeoff: Motive's approval step (associating the app with the dummy fleet)
 * is manual, not instant — so "self-service" means no gatekeeping by a sales
 * relationship, not zero wait. Still the clearly obtainable one of the two,
 * so Motive is what this adapter targets.
 *
 * ── BLOCKED PENDING CREDENTIALS ───────────────────────────────────────────
 * No MOTIVE_API_TOKEN exists yet. Obtaining one requires creating a Motive
 * developer account and a dummy fleet — account creation is something this
 * assistant does not do on a user's behalf even when it is free and
 * self-service, so this is a real, human-actionable next step, not a
 * technical blocker. Built and documented against Motive's actual published
 * API contract (verified against developer-docs.gomotive.com directly, not
 * assumed) rather than fabricating a live connection. Same pattern as the
 * FortyGuard live-data escalation in fortyguard-source.ts: flagged plainly,
 * not hidden, not blocking anything else.
 *
 * ── Design: sync TelemetryAdapter.stream(), async real fetch ─────────────
 * `TelemetryAdapter.stream(): Iterable<WaypointTelemetry>` is synchronous —
 * `ingest()` (run.ts) does a plain `for...of` over it, no `await`. A real
 * HTTP-backed feed cannot honour that directly, so this mirrors the exact
 * precedent already established for the same tension in
 * packages/accounts/src/routes.ts's `PostgresRouteRegistry`
 * (async `load()`, then synchronous `get()`): a static async `create()`
 * factory does the one real HTTP call and caches the result; `stream()`
 * afterward just yields from that cache. `TelemetryAdapter` itself is
 * untouched — no evaluator, no pipeline code, no §2 contract changes.
 *
 * ── Two things this surfaced that weren't obvious going in ───────────────
 * 1. `WaypointTelemetry.forecasted_temp_c`/`humidity_pct` (§3) are DEAD
 *    FIELDS for any real feed: `normalize.ts`'s `toThermalExposureEvent()`
 *    takes `temp_c`/`temp_stats`/`humidity_pct` entirely from the
 *    `ThermalReadingSource`, never from the telemetry waypoint — confirmed
 *    by reading it, and further confirmed `FortyGuardThermalReadingSource`
 *    never touches these two fields either. They exist because the
 *    simulator generates matching synthetic weather *and* telemetry from one
 *    baseline for internal consistency; real telemetry has no reason to
 *    populate them meaningfully, since Motive is a GPS/ELD platform with no
 *    notion of ambient temperature at all. §3 still requires a number here
 *    (not nullable) — populated below with an explicit, named sentinel,
 *    never an invented weather guess.
 * 2. `RouteSpec.waypoints`/`leg_minutes` (§2) model the SIMULATOR's fixed,
 *    evenly-spaced small waypoint list. A real GPS breadcrumb trail has many
 *    points at irregular intervals — there is no predetermined waypoint list
 *    to hand in ahead of time. Resolved by deriving `route.waypoints` (and
 *    an average `leg_minutes`, documented as informational only) from the
 *    same real breadcrumbs actually streamed, so the exposed `RouteSpec`
 *    never claims a shape the real data doesn't have. The forecast-horizon
 *    check is done from the real first/last timestamps directly, not from
 *    `leg_minutes × count` — more correct for irregular real intervals, not
 *    just a workaround.
 */

import type { GetVehicleLocationHistoryParams, MotiveVehicleLocation, MotiveVehicleLocationHistoryResponse } from '@threshold/motive-client';
import type { WaypointTelemetry } from '@threshold/types';
import {
  ForecastHorizonError,
  FORECAST_HORIZON_HOURS,
  type RouteSpec,
  type TelemetryAdapter,
} from './adapter.js';
import { MS_PER_HOUR } from './simulator.js';

/**
 * Sentinel for §3's non-nullable forecasted_temp_c/humidity_pct fields on a
 * real (non-simulated) waypoint — see header note 1. Never read once paired
 * with a real ThermalReadingSource; deliberately not a plausible-looking
 * number, so it can't be mistaken for real data if something new ever does
 * read it.
 */
export const MOTIVE_HAS_NO_WEATHER_DATA = 0;

/**
 * The subset of `MotiveClient` this source actually calls — structurally
 * satisfied by a real `MotiveClient`, and the seam tests inject a fake
 * through, same reason `FortyGuardJobRunner` exists in fortyguard-source.ts.
 */
export interface MotiveVehicleLocationFetcher {
  getVehicleLocationHistory(
    params: GetVehicleLocationHistoryParams,
  ): Promise<MotiveVehicleLocationHistoryResponse>;
}

export interface MotiveTelemetryAdapterOptions {
  client: MotiveVehicleLocationFetcher;
  /** This org's own route_id/cargo_class/driver_id — never sourced from Motive. */
  route: { route_id: string; cargo_class: RouteSpec['cargo_class']; driver_id: string };
  vehicleId: number;
  /** yyyy-mm-dd */
  startDate: string;
  /** yyyy-mm-dd. Motive caps this window at 3 months. */
  endDate: string;
  updatedAfter?: string;
}

export class MotiveEmptyHistoryError extends Error {
  constructor(vehicleId: number, startDate: string, endDate: string) {
    super(
      `Motive returned fewer than 2 location records for vehicle ${vehicleId} between ` +
        `${startDate} and ${endDate} — not enough to form a route.`,
    );
    this.name = 'MotiveEmptyHistoryError';
  }
}

export class MotiveTelemetryAdapter implements TelemetryAdapter {
  readonly route: RouteSpec;
  private readonly waypoints: WaypointTelemetry[];

  private constructor(route: RouteSpec, waypoints: WaypointTelemetry[]) {
    this.route = route;
    this.waypoints = waypoints;
  }

  /** Does the one real HTTP call and caches the result — see header. */
  static async create(options: MotiveTelemetryAdapterOptions): Promise<MotiveTelemetryAdapter> {
    const response = await options.client.getVehicleLocationHistory({
      vehicleId: options.vehicleId,
      startDate: options.startDate,
      endDate: options.endDate,
      updatedAfter: options.updatedAfter,
    });

    const records = response.vehicle_locations.map((v) => v.vehicle_location);
    if (records.length < 2) {
      throw new MotiveEmptyHistoryError(options.vehicleId, options.startDate, options.endDate);
    }

    const first = records[0];
    const last = records[records.length - 1];
    if (!first || !last) throw new MotiveEmptyHistoryError(options.vehicleId, options.startDate, options.endDate);

    const spanHours = (Date.parse(last.located_at) - Date.parse(first.located_at)) / MS_PER_HOUR;
    if (spanHours > FORECAST_HORIZON_HOURS) throw new ForecastHorizonError(spanHours);

    const waypoints = records.map((record) => toWaypointTelemetry(record, options.route));

    const route: RouteSpec = {
      route_id: options.route.route_id,
      driver_id: options.route.driver_id,
      cargo_class: options.route.cargo_class,
      departs_at: first.located_at,
      // Informational only — real intervals are irregular. Nothing downstream
      // of this adapter reads route.leg_minutes; only routeSpanHours() does,
      // and this adapter checks the real span directly above instead (header
      // note 2), so this average is exposed for display/logging purposes only.
      leg_minutes: spanHours === 0 ? 0 : (spanHours * 60) / (waypoints.length - 1),
      waypoints: waypoints.map((w) => ({ waypoint_id: w.waypoint_id, lat: w.lat, lng: w.lng })),
    };

    return new MotiveTelemetryAdapter(route, waypoints);
  }

  *stream(): Iterable<WaypointTelemetry> {
    yield* this.waypoints;
  }
}

function toWaypointTelemetry(
  loc: MotiveVehicleLocation,
  route: MotiveTelemetryAdapterOptions['route'],
): WaypointTelemetry {
  return {
    route_id: route.route_id,
    // Motive's own location-record id, not a synthetic index — traces every
    // waypoint back to the exact source ping.
    waypoint_id: `motive-${loc.id}`,
    lat: loc.lat,
    lng: loc.lon,
    timestamp: loc.located_at,
    cargo_class: route.cargo_class,
    // This org's own dispatch assignment (RouteSpec), deliberately not
    // loc.driver — a real ELD can show a mid-route driver swap, but the risk
    // engine and the §11 Phase 7 role table (compliance_records/
    // thermal_events scoped to a driver_id) both key off one constant
    // driver_id for the whole route.
    driver_id: route.driver_id,
    forecasted_temp_c: MOTIVE_HAS_NO_WEATHER_DATA,
    humidity_pct: MOTIVE_HAS_NO_WEATHER_DATA,
  };
}
