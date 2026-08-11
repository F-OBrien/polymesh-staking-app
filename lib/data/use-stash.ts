'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { parseAsString, useQueryState } from 'nuqs';
import { useCallback, useState } from 'react';
import { resolveIndexerUrl, resolveNetwork, resolveRpcUrl } from '@/config/networks';
import {
  fetchRewardTotals,
  fetchRewards,
  type RewardEvent,
  type RewardTotals,
} from '@/lib/indexer/rewards';
import { earnedEraForReward, type EraIndex } from './era-index';
import { connectWallet, normaliseAddress, type WalletAccount } from '@/lib/chain/wallet';
import type { StashPosition } from '@/lib/chain/stash';
import type { StakeAllocation } from '@/lib/chain/allocation';

/**
 * The stash under inspection, and everything hanging off it.
 *
 * **Nothing here loads `@polkadot/api` until a stash exists.** The queries are
 * `enabled`-gated on the address, and the chain modules are reached through
 * `await import()` inside the query function rather than at module scope — so
 * arriving at `/my-staking` disconnected costs nothing beyond the page itself.
 * That is a Phase 7 acceptance criterion and `npm run assert:lazy` checks it
 * against the built output.
 *
 * The address lives in the URL (`?stash=`), which makes an inspected position
 * linkable and means a wallet connection survives a refresh without anything
 * being persisted. Storing a wallet address in localStorage would be a small
 * privacy leak for no benefit.
 */

/** The address being inspected, held in `?stash=`. */
export function useStashAddress() {
  const [stash, setStash] = useQueryState(
    'stash',
    parseAsString.withDefault('').withOptions({ history: 'push', shallow: true }),
  );

  const set = useCallback(
    (address: string | null) => {
      const next = address == null ? null : normaliseAddress(address);
      void setStash(next == null || next === '' ? null : next);
    },
    [setStash],
  );

  return { stash, setStash: set, clear: useCallback(() => set(null), [set]) };
}

export interface WalletState {
  accounts: WalletAccount[];
  connecting: boolean;
  error: Error | null;
}

/**
 * Wallet connection, kept out of TanStack Query on purpose.
 *
 * Connecting is a user-initiated action with a permission prompt attached, not
 * a cacheable read. Modelling it as a query invites retries and background
 * refetches, each of which would re-open an extension dialog — the sort of
 * behaviour that makes people uninstall a site's permissions.
 */
export function useWallet() {
  const [state, setState] = useState<WalletState>({
    accounts: [],
    connecting: false,
    error: null,
  });

  const connect = useCallback(async (): Promise<WalletAccount[]> => {
    setState((previous) => ({ ...previous, connecting: true, error: null }));
    try {
      const accounts = await connectWallet();
      setState({ accounts, connecting: false, error: null });
      return accounts;
    } catch (error) {
      setState({
        accounts: [],
        connecting: false,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      return [];
    }
  }, []);

  const disconnect = useCallback(() => {
    setState({ accounts: [], connecting: false, error: null });
  }, []);

  return { ...state, connect, disconnect };
}

/**
 * The stash's on-chain position.
 *
 * `staleTime` is a minute: bonding changes are user-initiated and rare, and
 * this costs a websocket dial. Live (tier 4) is what makes it immediate for
 * anyone who wants that.
 */
export function useStashPosition(
  stash: string,
  activeEra: number | undefined,
): UseQueryResult<StashPosition> {
  return useQuery({
    queryKey: ['stash', stash, activeEra],
    enabled: stash !== '' && activeEra != null,
    staleTime: 60_000,
    // No automatic retry. The dial already waits 12s before failing, so even
    // one retry is 24 seconds of skeleton before the user is told anything —
    // and the error state offers a Try again button, which is both faster and
    // honest about what is happening. Measured: with retries the page sat in a
    // loading state for over 22 seconds against an unreachable node.
    retry: false,
    queryFn: async () => {
      // Imported here, not at module scope: this is the boundary the whole
      // lazy-loading arrangement rests on.
      const [{ acquireApi }, { readStashPosition }] = await Promise.all([
        import('@/lib/chain/browser-api'),
        import('@/lib/chain/stash'),
      ]);

      const lease = await acquireApi(resolveRpcUrl(resolveNetwork()));
      try {
        return await readStashPosition(lease.api, stash, activeEra!);
      } finally {
        // Released in `finally` so a decoding failure cannot strand the socket.
        lease.release();
      }
    },
  });
}

/**
 * Where this stash's stake actually sits this era, and last.
 *
 * A second query rather than part of `useStashPosition`, because it depends on
 * that one's nominations and because it is the more expensive of the two — a
 * prefix read per nomination per era. Gating on `targets.length` keeps it from
 * running at all for an address that is bonded but not nominating.
 */
export function useStakeAllocation(
  stash: string,
  activeEra: number | undefined,
  targets: readonly string[],
): UseQueryResult<StakeAllocation> {
  return useQuery({
    // Targets are in the key: a nomination change alters the answer, and the
    // list is short enough to key on directly.
    queryKey: ['allocation', stash, activeEra, targets.join(',')],
    enabled: stash !== '' && activeEra != null && targets.length > 0,
    // Exposure is fixed for the duration of an era, so this is immutable until
    // the next election. A minute is simply the granularity of noticing.
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const [{ acquireApi }, { readStakeAllocation }] = await Promise.all([
        import('@/lib/chain/browser-api'),
        import('@/lib/chain/allocation'),
      ]);

      const lease = await acquireApi(resolveRpcUrl(resolveNetwork()));
      try {
        return await readStakeAllocation(lease.api, stash, activeEra!, targets);
      } finally {
        lease.release();
      }
    },
  });
}

export interface RewardHistory {
  events: RewardEvent[];
  /** True when the page cap was hit, so the total is a floor not a total. */
  truncated: boolean;
}

/**
 * Lifetime total and payout count, in one request.
 *
 * Split out from the detail walk deliberately. The endpoint caps a page at 100
 * rows — a server limit, not a setting — so an account with 11,858 payouts is
 * 119 sequential round trips, and every one of them was being spent just to
 * print a total the indexer will compute itself. This asks it to.
 *
 * Verified against a full walk on a real stash: identical count and sum, one
 * request instead of eighteen.
 */
export function useRewardTotals(stash: string): UseQueryResult<RewardTotals> {
  return useQuery({
    queryKey: ['reward-totals', stash],
    enabled: stash !== '',
    staleTime: 60 * 60_000,
    queryFn: ({ signal }) =>
      fetchRewardTotals(stash, { signal, endpoint: resolveIndexerUrl(resolveNetwork()) }),
  });
}

/**
 * Reward history from the indexer, event by event.
 *
 * No Polkadot dependency at all — this is plain `fetch` — so a pasted address
 * shows its payout history without any of the chain stack loading. In practice
 * that means the most useful half of this page works at almost no cost.
 *
 * **`enabled` is a real choice, not a formality.** This is the expensive query;
 * `useRewardTotals` answers the headline questions for one request, so the walk
 * only runs when a reader asks for the chart or the CSV. Passing an era index
 * fills in which era each payout was earned in — without it, that column is
 * blank, because the indexer records a block and not an era.
 */
export function useRewardHistory(
  stash: string,
  { enabled = true, eraIndex }: { enabled?: boolean; eraIndex?: EraIndex | undefined } = {},
): UseQueryResult<RewardHistory> {
  return useQuery({
    // The era index is part of the key: the same events resolve to different
    // era numbers once it loads, and a cached copy keyed only by stash would
    // keep serving the version with a blank era column.
    queryKey: ['rewards', stash, eraIndex == null ? 'no-eras' : eraIndex.lastEra],
    enabled: enabled && stash !== '',
    // Payouts land at most once an era; an hour is generous and the query can
    // be dozens of sequential requests for a long-lived account.
    staleTime: 60 * 60_000,
    // As above: a long history is many sequential requests, so retrying the
    // whole walk three times turns one slow failure into a very slow one.
    retry: 1,
    queryFn: ({ signal }) =>
      fetchRewards(stash, {
        signal,
        endpoint: resolveIndexerUrl(resolveNetwork()),
        ...(eraIndex
          ? { earnedEra: (block: number) => earnedEraForReward(eraIndex, block) }
          : {}),
      }),
  });
}
