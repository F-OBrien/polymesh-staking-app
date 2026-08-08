import { afterEach, describe, expect, it, vi } from 'vitest';
import { activeLeaseCount, resetApi, setApiFactory } from './browser-api';
import { isWatchedEvent, startLive, type LiveState } from './live';

/**
 * A fake chain that records every subscription and whether it was closed.
 *
 * The point of these tests is the *lifecycle*, not the decoding: "no open
 * sockets after stop" is a Phase 7 acceptance criterion, and it is exactly the
 * kind of thing that silently regresses.
 */
function fakeChain() {
  const subs: { key: string; closed: boolean }[] = [];
  const handlers = new Map<string, (value: unknown) => void>();

  const sub =
    (key: string) =>
    (...args: unknown[]) => {
      const callback = args.at(-1) as (value: unknown) => void;
      const entry = { key, closed: false };
      subs.push(entry);
      handlers.set(key, callback);
      return Promise.resolve(() => {
        entry.closed = true;
      });
    };

  const activeEra = Object.assign(sub('activeEra'), {
    // The bare (non-subscription) read used to pin era points.
    call: null,
  });

  const api = {
    query: {
      staking: {
        activeEra: (...args: unknown[]) =>
          args.length === 0
            ? Promise.resolve({
                isSome: true,
                unwrap: () => ({ index: { toString: () => '1403' } }),
              })
            : activeEra(...args),
        currentEra: sub('currentEra'),
        erasRewardPoints: sub('erasRewardPoints'),
        nominators: sub('nominators'),
      },
      session: { currentIndex: sub('sessionIndex') },
      babe: { epochIndex: sub('epochIndex'), currentSlot: sub('currentSlot') },
      electionProviderMultiPhase: { currentPhase: sub('phase') },
      system: { events: sub('events') },
    },
  };

  let disconnects = 0;
  setApiFactory(async () => ({
    api: api as never,
    disconnect: async () => {
      disconnects += 1;
    },
  }));

  return {
    subs,
    emit: (key: string, value: unknown) => handlers.get(key)?.(value),
    get openCount() {
      return subs.filter((s) => !s.closed).length;
    },
    get disconnects() {
      return disconnects;
    },
  };
}

afterEach(async () => {
  await resetApi();
  setApiFactory(null);
});

describe('isWatchedEvent', () => {
  it('watches nomination on the validators pallet, where v8 moved it', () => {
    // Watching staking.Nominated instead would fail silently: no error, just a
    // page that never notices a nomination change.
    expect(isWatchedEvent('validators', 'Nominated')).toBe(true);
    expect(isWatchedEvent('staking', 'Nominated')).toBe(false);
  });

  it('watches the documented staking, offence and heartbeat events', () => {
    expect(isWatchedEvent('staking', 'Slashed')).toBe(true);
    expect(isWatchedEvent('staking', 'StakersElected')).toBe(true);
    expect(isWatchedEvent('offences', 'Offence')).toBe(true);
    expect(isWatchedEvent('imOnline', 'SomeOffline')).toBe(true);
  });

  it('ignores everything else', () => {
    expect(isWatchedEvent('balances', 'Transfer')).toBe(false);
    expect(isWatchedEvent('system', 'ExtrinsicSuccess')).toBe(false);
  });
});

describe('startLive', () => {
  const noop = () => undefined;

  it('subscribes to the documented set', async () => {
    const chain = fakeChain();
    const session = await startLive({ endpoint: 'wss://x', onChange: noop });

    expect(chain.subs.map((s) => s.key).sort()).toEqual(
      [
        'activeEra',
        'currentEra',
        'currentSlot',
        'epochIndex',
        'erasRewardPoints',
        'events',
        'phase',
        'sessionIndex',
      ].sort(),
    );
    await session.stop();
  });

  it('adds a nominations subscription only when a stash is given', async () => {
    const withoutStash = fakeChain();
    const a = await startLive({ endpoint: 'wss://x', onChange: noop });
    expect(withoutStash.subs.some((s) => s.key === 'nominators')).toBe(false);
    await a.stop();
    await resetApi();

    const withStash = fakeChain();
    const b = await startLive({ endpoint: 'wss://x', stash: '5Stash', onChange: noop });
    expect(withStash.subs.some((s) => s.key === 'nominators')).toBe(true);
    await b.stop();
  });

  it('closes every subscription and releases the connection on stop', async () => {
    // The Phase 7 acceptance criterion, asserted directly.
    const chain = fakeChain();
    const session = await startLive({ endpoint: 'wss://x', stash: '5Stash', onChange: noop });

    expect(chain.openCount).toBeGreaterThan(0);
    expect(activeLeaseCount()).toBe(1);

    await session.stop();

    expect(chain.openCount).toBe(0);
    expect(activeLeaseCount()).toBe(0);
    await vi.waitFor(() => expect(chain.disconnects).toBe(1));
  });

  it('is safe to stop twice', async () => {
    const chain = fakeChain();
    const session = await startLive({ endpoint: 'wss://x', onChange: noop });
    await session.stop();
    await session.stop();
    await vi.waitFor(() => expect(chain.disconnects).toBe(1));
  });

  it('emits patches rather than whole states, so a consumer keeps its snapshot', async () => {
    const chain = fakeChain();
    const patches: Partial<LiveState>[] = [];
    const session = await startLive({ endpoint: 'wss://x', onChange: (p) => patches.push(p) });

    chain.emit('sessionIndex', { toString: () => '8413' });
    expect(patches).toContainEqual({ sessionIndex: 8413 });

    // Nothing else was overwritten — a patch carries exactly one field.
    expect(patches.every((p) => Object.keys(p).length === 1)).toBe(true);
    await session.stop();
  });

  it('keeps the slot as a string', async () => {
    // Slots can exceed Number.MAX_SAFE_INTEGER; the progress maths is bigint.
    const chain = fakeChain();
    const patches: Partial<LiveState>[] = [];
    const session = await startLive({ endpoint: 'wss://x', onChange: (p) => patches.push(p) });

    chain.emit('currentSlot', { toString: () => '9007199254740993' });
    expect(patches).toContainEqual({ currentSlot: '9007199254740993' });
    await session.stop();
  });

  it('bumps the event epoch once per block, not once per matching event', async () => {
    const chain = fakeChain();
    const patches: Partial<LiveState>[] = [];
    const session = await startLive({ endpoint: 'wss://x', onChange: (p) => patches.push(p) });

    chain.emit('events', [
      { event: { section: 'staking', method: 'Rewarded' } },
      { event: { section: 'staking', method: 'Bonded' } },
      { event: { section: 'offences', method: 'Offence' } },
    ]);

    expect(patches.filter((p) => 'eventEpoch' in p)).toHaveLength(1);
    await session.stop();
  });

  it('ignores a block with no watched events', async () => {
    const chain = fakeChain();
    const patches: Partial<LiveState>[] = [];
    const session = await startLive({ endpoint: 'wss://x', onChange: (p) => patches.push(p) });

    chain.emit('events', [{ event: { section: 'balances', method: 'Transfer' } }]);
    expect(patches.filter((p) => 'eventEpoch' in p)).toHaveLength(0);
    await session.stop();
  });

  it('decodes the election phase', async () => {
    const chain = fakeChain();
    const patches: Partial<LiveState>[] = [];
    const session = await startLive({ endpoint: 'wss://x', onChange: (p) => patches.push(p) });

    chain.emit('phase', { isSigned: true });
    expect(patches).toContainEqual({ electionPhase: 'Signed' });

    chain.emit('phase', {});
    expect(patches).toContainEqual({ electionPhase: 'Off' });
    await session.stop();
  });

  it('releases the connection when a subscription throws during setup', async () => {
    // A half-opened session that keeps a lease is a leaked socket the user has
    // no way to close.
    setApiFactory(async () => ({
      api: {
        query: {
          staking: {
            activeEra: () => Promise.reject(new Error('subscribe failed')),
            currentEra: () => Promise.resolve(() => undefined),
          },
          session: { currentIndex: () => Promise.resolve(() => undefined) },
          babe: {
            epochIndex: () => Promise.resolve(() => undefined),
            currentSlot: () => Promise.resolve(() => undefined),
          },
          electionProviderMultiPhase: { currentPhase: () => Promise.resolve(() => undefined) },
          system: { events: () => Promise.resolve(() => undefined) },
        },
      } as never,
      disconnect: async () => undefined,
    }));

    const onError = vi.fn();
    await expect(startLive({ endpoint: 'wss://x', onChange: noop, onError })).rejects.toThrow();
    expect(onError).toHaveBeenCalled();
    await vi.waitFor(() => expect(activeLeaseCount()).toBe(0));
  });
});
