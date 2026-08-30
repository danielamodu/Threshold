/**
 * Signal Cabinet style reminder: information pages are calm technical records, not generic policy templates.
 * Preserve graphite silence, mineral-white evidence tables, and the compact Threshold navigation system.
 */
import { Activity, ArrowLeft, FileText, ShieldCheck } from "lucide-react";
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


      </section>
    </InfoPage>
  );
}

export function LegalPage() {
  return (
    <InfoPage eyebrow="Legal / terms of service" title="Terms shaped for an operating record." lead="Threshold is a route intelligence product. These terms define what it is, what it is not, and what both parties are responsible for.">
      <section className="info-content landing-container policy-content">
        <article><p className="eyebrow">01 / What Threshold is</p><h2>A route intelligence and evidence product.</h2><p>Threshold ingests thermal telemetry, evaluates driver-safety and cargo-liability exposure independently, and produces an operating record of both. It is a decision-support tool. It is not a substitute for human judgment, qualified medical advice, legal counsel, insurance coverage determinations, or regulatory interpretation. No output from Threshold should be treated as a final compliance determination without human review.</p></article>
        <article><p className="eyebrow">02 / Permitted use</p><h2>Threshold is for authorized fleet and operations teams.</h2><p>Access to Threshold is provisioned to named organizations and their authorized personnel. Accounts may not be shared, resold, or used to process data for third parties without a separate written agreement. Each organization is responsible for ensuring that any person granted access is authorized to handle the route and personnel data their role exposes.</p></article>
        <article><p className="eyebrow">03 / Customer responsibilities</p><h2>Your team remains accountable for its decisions.</h2><p>Threshold surfaces data and operating recommendations. Your team is responsible for the accuracy of data entered, the configuration of applicable thresholds, and the review and authorization of any action taken downstream of a Threshold record. Threshold does not operate autonomously. Auto-execute actions, where available, are gated on explicit operator configuration and require both evaluators to reach their most severe tier independently.</p></article>
        <article><p className="eyebrow">04 / Data</p><h2>Route data stays within your organization.</h2><p>Thermal readings, route records, driver identifiers, and audit entries are scoped to your organization. Threshold does not share or aggregate your operational data across organizations. The audit log is append-only: records are written once and cannot be modified or deleted through any product interface. Threshold may process anonymized aggregate metrics to improve service reliability.</p></article>
        <article><p className="eyebrow">05 / Liability</p><h2>Threshold does not guarantee outcomes.</h2><p>Threshold is provided as-is. Threshold Systems makes no warranty that the product will prevent a driver injury, a cargo spoilage event, or a regulatory penalty. The product is designed to make exposure visible and to produce an auditable record of that visibility — not to guarantee the absence of the event itself. To the maximum extent permitted by applicable law, Threshold's liability is limited to fees paid in the preceding twelve months.</p></article>
        <article><p className="eyebrow">06 / Intellectual property</p><h2>You own your data. We own the product.</h2><p>All route data, audit records, and operating history generated by your organization remains yours. Threshold Systems owns the platform, algorithms, evaluators, and all product infrastructure. Nothing in these terms transfers ownership of either. Feedback you provide may be used to improve the product without compensation or attribution obligation.</p></article>
        <article><p className="eyebrow">07 / Changes and termination</p><h2>Material changes will be communicated in advance.</h2><p>Threshold may update these terms, product functionality, and operating logic. Changes that affect how your data is handled or how evaluations are made will be communicated at least fourteen days before taking effect. Either party may terminate the agreement with thirty days written notice. On termination, you may export your audit records in full before the account is closed.</p></article>
        <article><p className="eyebrow">08 / Contact</p><h2>Questions, disputes, and notices.</h2><p>For questions about these terms or to report a compliance concern, contact us at the address in the footer. Legal notices should be sent in writing to the same address with "Legal Notice" in the subject line.</p></article>
      </section>
    </InfoPage>
  );
}

export function PrivacyPage() {
  return (
    <InfoPage eyebrow="Legal / privacy notice" title="Data should travel with a purpose." lead="Threshold makes route exposure legible. It does not collect information unrelated to that operating record.">
      <section className="info-content landing-container policy-content">
        <article><p className="eyebrow">01 / Data we collect</p><h2>Route, environment, and operating record data.</h2><p>Threshold processes route coordinates, vehicle and route identifiers, temperature and humidity readings, timestamps, cargo classifications, audit records, and authorized user contact information. We collect what is necessary to operate the service. We do not collect personal health data, financial information, or data unrelated to fleet and cargo operations.</p></article>
        <article><p className="eyebrow">02 / How we use it</p><h2>One purpose: resolve exposure with context.</h2><p>Data is used to evaluate route events, produce driver-safety and cargo-liability records, operate and improve the service, provide support, and fulfill legal obligations. We do not sell your data. We do not use your route data to train models shared across organizations.</p></article>
        <article><p className="eyebrow">03 / Retention</p><h2>Audit records are kept for as long as you need them.</h2><p>The audit log is append-only and cannot be modified through any product interface. On account termination, your organization has thirty days to export your complete audit record before it is purged. Threshold does not retain your data beyond that window after account closure.</p></article>
        <article><p className="eyebrow">04 / Access and safeguards</p><h2>Access follows your organization's own rules.</h2><p>Route and driver data is scoped to your organization. Role-based access controls limit what each user can see. Threshold uses Clerk for authentication — credentials are never stored on our infrastructure. You are responsible for managing who in your organization holds each role.</p></article>
        <article><p className="eyebrow">05 / Contact</p><h2>Privacy questions and requests.</h2><p>To ask about your data, request deletion, or report a concern, use the contact address in the footer. We will respond within five business days.</p></article>
      </section>
    </InfoPage>
  );
}
