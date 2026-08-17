/**
 * Normalisation into the canonical `ThermalExposureEvent` (§2, §3).
 *
 * This is the only place a raw feed becomes a canonical event. Everything
 * downstream subscribes to the event, never to a feed — §2 is explicit that the
 * pipeline must not fork, and a second normalisation site is how forks start.
 *
 * ── A note on `source` ───────────────────────────────────────────────────────
 * §3 locks `source` to the single literal 'fortyguard_api'. There is no value
 * for "synthetic", so a simulated event is stamped exactly like a real one.
 * That is contract-exact and it is what was asked for, but it does mean event
 * provenance is not visible on the event itself.
 *
 * The mitigation is that synthetic events must never reach the real audit log:
 * `PostgresAuditSink` refuses to read its connection string from the
 * environment, so writing fixtures into a permanent liability record takes
 * deliberate effort rather than a stray env var. If synthetic events ever DO
 * need persisting, §3 should gain a `source` value first — the log should not
 * assert a provenance that is untrue.
 */

import { randomUUID } from 'node:crypto';
import type { DataQuality, ThermalExposureEvent, WaypointTelemetry } from '@threshold/types';
import type { ThermalReading } from './adapter.js';

/** Injectable so tests can assert exact ids. Defaults to a real UUID v4. */
export type IdFactory = () => string;

export interface NormaliseOptions {
  newId?: IdFactory;
}

/**
 * §8 decision 3 — null humidity is a recorded state, never zero-filled.
 * Zero-filling would falsely deflate the heat index computed in Phase 2.
 */
export function deriveDataQuality(humidity_pct: number | null): DataQuality {
  return humidity_pct === null ? 'degraded_no_humidity' : 'complete';
}

export function toThermalExposureEvent(
  waypoint: WaypointTelemetry,
  reading: ThermalReading,
  options: NormaliseOptions = {},
): ThermalExposureEvent {
  const newId = options.newId ?? randomUUID;

  return {
    event_id: newId(),
    route_id: waypoint.route_id,
    waypoint_id: waypoint.waypoint_id,
    // §8 decision 1 — Max, not Mean. The conservative, defensible number if
    // this event is ever produced in an audit.
    temp_c: reading.temp_stats.max,
    temp_stats: reading.temp_stats,
    humidity_pct: reading.humidity_pct,
    data_quality: deriveDataQuality(reading.humidity_pct),
    timestamp: waypoint.timestamp,
    source: 'fortyguard_api',
  };
}

/** Counter-based id factory for deterministic fixtures. Not for production. */
export function sequentialIdFactory(prefix = '00000000-0000-4000-8000'): IdFactory {
  let n = 0;
  return () => `${prefix}-${String(++n).padStart(12, '0')}`;
}
