export interface NetworkDraft {
  name: string;
  chainId: string;
  rpcUrl: string;
  symbol: string;
  explorerUrl: string;
}

export interface NetworkConfig {
  id: string;
  source: "preset" | "custom";
  name: string;
  chainId: number;
  rpcUrl: string;
  symbol: string;
  explorerUrl?: string;
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
