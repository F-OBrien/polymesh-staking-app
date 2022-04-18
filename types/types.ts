import type { Polymesh } from '@polymathnetwork/polymesh-sdk';
import type { ApiPromise } from '@polkadot/api';
import type { InjectedExtension, InjectedAccount } from '@polkadot/extension-inject/types';
import type { u32, u64 } from '@polkadot/types';
import { BlockNumber, Moment } from '@polkadot/types/interfaces/runtime';

export interface SdkProps {
  sdk: Polymesh;
  api: ApiPromise;
  network: NetworkMeta;
  chainData: ChainData;
  walletAccounts?: InjectedAccount[];
  encodedSelectedAddress?: string;
}

export interface NetworkMeta {
  name: string;
  label: string;
  wssUrl: string;
}

export enum NetworkName {
  mainnet = 'mainnet',
  testnet = 'testnet',
  local = 'local',
}

export type UnsubCallback = () => void;

export type PolywalletExtension = InjectedExtension & {
  network: {
    subscribe(cb: (networkInfo: NetworkMeta) => void): UnsubCallback;
    get(): Promise<NetworkMeta>;
  };
  uid: {
    isSet(): Promise<boolean>;
    provide(payload: { did: string; uid: string; network: NetworkName }): Promise<boolean>;
    read(): Promise<{ id: number; uid: string }>;
    requestProof(payload: { ticker: string }): Promise<{ id: number; proof: string }>;
  };
};

export interface ChainData {
  ss58Format?: number;
  tokenDecimals: number;
  tokenSymbol: string;
  systemChain: string;
  systemName: string;
  systemVersion: string;
  systemChainType: string;
  genesisHash: string;
  epochDuration: u64;
  expectedBlockTime: Moment;
  sessionsPerEra: u64;
  electionLookahead: u32;
}
