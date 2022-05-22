import { useSdk } from '../hooks/useSdk';
import { createContext, useEffect, useState, useRef } from 'react';
import Spinner from '../components/Spinner';
import { StakingContextProps, EraInfo } from '../types/types';
import { EraIndex } from '@polkadot/types/interfaces';

export const StakingContext = createContext({} as unknown as StakingContextProps);
export const StakingContextProvider = StakingContext.Provider;
export const StakingContextConsumer = StakingContext.Consumer;

interface Props {
  children: React.ReactNode;
}

function StakingContextAppWrapper({ children }: Props): React.ReactElement<Props> | null {
  const { api, encodedSelectedAddress } = useSdk();
  const [operatorsToHighlight, setOperatorsToHighlight] = useState<string[]>([]);
  const [activeEra, setActiveEra] = useState<EraIndex>();
  const [currentEra, setCurrentEra] = useState<EraIndex>();
  const [historyDepth, setHistoryDepth] = useState<number>();
  const [eraInfo, setEraInfo] = useState<EraInfo>();

  // Define reference for tracking mounted state.
  const mountedRef = useRef(false);
  // Effect for tracking mounted state.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Subscribe to list of selected accounts nominated operators.
  useEffect(() => {
    if (!api.query.staking || !encodedSelectedAddress) {
      setOperatorsToHighlight([]);
      return;
    }
    let unSubNominations: () => void;
    const getNominations = async () => {
      unSubNominations = await api.query.staking.nominators(encodedSelectedAddress, (nominations) => {
        const targets = nominations.unwrapOrDefault().targets.map((target) => {
          return target.toString();
        });
        setOperatorsToHighlight(targets);
      });
    };
    getNominations();
    return () => {
      unSubNominations && unSubNominations();
    };
  }, [api.isConnected, api.query.staking, encodedSelectedAddress]);

  // Effect to subscribe to active and current Eras.
  useEffect(() => {
    if (!api) return;
    let unsubActiveEra: () => void;
    let unsubCurrentEra: () => void;
    const Subscriptions = async () => {
      // Retrieve the active era and era start time via subscription
      unsubActiveEra = await api.query.staking.activeEra((activeEraInfo) => {
        if (activeEraInfo.isSome) {
          setActiveEra(activeEraInfo.unwrap().index);
        }
      });
      // Retrieve the current era via subscription
      unsubCurrentEra = await api.query.staking.currentEra((current) => {
        setCurrentEra(current.unwrapOrDefault());
      });
    };
    Subscriptions();
    return () => {
      unsubActiveEra && unsubActiveEra!();
      unsubCurrentEra && unsubCurrentEra!();
    };
  }, [api]);

  useEffect(() => {
    const getHistoryDepth = async () => {
      setHistoryDepth((await api.query.staking.historyDepth()).toNumber());
    };

    getHistoryDepth();
  }, [api.query.staking]);

  useEffect(() => {
    if (!activeEra || !currentEra || !historyDepth) return;
    const historicWithCurrent: EraIndex[] = [];
    const historicWithActive: EraIndex[] = [];
    const historicWithoutActive: EraIndex[] = [];

    let lastEra = currentEra.toNumber();

    while (lastEra >= 0 && historicWithCurrent.length < historyDepth + 1) {
      historicWithCurrent.push(api.registry.createType('EraIndex', lastEra));
      if (lastEra <= activeEra.toNumber()) {
        historicWithActive.push(api.registry.createType('EraIndex', lastEra));
      }
      if (lastEra < activeEra.toNumber()) {
        historicWithoutActive.push(api.registry.createType('EraIndex', lastEra));
      }
      lastEra -= 1;
    }
    // Reverse to go from oldest to newest.
    historicWithCurrent.reverse();
    historicWithActive.reverse();
    historicWithoutActive.reverse();

    setEraInfo({ activeEra, currentEra, historyDepth, historicWithCurrent, historicWithActive, historicWithoutActive });
  }, [activeEra, api.registry, currentEra, historyDepth]);

  if (!eraInfo) {
    return (
      <header className='App-header'>
        <Spinner />
      </header>
    );
  }
  return (
    <>
      <StakingContextProvider value={{ eraInfo, operatorsToHighlight }}>{children}</StakingContextProvider>
    </>
  );
}

export default StakingContextAppWrapper;