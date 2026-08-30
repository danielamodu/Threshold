# Threshold

Temperature-controlled freight routes expose two liability surfaces to the same heat event: the **driver** (heat illness, OSHA) and the **cargo** (spoilage, cold-chain breach). These are handled by two disconnected teams using two disconnected tools. Threshold resolves both from a single FortyGuard thermal reading — one event, logged once, producing two liability responses side by side.

**Live:** [trythreshold.vercel.app](https://trythreshold.vercel.app)  
**Repo:** [github.com/danielamodu/Threshold](https://github.com/danielamodu/Threshold)

---

## How it works

A FortyGuard thermal reading enters the pipeline once. The **Human Compliance Evaluator** runs the NWS Rothfusz heat-index regression and maps the result to an OSHA action tier. The **Cargo Risk Evaluator** accumulates a °C·h exposure score against cargo-class thresholds. Both evaluators emit independent records. The **Decision Layer** correlates them into a single operating response — action tier, confidence, and plain-language rationale — and writes everything to an append-only audit log.

The same event that reduces a driver's work limit may simultaneously push cargo past its exposure ceiling. Threshold makes that visible in one record rather than two separate alert queues.

---

## Architecture

Six layers, each in its own package:

| Layer | Package |
|---|---|
| Ingestion — telemetry + FortyGuard client | `packages/ingestion`, `packages/fortyguard-client` |
| Risk Engine — event bus, both evaluators | `packages/risk-engine` |
| Decision Layer | `packages/decision-layer` |
| Output — compliance PDF, claim draft, reroute advisory, webhook | `packages/output` |
| Audit — append-only Postgres log | `packages/audit` |
| Shared types + runtime validators | `packages/types` |

`packages/pipeline` is the composition root that wires all layers together. It is shared between `apps/api` and `apps/product`, which both need the identical wiring.

Every package depends only on `@threshold/types` or on packages further inward. Nothing downstream cares whether ingestion is reading real FortyGuard data or the deterministic simulator — both implement the same `ThermalReadingSource` interface.

---

## Layout

```
apps/
  product/    Vite + React product shell — landing page, auth, role-aware dashboards
  api/        Fastify backend — /health, /ready, org-scoped API routes, PDF serving
  web/        Next.js prototype (superseded by apps/product; kept for reference)
packages/
  types/              Shared data contracts + runtime validators
  fortyguard-client/  FortyGuard Enterprise API client — async submit/poll
  ingestion/          Telemetry simulator + real FortyGuardThermalReadingSource
  risk-engine/        Event bus, Human Compliance Evaluator, Cargo Risk Evaluator
  decision-layer/     HardCodedThresholdDecider — the final Agent Decision Layer
  output/             Compliance PDF, claim draft, reroute advisory, webhook emitter
  audit/              Append-only audit sink — in-memory (tests) + Postgres (production)
  pipeline/           Composition root
db/
  migrate.mts         Migration runner for Neon. Checksum-guarded.
  migrations/         Append-only. Files only, never manual SQL.
  tests/              Assertion suite for the audit guarantees.
.github/workflows/ci.yml  Lint + typecheck.
```

---

## Requirements

Node 20.9+ (developed on 24.12). npm workspaces — no pnpm needed.

---

## Running locally

```bash
npm install
cp .env.example .env      # fill in FORTYGUARD_API_KEY, NEON_DATABASE_URL, CLERK_* keys
npm run build:packages    # builds all packages in dependency order
```

**Product app** (full authenticated shell):
```bash
npm run dev --workspace @threshold/product   # client on :5173
npm run dev --workspace @threshold/api       # backend on :8080
```

**Pipeline scripts:**
```bash
npm run simulate --workspace @threshold/api       # full pipeline, synthetic data
npm run simulate:real --workspace @threshold/api  # real FortyGuard data (~1 min/waypoint)
npm run verify:fortyguard                        # end-to-end FortyGuard API harness
```

**Workspace-wide:**
```bash
npm run lint        # eslint
npm run typecheck   # tsc across all packages
npm run test        # 166 tests across 6 packages
```

---

## Technical decisions

**`temp_c` is the AOI's Max, not Mean.** The conservative, defensible number for an auditable system.

**`heat_index_c` is computed internally, not read from FortyGuard.** The NWS Rothfusz regression runs in full, including both correction branches and clamping at the ~112°F fitted domain boundary. FortyGuard's own heat-index figure is never used.

**Null humidity is recorded, never zero-filled.** Zero-filling falsely deflates the heat index. When humidity is unavailable the evaluator falls back to a conservative dry-bulb-only rule.

**Cargo spoilage ceilings are ambient thresholds, not cargo set points.** FortyGuard returns outdoor ambient temperature, not an in-trailer probe. Comparing ambient directly against a pharma 2–8°C storage range scored a normal afternoon as a total loss at every waypoint. The ceilings represent the ambient temperature at which a reefer's cooling margin is gone — see `packages/risk-engine/src/spoilage.ts`.

**The Decision Layer is a hard-coded rule, not an LLM.** `HardCodedThresholdDecider` is the final decision layer for this build. Confidence is evaluator agreement — concordant severities score high, a split verdict scores low. Explainable, not manufactured.

**The audit log's `seq` is monotonic but not gap-free.** A rejected insert still burns an identity value. A gap is evidence of a refused write, never a deleted row — deletion is impossible by design.

---

## Scope and known constraints

**Ingestion uses a pinned historical date.** Queries against the live/forecast window of the FortyGuard API returned zero tiles across two cities and multiple time offsets; a fixed historical date (2024-07-15) returned real data consistently. This looks like a trial-key restriction on live access, escalated to FortyGuard. Every waypoint query substitutes that confirmed date while keeping the real time-of-day, preserving the diurnal temperature curve. Switching to live timestamps requires changing one parameter in `packages/ingestion/src/fortyguard-source.ts`.

**Reroute suggestions are advisory only.** `generateRerouteSuggestion` produces a rule-based advisory from the cargo exposure numbers already in hand. No routing-provider integration.

**Claim drafts carry no loss value.** No cargo valuation data exists in this system. `estimated_loss_value` is `null` with an explicit note rather than a fabricated figure.

**Maps are SVG projections, not tile-based.** Waypoint coordinates are projected into an SVG viewBox. No Mapbox token, no tile server dependency.

---

## Deployment

See [`DEPLOY.md`](DEPLOY.md).
