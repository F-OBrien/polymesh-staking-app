import { EraIndex, BalanceOf } from '@polkadot/types/interfaces';
import { useQuery, UseQueryOptions } from 'react-query/';
import { useSdk } from '../useSdk';
import { Polymesh } from '@polymeshassociation/polymesh-sdk';

export const useEraRewards = (
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
    // @ts-ignore
    queryOptions
  );
};

export const getEraReward = async (api: Polymesh['_polkadotApi'], era: EraIndex) => {
  const queryResults = await api.query.staking.erasValidatorReward(era);
  const reward = queryResults.unwrapOrDefault();
  return { era, reward };
};
