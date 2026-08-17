/**
 * Severity buckets for the Phase 3 fallback decision path (§9).
 *
 * Deliberately derived ONLY from fields already written to the audit log —
 * ComplianceRecord.action and CargoRiskAssessment.risk_level — rather than
 * from risk-engine's richer internal band/level types (which are ergonomic
 * extras on the evaluator's return value and never persisted anywhere).
 *
 * That keeps every fallback decision reconstructible from audited data alone:
 * pull the two records this decision references, and this file's rule is the
 * whole story. Nothing the decision depended on lived only in memory during
 * evaluation and then vanished — which is exactly the property §2's Audit
 * Layer exists to guarantee ("we can show exactly why this fired").
 */

import type { CargoRiskLevel, ComplianceAction } from '@threshold/types';

export type SeverityBucket = 'low' | 'mid' | 'high';

export function complianceSeverity(action: ComplianceAction): SeverityBucket {
  switch (action) {
    case 'none':
      return 'low';
    case 'rest_break_scheduled':
      return 'mid';
    case 'work_limit_reduced':
      return 'high';
  }
}

export function cargoSeverity(risk_level: CargoRiskLevel): SeverityBucket {
  switch (risk_level) {
    case 'nominal':
      return 'low';
    case 'elevated':
      return 'mid';
    case 'breach':
      return 'high';
  }
}

const RANK: Record<SeverityBucket, number> = { low: 0, mid: 1, high: 2 };

export function rank(bucket: SeverityBucket): number {
  return RANK[bucket];
}

export function higher(a: SeverityBucket, b: SeverityBucket): SeverityBucket {
  return RANK[a] >= RANK[b] ? a : b;
}
