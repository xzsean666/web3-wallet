import { invoke, isTauri } from "@tauri-apps/api/core";
import { english, generateMnemonic, mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { hashSecret } from "../utils/security";
import type {
  PendingWalletDraft,
  SecretKind,
  SignedTransferPayload,
  SignTransferRequest,
  WalletProfile,
} from "../types/wallet";

interface CreateWalletRequest {
  walletLabel: string;
  password: string;
  isBiometricEnabled: boolean;
}

interface ImportWalletRequest extends CreateWalletRequest {
  secretKind: SecretKind;
  secretValue: string;
}

interface UpdateBiometricRequest {
  isBiometricEnabled: boolean;
}

interface PreviewPendingState {
  draft: PendingWalletDraft;
  mnemonic: string;
  passwordHash: string;
}

interface PreviewState {
  pending: PreviewPendingState | null;
  passwordHash: string;
  wallet: WalletProfile | null;
}

const previewState: PreviewState = {
  pending: null,
  passwordHash: "",
  wallet: null,
};

export function isTauriWalletRuntime() {
  return isTauri();
}

export async function createWallet(request: CreateWalletRequest) {
  if (isTauriWalletRuntime()) {
    return invoke<PendingWalletDraft>("create_wallet", { request });
  }

  if (previewState.wallet) {
    throw new Error("当前钱包已存在，MVP 只支持单钱包");
  }

  const mnemonic = generateMnemonic(english);
  const account = mnemonicToAccount(mnemonic);
  const passwordHash = await hashSecret(request.password);
  const draft: PendingWalletDraft = {
    walletLabel: request.walletLabel.trim(),
    address: account.address,
    isBiometricEnabled: request.isBiometricEnabled,
    source: "created",
    secretKind: "mnemonic",
    createdAt: new Date().toISOString(),
  };

  previewState.pending = {
    draft,
    mnemonic,
    passwordHash,
  };

  return draft;
}

export async function loadPendingWalletDraft() {
  if (isTauriWalletRuntime()) {
    return invoke<PendingWalletDraft | null>("load_pending_wallet_draft");
  }

  return previewState.pending?.draft ?? null;
}

export async function getPendingBackupPhrase() {
  if (isTauriWalletRuntime()) {
    return invoke<string>("get_pending_backup_phrase");
  }

  if (!previewState.pending) {
    throw new Error("当前没有待确认的创建流程");
  }

  return previewState.pending.mnemonic;
}

export async function cancelPendingWallet() {
  if (isTauriWalletRuntime()) {
    await invoke("cancel_pending_wallet");
    return;
  }

  previewState.pending = null;
}

export async function finalizePendingWallet() {
  if (isTauriWalletRuntime()) {
    return invoke<WalletProfile>("finalize_pending_wallet");
  }

  if (!previewState.pending) {
    throw new Error("当前没有待确认的创建流程");
  }

  const nextWallet: WalletProfile = {
    ...previewState.pending.draft,
    hasBackedUpMnemonic: true,
    lastUnlockedAt: new Date().toISOString(),
  };

  previewState.wallet = nextWallet;
  previewState.passwordHash = previewState.pending.passwordHash;
  previewState.pending = null;

  return nextWallet;
}

export async function importWallet(request: ImportWalletRequest) {
  if (isTauriWalletRuntime()) {
    return invoke<WalletProfile>("import_wallet", { request });
  }

  if (previewState.wallet) {
    throw new Error("当前钱包已存在，MVP 只支持单钱包");
  }

  const account =
    request.secretKind === "mnemonic"
      ? mnemonicToAccount(request.secretValue.trim())
      : privateKeyToAccount(normalizePrivateKey(request.secretValue));

  previewState.pending = null;
  previewState.passwordHash = await hashSecret(request.password);
  previewState.wallet = {
    walletLabel: request.walletLabel.trim(),
    address: account.address,
    source: "imported",
    secretKind: request.secretKind,
    isBiometricEnabled: request.isBiometricEnabled,
    hasBackedUpMnemonic: false,
    createdAt: new Date().toISOString(),
    lastUnlockedAt: new Date().toISOString(),
  };

  return previewState.wallet;
}

export async function loadWalletProfile() {
  if (isTauriWalletRuntime()) {
    return invoke<WalletProfile | null>("load_wallet_profile");
  }

  return previewState.wallet;
}

export async function unlockWallet(password: string) {
  if (isTauriWalletRuntime()) {
    return invoke<WalletProfile | null>("unlock_wallet", { password });
  }

  if (!previewState.wallet || !previewState.passwordHash) {
    return null;
  }

  const nextHash = await hashSecret(password);

  if (nextHash !== previewState.passwordHash) {
    return null;
  }

  previewState.wallet = {
    ...previewState.wallet,
    lastUnlockedAt: new Date().toISOString(),
  };

  return previewState.wallet;
}

export async function updateBiometricSetting(request: UpdateBiometricRequest) {
  if (isTauriWalletRuntime()) {
    return invoke<WalletProfile | null>("update_biometric_setting", { request });
  }

  if (!previewState.wallet) {
    return null;
  }

  previewState.wallet = {
    ...previewState.wallet,
    isBiometricEnabled: request.isBiometricEnabled,
  };

  return previewState.wallet;
}

export async function signTransferTransaction(request: SignTransferRequest) {
  if (isTauriWalletRuntime()) {
    return invoke<SignedTransferPayload>("sign_transfer_transaction", { request });
  }

  throw new Error("浏览器预览模式不支持真实签名与广播，请使用 pnpm tauri dev");
}

function normalizePrivateKey(secret: string) {
  const normalized = secret.trim().replace(/^0x/i, "");

  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error("私钥格式不正确，需要 64 位十六进制字符串");
  }

  return `0x${normalized}` as `0x${string}`;
}
