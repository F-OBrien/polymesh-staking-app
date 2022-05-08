import { EraIndex, BalanceOf } from '@polkadot/types/interfaces';
import { useQueries, UseQueryOptions } from 'react-query/';
import { useSdk } from '../useSdk';
import { getEraReward } from './useEraReward';
import { useHistoricalEras } from './useHistoricalEras';

export const useErasReward = (
  queryOptions?:
    | Omit<
        UseQueryOptions<{ era: EraIndex; reward: BalanceOf }, unknown, { era: EraIndex; reward: BalanceOf }, (string | EraIndex)[]>,
        'queryKey' | 'queryFn'
      >
    | undefined
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
    historicalEras?.historicWithoutActive.map((era) => {
      return {
        // Query Key
        queryKey: ['ERA_REWARD', era],
        // Query Function
        queryFn: () => getEraReward(api, era),
        // Query options
        ...queryOptions,
      };
    }) ?? [] //If `historicalEras` are not yet populated return empty query array.
  );
};
