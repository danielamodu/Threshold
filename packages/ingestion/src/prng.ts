/**
 * Deterministic PRNG. §6 Phase 1 calls for "a deterministic script: waypoints,
 * cargo class, driver assignment, timestamps you control for the demo" — so the
 * simulator must never touch Math.random. Same seed, same route, every run, on
 * every machine. That is what makes the demo repeatable and the tests exact.
 *
 * mulberry32: small, fast, good enough for fixture data. Not cryptographic and
 * not used for anything that needs to be.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform float in [min, max). */
export function uniform(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

/** Round to `places` decimals, so fixture values read cleanly. */
export function round(value: number, places = 2): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}
