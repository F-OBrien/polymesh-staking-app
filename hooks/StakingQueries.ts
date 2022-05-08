import { DeriveEraExposure, DeriveEraPoints, DeriveEraRewards, DeriveEraPrefs } from '@polkadot/api-derive/types';
import type BN from 'bn.js';
import { useQuery, UseQueryOptions } from 'react-query';
import { useSdk } from './useSdk';

export const useErasExposure = (
  queryOptions?:
    | Omit<UseQueryOptions<DeriveEraExposure[] | undefined, unknown, DeriveEraExposure[] | undefined, 'ERAS_EXPOSURE'>, 'queryKey' | 'queryFn'>
    | undefined
) => {
  const { api } = useSdk();
  return useQuery(
    'ERAS_EXPOSURE',
    async () => {
      const erasExposure = await api?.derive.staking.erasExposure();
      // console.log('test', erasExposure);
      return erasExposure;
    },
    queryOptions
  );
};

export const useErasPoints = (
  queryOptions?: Omit<UseQueryOptions<DeriveEraPoints[] | undefined, unknown, DeriveEraPoints[] | undefined>, 'queryKey' | 'queryFn'> | undefined
) => {
  const { api } = useSdk();
  return useQuery(
    'ERAS_POINTS',
    async () => {
      return await api?.derive.staking.erasPoints();
    },
    queryOptions
  );
};

export const useErasRewards = (
  queryOptions?:
    | Omit<UseQueryOptions<DeriveEraRewards[] | undefined, unknown, DeriveEraRewards[] | undefined, 'ERAS_REWARDS'>, 'queryKey' | 'queryFn'>
    | undefined
) => {
  const { api } = useSdk();
  return useQuery(
    'ERAS_REWARDS',
    async () => {
      return await api?.derive.staking.erasRewards();
    },
    queryOptions
  );
};

export const useErasTotalStake = (
  queryOptions?:
    | Omit<UseQueryOptions<{ era: number; total: BN }[], unknown, { era: number; total: BN }[], 'ERAS_TOTAL_STAKE'>, 'queryKey' | 'queryFn'>
    | undefined
) => {
  const { api } = useSdk();
  return useQuery(
    'ERAS_TOTAL_STAKE',
    async () => {
      let allTotals: { era: number; total: BN }[] = [];
      const totals = await api?.query.staking.erasTotalStake.entries();
      totals?.forEach(
        ([
          {
            args: [eraIndex],
          },
          totalStaked,
        ]) => {
          allTotals = [{ era: eraIndex.toNumber(), total: totalStaked.toBn() }, ...allTotals];
        }
      );
      allTotals.sort(function (a, b) {
        return a.era - b.era;
      });
      return allTotals;
    },
    queryOptions
  );
};
