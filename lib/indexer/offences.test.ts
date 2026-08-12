import { describe, expect, it } from 'vitest';
import { groupOffences, toOffence, type RawOffence } from './offences';

const KEY_A = '0xb453e18887243590a57c29eeec3beae419c7f5fecdcf2e44c219d8a7b01eb657';
const KEY_B = '0x52203b90ab359fffec6875e2ea966f6cd209424df39e9f444dda672847f94f03';

/** SS58 encoding is the caller's job; tests need only a stable, distinct name. */
const encode = (key: string) => `addr-${key.slice(2, 8)}`;

describe('toOffence', () => {
  it('reads the shape mainnet actually returns', () => {
    expect(
      toOffence({
        eventArg0: KEY_A,
        eventArg1: '0',
        eventArg2: '1130',
        blockId: '0016122250',
      }),
    ).toEqual({ publicKey: KEY_A, fraction: 0, era: 1130, block: 16_122_250 });
  });

  it('converts the fraction from a Perbill', () => {
    // 7% unresponsiveness would arrive as 70,000,000 parts per billion, and
    // reporting that as a fraction of 70 million would be quite a slash.
    const report = toOffence({
      eventArg0: KEY_A,
      eventArg1: '70000000',
      eventArg2: '900',
      blockId: '0000000100',
    })!;
    expect(report.fraction).toBeCloseTo(0.07);
  });

  it('drops a row with no offender', () => {
    expect(
      toOffence({ eventArg0: null, eventArg1: '0', eventArg2: '1', blockId: '0000000001' }),
    ).toBeNull();
  });

  it('drops a row whose era cannot be read', () => {
    expect(
      toOffence({ eventArg0: KEY_A, eventArg1: '0', eventArg2: null, blockId: '0000000001' }),
    ).toBeNull();
  });
});

describe('groupOffences', () => {
  const raw = (era: number, publicKey: string, block: number, fraction = 0): RawOffence => ({
    era,
    publicKey,
    block,
    fraction,
  });

  it('collapses repeated reports of one incident into one row', () => {
    // Mainnet emits one report per session until the era ends, so the three
    // consecutive blocks naming Calico Capital in era 1716 are one node being
    // down, not three separate offences.
    const grouped = groupOffences(
      [raw(1716, KEY_A, 24_561_369), raw(1716, KEY_A, 24_563_754), raw(1716, KEY_A, 24_566_143)],
      encode,
    );
    expect(grouped).toHaveLength(1);
    expect(grouped[0]!.count).toBe(3);
  });

  it('keeps the earliest block, which is when the outage started', () => {
    const grouped = groupOffences([raw(5, KEY_A, 900), raw(5, KEY_A, 100)], encode);
    expect(grouped[0]!.block).toBe(100);
  });

  it('keeps the largest fraction reported', () => {
    const grouped = groupOffences([raw(5, KEY_A, 100, 0), raw(5, KEY_A, 200, 0.07)], encode);
    expect(grouped[0]!.fraction).toBeCloseTo(0.07);
  });

  it('separates the same operator in different eras', () => {
    const grouped = groupOffences([raw(5, KEY_A, 100), raw(6, KEY_A, 200)], encode);
    expect(grouped.map((g) => g.era)).toEqual([6, 5]);
  });

  it('separates different operators in the same era', () => {
    const grouped = groupOffences([raw(5, KEY_A, 100), raw(5, KEY_B, 200)], encode);
    expect(grouped).toHaveLength(2);
  });

  it('orders newest era first', () => {
    const grouped = groupOffences(
      [raw(5, KEY_A, 100), raw(99, KEY_B, 200), raw(50, KEY_A, 150)],
      encode,
    );
    expect(grouped.map((g) => g.era)).toEqual([99, 50, 5]);
  });

  it('drops an offender that cannot be encoded', () => {
    expect(groupOffences([raw(5, KEY_A, 100)], () => null)).toEqual([]);
  });
});
