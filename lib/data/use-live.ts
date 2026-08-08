'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveNetwork, resolveRpcUrl } from '@/config/networks';
import { EMPTY_LIVE_STATE, type LiveSession, type LiveState } from '@/lib/chain/live';

/**
 * The tier-4 Live toggle (design doc §6.6a).
 *
 * Three properties are load-bearing and each is easy to lose:
 *
 *  1. **It never gates first paint.** The socket is opened in an effect, after
 *     render, and every field starts null. A consumer shows its snapshot value
 *     until a live one arrives, then swaps it — there is no loading state
 *     because there is nothing to wait for.
 *  2. **Turning it off tears everything down.** The effect's cleanup stops the
 *     session, which unsubscribes and releases the shared connection lease.
 *  3. **Updates are batched into one state object.** The subscription set emits
 *     a patch per storage key per block; applying each with its own `setState`
 *     would be six or seven renders a block. Patches are coalesced into a ref
 *     and flushed on an animation frame.
 *
 * Defaults on when a wallet is connected — that user has already paid for
 * `@polkadot/api`, so Live costs them nothing extra — and off otherwise.
 */

export interface UseLiveResult {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  /** True once at least one value has arrived, i.e. the dot should be lit. */
  connected: boolean;
  state: LiveState;
  error: Error | null;
}

export function useLive({
  stash,
  defaultEnabled = false,
}: { stash?: string | undefined; defaultEnabled?: boolean } = {}): UseLiveResult {
  const [enabled, setEnabled] = useState(defaultEnabled);
  const [state, setState] = useState<LiveState>(EMPTY_LIVE_STATE);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Coalescing buffer. A block can produce a patch for every key in the
  // subscription set; without this each one is its own render.
  const pending = useRef<Partial<LiveState>>({});
  const frame = useRef<number | null>(null);

  useEffect(() => {
    // No reset here. Clearing state in the effect body would be a synchronous
    // setState inside an effect — a cascading render, and the thing React 19's
    // lint rule rightly rejects. The disabled state is *derived* on the way out
    // instead, and `setEnabled` clears the buffer as an event handler.
    if (!enabled) return;

    let session: LiveSession | null = null;
    let cancelled = false;

    const flush = () => {
      frame.current = null;
      const patch = pending.current;
      pending.current = {};
      if (Object.keys(patch).length === 0) return;
      setState((previous) => ({ ...previous, ...patch }));
      setConnected(true);
    };

    const onChange = (patch: Partial<LiveState>) => {
      if (cancelled) return;
      Object.assign(pending.current, patch);
      frame.current ??= requestAnimationFrame(flush);
    };

    void (async () => {
      try {
        const { startLive } = await import('@/lib/chain/live');
        const started = await startLive({
          endpoint: resolveRpcUrl(resolveNetwork()),
          ...(stash != null && stash !== '' ? { stash } : {}),
          onChange,
          onError: (liveError) => {
            if (!cancelled) setError(liveError);
          },
        });

        // The toggle may have been switched off while the socket was opening.
        if (cancelled) {
          await started.stop();
          return;
        }
        session = started;
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught : new Error(String(caught)));
          setConnected(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (frame.current != null) {
        cancelAnimationFrame(frame.current);
        frame.current = null;
      }
      pending.current = {};
      void session?.stop();
    };
  }, [enabled, stash]);

  const toggle = useCallback((next: boolean) => {
    setEnabled(next);
    // Clearing on the way *out* rather than on the way in, so re-enabling never
    // flashes values from the previous session before the socket reconnects.
    if (!next) {
      setState(EMPTY_LIVE_STATE);
      setConnected(false);
      setError(null);
    }
  }, []);

  return {
    enabled,
    setEnabled: toggle,
    connected: enabled && connected,
    // Derived, not stored: a consumer must fall back to its snapshot the
    // instant Live is off, without waiting for an effect to clear anything.
    state: enabled ? state : EMPTY_LIVE_STATE,
    error: enabled ? error : null,
  };
}
