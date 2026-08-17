import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { cToF, fToC, heatIndexC, heatIndexF, heatIndexWithDomain, NWS_MAX_VALID_F } from '../src/heat-index.js';

/**
 * Checked against the NWS published heat index chart. These are the values a
 * safety officer would look up, so getting them wrong is not an academic
 * failure — it moves a driver into the wrong OSHA band.
 */
describe('NWS heat index', () => {
  it('converts between C and F', () => {
    assert.equal(cToF(0), 32);
    assert.equal(cToF(100), 212);
    assert.ok(Math.abs(fToC(98.6) - 37) < 1e-9);
  });

  it('matches the NWS chart at 90F / 60% RH (~100F)', () => {
    const hi = heatIndexF(90, 60);
    assert.ok(Math.abs(hi - 100) < 1, `expected ~100F, got ${hi.toFixed(2)}`);
  });

  it('matches the NWS chart at 100F / 40% RH (~109F)', () => {
    const hi = heatIndexF(100, 40);
    assert.ok(Math.abs(hi - 109) < 1.5, `expected ~109F, got ${hi.toFixed(2)}`);
  });

  it('matches the NWS chart at 86F / 90% RH (~105F)', () => {
    const hi = heatIndexF(86, 90);
    assert.ok(Math.abs(hi - 105) < 2, `expected ~105F, got ${hi.toFixed(2)}`);
  });

  describe('the two corrections most implementations omit', () => {
    it('subtracts in hot and dry conditions (RH < 13%)', () => {
      // Rothfusz alone overestimates here. The adjustment must pull it DOWN.
      const adjusted = heatIndexF(100, 10);
      const rothfuszOnly = rothfusz(100, 10);
      assert.ok(
        adjusted < rothfuszOnly,
        `dry adjustment should reduce HI: adjusted ${adjusted.toFixed(2)} vs raw ${rothfuszOnly.toFixed(2)}`,
      );
      const expectedDelta = ((13 - 10) / 4) * Math.sqrt((17 - Math.abs(100 - 95)) / 17);
      assert.ok(Math.abs(rothfuszOnly - adjusted - expectedDelta) < 1e-9);
    });

    it('adds in warm and very humid conditions (RH > 85%)', () => {
      const adjusted = heatIndexF(85, 90);
      const rothfuszOnly = rothfusz(85, 90);
      assert.ok(adjusted > rothfuszOnly, 'humid adjustment should raise HI');
      const expectedDelta = ((90 - 85) / 10) * ((87 - 85) / 5);
      assert.ok(Math.abs(adjusted - rothfuszOnly - expectedDelta) < 1e-9);
    });
  });

  it('uses the simple form below 80F rather than extrapolating Rothfusz', () => {
    // Rothfusz is not valid down here and produces nonsense if used anyway.
    const hi = heatIndexF(70, 40);
    assert.ok(hi > 60 && hi < 80, `expected a sane low-temp value, got ${hi.toFixed(2)}`);
    assert.notEqual(Math.round(hi), Math.round(rothfusz(70, 40)));
  });

  it('is monotonic in humidity at a fixed temperature', () => {
    let previous = -Infinity;
    for (const rh of [20, 30, 40, 50, 60, 70, 80]) {
      const hi = heatIndexC(35, rh);
      assert.ok(hi > previous, `HI should rise with humidity, broke at RH=${rh}`);
      previous = hi;
    }
  });

  it('rejects impossible humidity rather than returning a number', () => {
    assert.throws(() => heatIndexC(30, 120), /0–100/);
    assert.throws(() => heatIndexC(30, -1), /0–100/);
    assert.throws(() => heatIndexC(Number.NaN, 50), /finite/);
  });

  describe('validity domain', () => {
    it('flags and clamps beyond the fitted range instead of extrapolating', () => {
      // Raw Rothfusz at 60C/40% returns a physically meaningless ~130C. An
      // earlier build printed exactly that in a compliance record.
      const raw = rothfusz(cToF(60), 40);
      assert.ok(fToC(raw) > 100, 'sanity: raw extrapolation really is absurd');

      const { value, extrapolated } = heatIndexWithDomain(60, 40);
      assert.equal(extrapolated, true);
      assert.ok(value < 70, `clamped value should be sane, got ${value.toFixed(1)}C`);
      assert.equal(value, fToC(heatIndexF(NWS_MAX_VALID_F, 40)));
    });

    it('does not flag readings inside the range', () => {
      const { extrapolated } = heatIndexWithDomain(38, 50);
      assert.equal(extrapolated, false);
    });

    it('clamped values still clear the OSHA extreme threshold', () => {
      // Clamping must never make a lethal reading look survivable.
      const { value } = heatIndexWithDomain(60, 40);
      assert.ok(value >= 46.1, 'a 60C reading must still band as extreme');
    });
  });
});

/** Bare Rothfusz, for asserting that the corrections actually fire. */
function rothfusz(T: number, RH: number): number {
  return (
    -42.379 +
    2.04901523 * T +
    10.14333127 * RH -
    0.22475541 * T * RH -
    0.00683783 * T * T -
    0.05481717 * RH * RH +
    0.00122874 * T * T * RH +
    0.00085282 * T * RH * RH -
    0.00000199 * T * T * RH * RH
  );
}
