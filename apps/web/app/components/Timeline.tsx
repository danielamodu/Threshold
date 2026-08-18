/**
 * The "event timeline showing the fork" from §2/§6 Phase 5: one
 * ThermalExposureEvent, two liability responses, timestamped side by side.
 * The Agent Decision Layer's call sits underneath as the third line — it
 * reads both, so it belongs directly below the fork it's reasoning about.
 */

'use client';

import type { DemoWaypoint, SeverityBucket } from '../demo-types';

const SEVERITY_COLOR: Record<SeverityBucket, string> = {
  low: 'var(--risk-low)',
  mid: 'var(--risk-mid)',
  high: 'var(--risk-high)',
};

function ResponseCard({
  label,
  severity,
  headline,
  detail,
}: {
  label: string;
  severity: SeverityBucket;
  headline: string;
  detail: string;
}) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        padding: '0.85rem 1rem',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderLeft: `3px solid ${SEVERITY_COLOR[severity]}`,
        borderRadius: '0.5rem',
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: '0.7rem',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
        }}
      >
        {label}
      </p>
      <p style={{ margin: '0.3rem 0 0', fontSize: '0.95rem', fontWeight: 600 }}>{headline}</p>
      <p style={{ margin: '0.25rem 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>{detail}</p>
    </div>
  );
}

function WaypointRow({ wp }: { wp: DemoWaypoint }) {
  return (
    <div style={{ padding: '1.1rem 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', marginBottom: '0.6rem' }}>
        <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}>{wp.waypoint_id}</span>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          {new Date(wp.event.timestamp).toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          })}
        </span>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          {wp.event.temp_c.toFixed(1)}°C
          {wp.event.humidity_pct === null ? ' · humidity unavailable' : ` · ${wp.event.humidity_pct}% RH`}
        </span>
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <ResponseCard
          label="Human compliance"
          severity={wp.human_severity}
          headline={describeAction(wp.compliance.action)}
          detail={
            wp.compliance.heat_index_c === null
              ? 'Heat index unavailable — degraded, conservative rule applied.'
              : `Heat index ${wp.compliance.heat_index_c}°C`
          }
        />
        <ResponseCard
          label="Cargo risk"
          severity={wp.cargo_severity}
          headline={`${wp.cargo.risk_level.toUpperCase()} — ${describeCargoAction(wp.cargo.recommended_action)}`}
          detail={`${wp.cargo.cumulative_exposure_score} / ${wp.cargo.threshold} °C·h cumulative`}
        />
      </div>

      <div
        style={{
          marginTop: '0.6rem',
          padding: '0.6rem 0.9rem',
          background: 'var(--surface-raised)',
          borderRadius: '0.5rem',
          fontSize: '0.82rem',
          color: 'var(--text-muted)',
        }}
      >
        <strong style={{ color: 'var(--text)' }}>
          {wp.decision.action_tier.toUpperCase()} (confidence {wp.decision.confidence})
        </strong>{' '}
        — {wp.decision.rationale}
      </div>
    </div>
  );
}

export function Timeline({ waypoints }: { waypoints: DemoWaypoint[] }) {
  return (
    <div>
      {waypoints.map((wp) => (
        <WaypointRow key={wp.waypoint_id} wp={wp} />
      ))}
    </div>
  );
}

function describeAction(action: DemoWaypoint['compliance']['action']): string {
  switch (action) {
    case 'none':
      return 'No action required';
    case 'rest_break_scheduled':
      return 'Rest break scheduled';
    case 'work_limit_reduced':
      return 'Work limit reduced';
  }
}

function describeCargoAction(action: DemoWaypoint['cargo']['recommended_action']): string {
  switch (action) {
    case 'none':
      return 'no action';
    case 'reroute':
      return 'reroute suggested';
    case 'claim_draft':
      return 'claim draft generated';
  }
}
