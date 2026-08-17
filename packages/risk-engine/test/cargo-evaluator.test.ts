import { strict as assert } from 'node:assert';
import { beforeEach, describe, it } from 'node:test';
import { assertValid, validateCargoRiskAssessment } from '@threshold/types';
import { CargoRiskEvaluator } from '../src/cargo-evaluator.js';
import { UnknownRouteError, RouteRegistry } from '../src/route-context.js';
import { SPOILAGE_CURVES } from '../src/spoilage.js';
import { event, registry, resetUuids, uuid } from './fixtures.js';

function evaluator(cargo: 'pharma' | 'produce' | 'general_reefer' = 'pharma') {
  return new CargoRiskEvaluator({
    routes: registry(cargo),
    newId: uuid,
    initialExposureHours: 1,
  });
}

describe('Cargo Risk Evaluator', () => {
  beforeEach(resetUuids);

  it('produces a §3-valid CargoRiskAssessment', () => {
    const { assessment } = evaluator().evaluate(event({ temp_c: 14 }));
    assertValid('CargoRiskAssessment', validateCargoRiskAssessment(assessment));
  });

  it('takes cargo_class from route context, not from the event', () => {
    // §3's event carries no cargo_class.
    const { assessment } = evaluator('produce').evaluate(event({ temp_c: 14 }));
    assert.equal(assessment.cargo_class, 'produce');
  });

  it('reports the breach budget as §3.threshold', () => {
    const { assessment } = evaluator('pharma').evaluate(event({ temp_c: 14 }));
    assert.equal(assessment.threshold, SPOILAGE_CURVES.pharma.breach_degree_hours);
  });

  it('leaves Phase 4 outputs unset', () => {
    const { assessment } = evaluator().evaluate(event({ temp_c: 20 }));
    assert.equal(assessment.claim_draft_id, null);
    assert.equal(assessment.reroute_suggestion, null);
  });

  // NB: ceilings are AMBIENT thresholds, not cargo set points — see the header
  // of spoilage.ts. pharma: ambient ceiling 30, elevated 4, breach 12.
  describe('degree-hours accrual (pharma: ambient ceiling 30, elevated 4, breach 12)', () => {
    it('accrues nothing at or below the ceiling', () => {
      const e = evaluator('pharma');
      const { assessment, contributed_degree_hours } = e.evaluate(event({ temp_c: 30 }));
      assert.equal(contributed_degree_hours, 0);
      assert.equal(assessment.cumulative_exposure_score, 0);
      assert.equal(assessment.risk_level, 'nominal');
      assert.equal(assessment.recommended_action, 'none');
    });

    it('accrues nothing on a normal warm day the reefer can absorb', () => {
      const { assessment } = evaluator('pharma').evaluate(event({ temp_c: 26 }));
      assert.equal(assessment.cumulative_exposure_score, 0);
      assert.equal(assessment.risk_level, 'nominal');
    });

    it('charges (ambient - ceiling) x hours and escalates cumulatively', () => {
      const e = evaluator('pharma');

      // 34C for 1h => 4 degree-hours => exactly the elevated boundary.
      const a = e.evaluate(event({ temp_c: 34, timestamp: '2026-08-17T14:00:00.000Z' }));
      assert.equal(a.contributed_degree_hours, 4);
      assert.equal(a.assessment.cumulative_exposure_score, 4);
      assert.equal(a.assessment.risk_level, 'elevated');
      assert.equal(a.assessment.recommended_action, 'reroute');

      // 38C for the next 0.5h => +4 => 8.
      const b = e.evaluate(event({ temp_c: 38, timestamp: '2026-08-17T14:30:00.000Z' }));
      assert.equal(b.contributed_degree_hours, 4);
      assert.equal(b.assessment.cumulative_exposure_score, 8);
      assert.equal(b.assessment.risk_level, 'elevated');

      // Another 0.5h at 38C => +4 => 12 => breach boundary.
      const c = e.evaluate(event({ temp_c: 38, timestamp: '2026-08-17T15:00:00.000Z' }));
      assert.equal(c.assessment.cumulative_exposure_score, 12);
      assert.equal(c.assessment.risk_level, 'breach');
      assert.equal(c.assessment.recommended_action, 'claim_draft');
    });

    it('a single severe event can breach on its own', () => {
      // Phase 2's exit condition injects one breach event; it must land.
      const { assessment } = evaluator('pharma').evaluate(event({ temp_c: 42 }));
      assert.equal(assessment.cumulative_exposure_score, 12);
      assert.equal(assessment.risk_level, 'breach');
    });

    it('never decreases once accrued, even when the weather cools', () => {
      const e = evaluator('pharma');
      e.evaluate(event({ temp_c: 42, timestamp: '2026-08-17T14:00:00.000Z' }));
      const after = e.evaluate(event({ temp_c: 18, timestamp: '2026-08-17T15:00:00.000Z' }));
      // Cargo does not un-spoil.
      assert.equal(after.assessment.cumulative_exposure_score, 12);
      assert.equal(after.assessment.risk_level, 'breach');
    });

    it('treats a warm afternoon as nominal, not as a total loss', () => {
      // Regression guard for the ambient-vs-set-point confusion: a 28C day must
      // not read as catastrophic just because pharma ships at 2-8C.
      const e = evaluator('pharma');
      for (const t of [24, 26, 28, 29.5]) {
        const { assessment } = e.evaluate(event({ temp_c: t }));
        assert.equal(assessment.risk_level, 'nominal', `${t}C should be nominal`);
      }
    });
  });

  describe('per-class curves', () => {
    it('pharma breaches on an excursion that leaves general reefer nominal', () => {
      // This is the point of having per-class curves at all.
      // 42C: pharma (42-30)x1h = 12 => breach. general (42-38)x1h = 4 < 20 => nominal.
      const exposure = { temp_c: 42, timestamp: '2026-08-17T14:00:00.000Z' };

      const pharma = evaluator('pharma').evaluate(event(exposure));
      const general = evaluator('general_reefer').evaluate(event(exposure));

      assert.equal(pharma.assessment.risk_level, 'breach');
      assert.equal(general.assessment.risk_level, 'nominal');
    });

    it('orders tolerance pharma < produce < general_reefer', () => {
      const p = SPOILAGE_CURVES.pharma;
      const q = SPOILAGE_CURVES.produce;
      const g = SPOILAGE_CURVES.general_reefer;

      assert.ok(p.ceiling_c < q.ceiling_c && q.ceiling_c < g.ceiling_c);
      assert.ok(p.breach_degree_hours < q.breach_degree_hours);
      assert.ok(q.breach_degree_hours < g.breach_degree_hours);
      assert.ok(p.elevated_degree_hours < p.breach_degree_hours);
      assert.ok(q.elevated_degree_hours < q.breach_degree_hours);
      assert.ok(g.elevated_degree_hours < g.breach_degree_hours);
    });

    it('honours an injected custom curve', () => {
      const e = new CargoRiskEvaluator({
        routes: registry('pharma'),
        newId: uuid,
        initialExposureHours: 1,
        curves: {
          pharma: { ceiling_c: 50, elevated_degree_hours: 50, breach_degree_hours: 99, note: 'test' },
        },
      });
      const { assessment } = e.evaluate(event({ temp_c: 42 }));
      assert.equal(assessment.cumulative_exposure_score, 0);
      assert.equal(assessment.threshold, 99);
    });
  });

  describe('state handling', () => {
    it('accumulates per route independently', () => {
      const routes = new RouteRegistry()
        .register({ route_id: 'route-a', driver_id: 'd1', cargo_class: 'pharma' })
        .register({ route_id: 'route-b', driver_id: 'd2', cargo_class: 'pharma' });
      const e = new CargoRiskEvaluator({ routes, newId: uuid, initialExposureHours: 1 });

      e.evaluate(event({ temp_c: 42, route_id: 'route-a' }));
      const b = e.evaluate(event({ temp_c: 32, route_id: 'route-b' }));

      assert.equal(e.scoreFor('route-a'), 12);
      assert.equal(b.assessment.cumulative_exposure_score, 2);
      assert.equal(b.assessment.risk_level, 'nominal');
    });

    it('reset clears a route for a new shipment on the same lane', () => {
      const e = evaluator('pharma');
      e.evaluate(event({ temp_c: 42 }));
      assert.equal(e.scoreFor('route-test'), 12);
      e.reset('route-test');
      assert.equal(e.scoreFor('route-test'), 0);
    });

    it('ignores out-of-order timestamps rather than crediting negative time', () => {
      const e = evaluator('pharma');
      e.evaluate(event({ temp_c: 42, timestamp: '2026-08-17T15:00:00.000Z' }));
      const backwards = e.evaluate(event({ temp_c: 42, timestamp: '2026-08-17T14:00:00.000Z' }));
      // A negative interval must not subtract exposure.
      assert.equal(backwards.exposure_hours, 0);
      assert.equal(backwards.assessment.cumulative_exposure_score, 12);
    });
  });

  it('scores a degraded-humidity event normally — humidity is irrelevant to cargo', () => {
    // The cargo side depends on temperature only, so a null humidity must not
    // block it. The two evaluators degrade independently.
    const { assessment } = evaluator('pharma').evaluate(
      event({ temp_c: 42, humidity_pct: null }),
    );
    assert.equal(assessment.risk_level, 'breach');
  });

  it('explains itself in terms a human can read', () => {
    const { explanation } = evaluator('pharma').evaluate(event({ temp_c: 42 }));
    assert.match(explanation, /above the pharma ceiling/i);
    assert.match(explanation, /degree-hours/i);
  });

  it('refuses an event for an unregistered route', () => {
    const e = evaluator();
    assert.throws(
      () => e.evaluate(event({ temp_c: 42, route_id: 'nope' })),
      UnknownRouteError,
    );
  });
});
