import { ApiPromise } from '@polkadot/api';
import { EraIndex, RewardPoint, EraRewardPoints } from '@polkadot/types/interfaces';
import { useQuery, UseQueryOptions } from 'react-query/';
import { useSdk } from '../useSdk';
import { useStakingContext } from '../useStakingContext';

export const useErasRewardPoints = (
  queryOptions?:
    | Omit<
        UseQueryOptions<
          { era: EraIndex; total: RewardPoint; operators: Record<string, RewardPoint> }[],
          unknown,
          { era: EraIndex; total: RewardPoint; operators: Record<string, RewardPoint> }[],
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
    ['ERAS_POINTS'],
    // Query Function
    () => getErasRewardPoints(api, eraInfo.historicWithoutActive!),
    // Query options
    queryOptions
  );
};

export const getErasRewardPoints = async (api: ApiPromise, eras: EraIndex[]) => {
  const queryResults: EraRewardPoints[] = await api.query.staking.erasRewardPoints.multi(eras);

  return queryResults.map(({ total, individual }, index) => {
    const operators: Record<string, RewardPoint> = {};

    individual.forEach((points, operator) => {
      operators[operator.toString()] = points;
    });

    return { era: eras[index], total, operators };
  });
};
