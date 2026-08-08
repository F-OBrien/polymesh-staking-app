import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  acquireApi,
  activeConnectionCount,
  activeLeaseCount,
  resetApi,
  setApiFactory,
} from './browser-api';

/** A factory that records dials and disconnects without touching a chain. */
function fakeFactory() {
  const state = { dials: 0, disconnects: 0 };
  setApiFactory(async (endpoint) => {
    state.dials += 1;
    return {
      api: { endpoint } as never,
      disconnect: async () => {
        state.disconnects += 1;
      },
    };
  });
  return state;
}

afterEach(async () => {
  await resetApi();
  setApiFactory(null);
});

describe('acquireApi', () => {
  it('opens one connection and closes it when the last lease is released', async () => {
    const state = fakeFactory();

    const lease = await acquireApi('wss://a');
    expect(state.dials).toBe(1);
    expect(activeConnectionCount()).toBe(1);

    lease.release();
    await vi.waitFor(() => expect(state.disconnects).toBe(1));
    expect(activeConnectionCount()).toBe(0);
  });

  it('shares one socket across concurrent callers', async () => {
    // Wallet, stash lookup and Live all want a connection. Three sockets and
    // three copies of the metadata would be the naive outcome.
    const state = fakeFactory();

    const [a, b, c] = await Promise.all([
      acquireApi('wss://a'),
      acquireApi('wss://a'),
      acquireApi('wss://a'),
    ]);

    expect(state.dials).toBe(1);
    expect(activeLeaseCount()).toBe(3);

    a.release();
    b.release();
    expect(state.disconnects).toBe(0);
    expect(activeConnectionCount()).toBe(1);

    c.release();
    await vi.waitFor(() => expect(state.disconnects).toBe(1));
    expect(activeConnectionCount()).toBe(0);
  });

  it('keeps the socket open while another feature still holds a lease', async () => {
    // The case that motivated refcounting: turning Live off must not disconnect
    // a user's wallet session.
    const state = fakeFactory();
    const wallet = await acquireApi('wss://a');
    const live = await acquireApi('wss://a');

    live.release();
    expect(state.disconnects).toBe(0);

    wallet.release();
    await vi.waitFor(() => expect(state.disconnects).toBe(1));
  });

  it('ignores a double release rather than closing someone else’s connection', async () => {
    const state = fakeFactory();
    const a = await acquireApi('wss://a');
    const b = await acquireApi('wss://a');

    a.release();
    a.release();
    a.release();

    expect(state.disconnects).toBe(0);
    expect(activeLeaseCount()).toBe(1);

    b.release();
    await vi.waitFor(() => expect(state.disconnects).toBe(1));
  });

  it('reconnects after every lease has been released', async () => {
    const state = fakeFactory();
    (await acquireApi('wss://a')).release();
    await vi.waitFor(() => expect(state.disconnects).toBe(1));

    const again = await acquireApi('wss://a');
    expect(state.dials).toBe(2);
    again.release();
  });

  it('drops the old connection when the endpoint changes', async () => {
    // Serving state from the wrong chain is worse than reconnecting.
    const state = fakeFactory();
    const mainnet = await acquireApi('wss://mainnet');
    const testnet = await acquireApi('wss://testnet');

    expect(state.dials).toBe(2);
    await vi.waitFor(() => expect(state.disconnects).toBe(1));

    mainnet.release();
    testnet.release();
  });

  it('does not cache a failed dial, so the next attempt genuinely retries', async () => {
    let attempt = 0;
    setApiFactory(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('refused');
      return { api: {} as never, disconnect: async () => undefined };
    });

    await expect(acquireApi('wss://a')).rejects.toThrow('refused');
    expect(activeConnectionCount()).toBe(0);
    expect(activeLeaseCount()).toBe(0);

    const lease = await acquireApi('wss://a');
    expect(attempt).toBe(2);
    lease.release();
  });

  it('leaves no dangling lease when a dial fails for one of several callers', async () => {
    setApiFactory(async () => {
      throw new Error('refused');
    });

    await expect(Promise.all([acquireApi('wss://a'), acquireApi('wss://a')])).rejects.toThrow();
    await vi.waitFor(() => expect(activeLeaseCount()).toBe(0));
  });

  it('hands every caller the same api object', async () => {
    fakeFactory();
    const a = await acquireApi('wss://a');
    const b = await acquireApi('wss://a');
    expect(a.api).toBe(b.api);
    a.release();
    b.release();
  });
});

describe('resetApi', () => {
  it('closes an open connection regardless of outstanding leases', async () => {
    const state = fakeFactory();
    await acquireApi('wss://a');
    await resetApi();
    expect(state.disconnects).toBe(1);
    expect(activeConnectionCount()).toBe(0);
  });

  it('is safe with nothing open', async () => {
    await expect(resetApi()).resolves.toBeUndefined();
  });
});
