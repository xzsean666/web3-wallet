import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { loadPendingWalletDraft } from "../services/walletBridge";
import type { PendingWalletDraft, SecretKind, WalletAddress, WalletSource } from "../types/wallet";

export const useOnboardingStore = defineStore("onboarding", () => {
  const internalDraft = ref<PendingWalletDraft | null>(null);

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

  function stageDraft(draft: PendingWalletDraft) {
    internalDraft.value = draft;
  }

  function clearDraft() {
    internalDraft.value = null;
  }

  async function bootstrap() {
    try {
      internalDraft.value = await loadPendingWalletDraft();
    } catch {
      internalDraft.value = null;
    }
  }

  return {
    bootstrap,
    clearDraft,
    hasPendingBackup,
    hasPendingDraft,
    pendingAddress,
    pendingLabel,
    pendingSecretKind,
    pendingSource,
    stageDraft,
  };
});
