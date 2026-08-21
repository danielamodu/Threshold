/**
 * §11 Phase 7 auth gate. The hackathon demo (`/`) and Clerk's own auth pages
 * stay public — everything else (the real product, once it exists beyond
 * this) requires a signed-in session. See layout.tsx for why `/` is
 * deliberately excluded.
 */

import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isPublicRoute = createRouteMatcher(['/', '/sign-in(.*)', '/sign-up(.*)']);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: ['/((?!_next|.*\\..*).*)', '/(api|trpc)(.*)'],
};
