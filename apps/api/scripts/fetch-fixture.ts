import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { writeFileSync, mkdirSync } from 'node:fs';
import { FortyGuardClient } from '@threshold/fortyguard-client';
import { FortyGuardThermalReadingSource, SimulatedTelemetryAdapter, type RouteSpec, type ThermalReading } from '@threshold/ingestion';

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
  
  const fixture: Record<string, ThermalReading> = {};
  
  for (const waypoint of telemetry.stream()) {
    console.log(`Fetching reading for waypoint ${waypoint.waypoint_id}...`);
    let attempts = 0;
    while (attempts < 3) {
      try {
        attempts++;
        const reading = await readingsSource.read(waypoint);
        fixture[waypoint.waypoint_id] = reading;
        break;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  Attempt ${attempts} failed: ${msg}`);
        if (attempts >= 3) throw err;
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }
  
  const fixtureData = {
    _meta: {
      description: "Cached real API response, fetched 2026-08-23",
      date: "2024-07-15",
      route: "PHX-01",
    },
    readings: fixture,
  };
  
  const outDir = resolve(import.meta.dirname, '../src/fixtures');
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, 'fortyguard-2024-07-15.json');
  writeFileSync(outPath, JSON.stringify(fixtureData, null, 2));
  console.log(`Wrote fixture to ${outPath}`);
}

main().catch(console.error);
