import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readStoredSelection, storeSelection, SELECTION_STORAGE_KEY } from './selection-store';
import { MAX_NAMED_SERIES } from '@/lib/charts/palette';

const ADDRESSES = [
  '2DeWtD5Z3vxS8CCu7aorJEarjY1Mn26rnoJHVtTXgiYzVftS',
  '2D8LcQmeGSKegZsbopYP7XmkWmcPy2d7SKV3JNnM1o4prbMW',
];

describe('selection-store', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('round-trips a selection', () => {
    storeSelection(ADDRESSES);
    expect(readStoredSelection()).toEqual(ADDRESSES);
  });

  it('distinguishes "never pinned" from "cleared"', () => {
    // This distinction is the whole reason the reader is `string[] | null`.
    // If clearing were indistinguishable from having never pinned, the restore
    // path would put the pins back on the next navigation and the clear button
    // would look broken.
    expect(readStoredSelection()).toBeNull();
    storeSelection([]);
    expect(readStoredSelection()).toEqual([]);
  });

  it('caps at the palette size', () => {
    // Colour follows the entity and the palette is not cycled, so a ninth pin
    // has no colour to be given.
    // Base58 has no `0`, `O`, `I` or `l`, so the suffix cycles 1–9.
    const many = Array.from({ length: 20 }, (_, i) => `2${'a'.repeat(46)}${(i % 9) + 1}`);
    storeSelection(many);
    expect(readStoredSelection()).toHaveLength(MAX_NAMED_SERIES);
  });

  it('drops entries that are not plausible addresses', () => {
    // Guards the chart layer against a hand-edited or corrupted storage value.
    window.localStorage.setItem(
      SELECTION_STORAGE_KEY,
      JSON.stringify([ADDRESSES[0], '', 'not-an-address', 42, null, ADDRESSES[1]]),
    );
    expect(readStoredSelection()).toEqual(ADDRESSES);
  });

  it('returns null rather than throwing on unparseable storage', () => {
    window.localStorage.setItem(SELECTION_STORAGE_KEY, '{not json');
    expect(readStoredSelection()).toBeNull();
  });

  it('returns null when the value is not an array', () => {
    window.localStorage.setItem(SELECTION_STORAGE_KEY, '"a string"');
    expect(readStoredSelection()).toBeNull();
  });

  it('survives localStorage being unavailable', () => {
    // Private browsing and sandboxed frames throw on access. The URL is still
    // the source of truth, so this must degrade rather than break the page.
    const getItem = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('denied');
      });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });

    expect(readStoredSelection()).toBeNull();
    expect(() => storeSelection(ADDRESSES)).not.toThrow();

    getItem.mockRestore();
    setItem.mockRestore();
  });
});
