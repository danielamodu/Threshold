# Backup demo script

**Why this exists instead of a video file:** the sandboxed environment this
build ran in cannot screen-record — its recording surface only captures its
own interface, not other windows or processes, confirmed by testing (a
capture attempt showed the coding session itself, not the demo; a second
attempt found the launched terminal had no real window handle at all). Rather
than ship a broken or misleading video, this is the exact walkthrough: what to
click, what appears, and what it means. It takes under 90 seconds to record
yourself, following it verbatim, either against the live URL below or
`localhost:3000` after `npm run dev --workspace @threshold/web`.

**Live URL:** https://web-ivory-five-41.vercel.app

---

## The walkthrough (≈75 seconds)

**0:00 — Open the page.**
It loads showing the baseline run of a real 4-waypoint Phoenix, AZ route —
pharma cargo, one driver. Every waypoint is nominal: blue dots on the map,
`ALERT` at 0.9 confidence down the timeline. Say: *"This is one route. Every
heat reading here produces two independent liability checks — one for the
driver, one for the cargo — from the same event."*

**0:15 — Click "Inject heat spike at wp-3".**
This is the entire interaction model — one button. Watch wp-3's dot turn red
on the map immediately.

**0:25 — Point at wp-3 in the timeline.**
Both sides escalated from the same reading:
- **Human compliance**: heat index jumps to 61.4°C → *"Work limit reduced"*
- **Cargo risk**: exposure crosses its threshold → **BREACH** → *"Claim draft
  generated"*
- **Decision**: `DRAFT`, confidence 0.9 — say: *"No LLM here. This is a
  hard-coded rule reading both evaluators' outputs. Confidence isn't a model
  score — it's how much the two sides agree. They agree here, so it's high."*

**0:45 — Scroll to wp-4, the waypoint after the spike.**
This is the moment worth lingering on: **cargo is still in breach** —
exposure accumulates and never reverses — **while the driver side has already
recovered** to no action. Point at the decision line: confidence has dropped
to 0.5, and the rationale says so explicitly — *"the two evaluators disagree
sharply here... confidence is reported low to reflect that split rather than
overstating certainty."* Say: *"That's not a bug. That's the system telling
a reviewer where to look twice."*

**1:00 — Click "Reset route".**
Confirms it's reproducible, not a one-shot trick — same seed, same result,
every time.

**1:10 — Close on the core insight.**
*"One heat event. Two liability responses. Logged once, correlated by the
same event ID, in an append-only audit table that can't be edited after the
fact. That's the whole pitch."*

---

## If you'd rather show the raw pipeline output

`npm run simulate --workspace @threshold/api -- --spike wp-3=20` prints the
identical story as structured console output — every waypoint's real temp,
humidity, both evaluator verdicts, the decision and its full rationale, then
the audit log in insertion order. Useful as a second angle, or if the live
site is unreachable for any reason during judging.

`npm run simulate:real --workspace @threshold/api` runs the same shape
against the **real FortyGuard API** rather than synthetic data (see the
README's "Honest limitations" section for why it targets a historical
window) — takes about a minute per waypoint, so it's not the live-demo path,
but it's the actual proof this isn't simulated data dressed up.
