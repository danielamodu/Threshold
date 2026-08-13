/**
 * Typed errors for the FortyGuard client.
 *
 * Status-code meanings are taken from the Quickstart's response guide:
 *   400/422 validation · 401 missing/invalid key · 403 plan access
 *   404 activity not found (also returned transiently right after submit)
 *   429 rate limit · 500 server-side processing error
 */

export class FortyGuardError extends Error {
  readonly statusCode: number | undefined;
  readonly activityId: string | undefined;

  constructor(
    message: string,
    options: { statusCode?: number; activityId?: string; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.statusCode = options.statusCode;
    this.activityId = options.activityId;
  }
}

/** 401 / 403 — missing, invalid, or under-privileged API key. */
export class FortyGuardAuthError extends FortyGuardError {}

/** 400 / 422 — request rejected before a job was created. */
export class FortyGuardValidationError extends FortyGuardError {}

/** 429 — rate limit exceeded. */
export class FortyGuardRateLimitError extends FortyGuardError {
  readonly retryAfterMs: number | undefined;

  constructor(message: string, options: { statusCode?: number; retryAfterMs?: number } = {}) {
    super(message, { statusCode: options.statusCode });
    this.retryAfterMs = options.retryAfterMs;
  }
}

/** 5xx — server-side processing error. */
export class FortyGuardServerError extends FortyGuardError {}

/** 404 — activity id unknown. Transient immediately after submission. */
export class FortyGuardNotFoundError extends FortyGuardError {}

/** Terminal `Failed` status returned by the status endpoint. */
export class FortyGuardActivityFailedError extends FortyGuardError {}

/** Poll budget exhausted while the activity was still `Processing`. */
export class FortyGuardTimeoutError extends FortyGuardError {
  readonly waitedMs: number;

  constructor(message: string, options: { activityId?: string; waitedMs: number }) {
    super(message, { activityId: options.activityId });
    this.waitedMs = options.waitedMs;
  }
}

/** Configuration problem — e.g. FORTYGUARD_API_KEY absent from the environment. */
export class FortyGuardConfigError extends FortyGuardError {}
