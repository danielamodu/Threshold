# Threshold — Thermal Liability Engine: System Architecture & Design
**FortyGuard Hackathon'26 build spec — codename locked: Threshold**

---

## 1. Core Insight (keep this on the first demo slide)

Every temperature-controlled freight route has two liability surfaces exposed to the
*same* heat event: the **driver** (heat illness, OSHA) and the **cargo** (spoilage,
pharma cold-chain). Today these are two disconnected tools solved by two disconnected
teams. One heat spike, one route — both risks fire at once. This system resolves both
from a single FortyGuard-fed event, in one pass.

---

## 2. System Architecture

*(diagram rendered above — six layers, described below)*

### Ingestion Layer
- **FortyGuard Temperature API client** — pulls per-waypoint temperature + forecast
  along a route, not a single point. Poll on a schedule for demo; webhook-subscribe
  model for the plug-and-play production story.
  **Verified against their docs (see §9): the API is an async submit-then-poll job
  (POST polygon/coordinate AOI + date_time → `activity_id`, then poll for result),
  not an instant synchronous lookup.** Design the ingestion client to pre-fetch/batch
  waypoints ahead of the truck's arrival at each point, not call-and-wait live —
  build a small queue/poller around the client rather than treating it as a plain
  REST GET.
- **Telemetry feed** — GPS/ELD-style route + cargo-class + driver-assignment stream.
  Simulated for the demo (deterministic script you control), built behind an adapter
  interface so a real TMS (Samsara/Motive-shaped payload) could plug in without a
  rewrite. This adapter *is* the "not siloed" argument — say so explicitly in the demo.

### Risk Engine Core
- **Event Bus** — normalizes ingestion into one canonical `ThermalExposureEvent`
  (schema below). Everything downstream subscribes to this, not to raw feeds.
- **Human Compliance Evaluator** — NWS heat-index formula against OSHA thresholds,
  generates work/rest schedule, flags threshold breaches.
- **Cargo Risk Evaluator** — cumulative exposure score against a per-cargo-class
  spoilage curve (pharma / produce / general reefer configs), flags breach + severity.

Both evaluators consume the *same* event. This is the architectural expression of the
core insight — don't let an implementer accidentally fork the pipeline.

### Agent Decision Layer
- Orchestrator agent reads both evaluator outputs, decides action tier by confidence:
  **alert-only → draft (human reviews) → auto-execute**. Every decision writes a
  rationale string to the audit log — this is what makes the output defensible as
  actual liability documentation, not just a notification.
- This is your Agentic AI track and NVIDIA/GCP sponsor-fit lever. If you're tight on
  time, this layer degrades gracefully to hard-coded thresholds without breaking the
  rest of the system — build it last, cut it first if you have to.

### Output / Integration Layer
- **Compliance Record** — timestamped, exportable (PDF), audit-grade. This is the
  actual product for the human-side module.
- **Claim Draft Generator** — structured claim payload for the cargo side.
- **Reroute Recommendation** — advisory output, doesn't require a real routing
  provider integration for the demo (mock is fine, say so plainly if asked).
- **Webhook Emitter** — the plug-and-play surface. A fleet's existing TMS calls this
  or subscribes to it; you are not asking anyone to adopt a new siloed app.

### Audit Layer
- Append-only Postgres log of every event, evaluation, and agent decision. Non-
  negotiable for a liability product — "we can show exactly why this fired" is the
  whole credibility argument to a judge from the Insurance/Governance track.

### Judge-Facing Dashboard
- Live route map, a **heat-spike injector** button (this is your demo's entire
  interaction model — one click, watch both modules resolve), and an event timeline
  showing the fork: one event → two liability responses, timestamped side by side.

---

## 3. Data Contracts

```json
// WaypointTelemetry — ingestion
{
  "route_id": "string",
  "waypoint_id": "string",
  "lat": 0.0, "lng": 0.0,
  "timestamp": "ISO8601",
  "forecasted_temp_c": 0.0,
  "humidity_pct": 0.0,
  "cargo_class": "pharma | produce | general_reefer",
  "driver_id": "string"
}

// ThermalExposureEvent — canonical event on the bus
{
  "event_id": "uuid",
  "route_id": "string",
  "waypoint_id": "string",
  "temp_c": 0.0,
  "heat_index_c": 0.0,
  "humidity_pct": 0.0,
  "timestamp": "ISO8601",
  "source": "fortyguard_api"
}

// ComplianceRecord — human module output
{
  "record_id": "uuid",
  "driver_id": "string",
  "event_id": "uuid",
  "heat_index_c": 0.0,
  "action": "rest_break_scheduled | work_limit_reduced | none",
  "schedule": [ { "start": "ISO8601", "end": "ISO8601", "type": "rest | reduced_load" } ],
  "generated_at": "ISO8601",
  "exported_pdf_url": "string | null"
}

// CargoRiskAssessment — cargo module output
{
  "assessment_id": "uuid",
  "cargo_class": "pharma | produce | general_reefer",
  "event_id": "uuid",
  "cumulative_exposure_score": 0.0,
  "threshold": 0.0,
  "risk_level": "nominal | elevated | breach",
  "recommended_action": "none | reroute | claim_draft",
  "claim_draft_id": "uuid | null",
  "reroute_suggestion": "object | null"
}

// AgentDecision — decision layer output, drives audit trail
{
  "decision_id": "uuid",
  "event_id": "uuid",
  "inputs": { "compliance_record_id": "uuid", "cargo_assessment_id": "uuid" },
  "confidence": 0.0,
  "action_tier": "alert | draft | auto_execute",
  "rationale": "string",
  "timestamp": "ISO8601"
}
```

---

## 4. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js + Mapbox/Leaflet | Fast to ship, live map is the demo's visual anchor |
| Backend | Node/TS, Fastify | Matches your usual stack, fast iteration with your orchestrator model |
| Event bus | In-process emitter for demo scale; note upgrade path to Redis pub/sub in the README (shows you understand production scale without over-building it) |
| DB | Postgres (Supabase) | Append-only audit table is the whole compliance story |
| PDF export | pdf-lib | Compliance record + claim draft rendering |
| Agent layer | Claude or Gemini API, function-calling into evaluator outputs | Sponsor-fit lever if GCP/NVIDIA judges are in the room |
| Deploy | Vercel (frontend) + EC2/PM2 (backend, your usual pattern) | Consistent with Hedge/Relay/Nox-Safe deploys |

---

## 5. UI/UX note

Default amber.dark is flagged in your design system as disliked despite being stored
default — **do not apply it here.** For a thermal-liability product, the palette
should carry the temperature metaphor without going climate-cliché-green: a cool
slate/indigo base (not pure black) with a genuine temperature gradient as the
functional accent — blue at nominal, amber-adjacent only at elevated, red at breach —
used *diagnostically* (as the risk-state indicator itself) rather than as a decorative
brand accent. That's a meaningful distinction to hold onto: color communicates risk
state, not house style. Confirm direction before the dashboard build starts.

---

## 6. Build Phases (gated, not just a calendar)

Each phase has an exit condition. You don't move to the next phase until the current
one actually passes it — that's what keeps this from becoming "ran out of days,
shipped whatever existed."

### Phase 0 — Foundation & Verification (Day 1)
- Get FortyGuard API trial key, make a real call, capture the real response shape
- Confirm auth flow, rate limits, and the submit/poll job cycle in practice (not
  just from docs)
- Lock the data contracts in §3 against the real payload — adjust field names now,
  not on Day 9
- Repo scaffolded, deploy skeleton up (Vercel + EC2 stub), CI running
- **Exit condition:** a real FortyGuard API call returns real temperature data
  through your client, end to end. No simulation involved yet — this has to be real.

### Phase 1 — Ingestion + Simulation Harness (Days 2–3)
- Build the async submit/poll client around FortyGuard's job model (§8)
- Build the route/telemetry simulator — deterministic script: waypoints, cargo
  class, driver assignment, timestamps you control for the demo
- Wire both into the event bus, emitting real `ThermalExposureEvent`s
- **Exit condition:** you can run a simulated route and watch real FortyGuard data
  become correctly-shaped events, logged, in order, with no manual intervention.

### Phase 2 — Risk Engine Core (Days 4–6)
- Human Compliance Evaluator: heat-index formula, OSHA thresholds, work/rest
  schedule generation
- Cargo Risk Evaluator: per-class spoilage curves, cumulative exposure scoring
- Unit tests against synthetic heat-spike events — both evaluators, known inputs,
  known expected outputs
- **Exit condition:** feed a synthetic breach event in, both evaluators independently
  produce correct, audit-logged outputs. This is the load-bearing phase — don't
  compress it to protect a later phase.

### Phase 3 — Agent Decision Layer (Days 7–8)
- Orchestrator agent consuming both evaluator outputs
- Confidence-gated action tiers (alert / draft / auto-execute) + rationale logging
- Build the hard-coded-threshold fallback path now, not as a last-minute rescue —
  if this phase slips, you degrade to the fallback and move on, you don't eat into
  Phase 4/5 time trying to save it
- **Exit condition:** a breach event produces a logged decision with a rationale
  string a human could read and understand without you explaining it.

### Phase 4 — Output / Integration Layer (Days 9–10)
- Compliance PDF export
- Claim draft generator
- Reroute recommendation (mocked is fine)
- Webhook emitter
- **Exit condition:** one single heat-spike event produces both a real compliance
  PDF and a real claim draft, both viewable, both timestamped. This is the moment
  the core insight becomes visible as an artifact, not just an architecture claim.

### Phase 5 — Dashboard + Demo Assembly (Days 11–12)
- Live route map
- Heat-spike injector button — the entire interaction model for the demo
- Event timeline showing the fork: one event, two responses, side by side
- **Exit condition:** a stranger could click the injector and understand what just
  happened without narration. If it needs your voice to make sense, it's not done.

### Phase 6 — Hardening, Compliance Pass, Demo Hook (Days 13–14)
- Run the rules compliance checklist (§7) against FortyGuard's actual rules page
- Deploy final, record a backup demo video (never demo live-only at a hackathon)
- **This is where the demo hook gets written** — now that there's a real product
  to open with real stakes, not before
- **Exit condition:** submission-ready, backup video in hand, hook rehearsed against
  the actual working system, not an imagined one.

---

## 7. Rules Compliance Checklist

Cross-check each of these against FortyGuard's actual rules page before submission —
the flyer shows Register → Build → Submit → Present as the four steps, confirm the
specifics (public repo requirement, demo video length/format, live deployment
requirement, track selection lock-in) directly from their rules doc rather than
inferring from the landing page.

- [ ] Confirm exact submission deliverables (repo, video, live link, write-up)
- [ ] Confirm single-track vs multi-track submission is allowed (this build spans
      Insurance/Governance, Resilient Infrastructure, and optionally Agentic AI)
- [ ] Confirm FortyGuard API usage/attribution requirements
- [ ] Confirm demo video length limit and format
- [ ] Confirm team size / eligibility rules

---

## 8. API Verification Notes (checked 2026-08-12)

Confirmed from FortyGuard's own docs/site — the route-level design in this spec holds:

- **Spatial precision:** 2-meter precision, geohash6 resolution (~street-level) —
  comfortably finer than "per waypoint" needs. Spatial resolution down to
  0.0001–0.001° depending on query. Route-level granularity is not a stretch, it's
  well within their stated capability.
- **Query model:** `POST /v1/heatmap` (or coordinate-based report equivalent) takes
  a `polygon_aoi` (or coordinates) + `date_time` + `granularity`, and returns an
  `activity_id` — **this is an async job, not a synchronous point lookup.** Adjust
  the ingestion layer as noted in §2 to account for submit → poll latency.
- **Forecast horizon: 12 hours only**, delivered hour-by-hour (not daily averages).
  This is a real constraint, not a minor detail: if a demo route leg exceeds a
  12-hour horizon, the forecast portion of the pipeline runs dry and you'd need to
  fall back to nowcast/historical data for anything beyond that window. For the
  demo, keep the simulated route inside a 12-hour window — this is also, usefully,
  FortyGuard's own framing of "the window where action still matters," so it's not
  a limitation you need to apologize for in the pitch, it's the operational design
  center of their own product.
- **Not yet confirmed:** exact response payload shape, auth flow, rate limits, and
  whether the coordinate-based "tailored report" endpoint (mentioned on their
  products page) is a faster synchronous alternative to the polygon heatmap job for
  single-point route waypoints. Get API trial access and pull a live response before
  Day 1 ends — don't build the ingestion client against assumptions past this point.

## 10. Claude Code Prompts (issue in order, one phase at a time)

General rule for all of these: paste the phase prompt into Claude Code **with this
file attached/referenced** so it reads the full spec first. Don't let it start a
phase until the prior phase's exit condition is confirmed. If real API responses
(Phase 0) differ from the data contracts in §3, that's a stop-and-report moment, not
a silent adaptation — say so explicitly in every prompt, which is why it's repeated
below.

---

**Phase 0 — Foundation & Verification**
```
You're building Threshold, a unified thermal-liability engine for temperature-
controlled fleets. Read the full architecture spec in thermal-liability-
architecture.md before doing anything — do not deviate from the data contracts,
layer boundaries, or phase gates defined there without flagging it back to me first.

Your task right now is Phase 0 only:
1. Scaffold a monorepo: Next.js frontend (/apps/web), Node/TS backend on Fastify
   (/apps/api), shared types package (/packages/types) mirroring the data contracts
   in §3 exactly.
2. Set up Postgres via Supabase — create the append-only audit log table per §2
   (Audit Layer). Use migration files, not manual SQL.
3. Build a FortyGuard API client module (/packages/fortyguard-client) implementing
   the async submit/poll pattern from §8 — POST job, poll activity_id, return a
   typed result. Read credentials from .env, never hardcode them, never log the raw
   key.
4. Wire up CI (GitHub Actions) — lint + typecheck on push. Nothing fancier yet.
5. Deploy skeletons: frontend to Vercel, backend to an EC2 stub with PM2.
6. Do NOT build ingestion logic, the event bus, or evaluators yet — that's Phase 1+.

Stop and report back once Phase 0's exit condition is met: a real FortyGuard API
call returns real temperature data through your client, end to end. If the real
response shape doesn't match §3's data contracts, STOP and flag the mismatch —
don't silently adapt the contract yourself.
```

---

**Phase 1 — Ingestion + Simulation Harness**
```
Phase 0 is confirmed done: [paste Claude's Phase 0 report + confirm the real API
response shape matched or was reconciled with §3]. Proceed to Phase 1 only.

1. Build the route/telemetry simulator — a deterministic script generating
   waypoints, cargo_class, driver_id, and timestamps I control, matching the
   WaypointTelemetry contract in §3.
2. Wire the FortyGuard client from Phase 0 into an ingestion pipeline that pre-
   fetches/queues waypoint temperature data ahead of simulated arrival time — do
   not call-and-wait live, per the async job model in §8.
3. Build the event bus (in-process emitter is fine at this scale) emitting
   ThermalExposureEvent per §3, sourced from real FortyGuard data.
4. Log every event to the audit table from Phase 0.

Stop and report back once you can run one full simulated route end to end and I can
see correctly-shaped ThermalExposureEvents, sourced from real API data, logged in
order with no manual intervention.
```

---

**Phase 2 — Risk Engine Core**
```
Phase 1 confirmed done. Proceed to Phase 2 only — this is the most important phase
in the whole build, take the time it needs.

1. Human Compliance Evaluator: implement the NWS heat-index formula, apply OSHA
   heat-illness thresholds, generate a work/rest schedule per the ComplianceRecord
   contract in §3.
2. Cargo Risk Evaluator: implement per-cargo-class spoilage curves (pharma,
   produce, general_reefer — propose reasonable default curves and show me before
   finalizing), cumulative exposure scoring, output per the CargoRiskAssessment
   contract in §3.
3. Both evaluators subscribe to the same ThermalExposureEvent from the bus — do not
   fork the pipeline or let one evaluator see data the other doesn't.
4. Write unit tests against synthetic heat-spike events with known expected outputs
   for both evaluators.
5. Log every evaluation to the audit table.

Stop and report back with test results once a synthetic breach event produces
correct, audit-logged output from both evaluators independently.
```

---

**Phase 3 — Agent Decision Layer**
```
Phase 2 confirmed done. Proceed to Phase 3 only.

1. Build a hard-coded-threshold fallback decision path FIRST — this is the safety
   net if the agent layer doesn't land in time, per §2.
2. Build the orchestrator agent (Claude or Gemini API, your call on which fits the
   stack better — flag the tradeoff to me) that reads both evaluator outputs and
   decides an action_tier: alert / draft / auto_execute, per the AgentDecision
   contract in §3, gated by a confidence score.
3. Every decision must log a human-readable rationale string to the audit table —
   this is what makes the output defensible as real liability documentation.

Stop and report back once a breach event produces a logged decision with a
rationale a stranger could read and understand without me explaining it.
```

---

**Phase 4 — Output / Integration Layer**
```
Phase 3 confirmed done. Proceed to Phase 4 only.

1. Compliance PDF export (pdf-lib) from a ComplianceRecord.
2. Claim draft generator from a CargoRiskAssessment — structured output is fine,
   doesn't need a real insurer integration.
3. Reroute recommendation — mocked is fine, say so plainly, don't fake a real
   routing API integration.
4. Webhook emitter — the plug-and-play surface a fleet's existing TMS would call.
   Build it as a real, documented webhook contract even though nothing external
   consumes it yet.

Stop and report back once one single heat-spike event produces both a real,
viewable compliance PDF and a real claim draft, both timestamped.
```

---

**Phase 5 — Dashboard + Demo Assembly**
```
Phase 4 confirmed done. Proceed to Phase 5 only.

1. Live route map (Mapbox or Leaflet) showing the simulated route and current
   waypoint.
2. A single heat-spike injector button — this is the entire interaction model for
   the demo, keep it dead simple.
3. Event timeline showing the fork clearly: one ThermalExposureEvent, two
   responses (compliance + cargo), side by side, timestamped.

Do not add features beyond this. Stop and report back once a stranger could click
the injector and understand what happened without narration.
```

---

**Phase 6 — Hardening, Compliance Pass**
```
Phase 5 confirmed done. Proceed to Phase 6 — do NOT touch demo script/pitch
content, that's being handled separately.

1. Run through the rules compliance checklist in §7 and flag anything unverified.
2. Final deploy — both frontend and backend to production URLs.
3. Record a full backup run-through as a video file (never demo live-only).
4. Write a clean README: what it does, why, architecture summary, how to run it
   locally.

Report back with the deploy URLs, backup video location, and README once done.
```

## 11. Open Decisions (your call)

- Whether the agent layer ships as auto-execute-capable or stays alert/draft-only for
  the demo (auto-execute is a stronger demo moment but a bigger liability claim to
  defend under judge questioning — your call, not a scope-down suggestion either way)
- Real routing API integration vs. mocked reroute suggestion
- Which LLM API powers the Phase 3 agent layer (Claude vs Gemini — Gemini has the
  cleaner GCP-sponsor-fit story if that matters to you for judging)
