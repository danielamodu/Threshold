/**
 * Real Clerk session -> real org/role resolution (§11 product-shell wiring).
 * `useAuth()`'s orgRole is already normalized by Clerk's own SDK regardless
 * of the underlying v1/v2 session-token claim shape (same mechanism
 * @clerk/nextjs's auth() uses, already proven live in apps/web's
 * /dashboard) — this hook only maps that normalized role string onto our
 * own Role type via the same clerk-roles.ts the backend uses.
 */
import { useAuth } from "@clerk/clerk-react";
import { roleFromClerk } from "@threshold/accounts/clerk-roles";
import type { Role } from "@threshold/accounts/roles";

export interface ThresholdSession {
  isLoaded: boolean;
  isSignedIn: boolean;
  orgId: string | null;
  role: Role | null;
}

export function useThresholdSession(): ThresholdSession {
  const { isLoaded, isSignedIn, orgId, orgRole } = useAuth();

  if (!isLoaded) {
    return { isLoaded: false, isSignedIn: false, orgId: null, role: null };
  }

  let role: Role | null = null;
  if (orgRole) {
    try {
      role = roleFromClerk(orgRole);
    } catch {
      role = null; // unrecognized role — treated as "no role", never guessed
    }
  }

  return { isLoaded: true, isSignedIn: Boolean(isSignedIn), orgId: orgId ?? null, role };
}
