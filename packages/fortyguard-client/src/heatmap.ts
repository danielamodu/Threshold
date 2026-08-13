import type { HeatmapResult } from './api-types.js';

export interface TemperatureSummary {
  min: number | undefined;
  max: number | undefined;
  mean: number | undefined;
  stdDev: number | undefined;
  /** '°C' for the default `tcm` analytic; 'hour' for the threshold analytics. */
  units: string;
  tileCount: number;
}

/**
 * Read the aggregate temperature figures out of a completed heatmap.
 *
 * Kept deliberately thin: this reports what the API returned. Turning tiles
 * into a `ThermalExposureEvent` is Phase 1 ingestion, not this package.
 */
export function summarizeTemperature(result: HeatmapResult): TemperatureSummary {
  const stats = result?.stats_data?.Temperature_stats ?? {};
  return {
    min: stats.Minimum,
    max: stats.Maximum,
    mean: stats.Mean,
    stdDev: stats.Standard_deviation,
    units: result?.stats_data?.units ?? '°C',
    tileCount: result?.map_data?.features?.length ?? 0,
  };
}
