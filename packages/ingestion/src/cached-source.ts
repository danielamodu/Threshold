import { readFile } from 'node:fs/promises';
import type { WaypointTelemetry } from '@threshold/types';
import type { ThermalReading, ThermalReadingSource } from './adapter.js';

export class CachedFortyGuardThermalReadingSource implements ThermalReadingSource {
  private readonly fixturePath: string;
  private cache: Record<string, ThermalReading> | null = null;

  constructor(fixturePath: string) {
    this.fixturePath = fixturePath;
  }

  async read(waypoint: WaypointTelemetry): Promise<ThermalReading> {
    if (!this.cache) {
      const data = await readFile(this.fixturePath, 'utf8');
      const parsed = JSON.parse(data);
      this.cache = parsed.readings;
    }

    const reading = this.cache?.[waypoint.waypoint_id];
    if (!reading) {
      throw new Error(`CachedFortyGuardThermalReadingSource: No reading found in fixture for waypoint ${waypoint.waypoint_id}`);
    }

    return reading;
  }
}
