import { EraIndex, ValidatorPrefs } from '@polkadot/types/interfaces';
import { useQueries, UseQueryOptions } from 'react-query/';
import { useSdk } from '../useSdk';
import { useHistoricalEras } from './useHistoricalEras';
import { getEraPreferences } from './useEraPrefrences';

export const useErasPreferences = (
  queryOptions?: UseQueryOptions<
    { era: EraIndex; operators: Record<string, ValidatorPrefs> },
    unknown,
    { era: EraIndex; operators: Record<string, ValidatorPrefs> },
    (string | EraIndex)[]
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
  // Else enable remains false.
  return useQueries(
    historicalEras?.historicWithCurrent.map((era) => {
      return {
        // Query Key
        queryKey: ['ERA_PREFERENCES', era],
        // Query Function
        queryFn: () => getEraPreferences(api, era),
        // Query options
        ...queryOptions,
      };
    }) ?? [] //If `historicalEras` are not yet populated return empty query array.
  );
};
