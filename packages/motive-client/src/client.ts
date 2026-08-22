import type { MotiveConfig } from './config.js';
import { HttpTransport } from './http.js';
import type {
  GetVehicleLocationHistoryParams,
  MotiveVehicleLocationHistoryResponse,
} from './api-types.js';

/**
 * Motive Public API client — the vehicle-location-history endpoint only
 * (§11 Phase 8's actual need). Motive's API surface is much larger; this
 * client deliberately covers just the one contract motive-source.ts consumes,
 * the same scoping @threshold/fortyguard-client applies to FortyGuard's API.
 */
export class MotiveClient {
  private readonly http: HttpTransport;

  constructor(config: MotiveConfig) {
    this.http = new HttpTransport(config);
  }

  /**
   * GET /v3/vehicle_locations/{id}?start_date&end_date&updated_after
   * developer-docs.gomotive.com/reference/fetch-a-vehicles-location-using-its-id-v3
   *
   * Motive documents the start_date/end_date window as capped at 3 months;
   * that's the caller's responsibility to respect (this client does not
   * clamp or validate it — same "thin transport" boundary as
   * @threshold/fortyguard-client's HttpTransport).
   */
  async getVehicleLocationHistory(
    params: GetVehicleLocationHistoryParams,
  ): Promise<MotiveVehicleLocationHistoryResponse> {
    return this.http.get<MotiveVehicleLocationHistoryResponse>(
      `/v3/vehicle_locations/${params.vehicleId}`,
      {
        start_date: params.startDate,
        end_date: params.endDate,
        updated_after: params.updatedAfter ?? params.startDate,
      },
    );
  }
}
