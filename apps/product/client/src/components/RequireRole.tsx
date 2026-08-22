/**
 * Structural role gate (§11 product-shell wiring) — replaces the old
 * URL-derived "View as" dropdown. This runs on every /app/:role/* render and
 * redirects BEFORE the requested page's content ever mounts, so a driver
 * session cannot reach /app/admin/settings by typing the URL: the resolved
 * role always wins over whatever the URL claims.
 */
import { useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { useThresholdSession } from "@/hooks/useThresholdSession";
import { toDemoRole, DEMO_ROLE_DEFAULT_PAGE } from "@/lib/roleMapping";

function FullPageStatus({ children }: { children: React.ReactNode }) {
  return (
    <main className="threshold-app" style={{ display: "grid", placeItems: "center", minHeight: "100vh" }}>
      <p style={{ color: "var(--text-muted, #8a8a86)", fontSize: "0.9rem" }}>{children}</p>
    </main>
  );
}

export function RequireRole({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn, orgId, role } = useThresholdSession();
  const [, setLocation] = useLocation();
  const params = useParams<{ role?: string }>();
  const urlRole = params.role;

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setLocation("/sign-in");
      return;
    }
    if (!orgId || !role) {
      setLocation("/organization");
      return;
    }
    const realDemoRole = toDemoRole(role);
    if (urlRole !== realDemoRole) {
      // Either the URL's role segment doesn't match this session's real
      // role, or it's an unrecognized segment entirely — both land on the
      // real role's own default page, never on the requested one.
      setLocation(`/app/${realDemoRole}/${DEMO_ROLE_DEFAULT_PAGE[realDemoRole]}`);
    }
  }, [isLoaded, isSignedIn, orgId, role, urlRole, setLocation]);

  if (!isLoaded) return <FullPageStatus>Loading your session…</FullPageStatus>;
  if (!isSignedIn) return <FullPageStatus>Redirecting to sign in…</FullPageStatus>;
  if (!orgId || !role) return <FullPageStatus>Redirecting to organization setup…</FullPageStatus>;
  if (urlRole !== toDemoRole(role)) return <FullPageStatus>Redirecting…</FullPageStatus>;

  return <>{children}</>;
}
