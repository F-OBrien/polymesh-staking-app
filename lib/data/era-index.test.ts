import { describe, expect, it } from 'vitest';
import { createEraIndex, earnedEraForReward } from './era-index';
import type { EraIndexFile } from '@/lib/schemas/data';

/**
 * Four eras starting at era 10. Deliberately *uneven* — 86,400 / 86,000 /
 * 87,000 seconds — because the whole point of this module is that eras are not
 * exactly 24h apart and a test on evenly spaced data would pass against an
 * arithmetic implementation.
 */
const file: EraIndexFile = {
  schemaVersion: 1,
  generatedAt: '2026-08-11T00:00:00.000Z',
  firstEra: 10,
  block: [1000, 2000, 3000, 4000],
  start: [1_000_000, 1_086_400, 1_172_400, 1_259_400],
};

const index = createEraIndex(file);

describe('createEraIndex', () => {
  it('reports its own coverage', () => {
    expect(index.firstEra).toBe(10);
    expect(index.lastEra).toBe(13);
    expect(index.firstStart).toBe(1_000_000);
    expect(index.lastStart).toBe(1_259_400);
  });

  it('looks up an era start and block', () => {
    expect(index.startOf(10)).toBe(1_000_000);
    expect(index.startOf(12)).toBe(1_172_400);
    expect(index.blockOf(12)).toBe(3000);
  });

  it('returns null outside the covered range rather than extrapolating', () => {
    // Extrapolation is precisely the mistake this module exists to prevent.
    expect(index.startOf(9)).toBeNull();
    expect(index.startOf(14)).toBeNull();
    expect(index.blockOf(99)).toBeNull();
  });

  it('resolves a moment to the era in progress, not the nearest boundary', () => {
    // One second into era 10, and one second before era 11 — both are era 10.
    expect(index.eraAt(1_000_001)).toBe(10);
    expect(index.eraAt(1_086_399)).toBe(10);
    // Exactly on a boundary belongs to the era starting there.
    expect(index.eraAt(1_086_400)).toBe(11);
  });

  it('does not assume a fixed era length', () => {
    // Era 11 is 86,000s and era 12 is 87,000s. An implementation that added
    // 86,400 per era would put this moment in the wrong era.
    expect(index.eraAt(1_172_399)).toBe(11);
    expect(index.eraAt(1_172_401)).toBe(12);
  });

  it('resolves a block to its era', () => {
    expect(index.eraAtBlock(1000)).toBe(10);
    expect(index.eraAtBlock(2999)).toBe(11);
    expect(index.eraAtBlock(3000)).toBe(12);
    expect(index.eraAtBlock(99_999)).toBe(13);
  });

  it('returns null before the first era rather than clamping', () => {
    expect(index.eraAt(999_999)).toBeNull();
    expect(index.eraAtBlock(999)).toBeNull();
  });
});

describe('earnedEraForReward', () => {
  // Keyed on the block the payout landed in, not its timestamp: the block is
  // an exact integer from the chain, the datetime is a string that has to be
  // parsed and whose width varies.
  it('attributes a payout to the era that just ended', () => {
    // Polymesh pays automatically once an era closes, so a payout landing a few
    // blocks into era 12 is payment for era 11. Verified on mainnet: era 1748's
    // payouts landed 14 blocks past the era boundary.
    expect(earnedEraForReward(index, 3014)).toBe(11);
  });

  it('handles a payout landing on the exact boundary block', () => {
    expect(earnedEraForReward(index, 2000)).toBe(10);
  });

  it('returns null when the earned era predates the index', () => {
    // Era 10 is the first known, so a payout inside it was earned in era 9 —
    // which we have no start for. Better blank than invented.
    expect(earnedEraForReward(index, 1500)).toBeNull();
  });

  it('returns null outside the index entirely', () => {
    expect(earnedEraForReward(index, 1)).toBeNull();
  });
});
