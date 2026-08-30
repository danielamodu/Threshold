/**
 * Per-device onboarding completion flag (§1 first-login).
 *
 * Keyed by Clerk userId + role, NOT just role — a person who holds two
 * different roles across two different orgs (e.g. dispatcher at one, driver
 * at another) gets the wizard once per role, not just once. The userId prefix
 * is required so signing in on a different device does not carry the flag
 * across — the brief is explicit: "shows once per real device login".
 *
 * Storage is localStorage on purpose, not a backend flag. The brief says no
 * backend is needed and the surface is genuinely per-device; a server flag
 * would couple onboarding to the wrong identity. If we later want to honor
 * a "skip" across devices, that's a separate opt-in and lives in a Clerk
 * publicMetadata field — out of scope here.
 *
 * `set` swallows quota / privacy-mode errors silently; the worst outcome if
 * localStorage is unavailable is the wizard re-appears, which is a milder
 * failure than the user being locked out by a broken write.
 */
const STORAGE_PREFIX = "threshold.onboarding.";

export type OnboardingRole = "admin" | "dispatcher" | "compliance" | "driver";

export type WizardOutcome = "completed" | "dismissed";

export function isOnboardingDone(userId: string, role: OnboardingRole): boolean {
  if (typeof window === "undefined") return true; // SSR / tests — never block render
  try {
    return window.localStorage.getItem(storageKey(userId, role)) !== null;
  } catch {
    return true; // unreadable storage = never show, to avoid trapping the user
  }
}

export function markOnboardingDone(userId: string, role: OnboardingRole, outcome: WizardOutcome): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(userId, role), outcome);
  } catch {
    // ignore — see file header
  }
}

export function resetOnboarding(userId: string, role: OnboardingRole): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey(userId, role));
  } catch {
    // ignore
  }
}

function storageKey(userId: string, role: OnboardingRole): string {
  return `${STORAGE_PREFIX}${userId}.${role}`;
}
