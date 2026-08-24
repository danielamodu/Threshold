/**
 * Signal Cabinet style reminder: this is a single-screen evidence instrument.
 * One controlled heat injection creates a clear driver/cargo fork; do not add dashboard chrome.
 */
import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowDownRight } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { LandingSections } from "@/components/LandingSections";
import { SiteFooter } from "@/components/SiteFooter";

export default function Home() {
  const [injected, setInjected] = useState(false);

  return (
    <main id="top" className={`threshold-app landing-page ${injected ? "threshold-app--injected" : ""}`}>
      <header className="landing-nav landing-container">
        <BrandMark />
        <nav aria-label="Primary navigation"><a href="/docs">Docs</a><a href="/legal">Legal</a><a href="/privacy">Privacy</a></nav>
        <a className="landing-nav__cta" href="#product">How it works <ArrowDownRight size={14} /></a>
      </header>

      <section className="landing-hero landing-container">
        <motion.div className="landing-hero__copy" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.58, ease: [0.23, 1, 0.32, 1] }}>
          <p className="eyebrow">Route monitoring for temperature-controlled freight</p>
          <h1>One heat event.<br /><em>Two clear actions.</em></h1>
          <p>Threshold shows how the same heat event affects the driver and the cargo, then gives every team one clear record of what happened and what to do next.</p>
          <a className="hero-primary" href="/sign-in">Open workspace <ArrowDownRight size={17} /></a>
        </motion.div>
        <motion.div className="landing-hero__field" initial={{ opacity: 0, scale: .96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.7, delay: .1, ease: [0.23, 1, 0.32, 1] }}>
          <span className="landing-hero__field-label">Field brief / PHX — 01</span>
          <div className="landing-hero__thermal">50.21<small>°C</small></div>
          <div className="landing-hero__split" aria-label="One observed event branches into driver safety and cargo liability">
          <span className="landing-hero__origin">One heat event</span>
            <i className="landing-hero__node landing-hero__node--origin" />
            <span className="landing-hero__rail landing-hero__rail--driver"><i /> Driver safety</span>
            <span className="landing-hero__rail landing-hero__rail--cargo"><i /> Cargo liability</span>
          </div>
          <div className="landing-hero__lanes"><span><i /> Driver safety</span><span><i /> Cargo liability</span></div>
          <p>One heat event. Two clear actions.</p>
        </motion.div>
      </section>

      <LandingSections injected={injected} onToggle={() => setInjected((value) => !value)} />

      <SiteFooter />
    </main>
  );
}
