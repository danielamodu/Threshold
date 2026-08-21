import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ClerkProvider } from '@clerk/nextjs';
import './globals.css';

export const metadata: Metadata = {
  title: 'Threshold',
  description: 'Unified thermal-liability engine for temperature-controlled fleets',
};

/**
 * ClerkProvider wraps the whole app (§11 Phase 7), but the hackathon demo at
 * `/` stays public — see middleware.ts. Adding a login wall in front of the
 * judge-facing demo would undercut §6 Phase 5's own exit condition ("a
 * stranger could click the injector... without narration"), and Phases 0-6
 * are explicitly untouched by this extension.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
