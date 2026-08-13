import type {
  EnvParamsRequest,
  EnvParamsResult,
  HeatmapRequest,
  HeatmapResult,
  StatusData,
  SubmitData,
} from './api-types.js';
import type { FortyGuardConfig } from './config.js';
import { loadConfigFromEnv } from './config.js';
import {
  FortyGuardActivityFailedError,
  FortyGuardError,
  FortyGuardNotFoundError,
  FortyGuardRateLimitError,
  FortyGuardServerError,
  FortyGuardTimeoutError,
} from './errors.js';
import { HttpTransport, sleep } from './http.js';
import { normalizeStatus, type ActivityState } from './status.js';

export interface PollProgress {
  activityId: string;
  attempt: number;
  state: ActivityState;
  elapsedMs: number;
}

export interface PollOptions {
  intervalMs?: number;
  timeoutMs?: number;
  /**
   * How long to tolerate 404s after submission. The Quickstart documents 404 as
   * "activity not found OR temporarily unavailable immediately after
   * submission", so an early 404 is expected, not fatal.
   */
  notFoundGraceMs?: number;
  /** Consecutive 429/5xx responses tolerated before giving up. */
  maxConsecutiveTransientErrors?: number;
  onProgress?: (progress: PollProgress) => void;
  signal?: AbortSignal;
}

export interface JobResult<TResult> {
  activityId: string;
  result: TResult;
  /** Raw parsed JSON of the submit response. */
  submitRaw: unknown;
  /** Raw parsed JSON of the completing status response. */
  statusRaw: unknown;
  pollCount: number;
  elapsedMs: number;
}

const DEFAULT_NOT_FOUND_GRACE_MS = 60_000;
const DEFAULT_MAX_CONSECUTIVE_TRANSIENT = 5;

/**
 * FortyGuard Enterprise API client.
 *
 * Every analysis endpoint is an async job: POST returns an `activity_id`, and
 * `GET /status/{activity_id}` is polled until it reports a terminal state (§8).
 * There is no synchronous variant — `runHeatmap` / `runEnvParams` wrap the full
 * submit → poll → typed-result cycle.
 */
export class FortyGuardClient {
  private readonly transport: HttpTransport;

  constructor(private readonly config: FortyGuardConfig) {
    this.transport = new HttpTransport(config);
  }

  /** Build a client from `process.env`. The key is read from `.env` only. */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): FortyGuardClient {
    return new FortyGuardClient(loadConfigFromEnv(env));
  }

  // -------------------------------------------------------------------------
  // Primitives
  // -------------------------------------------------------------------------

  /** Submit a job. Returns the `activity_id` to poll. */
  async submit(path: string, body: unknown): Promise<{ activityId: string; raw: unknown }> {
    const { envelope, raw } = await this.transport.request<SubmitData>('POST', path, body);
    const activityId = envelope?.data?.activity_id;
    if (!activityId) {
      throw new FortyGuardError(`POST ${path} returned no activity_id (message: ${envelope?.message})`);
    }
    return { activityId, raw };
  }

  /** One status read. Does not retry — `awaitCompletion` owns the retry policy. */
  async getStatus<TResult>(
    activityId: string,
  ): Promise<{ data: StatusData<TResult>; state: ActivityState; raw: unknown }> {
    const { envelope, raw } = await this.transport.request<StatusData<TResult>>(
      'GET',
      `/status/${encodeURIComponent(activityId)}`,
    );
    const data = envelope.data;
    return { data, state: normalizeStatus(data?.status), raw };
  }

  /**
   * Poll `activity_id` to a terminal state and return the typed result.
   *
   * Tolerates the documented transient failures — early 404, 429, 5xx — and
   * gives up on a bounded budget rather than looping forever.
   */
  async awaitCompletion<TResult>(
    activityId: string,
    options: PollOptions = {},
  ): Promise<{ result: TResult; raw: unknown; pollCount: number; elapsedMs: number }> {
    const intervalMs = options.intervalMs ?? this.config.pollIntervalMs;
    const timeoutMs = options.timeoutMs ?? this.config.pollTimeoutMs;
    const notFoundGraceMs = options.notFoundGraceMs ?? DEFAULT_NOT_FOUND_GRACE_MS;
    const maxTransient =
      options.maxConsecutiveTransientErrors ?? DEFAULT_MAX_CONSECUTIVE_TRANSIENT;

    const startedAt = Date.now();
    let attempt = 0;
    let consecutiveTransient = 0;

    for (;;) {
      options.signal?.throwIfAborted();

      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs > timeoutMs) {
        throw new FortyGuardTimeoutError(
          `Activity ${activityId} still processing after ${Math.round(elapsedMs / 1000)}s`,
          { activityId, waitedMs: elapsedMs },
        );
      }

      attempt += 1;

      try {
        const { data, state, raw } = await this.getStatus<TResult>(activityId);
        consecutiveTransient = 0;
        options.onProgress?.({ activityId, attempt, state, elapsedMs });

        if (state === 'failed') {
          throw new FortyGuardActivityFailedError(
            `Activity ${activityId} failed (status "${data?.status}"). Record this id for support.`,
            { activityId },
          );
        }

        if (state === 'completed') {
          if (data?.result === undefined || data.result === null) {
            throw new FortyGuardError(
              `Activity ${activityId} completed without a result payload`,
              { activityId },
            );
          }
          return {
            result: data.result,
            raw,
            pollCount: attempt,
            elapsedMs: Date.now() - startedAt,
          };
        }
      } catch (error) {
        // Terminal — do not retry.
        if (
          error instanceof FortyGuardActivityFailedError ||
          error instanceof FortyGuardTimeoutError
        ) {
          throw error;
        }

        // Documented as transient immediately after submission.
        if (error instanceof FortyGuardNotFoundError) {
          if (elapsedMs > notFoundGraceMs) {
            throw new FortyGuardError(
              `Activity ${activityId} still unknown to the API after ` +
                `${Math.round(elapsedMs / 1000)}s; treating 404 as terminal.`,
              { activityId, statusCode: 404, cause: error },
            );
          }
          options.onProgress?.({ activityId, attempt, state: 'processing', elapsedMs });
        } else if (
          error instanceof FortyGuardRateLimitError ||
          error instanceof FortyGuardServerError
        ) {
          consecutiveTransient += 1;
          if (consecutiveTransient > maxTransient) throw error;
          const backoff =
            error instanceof FortyGuardRateLimitError && error.retryAfterMs !== undefined
              ? error.retryAfterMs
              : intervalMs * Math.min(2 ** consecutiveTransient, 8);
          await sleep(backoff);
          continue;
        } else {
          throw error;
        }
      }

      await sleep(intervalMs);
    }
  }

  // -------------------------------------------------------------------------
  // Full job cycles
  // -------------------------------------------------------------------------

  /**
   * Temperature heatmap over an AOI. With the default `analytic_type` of `tcm`,
   * tile values and `stats_data` are °C.
   */
  async runHeatmap(
    request: HeatmapRequest,
    options: PollOptions = {},
  ): Promise<JobResult<HeatmapResult>> {
    const startedAt = Date.now();
    const { activityId, raw: submitRaw } = await this.submit('/heatmap', request);
    const { result, raw: statusRaw, pollCount } = await this.awaitCompletion<HeatmapResult>(
      activityId,
      options,
    );
    return {
      activityId,
      result,
      submitRaw,
      statusRaw,
      pollCount,
      elapsedMs: Date.now() - startedAt,
    };
  }

  /**
   * Environmental parameters (heat index, relative humidity, wet bulb, …) for a
   * coordinate.
   *
   * NOTE: `request.temperature` is an input. This endpoint enriches a
   * temperature you already have; it does not source one. The normal pairing is
   * `runHeatmap` first, then this with the resulting temperature.
   */
  async runEnvParams(
    request: EnvParamsRequest,
    options: PollOptions = {},
  ): Promise<JobResult<EnvParamsResult>> {
    const startedAt = Date.now();
    const { activityId, raw: submitRaw } = await this.submit('/env_params', request);
    const { result, raw: statusRaw, pollCount } = await this.awaitCompletion<EnvParamsResult>(
      activityId,
      options,
    );
    return {
      activityId,
      result,
      submitRaw,
      statusRaw,
      pollCount,
      elapsedMs: Date.now() - startedAt,
    };
  }
}
