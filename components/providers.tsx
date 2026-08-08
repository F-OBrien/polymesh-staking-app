'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { useState } from 'react';

/**
 * Client providers.
 *
 * The QueryClient is created inside state rather than at module scope: a
 * module-level client is shared across every request during prerender, which
 * leaks one visitor's data into another's HTML. `useState` gives one client per
 * browser session.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Per-query staleTime is set explicitly in lib/data/queries.ts.
            // This default only covers anything that forgets to, and one minute
            // is a safer floor than react-query's 0 — which is what made the
            // previous app re-fetch frozen history on every mount.
            staleTime: 60_000,
            gcTime: 24 * 60 * 60_000,
            refetchOnWindowFocus: false,
            retry: 2,
            // Exponential with a ceiling: a public CDN hiccup should back off,
            // but a user staring at a spinner should not wait 30s for attempt 3.
            retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      {/* nuqs keeps view state (era range, selected operators) in the URL, so
          every view is linkable — the previous app kept all of it in component
          state and nothing could be shared. */}
      <NuqsAdapter>{children}</NuqsAdapter>
    </QueryClientProvider>
  );
}
