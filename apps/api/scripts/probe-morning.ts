import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { FortyGuardClient } from '@threshold/fortyguard-client';
import { FortyGuardThermalReadingSource } from '@threshold/ingestion';
import type { WaypointTelemetry } from '@threshold/types';

loadDotenv({ path: resolve(import.meta.dirname, '../../../.env') });

const WAYPOINTS = [
  { waypoint_id: 'wp-1', lat: 33.4484, lng: -112.074 },
  { waypoint_id: 'wp-2', lat: 33.5, lng: -112.1 },
];

const TEST_TIMES = [
  '2024-07-15T06:00:00.000Z',
  '2024-07-15T08:00:00.000Z',
];

async function main() {
  const client = FortyGuardClient.fromEnv();
  const readingsSource = new FortyGuardThermalReadingSource({
    client,
    anchorDate: '2024-07-15',
    onWaypointProgress: ({ waypoint, stage, state, activityId }) => {
      if (state !== 'completed' && state !== 'failed') return;
      console.log(`  ${waypoint.waypoint_id} (${waypoint.timestamp.slice(11, 16)})  ${stage.padEnd(11)} ${state.padEnd(11)} ${activityId.slice(0, 8)}…`);
    },
  });

  console.log('--- Probing FortyGuard for Morning Hours (06:00, 08:00) on 2024-07-15 ---');

  for (const timeStr of TEST_TIMES) {
    console.log(`\nTesting timestamp: ${timeStr}`);
    for (const wp of WAYPOINTS) {
      const wpTelemetry: WaypointTelemetry = {
        waypoint_id: wp.waypoint_id,
        route_id: 'route-phx-01',
        driver_id: 'driver-42',
        lat: wp.lat,
        lng: wp.lng,
        timestamp: timeStr,
        forecasted_temp_c: 0,
        humidity_pct: 0,
        cargo_class: 'pharma',
      };

      try {
        const reading = await readingsSource.read(wpTelemetry);
        console.log(`  SUCCESS [${wp.waypoint_id} @ ${timeStr.slice(11, 16)}]: temp_max=${reading.temp_stats.max}°C, mean=${reading.temp_stats.mean}°C, humidity=${reading.humidity_pct}%`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`  FAILED [${wp.waypoint_id} @ ${timeStr.slice(11, 16)}]: ${msg}`);
      }
    }
  }
}

main().catch(console.error);
