import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  isTauriWalletRuntime,
  loadWalletProfile,
  unlockWallet as unlockWalletBridge,
  updateBiometricSetting,
} from "../services/walletBridge";
import type {
  SecretKind,
  WalletAddress,
  WalletProfile,
  WalletSource,
} from "../types/wallet";

type ShellMode = "browser-preview" | "tauri";

export const useSessionStore = defineStore("session", () => {
  const hasWallet = ref(false);
  const isUnlocked = ref(false);
  const walletLabel = ref("");
  const primaryAddress = ref<WalletAddress | "">("");
  const walletSource = ref<WalletSource | null>(null);
  const walletSecretKind = ref<SecretKind | null>(null);
  const isBiometricEnabled = ref(false);
  const hasBackedUpMnemonic = ref(false);
  const createdAt = ref<string | null>(null);
  const lastUnlockedAt = ref<string | null>(null);
  const lastVisitedRoute = ref("/wallet");
  const shellMode = ref<ShellMode>("browser-preview");

  const statusLabel = computed(() => {
    if (!hasWallet.value) {
      return "No wallet";
    }

    return isUnlocked.value ? "Unlocked" : "Locked";
  });

  async function bootstrap() {
    shellMode.value = isTauriWalletRuntime() ? "tauri" : "browser-preview";
    let profile: WalletProfile | null = null;

    try {
      profile = await loadWalletProfile();
    } catch {
      resetSession();
      return;
    }

    if (!profile) {
      resetSession();
      shellMode.value = isTauriWalletRuntime() ? "tauri" : "browser-preview";
      return;
    }

    applyWalletProfile(profile, { unlocked: false });
  }

  function applyWalletProfile(
    profile: WalletProfile,
    options: {
      unlocked: boolean;
    },
  ) {
    hasWallet.value = true;
    isUnlocked.value = options.unlocked;
    walletLabel.value = profile.walletLabel;
    primaryAddress.value = profile.address;
    walletSource.value = profile.source;
    walletSecretKind.value = profile.secretKind;
    isBiometricEnabled.value = profile.isBiometricEnabled;
    hasBackedUpMnemonic.value = profile.hasBackedUpMnemonic;
    createdAt.value = profile.createdAt;
    lastUnlockedAt.value = profile.lastUnlockedAt;
  }

  function resetSession() {
    hasWallet.value = false;
    isUnlocked.value = false;
    walletLabel.value = "";
    primaryAddress.value = "";
    walletSource.value = null;
    walletSecretKind.value = null;
    isBiometricEnabled.value = false;
    hasBackedUpMnemonic.value = false;
    createdAt.value = null;
    lastUnlockedAt.value = null;
  }

  async function unlockWallet(password: string) {
    let profile: WalletProfile | null = null;

    try {
      profile = await unlockWalletBridge(password);
    } catch {
      return false;
    }

    if (!profile) {
      return false;
    }

    applyWalletProfile(profile, { unlocked: true });
    return true;
  }

  function lockWallet() {
    if (!hasWallet.value) {
      return;
    }

    isUnlocked.value = false;
  }

  async function setBiometricEnabled(nextValue: boolean) {
    let profile: WalletProfile | null = null;

    try {
      profile = await updateBiometricSetting({
        isBiometricEnabled: nextValue,
      });
    } catch {
      return false;
    }

    if (!profile) {
      return false;
    }

    applyWalletProfile(profile, { unlocked: isUnlocked.value });
    return true;
  }

  function updateLastVisitedRoute(route: string) {
    if (route.startsWith("/wallet") || route.startsWith("/settings")) {
      lastVisitedRoute.value = route;
    }
  }

  return {
    applyWalletProfile,
    bootstrap,
    createdAt,
    hasBackedUpMnemonic,
    hasWallet,
    isBiometricEnabled,
    isUnlocked,
    lastUnlockedAt,
    lastVisitedRoute,
    lockWallet,
    primaryAddress,
    resetSession,
    setBiometricEnabled,
    shellMode,
    statusLabel,
    unlockWallet,
    updateLastVisitedRoute,
    walletLabel,
    walletSecretKind,
    walletSource,
  };
});
