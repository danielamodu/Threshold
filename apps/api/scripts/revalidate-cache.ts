import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { readFile, writeFileSync } from 'node:fs';
import { FortyGuardClient } from '@threshold/fortyguard-client';
import { FortyGuardThermalReadingSource, SimulatedTelemetryAdapter, type RouteSpec, type ThermalReading } from '@threshold/ingestion';
import { promisify } from 'node:util';

const readFileAsync = promisify(readFile);

loadDotenv({ path: resolve(import.meta.dirname, '../../../.env') });

const ROUTE: RouteSpec = {
  route_id: 'route-phx-01',
  driver_id: 'driver-42',
  cargo_class: 'pharma',
  departs_at: '2024-07-15T06:00:00.000Z',
  leg_minutes: 60,
  waypoints: [
    { waypoint_id: 'wp-1', lat: 33.4484, lng: -112.074 },
    { waypoint_id: 'wp-2', lat: 33.5, lng: -112.1 },
    { waypoint_id: 'wp-3', lat: 33.56, lng: -112.15 },
    { waypoint_id: 'wp-4', lat: 33.62, lng: -112.2 },
  ],
};

async function main() {
  const fixturePath = resolve(import.meta.dirname, '../src/fixtures/fortyguard-2024-07-15.json');
  
  let existingCache: { readings?: Record<string, ThermalReading> } | null = null;
  try {
    const raw = await readFileAsync(fixturePath, 'utf8');
    existingCache = JSON.parse(raw);
  } catch {
    console.log('No existing cache found. A new one will be created.');
  }

  const client = FortyGuardClient.fromEnv();
  const readingsSource = new FortyGuardThermalReadingSource({
    client,
    anchorDate: '2024-07-15',
    onWaypointProgress: ({ waypoint, stage, state, activityId }) => {
      if (state !== 'completed' && state !== 'failed') return;
      console.log(`  ${waypoint.waypoint_id}  ${stage.padEnd(11)} ${state.padEnd(11)} ${activityId.slice(0, 8)}…`);
    },
  });
  
  const telemetry = new SimulatedTelemetryAdapter({ route: ROUTE, seed: 1234 });
  const newReadings: Record<string, ThermalReading> = {};
  
  for (const waypoint of telemetry.stream()) {
    console.log(`Re-fetching reading for waypoint ${waypoint.waypoint_id}...`);
    const reading = await readingsSource.read(waypoint);
    newReadings[waypoint.waypoint_id] = reading;
  }
  
  if (existingCache) {
    let driftFound = false;
    for (const [wpId, reading] of Object.entries(newReadings)) {
      const oldReading = existingCache.readings?.[wpId];
      if (oldReading && Math.abs(oldReading.temp_stats.max - reading.temp_stats.max) > 0.5) {
        console.log(`DRIFT DETECTED on ${wpId}: ${oldReading.temp_stats.max} -> ${reading.temp_stats.max}`);
        driftFound = true;
      }
    }
    if (!driftFound) {
      console.log('Cache is still valid. No significant drift detected.');
    }
  }
  
  const fixtureData = {
    _meta: {
      description: "Cached real API response, fetched " + new Date().toISOString().slice(0, 10),
      date: "2024-07-15",
      route: "PHX-01",
    },
    readings: newReadings,
  };
  
  writeFileSync(fixturePath, JSON.stringify(fixtureData, null, 2));
  console.log(`Updated fixture at ${fixturePath}`);
}

main().catch(console.error);
