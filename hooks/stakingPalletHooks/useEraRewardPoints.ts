import { EraIndex, RewardPoint } from '@polkadot/types/interfaces';
import { useQuery, UseQueryOptions } from 'react-query/';
import { useSdk } from '../useSdk';
import { ApiPromise } from '@polkadot/api';

export const useEraRewardPoints = (
  era: EraIndex,
  queryOptions?:
    | Omit<
        UseQueryOptions<
          { era: EraIndex; total: RewardPoint; operators: Record<string, RewardPoint> },
          unknown,
          { era: EraIndex; total: RewardPoint; operators: Record<string, RewardPoint> },
          (string | EraIndex)[]
        >,
        'queryKey' | 'queryFn'
      >
    | undefined
) => {
  const { api } = useSdk();

  return useQuery(
    // Query Key
    ['ERA_POINTS', era],
    // Query Function
    () => getEraRewardPoints(api, era),
    // Query Options
    queryOptions
  );
};

export const getEraRewardPoints = async (api: ApiPromise, era: EraIndex) => {
  const operators: Record<string, RewardPoint> = {};
  const queryResults = await api.query.staking.erasRewardPoints(era);
  const total = queryResults.total;
  queryResults.individual.forEach((points, operator) => {
    operators[operator.toString()] = points;
  });
  return { era, total, operators };
};
