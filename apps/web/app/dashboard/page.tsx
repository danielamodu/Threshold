/**
 * Proof-of-plumbing only — NOT the real product UI. That's Manus's skeleton,
 * pulled in and connected separately (per direction: Manus designs, this
 * project wires it to real data). This page exists to show the auth → org →
 * role chain actually resolves end to end once Clerk Organizations is
 * enabled; nothing here is meant to be the final look of anything.
 */

import { auth } from '@clerk/nextjs/server';
import { UserButton } from '@clerk/nextjs';
import { roleFromClerk, UnrecognizedClerkRoleError } from '@threshold/accounts';

export default async function DashboardPage() {
  const { userId, orgId, orgRole } = await auth();

  let mappedRole: string;
  let roleError: string | null = null;
  try {
    mappedRole = orgRole ? roleFromClerk(orgRole) : '(no active organization)';
  } catch (error) {
    mappedRole = '(unmapped)';
    roleError = error instanceof UnrecognizedClerkRoleError ? error.message : String(error);
  }

  return (
    <main style={{ maxWidth: '40rem', margin: '0 auto', padding: '3rem 1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: '1.4rem' }}>Auth plumbing check</h1>
        <UserButton />
      </div>
      <dl style={{ marginTop: '2rem', fontSize: '0.9rem' }}>
        <dt style={{ color: 'var(--text-muted)' }}>userId</dt>
        <dd style={{ margin: '0 0 1rem', fontFamily: 'ui-monospace, monospace' }}>{userId}</dd>
        <dt style={{ color: 'var(--text-muted)' }}>orgId</dt>
        <dd style={{ margin: '0 0 1rem', fontFamily: 'ui-monospace, monospace' }}>{orgId ?? '(none — no active organization)'}</dd>
        <dt style={{ color: 'var(--text-muted)' }}>raw Clerk orgRole</dt>
        <dd style={{ margin: '0 0 1rem', fontFamily: 'ui-monospace, monospace' }}>{orgRole ?? '(none)'}</dd>
        <dt style={{ color: 'var(--text-muted)' }}>mapped to @threshold/accounts Role</dt>
        <dd style={{ margin: '0 0 1rem', fontFamily: 'ui-monospace, monospace' }}>{mappedRole}</dd>
      </dl>
      {roleError && (
        <p style={{ color: 'var(--risk-high)', fontSize: '0.85rem' }}>{roleError}</p>
      )}
      {!orgId && (
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          No active organization — this account either has none, or Organizations is not yet
          enabled for this Clerk instance (Dashboard → Organizations Settings).
        </p>
      )}
    </main>
  );
}
