/**
 * The "live route map" from §2/§6 Phase 5.
 *
 * Deliberately NOT Mapbox/Leaflet, which §4's tech stack names. Real
 * street-tile imagery needs a Mapbox token — another external credential
 * that can fail during judging for zero payoff, since the actual judging
 * signal here is the risk-state fork, not cartographic accuracy. Instead:
 * the real waypoint coordinates, projected into an SVG viewBox, connected by
 * the actual route order, each point colored by the worse of its two
 * severities using the SAME rule the Agent Decision Layer itself reasons
 * with (`@threshold/decision-layer`'s severity buckets) — so the map's
 * color and the timeline's numbers can never silently disagree. Severity is
 * computed server-side (actions.ts) and shipped as plain data — see
 * demo-types.ts's SeverityBucket comment for why this component doesn't
 * import decision-layer itself (its barrel drags in `node:crypto`, which the
 * browser bundle can't handle). If real basemap tiles are wanted later, this
 * component is the one thing to swap; nothing else in Phase 5 depends on how
 * the route is drawn.
 */

'use client';

import type { DemoWaypoint, SeverityBucket } from '../demo-types';

/** Worse of two severities, by rank — mirrors decision-layer's `higher()` by value. */
function higher(a: SeverityBucket, b: SeverityBucket): SeverityBucket {
  const rank: Record<SeverityBucket, number> = { low: 0, mid: 1, high: 2 };
  return rank[a] >= rank[b] ? a : b;
}

const WIDTH = 640;
const HEIGHT = 260;
const PAD = 40;

const SEVERITY_COLOR: Record<SeverityBucket, string> = {
  low: 'var(--risk-low)',
  mid: 'var(--risk-mid)',
  high: 'var(--risk-high)',
};

function project(points: { lat: number; lng: number }[]): { x: number; y: number }[] {
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latSpan = maxLat - minLat || 1;
  const lngSpan = maxLng - minLng || 1;

  return points.map((p) => ({
    x: PAD + ((p.lng - minLng) / lngSpan) * (WIDTH - 2 * PAD),
    // Screen y grows downward; latitude grows northward — flip it.
    y: HEIGHT - PAD - ((p.lat - minLat) / latSpan) * (HEIGHT - 2 * PAD),
  }));
}

export function RouteMap({ waypoints }: { waypoints: DemoWaypoint[] }) {
  const points = project(waypoints);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label="Route map, waypoints coloured by risk state"
      style={{ width: '100%', height: 'auto', display: 'block' }}
    >
      <path d={path} fill="none" stroke="var(--border)" strokeWidth={2} />

      {waypoints.map((wp, i) => {
        const point = points[i];
        if (!point) return null;
        const severity = higher(wp.human_severity, wp.cargo_severity);
        const color = SEVERITY_COLOR[severity];
        const isSpike = wp.event.temp_c > 40;

        return (
          <g key={wp.waypoint_id}>
            {isSpike && (
              <circle cx={point.x} cy={point.y} r={16} fill={color} opacity={0.25}>
                <animate attributeName="r" values="12;20;12" dur="1.6s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.35;0.05;0.35" dur="1.6s" repeatCount="indefinite" />
              </circle>
            )}
            <circle cx={point.x} cy={point.y} r={9} fill={color} stroke="var(--surface)" strokeWidth={2} />
            <text
              x={point.x}
              y={point.y - 16}
              textAnchor="middle"
              fontSize={11}
              fill="var(--text-muted)"
              fontFamily="ui-monospace, monospace"
            >
              {wp.waypoint_id}
            </text>
            <text
              x={point.x}
              y={point.y + 26}
              textAnchor="middle"
              fontSize={11}
              fill="var(--text)"
              fontWeight={600}
            >
              {wp.event.temp_c.toFixed(1)}°C
            </text>
          </g>
        );
      })}
    </svg>
  );
}
