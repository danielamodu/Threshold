import type { ThermalExposureEvent } from '@threshold/types';
import { RouteRegistry } from '../src/route-context.js';

let counter = 0;
export function uuid(): string {
  return `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
}
export function resetUuids(): void {
  counter = 0;
}

/**
 * Builds a §3-valid event. `temp_c` is always set to `temp_stats.max`, because
 * §8 decision 1 says it IS the max — a fixture that broke that would test a
 * pipeline we do not have.
 */
export function event(overrides: {
  temp_c: number;
  humidity_pct?: number | null;
  route_id?: string;
  waypoint_id?: string;
  timestamp?: string;
  event_id?: string;
}): ThermalExposureEvent {
  const temp_c = overrides.temp_c;
  const humidity_pct = overrides.humidity_pct === undefined ? 40 : overrides.humidity_pct;

  return {
    event_id: overrides.event_id ?? uuid(),
    route_id: overrides.route_id ?? 'route-test',
    waypoint_id: overrides.waypoint_id ?? 'wp-1',
    temp_c,
    temp_stats: {
      mean: round2(temp_c - 2.5),
      max: temp_c,
      min: round2(temp_c - 4),
      stddev: 1.4,
    },
    humidity_pct,
    data_quality: humidity_pct === null ? 'degraded_no_humidity' : 'complete',
    timestamp: overrides.timestamp ?? '2026-08-17T14:00:00.000Z',
    source: 'fortyguard_api',
  };
}

export function registry(
  cargo_class: 'pharma' | 'produce' | 'general_reefer' = 'pharma',
  route_id = 'route-test',
): RouteRegistry {
  return new RouteRegistry().register({
    route_id,
    driver_id: 'driver-42',
    cargo_class,
  });
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
