import { createContext, useEffect, useMemo, useState } from 'react';
import Spinner from '../components/Spinner';
import { Polymesh } from '@polymeshassociation/polymesh-sdk';
import { decodeAddress, encodeAddress } from '@polkadot/util-crypto';
import { ChainData, SdkProps } from '../types/types';
import { useQueryClient } from 'react-query';
import { defaultNetwork, explorerURLs } from '../constants/constants';
import { BrowserExtensionSigningManager } from '@polymeshassociation/browser-extension-signing-manager';
import type { NetworkInfo } from '@polymeshassociation/browser-extension-signing-manager/types';

export const SdkContext = createContext({} as unknown as SdkProps);
export const SdkContextProvider = SdkContext.Provider;
export const SdkContextConsumer = SdkContext.Consumer;

interface Props {
  children: React.ReactNode;
}

/**
 * Retrieves various chain specific data.
 * @param api Polymesh(Polkadot) API instance
 * @returns Chain Data
 */
const retrieveChainData = async (api: Polymesh['_polkadotApi']): Promise<ChainData> => {
  const [systemChain, systemName, systemVersion, systemChainType, genesisHash] = await Promise.all([
    api.rpc.system.chain(),
    api.rpc.system.name(),
    api.rpc.system.version(),
    api.rpc.system.chainType(),
    api.genesisHash,
  ]);

  return {
    systemChain: (systemChain || '<unknown>').toString(),
    systemVersion: systemVersion.toString(),
    systemChainType: systemChainType.toString(),
    tokenSymbol: api.registry.chainTokens[0],
    tokenDecimals: api.registry.chainDecimals[0],
    ss58Format: api.registry.chainSS58,
    systemName: systemName.toString(),
    genesisHash: genesisHash.toString(),
    // @ts-ignore
    epochDuration: api.consts.babe.epochDuration,
    // @ts-ignore
    expectedBlockTime: api.consts.babe.expectedBlockTime,
    // @ts-ignore
    sessionsPerEra: api.consts.staking.sessionsPerEra,
    // @ts-ignore
    electionLookahead: api.consts.staking.electionLookahead,
  };
};

/**
 * Takes a SS58 Format address and re-encodes in the specified format.
 * @param address any SS58 encoded address
 * @param ss58Format target SS58 format
 * @returns address encoded in ss58Format
 */
export function changeAddressFormat(address: string, ss58Format: number): string {
  return encodeAddress(decodeAddress(address), ss58Format);
}

/**
 * React component to provide SDK/API and wallet extension context to the dAPP
 * @returns renders spinner when connecting
 */
function SdkAppWrapper({ children }: Props): React.ReactElement<Props> | null {
  const [loadingStep, setLoadingStep] = useState<string>();
  const [sdk, setSdk] = useState<Polymesh>();
  const [api, setApi] = useState<Polymesh['_polkadotApi']>();
  const [network, setNetwork] = useState<NetworkInfo>();
  const [chainData, setChainData] = useState<ChainData>();
  const [stashAddress, setStashAddress] = useState('');
  // const [wallet, setWallet] = useState<PolywalletExtension | InjectedExtension>();
  const [walletAccounts, setWalletAccounts] = useState<string[]>();
  const queryClient = useQueryClient();
  // Connect Polymesh wallet, set selected account and subscribe to changes in accounts/selection.
  useEffect(() => {
    let unsubNetwork: () => void = () => {};
    let unsubAccounts: () => void = () => {};
    const connectPolymeshWallet = async () => {
      const injectedExtensions = BrowserExtensionSigningManager.getExtensionList();

      if (injectedExtensions.includes('polywallet')) {
        const signingManagerInstance = await BrowserExtensionSigningManager.create({
          appName: 'Staking Stats dApp',
          extensionName: 'polywallet',
          ss58Format: 42,
        });
        const networkInfo = await signingManagerInstance.getCurrentNetwork();
        networkInfo ? setNetwork(networkInfo) : setNetwork(defaultNetwork);
        unsubNetwork = signingManagerInstance.onNetworkChange((network) => {
          setNetwork(network);
          console.log('network changed to:', network);
        });
        const wallets = await signingManagerInstance.getAccounts();
        if (wallets.length === 0) throw new Error('No accounts found');
        setWalletAccounts(wallets);

        unsubAccounts = signingManagerInstance.onAccountChange((accounts) => {
          setWalletAccounts(accounts as string[]);
        }, false);
      } else {
        setNetwork(defaultNetwork);
      }
    };

    connectPolymeshWallet();
    return () => {
      unsubNetwork && unsubNetwork();
      unsubAccounts && unsubAccounts();
    };
  }, []);

  // Connect to the Polymesh SDK (and Polkadot API).
  useEffect(() => {
    if (!network || !queryClient) return;

    let polymeshSdk: Polymesh;

    // On network change clear any historical cached queries.
    queryClient.clear();

    async function connect() {
      console.log(`\nConnecting to Polymesh ${network?.name} at ${network?.wssUrl}.\n`);
      setLoadingStep('Connecting');
      polymeshSdk = await Polymesh.connect({
        nodeUrl: network!.wssUrl,
        polkadot: { noInitWarn: true },
      });
      setSdk(polymeshSdk);
      setApi(polymeshSdk._polkadotApi);
      setLoadingStep('Connected');
      console.log(`Connected to ${network?.name}`);

      const chainInfo = await retrieveChainData(polymeshSdk._polkadotApi);
      setChainData(chainInfo);
    }

    connect();

    // Clean up connection on unmount when network changes
    return () => {
      polymeshSdk?.disconnect();
      setApi(undefined);
      setSdk(undefined);
      console.log('SDK DISCONNECTED');
    };
  }, [network, queryClient]);

  // // If a wallet extension signer is available set for the api
  // useEffect(() => {
  //   if (!api || !wallet?.signer) return;
  //   api.setSigner(wallet.signer);
  // }, [api, wallet?.signer]);

  //Set the currently selected account as the signing key (for polywallet index 0 = selected).
  const encodedSelectedAddress = useMemo(() => {
    if (!walletAccounts || !chainData?.ss58Format) return;
    // return '2EZsPKnacSeroCJPd3aseH75kUwcQDtTzFefdSwL3TtxEf3F'; // Whale address
    return changeAddressFormat(walletAccounts[0], chainData.ss58Format);
  }, [chainData?.ss58Format, walletAccounts]);

  useEffect(() => {
    if (!encodedSelectedAddress) return;
    const getStash = async () => {
      const stakingLedger = await api?.query.staking.ledger(encodedSelectedAddress);

      if (stakingLedger?.isSome) {
        const ledger = stakingLedger.unwrapOrDefault();
        console.log(ledger.stash.toString());
        setStashAddress(ledger.stash.toString());
        return;
      }
      setStashAddress(encodedSelectedAddress);
    };
    getStash();
  }, [api?.query.staking, encodedSelectedAddress]);
  /* Test transaction*/
  /* TO BE REMOVED once setting a keyring key and pair is not mandatory in the SDK for api transactions*/
  // useEffect(() => {
  //   if (/* !sdk?.context || */ !encodedSelectedAddress || !sdk?._polkadotApi) return;
  //   ////////////////////////////////////////////////////////
  //   // TODO: REMOVE ONCE BUG REQUIRING KEYRING
  //   // Add a account to the sdk keyring. if not done we get "Error: The address is not present in the keyring set"
  //   // when trying to setPair
  //   // sdk.context.keyring.addFromAddress(encodedSelectedAddress);
  //   // Set signing address if not set we get "Error: Cannot perform transactions without an active account"

  //   // sdk.context.setPair(encodedSelectedAddress);
  //   ///////////////////////////////////////////////////////

  //   // TEST TRANSACTION TO BE DELETED
  //   sdk._polkadotApi.tx.balances
  //     .transfer('5Gn58SaJC4Y9CQRLvZ3ACcobehDFwtqUMYQRwVkTqNRunreV', 123)
  //     .signAndSend(encodedSelectedAddress!, ({ status }) => {
  //       if (status.isInBlock) {
  //         console.log(`Completed at block hash #${status.asInBlock.toString()}`);
  //       } else {
  //         console.log(`Current status: ${status.type}`);
  //       }
  //     })
  //     .catch((error: any) => {
  //       console.log(':( transaction failed', error);
  //     });
  // }, [encodedSelectedAddress, sdk?._polkadotApi /* sdk?.context */]);

  return (
    <>
      <div>
        <b>Blockchain: </b> {chainData?.systemChain || 'awaiting chain data'} | <b>WebSocket: </b> {network?.wssUrl} | <b>Selected Account: </b>
        {!encodedSelectedAddress ? (
          'Polymesh wallet extension not connected'
        ) : !network?.name || !explorerURLs[network?.name] ? (
          encodedSelectedAddress
        ) : (
          <a href={`${explorerURLs[network?.name]}account/${encodedSelectedAddress}`} target='_blank' rel='noreferrer noopener'>
            {encodedSelectedAddress}
          </a>
        )}
      </div>
      {!sdk || !api || !network || !chainData ? (
        <header className='App-header'>
          <Spinner /> {loadingStep}
        </header>
      ) : (
        <SdkContextProvider value={{ sdk, api, network, chainData, walletAccounts, stashAddress }}>{children}</SdkContextProvider>
      )}
    </>
  );
}

export default SdkAppWrapper;
