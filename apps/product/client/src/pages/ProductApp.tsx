/**
 * Signal Cabinet style reminder: every operational screen treats data as an evidence record, never as generic dashboard filler.
 *
 * Real data throughout — GET/POST /api/routes, GET /api/audit — behind the
 * real Clerk session (useProductRoute -> useThresholdSession). The old
 * demoRoutes/auditItems/demoMembers/artifact fixtures are gone from every
 * path below; productShellData.ts now only supplies role labels/copy and
 * the RouteStatus/DemoRoute *types* still used to describe real API rows.
 */
import { useState } from "react";
import { useAuth, OrganizationProfile } from "@clerk/clerk-react";
import { ArrowRight, ArrowUpRight, ClipboardCheck, FileClock, FilePlus2, FileWarning, PanelRightOpen, Plus, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { useParams } from "wouter";
import { ProductShell, useProductRoute } from "@/components/ProductShell";
import { useApiCall } from "@/hooks/useApiCall";
import { createRoute, getRoute, listAudit, listRoutes, resolvePdfUrl, type ApiRoute } from "@/lib/api";
import { groupAuditByEvent, type GroupedDecision } from "@/lib/auditGrouping";
import type { RouteStatus } from "@/lib/productShellData";
import type { CargoClass } from "@threshold/types";

function statusFromRiskLevel(risk?: string): RouteStatus {
  if (risk === "breach") return "breach";
  if (risk === "elevated") return "elevated";
  return "nominal";
}

const statusLabel: Record<RouteStatus, string> = { nominal: "OK", elevated: "Watch", breach: "Breach" };

function StatusMark({ status }: { status: RouteStatus }) {
  return <span className={`status-mark status-mark--${status}`}><i /><span className="status-mark__split" aria-hidden="true"><b /><b /></span>{statusLabel[status]}</span>;
}

function ButtonLink({ href, children, quiet = false }: { href: string; children: React.ReactNode; quiet?: boolean }) {
  return <a className={quiet ? "product-button product-button--quiet" : "product-button"} href={href}>{children}</a>;
}

function LoadingRow() {
  return <div className="product-content"><p className="eyebrow">Loading real data…</p></div>;
}

function ErrorRow({ message }: { message: string }) {
  return <div className="product-content"><p className="form-error">{message}</p></div>;
}

/** Most recent grouped decision per route_id, from the real /api/audit feed. */
function useRouteStatuses() {
  const { data, loading, error } = useApiCall((token) => listAudit(token), []);
  const latestByRoute = new Map<string, GroupedDecision>();
  if (data) {
    for (const g of groupAuditByEvent(data.entries)) {
      if (!g.route_id) continue;
      if (!latestByRoute.has(g.route_id)) latestByRoute.set(g.route_id, g);
    }
  }
  return { latestByRoute, loading, error };
}

function RoutesTable({ role, routes, statuses }: { role: string; routes: ApiRoute[]; statuses: Map<string, GroupedDecision> }) {
  return <div className="route-table"><div className="route-table__head"><span>Route</span><span>Load</span><span>Driver</span><span>Current state</span><span>Last reading</span><span /></div>{routes.map((route) => { const latest = statuses.get(route.route_id); const status = statusFromRiskLevel(latest?.cargo?.risk_level); return <a className="route-table__row" href={`/app/${role}/detail/${encodeURIComponent(route.route_id)}`} key={route.id}><span><strong>{route.route_id}</strong><small>{route.cargo_class}</small></span><span>{route.cargo_class}</span><span>{route.driver_id}</span><span><StatusMark status={status} /></span><span><strong>{latest?.thermal ? `${latest.thermal.temp_c.toFixed(1)}°C` : "—"}</strong><small>{latest?.occurred_at ? new Date(latest.occurred_at).toLocaleString() : "no data yet"}</small></span><span><ArrowUpRight size={15} /></span></a>; })}</div>;
}

function RoutesPage({ role }: { role: "admin" | "dispatcher" | "driver" }) {
  const { data, loading, error } = useApiCall((token) => listRoutes(token), []);
  const { latestByRoute } = useRouteStatuses();
  const copy = role === "driver" ? { title: "My routes", subtitle: "" } : { title: "Routes", subtitle: "" };
  const routes = data?.routes ?? [];

  return <ProductShell title={copy.title} subtitle={copy.subtitle} actions={role !== "driver" ? <><ButtonLink href={`/app/${role}/create`}><Plus size={15} /> Create route</ButtonLink><ButtonLink quiet href={`/app/${role}/activity`}><SlidersHorizontal size={15} /> Activity</ButtonLink></> : undefined}>
    <section className="product-content">
      {role !== "driver" && <div className="product-stat-strip"><div><span>Total</span><strong>{String(routes.length).padStart(2, "0")}</strong></div><div><span>Breach</span><strong className="text-cargo">{String(Array.from(latestByRoute.values()).filter((g) => g.cargo?.risk_level === "breach").length).padStart(2, "0")}</strong></div><div><span>Watch</span><strong className="text-driver">{String(Array.from(latestByRoute.values()).filter((g) => g.cargo?.risk_level === "elevated").length).padStart(2, "0")}</strong></div></div>}
      <div className="product-section-head"><div><h2>{role === "driver" ? "Assigned routes" : "Active routes"}</h2></div></div>
      {loading && <LoadingRow />}
      {error && <ErrorRow message={error} />}
      {!loading && !error && routes.length === 0 && <p className="eyebrow">No routes yet in this organisation.</p>}
      {!loading && !error && routes.length > 0 && <RoutesTable role={role} routes={routes} statuses={latestByRoute} />}
    </section>
  </ProductShell>;
}

function RouteDetailPage({ role, routeId }: { role: "admin" | "dispatcher" | "driver"; routeId: string }) {
  const { data: route, loading: routeLoading, error: routeError } = useApiCall((token) => getRoute(token, routeId), [routeId]);
  const { data: auditData, loading: auditLoading, error: auditError } = useApiCall((token) => listAudit(token), []);
  const timeline = auditData ? groupAuditByEvent(auditData.entries).filter((g) => g.route_id === routeId) : [];
  const latest = timeline[0];

  return <ProductShell title={routeId} subtitle={route ? `${route.cargo_class} · ${route.driver_id}` : ""} actions={<ButtonLink quiet href={`/app/${role}/routes`}>Routes</ButtonLink>}>
    <section className="product-content">
      {routeLoading && <LoadingRow />}
      {routeError && <ErrorRow message={routeError} />}
      {route && <div className="route-detail-meta"><div><span className="eyebrow">Status</span><StatusMark status={statusFromRiskLevel(latest?.cargo?.risk_level)} /></div><div><span className="eyebrow">Cargo</span><strong>{route.cargo_class}</strong></div><div><span className="eyebrow">Driver</span><strong>{route.driver_id}</strong></div></div>}
      <div className="product-section-head"><div><h2>Decision timeline</h2></div></div>
      {auditLoading && <LoadingRow />}
      {auditError && <ErrorRow message={auditError} />}
      {!auditLoading && !auditError && timeline.length === 0 && <p className="eyebrow">No decisions recorded yet for this route.</p>}
      {!auditLoading && timeline.length > 0 && <div className="audit-stack">{timeline.map((g) => <article className={`audit-card audit-card--${g.decision ? "aligned" : "split"}`} key={g.event_id}><div className="audit-card__stamp"><span className="eyebrow">{g.occurred_at ? new Date(g.occurred_at).toLocaleString() : "—"}</span><strong>{routeId}</strong><small>seq {g.seq}</small></div><div className="audit-card__responses"><div><span>Driver</span><strong>{g.compliance?.action ?? "—"}</strong></div><div><span>Cargo</span><strong>{g.cargo?.recommended_action ?? "—"}</strong></div></div>{g.decision && <div className="audit-card__decision"><span className={`decision-tier decision-tier--${g.decision.action_tier}`}>{g.decision.action_tier}</span><span className="agreement">{(g.decision.confidence * 100).toFixed(0)}% confidence</span></div>}{g.decision?.rationale && <p className="audit-card__rationale"><span>Reason</span>{g.decision.rationale}</p>}</article>)}</div>}
    </section>
  </ProductShell>;
}

function CreateRoutePage({ role }: { role: "admin" | "dispatcher" }) {
  const { getToken } = useAuth();
  const [routeId, setRouteId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [cargoClass, setCargoClass] = useState<CargoClass>("pharma");
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("saving");
    setError(null);
    try {
      const token = await getToken();
      await createRoute(token, { route_id: routeId, driver_id: driverId, cargo_class: cargoClass });
      setStatus("done");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return <ProductShell title="Create route" subtitle="" actions={<ButtonLink quiet href={`/app/${role}/routes`}>Cancel</ButtonLink>}>
    <section className="product-content">
      <form className="route-create-form" onSubmit={submit}>
        <div className="route-create-form__head"><h2>Route details</h2></div>
        <div className="route-create-form__grid">
          <label><span>Route ID</span><input value={routeId} onChange={(e) => setRouteId(e.target.value)} placeholder="route-phx-14" required /></label>
          <label><span>Cargo</span><select value={cargoClass} onChange={(e) => setCargoClass(e.target.value as CargoClass)}><option value="pharma">Pharma</option><option value="produce">Produce</option><option value="general_reefer">General reefer</option></select></label>
          <label><span>Driver ID</span><input value={driverId} onChange={(e) => setDriverId(e.target.value)} placeholder="driver-14" required /></label>
        </div>
        <button type="submit" className="product-button" disabled={status === "saving"}><FilePlus2 size={16} /> {status === "saving" ? "Creating…" : "Create route"}</button>
        {status === "done" && <p className="form-confirmation"><ShieldCheck size={15} /> Route created.</p>}
        {status === "error" && error && <p className="form-error">{error}</p>}
      </form>
    </section>
  </ProductShell>;
}

function ActivityPage() {
  const { data, loading, error } = useApiCall((token) => listAudit(token), []);
  const timeline = data ? groupAuditByEvent(data.entries) : [];
  return <ProductShell title="Activity" subtitle="">
    <section className="product-content">
      {loading && <LoadingRow />}
      {error && <ErrorRow message={error} />}
      {!loading && !error && timeline.length === 0 && <p className="eyebrow">No activity recorded yet.</p>}
      <div className="activity-list">{timeline.map((g, index) => <article key={g.event_id}><span className="activity-list__index">0{index + 1}</span><div><p className="eyebrow">{g.occurred_at ? new Date(g.occurred_at).toLocaleString() : "—"} / {g.route_id ?? "—"}</p><h2>{g.cargo?.risk_level === "breach" ? "Claim draft opened" : g.cargo?.risk_level === "elevated" ? "Heat risk under watch" : "Route normal"}</h2></div><StatusMark status={statusFromRiskLevel(g.cargo?.risk_level)} /></article>)}</div>
    </section>
  </ProductShell>;
}

/** Real Clerk organization settings/members — Clerk's own component covers this (see §11 org-invite research); not reimplemented locally. */
function SettingsPage() {
  return <ProductShell title="Organisation" subtitle=""><section className="product-content"><OrganizationProfile routing="hash" /></section></ProductShell>;
}

function MembersPage() {
  return <ProductShell title="Members" subtitle=""><section className="product-content"><OrganizationProfile routing="hash" /></section></ProductShell>;
}

function AuditPage() {
  const { data, loading, error } = useApiCall((token) => listAudit(token), []);
  const timeline = data ? groupAuditByEvent(data.entries) : [];
  return <ProductShell title="Audit" subtitle="" actions={<ButtonLink quiet href="/app/compliance/records"><ClipboardCheck size={15} /> Records</ButtonLink>}>
    <section className="product-content">
      {loading && <LoadingRow />}
      {error && <ErrorRow message={error} />}
      {!loading && !error && timeline.length === 0 && <p className="eyebrow">No decisions recorded yet.</p>}
      <div className="audit-stack">{timeline.map((item) => <article className={`audit-card audit-card--${item.decision ? "aligned" : "split"}`} key={item.event_id}><div className="audit-card__stamp"><span className="eyebrow">{item.occurred_at ? new Date(item.occurred_at).toLocaleString() : "—"}</span><strong>{item.route_id ?? "—"}</strong><small>seq {item.seq}</small></div><div className="audit-card__responses"><div><span>Driver</span><strong>{item.compliance?.action ?? "—"}</strong></div><div><span>Cargo</span><strong>{item.cargo?.recommended_action ?? "—"}</strong></div></div>{item.decision && <div className="audit-card__decision"><span className={`decision-tier decision-tier--${item.decision.action_tier}`}>{item.decision.action_tier}</span><span className="agreement">{(item.decision.confidence * 100).toFixed(0)}%</span></div>}{item.decision?.rationale && <p className="audit-card__rationale"><span>Reason</span>{item.decision.rationale}</p>}</article>)}</div>
    </section>
  </ProductShell>;
}

function RecordsPage({ driverOnly = false }: { driverOnly?: boolean }) {
  const { data, loading, error } = useApiCall((token) => listAudit(token), []);
  const records = data ? groupAuditByEvent(data.entries).filter((g) => g.compliance) : [];
  const display = driverOnly ? records.slice(0, 1) : records;
  const [selected, setSelected] = useState<GroupedDecision | null>(null);

  return <ProductShell title={driverOnly ? "My records" : "Records"} subtitle="">
    <section className="product-content">
      {loading && <LoadingRow />}
      {error && <ErrorRow message={error} />}
      {!loading && !error && display.length === 0 && <p className="eyebrow">No compliance records yet.</p>}
      {display.length > 0 && <div className="artifact-register"><div className="artifact-register__head"><span>Record</span><span>Route</span><span>Action</span><span>PDF</span><span /></div>{display.map((g) => { const pdfUrl = resolvePdfUrl(g.compliance?.exported_pdf_url); return <article className="artifact-row" key={g.event_id}><span><ClipboardCheck size={16} /><strong>seq {g.seq}</strong></span><span>{g.route_id ?? "—"}</span><span>{g.compliance?.action ?? "—"}</span><span className={pdfUrl ? "artifact-state" : "artifact-state artifact-state--watch"}>{pdfUrl ? "Available" : "Not yet generated"}</span><button onClick={() => setSelected(g)}><PanelRightOpen size={15} /> Open</button></article>; })}</div>}
      {selected && <aside className="artifact-drawer"><div className="artifact-drawer__head"><div><h2>seq {selected.seq}</h2></div><button onClick={() => setSelected(null)}>Close</button></div><div className="artifact-drawer__body"><div><span>Route</span><strong>{selected.route_id ?? "—"}</strong></div><div><span>Action</span><strong>{selected.compliance?.action ?? "—"}</strong></div><div><span>Heat index</span><strong>{selected.compliance?.heat_index_c != null ? `${selected.compliance.heat_index_c.toFixed(1)}°C` : "—"}</strong></div>{resolvePdfUrl(selected.compliance?.exported_pdf_url) ? <a className="product-button" href={resolvePdfUrl(selected.compliance?.exported_pdf_url) ?? undefined} target="_blank" rel="noreferrer">Download PDF <ArrowRight size={15} /></a> : <p><span>PDF</span> Not yet generated for this record.</p>}</div></aside>}
    </section>
  </ProductShell>;
}

function ClaimsPage() {
  const { data, loading, error } = useApiCall((token) => listAudit(token), []);
  const claims = data ? groupAuditByEvent(data.entries).filter((g) => g.cargo?.claim_draft_id) : [];
  return <ProductShell title="Claims" subtitle="">
    <section className="product-content">
      {loading && <LoadingRow />}
      {error && <ErrorRow message={error} />}
      {!loading && !error && claims.length === 0 && <p className="eyebrow">No claim drafts yet.</p>}
      {claims.length > 0 && <div className="artifact-register"><div className="artifact-register__head"><span>Claim</span><span>Route</span><span>Exposure</span><span>PDF</span><span /></div>{claims.map((g) => <article className="artifact-row" key={g.event_id}><span><FileWarning size={16} /><strong>{g.cargo?.claim_draft_id}</strong></span><span>{g.route_id ?? "—"}</span><span>{g.cargo ? `${g.cargo.cumulative_exposure_score.toFixed(2)} / ${g.cargo.threshold} °C·h` : "—"}</span><span className="artifact-state artifact-state--watch">Not yet generated</span><span /></article>)}</div>}
      <p className="eyebrow" style={{ marginTop: "1rem" }}><FileClock size={14} /> Claim-draft PDFs are generated but not yet persisted with a durable, queryable link — see the wiring report for why.</p>
    </section>
  </ProductShell>;
}

export function ProductApp() {
  const { role, page } = useProductRoute();
  const params = useParams<{ id?: string }>();
  const routeId = params.id;

  if ((role === "dispatcher" || role === "admin") && page === "routes") return <RoutesPage role={role} />;
  if ((role === "dispatcher" || role === "admin" || role === "driver") && page === "detail" && routeId) return <RouteDetailPage role={role} routeId={routeId} />;
  if ((role === "dispatcher" || role === "admin") && page === "create") return <CreateRoutePage role={role} />;
  if ((role === "dispatcher" || role === "admin") && page === "activity") return <ActivityPage />;
  if (role === "admin" && page === "settings") return <SettingsPage />;
  if (role === "admin" && page === "members") return <MembersPage />;
  if (role === "driver" && page === "routes") return <RoutesPage role="driver" />;
  if (role === "driver" && page === "records") return <RecordsPage driverOnly />;
  if (role === "compliance" && page === "audit") return <AuditPage />;
  if (role === "compliance" && page === "records") return <RecordsPage />;
  if (role === "compliance" && page === "claims") return <ClaimsPage />;
  return <RoutesPage role="dispatcher" />;
}
