import type { Polymesh } from '@polymeshassociation/polymesh-sdk';
import type { InjectedExtension, InjectedAccount } from '@polkadot/extension-inject/types';
import type { u32, u64 } from '@polkadot/types';
import { Moment, EraIndex, BalanceOf, SessionIndex } from '@polkadot/types/interfaces';

export interface SdkProps {
  sdk: Polymesh;
  api: Polymesh['_polkadotApi'];
  network: NetworkMeta;
  chainData: ChainData;
  walletAccounts?: InjectedAccount[];
  stashAddress: string;
}

export interface StakingContextProps {
  eraInfo: EraInfo;
  stakingConstants: StakingConstants;
  operatorsToHighlight?: string[];
}

export interface NetworkMeta {
  name: NetworkName;
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
  sessionsPerEra: SessionIndex;
  electionLookahead: u32;
}

export interface EraInfo {
  activeEra: EraIndex;
  currentEra: EraIndex;
  historyDepth: number;
  historicWithCurrent: EraIndex[];
  historicWithActive: EraIndex[];
  historicWithoutActive: EraIndex[];
}

export interface StakingConstants {
  maxVariableInflationTotalIssuance: BalanceOf;
  fixedYearlyReward: BalanceOf;
}
