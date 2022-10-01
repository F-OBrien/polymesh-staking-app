import { AccountId, EraIndex, ValidatorPrefs } from '@polkadot/types/interfaces';
import type { StorageKey } from '@polkadot/types';
import { useQuery, UseQueryOptions } from 'react-query/';
import { useSdk } from '../useSdk';
import { Polymesh } from '@polymeshassociation/polymesh-sdk';

export const useEraPreferences = (
  era: EraIndex,
  queryOptions?: UseQueryOptions<
    { era: EraIndex; operators: Record<string, ValidatorPrefs> },
    unknown,
    { era: EraIndex; operators: Record<string, ValidatorPrefs> },
    (string | EraIndex)[]
  >
) => {
  const { api } = useSdk();

  return useQuery(
    // Query Key
    ['ERA_PREFERENCES', era],
    // Query Function
    () => getEraPreferences(api, era),
    // Query Options
    queryOptions
  );
};

export const getEraPreferences = async (api: Polymesh['_polkadotApi'], era: EraIndex) => {
  // @ts-ignore
  const preferences: [StorageKey<[EraIndex, AccountId]>, ValidatorPrefs][] = await api.query.staking.erasValidatorPrefs.entries(era);

  const operators: Record<string, ValidatorPrefs> = {};

  preferences.forEach(([{ args }, prefs]) => {
    const operator = args[1].toString();
    operators[operator] = prefs;
  });
  return { era, operators };
};
