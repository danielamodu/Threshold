import type { GeoJsonFeatureCollection } from './api-types.js';

/**
 * Area-of-interest geometry helpers.
 *
 * `POST /v1/heatmap` takes a polygon AOI, not a coordinate — there is no
 * point-lookup endpoint. A route waypoint is a point, so every waypoint query
 * needs a small box built around it. That request-shaping belongs to the
 * client; the routing, batching, and pre-fetch queue around it are Phase 1.
 */

const KM_PER_DEGREE_LAT = 111.32;
const SQ_KM_PER_SQ_MILE = 2.589988;

/** Plan ceilings from the Create Heatmap docs. */
export const MAX_AOI_SQ_MILES_BASIC = 10;
export const MAX_AOI_SQ_MILES_PREMIUM = 50;

/**
 * A square AOI centred on a coordinate.
 *
 * Ring winding matches the order used in FortyGuard's own documented example:
 * (minLng,minLat) → (maxLng,minLat) → (maxLng,maxLat) → (minLng,maxLat) → close.
 */
export function squareAoiAround(
  lat: number,
  lng: number,
  sideKm: number,
): GeoJsonFeatureCollection {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new RangeError(`lat must be within [-90, 90], got ${lat}`);
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new RangeError(`lng must be within [-180, 180], got ${lng}`);
  }
  if (!Number.isFinite(sideKm) || sideKm <= 0) {
    throw new RangeError(`sideKm must be positive, got ${sideKm}`);
  }

  const halfLat = sideKm / 2 / KM_PER_DEGREE_LAT;

  // Longitude degrees shrink toward the poles. Clamp the cosine so an extreme
  // latitude cannot produce a division by ~0 and an absurdly wide box.
  const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), 0.01);
  const halfLng = sideKm / 2 / (KM_PER_DEGREE_LAT * cosLat);

  const minLat = lat - halfLat;
  const maxLat = lat + halfLat;
  const minLng = lng - halfLng;
  const maxLng = lng + halfLng;

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [minLng, minLat],
              [maxLng, minLat],
              [maxLng, maxLat],
              [minLng, maxLat],
              [minLng, minLat],
            ],
          ],
        },
      },
    ],
  };
}

/** Approximate area of a `squareAoiAround` box, in square miles. */
export function squareAoiAreaSqMiles(sideKm: number): number {
  return (sideKm * sideKm) / SQ_KM_PER_SQ_MILE;
}

/**
 * Largest square side (km) that stays inside a plan's area ceiling.
 * Basic → ~5.09 km; Premium → ~11.38 km.
 */
export function maxSquareSideKm(maxSqMiles: number): number {
  return Math.sqrt(maxSqMiles * SQ_KM_PER_SQ_MILE);
}
