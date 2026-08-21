/**
 * Role permission boundaries (§11 Phase 7) — the table proposed and signed
 * off before any frontend was built around it. Pure, framework-agnostic
 * functions: Clerk (or anything else) supplies WHICH role a user holds in an
 * org; the actual permission logic lives here, not in Clerk's dashboard.
 *
 * Four roles, not three — Org Admin was added at sign-off even though
 * billing itself is Phase 12: an unused permission row costs nothing now,
 * and retrofitting a missing admin role after Phase 12 exists would not.
 */

export type Role = 'dispatcher' | 'compliance_officer' | 'driver' | 'org_admin';

export type Resource =
  | 'routes'
  | 'thermal_events'
  | 'compliance_records'
  | 'cargo_assessments'
  | 'audit_log'
  | 'org_management';

export type Access = 'none' | 'own' | 'org_wide';

export interface ResourcePermissions {
  read: Access;
  /** Create/act — never covers editing or deleting an existing audit-adjacent record. */
  write: Access;
}

/**
 * The approved matrix. `own` means scoped to records the caller's own
 * driver_id is attached to; `org_wide` means every record in their org;
 * `none` means the resource is invisible to that role.
 *
 * Nothing in this table ever grants write access to audit_log, compliance
 * records, or cargo assessments once created — append-only holds regardless
 * of role, enforced independently at the database layer (§2's trigger), not
 * something a permission table could override even if it tried to.
 */
const MATRIX: Record<Role, Record<Resource, ResourcePermissions>> = {
  dispatcher: {
    routes: { read: 'org_wide', write: 'org_wide' },
    thermal_events: { read: 'org_wide', write: 'none' },
    compliance_records: { read: 'org_wide', write: 'none' },
    cargo_assessments: { read: 'org_wide', write: 'org_wide' }, // acts on reroute suggestions
    audit_log: { read: 'org_wide', write: 'none' },
    org_management: { read: 'none', write: 'none' },
  },
  compliance_officer: {
    routes: { read: 'org_wide', write: 'none' },
    thermal_events: { read: 'org_wide', write: 'none' },
    compliance_records: { read: 'org_wide', write: 'none' },
    cargo_assessments: { read: 'org_wide', write: 'none' },
    audit_log: { read: 'org_wide', write: 'none' },
    org_management: { read: 'none', write: 'none' },
  },
  driver: {
    routes: { read: 'none', write: 'none' },
    thermal_events: { read: 'own', write: 'none' },
    compliance_records: { read: 'own', write: 'none' },
    cargo_assessments: { read: 'none', write: 'none' },
    audit_log: { read: 'own', write: 'none' },
    org_management: { read: 'none', write: 'none' },
  },
  org_admin: {
    // Inherits dispatcher-level operational visibility by default (sign-off),
    // plus org_management, which no other role holds.
    routes: { read: 'org_wide', write: 'org_wide' },
    thermal_events: { read: 'org_wide', write: 'none' },
    compliance_records: { read: 'org_wide', write: 'none' },
    cargo_assessments: { read: 'org_wide', write: 'org_wide' },
    audit_log: { read: 'org_wide', write: 'none' },
    org_management: { read: 'org_wide', write: 'org_wide' },
  },
};

export function permissionsFor(role: Role, resource: Resource): ResourcePermissions {
  return MATRIX[role][resource];
}

export function canRead(role: Role, resource: Resource): Access {
  return permissionsFor(role, resource).read;
}

export function canWrite(role: Role, resource: Resource): Access {
  return permissionsFor(role, resource).write;
}

/**
 * Whether `role` may read `resource` belonging to `ownerDriverId`, given the
 * CURRENT caller's own driver_id (undefined for non-driver roles). This is
 * the actual row-level check a route handler calls — `canRead` alone only
 * tells you the resource's ceiling, not whether THIS row is in bounds.
 */
export function mayReadRecord(
  role: Role,
  resource: Resource,
  ownerDriverId: string | null,
  callerDriverId: string | null,
): boolean {
  const access = canRead(role, resource);
  if (access === 'none') return false;
  if (access === 'org_wide') return true;
  // access === 'own'
  return ownerDriverId !== null && callerDriverId !== null && ownerDriverId === callerDriverId;
}
