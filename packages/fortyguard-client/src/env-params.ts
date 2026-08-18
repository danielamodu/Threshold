import type { EnvParamsResult } from './api-types.js';

/**
 * First real value out of a time-aligned `/env_params` series.
 *
 * `null` means "unavailable upstream" (documented); `-999` is called out in
 * the docs as a legacy sentinel for the same meaning on older stored
 * responses. Neither is a measurement, and neither may become 0 — a caller
 * that treated a sentinel as zero would silently understate risk.
 */
export function firstEnvParamsValue(series: (number | null)[] | undefined): number | undefined {
  if (!series) return undefined;
  for (const v of series) {
    if (v !== null && v !== undefined && v !== -999) return v;
  }
  return undefined;
}

/** Convenience: pull one named parameter's first real value off a completed result. */
export function firstParameterValue(
  result: EnvParamsResult | undefined,
  name: string,
): number | undefined {
  const series = result?.locations?.[0]?.parameters?.[name];
  return firstEnvParamsValue(series);
}
