/* eslint-disable @typescript-eslint/no-explicit-any -- loosely-typed storage, as in compat.ts */

import { acquireApi, type ApiLease } from './browser-api';

/**
 * Tier-4 live subscriptions (design doc §6.6a).
 *
 * Off by default and explicitly opt-in. The page renders completely from tiers
 * 1–3 first; this only ever *upgrades* values in place. Nothing here may gate
 * first paint, which is why every field on `LiveState` is nullable — a consumer
 * that has not received an update yet keeps showing the snapshot.
 *
 * The subscription set is narrow and copied from the Polymesh Portal's, which
 * encodes real knowledge of what actually changes. Subscribing to everything
 * would work and would also stream a great deal of traffic to redraw numbers
 * nobody is watching.
 */

export interface LiveState {
  activeEra: number | null;
  currentEra: number | null;
  sessionIndex: number | null;
  epochIndex: number | null;
  /** Slot-exact era progress replaces the clock-interpolated tier-3 estimate. */
  currentSlot: string | null;
  electionPhase: 'Off' | 'Signed' | 'Unsigned' | 'Emergency' | null;
  /** Points accruing in the era now in progress, by operator address. */
  eraPoints: { total: number; byOperator: Record<string, number> } | null;
  /** Present only when a stash is being watched. */
  nominations: string[] | null;
  /** Rises when a staking event lands, so consumers can invalidate. */
  eventEpoch: number;
}

export const EMPTY_LIVE_STATE: LiveState = {
  activeEra: null,
  currentEra: null,
  sessionIndex: null,
  epochIndex: null,
  currentSlot: null,
  electionPhase: null,
  eraPoints: null,
  nominations: null,
  eventEpoch: 0,
};

/**
 * Staking events worth reacting to.
 *
 * Note `Nominated` and `InvalidatedNominators` are on the `validators` pallet,
 * not `staking` — nomination moved there in v8. Watching the wrong pallet is
 * silent: no error, just a page that never notices a nomination change.
 */
const WATCHED_EVENTS: Readonly<Record<string, readonly string[]>> = {
  staking: ['Bonded', 'Unbonded', 'Withdrawn', 'Slashed', 'StakersElected', 'Rewarded'],
  validators: ['Nominated', 'InvalidatedNominators'],
  offences: ['Offence'],
  imOnline: ['SomeOffline'],
};

export function isWatchedEvent(section: string, method: string): boolean {
  return WATCHED_EVENTS[section]?.includes(method) ?? false;
}

export interface LiveOptions {
  endpoint: string;
  /** Watch this stash's nominations too. Omit when no wallet is connected. */
  stash?: string | undefined;
  onChange: (patch: Partial<LiveState>) => void;
  onError?: ((error: Error) => void) | undefined;
}

export interface LiveSession {
  /** Idempotent. Unsubscribes everything and releases the shared connection. */
  stop: () => Promise<void>;
}

type Unsub = () => void;

/**
 * Opens the subscription set and returns a handle that tears all of it down.
 *
 * Every `unsub` is collected as it is created, not at the end, so a failure
 * part-way through still leaves the earlier subscriptions closeable — the
 * alternative leaks sockets exactly when something is already going wrong.
 *
 * `stop()` is the acceptance criterion for this phase: after it resolves there
 * must be no open subscription and no lease on the shared connection.
 */
export async function startLive({
  endpoint,
  stash,
  onChange,
  onError,
}: LiveOptions): Promise<LiveSession> {
  let lease: ApiLease | null = null;
  const unsubs: Unsub[] = [];
  let stopped = false;

  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    for (const unsub of unsubs.splice(0)) {
      try {
        unsub();
      } catch {
        // A subscription that already died cannot be unsubscribed twice, and
        // one failure must not prevent the rest from being cleaned up.
      }
    }
    lease?.release();
    lease = null;
  };

  try {
    lease = await acquireApi(endpoint);
    const { api } = lease;

    // The caller may have toggled Live off while the socket was still opening.
    // Without this the subscriptions below would attach to a connection nobody
    // is holding and never be closed.
    if (stopped) {
      lease.release();
      lease = null;
      return { stop };
    }

    const track = async (subscribe: () => Promise<Unsub>) => {
      const unsub = await subscribe();
      if (stopped) {
        unsub();
        return;
      }
      unsubs.push(unsub);
    };

    await Promise.all([
      track(() =>
        api.query.staking.activeEra((value: any) => {
          const index = value?.isSome ? Number(value.unwrap().index.toString()) : null;
          onChange({ activeEra: index });
        }),
      ),
      track(() =>
        api.query.staking.currentEra((value: any) => {
          onChange({ currentEra: value?.isSome ? Number(value.unwrap().toString()) : null });
        }),
      ),
      track(() =>
        api.query.session.currentIndex((value: any) => {
          onChange({ sessionIndex: Number(value?.toString() ?? '0') });
        }),
      ),
      track(() =>
        api.query.babe.epochIndex((value: any) => {
          onChange({ epochIndex: Number(value?.toString() ?? '0') });
        }),
      ),
      track(() =>
        // A string, not a number: slots exceed Number.MAX_SAFE_INTEGER in
        // principle, and the arithmetic that uses them is done in bigint.
        api.query.babe.currentSlot((value: any) => {
          onChange({ currentSlot: value?.toString() ?? null });
        }),
      ),
      track(() =>
        api.query.electionProviderMultiPhase.currentPhase((value: any) => {
          onChange({ electionPhase: readPhase(value) });
        }),
      ),
      track(() =>
        api.query.system.events((records: any) => {
          // A single epoch bump per block, however many matching events it
          // carried — one invalidation, not six.
          for (const record of records ?? []) {
            const section = String(record?.event?.section ?? '');
            const method = String(record?.event?.method ?? '');
            if (isWatchedEvent(section, method)) {
              onChange({ eventEpoch: Date.now() });
              return;
            }
          }
        }),
      ),
    ]);

    // Era points are keyed by the era in progress, so this subscription is
    // established after the first `activeEra` value rather than guessed.
    const activeEraOption = await api.query.staking.activeEra();
    const activeEraIndex = activeEraOption?.isSome
      ? Number(activeEraOption.unwrap().index.toString())
      : null;

    if (activeEraIndex != null) {
      await track(() =>
        api.query.staking.erasRewardPoints(activeEraIndex, (points: any) => {
          onChange({ eraPoints: readPoints(points) });
        }),
      );
    }

    if (stash != null && stash !== '') {
      await track(() =>
        api.query.staking.nominators(stash, (value: any) => {
          onChange({
            nominations: value?.isSome
              ? [...value.unwrap().targets].map((t: unknown) => String(t))
              : [],
          });
        }),
      );
    }

    return { stop };
  } catch (error) {
    await stop();
    onError?.(error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

function readPhase(value: any): LiveState['electionPhase'] {
  try {
    if (value?.isSigned) return 'Signed';
    if (value?.isUnsigned) return 'Unsigned';
    if (value?.isEmergency) return 'Emergency';
    return 'Off';
  } catch {
    return null;
  }
}

function readPoints(points: any): LiveState['eraPoints'] {
  try {
    const byOperator: Record<string, number> = {};
    points?.individual?.forEach((value: unknown, operator: unknown) => {
      byOperator[String(operator)] = Number(value?.toString() ?? '0');
    });
    return { total: Number(points?.total?.toString() ?? '0'), byOperator };
  } catch {
    return null;
  }
}
