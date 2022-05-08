import { AccountId, Balance, EraIndex, Exposure } from '@polkadot/types/interfaces';
import type { StorageKey, Compact } from '@polkadot/types';
import { useQuery, UseQueryOptions } from 'react-query/';
import { useSdk } from '../useSdk';
import { ApiPromise } from '@polkadot/api';

export const useEraStakers = (
  era: EraIndex,
  queryOptions?: UseQueryOptions<
    { era: EraIndex; operators: Record<string, Exposure>; nominators: Record<string, { operator: string; value: Compact<Balance> }[]> },
    unknown,
    { era: EraIndex; operators: Record<string, Exposure>; nominators: Record<string, { operator: string; value: Compact<Balance> }[]> },
    (string | EraIndex)[]
  >
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

export const getEraStakersData = async (api: ApiPromise, era: EraIndex) => {
  const operators: Record<string, Exposure> = {};
  const nominators: Record<string, { operator: string; value: Compact<Balance> }[]> = {};

  const exposure: [StorageKey<[EraIndex, AccountId]>, Exposure][] = await api?.query.staking.erasStakersClipped.entries(era);

  exposure.forEach(([{ args }, exposure]) => {
    const operator = args[1].toString();
    operators[operator] = exposure;

    exposure.others.forEach(({ who, value }) => {
      const nominator = who.toString();
      nominators[nominator] = nominators[nominator] || [];

      nominators[nominator].push({ operator, value });
    });
  });

  return { era, operators, nominators };
};
