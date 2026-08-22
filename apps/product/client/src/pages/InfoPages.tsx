/**
 * Signal Cabinet style reminder: information pages are calm technical records, not generic policy templates.
 * Preserve graphite silence, mineral-white evidence tables, and the compact Threshold navigation system.
 */
import { Activity, ArrowLeft, Download, FileText, LockKeyhole, ShieldCheck } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { SiteFooter } from "@/components/SiteFooter";

type InfoPageProps = { eyebrow: string; title: string; lead: string; children: React.ReactNode };

function InfoPage({ eyebrow, title, lead, children }: InfoPageProps) {
  return (
    <main id="top" className="threshold-app info-page">
      <header className="info-nav landing-container">
        <BrandMark />
        <a href="/" className="info-nav__back"><ArrowLeft size={15} /> Return to site</a>
      </header>
      <section className="info-hero landing-container">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{lead}</p>
      </section>
      {children}
      <SiteFooter />
    </main>
  );
}

const logoUrl = "/manus-storage/threshold-gate-mark_98978d28.png";

export function DocsPage() {
  return (
    <InfoPage eyebrow="Documentation / product field guide" title="The event record, made legible." lead="Threshold keeps one observed temperature event intact while evaluating the driver and cargo consequences independently.">
      <section className="info-content landing-container">
        <div className="info-rule"><span>01</span><p>Core record</p><span>Raw event → independent assessment → correlated operating decision</span></div>
        <div className="docs-grid">
          <article><Activity size={19} /><p className="eyebrow">Observe</p><h2>Capture the heat event.</h2><p>Record location, temperature, humidity, data quality, and timestamp without reducing the source event to a single derived score.</p></article>
          <article><ShieldCheck size={19} /><p className="eyebrow">Evaluate</p><h2>Keep liability tracks distinct.</h2><p>Driver-safety action and cargo exposure are evaluated against their own thresholds, actions, and confidence conditions.</p></article>
          <article><FileText size={19} /><p className="eyebrow">Act</p><h2>Retain the decision logic.</h2><p>The final operating record preserves the raw reading, both responses, the action tier, and the plain-language rationale.</p></article>
        </div>

        <div className="docs-surface">
          <div><p className="eyebrow">Data surface</p><h2>Route event schema</h2></div>
          <div className="schema-table"><span>event.temp_c</span><strong>Observed temperature</strong><span>compliance.action</span><strong>Driver-side operating response</strong><span>cargo.cumulative_exposure_score</span><strong>Accumulated cold-chain exposure</strong><span>decision.confidence</span><strong>Confidence in the combined operating call</strong></div>
        </div>

        <div className="asset-download">
          <div className="asset-download__mark"><img src={logoUrl} alt="Threshold Gate Mark" /></div>
          <div><p className="eyebrow">Brand asset / transparent PNG</p><h2>Threshold Gate Mark</h2><p>The canonical Threshold identity mark. It is used in the site header, footer, and favicon metadata.</p></div>
          <a href={logoUrl} download="threshold-gate-mark.png"><Download size={16} /> Download PNG</a>
        </div>
      </section>
    </InfoPage>
  );
}

function PolicyNotice({ type }: { type: "Legal" | "Privacy" }) {
  return <div className="policy-notice"><LockKeyhole size={16} /><p><strong>{type} draft.</strong> This pre-production page defines the intended product posture and must be reviewed by qualified counsel before public or commercial use.</p></div>;
}

export function LegalPage() {
  return (
    <InfoPage eyebrow="Legal / pre-production terms" title="Terms shaped for an operating record." lead="Threshold is designed to clarify a route event and the decisions it informs. This draft makes its intended boundaries explicit.">
      <section className="info-content landing-container policy-content">
        <PolicyNotice type="Legal" />
        <article><p className="eyebrow">01 / Scope</p><h2>Threshold is an evidence and workflow product.</h2><p>Threshold presents route-event information, driver-safety evaluations, cargo-liability evaluations, and related operating records. It is not a substitute for medical judgment, legal advice, insurance coverage determinations, regulatory interpretation, or human operational supervision.</p></article>
        <article><p className="eyebrow">02 / Customer responsibilities</p><h2>Teams remain accountable for their actions.</h2><p>Customers are responsible for confirming that data entered into Threshold is accurate, for configuring any applicable operating thresholds, and for ensuring that decisions and downstream actions are reviewed by appropriately authorized personnel.</p></article>
        <article><p className="eyebrow">03 / Availability and change</p><h2>Operating rules must remain inspectable.</h2><p>Threshold may update product functionality, supporting documentation, and operating logic. Material changes should be documented in a release record so affected teams can assess their implications before relying on a revised workflow.</p></article>
        <article><p className="eyebrow">04 / Contact</p><h2>Questions about this draft.</h2><p>Use the footer contact channel to request a field brief or provide feedback on these draft terms.</p></article>
      </section>
    </InfoPage>
  );
}

export function PrivacyPage() {
  return (
    <InfoPage eyebrow="Privacy / pre-production notice" title="Data should travel with a purpose." lead="Threshold is intended to make route exposure legible without collecting information that is unrelated to that operating record.">
      <section className="info-content landing-container policy-content">
        <PolicyNotice type="Privacy" />
        <article><p className="eyebrow">01 / Intended data categories</p><h2>Route, environment, and operating record data.</h2><p>Threshold may process route coordinates, vehicle or route identifiers, temperature and humidity readings, timestamps, cargo classifications, action records, and authorized user contact information needed to operate the service.</p></article>
        <article><p className="eyebrow">02 / Intended use</p><h2>One clear purpose: resolve exposure with context.</h2><p>Information is intended to support route-event evaluation, product operation, support, security, compliance with applicable agreements, and controlled improvements to the reliability of the operating record.</p></article>
        <article><p className="eyebrow">03 / Safeguards and access</p><h2>Access should follow operational need.</h2><p>Customer teams should restrict access to authorized individuals, apply least-privilege practices, and establish their own retention and deletion rules. Threshold’s production privacy program should document data retention, subprocessors, incident response, and transfer mechanisms before launch.</p></article>
        <article><p className="eyebrow">04 / Privacy contact</p><h2>Request a conversation.</h2><p>Use the footer email channel for questions about this draft privacy notice or the proposed data scope.</p></article>
      </section>
    </InfoPage>
  );
}
