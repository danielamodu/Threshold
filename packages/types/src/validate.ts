/**
 * Runtime validators for the §3 contracts.
 *
 * TypeScript checks the shapes at compile time, which does nothing for data
 * crossing a real boundary — an API response, a database row, a fixture. These
 * exist so "contract-valid" is something a test can assert rather than a claim
 * in a commit message.
 *
 * They mirror §3 exactly, like contracts.ts, and carry the same rule: if a real
 * payload disagrees, reconcile the spec first. Do not loosen a validator to make
 * data pass.
 *
 * Each returns an array of human-readable violations. Empty means valid.
 */

import type {
  CargoRiskAssessment,
  ComplianceRecord,
  ThermalExposureEvent,
} from './contracts.js';

const CARGO_CLASSES = ['pharma', 'produce', 'general_reefer'];
const DATA_QUALITIES = ['complete', 'degraded_no_humidity'];
const COMPLIANCE_ACTIONS = ['rest_break_scheduled', 'work_limit_reduced', 'none'];
const SCHEDULE_TYPES = ['rest', 'reduced_load'];
const RISK_LEVELS = ['nominal', 'elevated', 'breach'];
const RECOMMENDED_ACTIONS = ['none', 'reroute', 'claim_draft'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function checkString(out: string[], obj: Record<string, unknown>, key: string): void {
  if (typeof obj[key] !== 'string' || (obj[key] as string).length === 0) {
    out.push(`${key} must be a non-empty string, got ${describe(obj[key])}`);
  }
}

function checkUuid(out: string[], obj: Record<string, unknown>, key: string): void {
  const v = obj[key];
  if (typeof v !== 'string' || !UUID_RE.test(v)) {
    out.push(`${key} must be a UUID, got ${describe(v)}`);
  }
}

function checkNumber(out: string[], obj: Record<string, unknown>, key: string): void {
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    out.push(`${key} must be a finite number, got ${describe(v)}`);
  }
}

function checkEnum(
  out: string[],
  obj: Record<string, unknown>,
  key: string,
  allowed: readonly string[],
): void {
  const v = obj[key];
  if (typeof v !== 'string' || !allowed.includes(v)) {
    out.push(`${key} must be one of ${allowed.join(' | ')}, got ${describe(v)}`);
  }
}

function checkIso8601(out: string[], obj: Record<string, unknown>, key: string): void {
  const v = obj[key];
  if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) {
    out.push(`${key} must be an ISO8601 timestamp, got ${describe(v)}`);
  }
}

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (typeof v === 'string') return `"${v}"`;
  return String(v);
}

/** §3 — ThermalExposureEvent, post-decision-log. */
export function validateThermalExposureEvent(value: unknown): string[] {
  const out: string[] = [];
  if (!isRecord(value)) return ['event must be an object'];

  checkUuid(out, value, 'event_id');
  checkString(out, value, 'route_id');
  checkString(out, value, 'waypoint_id');
  checkNumber(out, value, 'temp_c');
  checkIso8601(out, value, 'timestamp');
  checkEnum(out, value, 'data_quality', DATA_QUALITIES);

  if (value['source'] !== 'fortyguard_api') {
    out.push(`source must be exactly "fortyguard_api", got ${describe(value['source'])}`);
  }

  // humidity_pct is nullable (§8 decision 3) — but null is the ONLY permitted
  // non-number. Undefined or a zero-fill masquerading as a reading is not.
  const humidity = value['humidity_pct'];
  if (humidity !== null && (typeof humidity !== 'number' || !Number.isFinite(humidity))) {
    out.push(`humidity_pct must be a finite number or null, got ${describe(humidity)}`);
  }

  const stats = value['temp_stats'];
  if (!isRecord(stats)) {
    out.push(`temp_stats must be an object, got ${describe(stats)}`);
  } else {
    for (const key of ['mean', 'max', 'min', 'stddev']) checkNumber(out, stats, key);

    const { max, min, mean } = stats as { max?: number; min?: number; mean?: number };
    if (typeof max === 'number' && typeof min === 'number' && max < min) {
      out.push(`temp_stats.max (${max}) must be >= temp_stats.min (${min})`);
    }
    if (typeof mean === 'number' && typeof max === 'number' && mean > max) {
      out.push(`temp_stats.mean (${mean}) must be <= temp_stats.max (${max})`);
    }
    // §8 decision 1 — temp_c IS the Max. If they disagree, the pipeline has
    // quietly stopped honouring the decision, which is worth failing over.
    if (typeof max === 'number' && typeof value['temp_c'] === 'number' && value['temp_c'] !== max) {
      out.push(
        `temp_c (${String(value['temp_c'])}) must equal temp_stats.max (${max}) per §8 decision 1`,
      );
    }
  }

  // §8 decision 2 — this field was removed from the event contract.
  if ('heat_index_c' in value) {
    out.push('heat_index_c must NOT be present on ThermalExposureEvent (§8 decision 2)');
  }

  // Consistency between the two humidity-derived fields.
  if (humidity === null && value['data_quality'] !== 'degraded_no_humidity') {
    out.push('humidity_pct is null so data_quality must be "degraded_no_humidity"');
  }
  if (typeof humidity === 'number' && value['data_quality'] !== 'complete') {
    out.push('humidity_pct is present so data_quality must be "complete"');
  }

  return out;
}

/** §3 — ComplianceRecord. */
export function validateComplianceRecord(value: unknown): string[] {
  const out: string[] = [];
  if (!isRecord(value)) return ['record must be an object'];

  checkUuid(out, value, 'record_id');
  checkString(out, value, 'driver_id');
  checkUuid(out, value, 'event_id');
  checkEnum(out, value, 'action', COMPLIANCE_ACTIONS);
  checkIso8601(out, value, 'generated_at');

  const hi = value['heat_index_c'];
  if (hi !== null && (typeof hi !== 'number' || !Number.isFinite(hi))) {
    out.push(`heat_index_c must be a finite number or null, got ${describe(hi)}`);
  }

  const pdf = value['exported_pdf_url'];
  if (pdf !== null && typeof pdf !== 'string') {
    out.push(`exported_pdf_url must be a string or null, got ${describe(pdf)}`);
  }

  const schedule = value['schedule'];
  if (!Array.isArray(schedule)) {
    out.push(`schedule must be an array, got ${describe(schedule)}`);
  } else {
    schedule.forEach((entry, i) => {
      if (!isRecord(entry)) {
        out.push(`schedule[${i}] must be an object`);
        return;
      }
      checkIso8601(out, entry, 'start');
      checkIso8601(out, entry, 'end');
      checkEnum(out, entry, 'type', SCHEDULE_TYPES);
      const start = Date.parse(String(entry['start']));
      const end = Date.parse(String(entry['end']));
      if (!Number.isNaN(start) && !Number.isNaN(end) && end <= start) {
        out.push(`schedule[${i}].end must be after .start`);
      }
    });
  }

  return out;
}

/** §3 — CargoRiskAssessment. */
export function validateCargoRiskAssessment(value: unknown): string[] {
  const out: string[] = [];
  if (!isRecord(value)) return ['assessment must be an object'];

  checkUuid(out, value, 'assessment_id');
  checkUuid(out, value, 'event_id');
  checkEnum(out, value, 'cargo_class', CARGO_CLASSES);
  checkNumber(out, value, 'cumulative_exposure_score');
  checkNumber(out, value, 'threshold');
  checkEnum(out, value, 'risk_level', RISK_LEVELS);
  checkEnum(out, value, 'recommended_action', RECOMMENDED_ACTIONS);

  const claim = value['claim_draft_id'];
  if (claim !== null && (typeof claim !== 'string' || !UUID_RE.test(claim))) {
    out.push(`claim_draft_id must be a UUID or null, got ${describe(claim)}`);
  }

  const reroute = value['reroute_suggestion'];
  if (reroute !== null && !isRecord(reroute)) {
    out.push(`reroute_suggestion must be an object or null, got ${describe(reroute)}`);
  }

  return out;
}

/** Throwing wrapper for tests and boundaries. */
export function assertValid(
  label: string,
  violations: string[],
): void {
  if (violations.length > 0) {
    throw new Error(`${label} violates §3:\n  - ${violations.join('\n  - ')}`);
  }
}

export type { ThermalExposureEvent, ComplianceRecord, CargoRiskAssessment };
