/**
 * Signal Cabinet style reminder: landing-page prose moves from exposure, to correlation, to proof.
 * Preserve the graphite/mineral-white evidence hierarchy and the copper/vermilion paired grammar.
 */
import { motion } from "framer-motion";
import { ArrowDownRight, FileWarning, HeartPulse, MoveRight, ShieldCheck, ThermometerSun } from "lucide-react";
import { DecisionRail } from "@/components/DecisionRail";
import { RouteMonitor } from "@/components/RouteMonitor";
import { ContactFlow } from "@/components/ContactFlow";
import { injectedWaypoints } from "@/lib/routeData";

type LandingSectionsProps = { injected: boolean; onToggle: () => void };

const reveal = { initial: { opacity: 0, y: 16 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, amount: 0.24 }, transition: { duration: 0.55, ease: [0.23, 1, 0.32, 1] } } as const;

export function LandingSections({ injected, onToggle }: LandingSectionsProps) {
  const route = injected ? injectedWaypoints : injectedWaypoints.map((point, index) => index > 1 ? { ...point, human_severity: "low" as const, cargo_severity: "low" as const } : point);
  const spike = injected ? route[2] : { ...route[2], event: { ...route[2].event, temp_c: 30.34 }, compliance: { ...route[2].compliance, heat_index_c: 30.7, action: "none" as const }, cargo: { ...route[2].cargo, cumulative_exposure_score: 0, risk_level: "nominal" as const, recommended_action: "none" as const } };
  const tail = injected ? route[3] : { ...route[3], event: { ...route[3].event, temp_c: 29.02 }, compliance: { ...route[3].compliance, heat_index_c: 29.4, action: "none" as const }, cargo: { ...route[3].cargo, cumulative_exposure_score: 0, risk_level: "nominal" as const, recommended_action: "none" as const } };

  return (
    <>
      <section className="landing-proof" id="product" aria-labelledby="proof-heading">
        <motion.div className="landing-container landing-proof__head" {...reveal}>
          <div>
            <p className="eyebrow">See it in action / PHX — 01</p>
            <h2 id="proof-heading">One heat event.<br /><em>One clear record.</em></h2>
          </div>
          <div className="landing-proof__control">
            <p>Press once to see how one heat event creates two separate actions: one for the driver and one for the cargo.</p>
            <button className="injector" onClick={onToggle} aria-pressed={injected}>
              <span className="injector__icon">{injected ? <ArrowDownRight size={16} /> : <ThermometerSun size={16} />}</span>
              <span>{injected ? "Reset the example" : "Show the heat event"}</span>
              <i />
            </button>
          </div>
        </motion.div>
        <motion.div className="landing-container product-artifact" {...reveal}>
          <div className="product-artifact__caption"><span>01 / record the heat event</span><span>02 / check driver and cargo risk</span><span>03 / show the next action</span></div>
          <div className="monitor-grid">
            <RouteMonitor waypoints={route} injected={injected} />
            <DecisionRail spike={spike} tail={tail} injected={injected} />
          </div>
          <div className="proof-line"><ThermometerSun size={15} /><span>{injected ? "The driver and cargo now have separate actions, based on the same heat event." : "The route is normal. Show the event to see the driver and cargo actions change."}</span></div>
        </motion.div>
      </section>

      <section className="blind-spot" aria-labelledby="blind-spot-heading">
        <div className="landing-container blind-spot__grid">
          <motion.div {...reveal}>
            <p className="eyebrow">The problem</p>
            <h2 id="blind-spot-heading">When driver and cargo teams use different tools, the full story gets lost.</h2>
            <p className="blind-spot__body">The driver team sees a heat-risk alert. The cargo team sees a temperature breach. Both matter, but separate tools hide the fact that the same heat event caused both problems.</p>
          </motion.div>
          <motion.div className="fork-figure" {...reveal}>
            <div className="fork-figure__event"><span>Heat event</span><strong>50.21°</strong><small>wp-3 / 15:00 UTC</small></div>
            <div className="fork-figure__branches">
              <div className="fork-figure__branch fork-figure__branch--driver"><HeartPulse size={19} /><span>Driver safety</span><strong>Reduce work limit</strong><small>Heat index 61.4°C</small></div>
              <div className="fork-figure__branch fork-figure__branch--cargo"><FileWarning size={19} /><span>Cargo risk</span><strong>Open a claim draft</strong><small>20.33 / 12 °C·h</small></div>
            </div>
          </motion.div>
        </div>
      </section>

      <section className="method" aria-labelledby="method-heading">
        <div className="landing-container">
          <motion.div className="method__intro" {...reveal}>
            <p className="eyebrow">How Threshold works</p>
            <h2 id="method-heading">See the heat event once.<br />Give each team the right next step.</h2>
          </motion.div>
          <div className="method__rows">
            <motion.article className="method-row" {...reveal}>
              <span className="method-row__index">01</span><p className="method-row__eyebrow">Record</p><h3>Capture the heat event with the details that matter.</h3><p className="method-row__body">Keep the temperature, humidity, location, and time together in one simple route record.</p><span className="method-row__state"><ThermometerSun size={16} /> Heat event recorded</span>
            </motion.article>
            <motion.article className="method-row" {...reveal}>
              <span className="method-row__index">02</span><p className="method-row__eyebrow">Check</p><h3>Check driver risk and cargo risk separately.</h3><p className="method-row__body">The same event can mean one thing for the driver and another for temperature-sensitive cargo.</p><span className="method-row__state method-row__state--paired"><i /><i /> Two checks, one event</span>
            </motion.article>
            <motion.article className="method-row" {...reveal}>
              <span className="method-row__index">03</span><p className="method-row__eyebrow">Act</p><h3>Show the next step and explain why.</h3><p className="method-row__body">Threshold keeps the driver action, cargo action, and reason in one place for people to review.</p><span className="method-row__state"><ShieldCheck size={16} /> Clear record retained</span>
            </motion.article>
          </div>
        </div>
      </section>

      <section className="integrity" aria-labelledby="integrity-heading">
        <div className="landing-container integrity__grid">
          <motion.div className="integrity__case" {...reveal}>
            <p className="eyebrow">The important difference / wp-4</p>
            <div className="integrity__case-reading"><span>29.1°C</span><small>the driver’s heat risk is back to normal</small></div>
            <div className="integrity__tracks"><div><span>Driver safety</span><strong>Recovered</strong><i className="integrity__bar integrity__bar--driver" /></div><div><span>Cargo liability</span><strong>Persistent breach</strong><i className="integrity__bar integrity__bar--cargo" /></div></div>
          </motion.div>
          <motion.div className="integrity__copy" {...reveal}>
            <p className="eyebrow">Keep the difference visible</p>
            <h2 id="integrity-heading">The driver can recover while the cargo risk remains.</h2>
            <p>When the outside temperature falls, the driver may be safe again. But cargo damage can keep building. Threshold makes that difference clear instead of hiding it in separate tools.</p>
            <div className="integrity__confidence"><span>0.50</span><p><strong>Lower confidence.</strong> The two results do not match, so Threshold flags the difference for review.</p></div>
          </motion.div>
        </div>
      </section>

      <section className="landing-close" aria-labelledby="close-heading">
        <div className="landing-container landing-close__shell">
          <motion.div {...reveal}>
            <p className="eyebrow">One shared view for every team</p>
            <h2 id="close-heading">Keep the heat event clear from start to finish.</h2>
          </motion.div>
          <motion.div className="landing-close__action" {...reveal}>
            <p>Start with the route data you already have. Threshold helps every team see the same heat event and the right next action.</p>
            <div className="value-proof"><p className="eyebrow">Value proof</p><strong>Use one shared route record to reduce duplicate reviews and make the next call sooner.</strong></div>
            <a href="#contact" className="landing-close__link">Tell us what you need <MoveRight size={17} /></a>
          </motion.div>
        </div>
      </section>

      <ContactFlow />
    </>
  );
}
