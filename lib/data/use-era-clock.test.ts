import { describe, expect, it } from 'vitest';
import { eraDurationMs, eraProgress } from '@/lib/metrics/staking';

/**
 * The session derivation in `useEraClock`, exercised as pure arithmetic.
 *
 * The hook itself needs a React renderer; the part worth pinning is the maths,
 * which is what decides whether the panel says "session 1 of 6" or "7 of 6".
 */
const timing = { expectedBlockTimeMs: 6000, epochDurationBlocks: 2400, sessionsPerEra: 6 };

/** Mirrors the body of `useEraClock`, so a change there must change this. */
function sessionAt(eraStart: number, nowSeconds: number) {
  const durationSeconds = eraDurationMs(timing) / 1000;
  const sessionSeconds = durationSeconds / timing.sessionsPerEra;
  const elapsed = Math.max(0, nowSeconds - eraStart);
  const index = Math.min(Math.floor(elapsed / sessionSeconds), timing.sessionsPerEra - 1);
  return {
    indexInEra: index + 1,
    progress: Math.min(1, Math.max(0, (elapsed % sessionSeconds) / sessionSeconds)),
    isFinal: index === timing.sessionsPerEra - 1,
  };
}

const ERA_START = 1_786_368_372;
const HOUR = 3600;

describe('era and session timing', () => {
  it('derives a 24h era from 6 sessions of 2400 blocks at 6s', () => {
    // Never assumed to be 24h — it falls out of the chain's own constants.
    expect(eraDurationMs(timing)).toBe(86_400_000);
  });

  it('places the first session at the start of an era', () => {
    const s = sessionAt(ERA_START, ERA_START + 60);
    expect(s.indexInEra).toBe(1);
    expect(s.isFinal).toBe(false);
  });

  it('advances a session every four hours', () => {
    expect(sessionAt(ERA_START, ERA_START + 3 * HOUR).indexInEra).toBe(1);
    expect(sessionAt(ERA_START, ERA_START + 4 * HOUR).indexInEra).toBe(2);
    expect(sessionAt(ERA_START, ERA_START + 20 * HOUR).indexInEra).toBe(6);
  });

  it('flags the final session, when the next validator set is chosen', () => {
    expect(sessionAt(ERA_START, ERA_START + 19.9 * HOUR).isFinal).toBe(false);
    expect(sessionAt(ERA_START, ERA_START + 20 * HOUR).isFinal).toBe(true);
  });

  it('clamps past the era end rather than reporting "session 7 of 6"', () => {
    // The snapshot can lag a boundary by up to fifteen minutes. Running off the
    // end of the session count would look broken; being pinned to the last one
    // is merely stale, which the "ending now" copy already covers.
    const s = sessionAt(ERA_START, ERA_START + 30 * HOUR);
    expect(s.indexInEra).toBe(6);
    expect(s.isFinal).toBe(true);
  });

  it('reports session progress within the current session, not the era', () => {
    // Two hours into the second session is 50% of that session, not 25% of it.
    expect(sessionAt(ERA_START, ERA_START + 6 * HOUR).progress).toBeCloseTo(0.5, 10);
  });

  it('clamps era progress into [0,1] in both directions', () => {
    expect(eraProgress(ERA_START, ERA_START - HOUR, timing)).toBe(0);
    expect(eraProgress(ERA_START, ERA_START + 48 * HOUR, timing)).toBe(1);
    expect(eraProgress(ERA_START, ERA_START + 12 * HOUR, timing)).toBeCloseTo(0.5, 10);
  });
});
