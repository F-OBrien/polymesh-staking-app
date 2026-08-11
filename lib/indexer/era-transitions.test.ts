import { describe, expect, it } from 'vitest';
import { buildEraIndex, toTransition, type EraTransition } from './era-transitions';

const node = (era: string | null, blockId: string, datetime: string | null) => ({
  eventArg0: era,
  blockId,
  block: datetime == null ? null : { datetime },
});

describe('toTransition', () => {
  it('reads the era, block and time', () => {
    expect(toTransition(node('1748', '0025026862', '2026-08-10T13:26:12'))).toEqual({
      era: 1748,
      block: 25_026_862,
      at: 1_786_368_372,
    });
  });

  it('treats the indexer datetime as UTC', () => {
    // The field carries no zone marker but is UTC. Parsing it without one lets
    // the runner's local timezone shift every era by hours — which on a daily
    // era is enough to land in the wrong day.
    const utc = toTransition(node('1', '0000028634', '2021-10-30T17:26:12'));
    expect(new Date(utc!.at * 1000).toISOString()).toBe('2021-10-30T17:26:12.000Z');
  });

  it('handles fractional seconds, which the indexer emits inconsistently', () => {
    const withMillis = toTransition(node('500', '0007078931', '2023-03-11T13:26:12.001'));
    expect(withMillis?.at).toBe(1_678_541_172);
  });

  it('drops an unreadable row rather than defaulting it', () => {
    expect(toTransition(node(null, '0000028634', '2021-10-30T17:26:12'))).toBeNull();
    expect(toTransition(node('1', '0000028634', null))).toBeNull();
    expect(toTransition(node('not-a-number', '0000028634', '2021-10-30T17:26:12'))).toBeNull();
  });
});

describe('buildEraIndex', () => {
  const transition = (era: number, block: number, at: number): EraTransition => ({ era, block, at });

  it('shifts transitions into era starts', () => {
    // The load-bearing behaviour of this module. An event tagged era N fires
    // when N *ends*, which is when N+1 begins — verified against chain storage,
    // where era 1748 started at the moment `EraPaid(1747)` was recorded.
    const built = buildEraIndex([
      transition(0, 100, 1_000),
      transition(1, 200, 2_000),
      transition(2, 300, 3_000),
    ]);

    expect(built.firstEra).toBe(1);
    expect(built.start).toEqual([1_000, 2_000, 3_000]);
    expect(built.block).toEqual([100, 200, 300]);
  });

  it('sorts transitions that arrive out of order', () => {
    const built = buildEraIndex([
      transition(2, 300, 3_000),
      transition(0, 100, 1_000),
      transition(1, 200, 2_000),
    ]);
    expect(built.start).toEqual([1_000, 2_000, 3_000]);
  });

  it('de-duplicates repeated rows', () => {
    // An offset walk over a table being written to can return a row twice.
    const built = buildEraIndex([
      transition(0, 100, 1_000),
      transition(1, 200, 2_000),
      transition(1, 200, 2_000),
    ]);
    expect(built.start).toHaveLength(2);
  });

  it('throws on a gap rather than silently shifting every later era', () => {
    // Filling or ignoring a gap would move every subsequent entry by one, so
    // every era after it would report the wrong date — plausible-looking and
    // invisible until someone reconciles a CSV against an explorer.
    expect(() =>
      buildEraIndex([transition(0, 100, 1_000), transition(2, 300, 3_000)]),
    ).toThrow(/gaps.*Missing: 1/s);
  });

  it('lists only the first few missing eras in the message', () => {
    const sparse = [transition(0, 0, 0), transition(100, 100, 100)];
    expect(() => buildEraIndex(sparse)).toThrow(/…/);
  });

  it('throws when the indexer returns nothing', () => {
    // An empty result would otherwise produce an index covering no eras, which
    // reads downstream as "this era is unknown" for every era on the chain.
    expect(() => buildEraIndex([])).toThrow(/No era transitions/);
  });
});
