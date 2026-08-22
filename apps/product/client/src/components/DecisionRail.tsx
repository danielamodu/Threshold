/** Signal Cabinet style reminder: decision data should be staged as a clear causal sequence, never a stack of cards. */
import { motion } from "framer-motion";
import { ArrowDownRight, ArrowUpRight, FileWarning, HeartPulse, ShieldCheck } from "lucide-react";
import type { Waypoint } from "@/lib/routeData";

type DecisionRailProps = { spike: Waypoint; tail: Waypoint; injected: boolean };

export function DecisionRail({ spike, tail, injected }: DecisionRailProps) {
  const heroTemp = injected ? spike.event.temp_c : 30.34;
  const heatIndex = injected ? spike.compliance.heat_index_c : 30.7;
  const exposure = injected ? spike.cargo.cumulative_exposure_score : 0;

  return (
    <aside className={`decision-rail ${injected ? "decision-rail--active" : ""}`} aria-label="Correlated liability decision">
      <div className="decision-rail__head">
        <p className="eyebrow">Correlated decision</p>
        <div className="decision-rail__badge">{injected ? "DRAFT / HUMAN REVIEW" : "ALERT / LOGGED"}</div>
      </div>

      <div className="thermal-reading">
        <div>
          <span className="thermal-reading__label">Observed temperature</span>
          <motion.strong key={heroTemp} initial={{ opacity: 0.4, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.32 }}>{heroTemp.toFixed(2)}<small>°C</small></motion.strong>
        </div>
        <span className={injected ? "thermal-reading__delta thermal-reading__delta--critical" : "thermal-reading__delta"}>{injected ? <><ArrowUpRight size={13} /> +19.87</> : "Nominal run"}</span>
      </div>

      <div className="decision-fork">
        <div className="decision-fork__spine"><span>One event</span></div>
        <div className="decision-fork__key" aria-hidden="true"><span>Driver response</span><span>Cargo response</span></div>
        <motion.div className="decision-fork__branch decision-fork__branch--driver" initial={false} animate={{ opacity: injected ? 1 : 0.66, x: 0 }}>
          <div className="decision-fork__icon"><HeartPulse size={17} /></div>
          <div>
            <p>Driver safety</p>
            <strong>{injected ? "Reduced work limit" : "No action scheduled"}</strong>
            <span>Heat index {heatIndex?.toFixed(1)}°C</span>
          </div>
          <i className={injected ? "rail-status rail-status--high" : "rail-status"} />
        </motion.div>
        <motion.div className="decision-fork__branch decision-fork__branch--cargo" initial={false} animate={{ opacity: injected ? 1 : 0.66, x: 0 }} transition={{ delay: injected ? 0.12 : 0 }}>
          <div className="decision-fork__icon"><FileWarning size={17} /></div>
          <div>
            <p>Cargo liability</p>
            <strong>{injected ? "Claim draft opened" : "No exposure accrued"}</strong>
            <span>{exposure.toFixed(2)}/12 °C·h exposure</span>
          </div>
          <i className={injected ? "rail-status rail-status--high" : "rail-status"} />
        </motion.div>
      </div>

      <div className="persistent-liability">
        <div className="persistent-liability__marker"><ArrowDownRight size={14} /></div>
        <div>
          <p className="eyebrow">At the next waypoint</p>
          <strong>{injected ? "Driver recovered. Cargo did not." : "Both liability tracks remain nominal."}</strong>
          <span>{injected ? `Driver: ${tail.compliance.heat_index_c?.toFixed(1)}°C heat index · Cargo: ${tail.cargo.cumulative_exposure_score.toFixed(2)}/12 °C·h` : "No persistent exposure."}</span>
        </div>
      </div>

      <div className="decision-confidence">
        <div>
          <p className="eyebrow">Decision confidence</p>
          <strong>{injected ? "0.90" : "0.90"}</strong>
        </div>
        <span>{injected ? <><ShieldCheck size={14} /> Evaluators agree at source</> : <><ShieldCheck size={14} /> Nominal agreement</>}</span>
      </div>
    </aside>
  );
}
