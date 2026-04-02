import type { NetworkConfig } from "../types/network";
import type { ActivityItem, AddressBookEntry, TrackedToken } from "../types/wallet";

const UI_STATE_STORAGE_KEY = "web3-wallet/ui-state/v1";

export interface PersistedUiState {
  customNetworks?: NetworkConfig[];
  activeNetworkId?: string;
  customTokens?: TrackedToken[];
  recentActivity?: ActivityItem[];
  addressBook?: AddressBookEntry[];
}

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function loadPersistedUiState(): PersistedUiState {
  if (!canUseStorage()) {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(UI_STATE_STORAGE_KEY);

    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return parsed as PersistedUiState;
  } catch {
    return {};
  }
}

export function patchPersistedUiState(patch: Partial<PersistedUiState>) {
  if (!canUseStorage()) {
    return;
  }

  try {
    const current = loadPersistedUiState();
    const nextState = {
      ...current,
      ...patch,
    };

    window.localStorage.setItem(UI_STATE_STORAGE_KEY, JSON.stringify(nextState));
  } catch {
    // Ignore storage write failures to keep the wallet usable.
  }
}

export function clearPersistedUiState() {
  if (!canUseStorage()) {
    return;
  }

  try {
    window.localStorage.removeItem(UI_STATE_STORAGE_KEY);
  } catch {
    // Ignore storage cleanup failures.
  }
}
