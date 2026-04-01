import type { FeeMode, WalletAddress, WalletHex } from "./wallet";

export interface PortfolioSnapshot {
  networkId: string;
  nativeBalance: string;
  latestBlock: string | null;
  tokenBalances: Record<string, string>;
  lastSyncedAt: string | null;
  status: "idle" | "loading" | "ready" | "error";
  error: string;
}

export interface TransferPreview {
  assetType: "native" | "erc20";
  feeMode: FeeMode;
  nonce: string;
  gasLimit: string;
  gasPriceWei: string | null;
  gasPriceGwei: string | null;
  maxFeePerGasWei: string | null;
  maxFeePerGasGwei: string | null;
  maxPriorityFeePerGasWei: string | null;
  maxPriorityFeePerGasGwei: string | null;
  estimatedNetworkFee: string | null;
  parsedAmount: string;
  contractAddress?: WalletAddress;
}

export interface TransactionDetails {
  hash: WalletHex;
  from: WalletAddress;
  to: WalletAddress | null;
  nonce: string;
  value: string;
  blockNumber: string | null;
  status: "pending" | "success" | "reverted";
  gasLimit: string;
  gasPriceGwei: string | null;
  maxFeePerGasGwei: string | null;
  maxPriorityFeePerGasGwei: string | null;
  explorerUrl: string | null;
}
