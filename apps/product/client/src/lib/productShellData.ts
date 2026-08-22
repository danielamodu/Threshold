/**
 * Role/status labels only — every fixture (demoRoutes, auditItems,
 * demoMembers, artifact lists) that used to live here is gone. Real data now
 * comes from @/lib/api (GET/POST /api/routes, GET /api/audit) and Clerk's own
 * OrganizationProfile (org settings/members). DemoRole is a display/URL
 * naming convention distinct from @threshold/accounts's Role — see
 * @/lib/roleMapping for the one translation point between them.
 */
export type DemoRole = "admin" | "dispatcher" | "compliance" | "driver";

export type RouteStatus = "nominal" | "elevated" | "breach";

export const roleMeta: Record<DemoRole, { label: string; short: string; description: string }> = {
  admin: { label: "Organisation admin", short: "Admin", description: "Set up people, roles, and operating defaults." },
  dispatcher: { label: "Dispatcher", short: "Dispatch", description: "Watch active routes and act on route events." },
  compliance: { label: "Compliance officer", short: "Compliance", description: "Review every decision, record, and claim outcome." },
  driver: { label: "Driver", short: "Driver", description: "View assigned routes and personal compliance records." },
};
