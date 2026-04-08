import { invoke, isTauri } from "@tauri-apps/api/core";
import type { NetworkConfig } from "../types/network";
import type { ActivityItem, AddressBookEntry, SendDraft, TrackedToken } from "../types/wallet";

const UI_STATE_STORAGE_KEY = "web3-wallet/ui-state/v2";
const LEGACY_UI_STATE_STORAGE_KEY = "web3-wallet/ui-state/v1";
const TAURI_PENDING_STORAGE_KEY = "web3-wallet/ui-state/tauri-pending/v1";

export interface PersistedUiState {
  customNetworks?: NetworkConfig[];
  activeNetworkId?: string;
}

export interface WalletScopedUiState {
  customTokens?: TrackedToken[];
  recentActivity?: ActivityItem[];
  addressBook?: AddressBookEntry[];
  sendDraft?: SendDraft;
}

export interface PersistedUiStateEnvelope {
  global: PersistedUiState;
  walletScopes: Record<string, WalletScopedUiState>;
}

let cachedEnvelope: PersistedUiStateEnvelope | null = null;
let persistQueue = Promise.resolve();
let latestPersistRevision = 0;

function emptyEnvelope(): PersistedUiStateEnvelope {
  return {
    global: {},
    walletScopes: {},
  };
}

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readRawEnvelope() {
  if (!canUseStorage()) {
    return null;
  }

  try {
    const raw =
      window.localStorage.getItem(UI_STATE_STORAGE_KEY) ??
      window.localStorage.getItem(LEGACY_UI_STATE_STORAGE_KEY);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function extractGlobalState(value: Record<string, unknown>): PersistedUiState {
  return {
    customNetworks: Array.isArray(value.customNetworks)
      ? (value.customNetworks as NetworkConfig[])
      : undefined,
    activeNetworkId:
      typeof value.activeNetworkId === "string" ? value.activeNetworkId : undefined,
  };
}

function extractSendDraft(value: unknown): SendDraft | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  return (
    typeof value.networkId === "string" &&
    typeof value.assetId === "string" &&
    typeof value.recipientAddress === "string" &&
    typeof value.amount === "string"
  )
    ? {
        networkId: value.networkId,
        assetId: value.assetId,
        recipientAddress: value.recipientAddress,
        amount: value.amount,
      }
    : undefined;
}

function extractWalletScopedState(value: Record<string, unknown>): WalletScopedUiState {
  return {
    customTokens: Array.isArray(value.customTokens)
      ? (value.customTokens as TrackedToken[])
      : undefined,
    recentActivity: Array.isArray(value.recentActivity)
      ? (value.recentActivity as ActivityItem[])
      : undefined,
    addressBook: Array.isArray(value.addressBook)
      ? (value.addressBook as AddressBookEntry[])
      : undefined,
    sendDraft: extractSendDraft(value.sendDraft),
  };
}

function normalizeEnvelope(raw: Record<string, unknown> | null): PersistedUiStateEnvelope {
  if (!raw) {
    return emptyEnvelope();
  }

  const explicitGlobal = isPlainObject(raw.global)
    ? extractGlobalState(raw.global)
    : extractGlobalState(raw);
  const walletScopes = isPlainObject(raw.walletScopes)
    ? Object.fromEntries(
        Object.entries(raw.walletScopes)
          .filter(([, value]) => isPlainObject(value))
          .map(([accountId, value]) => [
            accountId,
            extractWalletScopedState(value as Record<string, unknown>),
          ]),
      )
    : {};

  return {
    global: explicitGlobal,
    walletScopes,
  };
}

function hasLegacyWalletScopedState(raw: Record<string, unknown> | null) {
  if (!raw) {
    return false;
  }

  return (
    Array.isArray(raw.customTokens) ||
    Array.isArray(raw.recentActivity) ||
    Array.isArray(raw.addressBook)
  );
}

function writeEnvelopeToStorage(envelope: PersistedUiStateEnvelope) {
  if (!canUseStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(UI_STATE_STORAGE_KEY, JSON.stringify(envelope));
    window.localStorage.removeItem(LEGACY_UI_STATE_STORAGE_KEY);
  } catch {
    // Ignore storage write failures to keep the wallet usable.
  }
}

function clearStorageEnvelope() {
  if (!canUseStorage()) {
    return;
  }

  try {
    window.localStorage.removeItem(UI_STATE_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_UI_STATE_STORAGE_KEY);
  } catch {
    // Ignore storage cleanup failures.
  }
}

function markTauriPendingEnvelope() {
  if (!canUseStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(TAURI_PENDING_STORAGE_KEY, "1");
  } catch {
    // Ignore marker write failures to keep the wallet usable.
  }
}

function clearTauriPendingEnvelope() {
  if (!canUseStorage()) {
    return;
  }

  try {
    window.localStorage.removeItem(TAURI_PENDING_STORAGE_KEY);
  } catch {
    // Ignore marker cleanup failures.
  }
}

function hasTauriPendingEnvelope() {
  if (!canUseStorage()) {
    return false;
  }

  try {
    return window.localStorage.getItem(TAURI_PENDING_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function envelopeHasData(envelope: PersistedUiStateEnvelope) {
  return (
    envelope.global.activeNetworkId !== undefined ||
    envelope.global.customNetworks !== undefined ||
    Object.keys(envelope.walletScopes).length > 0
  );
}

function walletScopedStateHasData(state: WalletScopedUiState) {
  return Boolean(
    state.customTokens?.length ||
      state.recentActivity?.length ||
      state.addressBook?.length ||
      state.sendDraft,
  );
}

function readCachedEnvelope() {
  if (cachedEnvelope) {
    return cachedEnvelope;
  }

  cachedEnvelope = normalizeEnvelope(readRawEnvelope());
  return cachedEnvelope;
}

function queuePersistEnvelope(envelope: PersistedUiStateEnvelope) {
  cachedEnvelope = envelope;

  writeEnvelopeToStorage(envelope);

  if (!isTauri()) {
    return;
  }

  markTauriPendingEnvelope();
  const revision = ++latestPersistRevision;
  persistQueue = persistQueue.then(async () => {
    try {
      await invoke("save_ui_state", { state: envelope });

      if (revision === latestPersistRevision) {
        clearStorageEnvelope();
        clearTauriPendingEnvelope();
      }
    } catch {
      // Keep the local backup so the next bootstrap can recover the latest UI state.
    }
  });
}

export async function bootstrapUiState() {
  const localEnvelope = normalizeEnvelope(readRawEnvelope());

  if (!isTauri()) {
    cachedEnvelope = localEnvelope;
    return;
  }

  try {
    const remoteEnvelope = normalizeEnvelope(
      (await invoke<Record<string, unknown>>("load_ui_state")) ?? null,
    );
    const hasPendingLocalBackup = hasTauriPendingEnvelope();

    if (hasPendingLocalBackup) {
      cachedEnvelope = localEnvelope;

      try {
        await invoke("save_ui_state", { state: localEnvelope });
        clearStorageEnvelope();
        clearTauriPendingEnvelope();
      } catch {
        markTauriPendingEnvelope();
      }

      return;
    }

    if (!envelopeHasData(remoteEnvelope) && envelopeHasData(localEnvelope)) {
      cachedEnvelope = localEnvelope;

      try {
        await invoke("save_ui_state", { state: localEnvelope });
        clearStorageEnvelope();
        clearTauriPendingEnvelope();
      } catch {
        markTauriPendingEnvelope();
      }

      return;
    }

    cachedEnvelope = remoteEnvelope;
    clearStorageEnvelope();
    clearTauriPendingEnvelope();
  } catch {
    cachedEnvelope = localEnvelope;
  }
}

export function loadPersistedUiState(): PersistedUiState {
  return readCachedEnvelope().global;
}

export function patchPersistedUiState(patch: Partial<PersistedUiState>) {
  const envelope = readCachedEnvelope();

  queuePersistEnvelope({
    ...envelope,
    global: {
      ...envelope.global,
      ...patch,
    },
  });
}

export function loadWalletScopedUiState(accountId: string | null | undefined): WalletScopedUiState {
  if (!accountId) {
    return {};
  }

  const envelope = readCachedEnvelope();
  const scopedState = envelope.walletScopes[accountId];

  if (scopedState) {
    return scopedState;
  }

  const rawEnvelope = readRawEnvelope();
  if (Object.keys(envelope.walletScopes).length === 0 && hasLegacyWalletScopedState(rawEnvelope)) {
    return extractWalletScopedState(rawEnvelope!);
  }

  return {};
}

export function patchWalletScopedUiState(
  accountId: string | null | undefined,
  patch: Partial<WalletScopedUiState>,
) {
  if (!accountId) {
    return;
  }

  const envelope = readCachedEnvelope();

  queuePersistEnvelope({
    ...envelope,
    walletScopes: {
      ...envelope.walletScopes,
      [accountId]: {
        ...envelope.walletScopes[accountId],
        ...patch,
      },
    },
  });
}

export function clearWalletScopedUiState(accountId: string | null | undefined) {
  if (!accountId) {
    return;
  }

  const envelope = readCachedEnvelope();
  const nextWalletScopes = { ...envelope.walletScopes };
  delete nextWalletScopes[accountId];

  queuePersistEnvelope({
    ...envelope,
    walletScopes: nextWalletScopes,
  });
}

export function clearAllWalletScopedUiState() {
  const envelope = readCachedEnvelope();

  queuePersistEnvelope({
    ...envelope,
    walletScopes: {},
  });
}

export function clearNetworkScopedUiState(networkId: string) {
  const envelope = readCachedEnvelope();
  let hasChanges = false;
  const nextWalletScopes = Object.fromEntries(
    Object.entries(envelope.walletScopes).flatMap(([accountId, scopedState]) => {
      const nextScopedState: WalletScopedUiState = {
        customTokens: scopedState.customTokens?.filter(
          (token) => !token.networkIds.includes(networkId),
        ),
        recentActivity: scopedState.recentActivity?.filter(
          (item) => item.networkId !== networkId,
        ),
        addressBook: scopedState.addressBook?.filter(
          (entry) => entry.networkId !== networkId,
        ),
        sendDraft:
          scopedState.sendDraft?.networkId === networkId
            ? undefined
            : scopedState.sendDraft,
      };

      if (
        nextScopedState.customTokens?.length !== scopedState.customTokens?.length ||
        nextScopedState.recentActivity?.length !== scopedState.recentActivity?.length ||
        nextScopedState.addressBook?.length !== scopedState.addressBook?.length ||
        nextScopedState.sendDraft !== scopedState.sendDraft
      ) {
        hasChanges = true;
      }

      return walletScopedStateHasData(nextScopedState)
        ? [[accountId, nextScopedState]]
        : [];
    }),
  );

  if (!hasChanges) {
    return;
  }

  queuePersistEnvelope({
    ...envelope,
    walletScopes: nextWalletScopes,
  });
}

export function clearPersistedUiState() {
  const nextEnvelope = emptyEnvelope();
  cachedEnvelope = nextEnvelope;

  if (!isTauri()) {
    clearStorageEnvelope();
    clearTauriPendingEnvelope();
    return;
  }

  writeEnvelopeToStorage(nextEnvelope);
  markTauriPendingEnvelope();
  const revision = ++latestPersistRevision;
  persistQueue = persistQueue.then(async () => {
    try {
      await invoke("save_ui_state", { state: nextEnvelope });

      if (revision === latestPersistRevision) {
        clearStorageEnvelope();
        clearTauriPendingEnvelope();
      }
    } catch {
      // Keep the local empty backup so the next bootstrap can retry cleanup.
    }
  });
}
