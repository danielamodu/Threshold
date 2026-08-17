/**
 * Drives a telemetry adapter and a reading source into an ordered stream of
 * canonical events.
 *
 * Deliberately not coupled to the bus or to the audit sink — the caller wires
 * those. Keeping this a plain async generator is what lets the same code path
 * serve the simulator today and the FortyGuard client tomorrow.
 */

import type { ThermalExposureEvent } from '@threshold/types';
import type { TelemetryAdapter, ThermalReadingSource } from './adapter.js';
import { toThermalExposureEvent, type NormaliseOptions } from './normalize.js';

export async function* ingest(
  telemetry: TelemetryAdapter,
  readings: ThermalReadingSource,
  options: NormaliseOptions = {},
): AsyncGenerator<ThermalExposureEvent> {
  for (const waypoint of telemetry.stream()) {
    const reading = await readings.read(waypoint);
    yield toThermalExposureEvent(waypoint, reading, options);
  }
}

/** Convenience for tests and short runs. */
export async function collect(
  telemetry: TelemetryAdapter,
  readings: ThermalReadingSource,
  options: NormaliseOptions = {},
): Promise<ThermalExposureEvent[]> {
  const out: ThermalExposureEvent[] = [];
  for await (const event of ingest(telemetry, readings, options)) out.push(event);
  return out;
}
