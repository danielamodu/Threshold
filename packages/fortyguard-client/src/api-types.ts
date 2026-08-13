/**
 * FortyGuard Enterprise API wire types.
 *
 * Transcribed from the live docs at https://docs-api.fortyguard.com (read
 * 2026-08-13). These describe FortyGuard's payloads — they are deliberately
 * NOT the §3 contracts, and nothing here should be imported as if it were.
 * Mapping between the two happens in Phase 1 ingestion, not here.
 */

/** Every response is wrapped in this envelope. */
export interface FortyGuardEnvelope<TData> {
  error: boolean;
  status_code: number;
  message: string;
  data: TData;
}

/** Body of a successful submission to any POST endpoint. */
export interface SubmitData {
  activity_id: string;
}

/**
 * Raw status strings. The Create Heatmap docs use `Processing | Completed |
 * Failed`; the Quickstart's own sample additionally accepts `succeeded` and
 * `error`. We normalise case-insensitively across all five — see
 * `normalizeStatus` in ./status.ts.
 */
export type RawActivityStatus = string;

/** Body of a status response. `result` is present once status is Completed. */
export interface StatusData<TResult> {
  activity_id: string;
  status: RawActivityStatus;
  result?: TResult;
}

// ---------------------------------------------------------------------------
// GeoJSON (only the subset the API accepts / returns)
// ---------------------------------------------------------------------------

export interface GeoJsonPolygon {
  type: 'Polygon';
  /** Array of linear rings; each ring is an array of [lng, lat] positions. */
  coordinates: number[][][];
}

export interface GeoJsonFeature<TGeometry = GeoJsonPolygon> {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: TGeometry;
}

export interface GeoJsonFeatureCollection<TGeometry = GeoJsonPolygon> {
  type: 'FeatureCollection';
  features: GeoJsonFeature<TGeometry>[];
}

// ---------------------------------------------------------------------------
// POST /v1/heatmap
// ---------------------------------------------------------------------------

/**
 * 1 = single hour (needs start_date + start_time)
 * 2 = range of hours, same day (needs start_date + start_time + end_time)
 * 3 = single day (needs start_date only; covers 00:00–23:59)
 * 4 = range of days, <= 1 month (needs start_date + end_date)
 */
export type FilterType = 1 | 2 | 3 | 4;

/** Spatial resolution in metres. */
export type Granularity = 60 | 80 | 100;

/**
 * tcm              — temperature snapshot, °C per tile (default)
 * time_of_measure  — hour of day (0–23 UTC) of peak temperature
 * exceedance       — hours above/below `threshold`
 * persistence      — longest continuous run past `threshold`
 *
 * Only `tcm` yields °C. The others report hours (stats_data.units === 'hour').
 */
export type AnalyticType = 'tcm' | 'time_of_measure' | 'exceedance' | 'persistence';

export interface DateTimeFilter {
  /** YYYY-MM-DD. Valid range: 2019-01-01 .. now + 12h. */
  start_date: string;
  filter_type: FilterType;
  /** YYYY-MM-DD. Required for filter_type 4; auto-populated for 1–3. */
  end_date?: string;
  /** HH:MM, 24h. Required for filter_type 1 and 2. */
  start_time?: string;
  /** HH:MM, 24h. Required for filter_type 2; auto-set to start_time+1h for 1. */
  end_time?: string;
}

export interface HeatmapRequest {
  polygon_aoi: GeoJsonFeatureCollection;
  date_time: DateTimeFilter;
  granularity: Granularity;
  analytic_type?: AnalyticType;
  /** °C threshold for exceedance / persistence. Defaults to 30. */
  threshold?: number;
  /** Threshold direction for exceedance / persistence. Defaults to 'above'. */
  direction?: 'above' | 'below';
}

export interface HeatmapTemperatureStats {
  Minimum?: number;
  Maximum?: number;
  Mean?: number;
  Standard_deviation?: number;
}

export interface HeatmapStatsData {
  Temperature_stats?: HeatmapTemperatureStats;
  Overall_temperature_distribution?: number[];
  Normal_temperature_distribution?: { x_axis?: number[]; y_axis?: number[] };
  Temperature_frequency?: Record<string, number>;
  /** 'hour' for time_of_measure / exceedance / persistence. */
  units?: string;
  [key: string]: unknown;
}

export interface HeatmapResult {
  map_data: GeoJsonFeatureCollection;
  stats_data: HeatmapStatsData;
}

// ---------------------------------------------------------------------------
// POST /v1/env_params
// ---------------------------------------------------------------------------

/**
 * Environmental parameter keys. API Basic is capped at 3 per request; Premium
 * has full access. Omitting `analysis` requests all of them.
 */
export type EnvParameterName =
  | 'heat_index_celsius'
  | 'apparent_temperature_celsius'
  | 'wet_bulb_temperature_celsius'
  | 'relative_humidity_percent'
  | 'precipitation_mm'
  | 'cloud_cover_octas'
  | 'elevation'
  | 'air_quality:idx'
  | 'air_quality_pm2p5:idx'
  | 'air_quality_pm10:idx'
  | 'air_quality_no2:idx'
  | 'aqi_us_co'
  | 'air_quality_o3:idx'
  | 'air_quality_so2:idx'
  | 'methane_ppb'
  | 'co2_ppm'
  | 'solar_irradiance';

export interface EnvParamsRequest {
  latitude: number;
  longitude: number;
  /**
   * NOTE: temperature is an INPUT here. /env_params does not source temperature
   * — it enriches a temperature you already hold, normally one produced by a
   * prior /heatmap job for the same coordinate and timestamp.
   */
  temperature: number;
  date_time: DateTimeFilter;
  analysis?: EnvParameterName[];
}

/**
 * Time-aligned arrays, one value per entry in `metadata.timestamps`.
 * `null` means the upstream provider had no data — it does NOT mean zero.
 * Legacy stored responses may carry -999 for the same meaning.
 */
export interface EnvParameters {
  heat_index_celsius?: (number | null)[];
  apparent_temperature_celsius?: (number | null)[];
  wet_bulb_temperature_celsius?: (number | null)[];
  relative_humidity_percent?: (number | null)[];
  precipitation_mm?: (number | null)[];
  cloud_cover_octas?: (number | null)[];
  [key: string]: (number | null)[] | undefined;
}

export interface EnvParamsLocation {
  lat: number;
  lon: number;
  elevation?: number;
  temperature?: number;
  parameters: EnvParameters;
  solar_irradiance?: {
    clear_sky?: { ghi?: number; dni?: number; dhi?: number };
    description?: string;
  };
}

export interface EnvParamsMetadata {
  timezone?: string;
  timezone_offset_hours?: number;
  time_range?: { start?: string; end?: string; interval?: string; count?: number };
  timestamps?: string[];
}

export interface EnvParamsResult {
  metadata: EnvParamsMetadata;
  locations: EnvParamsLocation[];
}
