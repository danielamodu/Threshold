/**
 * Signal Cabinet style reminder: authentication is a calm operational threshold, not a generic account template.
 *
 * Real Clerk headless flows (useSignIn/useSignUp), custom visual shell.
 * Includes Google, GitHub, and Apple OAuth redirect flows via Clerk's authenticateWithRedirect.
 */
import { type FormEvent, useEffect, useState } from "react";
import { AuthenticateWithRedirectCallback, useAuth, useOrganizationList, useSignIn, useSignUp } from "@clerk/clerk-react";
import { type OAuthStrategy } from "@clerk/types";
import { ArrowRight, ChevronLeft, KeyRound, MailCheck } from "lucide-react";
import { useLocation } from "wouter";
import { BrandMark } from "@/components/BrandMark";

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
    </svg>
  );
}

function GithubIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 6.32c.67-.82 1.13-1.96.99-3.12-1 .04-2.22.67-2.92 1.49-.63.73-1.18 1.9-1.03 3.03 1.12.09 2.29-.57 2.96-1.4"/>
    </svg>
  );
}

function AuthFrame({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children: React.ReactNode }) {
  return (
    <main className="threshold-app auth-page">
      <header className="auth-page__header">
        <a href="/"><BrandMark /></a>
        <a href="/" className="auth-page__return"><ChevronLeft size={14} /> Return to site</a>
      </header>
      <section className="auth-panel">
        <div className="auth-panel__art">
          <div className="auth-panel__art-content">
            <p className="eyebrow">{eyebrow}</p>
            <h1>{title}</h1>
            <p>{description}</p>
            <div className="auth-panel__field-note">
              <span>One heat event</span>
              <i />
              <span>Two clear actions</span>
            </div>
          </div>
        </div>
        <div className="auth-panel__form">{children}</div>
      </section>
    </main>
  );
}

function firstClerkErrorMessage(error: unknown): string {
  const errors = (error as { errors?: { message?: string }[] } | undefined)?.errors;
  return errors?.[0]?.message ?? "Something went wrong. Please try again.";
}

export function SignInPage() {
  const [, setLocation] = useLocation();
  const { isSignedIn } = useAuth();
  const { isLoaded, signIn, setActive } = useSignIn();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isSignedIn) {
      setLocation("/organization");
    }
  }, [isSignedIn, setLocation]);

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
      const msg = firstClerkErrorMessage(err);
      if (msg.toLowerCase().includes("session already exists")) {
        setLocation("/organization");
        return;
      }
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleOAuth(strategy: OAuthStrategy) {
    if (!isLoaded) return;
    setError(null);
    try {
      await signIn.authenticateWithRedirect({
        strategy,
        redirectUrl: "/sso-callback",
        redirectUrlComplete: "/organization",
      });
    } catch (err) {
      const msg = firstClerkErrorMessage(err);
      if (msg.toLowerCase().includes("session already exists")) {
        setLocation("/organization");
        return;
      }
      setError(msg);
    }
  }

  return (
    <AuthFrame eyebrow="Threshold / protected workspace" title="Open the route record." description="Sign in to view the routes, decisions, and documents that need your attention.">
      <div className="auth-form">
        <div>
          <p className="eyebrow">Sign in</p>
          <h2>Welcome back.</h2>
        </div>

        <div className="auth-form__socials">
          <button type="button" className="auth-form__social-btn" onClick={() => void handleOAuth("oauth_google")} disabled={!isLoaded || submitting}>
            <GoogleIcon /> Continue with Google
          </button>
          <button type="button" className="auth-form__social-btn" onClick={() => void handleOAuth("oauth_github")} disabled={!isLoaded || submitting}>
            <GithubIcon /> Continue with GitHub
          </button>
          <button type="button" className="auth-form__social-btn" onClick={() => void handleOAuth("oauth_apple")} disabled={!isLoaded || submitting}>
            <AppleIcon /> Continue with Apple
          </button>
        </div>

        <div className="auth-form__divider">
          <span>Or with email</span>
        </div>

        <form onSubmit={submit} className="auth-form__inner">
          <label>
            <span>Work email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email" required />
          </label>
          <label>
            <span>Password</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your password" autoComplete="current-password" required />
          </label>
          {error && <p className="form-error">{error}</p>}
          <div className="auth-form__utility">
            <a href="/sign-up">Need an account?</a>
          </div>
          <button type="submit" disabled={!isLoaded || submitting}>
            {submitting ? "Signing in…" : "Sign in"} <ArrowRight size={17} />
          </button>
        </form>
      </div>
    </AuthFrame>
  );
}

export function SignUpPage() {
  const [, setLocation] = useLocation();
  const { isSignedIn } = useAuth();
  const { isLoaded, signUp } = useSignUp();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isSignedIn) {
      setLocation("/organization");
    }
  }, [isSignedIn, setLocation]);

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
      const msg = firstClerkErrorMessage(err);
      if (msg.toLowerCase().includes("session already exists")) {
        setLocation("/organization");
        return;
      }
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleOAuth(strategy: OAuthStrategy) {
    if (!isLoaded) return;
    setError(null);
    try {
      await signUp.authenticateWithRedirect({
        strategy,
        redirectUrl: "/sso-callback",
        redirectUrlComplete: "/organization",
      });
    } catch (err) {
      const msg = firstClerkErrorMessage(err);
      if (msg.toLowerCase().includes("session already exists")) {
        setLocation("/organization");
        return;
      }
      setError(msg);
    }
  }

  return (
    <AuthFrame eyebrow="Threshold / protected workspace" title="Start with the route record." description="Create an access request for the people who need to see the driver and cargo response together.">
      <div className="auth-form">
        <div>
          <p className="eyebrow">Request access</p>
          <h2>Set up your workspace.</h2>
        </div>

        <div className="auth-form__socials">
          <button type="button" className="auth-form__social-btn" onClick={() => void handleOAuth("oauth_google")} disabled={!isLoaded || submitting}>
            <GoogleIcon /> Continue with Google
          </button>
          <button type="button" className="auth-form__social-btn" onClick={() => void handleOAuth("oauth_github")} disabled={!isLoaded || submitting}>
            <GithubIcon /> Continue with GitHub
          </button>
          <button type="button" className="auth-form__social-btn" onClick={() => void handleOAuth("oauth_apple")} disabled={!isLoaded || submitting}>
            <AppleIcon /> Continue with Apple
          </button>
        </div>

        <div className="auth-form__divider">
          <span>Or with email</span>
        </div>

        <form onSubmit={submit} className="auth-form__inner">
          <label>
            <span>Your name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" autoComplete="name" required />
          </label>
          <label>
            <span>Work email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email" required />
          </label>
          <label>
            <span>Create a password</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" required />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button type="submit" disabled={!isLoaded || submitting}>
            {submitting ? "Creating…" : "Continue with email"} <ArrowRight size={17} />
          </button>
          <p className="auth-form__utility auth-form__utility--single">
            Already have access? <a href="/sign-in">Sign in</a>
          </p>
        </form>
      </div>
    </AuthFrame>
  );
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

  return (
    <AuthFrame eyebrow="Threshold / verify your email" title="Check your email." description="Enter the six-digit code sent to your work email to continue into the organisation workspace.">
      <div className="auth-form">
        <div>
          <p className="eyebrow">Email verification</p>
          <h2>One last step.</h2>
        </div>
        <label>
          <span>Verification code</span>
          <input className="auth-form__otp" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} placeholder="000000" />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button onClick={verify} disabled={!isLoaded || submitting}>
          {submitting ? "Verifying…" : "Verify and continue"} <MailCheck size={17} />
        </button>
        <p className="auth-form__utility auth-form__utility--single">
          Did not receive it? <a href="/verify" onClick={(e) => { e.preventDefault(); void resend(); }}>Resend the code</a>
        </p>
      </div>
    </AuthFrame>
  );
}

export function SSOCallbackPage() {
  return (
    <main className="threshold-app auth-page" style={{ display: "grid", placeItems: "center", minHeight: "100vh" }}>
      <div style={{ textAlign: "center", color: "var(--paper)" }}>
        <p className="eyebrow" style={{ marginBottom: 12 }}>Authenticating</p>
        <p style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#a8a298", marginBottom: 24 }}>Completing sign-in with provider…</p>
        <AuthenticateWithRedirectCallback signInForceRedirectUrl="/organization" signUpForceRedirectUrl="/organization" />
      </div>
    </main>
  );
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
      if (only) void setActive({ organization: only.organization.id })?.then(() => setLocation(`/app/dispatcher/routes`));
    }
  }, [authLoaded, orgId, listLoaded, userMemberships, setActive, setLocation]);

  return (
    <main className="threshold-app org-entry">
      <header className="auth-page__header">
        <a href="/"><BrandMark /></a>
        <a href="/sign-in" className="auth-page__return"><ChevronLeft size={14} /> Switch account</a>
      </header>
      <section className="org-entry__shell">
        <div className="org-entry__intro">
          <p className="eyebrow">Organisation entry</p>
          <h1>Joining your<br />organisation.</h1>
          <p>Your role and workspace come from your real organisation membership — there's no local switch left to pick.</p>
        </div>
        <div className="org-entry__choices">
          {!listLoaded && <p><KeyRound size={14} /> Loading your memberships…</p>}
          {listLoaded && userMemberships.count === 0 && <p>You don't belong to an organisation yet. Ask an admin to invite you, or check the email you signed up with for a pending invitation.</p>}
          {listLoaded && userMemberships.data.map((membership) => (
            <button
              key={membership.id}
              className="org-role-card"
              onClick={() => void setActive?.({ organization: membership.organization.id })?.then(() => setLocation(`/app/dispatcher/routes`))}
            >
              <strong>{membership.organization.name}</strong>
              <small>{membership.role}</small>
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
