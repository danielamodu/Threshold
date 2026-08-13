/**
 * Phase 0 placeholder.
 *
 * The judge-facing dashboard — live route map, heat-spike injector, and the
 * side-by-side event timeline — is Phase 5. This page exists so the Vercel
 * deploy skeleton has something real to serve.
 */

const PHASE_0 = [
  'Monorepo: apps/web, apps/api, packages/types, packages/fortyguard-client',
  'Data contracts mirrored from §3',
  'Append-only audit log migration (§2)',
  'FortyGuard async submit/poll client (§8)',
  'CI: lint + typecheck on push',
  'Deploy skeletons: Vercel + EC2/PM2',
];

export default function Page() {
  return (
    <main
      style={{
        maxWidth: '46rem',
        margin: '0 auto',
        padding: '4rem 1.5rem',
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: '0.75rem',
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
        }}
      >
        Phase 0 · Foundation &amp; Verification
      </p>

      <h1 style={{ fontSize: '2.5rem', lineHeight: 1.1, margin: '0.75rem 0 0' }}>Threshold</h1>

      <p style={{ color: 'var(--text-muted)', fontSize: '1.05rem', marginTop: '0.75rem' }}>
        Unified thermal-liability engine for temperature-controlled fleets.
      </p>

      <p style={{ marginTop: '2rem' }}>
        One heat event exposes two liability surfaces at once — the driver and the cargo. Both are
        resolved from a single FortyGuard-fed event, in one pass.
      </p>

      <section
        style={{
          marginTop: '2.5rem',
          padding: '1.5rem',
          background: 'var(--surface-raised)',
          border: `1px solid var(--border)`,
          borderRadius: '0.75rem',
        }}
      >
        <h2 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0, color: 'var(--text-muted)' }}>
          Scaffolded in this phase
        </h2>
        <ul style={{ margin: '1rem 0 0', paddingLeft: '1.1rem', color: 'var(--text-muted)' }}>
          {PHASE_0.map((item) => (
            <li key={item} style={{ marginBottom: '0.4rem' }}>
              {item}
            </li>
          ))}
        </ul>
      </section>

      <p style={{ marginTop: '2rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
        The dashboard lands in Phase 5. Palette direction is deferred pending sign-off per §5 — the
        colours here are neutral scaffolding, not the product palette.
      </p>
    </main>
  );
}
