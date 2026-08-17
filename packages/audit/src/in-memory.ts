/**
 * In-memory audit sink — the default for tests and for any run fed by synthetic
 * data.
 *
 * It mirrors the real table's observable behaviour deliberately: entries are
 * append-only, `seq` is monotonic, and — like Postgres identity sequences — a
 * REJECTED append still consumes a sequence value. That last detail matters,
 * because a test that asserts gap-free `seq` would pass here and fail against
 * Postgres. Better to reproduce the real semantics than a tidier fiction.
 */

import { randomUUID } from 'node:crypto';
import type { AuditLogEntry, AuditLogInsert } from '@threshold/types';
import { assertLoggable, type AuditSink } from './sink.js';

export class InMemoryAuditSink implements AuditSink {
  private readonly entries: AuditLogEntry[] = [];
  /** Next identity value. Incremented even when an append is rejected. */
  private nextSeq = 1;

  append(entry: AuditLogInsert): Promise<AuditLogEntry> {
    // Burn the sequence value BEFORE validating, exactly as Postgres does.
    const seq = this.nextSeq++;

    try {
      assertLoggable(entry);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }

    const stored: AuditLogEntry = {
      ...entry,
      seq,
      entry_id: randomUUID(),
      route_id: entry.route_id ?? null,
      rationale: entry.rationale ?? null,
      occurred_at: entry.occurred_at ?? null,
      recorded_at: new Date().toISOString(),
    };

    this.entries.push(stored);
    return Promise.resolve(stored);
  }

  read(): Promise<AuditLogEntry[]> {
    return Promise.resolve([...this.entries]);
  }

  /** Synchronous accessor for assertions. */
  readSync(): readonly AuditLogEntry[] {
    return this.entries;
  }

  /** Entries of one type, in order. */
  ofType<T extends AuditLogInsert['entry_type']>(
    entryType: T,
  ): readonly Extract<AuditLogEntry, { entry_type: T }>[] {
    return this.entries.filter(
      (e): e is Extract<AuditLogEntry, { entry_type: T }> => e.entry_type === entryType,
    );
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
