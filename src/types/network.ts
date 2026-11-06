export type NetworkEnvironment = "mainnet" | "testnet";
export type NetworkRpcOverrides = Record<string, string>;

export interface NetworkDraft {
  name: string;
  chainId: string;
  rpcUrl: string;
  symbol: string;
  explorerUrl: string;
  environment?: NetworkEnvironment;
}

export interface NetworkConfig {
  id: string;
  source: "preset" | "custom";
  environment: NetworkEnvironment;
  name: string;
  chainId: number;
  rpcUrl: string;
  symbol: string;
  explorerUrl?: string;
  rpcCandidates?: string[];
}

export type RpcTrackingPolicy = "none" | "limited" | "yes" | "unknown";

export interface ChainlistRpcItem {
  url: string;
  tracking?: RpcTrackingPolicy;
  isOpenSource?: boolean;
}

export interface ChainlistNetworkData {
  chainId: number;
  name: string;
  chain?: string;
  rpc: ChainlistRpcItem[];
  nativeCurrency?: {
    name: string;
    symbol: string;
    decimals: number;
  };
  explorers?: Array<{
    name: string;
    url: string;
    standard?: string;
  }>;
  infoURL?: string;
  isTestnet?: boolean;
}

export interface RpcSpeedTestResult {
  url: string;
  status: "ok" | "mismatch" | "error" | "testing" | "untested";
  latencyMs: number | null;
  latestBlock: string | null;
  message?: string;
}

export interface RpcEndpointValidation {
  status: "ok" | "mismatch" | "error";
  message: string;
  expectedChainId: number;
  actualChainId: number | null;
  latestBlock: string | null;
  latencyMs: number | null;
  checkedAt: string;
}
