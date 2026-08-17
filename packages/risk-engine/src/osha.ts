/**
 * OSHA/NIOSH heat thresholds and work/rest scheduling.
 *
 * ⚠ PROPOSED DEFAULTS — pending sign-off. The band boundaries are taken from
 * the OSHA-NIOSH Heat Safety Tool's published risk levels and are not invented.
 * The work/rest ratios ARE a simplification and should be reviewed before any
 * claim is made about them in the pitch: real NIOSH/ACGIH work-rest tables vary
 * by workload (light/moderate/heavy) and by whether the worker is acclimatised.
 * This models one workload band. It is defensible as a demo default and should
 * not be described as "the OSHA schedule".
 */

import type { ComplianceScheduleType } from '@threshold/types';

export type HeatRiskBand = 'caution' | 'moderate' | 'high' | 'extreme';

/**
 * OSHA-NIOSH Heat Safety Tool risk levels, converted from °F.
 *   < 91°F caution · 91–103 moderate · 103–115 high · ≥115 extreme
 */
export const HEAT_INDEX_BANDS_C = {
  moderate: 32.8, // 91°F
  high: 39.4, // 103°F
  extreme: 46.1, // 115°F
} as const;

/**
 * Fallback bands on DRY-BULB temperature, used only when humidity is
 * unavailable (§8 decision 3) and the NWS formula therefore cannot run.
 *
 * ⚠ PROPOSED — these are deliberately CONSERVATIVE, i.e. they trigger at lower
 * temperatures than the heat-index bands. That is the whole point: at typical
 * summer humidity the heat index sits well ABOVE dry bulb, so treating a bare
 * dry-bulb reading as if it were a heat index would systematically understate
 * risk. Under-protecting a driver because a humidity sensor returned null is
 * exactly the failure this product exists to prevent.
 */
export const DRY_BULB_FALLBACK_BANDS_C = {
  moderate: 27,
  high: 32,
  extreme: 37,
} as const;

export function bandFor(value: number, bands: { moderate: number; high: number; extreme: number }): HeatRiskBand {
  if (value >= bands.extreme) return 'extreme';
  if (value >= bands.high) return 'high';
  if (value >= bands.moderate) return 'moderate';
  return 'caution';
}

/** Minutes of rest (or reduced load) per working hour, by band. */
export interface WorkRestRule {
  restMinutesPerHour: number;
  scheduleType: ComplianceScheduleType;
}

/** ⚠ PROPOSED DEFAULTS — see the file header. */
export const WORK_REST_BY_BAND: Record<HeatRiskBand, WorkRestRule> = {
  caution: { restMinutesPerHour: 0, scheduleType: 'rest' },
  moderate: { restMinutesPerHour: 15, scheduleType: 'rest' },
  high: { restMinutesPerHour: 30, scheduleType: 'rest' },
  // At extreme, the intervention is a reduced workload rather than more breaks
  // inside an unchanged shift — which is why §3 has a distinct 'reduced_load'.
  extreme: { restMinutesPerHour: 45, scheduleType: 'reduced_load' },
};
