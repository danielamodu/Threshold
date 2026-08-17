/**
 * Per-cargo-class spoilage curves (§2 Cargo Risk Evaluator).
 *
 * ⚠⚠ PROPOSED DEFAULTS — NOT SIGNED OFF. Do not quote these in the pitch until
 * reviewed. They are reasoned, not measured.
 *
 * ── What the temperature in the event actually is ────────────────────────────
 * This matters more than the numbers, and an earlier version of this file got
 * it wrong in a way worth recording.
 *
 * FortyGuard returns OUTDOOR AMBIENT temperature for an area — it is a heatmap
 * of the street, not a probe inside the trailer. The first cut of these curves
 * compared that ambient reading against pharma's 2–8°C STORAGE range, which
 * scored a normal Phoenix afternoon as 145 °C·h against a threshold of 6: every
 * waypoint an instant total-loss breach. That is not conservatism, it is a
 * broken model, and it would have been the first thing a cold-chain judge pulled
 * on.
 *
 * Cargo temperature is not ambient temperature. A working reefer holds set point
 * against outside heat; the cargo is only at risk once ambient load exceeds what
 * the unit can reject. So `ceiling_c` here is an AMBIENT threshold: the outside
 * temperature above which this cargo class starts accruing real risk, because
 * the reefer's margin is gone. Tighter set point means less headroom, so pharma
 * has the lowest ambient ceiling despite being the coldest cargo.
 *
 * The honest limitation: without reefer telemetry (set point, door events, unit
 * health) this is a proxy for cargo temperature, not a measurement of it. Say
 * that plainly if asked rather than implying the trailer interior is known.
 * Reefer telemetry through the same TelemetryAdapter seam is the upgrade.
 *
 * ── The model ────────────────────────────────────────────────────────────────
 *     score += max(0, ambient_temp_c - ceiling_c) × hours_elapsed
 *
 * Degree-hours rather than time-above-threshold because how far above matters,
 * not just that it went above: two hours at 32°C and two hours at 50°C are not
 * the same event, and a time-only metric would score them identically.
 *
 * Deliberately NOT mean kinetic temperature. MKT is the pharma-industry standard
 * and more defensible for a real claim, but it is an Arrhenius-weighted
 * aggregate needing the full excursion series and a per-product activation
 * energy. Degree-hours is monotonic, explainable in one sentence, and auditable
 * from the event log alone. MKT is the upgrade if this goes near an insurer.
 */

import type { CargoClass, CargoRiskLevel } from '@threshold/types';

export interface SpoilageCurve {
  /**
   * AMBIENT temperature above which risk accrues, °C — not the cargo set point.
   * See the header; this distinction is the whole model.
   */
  ceiling_c: number;
  /** Degree-hours at which risk becomes 'elevated'. */
  elevated_degree_hours: number;
  /** Degree-hours at which risk becomes 'breach'. This is §3's `threshold`. */
  breach_degree_hours: number;
  /** Shown in the assessment explanation and the demo. */
  note: string;
}

/** ⚠ PROPOSED — see file header. */
export const SPOILAGE_CURVES: Record<CargoClass, SpoilageCurve> = {
  pharma: {
    ceiling_c: 30,
    elevated_degree_hours: 4,
    breach_degree_hours: 12,
    note: 'WHO/USP 2–8°C set point — least reefer headroom, so the lowest ambient ceiling and the tightest budget.',
  },
  produce: {
    ceiling_c: 34,
    elevated_degree_hours: 10,
    breach_degree_hours: 30,
    note: 'Chilled produce; excursions accelerate ripening and decay rather than writing off the load outright.',
  },
  general_reefer: {
    ceiling_c: 38,
    elevated_degree_hours: 20,
    breach_degree_hours: 50,
    note: 'Generic chilled freight; most reefer headroom and the widest tolerance of the three.',
  },
};

export function riskLevelFor(score: number, curve: SpoilageCurve): CargoRiskLevel {
  if (score >= curve.breach_degree_hours) return 'breach';
  if (score >= curve.elevated_degree_hours) return 'elevated';
  return 'nominal';
}

/** Degree-hours contributed by one ambient reading held for `hours`. */
export function degreeHours(ambient_temp_c: number, hours: number, curve: SpoilageCurve): number {
  if (hours <= 0) return 0;
  return Math.max(0, ambient_temp_c - curve.ceiling_c) * hours;
}
