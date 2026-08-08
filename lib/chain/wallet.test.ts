import { describe, expect, it } from 'vitest';
import { looksLikeAddress, normaliseAddress } from './wallet';

// A real-shaped Polymesh SS58 address (48 chars, base58).
const VALID = '2HEVN4PHYKj7B1krQ9bctAQXZxHQQkANVNCcfbdYk2gZ4cBR';

describe('looksLikeAddress', () => {
  it('accepts a well-formed address', () => {
    expect(looksLikeAddress(VALID)).toBe(true);
  });

  it('tolerates surrounding whitespace, which pasting adds', () => {
    expect(looksLikeAddress(`  ${VALID}\n`)).toBe(true);
  });

  it('rejects a truncated paste', () => {
    expect(looksLikeAddress(VALID.slice(0, 20))).toBe(false);
  });

  it('rejects a hex hash, the most likely wrong paste', () => {
    expect(looksLikeAddress(`0x${'a'.repeat(64)}`)).toBe(false);
  });

  it('rejects base58-illegal characters', () => {
    // 0, O, I and l are excluded precisely because they are misread.
    expect(looksLikeAddress(`${VALID.slice(0, 47)}0`)).toBe(false);
    expect(looksLikeAddress(`${VALID.slice(0, 47)}O`)).toBe(false);
  });

  it('rejects empty and whitespace-only input', () => {
    expect(looksLikeAddress('')).toBe(false);
    expect(looksLikeAddress('   ')).toBe(false);
  });

  it('accepts a 47-character address, since encoded length varies', () => {
    expect(looksLikeAddress(VALID.slice(0, 47))).toBe(true);
  });

  it('does not claim to verify the checksum', () => {
    // A same-shaped string with one character changed still passes — by design.
    // The chain is the authority; this only catches obvious paste errors, and
    // checksum validation would mean loading blake2b before the user connects.
    const altered = `${VALID.slice(0, -1)}${VALID.endsWith('R') ? 'S' : 'R'}`;
    expect(looksLikeAddress(altered)).toBe(true);
  });
});

describe('normaliseAddress', () => {
  it('strips surrounding and interior whitespace', () => {
    expect(normaliseAddress(`  ${VALID.slice(0, 10)} ${VALID.slice(10)}  `)).toBe(VALID);
  });

  it('leaves a clean address untouched', () => {
    expect(normaliseAddress(VALID)).toBe(VALID);
  });
});
