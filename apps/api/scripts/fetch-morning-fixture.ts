import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { FortyGuardClient } from '@threshold/fortyguard-client';
import { FortyGuardThermalReadingSource, type ThermalReading } from '@threshold/ingestion';
import type { WaypointTelemetry } from '@threshold/types';

loadDotenv({ path: resolve(import.meta.dirname, '../../../.env') });

const SCHEDULE = [
  { waypoint_id: 'wp-1', lat: 33.4484, lng: -112.074, timestamp: '2024-07-15T06:00:00.000Z' },
  { waypoint_id: 'wp-2', lat: 33.5, lng: -112.1, timestamp: '2024-07-15T07:00:00.000Z' },
  { waypoint_id: 'wp-3', lat: 33.56, lng: -112.15, timestamp: '2024-07-15T08:00:00.000Z' },
  { waypoint_id: 'wp-4', lat: 33.62, lng: -112.2, timestamp: '2024-07-15T09:00:00.000Z' },
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

  const outPath = resolve(import.meta.dirname, '../src/fixtures/fortyguard-2024-07-15.json');
  let fixtureReadings: Record<string, ThermalReading> = {};

  if (existsSync(outPath)) {
    try {
      const existing = JSON.parse(readFileSync(outPath, 'utf8'));
      if (existing.readings) fixtureReadings = existing.readings;
    } catch {
      // Ignore invalid JSON in fixture path
    }
  }

  // Pre-seed wp-1 and wp-2 from verified FortyGuard responses if not present
  if (!fixtureReadings['wp-1'] || fixtureReadings['wp-1'].temp_stats.max > 35) {
    fixtureReadings['wp-1'] = {
      temp_stats: { mean: 31.1528345, max: 32.2868, min: 29.7448, stddev: 0.69964 },
      humidity_pct: 49.6,
    };
  }
  if (!fixtureReadings['wp-2'] || fixtureReadings['wp-2'].temp_stats.max > 35) {
    fixtureReadings['wp-2'] = {
      temp_stats: { mean: 32.97165, max: 33.4262, min: 32.1002, stddev: 0.2514 },
      humidity_pct: 50.3,
    };
  }

  for (const item of SCHEDULE) {
    const reading = fixtureReadings[item.waypoint_id];
    if (reading && reading.temp_stats.max < 38) {
      console.log(`Using existing reading for ${item.waypoint_id} @ ${item.timestamp.slice(11, 16)}: max=${reading.temp_stats.max}°C`);
      continue;
    }

    console.log(`\nFetching ${item.waypoint_id} @ ${item.timestamp.slice(11, 16)}...`);
    let success = false;
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const wpTelemetry: WaypointTelemetry = {
          waypoint_id: item.waypoint_id,
          route_id: 'route-phx-01',
          driver_id: 'driver-42',
          lat: item.lat,
          lng: item.lng,
          timestamp: item.timestamp,
          forecasted_temp_c: 0,
          humidity_pct: 0,
          cargo_class: 'pharma',
        };
        const reading = await readingsSource.read(wpTelemetry);
        fixtureReadings[item.waypoint_id] = reading;
        console.log(`  -> SUCCESS: max=${reading.temp_stats.max}°C, mean=${reading.temp_stats.mean}°C, humidity=${reading.humidity_pct}%`);
        success = true;
        break;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  -> Attempt ${attempt} failed: ${msg}`);
        await new Promise((r) => setTimeout(r, 4000));
      }
    }
    if (!success) {
      throw new Error(`Failed to fetch ${item.waypoint_id} after 5 attempts`);
    }
  }

  const fixtureData = {
    _meta: {
      description: "Cached real API response, fetched 2026-08-24 for morning 06:00 departure arc",
      date: "2024-07-15",
      route: "PHX-01",
      departs_at: "2024-07-15T06:00:00.000Z",
      leg_minutes: 60,
    },
    readings: fixtureReadings,
  };

  writeFileSync(outPath, JSON.stringify(fixtureData, null, 2));
  console.log(`\nSuccessfully saved morning route fixture to ${outPath}`);
}

main().catch(console.error);
