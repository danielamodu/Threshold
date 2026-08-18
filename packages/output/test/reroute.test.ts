import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { generateRerouteSuggestion } from '../src/reroute.js';

describe('generateRerouteSuggestion', () => {
  it('is always marked mocked — the whole point is that it says so plainly', () => {
    const s = generateRerouteSuggestion(5, 20);
    assert.equal(s.mocked, true);
  });

  it('suggests expediting when close to breach', () => {
    const s = generateRerouteSuggestion(16, 20); // 80%
    assert.equal(s.suggested_action, 'expedite_delivery');
  });

  it('suggests an alternate corridor when there is still budget', () => {
    const s = generateRerouteSuggestion(5, 20); // 25%
    assert.equal(s.suggested_action, 'alternate_corridor');
  });

  it('cites the real numbers in the rationale, not boilerplate alone', () => {
    const s = generateRerouteSuggestion(7.5, 15);
    assert.match(s.rationale, /7\.5/);
    assert.match(s.rationale, /15/);
  });

  it('admits it is advisory, not a real routing computation', () => {
    const s = generateRerouteSuggestion(5, 20);
    assert.match(s.rationale, /advisory only/i);
  });
});
