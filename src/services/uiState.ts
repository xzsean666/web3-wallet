import type { NetworkConfig } from "../types/network";
import type { ActivityItem, AddressBookEntry, TrackedToken } from "../types/wallet";

const UI_STATE_STORAGE_KEY = "web3-wallet/ui-state/v2";
const LEGACY_UI_STATE_STORAGE_KEY = "web3-wallet/ui-state/v1";

export interface PersistedUiState {
  customNetworks?: NetworkConfig[];
  activeNetworkId?: string;
}

export interface WalletScopedUiState {
  customTokens?: TrackedToken[];
  recentActivity?: ActivityItem[];
  addressBook?: AddressBookEntry[];
}

interface PersistedUiStateEnvelope {
  global: PersistedUiState;
  walletScopes: Record<string, WalletScopedUiState>;
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
  };
}

function normalizeEnvelope(raw: Record<string, unknown> | null): PersistedUiStateEnvelope {
  if (!raw) {
    return {
      global: {},
      walletScopes: {},
    };
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

function writeEnvelope(envelope: PersistedUiStateEnvelope) {
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

export function loadPersistedUiState(): PersistedUiState {
  return normalizeEnvelope(readRawEnvelope()).global;
}

export function patchPersistedUiState(patch: Partial<PersistedUiState>) {
  const envelope = normalizeEnvelope(readRawEnvelope());

  writeEnvelope({
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

  const rawEnvelope = readRawEnvelope();
  const envelope = normalizeEnvelope(rawEnvelope);
  const scopedState = envelope.walletScopes[accountId];

  if (scopedState) {
    return scopedState;
  }

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

  const envelope = normalizeEnvelope(readRawEnvelope());

  writeEnvelope({
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

  const envelope = normalizeEnvelope(readRawEnvelope());
  const nextWalletScopes = { ...envelope.walletScopes };
  delete nextWalletScopes[accountId];

  writeEnvelope({
    ...envelope,
    walletScopes: nextWalletScopes,
  });
}

export function clearAllWalletScopedUiState() {
  const envelope = normalizeEnvelope(readRawEnvelope());

  writeEnvelope({
    ...envelope,
    walletScopes: {},
  });
}

export function clearPersistedUiState() {
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
