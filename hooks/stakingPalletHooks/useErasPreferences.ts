import { EraIndex, ValidatorPrefs } from '@polkadot/types/interfaces';
import { useQuery, UseQueryOptions } from 'react-query/';
import { Polymesh } from '@polymeshassociation/polymesh-sdk';
import { useSdk } from '../useSdk';
import { getEraPreferences } from './useEraPreferences';
import { useStakingContext } from '../useStakingContext';

export const useErasPreferences = (
  queryOptions?: UseQueryOptions<
    { era: EraIndex; operators: Record<string, ValidatorPrefs> }[],
    unknown,
    { era: EraIndex; operators: Record<string, ValidatorPrefs> }[],
    [string]
  >
) => {
  const { api } = useSdk();
  const { eraInfo } = useStakingContext();

  return useQuery(
    // Query Key
    ['ERAS_PREFERENCES'],
    // Query Function
    () => getErasPreferences(api, eraInfo.historicWithCurrent!),
    // Query Options
    queryOptions
  );
};

export const getErasPreferences = async (api: Polymesh['_polkadotApi'], eras: EraIndex[]) => {
  const results = await Promise.all(eras.map(async (era) => getEraPreferences(api, era)));

  return results;
};
