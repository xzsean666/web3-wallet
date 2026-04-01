export type WalletAddress = `0x${string}`;
export type WalletHex = `0x${string}`;
export type SecretKind = "mnemonic" | "privateKey";
export type WalletSource = "created" | "imported";
export type FeeMode = "legacy" | "eip1559";

export interface PendingWalletDraft {
  walletLabel: string;
  address: WalletAddress;
  isBiometricEnabled: boolean;
  source: WalletSource;
  secretKind: SecretKind;
  createdAt: string;
}

export interface WalletProfile {
  walletLabel: string;
  address: WalletAddress;
  source: WalletSource;
  secretKind: SecretKind;
  isBiometricEnabled: boolean;
  hasBackedUpMnemonic: boolean;
  createdAt: string;
  lastUnlockedAt: string | null;
}

export interface TrackedToken {
  id: string;
  symbol: string;
  name: string;
  balance: string;
  decimals: number;
  contractAddress: WalletAddress;
  networkIds: string[];
  source: "preset" | "custom";
}

export interface TokenDraft {
  networkId: string;
  name: string;
  symbol: string;
  decimals: string;
  contractAddress: string;
}

export interface ActivityItem {
  id: string;
  title: string;
  subtitle: string;
  status: "pending" | "complete" | "empty";
  txHash?: WalletHex;
  networkId?: string;
}

export type TransferAsset =
  | {
      type: "native";
    }
  | {
      type: "erc20";
      contractAddress: WalletAddress;
    };

export interface SignTransferRequest {
  password: string;
  chainId: string;
  nonce: string;
  gasLimit: string;
  recipientAddress: WalletAddress;
  amount: string;
  feeMode: FeeMode;
  gasPriceWei?: string | null;
  maxFeePerGasWei?: string | null;
  maxPriorityFeePerGasWei?: string | null;
  asset: TransferAsset;
}

export interface SignedTransferPayload {
  rawTransaction: WalletHex;
  txHash: WalletHex;
}
