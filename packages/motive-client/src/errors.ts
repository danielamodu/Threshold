/**
 * Typed errors for the Motive client (§11 Phase 8).
 *
 * Status-code meanings are Motive's own documented conventions: 401 missing/
 * invalid token, 403 insufficient scope, 404 unknown vehicle id, 422 request
 * rejected (e.g. a >3-month date window), 429 rate limit, 5xx server error.
 * Same shape as @threshold/fortyguard-client's errors.ts — mirrored
 * deliberately so both real-data adapters fail the same recognisable way.
 */

export class MotiveError extends Error {
  readonly statusCode: number | undefined;

  constructor(message: string, options: { statusCode?: number; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.statusCode = options.statusCode;
  }
}

/** 401 — missing or invalid bearer token. */
export class MotiveAuthError extends MotiveError {}

/** 403 — token valid but lacks the required scope/permission. */
export class MotiveForbiddenError extends MotiveError {}

/** 404 — unknown vehicle id. */
export class MotiveNotFoundError extends MotiveError {}

/** 400 / 422 — request rejected (e.g. date window too wide). */
export class MotiveValidationError extends MotiveError {}

/** 429 — rate limit exceeded (documented limit: 10 simultaneous requests). */
export class MotiveRateLimitError extends MotiveError {
  readonly retryAfterMs: number | undefined;

  constructor(message: string, options: { statusCode?: number; retryAfterMs?: number } = {}) {
    super(message, { statusCode: options.statusCode });
    this.retryAfterMs = options.retryAfterMs;
  }
}

/** 5xx — server-side error. */
export class MotiveServerError extends MotiveError {}

/** Configuration problem — e.g. MOTIVE_API_TOKEN absent from the environment. */
export class MotiveConfigError extends MotiveError {}
