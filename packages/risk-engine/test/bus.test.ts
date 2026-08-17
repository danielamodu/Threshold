import { strict as assert } from 'node:assert';
import { beforeEach, describe, it } from 'node:test';
import type { ThermalExposureEvent } from '@threshold/types';
import { EventBus, SubscriberError } from '../src/bus.js';
import { event, resetUuids } from './fixtures.js';

describe('Event Bus', () => {
  beforeEach(resetUuids);

  it('delivers the SAME event object to every subscriber', () => {
    // §2: "Both evaluators consume the same event... don't let an implementer
    // accidentally fork the pipeline." Identity, not deep equality — a copy
    // handed to one side is how the two modules silently drift apart.
    const bus = new EventBus();
    const seen: ThermalExposureEvent[] = [];
    bus.subscribe('human', (e) => void seen.push(e));
    bus.subscribe('cargo', (e) => void seen.push(e));

    const e = event({ temp_c: 41 });
    return bus.publish(e).then(() => {
      assert.equal(seen.length, 2);
      assert.equal(seen[0], e);
      assert.equal(seen[1], e);
      assert.equal(seen[0], seen[1]);
    });
  });

  it('counts subscribers and publishes', async () => {
    const bus = new EventBus();
    assert.equal(bus.subscriberCount, 0);
    bus.subscribe('a', () => undefined);
    bus.subscribe('b', () => undefined);
    assert.equal(bus.subscriberCount, 2);

    await bus.publish(event({ temp_c: 20 }));
    await bus.publish(event({ temp_c: 21 }));
    assert.equal(bus.publishedCount, 2);
  });

  it('awaits async subscribers before resolving', async () => {
    const bus = new EventBus();
    let done = false;
    bus.subscribe('slow', async () => {
      await new Promise((r) => setTimeout(r, 10));
      done = true;
    });
    await bus.publish(event({ temp_c: 20 }));
    assert.equal(done, true, 'publish resolved before its subscriber finished');
  });

  it('still delivers to healthy subscribers when one throws', async () => {
    // A cargo evaluator crash must not cost the driver their heat protection.
    const bus = new EventBus();
    let humanSaw = false;
    bus.subscribe('cargo', () => {
      throw new Error('cargo blew up');
    });
    bus.subscribe('human', () => {
      humanSaw = true;
    });

    await assert.rejects(() => bus.publish(event({ temp_c: 41 })), SubscriberError);
    assert.equal(humanSaw, true, 'the surviving subscriber was robbed of the event');
  });

  it('names the failing subscriber so a crash is attributable', async () => {
    const bus = new EventBus();
    bus.subscribe('cargo', () => {
      throw new Error('boom');
    });
    await bus.publish(event({ temp_c: 20 })).then(
      () => assert.fail('should have rejected'),
      (error: unknown) => {
        assert.ok(error instanceof SubscriberError);
        assert.equal(error.failures.length, 1);
        assert.equal(error.failures[0]?.name, 'cargo');
        assert.match(error.message, /cargo/);
      },
    );
  });

  it('unsubscribes', async () => {
    const bus = new EventBus();
    let count = 0;
    const off = bus.subscribe('x', () => void count++);
    await bus.publish(event({ temp_c: 20 }));
    off();
    await bus.publish(event({ temp_c: 21 }));
    assert.equal(count, 1);
    assert.equal(bus.subscriberCount, 0);
  });

  it('rejects duplicate subscriber names', () => {
    const bus = new EventBus();
    bus.subscribe('human', () => undefined);
    assert.throws(() => bus.subscribe('human', () => undefined), /already registered/);
  });
});
