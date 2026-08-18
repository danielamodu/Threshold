/**
 * Types and constants shared between the Server Action (actions.ts) and the
 * client components. Split out because a `'use server'` file may only export
 * async functions — everything else (types, the injector waypoint constant)
 * has to live elsewhere.
 */

import type { AgentDecision, CargoRiskAssessment, ComplianceRecord, ThermalExposureEvent } from '@threshold/types';

/** Where the injector button applies its spike — the demo's one dramatic beat. */
export const INJECTOR_WAYPOINT_ID = 'wp-3';

/**
 * Mirrors `@threshold/decision-layer`'s `SeverityBucket` by value, not by
 * import. Client components (RouteMap, Timeline) render this pre-computed
 * field rather than importing decision-layer themselves — that package's
 * barrel also exports the fallback decider, which pulls in `node:crypto` and
 * cannot be bundled for the browser. Computing severity server-side in
 * actions.ts and shipping the plain string keeps client components
 * presentation-only, which they should be anyway.
 */
export type SeverityBucket = 'low' | 'mid' | 'high';

export interface DemoWaypoint {
  waypoint_id: string;
  lat: number;
  lng: number;
  event: ThermalExposureEvent;
  compliance: ComplianceRecord;
  cargo: CargoRiskAssessment;
  decision: AgentDecision;
  human_severity: SeverityBucket;
  cargo_severity: SeverityBucket;
}

export interface DemoRunResult {
  route_id: string;
  cargo_class: string;
  driver_id: string;
  spiked: boolean;
  waypoints: DemoWaypoint[];
}
