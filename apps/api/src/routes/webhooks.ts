/**
 * Clerk webhook handler for auto-linking drivers (§11 invite flow).
 *
 * WHY THIS EXISTS
 * The Drivers page's manual "paste Clerk User ID" is error-prone and requires
 * the admin to switch to Clerk's Members view, copy an opaque ID, switch back,
 * and paste. The invite flow makes this one step: admin enters an email,
 * Clerk sends an invitation with publicMetadata { driver_id }, and when the
 * invitee accepts, this webhook reads that metadata and calls the existing
 * linkClerkUser logic automatically. No manual ID entry.
 *
 * WHAT THIS HANDLES
 * Clerk can send many event types to the same endpoint. This handler only
 * acts on `organizationMembership.created` — the event that fires when a user
 * accepts an organization invitation and becomes a member. It extracts:
 *   - organization.id  → org_id
 *   - public_user_data.user_id → clerk_user_id (the new member's Clerk user ID)
 *   - public_metadata.driver_id → driver_id (from the invitation's publicMetadata)
 *
 * If driver_id is missing, the membership was not created via a driver invite
 * (e.g., a normal org:admin invite) and we ignore it with a 200.
 *
 * VERIFICATION
 * Clerk signs webhooks with Svix (headers svix-id, svix-timestamp, svix-signature).
 * If CLERK_WEBHOOK_SECRET is set, we verify with standardwebhooks. If not set,
 * we log a warning and skip verification — this keeps local dev working without
 * a secret, but production should always set it. Never fail open silently; the
 * warning is loud.
 *
 * Idempotency: linkClerkUser's 409 (user already linked elsewhere) is treated
 * as success — the webhook should not retry and Svix should not keep delivering.
 */

import type { FastifyInstance } from 'fastify';
import { DriverStore } from '@threshold/accounts';

export function registerWebhookRoutes(
  app: FastifyInstance,
  options: { connectionString: string },
): void {
  const store = new DriverStore(options.connectionString);
  app.addHook('onClose', async () => {
    await store.close();
  });

  app.post('/api/webhooks/clerk', async (request, reply) => {
    const secret = process.env.CLERK_WEBHOOK_SECRET?.trim();
    const rawBody = (request.body as unknown) as string | object;

    // If secret is configured, verify Svix signature
    if (secret) {
      try {
        const { Webhook } = await import('standardwebhooks');
        const wh = new Webhook(secret);
        const headers = {
          'svix-id': (request.headers['svix-id'] as string) ?? '',
          'svix-timestamp': (request.headers['svix-timestamp'] as string) ?? '',
          'svix-signature': (request.headers['svix-signature'] as string) ?? '',
        };
        const payload = typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody);
        wh.verify(payload, headers);
      } catch (err) {
        request.log.warn({ err }, 'Clerk webhook signature verification failed');
        reply.code(400).send({ error: 'Invalid webhook signature' });
        return;
      }
    } else {
      request.log.warn('CLERK_WEBHOOK_SECRET not set — skipping webhook signature verification (dev only)');
    }

    const body = typeof rawBody === 'string' ? JSON.parse(rawBody) : (rawBody as Record<string, unknown>);
    const eventType = body.type as string | undefined;
    const data = body.data as Record<string, unknown> | undefined;

    if (!eventType || !data) {
      reply.code(400).send({ error: 'Invalid webhook payload' });
      return;
    }

    // Only handle membership creation — other events are ignored with 200
    if (eventType !== 'organizationMembership.created') {
      request.log.info({ eventType }, 'Ignoring Clerk webhook event');
      return reply.code(200).send({ received: true, ignored: eventType });
    }

    // Extract org, user, and driver_id from membership payload
    // Clerk's membership object has: organization.id, public_user_data.user_id, public_metadata, private_metadata
    const organization = (data.organization ?? data.org ?? {}) as Record<string, unknown>;
    const orgId = (organization.id ?? data.organization_id ?? data.org_id) as string | undefined;
    const publicUserData = (data.public_user_data ?? data.publicUserData ?? {}) as Record<string, unknown>;
    const userId = (publicUserData.user_id ?? publicUserData.userId ?? data.user_id ?? data.userId) as string | undefined;
    const publicMetadata = (data.public_metadata ?? data.publicMetadata ?? {}) as Record<string, unknown>;
    // Also check privateMetadata as fallback — invitation might have used privateMetadata
    const privateMetadata = (data.private_metadata ?? data.privateMetadata ?? {}) as Record<string, unknown>;
    const driverId = (publicMetadata.driver_id ?? privateMetadata.driver_id ?? null) as string | null;

    if (!orgId || !userId) {
      request.log.warn({ orgId, userId, driverId }, 'Webhook missing orgId or userId — ignoring');
      return reply.code(200).send({ received: true, ignored: 'missing orgId or userId' });
    }

    if (!driverId || typeof driverId !== 'string') {
      request.log.info({ orgId, userId }, 'Membership without driver_id metadata — not a driver invite, ignoring');
      return reply.code(200).send({ received: true, ignored: 'not a driver invite' });
    }

    request.log.info({ orgId, userId, driverId }, 'Auto-linking driver via webhook');

    try {
      const driver = await store.linkClerkUser({
        org_id: orgId,
        driver_id: driverId,
        clerk_user_id: userId,
      });
      if (!driver) {
        request.log.warn({ orgId, driverId }, 'Driver not found for auto-link — org/driver mismatch');
        // Return 200 to prevent Svix retry — the driver_id was wrong, retrying won't fix it
        return reply.code(200).send({ received: true, warning: 'driver not found' });
      }
      request.log.info({ orgId, driverId, userId }, 'Driver auto-linked successfully');
      return reply.code(200).send({ received: true, linked: driverId });
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === '23505') {
        // User already linked to another driver in this org — idempotent, don't retry
        request.log.warn({ orgId, userId, driverId }, 'User already linked to another driver — ignoring duplicate');
        return reply.code(200).send({ received: true, warning: 'already linked' });
      }
      request.log.error({ err, orgId, driverId, userId }, 'Failed to auto-link driver');
      return reply.code(500).send({ error: 'Failed to link driver' });
    }
  });
}
