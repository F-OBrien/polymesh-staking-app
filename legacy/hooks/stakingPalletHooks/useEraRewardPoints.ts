import { EraIndex, RewardPoint } from '@polkadot/types/interfaces';
import { useQuery, UseQueryOptions } from 'react-query/';
import { useSdk } from '../useSdk';
import { Polymesh } from '@polymeshassociation/polymesh-sdk';

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

export const getEraRewardPoints = async (api: Polymesh['_polkadotApi'], era: EraIndex) => {
  const operators: Record<string, RewardPoint> = {};
  const queryResults = await api.query.staking.erasRewardPoints(era);
  const total = queryResults.total;
  // @ts-ignore
  queryResults.individual.forEach((points, operator) => {
    operators[operator.toString()] = points;
  });
  return { era, total, operators };
};
