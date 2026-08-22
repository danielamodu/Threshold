/**
 * @threshold/accounts's Role ("org_admin" | "dispatcher" | "compliance_officer"
 * | "driver") vs this UI's DemoRole ("admin" | "dispatcher" | "compliance" |
 * "driver", also the /app/:role URL segment) are different string sets —
 * DemoRole is a display/URL convention that predates real Clerk wiring. This
 * is the one translation point between them, so it only needs updating here
 * if either side's naming changes.
 */
import type { Role } from "@threshold/accounts/roles";
import type { DemoRole } from "./productShellData";

const ROLE_TO_DEMO_ROLE: Record<Role, DemoRole> = {
  org_admin: "admin",
  dispatcher: "dispatcher",
  compliance_officer: "compliance",
  driver: "driver",
};

export const DEMO_ROLE_DEFAULT_PAGE: Record<DemoRole, string> = {
  admin: "settings",
  dispatcher: "routes",
  compliance: "audit",
  driver: "routes",
};

export function toDemoRole(role: Role): DemoRole {
  return ROLE_TO_DEMO_ROLE[role];
}
