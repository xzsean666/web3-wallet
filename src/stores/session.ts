import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  isTauriWalletRuntime,
  loadWalletSession,
  setActiveWallet as setActiveWalletBridge,
  unlockWallet as unlockWalletBridge,
  updateBiometricSetting,
} from "../services/walletBridge";
import type {
  SecretKind,
  WalletAddress,
  WalletProfile,
  WalletSource,
  WalletSessionSnapshot,
} from "../types/wallet";

type ShellMode = "browser-preview" | "tauri";

export const useSessionStore = defineStore("session", () => {
  const walletProfiles = ref<WalletProfile[]>([]);
  const activeAccountId = ref<string | null>(null);
  const isUnlocked = ref(false);
  const lastVisitedRoute = ref("/wallet");
  const shellMode = ref<ShellMode>("browser-preview");

  const hasWallet = computed(() => walletProfiles.value.length > 0);
  const accountCount = computed(() => walletProfiles.value.length);
  const activeWalletProfile = computed(() => {
    if (walletProfiles.value.length === 0) {
      return null;
    }

    return (
      walletProfiles.value.find((profile) => profile.accountId === activeAccountId.value) ??
      walletProfiles.value[0] ??
      null
    );
  });
  const walletLabel = computed(() => activeWalletProfile.value?.walletLabel ?? "");
  const primaryAddress = computed<WalletAddress | "">(() => activeWalletProfile.value?.address ?? "");
  const walletSource = computed<WalletSource | null>(() => activeWalletProfile.value?.source ?? null);
  const walletSecretKind = computed<SecretKind | null>(() => activeWalletProfile.value?.secretKind ?? null);
  const isBiometricEnabled = computed(() => activeWalletProfile.value?.isBiometricEnabled ?? false);
  const hasBackedUpMnemonic = computed(() => activeWalletProfile.value?.hasBackedUpMnemonic ?? false);
  const createdAt = computed(() => activeWalletProfile.value?.createdAt ?? null);
  const lastUnlockedAt = computed(() => activeWalletProfile.value?.lastUnlockedAt ?? null);
  const statusLabel = computed(() => {
    if (!hasWallet.value) {
      return "No wallet";
    }

    return isUnlocked.value ? "Unlocked" : "Locked";
  });

  async function bootstrap() {
    shellMode.value = isTauriWalletRuntime() ? "tauri" : "browser-preview";
    let snapshot: WalletSessionSnapshot | null = null;

    try {
      snapshot = await loadWalletSession();
    } catch {
      resetSession();
      return;
    }

    if (!snapshot || snapshot.accounts.length === 0) {
      resetSession();
      shellMode.value = isTauriWalletRuntime() ? "tauri" : "browser-preview";
      return;
    }

    applyWalletSession(snapshot, { unlocked: false });
  }

  function applyWalletSession(
    snapshot: WalletSessionSnapshot,
    options: {
      unlocked: boolean;
    },
  ) {
    walletProfiles.value = [...snapshot.accounts];
    activeAccountId.value = snapshot.activeAccountId ?? snapshot.accounts[0]?.accountId ?? null;
    isUnlocked.value = options.unlocked;
  }

  function upsertWalletProfile(
    profile: WalletProfile,
    options: {
      unlocked: boolean;
      makeActive?: boolean;
    },
  ) {
    const hasExisting = walletProfiles.value.some((entry) => entry.accountId === profile.accountId);

    walletProfiles.value = hasExisting
      ? walletProfiles.value.map((entry) => (entry.accountId === profile.accountId ? profile : entry))
      : [profile, ...walletProfiles.value];

    if (options.makeActive || !activeAccountId.value) {
      activeAccountId.value = profile.accountId;
    }

    isUnlocked.value = options.unlocked;
  }

  function applyWalletProfile(
    profile: WalletProfile,
    options: {
      unlocked: boolean;
    },
  ) {
    upsertWalletProfile(profile, {
      unlocked: options.unlocked,
      makeActive: true,
    });
  }

  function resetSession() {
    walletProfiles.value = [];
    activeAccountId.value = null;
    isUnlocked.value = false;
  }

  async function unlockWallet(password: string) {
    if (!activeAccountId.value) {
      return false;
    }

    let profile: WalletProfile | null = null;

    try {
      profile = await unlockWalletBridge({
        accountId: activeAccountId.value,
        password,
      });
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

  async function selectWalletAccount(
    accountId: string,
    options: {
      lock?: boolean;
    } = {},
  ) {
    const matchedProfile = walletProfiles.value.find((profile) => profile.accountId === accountId);

    if (!matchedProfile) {
      return false;
    }

    let profile: WalletProfile | null = null;

    try {
      profile = await setActiveWalletBridge({
        accountId,
      });
    } catch {
      return false;
    }

    activeAccountId.value = accountId;

    if (profile) {
      upsertWalletProfile(profile, {
        unlocked: options.lock ? false : isUnlocked.value,
        makeActive: true,
      });
    } else {
      if (options.lock) {
        isUnlocked.value = false;
      }
    }

    if (options.lock) {
      isUnlocked.value = false;
    }

    return true;
  }

  async function setBiometricEnabled(nextValue: boolean) {
    if (!activeAccountId.value) {
      return false;
    }

    let profile: WalletProfile | null = null;

    try {
      profile = await updateBiometricSetting({
        accountId: activeAccountId.value,
        isBiometricEnabled: nextValue,
      });
    } catch {
      return false;
    }

    if (!profile) {
      return false;
    }

    upsertWalletProfile(profile, {
      unlocked: isUnlocked.value,
      makeActive: true,
    });
    return true;
  }

  function updateLastVisitedRoute(route: string) {
    if (route.startsWith("/wallet") || route.startsWith("/settings")) {
      lastVisitedRoute.value = route;
    }
  }

  return {
    accountCount,
    activeAccountId,
    activeWalletProfile,
    applyWalletProfile,
    applyWalletSession,
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
    selectWalletAccount,
    setBiometricEnabled,
    shellMode,
    statusLabel,
    unlockWallet,
    updateLastVisitedRoute,
    walletLabel,
    walletProfiles,
    walletSecretKind,
    walletSource,
  };
});
