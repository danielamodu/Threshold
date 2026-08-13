# Threshold

Unified thermal-liability engine for temperature-controlled fleets.

Every temperature-controlled freight route has two liability surfaces exposed to
the *same* heat event: the **driver** (heat illness, OSHA) and the **cargo**
(spoilage, pharma cold-chain). Today those are two disconnected tools. Threshold
resolves both from a single FortyGuard-fed event, in one pass.

The architecture of record is [`thermal-liability-architecture.md`](thermal-liability-architecture.md).
Section references throughout the codebase (§2, §3, §8 …) point at it.

---

## Status: Phase 0 — Foundation & Verification

Phase 0 builds the skeleton and verifies the upstream API. It deliberately does
**not** build ingestion, the event bus, or the evaluators — those are Phase 1+.

| Phase 0 item | State |
|---|---|
| Monorepo scaffold | done |
| §3 data contracts in `packages/types` | done |
| Append-only audit log migration (§2) | written; **not yet applied** — needs a Supabase project |
| FortyGuard async submit/poll client (§8) | done |
| CI — lint + typecheck on push | done |
| Deploy skeletons — Vercel + EC2/PM2 | done |
| **Exit condition:** real API call, real temperature, end to end | **blocked on an API key** |

---

## Layout

```
apps/
  web/                    Next.js frontend. Phase 0: placeholder page.
  api/                    Fastify backend. Phase 0: /health + /ready only.
packages/
  types/                  §3 data contracts. A mirror, not a design surface.
  fortyguard-client/      FortyGuard Enterprise API client (§8).
supabase/
  migrations/             Append-only audit log (§2). Files, never manual SQL.
.github/workflows/ci.yml  Lint + typecheck.
```

## Requirements

Node 20.9+ (developed on 24.12). npm workspaces — no pnpm needed.

## Setup

```bash
npm install
cp .env.example .env      # then fill in FORTYGUARD_API_KEY
npm run build:packages
```

## Commands

```bash
npm run lint              # eslint, whole workspace
npm run typecheck         # tsc across every workspace
npm run build:packages    # shared packages (needed before typechecking consumers)
npm run verify:fortyguard # Phase 0 exit-condition harness — makes real API calls
npm run dev --workspace @threshold/api    # backend on :8080
npm run dev --workspace @threshold/web    # frontend on :3000
```

## The FortyGuard client

Every FortyGuard analysis endpoint is an async job — POST returns an
`activity_id`, and `GET /status/{activity_id}` is polled to a terminal state.
There is no synchronous point lookup.

```ts
import { FortyGuardClient, squareAoiAround, summarizeTemperature } from '@threshold/fortyguard-client';

const client = FortyGuardClient.fromEnv();

const job = await client.runHeatmap({
  polygon_aoi: squareAoiAround(40.7115, -74.01, 2), // heatmap takes an AOI, not a point
  date_time: { start_date: '2026-08-13', start_time: '14:00', filter_type: 1 },
  granularity: 100,
  analytic_type: 'tcm',                             // tcm => °C
});

summarizeTemperature(job.result); // { min, mean, max, stdDev, units, tileCount }
```

Two things worth knowing before Phase 1:

1. **Temperature and humidity come from different endpoints.** `/heatmap` gives
   temperature. Heat index and relative humidity come from `/env_params`, which
   takes a temperature as an *input*. One `ThermalExposureEvent` therefore costs
   two chained async jobs, not one.
2. **The forecast horizon is 12 hours.** Requests beyond `now + 12h` are
   rejected with 400.

### Credential handling

The key is read from `.env` as `FORTYGUARD_API_KEY` and is never defaulted or
embedded. It is attached in exactly one place (`src/http.ts`) and scrubbed from
every error message, log line, and captured artifact. Diagnostics report
presence and length only — never a fragment of the value.

## The audit log

One append-only table, `public.audit_log`, holding every event, evaluation, and
agent decision (§2). Append-only is enforced twice: by trigger — which applies
to the table owner too — and by privilege revocation. `UPDATE`, `DELETE`, and
`TRUNCATE` all raise. An `agent_decision` without a rationale is rejected by
check constraint, because a decision with no rationale is not auditable.

`event_id` is the correlation key across every entry type, which is what makes
"one heat event → two liability responses" a single query.

```bash
npm run db:start   # local Supabase
npm run db:reset   # replay every migration from scratch
npm run db:push    # apply to a linked hosted project
```

Schema changes are migration files. Never the Supabase SQL editor.

## Deployment

See [`DEPLOY.md`](DEPLOY.md).
