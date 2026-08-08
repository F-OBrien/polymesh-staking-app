/**
 * Network endpoints, confirmed against the Polymesh developer-resources page
 * (design doc §6.2). Nothing here may be inlined elsewhere.
 *
 * v1 is mainnet-only (Q6). Testnet exists here for local development via
 * `POLYMESH_NETWORK=testnet`; there is deliberately no in-app network switcher.
 * The previous app switched network passively based on whatever the wallet
 * extension was set to, which silently invalidated the cache and re-fetched
 * everything — a correctness hazard, not a feature.
 */

export const NETWORK_NAMES = ['mainnet', 'testnet'] as const;
export type NetworkName = (typeof NETWORK_NAMES)[number];

export interface NetworkConfig {
  readonly name: NetworkName;
  readonly label: string;
  /** WebSocket RPC. These nodes are archive — see design doc §6.5. */
  readonly rpcWs: string;
  readonly rpcHttp: string;
  /** SubQuery indexer. Event-level staking history only; no era aggregates. */
  readonly indexer: string;
  readonly restApi: string;
  /** Block explorer base; always ends with a slash. */
  readonly explorer: string;
}

export const NETWORKS: Readonly<Record<NetworkName, NetworkConfig>> = {
  mainnet: {
    name: 'mainnet',
    label: 'Mainnet',
    rpcWs: 'wss://mainnet-rpc.polymesh.network/',
    rpcHttp: 'https://mainnet-rpc.polymesh.network/http',
    indexer: 'https://mainnet-graphql.polymesh.network/',
    restApi: 'https://mainnet-restapi.polymesh.network/',
    explorer: 'https://polymesh.subscan.io/',
  },
  testnet: {
    name: 'testnet',
    label: 'Testnet',
    rpcWs: 'wss://testnet-rpc.polymesh.live/',
    rpcHttp: 'https://testnet-rpc.polymesh.live/http',
    indexer: 'https://testnet-graphql.polymesh.live/',
    restApi: 'https://testnet-restapi.polymesh.live/',
    explorer: 'https://polymesh-testnet.subscan.io/',
  },
};

function isNetworkName(value: string | undefined): value is NetworkName {
  return value != null && (NETWORK_NAMES as readonly string[]).includes(value);
}

/**
 * Resolves the active network. Reads `POLYMESH_NETWORK` (pipeline, Node) or
 * `NEXT_PUBLIC_POLYMESH_NETWORK` (client, inlined at build time).
 *
 * An unrecognised value throws rather than silently falling back: pointing the
 * pipeline at the wrong chain would write mismatched data into the era chunks,
 * and that is far more expensive to notice than a failed start-up.
 */
export function resolveNetwork(): NetworkConfig {
  const raw = process.env.POLYMESH_NETWORK ?? process.env.NEXT_PUBLIC_POLYMESH_NETWORK;
  if (raw == null || raw === '') return NETWORKS.mainnet;
  if (!isNetworkName(raw)) {
    throw new Error(`Unknown network "${raw}". Expected one of: ${NETWORK_NAMES.join(', ')}.`);
  }
  return NETWORKS[raw];
}

/** Overrides the RPC endpoint (a local node, say) without changing network identity. */
export function resolveRpcUrl(network: NetworkConfig = resolveNetwork()): string {
  return process.env.POLYMESH_RPC_URL ?? network.rpcWs;
}

export function resolveIndexerUrl(network: NetworkConfig = resolveNetwork()): string {
  return process.env.POLYMESH_INDEXER_URL ?? network.indexer;
}

/** Subscan account page for an address, or `undefined` when unknown. */
export function explorerAccountUrl(
  address: string,
  network: NetworkConfig = resolveNetwork(),
): string {
  return `${network.explorer}account/${address}`;
}
