import { FortyGuardConfigError } from './errors.js';

export interface FortyGuardConfig {
  apiKey: string;
  baseUrl: string;
  pollIntervalMs: number;
  pollTimeoutMs: number;
  requestTimeoutMs: number;
}

export const DEFAULT_BASE_URL = 'https://api.fortyguard.com/v1';
export const DEFAULT_POLL_INTERVAL_MS = 5_000;
export const DEFAULT_POLL_TIMEOUT_MS = 600_000;
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

function readInt(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new FortyGuardConfigError(`${name} must be a positive number, got "${raw}"`);
  }
  return Math.floor(parsed);
}

/**
 * Build config from the environment. Credentials come from `.env` only — the
 * key is never defaulted, never embedded, and never written back out.
 *
 * This does not call dotenv itself; loading `.env` into `process.env` is the
 * caller's job (the API server and the verify script both do it), which keeps
 * this package usable in environments that inject env vars directly.
 */
export function loadConfigFromEnv(env: NodeJS.ProcessEnv = process.env): FortyGuardConfig {
  const apiKey = env.FORTYGUARD_API_KEY?.trim();
  if (!apiKey) {
    throw new FortyGuardConfigError(
      'FORTYGUARD_API_KEY is not set. Copy .env.example to .env and add your key.',
    );
  }

  const baseUrl = (env.FORTYGUARD_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');

  return {
    apiKey,
    baseUrl,
    pollIntervalMs: readInt(
      env.FORTYGUARD_POLL_INTERVAL_MS,
      DEFAULT_POLL_INTERVAL_MS,
      'FORTYGUARD_POLL_INTERVAL_MS',
    ),
    pollTimeoutMs: readInt(
      env.FORTYGUARD_POLL_TIMEOUT_MS,
      DEFAULT_POLL_TIMEOUT_MS,
      'FORTYGUARD_POLL_TIMEOUT_MS',
    ),
    requestTimeoutMs: readInt(
      env.FORTYGUARD_REQUEST_TIMEOUT_MS,
      DEFAULT_REQUEST_TIMEOUT_MS,
      'FORTYGUARD_REQUEST_TIMEOUT_MS',
    ),
  };
}

/**
 * Describe a key for logs WITHOUT revealing any of it. Deliberately omits even
 * a last-four fragment: length and presence are enough to diagnose a missing or
 * truncated key, and leak nothing.
 */
export function describeKey(apiKey: string | undefined): string {
  if (!apiKey) return 'absent';
  return `present (length ${apiKey.length})`;
}

/**
 * Strip the API key from any string before it reaches a log, an error message,
 * or a captured artifact. Applied to every outbound error in this package.
 */
export function redactSecret(text: string, secret: string | undefined): string {
  if (!secret) return text;
  return text.split(secret).join('[REDACTED_API_KEY]');
}
