/**
 * Signal Cabinet style reminder: authentication is a calm operational threshold, not a generic account template.
 *
 * Real Clerk headless flows (useSignIn/useSignUp), same custom-visual-shell
 * decision as apps/web's own auth pages — Clerk's SDK drives the identity
 * state, this file keeps the hand-built UI Manus designed.
 */
import { type FormEvent, useEffect, useState } from "react";
import { useAuth, useOrganizationList, useSignIn, useSignUp } from "@clerk/clerk-react";
import { ArrowRight, ChevronLeft, KeyRound, MailCheck } from "lucide-react";
import { useLocation } from "wouter";
import { BrandMark } from "@/components/BrandMark";

function AuthFrame({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children: React.ReactNode }) {
  return <main className="threshold-app auth-page"><header className="auth-page__header"><a href="/"><BrandMark /></a><a href="/" className="auth-page__return"><ChevronLeft size={14} /> Return to site</a></header><section className="auth-panel"><div className="auth-panel__art"><div className="auth-panel__art-content"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p><div className="auth-panel__field-note"><span>One heat event</span><i /><span>Two clear actions</span></div></div></div><div className="auth-panel__form">{children}</div></section></main>;
}

function firstClerkErrorMessage(error: unknown): string {
  const errors = (error as { errors?: { message?: string }[] } | undefined)?.errors;
  return errors?.[0]?.message ?? "Something went wrong. Please try again.";
}

export function SignInPage() {
  const [, setLocation] = useLocation();
  const { isLoaded, signIn, setActive } = useSignIn();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isLoaded) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await signIn.create({ identifier: email, password });
      if (result.status === "complete") {
        await setActive({ session: result.createdSessionId });
        setLocation("/organization");
      } else {
        setError("This account needs an additional verification step this form doesn't support yet.");
      }
    } catch (err) {
      setError(firstClerkErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return <AuthFrame eyebrow="Threshold / protected workspace" title="Open the route record." description="Sign in to view the routes, decisions, and documents that need your attention."><form onSubmit={submit} className="auth-form"><div><p className="eyebrow">Sign in</p><h2>Welcome back.</h2></div><label><span>Work email</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email" required /></label><label><span>Password</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your password" autoComplete="current-password" required /></label>{error && <p className="form-error">{error}</p>}<div className="auth-form__utility"><a href="/sign-up">Need an account?</a></div><button type="submit" disabled={!isLoaded || submitting}>{submitting ? "Signing in…" : "Continue with email"} <ArrowRight size={17} /></button></form></AuthFrame>;
}

export function SignUpPage() {
  const [, setLocation] = useLocation();
  const { isLoaded, signUp } = useSignUp();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isLoaded) return;
    setError(null);
    setSubmitting(true);
    const [firstName, ...rest] = name.trim().split(/\s+/);
    try {
      await signUp.create({
        emailAddress: email,
        password,
        firstName: firstName || undefined,
        lastName: rest.join(" ") || undefined,
      });
      await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
      setLocation("/verify");
    } catch (err) {
      setError(firstClerkErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return <AuthFrame eyebrow="Threshold / protected workspace" title="Start with the route record." description="Create an access request for the people who need to see the driver and cargo response together."><form onSubmit={submit} className="auth-form"><div><p className="eyebrow">Request access</p><h2>Set up your workspace.</h2></div><label><span>Your name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" autoComplete="name" required /></label><label><span>Work email</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email" required /></label><label><span>Create a password</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" required /></label>{error && <p className="form-error">{error}</p>}<button type="submit" disabled={!isLoaded || submitting}>{submitting ? "Creating…" : "Continue with email"} <ArrowRight size={17} /></button><p className="auth-form__utility auth-form__utility--single">Already have access? <a href="/sign-in">Sign in</a></p></form></AuthFrame>;
}

export function VerifyPage() {
  const [, setLocation] = useLocation();
  const { isLoaded, signUp, setActive } = useSignUp();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function verify() {
    if (!isLoaded) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await signUp.attemptEmailAddressVerification({ code });
      if (result.status === "complete") {
        await setActive({ session: result.createdSessionId });
        setLocation("/organization");
      } else {
        setError("That code didn't complete verification. Double-check it and try again.");
      }
    } catch (err) {
      setError(firstClerkErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function resend() {
    if (!isLoaded) return;
    await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
  }

  return <AuthFrame eyebrow="Threshold / verify your email" title="Check your email." description="Enter the six-digit code sent to your work email to continue into the organisation workspace."><div className="auth-form"><div><p className="eyebrow">Email verification</p><h2>One last step.</h2></div><label><span>Verification code</span><input className="auth-form__otp" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} placeholder="000000" /></label>{error && <p className="form-error">{error}</p>}<button onClick={verify} disabled={!isLoaded || submitting}>{submitting ? "Verifying…" : "Verify and continue"} <MailCheck size={17} /></button><p className="auth-form__utility auth-form__utility--single">Did not receive it? <a href="/verify" onClick={(e) => { e.preventDefault(); void resend(); }}>Resend the code</a></p></div></AuthFrame>;
}

/**
 * Real Clerk organization state — not a role picker. Most people land here
 * with exactly one org membership (auto-created on first sign-up) and are
 * bounced straight through; anyone with zero or multiple memberships sees
 * Clerk's own pending-invitations/organization-switch list.
 */
export function OrganizationEntryPage() {
  const [, setLocation] = useLocation();
  const { isLoaded: authLoaded, orgId } = useAuth();
  const { isLoaded: listLoaded, userMemberships, setActive } = useOrganizationList({
    userMemberships: { infinite: true },
  });

  useEffect(() => {
    if (!authLoaded) return;
    if (orgId) {
      setLocation(`/app/dispatcher/routes`); // RequireRole corrects this to the real role's page.
      return;
    }
    if (listLoaded && userMemberships.count === 1 && setActive) {
      const only = userMemberships.data[0];
      if (only) void setActive({ organization: only.organization.id });
    }
  }, [authLoaded, orgId, listLoaded, userMemberships, setActive, setLocation]);

  return <main className="threshold-app org-entry"><header className="auth-page__header"><a href="/"><BrandMark /></a><a href="/sign-in" className="auth-page__return"><ChevronLeft size={14} /> Switch account</a></header><section className="org-entry__shell"><div className="org-entry__intro"><p className="eyebrow">Organisation entry</p><h1>Joining your<br />organisation.</h1><p>Your role and workspace come from your real organisation membership — there's no local switch left to pick.</p></div><div className="org-entry__choices">{!listLoaded && <p><KeyRound size={14} /> Loading your memberships…</p>}{listLoaded && userMemberships.count === 0 && <p>You don't belong to an organisation yet. Ask an admin to invite you, or check the email you signed up with for a pending invitation.</p>}{listLoaded && userMemberships.data.map((membership) => <button key={membership.id} className="org-role-card" onClick={() => void setActive?.({ organization: membership.organization.id })}><strong>{membership.organization.name}</strong><small>{membership.role}</small></button>)}</div></section></main>;
}
