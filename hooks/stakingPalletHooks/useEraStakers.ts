import { AccountId, Balance, EraIndex, Exposure } from '@polkadot/types/interfaces';
import type { StorageKey, Compact } from '@polkadot/types';
import { useQuery, UseQueryOptions } from 'react-query/';
import { useSdk } from '../useSdk';

export const useEraStakers = (
  era: EraIndex,
  // historicalEras: EraIndex[],
  queryOptions?: UseQueryOptions<
    { era: EraIndex; operators: Record<string, Exposure>; nominators: Record<string, { operator: string; value: Compact<Balance> }[]> },
    unknown,
    { era: EraIndex; operators: Record<string, Exposure>; nominators: Record<string, { operator: string; value: Compact<Balance> }[]> },
    (string | EraIndex)[]
  >
) => {
  const { api } = useSdk();

  return useQuery(
    ['ERA_STAKERS', era],

    async () => {
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

      const result = { era, operators, nominators };

      return result;
    },
    queryOptions
  );
};