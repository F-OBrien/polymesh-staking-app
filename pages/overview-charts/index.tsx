import { useSdk } from '../../hooks/useSdk';
import { ErasAverageAprChart, ErasPointsTotalsChart, ErasRewardsTotalsChart, ErasTotalsStakedChart } from '../../components/chartsNoSSR';
import { useEffect, useRef, useState } from 'react';
import { EraIndex } from '@polkadot/types/interfaces';

export interface EraInfo {
  activeEra?: EraIndex;
  currentEra?: EraIndex;
  historyDepth?: number;
}

/* const operatorsToHighlight: string[] | undefined = [
  // '2D9Csm3gUoCt4SW6hBrB4tXKJZzsBLB8FL3esjMwom8ZVd4H', //B89 (2D9Cs..)',
  // '2DJrnr4qdcERfHAFX7c8Wi7a84w1Nx6mzbWnWmvPtufWFYvh', //Bloxxon (2DJrn..)',
  // '2FQ1RRJiUm4BXeZyMFLdtnVLTPxJ8qKfut3G29GhkwrKJsgy', //CM Equity 1 (2FQ1R..)',
  // '2Gr55WYCpsPChyhnfiSyCDYZrUUseaYeKXMLRzEJERnLbc4e', //CM Equity 2 (2Gr55..)',
  // '2GXMe4KZkmxM3ZMF142H4FhGb7EfBAiZ27XydYrUhuuEcnBM', //Crypto Lawyers 1 (2GXMe..)',
  // '2GtVwYQqPcUgM4BDSNvdSiKYYMihvRU2s8xVq626jrENBsqh', //Crypto Lawyers 2 (2GtVw..)',
  // '2DVuKBimttW6kTtXa7V1wvcHfubLJzHF9tJdh9iHFRbYCtmK', //DigiVault (2DVuK..)',
  // '2DK6iDQ3fcP9BDtLzPE9DcmTpkMq8JpwE3sLZvPWQnP7SaFf', //Entoro (2DK6i..)',
  // '2JBzQoJs2hV6nRT6K6cwtUYxbjh4QA6afaMkzdMEg5xPAibz', //Etana 1 (2JBzQ..)',
  // '2HqyET3THdGcFYPnLFVdPWhdrNgkn7feQhuXTbod34uNoimT', //Etana 2 (2HqyE..)',
  '2ETKjS2cu1LyU88sqVquAeXH5dPgmdMvKrcK5P4Mi1LZZskz', //GATENet (2ETKj..)',
  // '2FCyV1aQ9C1nXMQK65KLacQkosGzf2DpqTLVB1LSMkwHTW28', //Genesis Block 1 (2FCyV..)',
  // '2EXypWKU82c1ZFQ92ynNzKWjQmX1ZfnFEcaFoVzPEUhmM72g', //Genesis Block 2 (2EXyp..)',
  // '2FawFuGUJzXtebwxTxwUjTsiwwV63WbK9ckojpPK3WkmwnA2', //Genesis Block 3 (2FawF..)',
  // '2EGKNqWLx2VhjgFZ6BwXZ9Tf6jQXzWjW4cNvE2Bd24z85xfq', //Marketlend (2EGKN..)',
  // '2EzwX3nVVysJwvZ8NeZojCJ9xsprE4mr3989mWiWKsdSki3b', //Oasis Pro Markets 1 (2EzwX..)',
  // '2DVrQgBLdRyvLvC13dXMBc7yEMAMDzGNSG2ZKYunmiyvJPUN', //Oasis Pro Markets 2 (2DVrQ..)',
  // '2F5eK4mfXfMRYmfYAsvqnakTDVn7CciBKtmY3b5yA5vJbjkK', //Polymesh Association 1 (2F5eK..)',
  // '2G2aYVLGrtVJabA1wjkg2NvmWpLyWHASKh8s9SGpUQoUTZtx', //Polymesh Association 2 (2G2aY..)',
  // '2GrcoMQBMUgi2tN7YGALGniA14tdc2sZutUVa6uETDtGcqVY', //Polymesh Association 3 (2Grco..)',
  // '2EgLVBj8ysTXntmEA2gB2z9EZPbcFksjKBKpgrd6C2gZoyP5', //Polymesh Genesis 1 (2EgLV..)',
  // '2DbdqnRHR4yWMdsqKcGcySxS42JMRQgHfsaumL8ihrGo1Pe9', //Polymesh Genesis 2 (2Dbdq..)',
  // '2Dajy5DRxQM1ShW1fYwJFGjMacB3WkMvpet1soWoqMHiixco', //Polymesh Genesis 3 (2Dajy..)',
  '2EohUybEWs5Md1ZRByDVWC4SVtAVMx6KR5McYEu7GcVkYnZm', //Saxon Advisors 1 (2EohU..)',
  '2CVjdqJB62TXkuAG4ebPqdrEyAuzee5FVvZVbxuiUDXian3F', //Saxon Advisors 2 (2CVjd..)',
  '2Eu9tSri8pDCYd2dFSPNLcgs8QfTaCcaafxAMd1nozznRiF8', //Saxon Advisors 3 (2Eu9t..)',
  // '2HaPRmkcUS2etM4nDA7sEeEDusm7CAQAHZnAFTcf3KLSmDf8', //Scrypt (2HaPR..)',
  '2Gw8mSc4CUMxXMKEDqEsumQEXE5yTF8ACq2KdHGuigyXkwtz', //Tokenise 1 (2Gw8m..)',
  '2HkhrGZF69CkvhgSAf9TmoDgSrEPtGJ6s43UqhQgS6eHPDzV', //Tokenise 2 (2Hkhr..)',
];
 */
function App() {
  const { api, encodedSelectedAddress } = useSdk();
  const [activeEra, setActiveEra] = useState<EraIndex>();
  const [currentEra, setCurrentEra] = useState<EraIndex>();
  const [historyDepth, setHistoryDepth] = useState<number>();
  const [eraInfo, setEraInfo] = useState<EraInfo>({});

  // Define reference for tracking mounted state.
  const mountedRef = useRef(false);
  // Effect for tracking mounted state.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Effect to subscribe to active and current Eras.
  useEffect(() => {
    if (!api) return;
    let isSubscribed = true;
    const Subscriptions = async () => {
      // Retrieve the active era and era start time via subscription
      const unsubActiveEra = await api?.query.staking.activeEra((activeEraInfo) => {
        if (!isSubscribed || !api.isConnected) unsubActiveEra!();
        if (activeEraInfo.isSome) {
          setActiveEra(activeEraInfo.unwrap().index);
        }
      });
      // Retrieve the current era via subscription
      const unsubCurrentEra = await api?.query.staking.currentEra((current) => {
        if (!isSubscribed || !api.isConnected) unsubCurrentEra!();
        setCurrentEra(current.unwrapOrDefault());
      });
    };
    Subscriptions();
    return () => {
      isSubscribed = false;
    };
  }, [api]);

  useEffect(() => {
    const getHistoryDepth = async () => {
      setHistoryDepth((await api.query.staking.historyDepth()).toNumber());
    };

    getHistoryDepth();
  }, [api.query.staking]);

  useEffect(() => {
    setEraInfo({ activeEra, currentEra, historyDepth });
  }, [activeEra, currentEra, historyDepth]);

  return (
    <div className='App'>
      <ErasAverageAprChart />
      <ErasTotalsStakedChart />
      <ErasPointsTotalsChart />
      <ErasRewardsTotalsChart />
    </div>
  );
}

export default App;
