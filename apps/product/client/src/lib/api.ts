import type { CargoClass } from "@threshold/types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, token: string | null, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new ApiError(res.status, body.error ?? `Request failed with status ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface ApiRoute {
  id: string;
  org_id: string;
  route_id: string;
  cargo_class: CargoClass;
  driver_id: string;
  created_at: string;
}

/** Mirrors packages/types/src/audit.ts's AuditLogEntry — the real shape GET /api/audit returns. */
export interface ApiAuditEntry {
  seq: number;
  entry_id: string;
  entry_type:
    | "thermal_exposure_event"
    | "compliance_record"
    | "cargo_risk_assessment"
    | "agent_decision"
    | "claim_draft";
  event_id: string;
  route_id: string | null;
  org_id: string;
  payload: Record<string, unknown>;
  rationale: string | null;
  occurred_at: string | null;
  recorded_at: string;
}

/** Mirrors packages/accounts/src/drivers.ts's Driver. */
export interface ApiDriver {
  id: string;
  org_id: string;
  driver_id: string;
  name: string | null;
  clerk_user_id: string | null;
  created_at: string;
}

export interface AuditResponse {
  entries: ApiAuditEntry[];
  driver_unlinked?: boolean;
  driver_id?: string;
}

export function listRoutes(token: string | null) {
  return request<{ routes: ApiRoute[] }>("/api/routes", token);
}

export function getRoute(token: string | null, routeId: string) {
  return request<ApiRoute>(`/api/routes/${encodeURIComponent(routeId)}`, token);
}

export function createRoute(
  token: string | null,
  body: { route_id: string; driver_id: string; cargo_class: CargoClass },
) {
  return request<ApiRoute>("/api/routes", token, { method: "POST", body: JSON.stringify(body) });
}

export function listAudit(token: string | null) {
  return request<AuditResponse>("/api/audit", token);
}

/** The caller's own driver link, or null. Any role may call this; it only reports themselves. */
export function getMyDriver(token: string | null) {
  return request<{ driver: ApiDriver | null }>("/api/drivers/me", token);
}

/** org_admin only — the org_management permission gates all three below. */
export function listDrivers(token: string | null) {
  return request<{ drivers: ApiDriver[] }>("/api/drivers", token);
}

export function createDriver(
  token: string | null,
  body: { driver_id: string; name?: string; clerk_user_id?: string },
) {
  return request<ApiDriver>("/api/drivers", token, { method: "POST", body: JSON.stringify(body) });
}

/** Pass `clerk_user_id: null` to unlink. */
export function linkDriver(token: string | null, driverId: string, clerkUserId: string | null) {
  return request<ApiDriver>(`/api/drivers/${encodeURIComponent(driverId)}/link`, token, {
    method: "POST",
    body: JSON.stringify({ clerk_user_id: clerkUserId }),
  });
}

export function inviteDriver(token: string | null, driverId: string, email: string) {
  return request<{ invitation_id: string; email_address: string; status: string; driver_id: string }>(
    `/api/drivers/${encodeURIComponent(driverId)}/invite`,
    token,
    { method: "POST", body: JSON.stringify({ email }) },
  );
}

export function updateDriver(token: string | null, driverId: string, body: { name: string | null }) {
  return request<ApiDriver>(`/api/drivers/${encodeURIComponent(driverId)}`, token, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export interface ForecastWaypoint {
  waypoint_id: string;
  lat: number;
  lng: number;
  projected_time: string;
  projected_temp_c: number;
  temp_stats: { mean: number; max: number; min: number; stddev: number };
  humidity_pct: number | null;
  data_quality: string;
  cargo: { risk_level: string; recommended_action: string; cumulative_exposure_score: number; threshold: number };
  cargo_severity: string;
  compliance: { action: string; heat_index_c: number | null };
  human_severity: string;
}

export interface ForecastResult {
  route_id: string;
  cargo_class: string;
  driver_id: string;
  departure_time: string;
  forecast_source: string;
  waypoints: ForecastWaypoint[];
  route_risk_summary: {
    safe_to_depart: boolean;
    highest_risk_level: string;
    first_breach_waypoint: string | null;
    first_breach_time: string | null;
    total_waypoints: number;
    breached_waypoints: number;
  };
}

export function getForecast(token: string | null, routeId: string, body: { departure_time: string }) {
  return request<ForecastResult>(`/api/routes/${encodeURIComponent(routeId)}/forecast`, token, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** LocalFilePdfStore returns a relative /pdfs/... URL — apps/api serves it, not this app. */
export function resolvePdfUrl(exportedPdfUrl: string | null | undefined): string | null {
  if (!exportedPdfUrl) return null;
  if (exportedPdfUrl.startsWith("memory://")) return null; // never resolvable — ephemeral store
  return `${API_BASE}${exportedPdfUrl}`;
}
