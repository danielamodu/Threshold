/**
 * Ensure-org hook (§11 Phase 7 follow-up) — closes the new-org onboarding gap.
 *
 * THE GAP: `orgs` rows are foreign-key anchors for `drivers`, `routes`, and
 * `audit_log.org_id`, but before this file the only thing that ever created
 * one was packages/accounts/scripts/seed-demo-org.ts. A brand-new Clerk org
 * signing up through the product UI had no path to a first request that
 * worked — POST /api/routes died on `routes_org_id_fkey` with a 500 that
 * looked like a server bug but was really a missing provisioning step. The
 * seed script remains for the demo dataset; it is no longer a prerequisite
 * for onboarding.
 *
 * HOW THIS WORKS: a Fastify preHandler, chained right after `authenticate` on
 * every org-scoped route. If the session carries an active org whose `orgs`
 * row does not exist yet, the org is fetched from Clerk's Backend API (name +
 * slug come from Clerk's own record — the JWT carries only `o.id`/`o.rol`,
 * never the display fields) and inserted. Once the row exists — or existed
 * all along — the check is cached for the process lifetime; the steady-state
 * cost of this hook is one in-process Set lookup, zero DB queries, zero
 * Clerk calls.
 *
 * FAILURE MODES, DELIBERATELY NOT SILENCED:
 * - Clerk reports the org unknown/deleted → 403. The token verified, but the
 *   org it names no longer exists; proceeding would fabricate an anchor for
 *   writes that belong to nothing.
 * - Clerk unreachable / non-OK → 502. The request fails; nothing is invented
 *   to let it through.
 * - CLERK_SECRET_KEY absent → 500, same posture as auth.ts.
 * - Unique violation on insert → re-check: a concurrent first request from
 *   the same org may have won the race (then we're done), otherwise the slug
 *   was taken by a different org and we retry once with a slug derived from
 *   the org id — which is unique per org by construction, so the retry
 *   cannot itself collide.
 *
 * Tests that pre-create their org rows never reach the Clerk call (the DB
 * check short-circuits), so the injected-authenticate test pattern keeps
 * working unchanged.
 */

import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { OrgStore } from '@threshold/accounts';

const UNIQUE_VIOLATION = '23505';

function pgErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const { code } = error as { code: unknown };
  return typeof code === 'string' ? code : undefined;
}

export class OrgProvisioningError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'OrgProvisioningError';
    this.status = status;
  }
}

/** Deterministic, collision-free-by-construction fallback slug (see insert). */
function slugFromOrgId(orgId: string): string {
  return orgId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

interface ClerkOrg {
  id?: string;
  name?: string;
  slug?: string;
  errors?: unknown[];
}

export function makeEnsureOrg(connectionString: string): {
  preHandler: preHandlerHookHandler;
  close: () => Promise<void>;
} {
  const store = new OrgStore(connectionString);
  const ensured = new Set<string>();

  async function ensureOrg(orgId: string): Promise<void> {
    if (ensured.has(orgId)) return;

    const existing = await store.get(orgId);
    if (existing) {
      ensured.add(orgId);
      return;
    }

    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) {
      throw new OrgProvisioningError(
        500,
        'CLERK_SECRET_KEY is not configured on this server — cannot provision a new organization.',
      );
    }

    const response = await fetch(
      `https://api.clerk.com/v1/organizations/${encodeURIComponent(orgId)}`,
      { headers: { Authorization: `Bearer ${secretKey}` } },
    );
    if (response.status === 404) {
      throw new OrgProvisioningError(
        403,
        'The organization on this session no longer exists in Clerk.',
      );
    }
    if (!response.ok) {
      throw new OrgProvisioningError(
        502,
        `Clerk organization lookup failed (HTTP ${response.status}) — org not provisioned.`,
      );
    }
    const clerkOrg = (await response.json()) as ClerkOrg;
    if (!clerkOrg.id || clerkOrg.id !== orgId) {
      throw new OrgProvisioningError(
        502,
        'Clerk organization lookup returned an unexpected payload — org not provisioned.',
      );
    }

    const name = clerkOrg.name?.trim() || orgId;
    const slug = clerkOrg.slug?.trim() || slugFromOrgId(orgId);
    try {
      await store.create({ id: orgId, name, slug });
      ensured.add(orgId);
    } catch (error) {
      if (pgErrorCode(error) !== UNIQUE_VIOLATION) throw error;
      // Either a concurrent first request from this same org created the row
      // (then we are done), or `slug` is held by a different org. Distinguishing
      // those by re-reading is cheaper and clearer than parsing which unique
      // constraint fired: orgs_slug_key vs orgs_pkey.
      if (await store.get(orgId)) {
        ensured.add(orgId);
        return;
      }
      // slugFromOrgId embeds the org id verbatim, and ids are unique — this
      // insert cannot collide on slug with a different org's row.
      await store.create({ id: orgId, name, slug: slugFromOrgId(orgId) });
      ensured.add(orgId);
    }
  }

  const preHandler: preHandlerHookHandler = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    const orgId = request.auth?.orgId;
    // No active org on the session is not this hook's problem — the route's
    // own requireOrg check decides that (403 there). This hook only provisions.
    if (!orgId) return;
    try {
      await ensureOrg(orgId);
    } catch (error) {
      if (error instanceof OrgProvisioningError) {
        reply.code(error.status).send({ error: error.message });
        return;
      }
      throw error;
    }
  };

  const close = (): Promise<void> => store.close();

  return { preHandler, close };
}
