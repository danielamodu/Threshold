/**
 * Wire types for Motive's vehicle-location-history endpoint, as documented at
 * developer-docs.gomotive.com/reference/fetch-a-vehicles-location-using-its-id-v3
 * (verified against that page directly — not assumed from memory). UNVERIFIED
 * against a live response: no sandbox credentials exist yet (see
 * motive-source.ts's header for why, and what unblocks it).
 */

export interface MotiveDriver {
  id: number;
  first_name: string;
  last_name: string;
  username: string;
  email: string | null;
  driver_company_id: string;
  status: string;
  role: string;
}

export interface MotiveEldDevice {
  id: number;
  identifier: string;
  model: string;
}

/** One GPS/ELD breadcrumb for a single vehicle. */
export interface MotiveVehicleLocation {
  id: string;
  located_at: string; // ISO 8601
  lat: number;
  lon: number;
  bearing: number | null;
  speed: number;
  type: string; // e.g. 'vehicle_moving', 'breadcrumb'
  description: string;
  driver: MotiveDriver | null;
  eld_device: MotiveEldDevice | null;
}

export interface MotiveVehicleLocationHistoryResponse {
  vehicle_locations: { vehicle_location: MotiveVehicleLocation }[];
}

export interface GetVehicleLocationHistoryParams {
  vehicleId: number;
  /** yyyy-mm-dd */
  startDate: string;
  /** yyyy-mm-dd. Window vs startDate must not exceed 3 months (Motive's own limit). */
  endDate: string;
  /**
   * "Filters records modified after this timestamp" per Motive's docs, which
   * document it as required alongside startDate/endDate. Defaults to
   * startDate when omitted — unverified against a live response which of
   * these two readings of "required" is actually enforced.
   */
  updatedAfter?: string;
}
