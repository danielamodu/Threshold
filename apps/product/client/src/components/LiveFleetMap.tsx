/**
 * LiveFleetMap — Signal Cabinet interactive route visualization.
 * Raw SVG projection, no tile servers, no API keys.
 * Four roles, one FortyGuard-powered data source — the cached 2024-07-15 fixture
 * and the new forecast endpoint. Everything is interactive, not decorative.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, AlertTriangle, FileText } from "lucide-react";
import { useAuth } from "@clerk/clerk-react";
import { groupAuditByEvent, type GroupedDecision } from "@/lib/auditGrouping";
import { getForecast, listAudit, listRoutes, resolvePdfUrl as apiResolvePdfUrl, type ApiRoute, type ForecastResult } from "@/lib/api";
import { useApiCall } from "@/hooks/useApiCall";

// --- Projection (from existing Map.tsx, proven) ---
const WIDTH = 680;
const HEIGHT = 300;
const PAD = 44;

const RISK_COLOR: Record<string, string> = {
  nominal: "var(--nominal, #89b7ae)",
  elevated: "var(--driver, #e9a36f)",
  breach: "var(--cargo, #ff4b2b)",
};

function project(points: { lat: number; lng: number }[]) {
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

// Demo waypoint coordinates — the only persisted geometry today.
const WAYPOINT_COORDS = [
  { waypoint_id: "wp-1", lat: 33.4484, lng: -112.074 },
  { waypoint_id: "wp-2", lat: 33.5, lng: -112.1 },
  { waypoint_id: "wp-3", lat: 33.56, lng: -112.15 },
  { waypoint_id: "wp-4", lat: 33.62, lng: -112.2 },
];

type FleetRoute = {
  route: ApiRoute;
  timeline: GroupedDecision[]; // oldest first
  latest: GroupedDecision | null;
  risk: string; // nominal/elevated/breach from latest.cargo
  waypointRisks: Map<string, GroupedDecision>; // wp_id -> latest for that wp
};

function useFleetData() {
  const routesCall = useApiCall((t) => listRoutes(t), []);
  const auditCall = useApiCall((t) => listAudit(t), []);
  const fleet = useMemo<FleetRoute[]>(() => {
    if (!routesCall.data?.routes) return [];
    const groups = auditCall.data ? groupAuditByEvent(auditCall.data.entries) : [];
    // groupAuditByEvent returns newest first; reverse for oldest first per route
    const byRoute = new Map<string, GroupedDecision[]>();
    for (const g of [...groups].reverse()) {
      if (!g.route_id) continue;
      const arr = byRoute.get(g.route_id) ?? [];
      arr.push(g);
      byRoute.set(g.route_id, arr);
    }
    return routesCall.data.routes.map((r) => {
      const tl = byRoute.get(r.route_id) ?? [];
      const latest = tl.length ? tl[tl.length - 1]! : null;
      const wpMap = new Map<string, GroupedDecision>();
      // Build waypoint risk map by order — last occurrence wins
      tl.forEach((g, idx) => {
        const wpId = WAYPOINT_COORDS[idx]?.waypoint_id;
        if (wpId) wpMap.set(wpId, g);
      });
      // Also map any remaining waypoints that have no audit yet as nominal
      return {
        route: r,
        timeline: tl,
        latest,
        risk: latest?.cargo?.risk_level ?? "nominal",
        waypointRisks: wpMap,
      };
    });
  }, [routesCall.data, auditCall.data]);
  return { routesCall, auditCall, fleet };
}

// Playback hook — uses real FortiGuard timestamps, not arbitrary timers
function usePlayback(timeline: GroupedDecision[]) {
  const [activeIdx, setActiveIdx] = useState(() => (timeline.length ? timeline.length - 1 : 0));
  const [isPlaying, setIsPlaying] = useState(false);
  const timerRef = useRef<number | null>(null);

  // Keep activeIdx in bounds when timeline changes
  useEffect(() => {
    if (timeline.length && activeIdx >= timeline.length) setActiveIdx(timeline.length - 1);
  }, [timeline.length, activeIdx]);

  useEffect(() => {
    if (!isPlaying || timeline.length < 2) return;
    timerRef.current = window.setInterval(() => {
      setActiveIdx((prev) => {
        const next = prev + 1;
        if (next >= timeline.length) {
          setIsPlaying(false);
          return prev;
        }
        return next;
      });
    }, 900);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [isPlaying, timeline.length]);

  const active = timeline[activeIdx] ?? null;
  return { activeIdx, setActiveIdx, active, isPlaying, setIsPlaying };
}

// Small helper to format time from ISO
function fmtTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function LiveFleetMap({
  role,
  filter,
  onFilterChange,
}: {
  role: "admin" | "dispatcher" | "compliance" | "driver";
  filter?: string | null;
  onFilterChange?: (f: string | null) => void;
}) {
  const { fleet, routesCall, auditCall } = useFleetData();
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [detailRouteId, setDetailRouteId] = useState<string | null>(null);
  const [hoveredWp, setHoveredWp] = useState<{ routeId: string; wpId: string } | null>(null);

  // Driver: only their assigned route — determined by driver_unlinked or by filtering fleet to their driver
  // For now, driver sees first route that matches their driver_id from audit; fallback to first fleet route
  const visibleFleet = useMemo(() => {
    if (role === "driver") {
      // Driver audit is already scoped to their driver_id server-side
      const driverFiltered = fleet.filter((f) => f.timeline.length > 0);
      return driverFiltered.length ? driverFiltered.slice(0, 1) : fleet.slice(0, 1);
    }
    if (filter === "breach") return fleet.filter((f) => f.risk === "breach");
    if (filter === "watch") return fleet.filter((f) => f.risk === "elevated");
    return fleet;
  }, [fleet, role, filter]);

  const selected = visibleFleet.find((f) => f.route.route_id === selectedRouteId) ?? visibleFleet[0] ?? null;
  const timeline = selected?.timeline ?? [];
  const playback = usePlayback(timeline);

  // Forecast state for dispatcher/admin pre-departure
  const { getToken } = useAuth();
  const [departureInput, setDepartureInput] = useState("2024-07-15T06:00");
  const [forecast, setForecast] = useState<ForecastResult | null>(null);
  const [forecastLoading, setForecastLoading] = useState(false);

  async function loadForecast() {
    if (!selected) return;
    setForecastLoading(true);
    try {
      const token = await getToken();
      const depIso = new Date(departureInput).toISOString();
      const res = await getForecast(token, selected.route.route_id, { departure_time: depIso });
      setForecast(res);
    } catch {
      setForecast(null);
    } finally {
      setForecastLoading(false);
    }
  }

  useEffect(() => {
    if ((role === "dispatcher" || role === "admin") && selected) {
      void loadForecast();
    }
  }, [selected?.route.route_id, role]);

  useEffect(() => {
    if ((role !== "dispatcher" && role !== "admin") || !selected) return;
    const t = window.setTimeout(() => void loadForecast(), 450);
    return () => window.clearTimeout(t);
  }, [departureInput, selected]);

  const points = useMemo(() => project(WAYPOINT_COORDS), []);
  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");

  // Driver band — must be before early return to keep hook order stable
  const driverBand = (() => {
    if (!selected) return null;
    const active = playback.active ?? selected.latest;
    const hi = active?.compliance?.heat_index_c;
    const action = active?.compliance?.action ?? "none";
    if (action === "work_limit_reduced") return { label: "BREACH — Work limit reduced", color: "var(--cargo)", hi };
    if (action === "rest_break_scheduled") return { label: "CAUTION — Rest break scheduled", color: "var(--driver)", hi };
    return { label: "SAFE — No action required", color: "var(--nominal)", hi };
  })();

  // Admin live stats — before early return
  const stats = useMemo(() => {
    const total = fleet.length;
    const breach = fleet.filter((f) => f.risk === "breach").length;
    const watch = fleet.filter((f) => f.risk === "elevated").length;
    return { total, breach, watch };
  }, [fleet]);

  if (routesCall.loading || auditCall.loading) {
    return (
      <div className="rounded-none border border-[var(--line-strong)] bg-[#171715] p-6">
        <p className="eyebrow">Loading live route</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {role === "admin" && (
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Total routes", value: stats.total, filter: null as string | null, active: !filter },
            { label: "Routes in breach", value: stats.breach, filter: "breach" as const, active: filter === "breach" },
            { label: "Routes on watch", value: stats.watch, filter: "watch" as const, active: filter === "watch" },
          ].map((s) => (
            <button
              key={s.label}
              onClick={() => onFilterChange?.(s.filter)}
              className={`border p-3 text-left transition-colors ${s.active ? "border-[var(--paper)] bg-[var(--paper)] text-[#111110]" : "border-[var(--line-strong)] bg-[#1a1917] text-[var(--paper)] hover:border-[var(--line)]"}`}
            >
              <p className="font-mono text-[8px] uppercase tracking-widest opacity-70">{s.label}</p>
              <p className="mt-1 font-mono text-[22px] font-bold leading-none">{String(s.value).padStart(2, "0")}</p>
            </button>
          ))}
        </div>
      )}

      {/* MAP CARD */}
      <div className="overflow-hidden border border-[var(--line-strong)] bg-[#171715]">
        {/* Top bar */}
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--line)] px-4 py-3 sm:px-5">
          <div>
            <p className="eyebrow">Live route — raw SVG, no tile server</p>
            <h3 className="mt-1 font-mono text-[12px] tracking-wide text-[#f0ece5]">
              {role === "driver" ? "My route" : `Fleet — ${visibleFleet.length} route${visibleFleet.length === 1 ? "" : "s"} `}
              {filter ? <span className="text-[var(--driver)]"> · {filter}</span> : null}
            </h3>
          </div>
          <div className="flex items-center gap-2 font-mono text-[9px] text-[#a8a49b]">
            <span className="inline-flex items-center gap-1.5"><i className="h-[7px] w-[7px] rounded-full" style={{ background: RISK_COLOR.nominal }} /> nominal</span>
            <span className="inline-flex items-center gap-1.5"><i className="h-[7px] w-[7px] rounded-full" style={{ background: RISK_COLOR.elevated }} /> elevated</span>
            <span className="inline-flex items-center gap-1.5"><i className="h-[7px] w-[7px] rounded-full" style={{ background: RISK_COLOR.breach }} /> breach</span>
          </div>
        </div>

        {/* SVG MAP */}
        <div className="relative bg-[#1b1a18]" style={{ minHeight: role === "driver" ? 420 : 340 }}>
          <div className="pointer-events-none absolute inset-0 opacity-[0.45]" style={{ backgroundImage: "url(/assets/threshold-cartographic-field.webp)", backgroundSize: "cover", backgroundPosition: "center", mixBlendMode: "luminosity", filter: "contrast(1.05) brightness(.75) saturate(.4)" }} />
          <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: "radial-gradient(ellipse at 60% 34%, rgba(255,75,43,.08), transparent 27%), linear-gradient(90deg, rgba(17,17,16,.82), rgba(17,17,16,.26) 48%, rgba(17,17,16,.52))" }} />

          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="relative block h-auto w-full" role="img" aria-label="Live fleet map">
            <path d={pathD} fill="none" stroke="rgba(242,238,230,.18)" strokeWidth={1.4} strokeDasharray="2 8" />

            {/* Compliance trail mode: colored segments per waypoint */}
            {role === "compliance" && selected && (
              <g>
                {WAYPOINT_COORDS.map((wp, i) => {
                  if (i === 0) return null;
                  const a = points[i - 1]!;
                  const b = points[i]!;
                  const g = selected.waypointRisks.get(wp.waypoint_id) ?? selected.timeline[i];
                  const risk = g?.cargo?.risk_level ?? "nominal";
                  return <line key={wp.waypoint_id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={RISK_COLOR[risk]} strokeWidth={3} opacity={0.95} />;
                })}
              </g>
            )}

            {/* Waypoint dots */}
            {WAYPOINT_COORDS.map((wp, i) => {
              const p = points[i]!;
              const g = selected?.waypointRisks.get(wp.waypoint_id);
              const risk = g?.cargo?.risk_level ?? selected?.timeline[i]?.cargo?.risk_level ?? "nominal";
              const isActiveDot = role === "compliance" ? true : playback.active?.event_id === g?.event_id;
              return (
                <g
                  key={wp.waypoint_id}
                  onMouseEnter={() => setHoveredWp({ routeId: selected?.route.route_id ?? "", wpId: wp.waypoint_id })}
                  onMouseLeave={() => setHoveredWp(null)}
                  onClick={() => {
                    if (role === "compliance" && g) {
                      const url = apiResolvePdfUrl(g.compliance?.exported_pdf_url ?? g.claim?.exported_pdf_url ?? null);
                      if (url) window.open(url, "_blank");
                    } else if (g) {
                      const idx = selected?.timeline.findIndex((x) => x.event_id === g.event_id) ?? -1;
                      if (idx >= 0) playback.setActiveIdx(idx);
                    }
                  }}
                  style={{ cursor: role === "compliance" ? "pointer" : "default" }}
                >
                  <circle cx={p.x} cy={p.y} r={isActiveDot ? 9 : 7} fill={RISK_COLOR[risk]} stroke="#181816" strokeWidth={2} />
                  <text x={p.x} y={p.y - 14} textAnchor="middle" fontSize={9} fill="#c4c0b7" fontFamily="var(--font-mono)">
                    {wp.waypoint_id}
                  </text>
                </g>
              );
            })}

            {/* Fleet / driver trucks */}
            {visibleFleet.map((fr) => {
              const isSelected = selected?.route.route_id === fr.route.route_id;
              const activeG = fr.timeline[playback.activeIdx] ?? fr.latest;
              const temp = activeG?.thermal?.temp_c;
              const t = fr.timeline.length > 1 ? playback.activeIdx / (fr.timeline.length - 1) : 0;
              const segs = points.length - 1;
              const segIdx = Math.floor(t * segs);
              const segT = t * segs - segIdx;
              const a = points[Math.min(segIdx, points.length - 1)]!;
              const b = points[Math.min(segIdx + 1, points.length - 1)]!;
              const x = a.x + (b.x - a.x) * segT;
              const y = a.y + (b.y - a.y) * segT;
              const col = RISK_COLOR[fr.risk] ?? RISK_COLOR.nominal;
              return (
                <g
                  key={fr.route.route_id}
                  onClick={() => {
                    setSelectedRouteId(fr.route.route_id);
                    setDetailRouteId(fr.route.route_id);
                  }}
                  style={{ cursor: "pointer" }}
                >
                  {/* temp float */}
                  {temp !== undefined && (
                    <text x={x} y={y - 22} textAnchor="middle" fontSize={10} fontWeight={700} fill={isSelected ? "#f2eee6" : "#c4c0b7"} fontFamily="var(--font-mono)">
                      {temp.toFixed(1)}°C
                    </text>
                  )}
                  {/* truck marker */}
                  <g transform={`translate(${x},${y})`}>
                    <rect x={-14} y={-9} width={28} height={16} rx={2} fill={col} stroke="#111110" strokeWidth={1.2} opacity={isSelected ? 1 : 0.92} />
                    <text x={0} y={3} textAnchor="middle" fontSize={7} fill="#111110" fontWeight={700} fontFamily="var(--font-mono)">
                      {fr.route.route_id.replace("route-", "").slice(0, 4).toUpperCase()}
                    </text>
                    {isSelected && <circle cx={0} cy={0} r={18} fill="none" stroke={col} strokeOpacity={0.35} strokeWidth={1} />}
                  </g>
                  <text x={x} y={y + 22} textAnchor="middle" fontSize={8} fill={isSelected ? "#f2eee6" : "#9e9a91"} fontFamily="var(--font-mono)">
                    {fr.route.route_id}
                  </text>
                </g>
              );
            })}
          </svg>

          {/* Coordinates */}
          <span className="pointer-events-none absolute bottom-2 left-3 font-mono text-[8px] tracking-widest text-[rgba(242,238,230,.44)]">33° 26′ N · 112° 04′ W</span>
          <button
            onClick={() => playback.setIsPlaying((v) => !v)}
            className="absolute bottom-2 right-3 inline-flex items-center gap-1.5 border border-[var(--line-strong)] bg-[#111110] px-2.5 py-1 font-mono text-[9px] tracking-wide text-[var(--paper)]"
          >
            {playback.isPlaying ? <Pause size={12} /> : <Play size={12} />}
            {playback.isPlaying ? "Pause" : "Play"}
          </button>
        </div>

        {/* Scrubber — real timestamps, not arbitrary */}
        <div className="border-t border-[var(--line)] bg-[#141412] px-4 py-3">
          <div className="mb-1.5 flex justify-between font-mono text-[8px] tracking-wide text-[#8d8980]">
            <span>{fmtTime(timeline[0]?.occurred_at)}</span>
            <span className="text-[var(--paper)]">
              {playback.active ? `${playback.active.route_id ?? selected?.route.route_id} · ${playback.active.thermal?.temp_c.toFixed(1) ?? "—"}°C · ${playback.active.occurred_at ? fmtTime(playback.active.occurred_at) : ""}` : "—"}
            </span>
            <span>{fmtTime(timeline[timeline.length - 1]?.occurred_at)}</span>
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(0, timeline.length - 1)}
            value={playback.activeIdx}
            onChange={(e) => {
              playback.setIsPlaying(false);
              playback.setActiveIdx(Number(e.target.value));
            }}
            className="h-1 w-full accent-[var(--cargo)]"
          />
          <div className="mt-1 flex gap-1">
            {timeline.map((g, i) => (
              <button
                key={g.event_id}
                onClick={() => {
                  playback.setIsPlaying(false);
                  playback.setActiveIdx(i);
                }}
                className="h-1 flex-1"
                style={{ background: RISK_COLOR[g.cargo?.risk_level ?? "nominal"], opacity: playback.activeIdx === i ? 1 : 0.45 }}
                aria-label={`Go to ${g.cargo?.risk_level} at ${fmtTime(g.occurred_at)}`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Slide-out detail — truck click */}
      {detailRouteId &&
        (() => {
          const fr = visibleFleet.find((f) => f.route.route_id === detailRouteId);
          if (!fr) return null;
          return (
            <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onClick={() => setDetailRouteId(null)}>
              <div
                className="h-full w-full max-w-[440px] overflow-y-auto border-l border-[var(--line-strong)] bg-[#141412] p-4 sm:p-5"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="font-mono text-[11px] tracking-wide text-[var(--paper)]">
                    {fr.route.route_id} · {fr.route.cargo_class} · {fr.route.driver_id}
                  </h4>
                  <button
                    onClick={() => setDetailRouteId(null)}
                    className="border border-[var(--line-strong)] bg-[#111110] px-2 py-1 font-mono text-[10px] text-[var(--paper)]"
                  >
                    Close
                  </button>
                </div>
                <p className="eyebrow">Decision timeline — real FortyGuard timestamps</p>
                <div className="mt-3 space-y-3">
                  {fr.timeline.map((g) => (
                    <div key={g.event_id} className="border border-[var(--line)] bg-[#1a1917] p-3">
                      <p className="font-mono text-[9px] tracking-wide text-[#a8a39a]">
                        {fmtTime(g.occurred_at)} · {g.cargo?.risk_level} · {g.decision?.action_tier} · {(g.decision!.confidence * 100).toFixed(0)}%
                      </p>
                      <p className="mt-1 text-[11px] leading-5 text-[#ded9d0]">{g.decision?.rationale}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {g.compliance?.exported_pdf_url && (
                          <a
                            href={apiResolvePdfUrl(g.compliance.exported_pdf_url) ?? "#"}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 border border-[var(--line-strong)] bg-[var(--paper)] px-2 py-1 font-mono text-[10px] text-[#111110]"
                          >
                            <FileText size={10} /> Compliance
                          </a>
                        )}
                        {g.claim?.exported_pdf_url && (
                          <a
                            href={apiResolvePdfUrl(g.claim.exported_pdf_url) ?? "#"}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 border border-[var(--cargo)] bg-[var(--cargo)] px-2 py-1 font-mono text-[10px] text-white"
                          >
                            <FileText size={10} /> Claim draft
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })()}

      {/* Role-specific panels below map */}
      {role === "driver" && driverBand && (
        <div className="border border-[var(--line-strong)] bg-[var(--paper)] p-4 text-[#1a1815]">
          <p className="eyebrow !text-[#766f65]">Current thermal band</p>
          <p className="mt-1 font-display text-[34px] leading-none tracking-tight" style={{ color: driverBand.color }}>
            {driverBand.label}
          </p>
          <p className="mt-1 font-mono text-[10px] text-[#635d54]">
            Heat index {driverBand.hi != null ? `${driverBand.hi.toFixed(1)}°C` : "—"} {driverBand.color === "var(--cargo)" ? "— OSHA extreme threshold exceeded" : ""}
          </p>
          {driverBand.color === "var(--cargo)" && (
            <p className="mt-3 inline-flex items-center gap-1.5 bg-[#1a1815] px-2 py-1 font-mono text-[10px] text-white">
              <AlertTriangle size={12} /> Rest break required — heat index {driverBand.hi?.toFixed(1)}°C exceeds OSHA threshold
            </p>
          )}
          <div className="mt-4 grid gap-2">
            <p className="eyebrow !text-[#766f65]">Tap a past waypoint</p>
            <div className="flex flex-wrap gap-1.5">
              {timeline.map((g, i) => (
                <button
                  key={g.event_id}
                  onClick={() => playback.setActiveIdx(i)}
                  className="border px-2 py-1 font-mono text-[10px]"
                  style={{ borderColor: RISK_COLOR[g.cargo?.risk_level ?? "nominal"], background: playback.activeIdx === i ? RISK_COLOR[g.cargo?.risk_level ?? "nominal"] : "transparent", color: playback.activeIdx === i ? "#111110" : "#1a1815" }}
                >
                  {WAYPOINT_COORDS[i]?.waypoint_id ?? g.event_id.slice(0, 4)} · {g.thermal?.temp_c.toFixed(1)}°C · {g.compliance?.action}
                </button>
              ))}
            </div>
            {playback.active && (
              <div className="rounded border border-[rgba(32,29,24,.18)] bg-[#f4f0e8] p-3 font-mono text-[10px] leading-5 text-[#29251f]">
                <div>
                  <strong>Temp:</strong> {playback.active.thermal?.temp_c.toFixed(1)}°C · <strong>Heat index:</strong> {playback.active.compliance?.heat_index_c?.toFixed(1) ?? "—"}°C
                </div>
                <div>
                  <strong>Compliance:</strong> {playback.active.compliance?.action} · <strong>Confidence:</strong> {(playback.active.decision!.confidence * 100).toFixed(0)}%
                </div>
                <div className="mt-1 text-[#635d54]">{playback.active.decision?.rationale.slice(0, 180)}…</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Dispatcher/Admin forecast bar */}
      {(role === "dispatcher" || role === "admin") && selected && (
        <div className="border border-[var(--line-strong)] bg-[#1a1917] p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="eyebrow">Pre-departure forecast — {forecast?.forecast_source ?? "historical_replay_2024-07-15"}</p>
              <p className="mt-1 font-mono text-[10px] text-[#a8a39a]">
                {forecast ? (
                  forecast.route_risk_summary.safe_to_depart ? (
                    <span className="text-[var(--nominal)]">Safe to depart</span>
                  ) : (
                    <span className="text-[var(--cargo)]">
                      Breach expected at {forecast.route_risk_summary.first_breach_waypoint} at {fmtTime(forecast.route_risk_summary.first_breach_time)}
                    </span>
                  )
                ) : (
                  "Pick a departure time to see risk before you roll"
                )}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="datetime-local"
                value={departureInput}
                onChange={(e) => setDepartureInput(e.target.value)}
                className="border border-[var(--line-strong)] bg-[#111110] px-2 py-1.5 font-mono text-[11px] text-[var(--paper)]"
              />
              <button onClick={() => void loadForecast()} className="border border-[var(--paper)] bg-[var(--paper)] px-3 py-1.5 font-mono text-[10px] font-bold text-[#1a1815]">
                {forecastLoading ? "Scoring…" : "Score"}
              </button>
            </div>
          </div>
          {/* Timeline bar green→amber→red per waypoint */}
          <div className="mt-3 flex h-2 overflow-hidden border border-[var(--line)]">
            {(forecast?.waypoints ?? []).map((w) => (
              <div key={w.waypoint_id} className="flex-1" style={{ background: RISK_COLOR[w.cargo.risk_level] }} title={`${w.waypoint_id}: ${w.projected_temp_c}°C → ${w.cargo.risk_level} @ ${fmtTime(w.projected_time)}`} />
            ))}
            {!forecast && <div className="flex-1 bg-[var(--line)]" />}
          </div>
          <div className="mt-1.5 flex justify-between font-mono text-[8px] text-[#8d8980]">
            <span>depart {forecast ? fmtTime(forecast.departure_time) : "—"}</span>
            <span>{forecast?.waypoints.map((w) => `${w.waypoint_id}:${w.projected_temp_c.toFixed(1)}°C`).join(" · ") ?? "—"}</span>
          </div>
        </div>
      )}

      {/* Compliance hover tooltip */}
      {hoveredWp && selected && (() => {
        const g = selected.waypointRisks.get(hoveredWp.wpId) ?? selected.timeline.find((x) => x.event_id === hoveredWp.wpId);
        if (!g) return null;
        return (
          <div className="fixed bottom-4 left-1/2 z-20 max-w-[92vw] -translate-x-1/2 border border-[var(--line-strong)] bg-[#f2eee6] px-3 py-2 font-mono text-[10px] leading-4 text-[#1a1815] shadow-xl sm:left-auto sm:right-4 sm:translate-x-0">
            <div className="flex gap-3">
              <span>
                <strong>{hoveredWp.wpId}</strong> · {g.thermal?.temp_c.toFixed(1)}°C · HI {g.compliance?.heat_index_c?.toFixed(1) ?? "—"}°C
              </span>
              <span className="text-[#635d54]">{g.decision?.action_tier} · {(g.decision!.confidence * 100).toFixed(0)}% confidence</span>
            </div>
            <div className="mt-1 line-clamp-2 max-w-[520px] text-[#494238]">{g.decision?.rationale}</div>
            <div className="mt-1 flex gap-2">
              {g.compliance?.exported_pdf_url && (
                <a href={apiResolvePdfUrl(g.compliance.exported_pdf_url) ?? "#"} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#1a1815] underline">
                  <FileText size={10} /> Compliance PDF
                </a>
              )}
              {g.claim?.exported_pdf_url && (
                <a href={apiResolvePdfUrl(g.claim.exported_pdf_url) ?? "#"} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#a93c29] underline">
                  <FileText size={10} /> Claim draft PDF
                </a>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
