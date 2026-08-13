import type { FortyGuardEnvelope } from './api-types.js';
import type { FortyGuardConfig } from './config.js';
import { redactSecret } from './config.js';
import {
  FortyGuardAuthError,
  FortyGuardError,
  FortyGuardNotFoundError,
  FortyGuardRateLimitError,
  FortyGuardServerError,
  FortyGuardValidationError,
} from './errors.js';

export interface RequestResult<TData> {
  envelope: FortyGuardEnvelope<TData>;
  /** Untouched parsed JSON. Phase 0 diffs this against §3 — see scripts/verify.ts. */
  raw: unknown;
}

/** Truncate a body before it goes into an error message. */
function snippet(text: string, apiKey: string, max = 400): string {
  const safe = redactSecret(text, apiKey);
  return safe.length > max ? `${safe.slice(0, max)}…` : safe;
}

function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(header);
  if (!Number.isNaN(at)) return Math.max(0, at - Date.now());
  return undefined;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Thin transport over `fetch`.
 *
 * The API key is attached here and nowhere else, and is scrubbed from every
 * error message this module produces. Request headers are never logged.
 */
export class HttpTransport {
  constructor(private readonly config: FortyGuardConfig) {}

  async request<TData>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<RequestResult<TData>> {
    const url = `${this.config.baseUrl}${path}`;
    const headers: Record<string, string> = { 'api-key': this.config.apiKey };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      });
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new FortyGuardError(
        `${method} ${path} failed: ${redactSecret(reason, this.config.apiKey)}`,
        { cause },
      );
    }

    const text = await response.text();

    if (!response.ok) {
      this.throwForStatus(response, method, path, text);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch (cause) {
      throw new FortyGuardError(
        `${method} ${path} returned non-JSON body: ${snippet(text, this.config.apiKey)}`,
        { statusCode: response.status, cause },
      );
    }

    const envelope = parsed as FortyGuardEnvelope<TData>;

    // The envelope carries its own error flag independent of the HTTP status.
    if (envelope && envelope.error === true) {
      throw new FortyGuardError(
        `${method} ${path} reported an error: ${redactSecret(
          envelope.message ?? 'unknown',
          this.config.apiKey,
        )}`,
        { statusCode: envelope.status_code ?? response.status },
      );
    }

    return { envelope, raw: parsed };
  }

  private throwForStatus(response: Response, method: string, path: string, text: string): never {
    const status = response.status;
    const detail = snippet(text, this.config.apiKey);
    const where = `${method} ${path}`;

    if (status === 401 || status === 403) {
      throw new FortyGuardAuthError(
        status === 401
          ? `${where}: missing or invalid API key (401). ${detail}`
          : `${where}: insufficient plan access (403). ${detail}`,
        { statusCode: status },
      );
    }
    if (status === 400 || status === 422) {
      throw new FortyGuardValidationError(`${where}: request rejected (${status}). ${detail}`, {
        statusCode: status,
      });
    }
    if (status === 404) {
      throw new FortyGuardNotFoundError(`${where}: activity not found (404). ${detail}`, {
        statusCode: status,
      });
    }
    if (status === 429) {
      throw new FortyGuardRateLimitError(`${where}: rate limit exceeded (429). ${detail}`, {
        statusCode: status,
        retryAfterMs: parseRetryAfterMs(response.headers.get('retry-after')),
      });
    }
    if (status >= 500) {
      throw new FortyGuardServerError(`${where}: server error (${status}). ${detail}`, {
        statusCode: status,
      });
    }
    throw new FortyGuardError(`${where}: unexpected status ${status}. ${detail}`, {
      statusCode: status,
    });
  }
}
