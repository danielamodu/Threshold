import type { MotiveConfig } from './config.js';
import { redactSecret } from './config.js';
import {
  MotiveAuthError,
  MotiveError,
  MotiveForbiddenError,
  MotiveNotFoundError,
  MotiveRateLimitError,
  MotiveServerError,
  MotiveValidationError,
} from './errors.js';

function snippet(text: string, apiToken: string, max = 400): string {
  const safe = redactSecret(text, apiToken);
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

/**
 * Thin transport over `fetch`, mirroring @threshold/fortyguard-client's
 * http.ts. Motive's API is a plain synchronous REST call (no submit/poll job
 * model), so this is simpler than FortyGuard's transport — one request, one
 * response, no activity/status polling.
 */
export class HttpTransport {
  constructor(private readonly config: MotiveConfig) {}

  async get<TData>(path: string, query: Record<string, string | undefined>): Promise<TData> {
    const url = new URL(`${this.config.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, value);
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.config.apiToken}` },
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      });
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new MotiveError(`GET ${path} failed: ${redactSecret(reason, this.config.apiToken)}`, {
        cause,
      });
    }

    const text = await response.text();

    if (!response.ok) {
      this.throwForStatus(response, path, text);
    }

    try {
      return JSON.parse(text) as TData;
    } catch (cause) {
      throw new MotiveError(
        `GET ${path} returned non-JSON body: ${snippet(text, this.config.apiToken)}`,
        { statusCode: response.status, cause },
      );
    }
  }

  private throwForStatus(response: Response, path: string, text: string): never {
    const status = response.status;
    const detail = snippet(text, this.config.apiToken);
    const where = `GET ${path}`;

    if (status === 401) {
      throw new MotiveAuthError(`${where}: missing or invalid bearer token (401). ${detail}`, {
        statusCode: status,
      });
    }
    if (status === 403) {
      throw new MotiveForbiddenError(`${where}: token lacks required scope (403). ${detail}`, {
        statusCode: status,
      });
    }
    if (status === 404) {
      throw new MotiveNotFoundError(`${where}: vehicle not found (404). ${detail}`, {
        statusCode: status,
      });
    }
    if (status === 400 || status === 422) {
      throw new MotiveValidationError(`${where}: request rejected (${status}). ${detail}`, {
        statusCode: status,
      });
    }
    if (status === 429) {
      throw new MotiveRateLimitError(`${where}: rate limit exceeded (429). ${detail}`, {
        statusCode: status,
        retryAfterMs: parseRetryAfterMs(response.headers.get('retry-after')),
      });
    }
    if (status >= 500) {
      throw new MotiveServerError(`${where}: server error (${status}). ${detail}`, {
        statusCode: status,
      });
    }
    throw new MotiveError(`${where}: unexpected status ${status}. ${detail}`, {
      statusCode: status,
    });
  }
}
