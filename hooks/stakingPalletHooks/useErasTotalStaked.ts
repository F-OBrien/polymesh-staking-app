import { EraIndex, BalanceOf } from '@polkadot/types/interfaces';
import { useQuery, UseQueryOptions } from 'react-query/';
import { useSdk } from '../useSdk';
import { ApiPromise } from '@polkadot/api';
import { useStakingContext } from '../useStakingContext';

export const useErasTotalStaked = (
  queryOptions?:
    | Omit<UseQueryOptions<{ era: EraIndex; total: BalanceOf }[], unknown, { era: EraIndex; total: BalanceOf }[], string[]>, 'queryKey' | 'queryFn'>
    | undefined
) => {
  const { api } = useSdk();
  const { eraInfo } = useStakingContext();

  return useQuery(
    // Query Key
    ['ERAS_TOTAL_STAKE'],
    // Query Function
    () => getErasTotals(api, eraInfo.historicWithCurrent),
    // Query options
    queryOptions
  );
};

export const getErasTotals = async (api: ApiPromise, eras: EraIndex[]) => {
  const totals: BalanceOf[] = await api.query.staking.erasTotalStake.multi(eras);
  const result = totals.map((total, index) => {
    return { era: eras[index], total: total };
  });
  return result;
};
