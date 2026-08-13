import type { RawActivityStatus } from './api-types.js';

/** Normalised, terminal-aware activity state. */
export type ActivityState = 'processing' | 'completed' | 'failed';

/**
 * FortyGuard's docs are not internally consistent about status casing or
 * vocabulary: Create Heatmap documents `Processing | Completed | Failed`, while
 * the Quickstart's reference loop also branches on `succeeded` and `error`.
 * Normalising all five case-insensitively is cheaper than guessing which the
 * live API emits, and keeps the poller correct either way.
 */
export function normalizeStatus(raw: RawActivityStatus | undefined): ActivityState {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === 'completed' || value === 'succeeded' || value === 'success') return 'completed';
  if (value === 'failed' || value === 'error') return 'failed';
  return 'processing';
}

export function isTerminal(state: ActivityState): boolean {
  return state === 'completed' || state === 'failed';
}
