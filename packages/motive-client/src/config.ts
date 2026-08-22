import { MotiveConfigError } from './errors.js';

export interface MotiveConfig {
  apiToken: string;
  baseUrl: string;
  requestTimeoutMs: number;
}

/** developer-docs.gomotive.com/docs/endpoint — the current base URL. */
export const DEFAULT_BASE_URL = 'https://api.gomotive.com';
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Build config from the environment. Credentials come from `.env` only — the
 * token is never defaulted, never embedded, and never written back out.
 *
 * This does not call dotenv itself; loading `.env` into `process.env` is the
 * caller's job, matching @threshold/fortyguard-client's config.ts.
 */
export function loadConfigFromEnv(env: NodeJS.ProcessEnv = process.env): MotiveConfig {
  const apiToken = env.MOTIVE_API_TOKEN?.trim();
  if (!apiToken) {
    throw new MotiveConfigError(
      'MOTIVE_API_TOKEN is not set. See .env.example — this is blocked pending a real Motive ' +
        'developer account and an approved application (see motive-source.ts header).',
    );
  }

  const baseUrl = (env.MOTIVE_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');

  return { apiToken, baseUrl, requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS };
}

/** Describe a token for logs WITHOUT revealing any of it. */
export function describeToken(apiToken: string | undefined): string {
  if (!apiToken) return 'absent';
  return `present (length ${apiToken.length})`;
}

/** Strip the token from any string before it reaches a log or error message. */
export function redactSecret(text: string, secret: string | undefined): string {
  if (!secret) return text;
  return text.split(secret).join('[REDACTED_MOTIVE_TOKEN]');
}
