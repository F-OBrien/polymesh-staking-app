import { createContext, useEffect, useMemo, useState } from 'react';
import Spinner from '../components/Spinner';
import { ApiPromise } from '@polkadot/api';
import { Polymesh } from '@polymeshassociation/polymesh-sdk';
import { InjectedAccount, InjectedExtension } from '@polkadot/extension-inject/types';
import { decodeAddress, encodeAddress } from '@polkadot/util-crypto';
import { ChainData, NetworkMeta, PolywalletExtension, SdkProps } from '../types/types';
import { useQueryClient } from 'react-query';
import type { u32 } from '@polkadot/types';
import { defaultNetwork } from '../constants/constants';

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
const retrieveChainData = async (api: ApiPromise): Promise<ChainData> => {
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
    epochDuration: api.consts.babe.epochDuration,
    expectedBlockTime: api.consts.babe.expectedBlockTime,
    sessionsPerEra: api.consts.staking.sessionsPerEra,
    electionLookahead: api.consts.staking.electionLookahead as u32,
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
  const [api, setApi] = useState<ApiPromise>();
  const [network, setNetwork] = useState<NetworkMeta>();
  const [chainData, setChainData] = useState<ChainData>();
  const [wallet, setWallet] = useState<PolywalletExtension | InjectedExtension>();
  const [walletAccounts, setWalletAccounts] = useState<InjectedAccount[]>();
  const queryClient = useQueryClient();
  // Connect Polymesh wallet, set selected account and subscribe to changes in accounts/selection.
  useEffect(() => {
    const connectPolymeshWallet = async () => {
      // Next.js errors if these are attempted to be rendered server side so import here.
      const { web3Enable } = await import('@polkadot/extension-dapp');

      // Get an array of all the injected sources. This needs to be called first,
      // before other requests. Will prompt for authorization first time.
      const allInjected = await web3Enable('Staking Stats dApp');

      // Filter sources to find the Polymesh wallet.
      // This implementation only supports polywallet.
      // TODO: Consider adding support for other substrate wallets through optional selection.
      // Would also requires selection of network as not provided by other wallet extensions.
      const polyWallet = allInjected.filter((extension) => extension.name === 'polywallet');
      // If the Polymesh wallet is not present throw an error.
      if (polyWallet.length === 0) {
        setNetwork(defaultNetwork);
      } else {
        // If there is more than 1 Polymesh wallet throw an error.
        if (polyWallet.length > 1) {
          throw new Error(`There is more than one extension named "polywallet"`);
        }

        const wallet = polyWallet[0] as PolywalletExtension;
        setWallet(wallet);
        console.log('wallet:', wallet);

        // Get and set the selected network from the wallet extension.
        const selectedNetwork = await wallet.network.get();
        setNetwork(selectedNetwork);
        console.log('selected network:', selectedNetwork);

        wallet.network.subscribe((network) => {
          setNetwork(network);
          console.log('network changed to:', network);
        });

        // Get the list of polywallet accounts
        const polyAccounts = await polyWallet[0].accounts.get();
        if (polyAccounts.length === 0) throw new Error('No accounts found');
        // Set the wallet account information.
        setWalletAccounts(polyAccounts);

        // Subscribe to accounts for changes to selected account or adding/removing accounts.
        polyWallet[0].accounts.subscribe((accounts) => {
          if (accounts.length === 0) throw new Error('No accounts found');
          setWalletAccounts(accounts);
        });
      }
    };

    connectPolymeshWallet();
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
      });
      setSdk(polymeshSdk);
      setApi(polymeshSdk._polkadotApi);
      setLoadingStep('Connected');
      console.log('SDK CONNECTED');
      console.log('sdk', polymeshSdk);
      console.log('api', polymeshSdk._polkadotApi);

      const chainInfo = await retrieveChainData(polymeshSdk._polkadotApi);
      setChainData(chainInfo);
      console.log('Chain Data:', JSON.stringify(chainInfo, null, 2));
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

  // If a wallet extension signer is available set for the api
  useEffect(() => {
    if (!api || !wallet?.signer) return;
    api.setSigner(wallet.signer);
  }, [api, wallet?.signer]);

  //Set the currently selected account as the signing key (for polywallet index 0 = selected).
  const encodedSelectedAddress = useMemo(() => {
    if (!walletAccounts || !chainData?.ss58Format) return;
    // return '2EZsPKnacSeroCJPd3aseH75kUwcQDtTzFefdSwL3TtxEf3F'; // Whale address
    return changeAddressFormat(walletAccounts[0].address, chainData.ss58Format);
  }, [chainData?.ss58Format, walletAccounts]);

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
        <b>Blockchain:</b> {chainData?.systemChain || 'awaiting chain data'} | <b>WebSocket:</b> {network?.wssUrl} | <b>Selected Account:</b>{' '}
        {encodedSelectedAddress || 'Polymesh wallet extension not connected'}
      </div>
      {!sdk || !api || !network || !chainData ? (
      <header className='App-header'>
        <Spinner /> {loadingStep}
      </header>
      ) : (
      <SdkContextProvider value={{ sdk, api, network, encodedSelectedAddress, chainData, walletAccounts }}>{children}</SdkContextProvider>
      )}
    </>
  );
}

export default SdkAppWrapper;
