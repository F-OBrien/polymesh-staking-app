import type { Polymesh } from '@polymeshassociation/polymesh-sdk';
import type { u32, u64 } from '@polkadot/types';
import { Moment, EraIndex, BalanceOf, SessionIndex } from '@polkadot/types/interfaces';
import type { NetworkInfo } from '@polymeshassociation/browser-extension-signing-manager/types';

export interface SdkProps {
  sdk: Polymesh;
  api: Polymesh['_polkadotApi'];
  network: NetworkInfo;
  chainData: ChainData;
  walletAccounts?: string[];
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
