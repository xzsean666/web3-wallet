import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { loadPendingWalletDraft } from "../services/walletBridge";
import type { PendingWalletDraft, SecretKind, WalletAddress, WalletSource } from "../types/wallet";

const BACKUP_TOKEN_STORAGE_KEY = "web3-wallet/onboarding/backup-token/v1";

function canUseSessionStorage() {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
}

function readPersistedBackupAccessToken() {
  if (!canUseSessionStorage()) {
    return null;
  }

  try {
    const value = window.sessionStorage.getItem(BACKUP_TOKEN_STORAGE_KEY);
    return value?.trim() || null;
  } catch {
    return null;
  }
}

function persistBackupAccessToken(value: string | null) {
  if (!canUseSessionStorage()) {
    return;
  }

  try {
    if (value) {
      window.sessionStorage.setItem(BACKUP_TOKEN_STORAGE_KEY, value);
    } else {
      window.sessionStorage.removeItem(BACKUP_TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage failures to avoid blocking wallet flows.
  }
}

export const useOnboardingStore = defineStore("onboarding", () => {
  const internalDraft = ref<PendingWalletDraft | null>(null);
  const backupAccessToken = ref<string | null>(null);

  const hasPendingDraft = computed(() => internalDraft.value !== null);
  const hasPendingBackup = computed(
    () =>
      internalDraft.value?.source === "created" &&
      internalDraft.value.secretKind === "mnemonic",
  );
  const pendingAddress = computed<WalletAddress | "">(
    () => internalDraft.value?.address ?? "",
  );
  const pendingLabel = computed(() => internalDraft.value?.walletLabel ?? "");
  const pendingSecretKind = computed<SecretKind | null>(
    () => internalDraft.value?.secretKind ?? null,
  );
  const pendingSource = computed<WalletSource | null>(
    () => internalDraft.value?.source ?? null,
  );

  function stageDraft(options: {
    draft: PendingWalletDraft;
    backupAccessToken: string;
  }) {
    backupAccessToken.value = options.backupAccessToken;
    internalDraft.value = options.draft;
    persistBackupAccessToken(options.backupAccessToken);
  }

  function setDraftFromBootstrap(draft: PendingWalletDraft | null) {
    backupAccessToken.value = draft ? readPersistedBackupAccessToken() : null;
    internalDraft.value = draft;
    persistBackupAccessToken(backupAccessToken.value);
  }

  function clearDraft() {
    backupAccessToken.value = null;
    internalDraft.value = null;
    persistBackupAccessToken(null);
  }

  async function bootstrap() {
    try {
      setDraftFromBootstrap(await loadPendingWalletDraft());
    } catch {
      setDraftFromBootstrap(null);
    }
  }

  return {
    backupAccessToken,
    bootstrap,
    clearDraft,
    hasPendingBackup,
    hasPendingDraft,
    pendingAddress,
    pendingLabel,
    pendingSecretKind,
    pendingSource,
    setDraftFromBootstrap,
    stageDraft,
  };
});
