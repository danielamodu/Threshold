/**
 * Event Bus (§2).
 *
 *   "normalizes ingestion into one canonical ThermalExposureEvent. Everything
 *    downstream subscribes to this, not to raw feeds."
 *
 * In-process emitter, per §4 — demo scale does not justify Redis, and the
 * upgrade path is a note in the README rather than code nobody needs yet.
 *
 * The important property is not the transport, it is that EVERY subscriber sees
 * EVERY event. §2: "Both evaluators consume the same event... don't let an
 * implementer accidentally fork the pipeline." So `publish` fans out to all
 * subscribers and waits for all of them, and one subscriber throwing does not
 * rob the others of the event — the failure is collected and rethrown after the
 * fan-out completes.
 */

import type { ThermalExposureEvent } from '@threshold/types';

export type Subscriber = (event: ThermalExposureEvent) => void | Promise<void>;

export class SubscriberError extends Error {
  readonly failures: readonly { name: string; error: unknown }[];
  constructor(failures: readonly { name: string; error: unknown }[]) {
    super(
      `${failures.length} subscriber(s) failed handling an event: ` +
        failures.map((f) => f.name).join(', '),
    );
    this.name = 'SubscriberError';
    this.failures = failures;
  }
}

export class EventBus {
  private readonly subscribers = new Map<string, Subscriber>();
  private published = 0;

  /** Named so a failure can be attributed to a specific evaluator. */
  subscribe(name: string, handler: Subscriber): () => void {
    if (this.subscribers.has(name)) {
      throw new Error(`A subscriber named "${name}" is already registered.`);
    }
    this.subscribers.set(name, handler);
    return () => void this.subscribers.delete(name);
  }

  get subscriberCount(): number {
    return this.subscribers.size;
  }

  get publishedCount(): number {
    return this.published;
  }

  /**
   * Fan out to every subscriber. Runs them concurrently — neither evaluator
   * depends on the other's output, and serialising them would only invent an
   * ordering that §2 does not ask for.
   */
  async publish(event: ThermalExposureEvent): Promise<void> {
    this.published++;
    const entries = [...this.subscribers.entries()];

    const settled = await Promise.allSettled(
      entries.map(async ([, handler]) => handler(event)),
    );

    const failures = settled.flatMap((result, i) => {
      if (result.status !== 'rejected') return [];
      const name = entries[i]?.[0] ?? 'unknown';
      return [{ name, error: result.reason as unknown }];
    });

    if (failures.length > 0) throw new SubscriberError(failures);
  }
}
