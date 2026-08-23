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

  /**
   * `breach_episode_started` — the signal Phase 4 generates claim drafts on.
   *
   * Exposure never decays, so 'breach' is a state a route ENTERS and never
   * leaves, and `recommended_action` reads 'claim_draft' on every reading after
   * the crossing. Generating an artifact per recommendation therefore produced
   * one claim draft per waypoint for a single heat event. This flag isolates
   * the transition; the assertions below pin down that it fires exactly once
   * per episode and that `recommended_action` is unchanged by it.
   */
  describe('breach episodes', () => {
    it('fires on the reading that crosses into breach, and not on the next one', () => {
      const e = evaluator('pharma');

      // 42C for 1h => (42-30)x1 = 12 => exactly the breach boundary.
      const crossing = e.evaluate(event({ temp_c: 42, timestamp: '2026-08-17T14:00:00.000Z' }));
      assert.equal(crossing.assessment.cumulative_exposure_score, 12);
      assert.equal(crossing.assessment.risk_level, 'breach');
      assert.equal(crossing.breach_episode_started, true);

      // Another hour at 42C => +12 => 24. Deeper into the same episode, not a
      // new one.
      const deeper = e.evaluate(event({ temp_c: 42, timestamp: '2026-08-17T15:00:00.000Z' }));
      assert.equal(deeper.assessment.cumulative_exposure_score, 24);
      assert.equal(deeper.assessment.risk_level, 'breach');
      assert.equal(deeper.breach_episode_started, false);
    });

    it('stays false once the weather cools but the accrued exposure keeps the route in breach', () => {
      // This is the shape of the duplication bug: a reading that contributes
      // nothing at all still reported 'claim_draft' and still minted a draft.
      const e = evaluator('pharma');
      e.evaluate(event({ temp_c: 42, timestamp: '2026-08-17T14:00:00.000Z' }));

      const cooled = e.evaluate(event({ temp_c: 18, timestamp: '2026-08-17T15:00:00.000Z' }));
      assert.equal(cooled.contributed_degree_hours, 0);
      assert.equal(cooled.assessment.cumulative_exposure_score, 12);
      assert.equal(cooled.assessment.risk_level, 'breach');
      assert.equal(cooled.breach_episode_started, false);

      // §3 is untouched on purpose: 'claim_draft' is still the correct answer
      // to "what does this reading call for". Only the trigger for GENERATING
      // one moved off it.
      assert.equal(cooled.assessment.recommended_action, 'claim_draft');
    });

    it('is false for readings that never reach breach', () => {
      const e = evaluator('pharma');

      // 34C for 1h => 4 => the elevated boundary, not breach.
      const elevated = e.evaluate(event({ temp_c: 34, timestamp: '2026-08-17T14:00:00.000Z' }));
      assert.equal(elevated.assessment.risk_level, 'elevated');
      assert.equal(elevated.breach_episode_started, false);

      // At the ceiling: no accrual, so still 4 and still elevated.
      const flat = e.evaluate(event({ temp_c: 30, timestamp: '2026-08-17T15:00:00.000Z' }));
      assert.equal(flat.assessment.cumulative_exposure_score, 4);
      assert.equal(flat.breach_episode_started, false);
    });

    it('reset re-arms it, so a second shipment on the same lane gets its own episode', () => {
      // Episode-scoped, not once-per-route-forever. Withholding the second
      // shipment's claim would be a worse bug than the duplicates.
      const e = evaluator('pharma');
      assert.equal(
        e.evaluate(event({ temp_c: 42, timestamp: '2026-08-17T14:00:00.000Z' }))
          .breach_episode_started,
        true,
      );
      assert.equal(
        e.evaluate(event({ temp_c: 42, timestamp: '2026-08-17T15:00:00.000Z' }))
          .breach_episode_started,
        false,
      );

      e.reset('route-test');

      // No predecessor again, so the first hour is charged at
      // initialExposureHours and this crosses on its own.
      const second = e.evaluate(event({ temp_c: 42, timestamp: '2026-08-17T16:00:00.000Z' }));
      assert.equal(second.assessment.cumulative_exposure_score, 12);
      assert.equal(second.breach_episode_started, true);
    });

    it('tracks episodes per route independently', () => {
      const routes = new RouteRegistry()
        .register({ route_id: 'route-a', driver_id: 'd1', cargo_class: 'pharma' })
        .register({ route_id: 'route-b', driver_id: 'd2', cargo_class: 'pharma' });
      const e = new CargoRiskEvaluator({ routes, newId: uuid, initialExposureHours: 1 });

      const a1 = e.evaluate(
        event({ temp_c: 42, route_id: 'route-a', timestamp: '2026-08-17T14:00:00.000Z' }),
      );
      const b1 = e.evaluate(
        event({ temp_c: 42, route_id: 'route-b', timestamp: '2026-08-17T14:00:00.000Z' }),
      );
      const a2 = e.evaluate(
        event({ temp_c: 42, route_id: 'route-a', timestamp: '2026-08-17T15:00:00.000Z' }),
      );

      assert.equal(a1.breach_episode_started, true);
      assert.equal(b1.breach_episode_started, true, `route-b's episode is its own`);
      assert.equal(a2.breach_episode_started, false, `route-a is still inside its first episode`);
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
