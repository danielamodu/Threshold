/**
 * The hackathon demo, as a real seeded org (§11 Phase 7, item 4).
 *
 * `DEMO_ORG_ID` is a placeholder string, NOT a real Clerk id — Clerk isn't
 * wired yet (no CLERK_SECRET_KEY/CLERK_PUBLISHABLE_KEY exist). Every consumer
 * (the seed script, apps/api's routes and CLI scripts, apps/web's Server
 * Action) imports this one constant rather than each hardcoding its own copy,
 * so swapping in a real Clerk org id later is a one-line change here, not a
 * hunt through five files.
 */

export const DEMO_ORG_ID = 'org_threshold_demo';
export const DEMO_ORG_SLUG = 'threshold-demo';
export const DEMO_ORG_NAME = 'Threshold Demo Fleet';
export const DEMO_ROUTE_ID = 'route-phx-01';
export const DEMO_DRIVER_ID = 'driver-42';
export const DEMO_CARGO_CLASS = 'pharma' as const;
