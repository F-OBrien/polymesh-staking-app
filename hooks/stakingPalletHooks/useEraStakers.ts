import { AccountId, Balance, EraIndex, Exposure } from '@polkadot/types/interfaces';
import type { StorageKey, Compact, Option, u32 } from '@polkadot/types';
import type { SpStakingExposurePage } from '@polkadot/types/lookup';
import { useQuery, UseQueryOptions } from 'react-query/';
import { useSdk } from '../useSdk';
import { Polymesh } from '@polymeshassociation/polymesh-sdk';

export const useEraStakers = (
  era: EraIndex,
  queryOptions?:
    | Omit<
        UseQueryOptions<
          { era: EraIndex; operators: Record<string, Exposure>; nominators: Record<string, { operator: string; value: Compact<Balance> }[]> },
          unknown,
          { era: EraIndex; operators: Record<string, Exposure>; nominators: Record<string, { operator: string; value: Compact<Balance> }[]> },
          (string | EraIndex)[]
        >,
        'queryKey' | 'queryFn'
      >
    | undefined
) => {
  const { api } = useSdk();

  return useQuery(
    // Query Key
    ['ERA_STAKERS', era],
    // Query Function
    () => getEraStakersData(api, era),
    // Query Options
    queryOptions
  );
};

export const getEraStakersData = async (api: Polymesh['_polkadotApi'], era: EraIndex) => {
  const operators: Record<string, Exposure> = {};
  const nominators: Record<string, { operator: string; value: Compact<Balance> }[]> = {};

  // From Polymesh v8 exposures are stored as an overview plus one or more nominator pages. Eras
  // recorded before the upgrade only have clipped exposures, so fall back per era rather than
  // per chain.
  let exposure: [string, Exposure][] = [];
  if ('erasStakersPaged' in api.query.staking) {
    exposure = await getPagedExposures(api, era);
  }
  if (!exposure.length) {
    exposure = await getClippedExposures(api, era);
  }

  exposure.forEach(([operator, exposure]) => {
    operators[operator] = exposure;

    exposure.others.forEach(({ who, value }) => {
      const nominator = who.toString();
      nominators[nominator] = nominators[nominator] || [];

      nominators[nominator].push({ operator, value });
    });
  });

  return { era, operators, nominators };
};

// A single clipped exposure per operator, as used by Polymesh v6/v7 and by eras predating the v8 upgrade.
const getClippedExposures = async (api: Polymesh['_polkadotApi'], era: EraIndex): Promise<[string, Exposure][]> => {
  //@ts-ignore `erasStakersClipped` is absent from the v8 augmented types.
  const clipped: [StorageKey<[EraIndex, AccountId]>, Exposure][] = await api.query.staking.erasStakersClipped.entries(era);

  return clipped.map(([{ args }, exposure]) => [args[1].toString(), exposure]);
};

// Reconstructs an `Exposure` per operator from the paged storage introduced in Polymesh v8, where
// `erasStakersOverview` holds the totals and `erasStakersPaged` holds the nominators split across
// pages. Both are read with a partial (era only) key so this stays at two queries per era.
const getPagedExposures = async (api: Polymesh['_polkadotApi'], era: EraIndex): Promise<[string, Exposure][]> => {
  const [overviews, pages] = await Promise.all([
    api.query.staking.erasStakersOverview.entries(era),
    // @ts-ignore the augmented types require the full (era, operator, page) key.
    api.query.staking.erasStakersPaged.entries(era) as Promise<[StorageKey<[EraIndex, AccountId, u32]>, Option<SpStakingExposurePage>][]>,
  ]);

  // Collate the nominators of every page by operator.
  const othersByOperator: Record<string, { who: AccountId; value: Compact<Balance> }[]> = {};
  pages.forEach(([{ args }, page]) => {
    if (page.isNone) return;
    const operator = args[1].toString();
    const others = page.unwrap().others.toArray() as unknown as { who: AccountId; value: Compact<Balance> }[];

    othersByOperator[operator] = (othersByOperator[operator] || []).concat(others);
  });

  const exposures: [string, Exposure][] = [];
  overviews.forEach(([{ args }, overview]) => {
    if (overview.isNone) return;
    const operator = args[1].toString();
    const { total, own } = overview.unwrap();

    // Shaped to match the `Exposure` consumers expect: `total` and `own` are already `Compact`
    // balances and each page entry is `{ who, value }`, so no re-encoding is required.
    exposures.push([operator, { total, own, others: othersByOperator[operator] || [] } as unknown as Exposure]);
  });

  return exposures;
};
