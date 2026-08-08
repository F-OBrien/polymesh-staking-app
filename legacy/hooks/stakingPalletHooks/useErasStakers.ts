import { Balance, EraIndex, Exposure } from '@polkadot/types/interfaces';
import type { Compact } from '@polkadot/types';
import { useQuery, UseQueryOptions } from 'react-query/';
import { useSdk } from '../useSdk';
import { Polymesh } from '@polymeshassociation/polymesh-sdk';
import { getEraStakersData } from './useEraStakers';
import { useStakingContext } from '../useStakingContext';

export const useErasStakers = (
  queryOptions?:
    | Omit<
        UseQueryOptions<
          { era: EraIndex; operators: Record<string, Exposure>; nominators: Record<string, { operator: string; value: Compact<Balance> }[]> }[],
          unknown,
          { era: EraIndex; operators: Record<string, Exposure>; nominators: Record<string, { operator: string; value: Compact<Balance> }[]> }[],
          string[]
        >,
        'queryKey' | 'queryFn'
      >
    | undefined
) => {
  const { api } = useSdk();
  const { eraInfo } = useStakingContext();

  return useQuery(
    // Query Key
    ['ERAS_STAKERS'],
    // Query Function
    () => getErasStakersData(api, eraInfo.historicWithCurrent!),
    // Query options
    queryOptions
  );
};

export const getErasStakersData = async (api: Polymesh['_polkadotApi'], eras: EraIndex[]) => {
  const results = await Promise.all(eras.map(async (era) => await getEraStakersData(api, era)));

  return results;
};
