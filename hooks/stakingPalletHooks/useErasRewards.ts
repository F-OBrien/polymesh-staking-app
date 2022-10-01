import { Polymesh } from '@polymeshassociation/polymesh-sdk';
import { EraIndex, BalanceOf } from '@polkadot/types/interfaces';
import { Option } from '@polkadot/types';
import { useQuery, UseQueryOptions } from 'react-query/';
import { useSdk } from '../useSdk';
import { useStakingContext } from '../useStakingContext';

export const useErasRewards = (
  queryOptions?:
    | Omit<UseQueryOptions<{ era: EraIndex; reward: BalanceOf }[], unknown, { era: EraIndex; reward: BalanceOf }[], string[]>, 'queryKey' | 'queryFn'>
    | undefined
) => {
  const { api } = useSdk();
  const { eraInfo } = useStakingContext();

  return useQuery(
    // Query Key
    ['ERAS_REWARDS'],
    // Query Function
    () => getErasReward(api, eraInfo.historicWithoutActive!),
    // Query options
    queryOptions
  );
};

export const getErasReward = async (api: Polymesh['_polkadotApi'], eras: EraIndex[]) => {
  // const results = await Promise.all(eras.map(async (era) => await getEraReward(api, era)));
  // @ts-ignore
  const rewards: Option<BalanceOf>[] = await api.query.staking.erasValidatorReward.multi(eras);
  const result = rewards.map((reward, index) => {
    return { era: eras[index], reward: reward.unwrapOrDefault() };
  });
  return result;
};
