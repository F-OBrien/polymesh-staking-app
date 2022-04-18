import { AccountId, Balance, EraIndex, Exposure } from '@polkadot/types/interfaces';
import type { StorageKey, Compact } from '@polkadot/types';
import { useQuery, UseQueryOptions } from 'react-query/';
import { useSdk } from '../useSdk';
import { useHistoricalEras } from './useHistoricalEras';

export const useErasStakers = (
  // historicalEras: EraIndex[],
  queryOptions?: UseQueryOptions<
    { era: EraIndex; operators: Record<string, Exposure>; nominators: Record<string, { operator: string; value: Compact<Balance> }[]> }[],
    unknown,
    { era: EraIndex; operators: Record<string, Exposure>; nominators: Record<string, { operator: string; value: Compact<Balance> }[]> }[],
    [string]
  >
) => {
  const { api } = useSdk();
  const { data: historicalEras, isFetching } = useHistoricalEras();

  // If no `queryOptions` were passed, create one for enabling after historicalEras have been fetched.
  if (!queryOptions) {
    queryOptions = { enabled: !!historicalEras && !isFetching };
  }
  // Else if `queryOptions` were passed either without the `enabled` object or with it as `true` disable until historicalEras have been fetched.
  else if (queryOptions.enabled === (undefined || true)) {
    queryOptions.enabled = !!historicalEras && !isFetching;
  }
  // Else enable reains false.

  return useQuery(
    ['ERAS_STAKERS'],
    async () => {
      const results: {
        era: EraIndex;
        operators: Record<string, Exposure>;
        nominators: Record<string, { operator: string; value: Compact<Balance> }[]>;
      }[] = [];

      await Promise.all(
        historicalEras!.historicWithCurrent.map(async (era) => {
          const exposure: [StorageKey<[EraIndex, AccountId]>, Exposure][] = await api?.query.staking.erasStakersClipped.entries(era);

          const operators: Record<string, Exposure> = {};
          const nominators: Record<string, { operator: string; value: Compact<Balance> }[]> = {};
          exposure.forEach(([{ args }, exposure]) => {
            const operator = args[1].toString();
            operators[operator] = exposure;

            exposure.others.forEach(({ who, value }) => {
              const nominator = who.toString();
              nominators[nominator] = nominators[nominator] || [];
              nominators[nominator].push({ operator, value });
            });
          });
          results.push({ era, operators, nominators });
        })
      );

      // const testAtHash: [StorageKey<[EraIndex, AccountId]>, Exposure][] = await api?.query.staking.erasStakersClipped.entriesAt(
      //   '0x2f88be0c96e8cc84ad5387609a6042c6f30d90684fb7f8ba0c6907cfa9b9d110',
      //   82
      // );
      // testAtHash.forEach(
      //   ([
      //     {
      //       args: [era, operatorId],
      //     },
      //     exposure,
      //   ]) => {
      //     console.log(era.toNumber());
      //   }
      // );

      return results;
    },
    queryOptions
  );
};

/*
    return useQuery<
    { era: EraIndex; operators: Record<string, Exposure>; nominators: Record<string, { operator: string; value: Compact<Balance> }[]> }[],
    unknown,
    { era: EraIndex; operators: Record<string, Exposure>; nominators: Record<string, { operator: string; value: Compact<Balance> }[]> }[],
    [string, EraIndex[], any]
  >(['ERAS_STAKERS', historicalEras, api.query.staking.erasStakersClipped], getEraStakers, queryOptions);
};

const getEraStakers = async ({ queryKey: [_, historicalEras, erasStakersClipped] }: { queryKey: [string, EraIndex[], any] }) => {
  // const [_, historicalEras, api] = queryKey;
  const results: {
    era: EraIndex;
    operators: Record<string, Exposure>;
    nominators: Record<string, { operator: string; value: Compact<Balance> }[]>;
  }[] = [];

  await Promise.all(
    historicalEras.map(async (era) => {
      const exposure: [StorageKey<[EraIndex, AccountId]>, Exposure][] = await erasStakersClipped.entries(era);

      const operators: Record<string, Exposure> = {};
      const nominators: Record<string, { operator: string; value: Compact<Balance> }[]> = {};
      exposure.forEach(([{ args }, exposure]) => {
        const operator = args[1].toString();
        operators[operator] = exposure;

        exposure.others.forEach(({ who, value }) => {
          const nominator = who.toString();
          nominators[nominator] = nominators[nominator] || [];
          nominators[nominator].push({ operator, value });
        });
      });
      results.push({ era, operators, nominators });

      // console.log(index.toNumber());
    })
  );

  return results;
};
 */
