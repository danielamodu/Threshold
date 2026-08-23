# Threshold — UI Brief

Read this fully before building. You're designing and building a **visual skeleton only** — real data comes later, wired in separately. Everywhere below that says "your call," it means exactly that: no design system is being handed to you, make the visual decisions yourself.

## What this is

Every temperature-controlled freight route has two liability surfaces exposed to the *same* heat event: the **driver** (heat illness, OSHA) and the **cargo** (spoilage, pharma cold-chain). Today these are two disconnected tools solved by two disconnected teams. Threshold resolves both from a single heat event, in one pass — one truck, one heat spike, and you watch a driver-safety response and a cargo-liability response fire simultaneously, correlated to the same event.

That fork — **one event, two responses** — is the entire product. The UI's only job is to make that fork unmistakable.

## The interaction model — one control, two states

The whole demo is: a route is shown. The viewer clicks **one button**. Both liability tracks visibly escalate at the same waypoint. That's it — no navigation, no settings, no login, no second screen.

Design for exactly two states:

**State A — Baseline.** The route loads showing a normal run: every waypoint nominal or low severity on both tracks. Nothing alarming. This is the "before."

**State B — Post-injection.** After the click, one waypoint (wp-3 in the sample data) spikes hard on temperature. At that waypoint: the driver-safety track jumps to its most severe response, AND the cargo-liability track independently jumps to its own most severe response, at the same moment, same location. A trailing waypoint (wp-4) shows something worth designing for deliberately: the driver side can recover (temperature dropped back down) while the cargo side stays at its worst level, because cargo damage accumulates and doesn't undo itself. That's a real, meaningful asymmetry — the two tracks don't move in lockstep, and a good design should let a viewer notice that without reading the text.

The control itself is a single toggle: click once to inject, click again to reset to baseline. Label/treatment is your call.

## The three things on screen

**1. A route map.** Four waypoints, real coordinates (given below), connected in order. Each waypoint needs to visually communicate its current severity on *two independent tracks at once* — driver-safety and cargo-liability aren't the same axis and can disagree (see wp-4 above). How you encode two independent severity signals per point — color, split markers, dual rings, iconography, whatever — is entirely your design call. Three severity levels per track: low / mid / high. Not a continuous gradient, three discrete states.

**2. The injector control.** One button/switch. See above.

**3. An event timeline.** One row per waypoint, in order, showing (side by side, so the "two responses" framing is visible at a glance):
- the raw reading (temperature, humidity, timestamp)
- the driver-safety response (what action, plus the reasoning number behind it)
- the cargo-liability response (risk level, plus the accumulated exposure number and its threshold)
- underneath both: the automated decision that combined them — a tier (alert / draft / auto-execute) and a plain-English sentence explaining why. This sentence is real generated text, often 2-3 sentences long — design a place for it to breathe, not a cramped single line.

## Real data to build against

This is actual output from the running system, not fabricated placeholder text — hardcode these two states directly into the skeleton.

**Route metadata** (same for both states):
```json
{
  "route_id": "route-phx-01",
  "cargo_class": "pharma",
  "driver_id": "driver-42",
  "waypoints": [
    { "waypoint_id": "wp-1", "lat": 33.4484, "lng": -112.074 },
    { "waypoint_id": "wp-2", "lat": 33.5,    "lng": -112.1   },
    { "waypoint_id": "wp-3", "lat": 33.56,   "lng": -112.15  },
    { "waypoint_id": "wp-4", "lat": 33.62,   "lng": -112.2   }
  ]
}
```

**One full nominal waypoint** (State A, or wp-1/wp-2 in State B — both tracks quiet):
```json
{
  "waypoint_id": "wp-1",
  "lat": 33.4484,
  "lng": -112.074,
  "event": {
    "temp_c": 29.15,
    "humidity_pct": 47.4,
    "data_quality": "complete",
    "timestamp": "2026-08-17T13:00:00.000Z"
  },
  "compliance": {
    "heat_index_c": 29.5,
    "action": "none",
    "schedule": [],
    "generated_at": "2026-08-21T14:27:32.669Z"
  },
  "cargo": {
    "cargo_class": "pharma",
    "cumulative_exposure_score": 0,
    "threshold": 12,
    "risk_level": "nominal",
    "recommended_action": "none",
    "claim_draft_id": null,
    "reroute_suggestion": null
  },
  "decision": {
    "confidence": 0.9,
    "action_tier": "alert",
    "rationale": "This is a hard-coded-threshold decision (no model involved): the driver side scheduled \"none\" (heat index 29.5°C) — low severity; the cargo side reports \"nominal\" (0/12 °C·h cumulative exposure for pharma) — low severity. Neither side has reached its most severe level, so this stays at alert only — logged, no drafted action. The two evaluators agree closely, so this combined call is reported with high confidence (0.9)."
  },
  "human_severity": "low",
  "cargo_severity": "low"
}
```

**The spike waypoint** (State B, wp-3 — this is the fork, the moment the design has to sell):
```json
{
  "waypoint_id": "wp-3",
  "lat": 33.56,
  "lng": -112.15,
  "event": {
    "temp_c": 50.21,
    "humidity_pct": 40.4,
    "data_quality": "complete",
    "timestamp": "2026-08-17T15:00:00.000Z"
  },
  "compliance": {
    "heat_index_c": 61.4,
    "action": "work_limit_reduced",
    "schedule": [
      { "start": "2026-08-17T15:15:00.000Z", "end": "2026-08-17T16:00:00.000Z", "type": "reduced_load" }
    ],
    "generated_at": "2026-08-21T14:27:32.681Z"
  },
  "cargo": {
    "cargo_class": "pharma",
    "cumulative_exposure_score": 20.33,
    "threshold": 12,
    "risk_level": "breach",
    "recommended_action": "claim_draft",
    "claim_draft_id": "dc755e24-562b-4ca6-8930-5f8603a4fdac",
    "reroute_suggestion": null
  },
  "decision": {
    "confidence": 0.9,
    "action_tier": "draft",
    "rationale": "This is a hard-coded-threshold decision (no model involved): the driver side scheduled \"work_limit_reduced\" (heat index 61.4°C) — high severity; the cargo side reports \"breach\" (20.33/12 °C·h cumulative exposure for pharma) — high severity. At least one side reached its most severe level, so this is escalated to a draft response for a human to review before anything is sent. The two evaluators agree closely, so this combined call is reported with high confidence (0.9)."
  },
  "human_severity": "high",
  "cargo_severity": "high"
}
```

**The trailing "split" waypoint** (State B, wp-4 — driver recovered, cargo did not; low confidence on the decision because the two tracks disagree — design this state deliberately, it's not an edge case, it's the second-best moment in the demo):
```json
{
  "waypoint_id": "wp-4",
  "lat": 33.62,
  "lng": -112.2,
  "event": { "temp_c": 28.67, "humidity_pct": 48.6, "data_quality": "complete", "timestamp": "2026-08-17T16:00:00.000Z" },
  "compliance": { "heat_index_c": 29.1, "action": "none", "schedule": [], "generated_at": "2026-08-21T14:27:32.699Z" },
  "cargo": {
    "cumulative_exposure_score": 20.33,
    "threshold": 12,
    "risk_level": "breach",
    "recommended_action": "claim_draft",
    "claim_draft_id": "1253a003-190a-4677-b39c-00e05e0c2f60",
    "reroute_suggestion": null
  },
  "decision": {
    "confidence": 0.5,
    "action_tier": "draft",
    "rationale": "This is a hard-coded-threshold decision (no model involved): the driver side scheduled \"none\" (heat index 29.1°C) — low severity; the cargo side reports \"breach\" (20.33/12 °C·h cumulative exposure for pharma) — high severity. At least one side reached its most severe level, so this is escalated to a draft response for a human to review before anything is sent. The two evaluators disagree sharply here (one low, one high), which is itself worth a reviewer's attention — confidence is reported low (0.5) to reflect that split rather than overstating certainty in a combined call."
  },
  "human_severity": "low",
  "cargo_severity": "high"
}
```

For State A (full baseline), wp-2/wp-3/wp-4 all look like the nominal wp-1 example above, just with slightly different real numbers (temp climbing gently through the afternoon: roughly 29 → 30 → 30 → 29°C, all `action: "none"`, all `risk_level: "nominal"`, all `action_tier: "alert"`). Exact precision doesn't matter for the skeleton — the shape and the story do.

## Field reference

| Field | Type | Notes |
|---|---|---|
| `event.temp_c` | number | The reading that drives everything downstream |
| `event.humidity_pct` | number \| null | **Null is a real, valid state** — humidity was unavailable, not zero. If you design a "degraded" treatment for this, it should look like "unknown," never "0%" |
| `event.data_quality` | `"complete"` \| `"degraded_no_humidity"` | Corresponds to the null case above |
| `compliance.heat_index_c` | number \| null | Null exactly when humidity is null |
| `compliance.action` | `"none"` \| `"rest_break_scheduled"` \| `"work_limit_reduced"` | Driver-side severity, 3 levels |
| `compliance.schedule` | array | Empty when `action` is `"none"`. Otherwise one or more `{start, end, type}` rest/reduced-load windows |
| `cargo.risk_level` | `"nominal"` \| `"elevated"` \| `"breach"` | Cargo-side severity, 3 levels |
| `cargo.cumulative_exposure_score` / `.threshold` | number | Show as a ratio or progress toward breach — this number only ever goes up |
| `cargo.recommended_action` | `"none"` \| `"reroute"` \| `"claim_draft"` | What breach/elevated leads to |
| `cargo.reroute_suggestion` | object \| null | Only present at `"elevated"`. Not shown in the samples above — if you want to design for it, it's a mocked advisory suggestion, present only when `recommended_action === "reroute"` |
| `decision.action_tier` | `"alert"` \| `"draft"` \| `"auto_execute"` | The combined call. In practice this demo only ever shows `alert` and `draft` |
| `decision.confidence` | number, 0–1 | Worth surfacing visually — low confidence (the wp-4 split case) is a real, meaningful signal, not noise to hide |
| `decision.rationale` | string | Real generated sentence(s), always present, always non-empty |
| `human_severity` / `cargo_severity` | `"low"` \| `"mid"` \| `"high"` | Pre-computed for you — this is what should drive your two-track severity encoding on the map and timeline. Don't recompute it from the other fields, just use it directly |

## What not to build

- No backend calls, no fetch, no loading states beyond what's needed to switch between the two hardcoded states above. Real data-fetching gets wired in afterward, separately.
- No design system deliverable — no token sheet, no component library docs. Just build the thing.
- No extra screens, routes, navigation, settings, or auth. One view, one control, two states.
- No claim-draft PDF viewer, no compliance PDF viewer — those exist elsewhere in the system already; this UI doesn't need to render them, `claim_draft_id` being non-null is enough to show that one exists.

## Handoff format

This gets pulled into an existing Next.js 15 / React 18 / TypeScript monorepo and wired to a real API afterward. Whatever you naturally output is fine, but if you have a choice: plain React function components (not a single monolithic page) with the data shape above passed in as props, rather than data fetching or state management baked into the components themselves. That makes swapping the hardcoded states for the real API a drop-in change instead of a rewrite.
