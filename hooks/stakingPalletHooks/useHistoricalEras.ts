import type { Option, u32 } from '@polkadot/types';
import { ActiveEraInfo, EraIndex } from '@polkadot/types/interfaces';
import { useQuery, UseQueryOptions } from 'react-query';
import { useSdk } from '../useSdk';

/**
 * Hook to array of historical eras. Sorted from oldest to newest.
 * @param queryOptions
 * @returns
 */
export const useHistoricalEras = (
  queryOptions?:
    | Omit<
        UseQueryOptions<
          { historicWithCurrent: EraIndex[]; historicWithActive: EraIndex[]; historicWithoutActive: EraIndex[] },
          unknown,
          { historicWithCurrent: EraIndex[]; historicWithActive: EraIndex[]; historicWithoutActive: EraIndex[] },
          'ERAS_HISTORICAL'
        >,
        'queryKey' | 'queryFn'
      >
    | undefined
) => {
  const { api } = useSdk();
  return useQuery(
    'ERAS_HISTORICAL',

    async () => {
      // @ts-ignore
      const historicInfo: [Option<EraIndex>, Option<ActiveEraInfo>, u32] = await api.queryMulti([
        // @ts-ignore
        api.query.staking.currentEra,
        // @ts-ignore
        api.query.staking.activeEra,
        // @ts-ignore
        api.query.staking.historyDepth,
      ]);

      const historicWithCurrent: EraIndex[] = [];
      const historicWithActive: EraIndex[] = [];
      const historicWithoutActive: EraIndex[] = [];

      const currentEra = historicInfo[0].unwrapOrDefault();
      const activeEra = historicInfo[1].unwrapOrDefault().index.toNumber();
      const historyDepth = historicInfo[2].toNumber();
      let lastEra = currentEra.toNumber();

      while (lastEra >= 0 && historicWithCurrent.length < historyDepth + 1) {
        // @ts-ignore
        historicWithCurrent.push(api.registry.createType('EraIndex', lastEra));
        if (lastEra <= activeEra) {
          // @ts-ignore
          historicWithActive.push(api.registry.createType('EraIndex', lastEra));
        }
        if (lastEra < activeEra) {
          // @ts-ignore
          historicWithoutActive.push(api.registry.createType('EraIndex', lastEra));
        }
        lastEra -= 1;
      }
      // Reverse to go from oldest to newest.
      historicWithCurrent.reverse();
      historicWithActive.reverse();
      historicWithoutActive.reverse();

      return { historicWithCurrent, historicWithActive, historicWithoutActive };
    },
    queryOptions
  );
};
