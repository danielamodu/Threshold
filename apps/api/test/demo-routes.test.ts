/**
 * Coverage for the demo HTTP surface (routes/demo.ts).
 *
 * HISTORY: these tests originally covered the synthetic heat-spike injector
 * (spike / spike_waypoint_id / spike_amount_c payload fields). That injector
 * was REMOVED — §8 decision 7: the FortyGuard trial key's pinned 2024-07-15
 * window was probed across morning hours and returned a genuine diurnal
 * warming arc (32.29 → 34.86 → 36.64 → 35.18°C) that produces a real
 * nominal-to-elevated-to-breach progression with no synthetic injection. The
 * spike tests were left behind and failed as noise for days; this file now
 * tests the contract that actually ships: POST /api/simulate ignores its
 * body entirely and always replays the cached real fixture.
 *
 * The numeric assertions below are tied to the committed fixture
 * (src/fixtures/fortyguard-2024-07-15.json) and the signed-off spoilage
 * curves (§8 decision 5) on purpose: if either changes, this file is part of
 * the review, not a silent drift.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { buildServer } from '../src/server.js';

interface DemoWaypoint {
  waypoint_id: string;
  event: { temp_c: number };
  compliance: { heat_index_c: number | null; action: string };
  cargo: {
    cumulative_exposure_score: number;
    risk_level: string;
    recommended_action: string;
    claim_draft_id: string | null;
    reroute_suggestion: object | null;
  };
  decision: { action_tier: string; confidence: number };
  human_severity: string;
  cargo_severity: string;
}

interface DemoBody {
  route_id: string;
  cargo_class: string;
  driver_id: string;
  waypoints: DemoWaypoint[];
}

async function simulate(payload?: Record<string, unknown>): Promise<{ status: number; body: DemoBody }> {
  const app = await buildServer();
  try {
    const res = await app.inject({ method: 'POST', url: '/api/simulate', payload });
    return { status: res.statusCode, body: res.json() as DemoBody };
  } finally {
    await app.close();
  }
}

describe('GET /api/route', () => {
  it('returns the static demo route with all four waypoints', async () => {
    const app = await buildServer();
    const res = await app.inject({ method: 'GET', url: '/api/route' });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.route_id, 'route-phx-01');
    assert.equal(body.waypoints.length, 4);
    assert.deepEqual(
      body.waypoints.map((w: { waypoint_id: string }) => w.waypoint_id),
      ['wp-1', 'wp-2', 'wp-3', 'wp-4'],
    );
    await app.close();
  });
});

describe('POST /api/simulate (real cached 2024-07-15 morning fixture)', () => {
  it('replays the real fixture: four waypoints on the natural warming arc', async () => {
    const { status, body } = await simulate();
    assert.equal(status, 200);
    assert.equal(body.route_id, 'route-phx-01');
    assert.equal(body.cargo_class, 'pharma');
    assert.equal(body.driver_id, 'driver-42');
    assert.equal(body.waypoints.length, 4);

    // Fixture maxima (temp_c is the AOI Max, §8 decision 1): warms wp-1 → wp-3,
    // then dips at wp-4 as the morning arc turns over.
    const byId = new Map(body.waypoints.map((w) => [w.waypoint_id, w]));
    assert.deepEqual(
      [...byId.keys()],
      ['wp-1', 'wp-2', 'wp-3', 'wp-4'],
      'waypoints must come back in route order',
    );
    assert.ok(Math.abs(byId.get('wp-1')!.event.temp_c - 32.2868) < 0.01);
    assert.ok(Math.abs(byId.get('wp-2')!.event.temp_c - 34.8612) < 0.01);
    assert.ok(Math.abs(byId.get('wp-3')!.event.temp_c - 36.6422) < 0.01);
    assert.ok(Math.abs(byId.get('wp-4')!.event.temp_c - 35.1796) < 0.01);
  });

  it('cargo walks the real progression: nominal → elevated → breach → breach', async () => {
    const { body } = await simulate();
    const byId = new Map(body.waypoints.map((w) => [w.waypoint_id, w]));

    // Exposure scores from the signed-off pharma curve (§8 decision 5/7).
    assert.equal(byId.get('wp-1')!.cargo.risk_level, 'nominal');
    assert.ok(Math.abs(byId.get('wp-1')!.cargo.cumulative_exposure_score - 2.29) < 0.01);
    assert.equal(byId.get('wp-2')!.cargo.risk_level, 'elevated');
    assert.ok(Math.abs(byId.get('wp-2')!.cargo.cumulative_exposure_score - 7.15) < 0.01);
    assert.equal(byId.get('wp-3')!.cargo.risk_level, 'breach');
    assert.ok(Math.abs(byId.get('wp-3')!.cargo.cumulative_exposure_score - 13.79) < 0.01);
    assert.equal(byId.get('wp-4')!.cargo.risk_level, 'breach');
    assert.ok(Math.abs(byId.get('wp-4')!.cargo.cumulative_exposure_score - 18.97) < 0.01);
  });

  it('recommended actions follow risk level: reroute at elevated, claim drafts from first breach onward', async () => {
    const { body } = await simulate();
    const byId = new Map(body.waypoints.map((w) => [w.waypoint_id, w]));

    assert.equal(byId.get('wp-1')!.cargo.recommended_action, 'none');
    assert.equal(byId.get('wp-1')!.cargo.claim_draft_id, null);
    assert.equal(byId.get('wp-1')!.cargo.reroute_suggestion, null);

    assert.equal(byId.get('wp-2')!.cargo.recommended_action, 'reroute');
    assert.ok(byId.get('wp-2')!.cargo.reroute_suggestion, 'elevated carries a reroute suggestion');
    assert.equal(byId.get('wp-2')!.cargo.claim_draft_id, null);

    assert.equal(byId.get('wp-3')!.cargo.recommended_action, 'claim_draft');
    assert.ok(byId.get('wp-3')!.cargo.claim_draft_id, 'first breach opens a claim draft');
    assert.equal(byId.get('wp-3')!.cargo.reroute_suggestion, null);

    assert.equal(byId.get('wp-4')!.cargo.recommended_action, 'claim_draft');
    assert.ok(byId.get('wp-4')!.cargo.claim_draft_id, 'still in breach keeps a claim draft linked');
  });

  it('the decision layer escalates to draft exactly when cargo breaches', async () => {
    const { body } = await simulate();
    const byId = new Map(body.waypoints.map((w) => [w.waypoint_id, w]));

    assert.equal(byId.get('wp-1')!.decision.action_tier, 'alert');
    assert.equal(byId.get('wp-2')!.decision.action_tier, 'alert');
    assert.equal(byId.get('wp-3')!.decision.action_tier, 'draft');
    assert.equal(byId.get('wp-4')!.decision.action_tier, 'draft');
    for (const wp of body.waypoints) {
      assert.ok(wp.decision.confidence > 0 && wp.decision.confidence <= 1);
      assert.ok(wp.decision.confidence >= 0.5, 'the hard-coded floor for split verdicts holds');
    }
  });

  it('every waypoint carries pre-computed severity for coloring', async () => {
    const { body } = await simulate();
    for (const wp of body.waypoints) {
      assert.ok(['low', 'mid', 'high'].includes(wp.human_severity));
      assert.ok(['low', 'mid', 'high'].includes(wp.cargo_severity));
    }
    // And the two tracks genuinely disagree at wp-4 — the fork the product
    // exists to show: driver side mid (recovered heat), cargo still high.
    const wp4 = body.waypoints.find((w) => w.waypoint_id === 'wp-4')!;
    assert.equal(wp4.human_severity, 'mid');
    assert.equal(wp4.cargo_severity, 'high');
  });

  it('ignores its body — the synthetic spike injector is gone (§8 decision 7)', async () => {
    const plain = await simulate();
    const withJunk = await simulate({ spike: true, spike_waypoint_id: 'wp-99', spike_amount_c: 25 });
    assert.equal(withJunk.status, 200, 'unknown payload fields must not be rejected — they are ignored');
    // UUIDs and generation timestamps differ per run by design; strip them and
    // the two replays must be byte-identical in everything deterministic.
    const stripVolatile = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(stripVolatile);
      if (value && typeof value === 'object') {
        return Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .filter(([k]) => !/_id$|^generated_at$|^timestamp$|^exported_pdf_url$/.test(k))
            .map(([k, v]) => [k, stripVolatile(v)]),
        );
      }
      return value;
    };
    assert.deepEqual(stripVolatile(withJunk.body), stripVolatile(plain.body));
  });
});
