export type WalletAddress = `0x${string}`;
export type WalletHex = `0x${string}`;
export type SecretKind = "mnemonic" | "privateKey";
export type WalletSource = "created" | "imported";
export type FeeMode = "legacy" | "eip1559";

export interface PendingWalletDraft {
  accountId: string;
  derivationIndex: number;
  walletLabel: string;
  address: WalletAddress;
  isBiometricEnabled: boolean;
  source: WalletSource;
  secretKind: SecretKind;
  createdAt: string;
}

export interface PendingWalletSession {
  draft: PendingWalletDraft;
  backupAccessToken: string;
}

export interface WalletProfile {
  accountId: string;
  derivationGroupId: string;
  derivationIndex: number;
  walletLabel: string;
  address: WalletAddress;
  source: WalletSource;
  secretKind: SecretKind;
  isBiometricEnabled: boolean;
  hasBackedUpMnemonic: boolean;
  createdAt: string;
  lastUnlockedAt: string | null;
}

export interface WalletSessionSnapshot {
  accounts: WalletProfile[];
  activeAccountId: string | null;
}

export interface GetPendingBackupPhraseRequest {
  backupAccessToken: string;
  password: string;
}

export interface FinalizePendingWalletRequest {
  backupAccessToken: string;
  confirmedBackup: boolean;
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

export interface AddressBookDraft {
  networkId: string;
  label: string;
  address: string;
  note: string;
}

export interface SendDraft {
  networkId: string;
  assetId: string;
  recipientAddress: string;
  amount: string;
}

export interface AddressBookEntry {
  id: string;
  networkId: string;
  label: string;
  address: WalletAddress;
  note: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
}

export interface ActivityItem {
  id: string;
  title: string;
  subtitle: string;
  status: "pending" | "complete" | "reverted" | "empty";
  accountId?: string;
  accountAddress?: WalletAddress;
  txHash?: WalletHex;
  networkId?: string;
  assetId?: string;
  assetType?: "native" | "erc20";
  assetSymbol?: string;
  amount?: string;
  recipientAddress?: WalletAddress;
  createdAt?: string;
}

export interface DeleteWalletAccountRequest {
  accountId: string;
  password: string;
}

export type TransferAsset =
  | {
      type: "native";
    }
  | {
      type: "erc20";
      contractAddress: WalletAddress;
    };

export interface PreparedTransferRequest {
  accountId: string;
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

export interface PreparedTransferSession {
  confirmationId: string;
}

export interface SignTransferRequest {
  accountId: string;
  password: string;
  confirmationId: string;
}

export interface SignedTransferPayload {
  rawTransaction: WalletHex;
  txHash: WalletHex;
}
