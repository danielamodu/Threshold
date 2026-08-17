import { strict as assert } from 'node:assert';
import { beforeEach, describe, it } from 'node:test';
import { assertValid, validateComplianceRecord } from '@threshold/types';
import { HumanComplianceEvaluator } from '../src/compliance-evaluator.js';
import { UnknownRouteError } from '../src/route-context.js';
import { event, registry, resetUuids, uuid } from './fixtures.js';

function evaluator(routes = registry()) {
  return new HumanComplianceEvaluator({
    routes,
    newId: uuid,
    now: () => new Date('2026-08-17T14:05:00.000Z'),
  });
}

describe('Human Compliance Evaluator', () => {
  beforeEach(resetUuids);

  it('produces a §3-valid ComplianceRecord', () => {
    const { record } = evaluator().evaluate(event({ temp_c: 41.2, humidity_pct: 38 }));
    assertValid('ComplianceRecord', validateComplianceRecord(record));
  });

  it('carries the driver from route context, not from the event', () => {
    // §3's event has no driver_id — it comes from the route registry.
    const { record } = evaluator().evaluate(event({ temp_c: 30 }));
    assert.equal(record.driver_id, 'driver-42');
  });

  it('links the record to the originating event', () => {
    const e = event({ temp_c: 30 });
    const { record } = evaluator().evaluate(e);
    assert.equal(record.event_id, e.event_id);
  });

  describe('OSHA banding', () => {
    it('caution: mild conditions produce no action and an empty schedule', () => {
      const { record, band } = evaluator().evaluate(event({ temp_c: 25, humidity_pct: 40 }));
      assert.equal(band, 'caution');
      assert.equal(record.action, 'none');
      assert.deepEqual(record.schedule, []);
    });

    it('extreme: a severe breach reduces the work limit', () => {
      const { record, band } = evaluator().evaluate(event({ temp_c: 41.2, humidity_pct: 38 }));
      assert.equal(band, 'extreme');
      assert.equal(record.action, 'work_limit_reduced');
      assert.equal(record.schedule.length, 1);
      assert.equal(record.schedule[0]?.type, 'reduced_load');
      // Heat index must exceed the 46.1C extreme boundary.
      assert.ok(record.heat_index_c !== null && record.heat_index_c >= 46.1);
    });

    it('heat index exceeds dry bulb when humidity is high', () => {
      const { record } = evaluator().evaluate(event({ temp_c: 34, humidity_pct: 80 }));
      assert.ok(record.heat_index_c !== null);
      assert.ok(
        (record.heat_index_c as number) > 34,
        `HI ${String(record.heat_index_c)} should exceed dry bulb 34C at 80% RH`,
      );
    });

    it('bands rise monotonically with temperature at fixed humidity', () => {
      const e = evaluator();
      const order = ['caution', 'moderate', 'high', 'extreme'];
      let lastIndex = -1;
      for (const temp of [24, 30, 34, 38, 42, 46]) {
        const { band } = e.evaluate(event({ temp_c: temp, humidity_pct: 50 }));
        const idx = order.indexOf(band);
        assert.ok(idx >= lastIndex, `band went backwards at ${temp}C: ${band}`);
        lastIndex = idx;
      }
    });
  });

  describe('degraded humidity (§8 decision 3)', () => {
    it('sets heat_index_c to null rather than inventing a value', () => {
      const { record, usedFallback } = evaluator().evaluate(
        event({ temp_c: 39, humidity_pct: null }),
      );
      assert.equal(record.heat_index_c, null);
      assert.equal(usedFallback, true);
      assertValid('ComplianceRecord', validateComplianceRecord(record));
    });

    it('still produces a protective action — a null reading is not a safe one', () => {
      const { record, band } = evaluator().evaluate(event({ temp_c: 39, humidity_pct: null }));
      assert.equal(band, 'extreme'); // 39C >= dry-bulb extreme boundary of 37
      assert.equal(record.action, 'work_limit_reduced');
      assert.ok(record.schedule.length > 0, 'a degraded event must not silently drop protection');
    });

    it('is strictly more conservative than treating missing humidity as zero', () => {
      // Zero-filling is explicitly forbidden. Prove the fallback is not
      // equivalent to it: at 0% RH the heat index sits BELOW dry bulb, which
      // would hand back a weaker action than the fallback does.
      const degraded = evaluator().evaluate(event({ temp_c: 33, humidity_pct: null }));
      const zeroFilled = evaluator().evaluate(event({ temp_c: 33, humidity_pct: 0 }));

      assert.equal(degraded.band, 'high');
      assert.equal(zeroFilled.band, 'caution');
      assert.notEqual(degraded.record.action, zeroFilled.record.action);
    });

    it('explains itself in terms a human can read', () => {
      const { explanation } = evaluator().evaluate(event({ temp_c: 39, humidity_pct: null }));
      assert.match(explanation, /humidity was unavailable/i);
      assert.match(explanation, /dry-bulb/i);
    });
  });

  describe('schedule construction', () => {
    it('places rest at the end of the window, after exposure accrues', () => {
      const { record } = evaluator().evaluate(
        event({ temp_c: 36, humidity_pct: 55, timestamp: '2026-08-17T14:00:00.000Z' }),
      );
      const entry = record.schedule[0];
      assert.ok(entry);
      assert.equal(entry.end, '2026-08-17T15:00:00.000Z');
      assert.ok(
        Date.parse(entry.start) > Date.parse('2026-08-17T14:00:00.000Z'),
        'rest should not start at the instant of the reading',
      );
    });

    it('rests longer as the band worsens', () => {
      const e = evaluator();
      const moderate = e.evaluate(event({ temp_c: 31, humidity_pct: 55 }));
      const extreme = e.evaluate(event({ temp_c: 44, humidity_pct: 55 }));

      const minutes = (r: typeof moderate) => {
        const s = r.record.schedule[0];
        if (!s) return 0;
        return (Date.parse(s.end) - Date.parse(s.start)) / 60000;
      };
      assert.ok(
        minutes(extreme) > minutes(moderate),
        `extreme (${minutes(extreme)}m) should rest longer than moderate (${minutes(moderate)}m)`,
      );
    });
  });

  it('refuses an event for an unregistered route rather than guessing a driver', () => {
    const e = evaluator();
    assert.throws(() => e.evaluate(event({ temp_c: 30, route_id: 'route-unknown' })), UnknownRouteError);
  });
});
