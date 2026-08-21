import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { buildServer } from '../src/server.js';

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

describe('POST /api/simulate', () => {
  it('defaults to the clean baseline with no spike', async () => {
    const app = await buildServer();
    const res = await app.inject({ method: 'POST', url: '/api/simulate', payload: {} });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.spiked, false);
    assert.equal(body.spike_waypoint_id, null);
    assert.equal(body.waypoints.length, 4);
    for (const wp of body.waypoints) {
      assert.equal(wp.compliance.action, 'none');
    }
    await app.close();
  });

  it('spikes wp-3 by default and produces the fork', async () => {
    const app = await buildServer();
    const res = await app.inject({ method: 'POST', url: '/api/simulate', payload: { spike: true } });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.spiked, true);
    assert.equal(body.spike_waypoint_id, 'wp-3');

    const wp3 = body.waypoints.find((w: { waypoint_id: string }) => w.waypoint_id === 'wp-3');
    assert.equal(wp3.cargo.risk_level, 'breach');
    assert.equal(wp3.compliance.action, 'work_limit_reduced');
    assert.notEqual(wp3.decision.action_tier, 'alert');
    await app.close();
  });

  it('honours a custom spike_waypoint_id and spike_amount_c', async () => {
    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/simulate',
      payload: { spike: true, spike_waypoint_id: 'wp-1', spike_amount_c: 25 },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.spike_waypoint_id, 'wp-1');

    const wp1 = body.waypoints.find((w: { waypoint_id: string }) => w.waypoint_id === 'wp-1');
    assert.ok(wp1.event.temp_c > 40, `expected a hot wp-1, got ${wp1.event.temp_c}`);
    const wp2 = body.waypoints.find((w: { waypoint_id: string }) => w.waypoint_id === 'wp-2');
    assert.equal(wp2.compliance.action, 'none', 'only the targeted waypoint should be affected');
    await app.close();
  });

  it('rejects an unknown spike_waypoint_id rather than silently ignoring it', async () => {
    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/simulate',
      payload: { spike: true, spike_waypoint_id: 'wp-99' },
    });
    assert.equal(res.statusCode, 400);
    await app.close();
  });

  it('every waypoint carries pre-computed severity for coloring', async () => {
    const app = await buildServer();
    const res = await app.inject({ method: 'POST', url: '/api/simulate', payload: { spike: true } });
    const body = res.json();
    for (const wp of body.waypoints) {
      assert.ok(['low', 'mid', 'high'].includes(wp.human_severity));
      assert.ok(['low', 'mid', 'high'].includes(wp.cargo_severity));
    }
    await app.close();
  });
});
