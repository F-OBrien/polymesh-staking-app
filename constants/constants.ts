import { BN } from '@polkadot/util';
import { ChartOptions } from 'chart.js';
import { NetworkMeta, NetworkName } from '../types/types';

export const networkURLs: Record<string, string> = {
  mainnet: 'wss://mainnet-rpc.polymesh.network',
  testnet: 'wss://testnet-rpc.polymesh.live',
};

export const explorerURLs: Record<string, string> = {
  mainnet: 'https://polymesh.subscan.io/',
  testnet: 'https://polymesh-testnet.subscan.io/',
};

export const defaultNetwork: NetworkMeta = {
  name: NetworkName.mainnet,
  label: 'Mainnet',
  wssUrl: networkURLs.mainnet,
};

export const operatorsNames: Record<string, string> = {
  '2D9Csm3gUoCt4SW6hBrB4tXKJZzsBLB8FL3esjMwom8ZVd4H': 'B89 1 (2D9Cs..)',
  '2DzfY8SiDhCwf5VkGKKoyxAUZDDjbojCh85Y5ATYWWF9CnH3': 'Binance 1 (2DzfY..)',
  '2DJrnr4qdcERfHAFX7c8Wi7a84w1Nx6mzbWnWmvPtufWFYvh': 'Nyala 1 (2DJrn..)',
  '2Fb8FwXzXywRkkEiFnPmdw86XPHDurcm7T8FrbCECGKB4Kir': 'Nyala 2 (2Fb8F..)',
  '2DQgvaATTCeaNyqPvd1XpUoN6PagtPi1tFG6Bd7TyC1krFB7': 'Nyala 3 (2DQgv..)',
  '2FQ1RRJiUm4BXeZyMFLdtnVLTPxJ8qKfut3G29GhkwrKJsgy': 'CM Equity 1 (2FQ1R..)',
  '2Gr55WYCpsPChyhnfiSyCDYZrUUseaYeKXMLRzEJERnLbc4e': 'CM Equity 2 (2Gr55..)',
  '2GrEHDSx2ud2nHkhA3pqpF316knPRAjCprkezwUuzQ5xf627': 'CM Equity 3 (2GrEH..)',
  '2GXMe4KZkmxM3ZMF142H4FhGb7EfBAiZ27XydYrUhuuEcnBM': 'TigerWit 1 (2GXMe..)',
  '2GtVwYQqPcUgM4BDSNvdSiKYYMihvRU2s8xVq626jrENBsqh': 'TigerWit 2 (2GtVw..)',
  '2EoZ98L4C4BrHgD82JmecQHyhEywtZYjerimnNH9RQR87FwR': 'TigerWit 3 (2EoZ9..)',
  '2DVuKBimttW6kTtXa7V1wvcHfubLJzHF9tJdh9iHFRbYCtmK': 'DigiVault 1 (2DVuK..)',
  '2DQNASGzzCMkEUFW3yCQhWoHiK8ENRaEHoYMmURs4hoD1CZg': 'DigiVault 2 (2DQNA..)',
  '2EoQ165Ui3zSC8ndUozecxq7xPbrebcFkqMPs9wEZSiDEVAN': 'DigiVault 3 (2EoQ1..)',
  '2DK6iDQ3fcP9BDtLzPE9DcmTpkMq8JpwE3sLZvPWQnP7SaFf': 'Entoro 1 (2DK6i..)',
  '2G7mLeEVbzRqwvahgYQvR6fNyoT91XMy1oGCHiSCkRM1UcE9': 'Entoro 2 (2G7mL..)',
  '2FarNp4Q3p2vSdCJzF1oHvQmDd7gHrZivzJHj7cecXobixW8': 'Entoro 3 (2FarN..)',
  '2JBzQoJs2hV6nRT6K6cwtUYxbjh4QA6afaMkzdMEg5xPAibz': 'Etana 1 (2JBzQ..)',
  '2HqyET3THdGcFYPnLFVdPWhdrNgkn7feQhuXTbod34uNoimT': 'Etana 2 (2HqyE..)',
  '2ETKjS2cu1LyU88sqVquAeXH5dPgmdMvKrcK5P4Mi1LZZskz': 'GATENet 1 (2ETKj..)',
  '2FCyV1aQ9C1nXMQK65KLacQkosGzf2DpqTLVB1LSMkwHTW28': 'Genesis Block 1 (2FCyV..)',
  '2EXypWKU82c1ZFQ92ynNzKWjQmX1ZfnFEcaFoVzPEUhmM72g': 'Genesis Block 2 (2EXyp..)',
  '2FawFuGUJzXtebwxTxwUjTsiwwV63WbK9ckojpPK3WkmwnA2': 'Genesis Block 3 (2FawF..)',
  '2FjuFr7YNQ6qQPYSLCZrMDEQr284ktW88H8T6p6nmJe2URny': 'Greentrail 1 (2FjuF..)',
  '2Gk5AMZdMQBg2cAigd3BQFm3UB4554SYDEohK8P8B4Pko3n2': 'Greentrail 2 (2Gk5A..)',
  '2EPW8CFP6dW7HMgEBEV8aA9LqGuzXDDn7aEZGpofjyBfS3Bw': 'Greentrail 3 (2EPW8..)',
  '2Gw7nZrGbvKMJNu5i88TeK45Ygy8jiP6xDaBixrPMh4L1Lr5': 'Huobi 1 (2Gw7n..)',
  '2EH8PYvqsPM249f7gbFjgkueZBBjKaNyuwk7GNdL3sYYjFaa': 'Huobi 2 (2EH8P..)',
  '2HzRAKv6vsBnvkGhREfRAJhevozdnwQozUuQZ5sAs8SvbmPr': 'Huobi 3 (2HzRA..)',
  '2F8DfqfUi7Uey1A3owvMpbhpY9QJnh2FpLN3aT2Tdt6mJCJE': 'KDAC 1 (2F8Df..)',
  '2HkM2U59JkBKoNSysaUfyDcXCh18xjFXwLzYc2PRtjSgmkgz': 'KDAC 2 (2HkM2..)',
  '2D5vLzduaZvErwamwLZBixGozQA33sKfdhXXuAyZ8n1ZdHMd': 'KDAC 3 (2D5vL..)',
  '2EGKNqWLx2VhjgFZ6BwXZ9Tf6jQXzWjW4cNvE2Bd24z85xfq': 'Marketlend 1 (2EGKN..)',
  '2DR8JZWwJ7jDSHYDKoaV7Bfi6dyoQ6FkBx4KYB5owtjiFgj5': 'Marketlend 2 (2DR8J..)',
  '2G3CJWkzusVqtxYoofCjGqwxgjFYJS6Rxvg8supREvQBmtvy': 'Marketlend 3 (2G3CJ..)',
  '2EwgKqSEGReJTtFqjTcdW6eDffnYE4Gi6AErWrLTLgew663z': 'MyCointainer 1 (2EwgK..)',
  '2EzwX3nVVysJwvZ8NeZojCJ9xsprE4mr3989mWiWKsdSki3b': 'Oasis Pro Markets 1 (2EzwX..)',
  '2DVrQgBLdRyvLvC13dXMBc7yEMAMDzGNSG2ZKYunmiyvJPUN': 'Oasis Pro Markets 2 (2DVrQ..)',
  '2EgBuMoRWbqNimZF3bv3aMmDAAna5F6jTm7hWNmFQwXhZcEB': 'Oasis Pro Markets 3 (2EgBu..)',
  '2F5eK4mfXfMRYmfYAsvqnakTDVn7CciBKtmY3b5yA5vJbjkK': 'Polymesh Assoc. 1 (2F5eK..)',
  '2G2aYVLGrtVJabA1wjkg2NvmWpLyWHASKh8s9SGpUQoUTZtx': 'Polymesh Assoc. 2 (2G2aY..)',
  '2GrcoMQBMUgi2tN7YGALGniA14tdc2sZutUVa6uETDtGcqVY': 'Polymesh Assoc. 3 (2Grco..)',
  '2EgLVBj8ysTXntmEA2gB2z9EZPbcFksjKBKpgrd6C2gZoyP5': 'Polymesh Genesis 1 (2EgLV..)',
  '2DbdqnRHR4yWMdsqKcGcySxS42JMRQgHfsaumL8ihrGo1Pe9': 'Polymesh Genesis 2 (2Dbdq..)',
  '2Dajy5DRxQM1ShW1fYwJFGjMacB3WkMvpet1soWoqMHiixco': 'Polymesh Genesis 3 (2Dajy..)',
  '2EohUybEWs5Md1ZRByDVWC4SVtAVMx6KR5McYEu7GcVkYnZm': 'Saxon Advisors 1 (2EohU..)',
  '2CVjdqJB62TXkuAG4ebPqdrEyAuzee5FVvZVbxuiUDXian3F': 'Saxon Advisors 2 (2CVjd..)',
  '2Eu9tSri8pDCYd2dFSPNLcgs8QfTaCcaafxAMd1nozznRiF8': 'Saxon Advisors 3 (2Eu9t..)',
  '2EiQVyXzyC8m8fg8BVokmSo5YKBVPspTUWijuBtKV9biS2s4': 'Sors 1 (2EiQV..)',
  '2HaPRmkcUS2etM4nDA7sEeEDusm7CAQAHZnAFTcf3KLSmDf8': 'Scrypt 1 (2HaPR..)',
  '2Gw8mSc4CUMxXMKEDqEsumQEXE5yTF8ACq2KdHGuigyXkwtz': 'Tokenise 1 (2Gw8m..)',
  '2HkhrGZF69CkvhgSAf9TmoDgSrEPtGJ6s43UqhQgS6eHPDzV': 'Tokenise 2 (2Hkhr..)',
  '2J4vUU6rUKhgYykuxi1ve1cEAFAbxfy97YvsxKvAQfpdjKjd': 'Tokenise 3 (2J4vU..)',
  // Testnet Operators
  '5C7kNpSvVr22Z1X6gVAUjfahSJfSpvw4DHNoY7uUHpLfEJZR': 'Polymesh Assoc. 1 (5C7kN..)',
  '5EFbtwDBQu64WjUGqAgC3kuaiH86E34CHtqxbN7zAgwwT2cg': 'Polymesh Assoc. 2 (5EFbt..)',
  '5E4gAVQf6j3wKY4pq24PorXCnsvFe4oGbvrfpkVN6zBsGVzE': 'Polymesh Assoc. 3 (5E4gA..)',
};

export const didInfo: Record<string, { name: string; website: string }> = {
  // Permissioned Operators
  '0x0400000000000000000000000000000000000000000000000000000000000000': { name: 'Polymesh Association', website: 'https://polymesh.network/' },
  '0x047422a476a5050dd7c1182e2b35e07b937ccc378f06e0304c9509b00874c40b': { name: 'GATENet', website: 'https://gatenet.io/' },
  '0x09863f7f34cc40c58004dbe0f3ed10ef06a6e059419aca49d59f30e0b5170176': { name: 'Genesis Block', website: 'https://www.genesisblockchain.io/' },
  '0x13b9b8cc6bb21ffdd897765744cb5ff75dd9ed7adadd024813531ad1af2a226e': { name: 'Entoro', website: 'https://www.entoro.com/' },
  '0x1e4361c382f6556095a855a43e20289b7252a1c66c7c8b837ae32d3d1cb16642': { name: 'Tokenise', website: 'https://tokenise.io/' },
  '0x38541bfd646d2b404033d0694eefbed47dbcac6eb97a50cc51853f3a46f06e0b': { name: 'Marketlend', website: 'https://www.marketlend.com.au/' },
  '0x3b03ed66022074528ea1a0ad840c8753ca102d1f2a47ea82623f97b67d490b60': { name: 'Oasis Pro Markets', website: 'https://www.oasispromarkets.com/' },
  '0x4dfc4fc610db8b59e29bb3df5b0a0b097fd5df5934dcdba475c470e302f205ea': { name: 'CM Equity', website: 'https://cm-equity.de/en/' },
  '0x5c27274a1e4b854c4d87d96472d4fe73affc2d619103c615da8af34e53d5e7aa': { name: 'B89', website: 'https://www.b89.io/' },
  '0x5e440a1e36ad87dc96f601562e344d87054fbf43e9b109d988ea3a3664f29f5e': { name: 'Saxon Advisors', website: 'https://saxonadvisors.com/' },
  '0x7b5de4a8dfb706a24f5288082c3e4efdd834309785f7bee95ecea0d8f3abd80a': { name: 'Etana', website: 'https://www.etana.com/' },
  '0xadb26ff440bf4e7c0892e1f8ae53d5927cbe1749c23d2b0b5f8a9edbbc8678b4': { name: 'DigiVault', website: 'https://digivault.com/' },
  '0xb56098cc0d320c86785f2162e0028d0e31c7453efbcae44f938a26b2ee478e06': { name: 'Crypto Lawyers', website: 'https://www.crypto-lawyers.ch/' },
  '0xbc06bd9d9450d9f5083eec8490da7131b8b07f19fababecc578dd79d58d85956': { name: 'Nyala (formerly Bloxxon)', website: 'https://www.nyala.de/' },
  '0xf820c02c85c98bb9609049ad9f555517d35dd73d04b080aaa481720119a23bb8': { name: 'Scrypt', website: 'https://www.scrypt.swiss/' },
  '0x88a82894621328300ad71de9ccbe46f78335aab8cc6964d812047b72e6d42b75': { name: 'GreenTrail', website: 'https://www.greentrailcap.com/' },
  '0x9ce770a58b510053d5ec5ef37ffa8cf3517438405912f64ee4d0ff40ed848485': { name: 'Huobi', website: 'https://www.huobi.com/' },
  '0x2fcee3ea024833439825a9579b659904ab85f1b35bfe8b0c96975721a0167a9a': { name: 'MyCointainer', website: 'https://www.huobi.com/' },
  '0x99c85793703e6d745b261512c61f2b1ba6c6d1c1c4911ce0552bf55d5cda3f47': { name: 'Korea Digital Asset Custody', website: 'https://www.kdac.io/' },
  '0x87f70af83b01f0db214c516c7eafc3c193aa879f3266b2e160b09dc6366ba3f5': { name: 'Binance', website: 'https://www.binance.com/' },
  '0x30be231224de2133696309d0863356fa6318d904d84c67c13c2b7497b63649c2': { name: 'TigerWit', website: 'https://uk.tigerwit.com/' },
  '0xb1165011950bfa51c155dfdfc50db065f12ec5658aeac688f5b4a62bb4d7e1b4': { name: 'Sors Digital Assets', website: 'https://sorsdigitalassets.com/' },
  // Permissioned CDD Providers
  '0x0100000000000000000000000000000000000000000000000000000000000000': { name: 'Polymath', website: 'https://polymath.network/' },
  // '0x0400000000000000000000000000000000000000000000000000000000000000': { name: 'Polymesh Association', website: 'https://polymesh.network/' },
  '0x4d42a6a3d3d4977987f2ae50ec49c9f3ce9093cf1f5c0162c49eada21573c9f4': { name: 'Netki', website: 'https://netki.com/' },
  '0xd332d9c2752b01f01b19dfa559e436125d50f084a5d038ec80518c4f23f077e5': { name: 'Fractal', website: 'https://company.fractal.id/' },
  '0x590d4abea96b22dd88133d1b0b84d44d3a8e6a07bc4786799465344d5b88a4bd': { name: 'Jumio', website: 'https://www.jumio.com/' },
  // Exchanges
  '0x191ad8c72a13aba33630315b0aa564decc8795f9b8539f3ff3ad2340c6ca8bf1': { name: 'Huobi Deposit', website: 'https://www.huobi.com/' },
  '0x22dbdce70771f6499a631a9e1fde0bbedf5641532d5b8a249320da58435cc9a0': { name: 'Huobi Stash', website: 'https://www.mycointainer.com/' },
};

export const defaultChartZoomOptions = {
  pan: { enabled: true, mode: 'xy' as const, overScaleMode: 'y' as const },
  zoom: {
    wheel: { enabled: true },
    mode: 'xy' as const,
    overScaleMode: 'y' as const,
  },
  limits: { y: { min: 0 } },
};

export const defaultChartOptions: ChartOptions<'line' | 'bar'> = {
  scales: {
    x: { title: { display: true, text: 'X-axis Title' } },
    y: { title: { display: true, text: 'Y-axis Title' } },
  },
  elements: {
    line: {
      borderJoinStyle: 'round' as const,
    },
  },
  // interaction: {
  //   mode: 'x',
  // },
  hover: {
    mode: 'dataset' as const,
    intersect: false,
  },
  plugins: {
    title: {
      display: true,
      text: `Chart Title`,
    },
    legend: {
      position: 'bottom' as const,
      labels: {
        usePointStyle: true,
        pointStyle: 'line',
      },
    },
    zoom: defaultChartZoomOptions,
  },
};

export const BN_MILLISECONDS_PER_SECOND = new BN(1000);
export const BN_SECONDS_PER_MINUTE = new BN(60);
export const BN_MINUTES_PER_HOUR = new BN(60);
export const BN_HOURS_PER_DAY = new BN(24);
export const BN_DAYS_PER_YEAR = new BN(365);

export const BN_MILLISECONDS_PER_MINUTE = BN_MILLISECONDS_PER_SECOND.mul(BN_SECONDS_PER_MINUTE);
export const BN_MILLISECONDS_PER_HOUR = BN_MILLISECONDS_PER_MINUTE.mul(BN_MINUTES_PER_HOUR);
export const BN_MILLISECONDS_PER_DAY = BN_MILLISECONDS_PER_HOUR.mul(BN_HOURS_PER_DAY);
export const BN_MILLISECONDS_PER_YEAR = BN_MILLISECONDS_PER_DAY.mul(BN_DAYS_PER_YEAR);
/* 
export const BN_SECONDS_PER_HOUR = BN_SECONDS_PER_MINUTE.mul(MINUTES_PER_HOUR;
export const BN_SECONDS_PER_DAY = BN_SECONDS_PER_HOUR.mul(HOURS_PER_DAY;
export const BN_SECONDS_PER_YEAR = BN_SECONDS_PER_DAY.mul(DAYS_PER_YEAR;

export const BN_MINUTES_PER_DAY = BN_MINUTES_PER_HOUR.mul(HOURS_PER_DAY;
export const BN_MINUTES_PER_YEAR = BN_MINUTES_PER_DAY.mul(DAYS_PER_YEAR;

export const BN_HOURS_PER_YEAR = BN_HOURS_PER_DAY.mul(DAYS_PER_YEAR;
 */
