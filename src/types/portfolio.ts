import type { FeeMode, WalletAddress, WalletHex } from "./wallet";

export interface PortfolioSnapshot {
  networkId: string;
  accountAddress: WalletAddress | null;
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

export interface TransactionSummary {
  kind: "native-transfer" | "erc20-transfer" | "contract-call";
  label: string;
  method: string | null;
  amount: string | null;
  symbol: string | null;
  assetName: string | null;
  recipientAddress: WalletAddress | null;
  contractAddress: WalletAddress | null;
}

export interface TransferErrorFeedback {
  stage: "estimate" | "sign" | "broadcast";
  category:
    | "funds"
    | "nonce"
    | "fee"
    | "gas"
    | "revert"
    | "rpc"
    | "signing"
    | "unknown";
  title: string;
  message: string;
  hints: string[];
}

export interface TransactionDetails {
  hash: WalletHex;
  from: WalletAddress;
  to: WalletAddress | null;
  nonce: string;
  value: string;
  blockNumber: string | null;
  confirmedAt: string | null;
  status: "pending" | "success" | "reverted";
  gasLimit: string;
  gasUsed: string | null;
  gasPriceGwei: string | null;
  effectiveGasPriceGwei: string | null;
  maxFeePerGasGwei: string | null;
  maxPriorityFeePerGasGwei: string | null;
  actualNetworkFee: string | null;
  explorerUrl: string | null;
  summary: TransactionSummary;
}
