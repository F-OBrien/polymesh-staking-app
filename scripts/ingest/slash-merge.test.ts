import { describe, expect, it } from 'vitest';
import { mergeNominatorTotals, mergeSlashEvents } from './slash-merge';
import type { NominatorSlashTotal, SlashEvent } from '../../lib/schemas/data';

const event = (era: number, address: string, fraction = 0.01): SlashEvent => ({
  era,
  address,
  fraction,
  amount: 100,
});

describe('mergeSlashEvents', () => {
  it('keeps events from eras the chain has already pruned', () => {
    // The whole reason the merge exists: without it the record would shrink by
    // one era every day as the history window slid forward.
    const stored = [event(10, 'a'), event(11, 'b')];
    const merged = mergeSlashEvents(stored, [], 12);
    expect(merged).toHaveLength(2);
  });

  it('drops stored events inside the scanned window when the chain no longer reports them', () => {
    // Inside the window an absence is real evidence, so a stored event that the
    // chain now disagrees with must not survive — otherwise a corrected or
    // reverted slash would be preserved forever.
    const merged = mergeSlashEvents([event(20, 'a')], [], 15);
    expect(merged).toEqual([]);
  });

  it('lets a fresh scan overwrite a stored event for the same era and address', () => {
    const merged = mergeSlashEvents([event(20, 'a', 0.01)], [event(20, 'a', 0.07)], 15);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.fraction).toBe(0.07);
  });

  it('combines pruned history with a fresh scan', () => {
    const merged = mergeSlashEvents([event(5, 'a')], [event(30, 'b')], 20);
    expect(merged.map((e) => e.era)).toEqual([5, 30]);
  });

  it('sorts by era, then address, so the output is stable run to run', () => {
    const merged = mergeSlashEvents([], [event(9, 'z'), event(3, 'b'), event(9, 'a')], 0);
    expect(merged.map((e) => `${e.era}${e.address}`)).toEqual(['3b', '9a', '9z']);
  });

  it('treats the same address in different eras as separate events', () => {
    const merged = mergeSlashEvents([], [event(4, 'a'), event(5, 'a')], 0);
    expect(merged).toHaveLength(2);
  });

  it('returns an empty list when there is nothing on either side', () => {
    expect(mergeSlashEvents([], [], 100)).toEqual([]);
  });
});

describe('mergeNominatorTotals', () => {
  const total = (era: number, count: number): NominatorSlashTotal => ({ era, count, amount: 1 });

  it('carries pruned eras and prefers the scan inside the window', () => {
    const merged = mergeNominatorTotals([total(5, 3), total(25, 1)], [total(25, 9)], 20);
    expect(merged).toEqual([
      { era: 5, count: 3, amount: 1 },
      { era: 25, count: 9, amount: 1 },
    ]);
  });

  it('sorts by era', () => {
    const merged = mergeNominatorTotals([], [total(8, 1), total(2, 1)], 0);
    expect(merged.map((t) => t.era)).toEqual([2, 8]);
  });
});
