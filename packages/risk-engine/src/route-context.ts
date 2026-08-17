/**
 * Route assignment context.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * §3's `ThermalExposureEvent` carries no `driver_id` and no `cargo_class`. But
 * `ComplianceRecord` needs a driver and `CargoRiskAssessment` needs a cargo
 * class. Those two fields live on `WaypointTelemetry`, which is ingestion's
 * shape, not the bus's.
 *
 * Rather than widen the locked §3 event — which would be a contract change, and
 * those go through you, not through me — the evaluators take the thermal
 * reading from the event and the assignment metadata from here, joined on
 * `route_id`. The event stays exactly as §3 defines it, both evaluators still
 * consume the SAME event, and the pipeline does not fork.
 *
 * This is reference data, not stream data: a route's driver and cargo class do
 * not change per waypoint.
 */

import type { CargoClass } from '@threshold/types';

export interface RouteContext {
  route_id: string;
  driver_id: string;
  cargo_class: CargoClass;
}

export interface RouteContextProvider {
  get(route_id: string): RouteContext | undefined;
}

export class UnknownRouteError extends Error {
  constructor(route_id: string) {
    super(
      `No route context registered for route_id "${route_id}". An evaluator ` +
        `cannot attribute an event to a driver or a cargo class without it.`,
    );
    this.name = 'UnknownRouteError';
  }
}

/** In-memory provider. The telemetry adapter registers its routes here. */
export class RouteRegistry implements RouteContextProvider {
  private readonly routes = new Map<string, RouteContext>();

  register(context: RouteContext): this {
    this.routes.set(context.route_id, context);
    return this;
  }

  get(route_id: string): RouteContext | undefined {
    return this.routes.get(route_id);
  }

  require(route_id: string): RouteContext {
    const found = this.routes.get(route_id);
    if (!found) throw new UnknownRouteError(route_id);
    return found;
  }
}
