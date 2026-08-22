/**
 * Clerk session verification for the Fastify backend (§11 Phase 7).
 *
 * Next.js has clerkMiddleware() for this; Fastify needs the lower-level
 * verifyToken() primitive from @clerk/backend directly. Verifies the JWT in
 * the `Authorization: Bearer <token>` header against CLERK_SECRET_KEY and
 * decorates `request.auth` with the decoded identity — userId, the active
 * org, and that org's role mapped onto our own Role type.
 *
 * VERIFIED against a live token (Organizations enabled, a real account
 * signed up, real org auto-created, real org:admin role) — with one real bug
 * caught and fixed in the process: session token claims are versioned
 * (`JwtPayload`'s `v` field). This instance's actual default is v2, which
 * nests org info under `o: { id, rol }` instead of the deprecated flat
 * `org_id`/`org_role` claims (typed `never` on the v2 branch) — a first pass
 * reading only the flat claims verified the token fine but always returned
 * orgId/role as null. `@clerk/nextjs`'s `auth()` normalizes both shapes
 * internally; this file now checks `claims.v === 2` and reads both.
 *
 * `verifyToken`'s own doc comment shows a try/catch, throw-on-failure usage
 * example, which looked contradicted by a discriminated `{ data } | { errors
 * }` return type seen while chasing a typecheck failure here — but that
 * union type belongs to a different declaration, on the deep
 * `@clerk/backend/dist/tokens/verify.d.ts` path. The root package export
 * (`import { verifyToken } from '@clerk/backend'`, what this file actually
 * uses) resolves to `dist/index.d.ts`'s own declaration instead:
 * `Promise<NonNullable<JwtPayload | undefined>>` — i.e. throw-on-failure,
 * matching the doc example exactly. Confirmed by reading dist/index.d.ts
 * directly rather than assuming the deep-path type applied here.
 *
 * Deliberately NOT applied to /health, /ready, /api/route, or /api/simulate —
 * those stay public so the hackathon demo and Manus's skeleton keep working
 * unauthenticated. Use `requireAuth` as a preHandler on new, real product
 * routes only.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { verifyToken } from '@clerk/backend';
import { roleFromClerk, type Role } from '@threshold/accounts';

export interface ThresholdAuth {
  userId: string;
  orgId: string | null;
  role: Role | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: ThresholdAuth;
  }
}

export class MissingAuthorizationError extends Error {
  constructor() {
    super('Missing or malformed Authorization header — expected "Bearer <clerk-session-token>".');
    this.name = 'MissingAuthorizationError';
  }
}

function extractBearerToken(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new MissingAuthorizationError();
  return header.slice('Bearer '.length).trim();
}

/**
 * Fastify preHandler. Verifies the token, populates request.auth, and lets
 * the route continue. A role that doesn't map (e.g. Clerk's default
 * `org:member`, or a custom role not yet wired into clerk-roles.ts) is
 * carried through as `role: null` rather than rejecting the request outright
 * — route handlers decide whether an unmapped role is acceptable for them.
 */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    reply.code(500).send({ error: 'CLERK_SECRET_KEY is not configured on this server.' });
    return;
  }

  let token: string;
  try {
    token = extractBearerToken(request);
  } catch {
    reply.code(401).send({ error: 'Missing or malformed Authorization header.' });
    return;
  }

  try {
    // The @clerk/backend root export's verifyToken throws on an invalid or
    // expired token (Promise<JwtPayload>, not a { data }/{ errors } result —
    // see the header comment) — the outer catch below is the failure path.
    //
    // clockSkewInMs: the default is 5s, which real client clocks can and do
    // exceed (verified live — a ~15s-slow dev machine's token was rejected
    // with "iat is in the future" against the default). Clerk's own
    // authenticateRequest() (what @clerk/nextjs's auth() uses) papers over
    // this with an internal retry at a 24h tolerance — appropriate for a
    // dev-experience fallback, not for a security boundary we control
    // directly. 30s absorbs realistic unsynced-clock drift without opening
    // a window anywhere near that wide.
    const claims = await verifyToken(token, { secretKey, clockSkewInMs: 30_000 });

    // Session token claims are versioned (JwtPayload's `v` field). v2 (this
    // instance's actual default, confirmed against a real live token — the
    // v1 org_id/org_role read alone came back null even from a fresh,
    // successfully-verified token) nests org info under `o: { id, rol }`
    // instead of flat org_id/org_role, which are typed `never` on that
    // branch. `claims.v === 2` narrows the union so both shapes are handled.
    //
    // o.rol is also missing the `org:` prefix that org_role (and
    // @clerk/nextjs's auth().orgRole) always carries — confirmed by decoding
    // a real live token: o.rol came back as the bare 'admin', not 'org:admin',
    // and clerk-roles.ts's map only recognizes the prefixed form. v2 clearly
    // strips the constant "org:" prefix to shrink the compact token; it's
    // reconstructed here rather than duplicating clerk-roles.ts's map twice.
    const orgId = claims.v === 2 ? (claims.o?.id ?? null) : (claims.org_id ?? null);
    const rawOrgRole =
      claims.v === 2 ? (claims.o?.rol ? `org:${claims.o.rol}` : undefined) : claims.org_role;

    let role: Role | null = null;
    if (rawOrgRole) {
      try {
        role = roleFromClerk(rawOrgRole);
      } catch {
        role = null; // unrecognized role — let the route decide, don't 500 here
      }
    }

    request.auth = {
      userId: claims.sub,
      orgId,
      role,
    };
  } catch (error) {
    reply.code(401).send({
      error: 'Invalid or expired session token.',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
