import { invoke, isTauri } from "@tauri-apps/api/core";
import { english, generateMnemonic, mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import {
  createPasswordVerifier,
  decryptSecret,
  encryptSecret,
  verifyPassword,
  type EncryptedSecretPayload,
  type PasswordVerifier,
} from "../utils/security";
import { assertPreviewSecretFlowAllowed } from "../utils/runtimeSafety";
import type {
  DeleteWalletAccountRequest,
  FinalizePendingWalletRequest,
  GetPendingBackupPhraseRequest,
  PendingWalletDraft,
  PendingWalletSession,
  PreparedTransferRequest,
  PreparedTransferSession,
  SecretKind,
  SignedTransferPayload,
  SignTransferRequest,
  WalletProfile,
  WalletSessionSnapshot,
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
  accountId: string;
  isBiometricEnabled: boolean;
}

interface RenameWalletAccountRequest {
  accountId: string;
  walletLabel: string;
}

interface UnlockWalletRequest {
  accountId: string;
  password: string;
}

interface SetActiveWalletRequest {
  accountId: string;
}

interface DeriveMnemonicAccountRequest {
  sourceAccountId: string;
  walletLabel: string;
  password: string;
}

interface PreviewPendingState {
  draft: PendingWalletDraft;
  mnemonic: string;
  encryptedMnemonic: EncryptedSecretPayload;
  passwordVerifier: PasswordVerifier;
  backupAccessToken: string;
  hasRevealedBackupPhrase: boolean;
}

interface PreviewState {
  pending: PreviewPendingState | null;
  preparedTransfers: Record<string, PreparedTransferRequest>;
  passwordVerifiers: Record<string, PasswordVerifier>;
  encryptedMnemonicSecrets: Record<string, EncryptedSecretPayload>;
  accounts: WalletProfile[];
  activeAccountId: string | null;
}

const previewState: PreviewState = {
  pending: null,
  preparedTransfers: {},
  passwordVerifiers: {},
  encryptedMnemonicSecrets: {},
  accounts: [],
  activeAccountId: null,
};
const PENDING_ONBOARDING_ERROR = "当前有一笔待完成的备份流程，请先完成或取消后再继续。";

export function isTauriWalletRuntime() {
  return isTauri();
}

function ensureNoPendingPreviewOnboarding() {
  if (previewState.pending) {
    throw new Error(PENDING_ONBOARDING_ERROR);
  }
}

export async function createWallet(request: CreateWalletRequest) {
  if (isTauriWalletRuntime()) {
    return invoke<PendingWalletSession>("create_wallet", { request });
  }

  assertPreviewSecretFlowAllowed();
  ensureNoPendingPreviewOnboarding();
  const mnemonic = generateMnemonic(english);
  const account = mnemonicToAccount(mnemonic);
  const normalizedMnemonic = normalizeMnemonicPhrase(mnemonic);
  const passwordVerifier = await createPasswordVerifier(request.password);
  const encryptedMnemonic = await encryptSecret(normalizedMnemonic, request.password);
  const backupAccessToken = generateBackupAccessToken();
  const draft: PendingWalletDraft = {
    accountId: buildAccountId(account.address),
    derivationIndex: 0,
    walletLabel: request.walletLabel.trim(),
    address: account.address,
    isBiometricEnabled: request.isBiometricEnabled,
    source: "created",
    secretKind: "mnemonic",
    createdAt: new Date().toISOString(),
  };

  previewState.pending = {
    draft,
    mnemonic: normalizedMnemonic,
    encryptedMnemonic,
    passwordVerifier,
    backupAccessToken,
    hasRevealedBackupPhrase: false,
  };

  return {
    draft,
    backupAccessToken,
  };
}

export async function loadPendingWalletSession() {
  if (isTauriWalletRuntime()) {
    return invoke<PendingWalletSession | null>("load_pending_wallet_session");
  }

  return previewState.pending
    ? {
        draft: previewState.pending.draft,
        backupAccessToken: previewState.pending.backupAccessToken,
      }
    : null;
}

export async function getPendingBackupPhrase(request: GetPendingBackupPhraseRequest) {
  if (isTauriWalletRuntime()) {
    return invoke<string>("get_pending_backup_phrase", { request });
  }

  assertPreviewSecretFlowAllowed();
  if (!previewState.pending || previewState.pending.backupAccessToken !== request.backupAccessToken) {
    throw new Error("当前没有待确认的创建流程");
  }

  const verifiedPassword = await verifyPassword(request.password, previewState.pending.passwordVerifier);

  if (!verifiedPassword) {
    throw new Error("钱包密码不正确，无法继续查看助记词");
  }

  previewState.pending.hasRevealedBackupPhrase = true;
  return previewState.pending.mnemonic;
}

export async function cancelPendingWallet() {
  if (isTauriWalletRuntime()) {
    await invoke("cancel_pending_wallet");
    return;
  }

  previewState.pending = null;
}

export async function finalizePendingWallet(request: FinalizePendingWalletRequest) {
  if (isTauriWalletRuntime()) {
    return invoke<WalletProfile>("finalize_pending_wallet", { request });
  }

  if (!previewState.pending) {
    throw new Error("当前没有待确认的创建流程");
  }

  if (previewState.pending.backupAccessToken !== request.backupAccessToken) {
    throw new Error("当前备份会话已失效，请重新创建钱包");
  }

  if (!previewState.pending.hasRevealedBackupPhrase) {
    throw new Error("请先查看助记词，再完成备份确认");
  }

  if (!request.confirmedBackup) {
    throw new Error("你必须确认已经离线备份助记词");
  }

  const nextWallet: WalletProfile = {
    ...previewState.pending.draft,
    derivationGroupId: previewState.pending.draft.accountId,
    hasBackedUpMnemonic: true,
    lastUnlockedAt: new Date().toISOString(),
  };

  upsertPreviewAccount(nextWallet);
  previewState.passwordVerifiers[nextWallet.accountId] = previewState.pending.passwordVerifier;
  previewState.encryptedMnemonicSecrets[nextWallet.accountId] = previewState.pending.encryptedMnemonic;
  previewState.activeAccountId = nextWallet.accountId;
  previewState.pending = null;

  return nextWallet;
}

export async function importWallet(request: ImportWalletRequest) {
  if (isTauriWalletRuntime()) {
    return invoke<WalletProfile>("import_wallet", { request });
  }

  assertPreviewSecretFlowAllowed();
  ensureNoPendingPreviewOnboarding();
  const account =
    request.secretKind === "mnemonic"
      ? mnemonicToAccount(normalizeMnemonicPhrase(request.secretValue))
      : privateKeyToAccount(normalizePrivateKey(request.secretValue));

  ensurePreviewAddressIsUnique(account.address);

  const profile: WalletProfile = {
    accountId: buildAccountId(account.address),
    derivationGroupId: buildAccountId(account.address),
    derivationIndex: 0,
    walletLabel: request.walletLabel.trim(),
    address: account.address,
    source: "imported",
    secretKind: request.secretKind,
    isBiometricEnabled: request.isBiometricEnabled,
    hasBackedUpMnemonic: false,
    createdAt: new Date().toISOString(),
    lastUnlockedAt: new Date().toISOString(),
  };
  previewState.passwordVerifiers[profile.accountId] = await createPasswordVerifier(request.password);
  if (request.secretKind === "mnemonic") {
    previewState.encryptedMnemonicSecrets[profile.accountId] = await encryptSecret(
      normalizeMnemonicPhrase(request.secretValue),
      request.password,
    );
  }
  upsertPreviewAccount(profile);
  previewState.activeAccountId = profile.accountId;

  return profile;
}

export async function deriveMnemonicAccount(request: DeriveMnemonicAccountRequest) {
  if (isTauriWalletRuntime()) {
    return invoke<WalletProfile>("derive_mnemonic_account", { request });
  }

  const sourceAccount = previewState.accounts.find((entry) => entry.accountId === request.sourceAccountId);

  if (!sourceAccount) {
    throw new Error("当前找不到要派生的账号");
  }

  if (sourceAccount.secretKind !== "mnemonic") {
    throw new Error("只有助记词账号支持派生新地址");
  }

  const storedVerifier = previewState.passwordVerifiers[sourceAccount.accountId];
  const encryptedMnemonic = previewState.encryptedMnemonicSecrets[sourceAccount.accountId];

  if (!storedVerifier || !encryptedMnemonic) {
    throw new Error("当前助记词账号缺少可派生的本地恢复材料");
  }

  const verifiedPassword = await verifyPassword(request.password, storedVerifier);

  if (!verifiedPassword) {
    throw new Error("钱包密码不正确，无法继续派生地址");
  }

  const mnemonic = await decryptSecret(encryptedMnemonic, request.password);
  const nextDerivationIndex = getNextPreviewMnemonicDerivationIndex(
    sourceAccount.derivationGroupId,
  );
  const nextAccount = mnemonicToAccount(mnemonic, {
    addressIndex: nextDerivationIndex,
  });

  ensurePreviewAddressIsUnique(nextAccount.address);

  const nextProfile: WalletProfile = {
    accountId: buildAccountId(nextAccount.address),
    derivationGroupId: sourceAccount.derivationGroupId,
    derivationIndex: nextDerivationIndex,
    walletLabel: request.walletLabel.trim(),
    address: nextAccount.address,
    source: sourceAccount.source,
    secretKind: "mnemonic",
    isBiometricEnabled: sourceAccount.isBiometricEnabled,
    hasBackedUpMnemonic: sourceAccount.hasBackedUpMnemonic,
    createdAt: new Date().toISOString(),
    lastUnlockedAt: new Date().toISOString(),
  };

  upsertPreviewAccount(nextProfile);
  previewState.passwordVerifiers[nextProfile.accountId] = storedVerifier;
  previewState.encryptedMnemonicSecrets[nextProfile.accountId] = encryptedMnemonic;
  previewState.activeAccountId = nextProfile.accountId;

  return nextProfile;
}

export async function loadWalletSession() {
  if (isTauriWalletRuntime()) {
    return invoke<WalletSessionSnapshot>("load_wallet_session");
  }

  return createPreviewSessionSnapshot();
}

export async function loadWalletProfile() {
  const snapshot = await loadWalletSession();
  return (
    snapshot.accounts.find((account) => account.accountId === snapshot.activeAccountId) ??
    snapshot.accounts[0] ??
    null
  );
}

export async function unlockWallet(request: UnlockWalletRequest) {
  if (isTauriWalletRuntime()) {
    return invoke<WalletProfile | null>("unlock_wallet", { request });
  }

  const account = previewState.accounts.find((entry) => entry.accountId === request.accountId);
  const storedVerifier = previewState.passwordVerifiers[request.accountId];

  if (!account || !storedVerifier) {
    return null;
  }

  const verifiedPassword = await verifyPassword(request.password, storedVerifier);

  if (!verifiedPassword) {
    return null;
  }

  const nextProfile: WalletProfile = {
    ...account,
    lastUnlockedAt: new Date().toISOString(),
  };

  upsertPreviewAccount(nextProfile);
  previewState.activeAccountId = nextProfile.accountId;

  return nextProfile;
}

export async function setActiveWallet(request: SetActiveWalletRequest) {
  if (isTauriWalletRuntime()) {
    return invoke<WalletProfile | null>("set_active_wallet", { request });
  }

  const account = previewState.accounts.find((entry) => entry.accountId === request.accountId) ?? null;

  if (!account) {
    return null;
  }

  previewState.activeAccountId = account.accountId;
  return account;
}

export async function updateBiometricSetting(request: UpdateBiometricRequest) {
  if (isTauriWalletRuntime()) {
    return invoke<WalletProfile | null>("update_biometric_setting", { request });
  }

  const account = previewState.accounts.find((entry) => entry.accountId === request.accountId);

  if (!account) {
    return null;
  }

  const nextProfile: WalletProfile = {
    ...account,
    isBiometricEnabled: request.isBiometricEnabled,
  };

  upsertPreviewAccount(nextProfile);
  return nextProfile;
}

export async function renameWalletAccount(request: RenameWalletAccountRequest) {
  if (isTauriWalletRuntime()) {
    return invoke<WalletProfile | null>("rename_wallet_account", { request });
  }

  const account = previewState.accounts.find((entry) => entry.accountId === request.accountId);
  const nextLabel = request.walletLabel.trim();

  if (!account) {
    return null;
  }

  if (!nextLabel) {
    throw new Error("钱包名称不能为空");
  }

  const nextProfile: WalletProfile = {
    ...account,
    walletLabel: nextLabel,
  };

  upsertPreviewAccount(nextProfile);
  return nextProfile;
}

export async function deleteWalletAccount(request: DeleteWalletAccountRequest) {
  if (isTauriWalletRuntime()) {
    return invoke<WalletSessionSnapshot>("delete_wallet_account", { request });
  }

  const account = previewState.accounts.find((entry) => entry.accountId === request.accountId);
  const storedVerifier = previewState.passwordVerifiers[request.accountId];

  if (!account || !storedVerifier) {
    throw new Error("当前找不到要操作的账号");
  }

  const verifiedPassword = await verifyPassword(request.password, storedVerifier);

  if (!verifiedPassword) {
    throw new Error("钱包密码不正确，无法删除当前账号");
  }

  previewState.accounts = previewState.accounts.filter((entry) => entry.accountId !== request.accountId);
  delete previewState.passwordVerifiers[request.accountId];
  delete previewState.encryptedMnemonicSecrets[request.accountId];

  if (previewState.activeAccountId === request.accountId) {
    previewState.activeAccountId = previewState.accounts[0]?.accountId ?? null;
  }

  return createPreviewSessionSnapshot();
}

export async function prepareTransferConfirmation(request: PreparedTransferRequest) {
  if (isTauriWalletRuntime()) {
    return invoke<PreparedTransferSession>("prepare_transfer_confirmation", { request });
  }

  const confirmationId = generateBackupAccessToken();
  previewState.preparedTransfers[confirmationId] = { ...request };

  return {
    confirmationId,
  };
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

function normalizeMnemonicPhrase(secret: string) {
  return secret.trim().split(/\s+/).join(" ");
}

function buildAccountId(address: `0x${string}`) {
  return `account-${address.toLowerCase()}`;
}

function ensurePreviewAddressIsUnique(address: `0x${string}`) {
  if (previewState.accounts.some((entry) => entry.address.toLowerCase() === address.toLowerCase())) {
    throw new Error("当前地址已经存在于账号列表");
  }
}

function upsertPreviewAccount(profile: WalletProfile) {
  const existingIndex = previewState.accounts.findIndex((entry) => entry.accountId === profile.accountId);

  if (existingIndex === -1) {
    previewState.accounts = [profile, ...previewState.accounts];
    return;
  }

  previewState.accounts = previewState.accounts.map((entry) =>
    entry.accountId === profile.accountId ? profile : entry,
  );
}

function getNextPreviewMnemonicDerivationIndex(derivationGroupId: string) {
  const relatedAccounts = previewState.accounts.filter(
    (entry) =>
      entry.secretKind === "mnemonic" &&
      entry.derivationGroupId === derivationGroupId,
  );

  const currentMaxIndex = relatedAccounts.reduce(
    (maxValue, entry) => Math.max(maxValue, entry.derivationIndex ?? 0),
    0,
  );

  return currentMaxIndex + 1;
}

function createPreviewSessionSnapshot(): WalletSessionSnapshot {
  const activeAccountId =
    previewState.activeAccountId ??
    previewState.accounts[0]?.accountId ??
    null;

  return {
    accounts: [...previewState.accounts],
    activeAccountId,
  };
}

function generateBackupAccessToken() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const randomBytes = new Uint8Array(16);
    crypto.getRandomValues(randomBytes);
    return Array.from(randomBytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }

  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}
