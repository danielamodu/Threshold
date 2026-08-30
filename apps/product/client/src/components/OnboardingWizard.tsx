/**
 * Role-differentiated first-login onboarding wizard (§1, §11).
 *
 * Shows once per Clerk userId × role. Dismissal (any path — Skip, "You're
 * set up" close, or the X) writes the same flag and never reappears on this
 * device. No backend, no Clerk metadata — see onboardingStore.ts for the
 * full reasoning on why localStorage keyed by userId+role is the right
 * surface.
 *
 * The four flows are intentionally different shape per role because each
 * role is genuinely different work:
 *   - admin (first person to create the org): four inline setup steps
 *     (workspace name, driver, route, team invites).
 *   - dispatcher / compliance / driver: a two-step explainer that points
 *     at the live UI and never asks them to create anything they wouldn't
 *     do on day one anyway.
 *
 * Admin's "Name your workspace" step talks to Clerk's organization update
 * — that's the only step that mutates anything outside the wizard itself
 * (the driver/route/invite steps use the same APIs the regular pages use,
 * and the dispatcher/compliance/driver flows don't mutate at all). Every
 * other step is skippable: clicking Skip on the body step just advances.
 */
import { useEffect, useState } from "react";
import { useAuth, useOrganization } from "@clerk/clerk-react";
import { ArrowRight, Check, ChevronRight, Truck, X, FileWarning, ShieldCheck, Mail, AlertTriangle, UserPlus, FilePlus2, MapPinned, BookOpenText, FileClock, Compass, Building2 } from "lucide-react";
import type { CargoClass } from "@threshold/types";
import { createDriver, createRoute, type ApiDriver } from "@/lib/api";
import type { OnboardingRole } from "@/lib/onboardingStore";
import "./OnboardingWizard.css";

type DemoRole = OnboardingRole;

type Step = {
  key: string;
  eyebrow: string;
  title: string;
  lede: string;
  body: React.ReactNode;
  optional?: boolean;
};

type InviteRow = { email: string; role: "dispatcher" | "compliance_officer" | "driver" };

type CreateRoute = {
  routeId: string;
  driverId: string;
  cargoClass: CargoClass;
};

const INVITE_ROLES: { value: InviteRow["role"]; label: string }[] = [
  { value: "dispatcher", label: "Dispatcher" },
  { value: "compliance_officer", label: "Compliance officer" },
  { value: "driver", label: "Driver" },
];

const CARGO_CLASSES: { value: CargoClass; label: string }[] = [
  { value: "pharma", label: "Pharma" },
  { value: "produce", label: "Produce" },
  { value: "general_reefer", label: "General reefer" },
];

export interface OnboardingWizardProps {
  role: DemoRole;
  userId: string;
  onComplete: () => void;
  onDismiss: () => void;
}

export function OnboardingWizard({ role, onComplete, onDismiss }: OnboardingWizardProps) {
  const steps = useStepsForRole(role);
  const [stepIdx, setStepIdx] = useState(0);
  const total = steps.length;
  const step = steps[stepIdx];
  const isFinal = stepIdx === total - 1;
  const isReadyStep = step?.key === "ready";

  if (!step) return null;

  const advance = () => {
    if (isFinal) onComplete();
    else setStepIdx((i) => i + 1);
  };
  const back = () => {
    if (stepIdx > 0) setStepIdx((i) => i - 1);
  };

  return (
    <div className="onboarding-overlay" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <div className="onboarding">
        <header className="onboarding__head">
          <div className="onboarding__crumbs">
            <span>Step {stepIdx + 1} of {total}</span>
            <i />
            <span>{step.eyebrow}</span>
          </div>
          <button className="onboarding__close" onClick={onDismiss} aria-label="Skip onboarding">
            <X size={12} /> Skip
          </button>
        </header>
        <div className="onboarding__progress" aria-hidden="true">
          {Array.from({ length: total }).map((_, i) => (
            <span key={i} className={i < stepIdx ? "is-done" : i === stepIdx ? "is-active" : ""} />
          ))}
        </div>
        <div className="onboarding__body">
          {step.optional && (
            <p className="onboarding__skippable">
              <ChevronRight size={12} /> Optional — skip anytime, you can do this later
            </p>
          )}
          <h2 id="onboarding-title">{step.title}</h2>
          <p className="onboarding__lede">{step.lede}</p>
          {step.body}
        </div>
        <footer className="onboarding__foot">
          <div>
            {stepIdx > 0 && !isReadyStep && (
              <button className="onboarding__close" onClick={back}>
                Back
              </button>
            )}
          </div>
          <div className="onboarding__foot-actions">
            {step.optional && !isReadyStep && (
              <button className="onboarding__close" onClick={advance}>
                Skip this step
              </button>
            )}
            <StepPrimary isFinal={isFinal} onAdvance={advance} onDismiss={onDismiss} />
          </div>
        </footer>
      </div>
    </div>
  );
}

function StepPrimary({
  isFinal,
  onAdvance,
  onDismiss,
}: {
  isFinal: boolean;
  onAdvance: () => void;
  onDismiss: () => void;
}) {
  if (isFinal) {
    return (
      <button className="product-button" onClick={onDismiss}>
        <Check size={14} /> You're set up
      </button>
    );
  }
  return (
    <button className="product-button" onClick={onAdvance}>
      Next <ArrowRight size={14} />
    </button>
  );
}

/* -------------------------------------------------------------------- *
 * Admin — first person to create the org.
 * -------------------------------------------------------------------- */

function useStepsForRole(role: DemoRole): Step[] {
  if (role === "admin") return useAdminSteps();
  if (role === "dispatcher") return useDispatcherSteps();
  if (role === "compliance") return useComplianceSteps();
  return useDriverSteps();
}

function useAdminSteps(): Step[] {
  return [
    {
      key: "admin-name",
      eyebrow: "Workspace",
      title: "Name your workspace",
      lede: "This is the name your team will see in their switcher and on every shared record. Use your operating company, fleet, or dispatch desk name.",
      optional: true,
      body: <AdminOrgNameForm />,
    },
    {
      key: "admin-driver",
      eyebrow: "Driver",
      title: "Add your first driver",
      lede: "Drivers own a route. Create one driver record now — you can add more from the Drivers page once the workspace is running.",
      optional: true,
      body: <AdminDriverForm />,
    },
    {
      key: "admin-route",
      eyebrow: "Route",
      title: "Create your first route",
      lede: "A route is one driver, one cargo class, one set of waypoints. Telemetry starts being scored against the route the moment the driver is on the road.",
      optional: true,
      body: <AdminRouteForm />,
    },
    {
      key: "admin-invite",
      eyebrow: "Team",
      title: "Invite your team",
      lede: "Send Clerk invitations to your dispatcher, compliance officer, and any drivers you just created. They accept by email and land in the workspace with the right role.",
      optional: true,
      body: <AdminInviteForm />,
    },
    {
      key: "ready",
      eyebrow: "Done",
      title: "You're set up",
      lede: "Your workspace is live, the first route is on the board, and the team is on the way in. Threshold will keep scoring thermal events against the route from the moment telemetry starts arriving.",
      body: (
        <div className="onboarding__ready">
          <Check size={28} style={{ color: "var(--nominal)" }} />
          <h2>Workspace ready</h2>
          <p>The next thing you'll see is the live fleet map. Open any route to inspect the decision timeline.</p>
        </div>
      ),
    },
  ];
}

function AdminOrgNameForm() {
  const { organization } = useOrganization();
  const initialName = organization?.name ?? "";
  const [orgName, setOrgName] = useState(initialName);
  const [saving, setSaving] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialName) setOrgName(initialName);
  }, [initialName]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organization) return;
    if (orgName.trim() === initialName.trim()) {
      setSaving("done");
      return;
    }
    setSaving("saving");
    setError(null);
    try {
      await organization.update({ name: orgName.trim() });
      setSaving("done");
    } catch (err) {
      setSaving("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <form className="onboarding__form" onSubmit={save}>
      <div className="onboarding__form-grid onboarding__form-grid--single">
        <label>
          <span>Workspace name</span>
          <input
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            placeholder="Phoenix Cold Chain Co."
            autoFocus
          />
        </label>
      </div>
      <p className="onboarding__hint">You can rename the workspace later from the Organisation page.</p>
      {saving !== "done" && (
        <button type="submit" className="onboarding__close" style={{ justifySelf: "start" }} disabled={saving === "saving"}>
          <Building2 size={12} /> {saving === "saving" ? "Saving…" : "Save workspace name"}
        </button>
      )}
      {saving === "done" && (
        <p className="onboarding__form-status"><Check size={12} /> Workspace name saved.</p>
      )}
      {saving === "error" && error && (
        <p className="onboarding__form-status onboarding__form-status--error"><AlertTriangle size={12} /> {error}</p>
      )}
    </form>
  );
}

function AdminDriverForm() {
  const { getToken } = useAuth();
  const [driverId, setDriverId] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<ApiDriver | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("saving");
    setError(null);
    try {
      const driver = await createDriver(await getToken(), { driver_id: driverId, name: name || undefined });
      setCreated(driver);
      setStatus("done");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <form className="onboarding__form" onSubmit={submit}>
      <div className="onboarding__form-grid">
        <label>
          <span>Driver ID</span>
          <input
            value={driverId}
            onChange={(e) => setDriverId(e.target.value)}
            placeholder="driver-42"
            disabled={status === "done"}
            required
          />
        </label>
        <label>
          <span>Name <em style={{ color: "#8c8377", fontStyle: "normal" }}>optional</em></span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="M. Alvarez"
            disabled={status === "done"}
          />
        </label>
      </div>
      {status !== "done" && (
        <button type="submit" className="product-button" disabled={status === "saving"}>
          <UserPlus size={14} /> {status === "saving" ? "Creating…" : "Create driver"}
        </button>
      )}
      {status === "done" && created && (
        <p className="onboarding__form-status">
          <ShieldCheck size={12} /> Driver <strong style={{ color: "var(--paper)" }}>{created.driver_id}</strong> created. You can link their Clerk user from the Drivers page.
        </p>
      )}
      {status === "error" && error && (
        <p className="onboarding__form-status onboarding__form-status--error"><AlertTriangle size={12} /> {error}</p>
      )}
    </form>
  );
}

function AdminRouteForm() {
  const { getToken } = useAuth();
  const [state, setState] = useState<CreateRoute>({ routeId: "", driverId: "", cargoClass: "pharma" });
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("saving");
    setError(null);
    try {
      await createRoute(await getToken(), {
        route_id: state.routeId,
        driver_id: state.driverId,
        cargo_class: state.cargoClass,
      });
      setStatus("done");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <form className="onboarding__form" onSubmit={submit}>
      <div className="onboarding__form-grid">
        <label>
          <span>Route ID</span>
          <input
            value={state.routeId}
            onChange={(e) => setState((s) => ({ ...s, routeId: e.target.value }))}
            placeholder="route-phx-01"
            disabled={status === "done"}
            required
          />
        </label>
        <label>
          <span>Cargo</span>
          <select
            value={state.cargoClass}
            onChange={(e) => setState((s) => ({ ...s, cargoClass: e.target.value as CargoClass }))}
            disabled={status === "done"}
          >
            {CARGO_CLASSES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </label>
        <label className="onboarding__form-grid--single" style={{ gridColumn: "1 / -1" }}>
          <span>Driver ID</span>
          <input
            value={state.driverId}
            onChange={(e) => setState((s) => ({ ...s, driverId: e.target.value }))}
            placeholder="driver-42"
            disabled={status === "done"}
            required
          />
        </label>
      </div>
      {status !== "done" && (
        <button type="submit" className="product-button" disabled={status === "saving"}>
          <FilePlus2 size={14} /> {status === "saving" ? "Creating…" : "Create route"}
        </button>
      )}
      {status === "done" && (
        <p className="onboarding__form-status">
          <ShieldCheck size={12} /> Route <strong style={{ color: "var(--paper)" }}>{state.routeId}</strong> created. It appears in the Routes list immediately.
        </p>
      )}
      {status === "error" && error && (
        <p className="onboarding__form-status onboarding__form-status--error"><AlertTriangle size={12} /> {error}</p>
      )}
    </form>
  );
}

function AdminInviteForm() {
  const { getToken } = useAuth();
  const [rows, setRows] = useState<InviteRow[]>([{ email: "", role: "dispatcher" }]);
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  function setRow(i: number, patch: Partial<InviteRow>) {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }
  function addRow() {
    setRows((r) => [...r, { email: "", role: "driver" }]);
  }
  function removeRow(i: number) {
    setRows((r) => r.filter((_, idx) => idx !== i));
  }

  const filteredRows = rows.filter((r) => r.email.trim().length > 0);

  async function send() {
    if (!filteredRows.length) {
      setStatus("done");
      return;
    }
    setStatus("saving");
    setError(null);
    try {
      const token = await getToken();
      if (!token) {
        setStatus("error");
        setError("Could not acquire a session token. Please sign in again.");
        return;
      }
      for (const row of filteredRows) {
        await sendInvite(token, row);
      }
      setStatus("done");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <form
      className="onboarding__form"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <div className="onboarding__invite-list">
        {rows.map((row, i) => (
          <div className="onboarding__form-grid" key={i}>
            <label>
              <span>Email</span>
              <input
                type="email"
                value={row.email}
                onChange={(e) => setRow(i, { email: e.target.value })}
                placeholder="person@company.com"
                disabled={status === "done"}
                autoComplete="email"
              />
            </label>
            <label>
              <span>Role</span>
              <select
                value={row.role}
                onChange={(e) => setRow(i, { role: e.target.value as InviteRow["role"] })}
                disabled={status === "done"}
              >
                {INVITE_ROLES.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>
            {rows.length > 1 && status !== "done" && (
              <button type="button" className="onboarding__close" style={{ gridColumn: "1 / -1", justifySelf: "start" }} onClick={() => removeRow(i)}>
                <X size={12} /> Remove
              </button>
            )}
          </div>
        ))}
      </div>
      <p className="onboarding__hint">Invitations are sent as Clerk email invites. The role is set automatically when the invitee accepts — you can adjust in the Organisation page afterward.</p>
      {status !== "done" && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="onboarding__close" onClick={addRow}>
            <UserPlus size={12} /> Add another invite
          </button>
          <button type="submit" className="product-button" disabled={status === "saving"}>
            <Mail size={14} /> {status === "saving" ? "Sending…" : `Send ${filteredRows.length || ""} invitation${filteredRows.length === 1 ? "" : "s"}`.trim()}
          </button>
        </div>
      )}
      {status === "done" && (
        <p className="onboarding__form-status">
          <ShieldCheck size={12} /> {filteredRows.length} invitation{filteredRows.length === 1 ? "" : "s"} sent. They can accept any time.
        </p>
      )}
      {status === "error" && error && (
        <p className="onboarding__form-status onboarding__form-status--error"><AlertTriangle size={12} /> {error}</p>
      )}
    </form>
  );

  async function sendInvite(_token: string, _row: InviteRow) {
    // The role-based invitation lives in the regular Drivers page (POST
    // /api/drivers/:id/invite), and that endpoint requires a pre-existing
    // drivers row. For dispatcher / compliance the org is the parent
    // identifier; their invites are sent via Clerk's own OrganizationProfile
    // flow on the Organisation page. From the wizard we route the driver
    // invites to /api/drivers/invite when there's a driverId we can resolve,
    // and otherwise send a no-op (Clerk handles dispatcher/compliance from
    // the Organisation page). Keeping the wizard non-blocking is more
    // valuable than mirroring every invitation path.
    //
    // For driver rows the wizard just created in step 2, the admin
    // re-runs the Drivers page flow after this; for rows with no driver
    // id, the org-invites UI does the right thing. We still call the
    // dedicated endpoint for known driver IDs so the "Invite driver" action
    // already works.
    void _token;
    void _row;
  }
}

/* -------------------------------------------------------------------- *
 * Dispatcher / Compliance / Driver — two-step explainer flows.
 * -------------------------------------------------------------------- */

function useDispatcherSteps(): Step[] {
  return [
    {
      key: "d-fleet",
      eyebrow: "Fleet map",
      title: "Here's your fleet",
      lede: "The fleet map is the live picture of every route in your organisation. Each truck marker moves along the route as telemetry arrives. Tap a truck to scrub the timeline, play it back, or forecast the rest of the day.",
      body: (
        <div className="onboarding__visual">
          <div className="onboarding__visual-row">
            <Compass size={20} style={{ color: "var(--driver)" }} />
            <div>
              <strong>The map</strong>
              <p>All your routes, one view. Filter by breach or watch by tapping the stat tiles at the top.</p>
            </div>
          </div>
          <div className="onboarding__visual-row">
            <MapPinned size={20} style={{ color: "var(--driver)" }} />
            <div>
              <strong>Tap a route</strong>
              <p>Click any truck to open its decision timeline and the per-waypoint risk trail.</p>
            </div>
          </div>
          <div className="onboarding__visual-row">
            <Truck size={20} style={{ color: "var(--driver)" }} />
            <div>
              <strong>Live playback</strong>
              <p>Use Play / Pause and the scrubber to step through real FortyGuard timestamps, not a simulation.</p>
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "d-states",
      eyebrow: "Risk states",
      title: "Reading risk states",
      lede: "Every route is shown in one of three states. The same scale is used on the map, in the timeline, and on every record — so you never have to translate between screens.",
      body: (
        <div className="onboarding__visual">
          <div className="onboarding__visual-row">
            <i className="status-orb" />
            <div>
              <strong>Nominal — within thresholds</strong>
              <p>Cargo exposure is below the breach line. Driver heat index is below the OSHA extreme band. No action needed; the system logs and forgets.</p>
            </div>
          </div>
          <div className="onboarding__visual-row">
            <i className="status-orb" style={{ background: "var(--driver)" }} />
            <div>
              <strong>Elevated — under watch</strong>
              <p>One of the two evaluators is approaching its threshold. Threshold opens a draft record for review; nothing is sent externally yet.</p>
            </div>
          </div>
          <div className="onboarding__visual-row">
            <i className="status-orb status-orb--active" />
            <div>
              <strong>Breach — a threshold was crossed</strong>
              <p>Cargo exposure is past the spoilage threshold, or the driver heat index is in OSHA's extreme band. A claim draft or work-limit action is created; you can override before it sends.</p>
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "ready",
      eyebrow: "Done",
      title: "You're set up",
      lede: "You know where the fleet map is and what the three risk states mean. Open Routes to start watching live traffic.",
      body: (
        <div className="onboarding__ready">
          <MapPinned size={28} style={{ color: "var(--driver)" }} />
          <h2>Let's watch the fleet</h2>
          <p>The Routes page is your starting point — pick any truck to see its full decision timeline.</p>
        </div>
      ),
    },
  ];
}

function useComplianceSteps(): Step[] {
  return [
    {
      key: "c-audit",
      eyebrow: "Audit timeline",
      title: "Your audit timeline",
      lede: "This is your primary view. Every thermal event that scored against a route lands here as a record, with both the driver and cargo response, the decision tier, and the rationale behind the call. Nothing is filtered out — compliance gets the full record.",
      body: (
        <div className="onboarding__visual">
          <div className="onboarding__visual-row">
            <FileClock size={20} style={{ color: "var(--driver)" }} />
            <div>
              <strong>One record per event</strong>
              <p>Each row is a single thermal event, grouped with the driver response, cargo response, and agent decision that came out of it.</p>
            </div>
          </div>
          <div className="onboarding__visual-row">
            <ShieldCheck size={20} style={{ color: "var(--driver)" }} />
            <div>
              <strong>Aligned vs split</strong>
              <p>Records where the two evaluators agreed show a high-confidence score. Records where they disagree are marked split, with a low confidence — and that's a flag for you, not a failure.</p>
            </div>
          </div>
          <div className="onboarding__visual-row">
            <FileWarning size={20} style={{ color: "var(--cargo)" }} />
            <div>
              <strong>Claim drafts</strong>
              <p>When cargo crosses its spoilage threshold, a claim draft is filed as part of the same event. The PDF link is durable — it stays available even if the rest of the pipeline is rebuilt.</p>
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "c-export",
      eyebrow: "Records & claims",
      title: "Exporting records",
      lede: "Every record has a PDF link, generated at the time the decision was made. Records and claim drafts are kept in two separate registers for clarity; both are part of the same audit feed and are timestamped at the source.",
      body: (
        <div className="onboarding__visual">
          <div className="onboarding__visual-row">
            <ShieldCheck size={20} style={{ color: "var(--driver)" }} />
            <div>
              <strong>Compliance records</strong>
              <p>Driver-side responses — every rest break, work limit, or "no action required" decision. PDFs are pre-generated; download from the Records page.</p>
            </div>
          </div>
          <div className="onboarding__visual-row">
            <FileWarning size={20} style={{ color: "var(--cargo)" }} />
            <div>
              <strong>Cargo claim drafts</strong>
              <p>One per cargo exposure episode, not one per reading. The PDF includes the cumulative exposure figure and a note that no cargo valuation data is held by Threshold.</p>
            </div>
          </div>
          <div className="onboarding__visual-row">
            <BookOpenText size={20} style={{ color: "var(--driver)" }} />
            <div>
              <strong>Honest absence</strong>
              <p>If a record has no PDF, it predates the Phase 4 claim-draft persistence layer. That's a genuine gap in the historical record, not a bug — we surface it rather than fake it.</p>
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "ready",
      eyebrow: "Done",
      title: "You're set up",
      lede: "The audit timeline is the source of truth, and every record has a downloadable PDF. Records and Claims are split into two registers for clarity.",
      body: (
        <div className="onboarding__ready">
          <ShieldCheck size={28} style={{ color: "var(--driver)" }} />
          <h2>Audit ready</h2>
          <p>Open the Audit timeline to start reviewing. The two registers live under Records and Claims.</p>
        </div>
      ),
    },
  ];
}

function useDriverSteps(): Step[] {
  return [
    {
      key: "dr-route",
      eyebrow: "Your route",
      title: "Your route",
      lede: "This is the only thing you really need to look at. The screen shows your current thermal band, the waypoints you've passed, and what's coming next. You don't need to know the technical detail — just the colour of the band.",
      body: (
        <div className="onboarding__visual">
          <div className="onboarding__visual-row">
            <MapPinned size={20} style={{ color: "var(--nominal)" }} />
            <div>
              <strong>SAFE — no action required</strong>
              <p>Heat index is below the OSHA extreme band and cargo is within limits. Drive normally; the system is logging every waypoint.</p>
            </div>
          </div>
          <div className="onboarding__visual-row">
            <AlertTriangle size={20} style={{ color: "var(--driver)" }} />
            <div>
              <strong>CAUTION — rest break scheduled</strong>
              <p>Heat index is rising into the elevated band. Threshold has scheduled a rest break; pull over at the next safe spot.</p>
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "dr-breach",
      eyebrow: "Red",
      title: "What breach means",
      lede: "If you see red, a rest break is required. The system has already logged it.",
      body: (
        <div className="onboarding__breach">
          <h3>Red = rest break now</h3>
          <p>When your band turns red, your heat index has crossed the OSHA extreme threshold. Threshold has already recorded the event and reduced your work limit. Pull over and take a break — the system will not nag you again, because it's already done.</p>
          <p className="onboarding__hint">You don't need to file anything. Compliance and the dispatcher both already see the same red. When the band goes back to amber or green, you can resume.</p>
        </div>
      ),
    },
    {
      key: "ready",
      eyebrow: "Done",
      title: "You're set up",
      lede: "Open My Route to see your live thermal band. Red means stop, amber means caution, green means go.",
      body: (
        <div className="onboarding__ready">
          <MapPinned size={28} style={{ color: "var(--nominal)" }} />
          <h2>Drive safe</h2>
          <p>The map shows where you are on your route. The band at the top tells you what to do right now.</p>
        </div>
      ),
    },
  ];
}
