import { EraIndex, BalanceOf } from '@polkadot/types/interfaces';
import { useQuery, UseQueryOptions } from 'react-query/';
import { useSdk } from '../useSdk';
import { ApiPromise } from '@polkadot/api';

export const useEraReward = (
  era: EraIndex,
  queryOptions?:
    | Omit<
        UseQueryOptions<{ era: EraIndex; reward: BalanceOf }, unknown, { era: EraIndex; reward: BalanceOf }, (string | EraIndex)[]>,
        'queryKey' | 'queryFn'
      >
    | undefined
) => {
  const { api } = useSdk();

  return useQuery(
    // Query Key
    ['ERA_REWARD', era],
    // Query Function
    () => getEraReward(api, era),
    // Query Options
    queryOptions
  );
};

export const getEraReward = async (api: ApiPromise, era: EraIndex) => {
  const queryResults = await api?.query.staking.erasValidatorReward(era);
  const reward = queryResults.unwrapOrDefault();
  return { era, reward };
};
