import { BalanceOf, EraIndex } from '@polkadot/types/interfaces';
import { useQuery, UseQueryOptions } from 'react-query/';
import { useSdk } from '../useSdk';

export const useEraTotalStaked = (era: EraIndex, queryOptions?: UseQueryOptions<BalanceOf, unknown, BalanceOf, (string | EraIndex)[]>) => {
  const { api } = useSdk();

  return useQuery(
    ['ERA_TOTAL_STAKED', era],

    async () => {
      return await api?.query.staking.erasTotalStake(era);
    },
    queryOptions
  );
};
