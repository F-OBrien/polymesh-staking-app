import { ApiPromise } from '@polkadot/api';
import { useMemo } from 'react';

export interface ChainProperties {
  symbol?: string;
  decimals?: number;
  divisor?: number;
  ss58Format?: number;
}

export function useChainProperties(api: ApiPromise | undefined) {
  const chainProperties = useMemo((): ChainProperties => {
    if (!api?.registry) return {};

    // Set defaults in case an option "isNone".
    let symbol: string = '';
    let decimals: number = 0;
    let divisor: number = 1;
    let ss58Format: number = 42; //default substrate ss58 Format.

    // Get chain information.
    const chainInfo = api?.registry.getChainProperties();

    // Type is Option<Vec<Text>>, so we check if the value actually exists.
    // and log only the first value.
    if (chainInfo?.tokenSymbol.isSome) {
      symbol = chainInfo.tokenSymbol.unwrap()[0].toString();
    }
    // Type is Option<Vec<u32>>, so we check if the value actually exists.
    // and log only the first value.
    if (chainInfo?.tokenDecimals.isSome) {
      decimals = chainInfo.tokenDecimals.unwrap()[0].toNumber();
      divisor = 10 ** decimals;
    }
    // Type is Option<u32>, so we check if the value actually exists.
    if (chainInfo?.ss58Format.isSome) {
      ss58Format = chainInfo.ss58Format.unwrap().toNumber();
    }

    console.log({ symbol, decimals, divisor, ss58Format });
    return { symbol, decimals, divisor, ss58Format };
  }, [api?.registry]);
  return chainProperties;
}
