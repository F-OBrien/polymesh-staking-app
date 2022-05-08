import { Balance, EraIndex, Exposure } from '@polkadot/types/interfaces';
import type { Compact } from '@polkadot/types';
import { useQueries, UseQueryOptions } from 'react-query/';
import { useSdk } from '../useSdk';
import { useHistoricalEras } from './useHistoricalEras';
import { getEraStakersData } from './useEraStakers';

export const useErasStakers = (
  queryOptions?: UseQueryOptions<
    { era: EraIndex; operators: Record<string, Exposure>; nominators: Record<string, { operator: string; value: Compact<Balance> }[]> },
    unknown,
    { era: EraIndex; operators: Record<string, Exposure>; nominators: Record<string, { operator: string; value: Compact<Balance> }[]> },
    (string | EraIndex)[]
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
  // Else enable remains false.
  return useQueries(
    historicalEras?.historicWithCurrent.map((era) => {
      return {
        // Query Key
        queryKey: ['ERA_STAKERS', era],
        // Query Function
        queryFn: () => getEraStakersData(api, era),
        // Query options
        ...queryOptions,
      };
    }) ?? [] //If `historicalEras` are not yet populated return empty query array.
  );
};
