/**
 * Judge-facing dashboard (§2, §6 Phase 5).
 *
 * The entire interaction model is one button. §6's exit condition: "a
 * stranger could click the injector and understand what happened without
 * narration." Nothing else is here on purpose — see the project memory on
 * keeping Phase 5 to exactly map + injector + timeline, no scope creep.
 *
 * Runs `runDemoRoute` in-process via a Server Action — see actions.ts for why
 * that's deliberate, not a shortcut.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { runDemoRoute } from './actions';
import { RouteMap } from './components/RouteMap';
import { Timeline } from './components/Timeline';
import { type DemoRunResult } from './demo-types';

export default function Page() {
  const [result, setResult] = useState<DemoRunResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    runDemoRoute()
      .then(setResult)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <main style={{ maxWidth: '52rem', margin: '0 auto', padding: '3rem 1.5rem 4rem' }}>
      <p
        style={{
          margin: 0,
          fontSize: '0.75rem',
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
        }}
      >
        Threshold — live demo
      </p>
      <h1 style={{ fontSize: '2rem', lineHeight: 1.15, margin: '0.5rem 0 0' }}>
        One heat event, two liability responses
      </h1>
      <p style={{ color: 'var(--text)', marginTop: '0.5rem', lineHeight: 1.5 }}>
        This is unedited real data from a documented heat day (<strong>2024-07-15</strong>). 
        Observe how the same telemetry inherently trips both driver compliance and cargo spoilage thresholds.
      </p>
      <p style={{ color: 'var(--text-muted)', marginTop: '1rem', fontSize: '0.9rem' }}>
        {result ? `${result.route_id} · ${result.cargo_class} · driver ${result.driver_id}` : 'Loading route…'}
      </p>

      <div style={{ margin: '1.75rem 0' }}>
        <button
          type="button"
          onClick={() => load()}
          disabled={loading}
          style={{
            padding: '0.75rem 1.5rem',
            fontSize: '1rem',
            fontWeight: 600,
            color: 'var(--text)',
            background: 'var(--surface-raised)',
            border: '1px solid var(--border)',
            borderRadius: '0.6rem',
            cursor: loading ? 'wait' : 'pointer',
            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? 'Running…' : 'Reload route'}
        </button>
      </div>

      {error && (
        <p style={{ color: 'var(--risk-high)' }}>
          Failed to run the demo route: {error}
        </p>
      )}

      {result && (
        <>
          <section
            style={{
              padding: '1.25rem',
              background: 'var(--surface-raised)',
              border: '1px solid var(--border)',
              borderRadius: '0.75rem',
            }}
          >
            <RouteMap waypoints={result.waypoints} />
          </section>

          <h2 style={{ fontSize: '1.1rem', marginTop: '2.25rem', marginBottom: '0.25rem' }}>
            Event timeline
          </h2>
          <p style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Every waypoint, both liability responses, side by side.
          </p>
          <Timeline waypoints={result.waypoints} />
        </>
      )}
    </main>
  );
}
