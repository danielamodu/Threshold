/**
 * Signal Cabinet style reminder: data is an evidence record, not dashboard filler.
 * Keep fields close to the API shape so live route data can replace these two fixtures.
 */
export type Severity = "low" | "mid" | "high";

export type Waypoint = {
  waypoint_id: string;
  shortLabel: string;
  place: string;
  event: { temp_c: number; humidity_pct: number | null; data_quality: "complete" | "degraded_no_humidity"; timestamp: string };
  compliance: { heat_index_c: number | null; action: "none" | "rest_break_scheduled" | "work_limit_reduced" };
  cargo: { cumulative_exposure_score: number; threshold: number; risk_level: "nominal" | "elevated" | "breach"; recommended_action: "none" | "reroute" | "claim_draft" };
  decision: { confidence: number; action_tier: "alert" | "draft" | "auto_execute"; rationale: string; summary: string };
  human_severity: Severity;
  cargo_severity: Severity;
  position: { x: number; y: number };
};

export const routeMeta = {
  route_id: "route-phx-01",
  cargo_class: "pharma",
  driver_id: "driver-42",
  departure: "Phoenix, AZ",
  arrival: "North Valley, AZ",
};

const nominalRationale = (temp: number, heat: number) =>
  `This is a hard-coded-threshold decision (no model involved): the driver side scheduled “none” (heat index ${heat.toFixed(1)}°C) — low severity; the cargo side reports “nominal” (0/12 °C·h cumulative exposure for pharma) — low severity. Neither side has reached its most severe level, so this stays at alert only — logged, no drafted action. The two evaluators agree closely, so this combined call is reported with high confidence (0.9).`;

export const baselineWaypoints: Waypoint[] = [
  {
    waypoint_id: "wp-1", shortLabel: "01", place: "PHX / START", position: { x: 17, y: 73 },
    event: { temp_c: 29.15, humidity_pct: 47.4, data_quality: "complete", timestamp: "2026-08-17T13:00:00.000Z" },
    compliance: { heat_index_c: 29.5, action: "none" }, cargo: { cumulative_exposure_score: 0, threshold: 12, risk_level: "nominal", recommended_action: "none" },
    decision: { confidence: 0.9, action_tier: "alert", rationale: nominalRationale(29.15, 29.5), summary: "Both evaluators remain nominal. Alert logged; no response drafted." }, human_severity: "low", cargo_severity: "low",
  },
  {
    waypoint_id: "wp-2", shortLabel: "02", place: "I-17 / NORTH", position: { x: 36, y: 59 },
    event: { temp_c: 29.86, humidity_pct: 45.7, data_quality: "complete", timestamp: "2026-08-17T14:00:00.000Z" },
    compliance: { heat_index_c: 30.2, action: "none" }, cargo: { cumulative_exposure_score: 0, threshold: 12, risk_level: "nominal", recommended_action: "none" },
    decision: { confidence: 0.9, action_tier: "alert", rationale: nominalRationale(29.86, 30.2), summary: "Both evaluators remain nominal. Alert logged; no response drafted." }, human_severity: "low", cargo_severity: "low",
  },
  {
    waypoint_id: "wp-3", shortLabel: "03", place: "DEER VALLEY", position: { x: 59, y: 36 },
    event: { temp_c: 30.34, humidity_pct: 43.8, data_quality: "complete", timestamp: "2026-08-17T15:00:00.000Z" },
    compliance: { heat_index_c: 30.7, action: "none" }, cargo: { cumulative_exposure_score: 0, threshold: 12, risk_level: "nominal", recommended_action: "none" },
    decision: { confidence: 0.9, action_tier: "alert", rationale: nominalRationale(30.34, 30.7), summary: "Both evaluators remain nominal. Alert logged; no response drafted." }, human_severity: "low", cargo_severity: "low",
  },
  {
    waypoint_id: "wp-4", shortLabel: "04", place: "NORTH VALLEY", position: { x: 83, y: 19 },
    event: { temp_c: 29.02, humidity_pct: 48.6, data_quality: "complete", timestamp: "2026-08-17T16:00:00.000Z" },
    compliance: { heat_index_c: 29.4, action: "none" }, cargo: { cumulative_exposure_score: 0, threshold: 12, risk_level: "nominal", recommended_action: "none" },
    decision: { confidence: 0.9, action_tier: "alert", rationale: nominalRationale(29.02, 29.4), summary: "Both evaluators remain nominal. Alert logged; no response drafted." }, human_severity: "low", cargo_severity: "low",
  },
];

export const injectedWaypoints: Waypoint[] = baselineWaypoints.map((point) => ({ ...point }));

injectedWaypoints[2] = {
  ...baselineWaypoints[2],
  event: { temp_c: 50.21, humidity_pct: 40.4, data_quality: "complete", timestamp: "2026-08-17T15:00:00.000Z" },
  compliance: { heat_index_c: 61.4, action: "work_limit_reduced" },
  cargo: { cumulative_exposure_score: 20.33, threshold: 12, risk_level: "breach", recommended_action: "claim_draft" },
  decision: { confidence: 0.9, action_tier: "draft", rationale: "This is a hard-coded-threshold decision (no model involved): the driver side scheduled “work_limit_reduced” (heat index 61.4°C) — high severity; the cargo side reports “breach” (20.33/12 °C·h cumulative exposure for pharma) — high severity. At least one side reached its most severe level, so this is escalated to a draft response for a human to review before anything is sent. The two evaluators agree closely, so this combined call is reported with high confidence (0.9).", summary: "Both evaluators escalated at the same location. Draft response opened for review." },
  human_severity: "high", cargo_severity: "high",
};

injectedWaypoints[3] = {
  ...baselineWaypoints[3],
  event: { temp_c: 28.67, humidity_pct: 48.6, data_quality: "complete", timestamp: "2026-08-17T16:00:00.000Z" },
  compliance: { heat_index_c: 29.1, action: "none" },
  cargo: { cumulative_exposure_score: 20.33, threshold: 12, risk_level: "breach", recommended_action: "claim_draft" },
  decision: { confidence: 0.5, action_tier: "draft", rationale: "This is a hard-coded-threshold decision (no model involved): the driver side scheduled “none” (heat index 29.1°C) — low severity; the cargo side reports “breach” (20.33/12 °C·h cumulative exposure for pharma) — high severity. At least one side reached its most severe level, so this is escalated to a draft response for a human to review before anything is sent. The two evaluators disagree sharply here (one low, one high), which is itself worth a reviewer’s attention — confidence is reported low (0.5) to reflect that split rather than overstating certainty in a combined call.", summary: "Driver recovery conflicts with a persistent cargo breach. Confidence is reduced for review." },
  human_severity: "low", cargo_severity: "high",
};

export const getTime = (timestamp: string) => new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(new Date(timestamp));
