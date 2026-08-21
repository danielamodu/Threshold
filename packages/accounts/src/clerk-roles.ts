/**
 * Maps a Clerk organization-membership role string onto our own `Role` type
 * (§11 Phase 7). Deliberately has no dependency on any `@clerk/*` package —
 * it takes whatever raw string the session claims contain and returns our
 * type, so the actual permission logic in roles.ts stays completely
 * independent of which auth provider supplies the role.
 *
 * ── Clerk setup this depends on (one-time, dashboard-only) ──────────────────
 * Clerk ships two default org roles out of the box: `org:admin` and
 * `org:member`. `org_admin` in our model maps onto Clerk's own built-in
 * `org:admin` directly — no custom role needed for it. The other three
 * (`dispatcher`, `compliance_officer`, `driver`) do NOT exist by default and
 * must be created as custom roles in the Clerk Dashboard (Organizations →
 * Roles) with exactly these keys, so they arrive as `org:dispatcher`,
 * `org:compliance_officer`, `org:driver` in session claims.
 *
 * UNVERIFIED against a live session: the Organizations feature was disabled
 * on this Clerk instance at the time this was written (confirmed via a real
 * API call — `organization_not_enabled_in_instance`), so no real org,
 * membership, or session has ever produced a role claim to inspect. The
 * `org:` prefix and the exact claim shape follow Clerk's current documented
 * convention, not something observed here. Verify the very first real sign-in
 * against `describeClerkRole`'s input before trusting this in production.
 */

import type { Role } from './roles.js';

export class UnrecognizedClerkRoleError extends Error {
  constructor(raw: string) {
    super(
      `Clerk role "${raw}" does not map to a known Role. Expected one of: ` +
        `org:admin, org:dispatcher, org:compliance_officer, org:driver ` +
        `(the last three must be created as custom roles in the Clerk ` +
        `Dashboard under Organizations → Roles with exactly those keys).`,
    );
    this.name = 'UnrecognizedClerkRoleError';
  }
}

const CLERK_ROLE_MAP: Record<string, Role> = {
  'org:admin': 'org_admin',
  'org:dispatcher': 'dispatcher',
  'org:compliance_officer': 'compliance_officer',
  'org:driver': 'driver',
};

/** Throws UnrecognizedClerkRoleError rather than silently defaulting to the least-privileged role. */
export function roleFromClerk(rawOrgRole: string): Role {
  const role = CLERK_ROLE_MAP[rawOrgRole];
  if (!role) throw new UnrecognizedClerkRoleError(rawOrgRole);
  return role;
}
