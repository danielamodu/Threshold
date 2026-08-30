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
import { ArrowRight, ArrowUpRight, ClipboardCheck, FileClock, FilePlus2, FileWarning, Link2, Link2Off, Mail, PanelRightOpen, Plus, ShieldCheck, SlidersHorizontal, UserCheck } from "lucide-react";
import { useParams } from "wouter";
import { ProductShell, useProductRoute } from "@/components/ProductShell";
import { useApiCall } from "@/hooks/useApiCall";
import { createDriver, createRoute, getRoute, inviteDriver, linkDriver, listAudit, listDrivers, listRoutes, resolvePdfUrl, type ApiDriver, type ApiRoute } from "@/lib/api";
import { claimEpisodes, groupAuditByEvent, type GroupedDecision } from "@/lib/auditGrouping";
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
  if (message.includes("404") || message.toLowerCase().includes("not found")) {
    return <div className="product-content"><p className="eyebrow">No active routes currently recorded in this workspace.</p></div>;
  }
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

/**
 * A driver's own routes are derived from their (already server-scoped) audit
 * feed, not from GET /api/routes — the signed-off permission matrix gives the
 * driver role `routes: read 'none'`, so calling that endpoint as a driver is a
 * 403 by design. Only the fields the feed genuinely carries are required here.
 */
type RouteRow = Pick<ApiRoute, "route_id" | "cargo_class" | "driver_id">;

function RoutesTable({ role, routes, statuses }: { role: string; routes: RouteRow[]; statuses: Map<string, GroupedDecision> }) {
  return <div className="route-table"><div className="route-table__head"><span>Route</span><span>Load</span><span>Driver</span><span>Current state</span><span>Last reading</span><span /></div>{routes.map((route) => { const latest = statuses.get(route.route_id); const status = statusFromRiskLevel(latest?.cargo?.risk_level); return <a className="route-table__row" href={`/app/${role}/detail/${encodeURIComponent(route.route_id)}`} key={route.route_id}><span><strong>{route.route_id}</strong><small>{route.cargo_class}</small></span><span>{route.cargo_class}</span><span>{route.driver_id}</span><span><StatusMark status={status} /></span><span><strong>{latest?.thermal ? `${latest.thermal.temp_c.toFixed(1)}°C` : "—"}</strong><small>{latest?.occurred_at ? new Date(latest.occurred_at).toLocaleString() : "no data yet"}</small></span><span><ArrowUpRight size={15} /></span></a>; })}</div>;
}

/**
 * A driver-role session whose Clerk user has no `drivers.clerk_user_id` row.
 * Deliberately distinct from "no records yet": this is an org_admin action
 * that hasn't happened, and saying "no records" would hide that.
 */
function DriverNotLinkedNotice() {
  return <div className="product-content">
    <p className="eyebrow"><Link2Off size={14} /> Your account is not linked to a driver record yet.</p>
    <p className="eyebrow">An organisation admin needs to link your user to a driver on the Drivers screen before your routes and records can be shown. Until then this stays empty — Threshold will not fall back to showing another driver's data.</p>
  </div>;
}

function RoutesPage({ role }: { role: "admin" | "dispatcher" }) {
  const { data, loading, error } = useApiCall((token) => listRoutes(token), []);
  const { latestByRoute } = useRouteStatuses();
  const routes = data?.routes ?? [];

  return <ProductShell title="Routes" subtitle="" actions={<><ButtonLink href={`/app/${role}/create`}><Plus size={15} /> Create route</ButtonLink><ButtonLink quiet href={`/app/${role}/activity`}><SlidersHorizontal size={15} /> Activity</ButtonLink></>}>
    <section className="product-content">
      <div className="product-stat-strip"><div><span>Total</span><strong>{String(routes.length).padStart(2, "0")}</strong></div><div><span>Breach</span><strong className="text-cargo">{String(Array.from(latestByRoute.values()).filter((g) => g.cargo?.risk_level === "breach").length).padStart(2, "0")}</strong></div><div><span>Watch</span><strong className="text-driver">{String(Array.from(latestByRoute.values()).filter((g) => g.cargo?.risk_level === "elevated").length).padStart(2, "0")}</strong></div></div>
      <div className="product-section-head"><div><h2>Active routes</h2></div></div>
      {loading && <LoadingRow />}
      {error && <ErrorRow message={error} />}
      {!loading && !error && routes.length === 0 && <p className="eyebrow">No routes yet in this organisation.</p>}
      {!loading && !error && routes.length > 0 && <RoutesTable role={role} routes={routes} statuses={latestByRoute} />}
    </section>
  </ProductShell>;
}

/**
 * The driver's own routes, reconstructed from the server-scoped audit feed —
 * one row per route_id that appears in it, newest reading first. Because
 * GET /api/audit already restricts a driver session to routes assigned to
 * their driver_id, there is nothing to filter client-side: whatever arrives
 * here is by definition theirs.
 */
function DriverRoutesPage() {
  const { data, loading, error } = useApiCall((token) => listAudit(token), []);
  const groups = data ? groupAuditByEvent(data.entries) : [];

  const latestByRoute = new Map<string, GroupedDecision>();
  for (const g of groups) {
    if (!g.route_id) continue;
    if (!latestByRoute.has(g.route_id)) latestByRoute.set(g.route_id, g);
  }
  const rows: RouteRow[] = Array.from(latestByRoute.entries()).map(([route_id, g]) => ({
    route_id,
    cargo_class: (g.cargo?.cargo_class ?? "—") as CargoClass,
    driver_id: g.compliance?.driver_id ?? data?.driver_id ?? "—",
  }));

  return <ProductShell title="My routes" subtitle="">
    <section className="product-content">
      {loading && <LoadingRow />}
      {error && <ErrorRow message={error} />}
      {!loading && !error && data?.driver_unlinked && <DriverNotLinkedNotice />}
      {!loading && !error && !data?.driver_unlinked && <>
        <div className="product-section-head"><div><h2>Assigned routes</h2></div></div>
        {rows.length === 0 && <p className="eyebrow">No recorded activity on your routes yet.</p>}
        {rows.length > 0 && <RoutesTable role="driver" routes={rows} statuses={latestByRoute} />}
      </>}
    </section>
  </ProductShell>;
}

function RouteDetailPage({ role, routeId }: { role: "admin" | "dispatcher" | "driver"; routeId: string }) {
  // The driver role has no `routes` read permission at all, so calling
  // GET /api/routes/:id as a driver is a guaranteed 403. Skip the request
  // entirely for them and take cargo/driver from the audit feed instead,
  // which they DO have scoped access to — previously this page showed a
  // permission error to every driver who opened it.
  const { data: route, loading: routeLoading, error: routeError } = useApiCall(
    (token) => (role === "driver" ? Promise.resolve(null) : getRoute(token, routeId)),
    [routeId, role],
  );
  const { data: auditData, loading: auditLoading, error: auditError } = useApiCall((token) => listAudit(token), []);
  const timeline = auditData ? groupAuditByEvent(auditData.entries).filter((g) => g.route_id === routeId) : [];
  const latest = timeline[0];
  const cargoClass = route?.cargo_class ?? latest?.cargo?.cargo_class ?? null;
  const driverId = route?.driver_id ?? latest?.compliance?.driver_id ?? null;

  return <ProductShell title={routeId} subtitle={cargoClass && driverId ? `${cargoClass} · ${driverId}` : ""} actions={<ButtonLink quiet href={`/app/${role}/routes`}>Routes</ButtonLink>}>
    <section className="product-content">
      {routeLoading && <LoadingRow />}
      {routeError && <ErrorRow message={routeError} />}
      {(cargoClass || driverId) && <div className="route-detail-meta"><div><span className="eyebrow">Status</span><StatusMark status={statusFromRiskLevel(latest?.cargo?.risk_level)} /></div><div><span className="eyebrow">Cargo</span><strong>{cargoClass ?? "—"}</strong></div><div><span className="eyebrow">Driver</span><strong>{driverId ?? "—"}</strong></div></div>}
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

/**
 * Driver identity administration — the screen that makes the Driver role work.
 * Clerk's OrganizationProfile (Members) invites the human and gives them the
 * `org:driver` role; this links that Clerk user to a `drivers` row, which is
 * what GET /api/audit resolves to scope their feed.
 *
 * The Clerk user id is typed in rather than picked from a dropdown: Clerk owns
 * the membership list, and reading it would need a server-side Clerk API call
 * this app doesn't have. The ids are visible in Clerk's own Members view.
 */
function DriversPage() {
  const { getToken } = useAuth();
  const { data, loading, error, reload } = useApiCall((token) => listDrivers(token), []);
  const [selected, setSelected] = useState<ApiDriver | null>(null);
  const [clerkUserId, setClerkUserId] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteStatus, setInviteStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [newDriverId, setNewDriverId] = useState("");
  const [newName, setNewName] = useState("");
  const [createStatus, setCreateStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [createError, setCreateError] = useState<string | null>(null);

  const drivers = data?.drivers ?? [];

  function open(driver: ApiDriver) {
    setSelected(driver);
    setClerkUserId(driver.clerk_user_id ?? "");
    setSaveError(null);
    setInviteEmail("");
    setInviteStatus("idle");
    setInviteError(null);
  }

  async function submitCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateStatus("saving");
    setCreateError(null);
    try {
      await createDriver(await getToken(), { driver_id: newDriverId, ...(newName ? { name: newName } : {}) });
      setCreateStatus("done");
      setNewDriverId("");
      setNewName("");
      reload();
    } catch (err) {
      setCreateStatus("error");
      setCreateError(err instanceof Error ? err.message : String(err));
    }
  }

  /** `null` unlinks — the undo for linking the wrong person. */
  async function save(value: string | null) {
    if (!selected) return;
    setSaving(true);
    setSaveError(null);
    try {
      await linkDriver(await getToken(), selected.driver_id, value);
      setSelected(null);
      reload();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function sendInvite() {
    if (!selected) return;
    setInviteStatus("saving");
    setInviteError(null);
    try {
      await inviteDriver(await getToken(), selected.driver_id, inviteEmail.trim());
      setInviteStatus("done");
      setInviteEmail("");
    } catch (err) {
      setInviteStatus("error");
      setInviteError(err instanceof Error ? err.message : String(err));
    }
  }

  return <ProductShell title="Drivers" subtitle="">
    <section className="product-content">
      {loading && <LoadingRow />}
      {error && <ErrorRow message={error} />}
      {!loading && !error && drivers.length === 0 && <p className="eyebrow">No drivers yet in this organisation.</p>}
      {drivers.length > 0 && <div className="artifact-register"><div className="artifact-register__head"><span>Driver</span><span>Name</span><span>Linked Clerk user</span><span>State</span><span /></div>{drivers.map((d) => <article className="artifact-row" key={d.id}><span><UserCheck size={16} /><strong>{d.driver_id}</strong></span><span>{d.name ?? "—"}</span><span>{d.clerk_user_id ?? "—"}</span><span className={d.clerk_user_id ? "artifact-state" : "artifact-state artifact-state--watch"}>{d.clerk_user_id ? "Linked" : "Not linked"}</span>{d.clerk_user_id ? <button onClick={() => open(d)}><Link2 size={15} /> Change</button> : <button onClick={() => open(d)}><Mail size={15} /> Invite</button>}</article>)}</div>}

      {selected && <aside className="artifact-drawer"><div className="artifact-drawer__head"><div><h2>{selected.driver_id}</h2></div><button onClick={() => setSelected(null)}>Close</button></div><div className="artifact-drawer__body">
        <div><span>Name</span><strong>{selected.name ?? "—"}</strong></div>
        <div><span>Currently linked</span><strong>{selected.clerk_user_id ?? "nobody"}</strong></div>
        {!selected.clerk_user_id && <div style={{ border: '1px solid var(--line-strong)', padding: '14px', margin: '14px 0', background: 'rgba(255,255,255,0.02)' }}>
          <h3 style={{ fontSize: 12, fontWeight: 600, margin: '0 0 6px', color: 'var(--paper)' }}>Invite driver</h3>
          <p style={{ fontSize: 11, color: 'var(--muted-foreground)', margin: '0 0 12px', lineHeight: 1.4 }}>Enter the driver's email — they'll receive an invitation as a driver and be auto-linked to <strong style={{ color: 'var(--paper)' }}>{selected.driver_id}</strong> when they accept. No ID to copy.</p>
          <label style={{ display: 'grid', gap: '6px', marginBottom: '10px' }}><span style={{ fontSize: 9, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted-foreground)' }}>Email</span><input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="driver@company.com" type="email" autoComplete="email" style={{ width: '100%', height: '42px', padding: '0 12px', border: '1px solid var(--line-strong)', background: '#0f0f0e', color: 'var(--paper)', fontSize: '13px', outline: 'none' }} /></label>
          <button type="button" className="product-button" style={{ width: '100%', marginTop: 4 }} disabled={inviteStatus === "saving"} onClick={() => void sendInvite()}><Mail size={15} /> {inviteStatus === "saving" ? "Inviting…" : "Send invite"}</button>
          {inviteStatus === "done" && <p className="form-confirmation" style={{ marginTop: '10px' }}><ShieldCheck size={15} /> Invitation sent — they'll be linked automatically when they accept.</p>}
          {inviteError && <p className="form-error" style={{ marginTop: '8px' }}>{inviteError}</p>}
          <div style={{ margin: '14px 0 0', textAlign: 'center', fontSize: 10, color: 'var(--muted-foreground)', letterSpacing: '.08em', textTransform: 'uppercase' }}>Or link manually</div>
        </div>}
        <label><span>Clerk user ID</span><input value={clerkUserId} onChange={(e) => setClerkUserId(e.target.value)} placeholder="user_2abc…" /></label>
        <button className="product-button" disabled={saving || clerkUserId.trim().length === 0} onClick={() => void save(clerkUserId.trim())}><Link2 size={15} /> {saving ? "Saving…" : "Link this user"}</button>
        {selected.clerk_user_id && <button className="product-button product-button--quiet" disabled={saving} onClick={() => void save(null)}><Link2Off size={15} /> Unlink</button>}
        {saveError && <p className="form-error">{saveError}</p>}
      </div></aside>}

      <div className="product-section-head"><div><h2>Add a driver</h2></div></div>
      <form className="route-create-form" onSubmit={submitCreate}>
        <div className="route-create-form__head"><h2>Driver details</h2></div>
        <div className="route-create-form__grid">
          <label><span>Driver ID</span><input value={newDriverId} onChange={(e) => setNewDriverId(e.target.value)} placeholder="driver-14" required /></label>
          <label><span>Name</span><input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="optional" /></label>
        </div>
        <button type="submit" className="product-button" disabled={createStatus === "saving"}><Plus size={16} /> {createStatus === "saving" ? "Creating…" : "Create driver"}</button>
        {createStatus === "done" && <p className="form-confirmation"><ShieldCheck size={15} /> Driver created. Link a Clerk user to it above.</p>}
        {createStatus === "error" && createError && <p className="form-error">{createError}</p>}
      </form>
    </section>
  </ProductShell>;
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
  // No client-side slicing for the driver view any more. It used to show
  // `records.slice(0, 1)` — an arbitrary one-record stand-in for scoping that
  // did not exist server-side. GET /api/audit now genuinely restricts a driver
  // session to their own driver_id, so the honest display is everything the
  // server chose to return.
  const display = data ? groupAuditByEvent(data.entries).filter((g) => g.compliance) : [];
  const [selected, setSelected] = useState<GroupedDecision | null>(null);
  const unlinked = driverOnly && data?.driver_unlinked === true;

  return <ProductShell title={driverOnly ? "My records" : "Records"} subtitle="">
    <section className="product-content">
      {loading && <LoadingRow />}
      {error && <ErrorRow message={error} />}
      {unlinked && <DriverNotLinkedNotice />}
      {!loading && !error && !unlinked && display.length === 0 && <p className="eyebrow">No compliance records yet.</p>}
      {!unlinked && display.length > 0 && <div className="artifact-register"><div className="artifact-register__head"><span>Record</span><span>Route</span><span>Action</span><span>PDF</span><span /></div>{display.map((g) => { const pdfUrl = resolvePdfUrl(g.compliance?.exported_pdf_url); return <article className="artifact-row" key={g.event_id}><span><ClipboardCheck size={16} /><strong>seq {g.seq}</strong></span><span>{g.route_id ?? "—"}</span><span>{g.compliance?.action ?? "—"}</span><span className={pdfUrl ? "artifact-state" : "artifact-state artifact-state--watch"}>{pdfUrl ? "Available" : "Not yet generated"}</span><button onClick={() => setSelected(g)}><PanelRightOpen size={15} /> Open</button></article>; })}</div>}
      {selected && <aside className="artifact-drawer"><div className="artifact-drawer__head"><div><h2>seq {selected.seq}</h2></div><button onClick={() => setSelected(null)}>Close</button></div><div className="artifact-drawer__body"><div><span>Route</span><strong>{selected.route_id ?? "—"}</strong></div><div><span>Action</span><strong>{selected.compliance?.action ?? "—"}</strong></div><div><span>Heat index</span><strong>{selected.compliance?.heat_index_c != null ? `${selected.compliance.heat_index_c.toFixed(1)}°C` : "—"}</strong></div>{resolvePdfUrl(selected.compliance?.exported_pdf_url) ? <a className="product-button" href={resolvePdfUrl(selected.compliance?.exported_pdf_url) ?? undefined} target="_blank" rel="noreferrer">Download PDF <ArrowRight size={15} /></a> : <p><span>PDF</span> Not yet generated for this record.</p>}</div></aside>}
    </section>
  </ProductShell>;
}

function ClaimsPage() {
  const { data, loading, error } = useApiCall((token) => listAudit(token), []);
  const claims = data ? claimEpisodes(groupAuditByEvent(data.entries)) : [];
  return <ProductShell title="Claims" subtitle="">
    <section className="product-content">
      {loading && <LoadingRow />}
      {error && <ErrorRow message={error} />}
      {!loading && !error && claims.length === 0 && <p className="eyebrow">No claim drafts yet.</p>}
      {claims.length > 0 && <div className="artifact-register"><div className="artifact-register__head"><span>Claim</span><span>Route</span><span>Exposure</span><span>PDF</span><span /></div>{claims.map((g) => { const pdfUrl = resolvePdfUrl(g.claim?.exported_pdf_url); return <article className="artifact-row" key={g.event_id}><span><FileWarning size={16} /><strong>{g.claim?.claim_draft_id ?? g.cargo?.claim_draft_id}</strong></span><span>{g.route_id ?? "—"}</span><span>{g.cargo ? `${g.cargo.cumulative_exposure_score.toFixed(2)} / ${g.cargo.threshold} °C·h` : "—"}</span><span className={pdfUrl ? "artifact-state" : "artifact-state artifact-state--watch"}>{pdfUrl ? "Available" : "Not yet generated"}</span>{pdfUrl ? <a className="product-button" href={pdfUrl} target="_blank" rel="noreferrer">Download PDF <ArrowRight size={15} /></a> : <span />}</article>; })}</div>}
      {claims.some((g) => !g.claim) && <p className="eyebrow" style={{ marginTop: "1rem" }}><FileClock size={14} /> Claims with no PDF link were recorded before claim drafts were persisted to the audit log — those drafts existed only for the duration of the pipeline run that produced them.</p>}
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
  if (role === "admin" && page === "drivers") return <DriversPage />;
  if (role === "driver" && page === "routes") return <DriverRoutesPage />;
  if (role === "driver" && page === "records") return <RecordsPage driverOnly />;
  if (role === "compliance" && page === "audit") return <AuditPage />;
  if (role === "compliance" && page === "records") return <RecordsPage />;
  if (role === "compliance" && page === "claims") return <ClaimsPage />;
  return <RoutesPage role="dispatcher" />;
}
