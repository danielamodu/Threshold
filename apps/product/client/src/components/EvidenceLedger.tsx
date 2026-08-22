/** Signal Cabinet style reminder: four route records should read like a deliberate field report, not repeated dashboard cards. */
import { motion } from "framer-motion";
import { AlertTriangle, FileText, HeartPulse, ThermometerSun } from "lucide-react";
import { getTime, type Waypoint } from "@/lib/routeData";

type EvidenceLedgerProps = { waypoints: Waypoint[]; injected: boolean };

const actionLabel: Record<Waypoint["compliance"]["action"], string> = {
  none: "No action scheduled",
  rest_break_scheduled: "Rest break scheduled",
  work_limit_reduced: "Reduced work limit",
};

const riskLabel: Record<Waypoint["cargo"]["risk_level"], string> = {
  nominal: "Nominal / no action",
  elevated: "Elevated / reroute",
  breach: "Breach / claim draft",
};

export function EvidenceLedger({ waypoints, injected }: EvidenceLedgerProps) {
  return (
    <section className="evidence-ledger" aria-labelledby="evidence-title">
      <div className="evidence-ledger__head">
        <div>
          <p className="eyebrow">Event timeline</p>
          <h2 id="evidence-title">The route record, in order.</h2>
        </div>
        <p>Each row preserves the raw observation, two independently evaluated liability responses, and the combined operating decision.</p>
      </div>

      <div className="ledger-columns" aria-hidden="true">
        <span>Waypoint / reading</span>
        <span>Driver-safety response</span>
        <span>Cargo-liability response</span>
        <span>Automated decision</span>
      </div>

      <div className="ledger-list">
        {waypoints.map((point, index) => {
          const active = injected && point.waypoint_id === "wp-3";
          const split = injected && point.waypoint_id === "wp-4";
          return (
            <motion.article
              className={`ledger-row ${active ? "ledger-row--active" : ""} ${split ? "ledger-row--split" : ""}`}
              key={point.waypoint_id}
              initial={false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: injected ? index * 0.06 : 0 }}
            >
              <div className="ledger-waypoint">
                <span className="ledger-index">{point.shortLabel}</span>
                <div>
                  <p>{point.place}</p>
                  <strong>{getTime(point.event.timestamp)} UTC</strong>
                  <span>wp-{index + 1} · complete feed</span>
                </div>
                <div className="ledger-temperature"><ThermometerSun size={15} /><strong>{point.event.temp_c.toFixed(2)}°C</strong><span>{point.event.humidity_pct}% RH</span></div>
              </div>

              <div className="ledger-track ledger-track--driver">
                <HeartPulse size={16} />
                <div><p>{actionLabel[point.compliance.action]}</p><strong>Heat index {point.compliance.heat_index_c?.toFixed(1)}°C</strong></div>
              </div>

              <div className="ledger-track ledger-track--cargo">
                <FileText size={16} />
                <div><p>{riskLabel[point.cargo.risk_level]}</p><strong>{point.cargo.cumulative_exposure_score.toFixed(2)} <span>/ {point.cargo.threshold} °C·h</span></strong></div>
                <div className="exposure-bar"><i style={{ transform: `scaleX(${Math.min(point.cargo.cumulative_exposure_score / point.cargo.threshold, 1)})` }} /></div>
              </div>

              <div className="ledger-decision">
                <div className="ledger-decision__top"><span className={point.decision.action_tier === "draft" ? "tier tier--draft" : "tier"}>{point.decision.action_tier.replace("_", " ")}</span><span className="confidence">confidence {point.decision.confidence.toFixed(1)}</span></div>
                <p>{active || split ? point.decision.rationale : point.decision.summary}</p>
                {split && <span className="split-note"><AlertTriangle size={13} /> Asymmetry detected: cargo exposure persists after driver recovery.</span>}
              </div>
            </motion.article>
          );
        })}
      </div>
    </section>
  );
}
