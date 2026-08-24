/**
 * RouteMap / MapView — raw-SVG waypoint projection component.
 *
 * Deliberately avoids external cartographic tile dependencies (Mapbox/Google Maps API)
 * to ensure robust, credential-free execution without third-party proxies.
 * Reuses the proven SVG projection pattern from Phase 5 (`apps/web` RouteMap.tsx).
 */

import { cn } from "@/lib/utils";

export type SeverityBucket = "low" | "mid" | "high";

export interface MapWaypoint {
  waypoint_id: string;
  lat: number;
  lng: number;
  temp_c?: number;
  human_severity?: SeverityBucket;
  cargo_severity?: SeverityBucket;
}

const DEFAULT_WAYPOINTS: MapWaypoint[] = [
  { waypoint_id: "wp-1", lat: 33.4484, lng: -112.074, temp_c: 28.5, human_severity: "low", cargo_severity: "low" },
  { waypoint_id: "wp-2", lat: 33.5, lng: -112.1, temp_c: 33.4, human_severity: "low", cargo_severity: "low" },
  { waypoint_id: "wp-3", lat: 33.56, lng: -112.15, temp_c: 39.4, human_severity: "high", cargo_severity: "high" },
  { waypoint_id: "wp-4", lat: 33.62, lng: -112.2, temp_c: 38.8, human_severity: "mid", cargo_severity: "high" },
];

/** Worse of two severities, by rank — mirrors decision-layer's `higher()` by value. */
function higher(a: SeverityBucket = "low", b: SeverityBucket = "low"): SeverityBucket {
  const rank: Record<SeverityBucket, number> = { low: 0, mid: 1, high: 2 };
  return rank[a] >= rank[b] ? a : b;
}

const WIDTH = 640;
const HEIGHT = 260;
const PAD = 40;

const SEVERITY_COLOR: Record<SeverityBucket, string> = {
  low: "var(--nominal, #89b7ae)",
  mid: "var(--driver, #e9a36f)",
  high: "var(--cargo, #ff4b2b)",
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
    y: HEIGHT - PAD - ((p.lat - minLat) / latSpan) * (HEIGHT - 2 * PAD),
  }));
}

export interface RouteMapProps {
  waypoints?: MapWaypoint[];
  className?: string;
}

export function RouteMap({ waypoints = DEFAULT_WAYPOINTS, className }: RouteMapProps) {
  const activeWaypoints = waypoints.length > 0 ? waypoints : DEFAULT_WAYPOINTS;
  const points = project(activeWaypoints);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");

  return (
    <div className={cn("w-full overflow-hidden rounded-lg border border-[var(--line,#2a2a2a)] bg-[var(--card,#181816)] p-4", className)}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="Route map, waypoints coloured by risk state"
        style={{ width: "100%", height: "auto", display: "block" }}
      >
        <path d={path} fill="none" stroke="var(--border, rgba(242, 238, 230, 0.16))" strokeWidth={2} />

        {activeWaypoints.map((wp, i) => {
          const point = points[i];
          if (!point) return null;
          const severity = higher(wp.human_severity, wp.cargo_severity);
          const color = SEVERITY_COLOR[severity];
          const temp = wp.temp_c ?? 0;
          const isSpike = temp > 38;

          return (
            <g key={wp.waypoint_id}>
              {isSpike && (
                <circle cx={point.x} cy={point.y} r={16} fill={color} opacity={0.25}>
                  <animate attributeName="r" values="12;20;12" dur="1.6s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.35;0.05;0.35" dur="1.6s" repeatCount="indefinite" />
                </circle>
              )}
              <circle cx={point.x} cy={point.y} r={9} fill={color} stroke="var(--card, #181816)" strokeWidth={2} />
              <text
                x={point.x}
                y={point.y - 16}
                textAnchor="middle"
                fontSize={11}
                fill="var(--muted-foreground, #9e9a91)"
                fontFamily="var(--font-mono, monospace)"
              >
                {wp.waypoint_id}
              </text>
              {wp.temp_c !== undefined && (
                <text
                  x={point.x}
                  y={point.y + 26}
                  textAnchor="middle"
                  fontSize={11}
                  fill="var(--foreground, #f2eee6)"
                  fontWeight={600}
                >
                  {wp.temp_c.toFixed(1)}°C
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Legacy alias export for MapView compatibility */
export function MapView(props: { className?: string; initialCenter?: { lat: number; lng: number }; initialZoom?: number }) {
  return <RouteMap className={props.className} />;
}
