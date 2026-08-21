# Threshold

Unified thermal-liability engine for temperature-controlled fleets.

Every temperature-controlled freight route exposes two liability surfaces to
the *same* heat event: the **driver** (heat illness, OSHA) and the **cargo**
(spoilage, pharma cold-chain). Today those are two disconnected tools, built
by two disconnected teams. Threshold resolves both from a single
FortyGuard-fed thermal reading, in one pass — one event, logged once,
producing two liability responses side by side.

Built for FortyGuard Hackathon'26. The architecture of record is
[`thermal-liability-architecture.md`](thermal-liability-architecture.md);
section references throughout the codebase (§2, §3, §8 …) point at it.

---

## Status

| Phase | State |
|---|---|
| 0 — Foundation & Verification | done — real API call verified end to end |
| 1 — Ingestion + Simulation | done — real FortyGuard data proven through the full pipeline |
| 2 — Risk Engine Core | done |
| 3 — Agent Decision Layer | done — **locked as hard-coded, no LLM layer** (see below) |
| 4 — Output / Integration | done |
| 5 — Dashboard + Demo | done |
| 6 — Hardening, Compliance Pass | done |

**Live demo:** https://web-ivory-five-41.vercel.app
**Backend API:** http://44.201.16.48:8080 (`/health`, `/ready`)
**Repo:** https://github.com/danielamodu/Threshold (public)
**Backup:** [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md) — a scripted walkthrough, not a
video file. The environment this was built in cannot screen-record (its
capture surface only sees its own interface, confirmed by testing rather than
assumed); rather than ship a broken video, this is the exact 90-second
walkthrough to record yourself, or to narrate from directly if the live URL
is ever unreachable during judging.

---

## The six layers, and where each one lives

Mapped directly from §2's architecture diagram:

| Layer | Package |
|---|---|
| Ingestion (telemetry + FortyGuard client) | `packages/ingestion`, `packages/fortyguard-client` |
| Risk Engine Core (event bus, both evaluators) | `packages/risk-engine` |
| Agent Decision Layer | `packages/decision-layer` |
| Output / Integration (PDF, claim draft, reroute, webhook) | `packages/output` |
| Audit Layer (append-only Postgres log) | `packages/audit` |
| Judge-Facing Dashboard | `apps/web` |

`packages/pipeline` is the composition root wiring all of the above together
— not a layer in §2's diagram, deliberately kept out of every layer
individually, and shared between `apps/api` and `apps/web` since both need
the identical wiring.

Everything in `packages/*` depends only on `@threshold/types` (the §3
contracts, mirrored verbatim) or on each other in one direction, inward.
Nothing downstream depends on how ingestion sources its data — real
FortyGuard calls and the deterministic simulator both implement the same
`ThermalReadingSource` interface, so swapping one for the other never
touches risk-engine, decision-layer, output, or audit.

---

## Layout

```
apps/
  web/                    Next.js dashboard — map, injector, timeline (Phase 5)
  api/                    Fastify backend — /health, /ready; scripts/ for demo + real-data proof runs
packages/
  types/                  §3 data contracts + runtime validators. A mirror, not a design surface.
  fortyguard-client/      FortyGuard Enterprise API client (§8) — async submit/poll
  ingestion/              Telemetry simulator + real FortyGuardThermalReadingSource (Phase 1)
  risk-engine/            Event bus, Human Compliance Evaluator, Cargo Risk Evaluator (Phase 2)
  decision-layer/         Hard-coded-threshold fallback decision — the final Agent Decision Layer (Phase 3)
  output/                 Compliance PDF, claim draft + PDF, mocked reroute, webhook (Phase 4)
  audit/                  Append-only audit sink — in-memory (tests) + Postgres (production)
  pipeline/               Composition root — wires every layer together
db/
  migrate.mts             Migration runner for Neon. Checksum-guarded.
  migrations/             Append-only audit log (§2). Files, never manual SQL.
  tests/                  Assertion suite proving the §2 guarantees.
.github/workflows/ci.yml  Lint + typecheck.
```

## Requirements

Node 20.9+ (developed on 24.12). npm workspaces — no pnpm needed.

## Running it locally

```bash
npm install
cp .env.example .env      # fill in FORTYGUARD_API_KEY and NEON_DATABASE_URL
npm run build:packages    # builds all 8 packages, in dependency order
```

```bash
npm run dev --workspace @threshold/web     # dashboard on :3000
npm run dev --workspace @threshold/api     # backend on :8080 (optional for the dashboard — see below)
```

The dashboard runs the whole pipeline **in-process inside Next.js**, via a
Server Action (`apps/web/app/actions.ts`) — it does not call the Fastify
backend. That's deliberate: the judge-facing demo shouldn't depend on two
servers both being up. `apps/api` is the standalone backend for real
deployments and webhook-receiving; the dashboard works with only `:3000`
running.

```bash
npm run lint                                    # eslint, whole workspace
npm run typecheck                                # tsc across every workspace
npm run test                                     # 166 tests across 6 packages
npm run simulate --workspace @threshold/api       # full pipeline, synthetic data, console output
npm run simulate:real --workspace @threshold/api  # same, but real FortyGuard data (slow — ~1min/waypoint)
npm run verify:fortyguard                        # Phase 0 exit-condition harness
```

---

## Design decisions worth knowing before you read the code

**`temp_c` is the AOI's Max, not Mean** (§8 decision 1) — the conservative,
defensible number if this system is ever audited.

**`heat_index_c` is computed in the Human Compliance Evaluator, not read off
the ingestion event** (§8 decision 2). FortyGuard's own heat-index figure is
never used; the NWS Rothfusz regression is implemented in full, including the
two correction branches most implementations skip, and clamped beyond its
~112°F fitted domain rather than extrapolated — an earlier build printed a
physically meaningless ~130°C heat index for a 60°C reading before that fix
landed.

**Null humidity is a recorded state, never zero-filled** (§8 decision 3).
Zero-filling would falsely deflate the heat index and understate real risk.
When humidity is unavailable, the Human Compliance Evaluator falls back to a
deliberately conservative dry-bulb-only rule instead.

**Cargo spoilage ceilings are ambient thresholds, not cargo set points.**
FortyGuard returns outdoor ambient temperature, not a probe inside the
trailer. An early version of the spoilage model compared ambient directly
against pharma's 2–8°C *storage* range and scored a normal afternoon as an
instant total-loss breach at every waypoint. The ceilings now represent the
ambient temperature at which a reefer's cooling margin is gone — see
`packages/risk-engine/src/spoilage.ts` for the full reasoning. The exact
numbers are proposed defaults, not measured, and are flagged as such in code.

**The audit log's `seq` is monotonic but not gap-free.** A rejected insert
(an `agent_decision` with no rationale, for instance) still burns an
identity value. A gap is evidence of a refused write, never a deleted row —
deletion is impossible here by design.

**The fallback decision's confidence is agreement, not a model score.**
`HardCodedThresholdDecider` has no model behind it. Confidence reflects how
much the Human Compliance and Cargo Risk evaluators agree with each other:
concordant severities score high, a split verdict (driver fine, cargo
already breached from earlier exposure, or vice versa) scores low —
explainable, not manufactured precision.

---

## Honest limitations

**Ingestion runs against a pinned historical window, not live data.**
Verified directly against the real API: queries anywhere in the documented
±12h live/forecast window returned zero tiles, across two cities and ten
time offsets, while a fixed historical date returned real data every time.
That looks like a trial-key restriction on live/forecast access, not a
coverage gap — it's been escalated to FortyGuard directly. Every waypoint
query substitutes a confirmed-working historical date while keeping the
waypoint's real time-of-day, so the diurnal temperature curve a live route
would see is preserved. `packages/ingestion/src/fortyguard-source.ts`'s file
header has the full account. The moment FortyGuard confirms live access
works, `anchorDate` becomes optional and the class queries the real
timestamp — nothing else in the pipeline changes.

**The Agent Decision Layer is intentionally a single hard-coded rule, not an
LLM.** This was evaluated and decided, not left unfinished: `packages/decision-layer`'s
`HardCodedThresholdDecider` is the final decision layer for this build, not
a placeholder awaiting a model. It reasons only from the two evaluator
outputs for **one event at a time** — it does not reason across a route's
history or correlate multiple events. `auto_execute` is capped off by
default and only reachable when both evaluators independently hit their most
severe band, with the cap explicitly configurable, not silently decided.

**Reroute recommendations are mocked.** `generateRerouteSuggestion` produces
a labeled (`mocked: true`), rule-based advisory from the cargo exposure
numbers already in hand — no real routing-provider integration, per §6.

**Claim drafts never include a loss value.** No cargo valuation data exists
anywhere in this system, and inventing a dollar figure for a liability
document would be actively wrong to demo. `estimated_loss_value` is `null`
with an explicit note instead of a fabricated number.

**The dashboard is not Mapbox/Leaflet** (§4 names them). Real waypoint
coordinates are projected into an SVG viewBox instead, to avoid a Mapbox
token dependency that could fail during judging for a demo whose actual
signal is the risk-state fork, not cartographic accuracy.

---

## Rules compliance (§7)

Checked directly against FortyGuard's actual hackathon rules page (its
content is client-rendered, not visible via a normal page fetch — verified
by extracting the embedded JSON data directly).

- Submission: public GitHub repo (✓ already public) + live demo link + short
  video (2–5 min) + written summary + FortyGuard API usage documentation +
  add `fortyguard` as a repo collaborator
- Deadline: **30 August 2026, 11:59 PM GST** — no late submissions
- Team size: 1–3, solo allowed
- Data coverage: **United States only** — the demo route (Phoenix, AZ) is compliant
- Judging: Impact & Relevance 40%, Technical Execution 35%, Innovation 15%, Communication 10%
- Real track list doesn't include "Insurance/Governance" (this spec's
  original framing) — best fit is **Track 3, Industrial & Enterprise**,
  whose own listed examples ("Worker Safety Dashboard", "Logistics Heat
  Risk") describe this project almost verbatim
- **Not stated anywhere on the rules page:** whether a single-track or
  multi-track submission is allowed — genuinely unconfirmed, not assumed

## Deployment

See [`DEPLOY.md`](DEPLOY.md).
