'use client';

import { useEffect, useState } from 'react';
import { eraDurationMs, eraProgress } from '@/lib/metrics/staking';
import type { EraStatus } from '@/lib/schemas/data';

/**
 * Era progress and countdown, derived in the browser.
 *
 * This is the tier-3 derivation from design doc §6.6a, and the reason
 * `latest.json` ships anchors rather than a precomputed `eraProgress`: a
 * snapshot value would be up to 15 minutes stale and would jump when refreshed,
 * whereas this ticks smoothly and **costs no network traffic at all**.
 *
 * Accuracy: drift is bounded by block-time variance over the snapshot interval,
 * which is seconds on a 24-hour era — invisible on a progress ring. Enabling the
 * optional live tier upgrades this to slot-exact.
 */

/**
 * The current time, as a value that is stable within a render.
 *
 * `Date.now()` called during render is impure — React 19's lint rules reject it
 * outright, and correctly: a component that re-renders for an unrelated reason
 * would silently recompute a duration against a different clock. Anything that
 * needs "now" for display arithmetic takes it from here instead.
 *
 * The default tick is a minute, not a second: callers of this are rendering
 * dates and elapsed spans, where a per-second re-render is pure waste. Use
 * `useEraClock` for a countdown.
 */
export function useNow(tickMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);

  return now;
}

export interface EraClock {
  /** Fraction of the active era elapsed, clamped to [0,1]. */
  progress: number;
  /** Seconds until the era ends. Zero once the snapshot has fallen behind. */
  secondsRemaining: number;
  /** Wall-clock start of the era. */
  startsAt: Date;
  /** Wall-clock end of the era. */
  endsAt: Date;
  /**
   * True when the era should already have rolled over but the snapshot has not
   * caught up. The UI uses this to say "ending now" rather than showing a
   * countdown pinned at zero, which reads as broken.
   */
  overdue: boolean;

  /**
   * Where we are in the era's sessions.
   *
   * Derived from elapsed time rather than carried from the snapshot's
   * `currentSessionIndex`, and that is deliberate: a snapshot index is fixed at
   * the moment it was written and would sit on the wrong session for most of
   * the fifteen minutes until the next one. Time-derived, it advances on its
   * own and self-corrects — the same reason `eraProgress` is not precomputed.
   */
  session: {
    /** 1-based position within the era, e.g. 3 of 6. */
    indexInEra: number;
    perEra: number;
    /** The chain's absolute session index. */
    absolute: number;
    /** Fraction of the current session elapsed, clamped to [0,1]. */
    progress: number;
    endsAt: Date;
    secondsRemaining: number;
    /**
     * True during the era's last session — when the next validator set is
     * chosen. Stated as "the set is being chosen now" rather than as a
     * countdown to an exact election block, which we cannot know.
     */
    isFinal: boolean;
  };
}

/**
 * @param eraStatus anchors from `latest.json`; null while it loads
 * @param tickMs how often to recompute — one second is smooth enough for a
 *   countdown and cheap enough to leave running
 */
export function useEraClock(eraStatus: EraStatus | null | undefined, tickMs = 1000): EraClock | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!eraStatus) return;

    // A plain interval is correct here: the work per tick is a subtraction and
    // a divide. Anything cleverer (rAF, visibility gating) would add complexity
    // for no measurable saving.
    const id = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(id);
  }, [eraStatus, tickMs]);

  if (!eraStatus) return null;

  const timing = {
    expectedBlockTimeMs: eraStatus.expectedBlockTimeMs,
    epochDurationBlocks: eraStatus.epochDurationBlocks,
    sessionsPerEra: eraStatus.sessionsPerEra,
  };

  const nowSeconds = Math.floor(now / 1000);
  const durationSeconds = eraDurationMs(timing) / 1000;
  const endSeconds = eraStatus.eraStart + durationSeconds;
  const remaining = endSeconds - nowSeconds;

  const sessionSeconds = durationSeconds / eraStatus.sessionsPerEra;
  const elapsed = Math.max(0, nowSeconds - eraStatus.eraStart);
  // Clamped to the last session: past the era's nominal end the snapshot is
  // simply behind, and reporting "session 7 of 6" would look broken.
  const sessionIndex = Math.min(
    Math.floor(elapsed / sessionSeconds),
    eraStatus.sessionsPerEra - 1,
  );
  const sessionEnd = eraStatus.eraStart + (sessionIndex + 1) * sessionSeconds;

  return {
    progress: eraProgress(eraStatus.eraStart, nowSeconds, timing),
    secondsRemaining: Math.max(0, remaining),
    startsAt: new Date(eraStatus.eraStart * 1000),
    endsAt: new Date(endSeconds * 1000),
    overdue: remaining <= 0,
    session: {
      indexInEra: sessionIndex + 1,
      perEra: eraStatus.sessionsPerEra,
      absolute: eraStatus.eraStartSessionIndex + sessionIndex,
      progress: Math.min(1, Math.max(0, (elapsed % sessionSeconds) / sessionSeconds)),
      endsAt: new Date(sessionEnd * 1000),
      secondsRemaining: Math.max(0, sessionEnd - nowSeconds),
      isFinal: sessionIndex === eraStatus.sessionsPerEra - 1,
    },
  };
}
