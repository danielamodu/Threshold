/**
 * NWS heat index (§2 Human Compliance Evaluator).
 *
 * §8 decision 2 is explicit that FortyGuard's own `heat_index_celsius` is NOT
 * used, and that this is computed here instead: "more defensible under OSHA
 * scrutiny than relying on a third party's undocumented formula." So this file
 * implements the published NWS algorithm in full, adjustments included, rather
 * than the Rothfusz regression alone — which is what most implementations get
 * wrong, and which would be visibly wrong at the dry and humid extremes.
 *
 * Reference: NWS Weather Prediction Center, "The Heat Index Equation".
 * The algorithm is defined in °F, so conversion happens at the boundary.
 */

export const cToF = (c: number): number => (c * 9) / 5 + 32;
export const fToC = (f: number): number => ((f - 32) * 5) / 9;

/**
 * Heat index in °F from dry-bulb °F and relative humidity %.
 *
 * The NWS procedure has three parts, and skipping any of them changes results:
 *
 *  1. Try the simple (Steadman) form first. If the average of it and the dry
 *     bulb is below 80°F, that answer stands — Rothfusz is not valid down there
 *     and using it anyway produces nonsense at low temperatures.
 *  2. Otherwise apply the Rothfusz regression.
 *  3. Then two corrections: a subtraction in hot/dry conditions, an addition in
 *     warm/humid ones. Both are real and both change the OSHA risk band near
 *     the edges.
 */
export function heatIndexF(tempF: number, humidityPct: number): number {
  const T = tempF;
  const RH = humidityPct;

  // 1. Simple form.
  const simple = 0.5 * (T + 61.0 + (T - 68.0) * 1.2 + RH * 0.094);
  if ((simple + T) / 2 < 80) return simple;

  // 2. Rothfusz regression.
  let hi =
    -42.379 +
    2.04901523 * T +
    10.14333127 * RH -
    0.22475541 * T * RH -
    0.00683783 * T * T -
    0.05481717 * RH * RH +
    0.00122874 * T * T * RH +
    0.00085282 * T * RH * RH -
    0.00000199 * T * T * RH * RH;

  // 3. Corrections.
  if (RH < 13 && T >= 80 && T <= 112) {
    hi -= ((13 - RH) / 4) * Math.sqrt((17 - Math.abs(T - 95)) / 17);
  } else if (RH > 85 && T >= 80 && T <= 87) {
    hi += ((RH - 85) / 10) * ((87 - T) / 5);
  }

  return hi;
}

/**
 * Upper bound of the Rothfusz regression's fitted range, °F.
 *
 * The NWS chart tops out near here and the regression was fitted against it.
 * Push it to 140°F and it returns roughly 266°F — arithmetically real, and
 * physically meaningless. An early build of this file printed a 129.9°C heat
 * index for a 60°C reading, which is the kind of number that ends a demo.
 */
export const NWS_MAX_VALID_F = 112;

export interface HeatIndexResult {
  /** °C. Clamped to the formula's validated domain when `extrapolated`. */
  value: number;
  /**
   * True when the input sat outside the range the regression was fitted for, so
   * the reported figure is a floor rather than a measurement. Callers should say
   * so rather than presenting it as precise.
   */
  extrapolated: boolean;
}

/**
 * Heat index in °C with an explicit honesty flag.
 *
 * Beyond the validated domain the dry bulb alone already clears every OSHA
 * band, so nothing is lost by clamping — and a clamped value with a caveat is
 * defensible under scrutiny in a way an extrapolated one is not.
 */
export function heatIndexWithDomain(tempC: number, humidityPct: number): HeatIndexResult {
  assertInputs(tempC, humidityPct);

  const tempF = cToF(tempC);
  if (tempF > NWS_MAX_VALID_F) {
    return { value: fToC(heatIndexF(NWS_MAX_VALID_F, humidityPct)), extrapolated: true };
  }
  return { value: fToC(heatIndexF(tempF, humidityPct)), extrapolated: false };
}

/** Heat index in °C from dry-bulb °C and relative humidity %. */
export function heatIndexC(tempC: number, humidityPct: number): number {
  return heatIndexWithDomain(tempC, humidityPct).value;
}

function assertInputs(tempC: number, humidityPct: number): void {
  if (!Number.isFinite(tempC) || !Number.isFinite(humidityPct)) {
    throw new Error('heatIndexC requires finite temperature and humidity.');
  }
  if (humidityPct < 0 || humidityPct > 100) {
    throw new Error(`Relative humidity must be 0–100%, got ${humidityPct}.`);
  }
}
