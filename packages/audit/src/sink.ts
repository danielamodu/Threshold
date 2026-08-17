/**
 * Audit Layer port (§2).
 *
 *   "Append-only Postgres log of every event, evaluation, and agent decision —
 *    non-negotiable for a liability product."
 *
 * Everything downstream writes through this interface rather than touching
 * Postgres directly, for two reasons: tests must not need a database, and
 * synthetic data must never be able to reach the real log by accident. Rows in
 * `audit_log` cannot be deleted — that is the whole design — so an accidental
 * write is permanent.
 */

import type { AuditLogInsert, AuditLogEntry } from '@threshold/types';

export interface AuditSink {
  /** Append one entry. Resolves with the stored row, including its assigned `seq`. */
  append(entry: AuditLogInsert): Promise<AuditLogEntry>;

  /** Entries in insertion order. */
  read(): Promise<AuditLogEntry[]>;

  /** Release any underlying resources. Safe to call more than once. */
  close(): Promise<void>;
}

/** Thrown when a caller tries to log an agent decision with no rationale. */
export class MissingRationaleError extends Error {
  constructor() {
    super(
      'An agent_decision requires a non-empty rationale (§2). ' +
        'A decision with no rationale is not auditable.',
    );
    this.name = 'MissingRationaleError';
  }
}

/**
 * Shared precondition check. The database enforces this too, via check
 * constraint, but failing here gives a usable stack trace and keeps the
 * in-memory sink honest so tests exercise the same rule.
 */
export function assertLoggable(entry: AuditLogInsert): void {
  if (entry.entry_type === 'agent_decision') {
    if (entry.rationale === undefined || entry.rationale === null || entry.rationale.trim() === '') {
      throw new MissingRationaleError();
    }
  }
}
