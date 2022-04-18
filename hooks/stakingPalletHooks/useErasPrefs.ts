import { AccountId, EraIndex, ValidatorPrefs } from '@polkadot/types/interfaces';
import type { StorageKey } from '@polkadot/types';
import { useQuery, UseQueryOptions } from 'react-query/';
import { useSdk } from '../useSdk';
import { useHistoricalEras } from './useHistoricalEras';

export const useErasPrefs = (
  // historicalEras: EraIndex[],
  queryOptions?: UseQueryOptions<
    { era: EraIndex; operators: Record<string, ValidatorPrefs> }[],
    unknown,
    { era: EraIndex; operators: Record<string, ValidatorPrefs> }[],
    [string]
  >
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
  // Else enable reains false.

  return useQuery(
    ['ERAS_PREFS'],
    async () => {
      const results: {
        era: EraIndex;
        operators: Record<string, ValidatorPrefs>;
      }[] = [];

      await Promise.all(
        historicalEras!.historicWithCurrent.map(async (era) => {
          const preferences: [StorageKey<[EraIndex, AccountId]>, ValidatorPrefs][] = await api?.query.staking.erasValidatorPrefs.entries(era);

          const operators: Record<string, ValidatorPrefs> = {};
          preferences.forEach(([{ args }, prefs]) => {
            const operator = args[1].toString();
            operators[operator] = prefs;
          });
          results.push({ era, operators });
        })
      );
      return results;
    },
    queryOptions
  );
};
