/**
 * Signal Cabinet style reminder: the route is an evidence field, and its only visual drama is the split event.
 */
import { motion } from "framer-motion";
import { ArrowUpRight, ThermometerSun } from "lucide-react";
import type { Severity, Waypoint } from "@/lib/routeData";

type RouteMonitorProps = { waypoints: Waypoint[]; injected: boolean };

const severityClass = (severity: Severity) => `severity-${severity}`;

function SplitBeacon({ waypoint, injected }: { waypoint: Waypoint; injected: boolean }) {
  const active = injected && waypoint.waypoint_id === "wp-3";
  const split = injected && waypoint.waypoint_id === "wp-4";

  return (
    <motion.div
      className={`route-beacon ${active ? "route-beacon--active" : ""} ${split ? "route-beacon--split" : ""}`}
      style={{ left: `${waypoint.position.x}%`, top: `${waypoint.position.y}%` }}
      initial={false}
      animate={active ? { scale: [1, 1.18, 1], transition: { duration: 0.72, delay: 0.38 } } : { scale: 1 }}
    >
      {active && <motion.span className="route-beacon__pulse" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: [0, 0.85, 0], scale: [0.8, 2.6, 3.25] }} transition={{ duration: 1.3, delay: 0.14 }} />}
      <span className="route-beacon__orb">
        <span className={`route-beacon__half route-beacon__half--driver ${severityClass(waypoint.human_severity)}`} />
        <span className={`route-beacon__half route-beacon__half--cargo ${severityClass(waypoint.cargo_severity)}`} />
      </span>
      <span className="route-beacon__label">{waypoint.shortLabel}</span>
      <span className="route-beacon__place">{waypoint.place}</span>
      {active && <span className="route-beacon__reading">50.21°C <ArrowUpRight size={12} /></span>}
    </motion.div>
  );
}

export function RouteMonitor({ waypoints, injected }: RouteMonitorProps) {
  return (
    <section className="route-monitor" aria-labelledby="route-map-title">
      <div className="route-monitor__topline">
        <div>
          <p className="eyebrow">Route Surface</p>
          <h2 id="route-map-title">PHX — 01 <span>·</span> 4 monitored waypoints</h2>
        </div>
        <div className="route-monitor__legend" aria-label="Liability tracks legend">
          <span><i className="legend-dot legend-dot--driver" /> Driver safety</span>
          <span><i className="legend-dot legend-dot--cargo" /> Cargo liability</span>
        </div>
      </div>

      <div className={`route-map ${injected ? "route-map--injected" : ""}`}>
        <div className="route-map__photography" />
        <div className="route-map__grain" />
        <div className="route-map__event-artifact" />
        <div className="route-map__coordinates route-map__coordinates--left">33° 26′ 54.2″ N</div>
        <div className="route-map__coordinates route-map__coordinates--right">112° 04′ 26.4″ W</div>
        <div className="route-map__axis route-map__axis--x">NORTHBOUND · 12.7 MI</div>
        <div className="route-map__axis route-map__axis--y">THERMAL EVENT FIELD</div>

        <svg className="route-map__lines" viewBox="0 0 1000 580" preserveAspectRatio="none" aria-hidden="true">
          <path d="M 145 420 C 250 370, 300 340, 360 302 S 530 210, 595 174 S 755 90, 835 58" className="route-map__route-base" />
          <motion.path d="M 145 420 C 250 370, 300 340, 360 302 S 530 210, 595 174" className="route-map__route-live" initial={false} animate={{ pathLength: injected ? 1 : 0.36, opacity: injected ? 1 : 0.42 }} transition={{ duration: 0.64, ease: [0.23, 1, 0.32, 1] }} />
          <motion.path d="M 595 174 C 675 138, 740 98, 835 58" className="route-map__route-tail" initial={false} animate={{ pathLength: injected ? 1 : 0.25, opacity: injected ? 0.78 : 0.24 }} transition={{ duration: 0.5, delay: injected ? 0.65 : 0, ease: [0.23, 1, 0.32, 1] }} />
          <motion.path d="M 595 174 C 650 170, 703 188, 755 206" className="route-map__fork route-map__fork--driver" initial={false} animate={{ pathLength: injected ? 1 : 0.72, opacity: injected ? 1 : 0.62 }} transition={{ duration: 0.36, delay: injected ? 0.48 : 0, ease: [0.23, 1, 0.32, 1] }} />
          <motion.path d="M 595 174 C 647 222, 697 257, 755 274" className="route-map__fork route-map__fork--cargo" initial={false} animate={{ pathLength: injected ? 1 : 0.72, opacity: injected ? 1 : 0.62 }} transition={{ duration: 0.36, delay: injected ? 0.58 : 0, ease: [0.23, 1, 0.32, 1] }} />
          <circle cx="595" cy="174" r="54" className={injected ? "route-map__event-circle route-map__event-circle--show" : "route-map__event-circle"} />
        </svg>

        {waypoints.map((waypoint) => <SplitBeacon key={waypoint.waypoint_id} waypoint={waypoint} injected={injected} />)}

        <div className="route-map__paired-rails" aria-hidden="true">
          <span className="route-map__paired-rail route-map__paired-rail--driver">Driver safety</span>
          <span className="route-map__paired-rail route-map__paired-rail--cargo">Cargo liability</span>
        </div>

        <motion.div className="route-map__event-note" initial={false} animate={{ opacity: injected ? 1 : 0, y: injected ? 0 : 8 }} transition={{ duration: 0.32, delay: injected ? 0.7 : 0 }}>
          <ThermometerSun size={14} />
          <span>One observed heat event</span>
        </motion.div>
      </div>
      <p className="route-monitor__caption">Each marker carries two discrete severities. The route remains one record; the exposure outcomes do not.</p>
    </section>
  );
}
