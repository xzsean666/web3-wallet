import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  clearAllWalletScopedUiState,
  clearWalletScopedUiState,
  patchWalletScopedUiState,
} from "../services/uiState";
import {
  deleteWalletAccount as deleteWalletAccountBridge,
  isTauriWalletRuntime,
  loadWalletSession,
  renameWalletAccount as renameWalletAccountBridge,
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
type DeleteWalletAccountResult = {
  ok: boolean;
  removedAll: boolean;
  requiresUnlock: boolean;
  errorMessage: string;
};

export const useSessionStore = defineStore("session", () => {
  const walletProfiles = ref<WalletProfile[]>([]);
  const activeAccountId = ref<string | null>(null);
  const isUnlocked = ref(false);
  const lastVisitedRoute = ref("/wallet");
  const lastUnlockError = ref("");
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
      clearAllWalletScopedUiState();
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
    lastUnlockError.value = "";
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
    lastUnlockError.value = "";
  }

  function clearSendDraft(accountId: string | null | undefined) {
    patchWalletScopedUiState(accountId, {
      sendDraft: undefined,
    });
  }

  async function unlockWallet(password: string) {
    if (!activeAccountId.value) {
      lastUnlockError.value = "当前没有可解锁的账号";
      return false;
    }

    let profile: WalletProfile | null = null;
    lastUnlockError.value = "";

    try {
      profile = await unlockWalletBridge({
        accountId: activeAccountId.value,
        password,
      });
    } catch (error) {
      lastUnlockError.value =
        error instanceof Error ? error.message : "当前无法解锁钱包，请稍后重试。";
      return false;
    }

    if (!profile) {
      lastUnlockError.value = "密码不正确，请重新输入";
      return false;
    }

    applyWalletProfile(profile, { unlocked: true });
    lastUnlockError.value = "";
    return true;
  }

  function lockWallet() {
    if (!hasWallet.value) {
      return;
    }

    clearSendDraft(activeAccountId.value);

    isUnlocked.value = false;
    lastUnlockError.value = "";
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

    if (!profile) {
      return false;
    }

    activeAccountId.value = accountId;
    upsertWalletProfile(profile, {
      unlocked: options.lock ? false : isUnlocked.value,
      makeActive: true,
    });
    lastUnlockError.value = "";

    if (options.lock) {
      clearSendDraft(accountId);
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

  async function renameWalletAccount(accountId: string, walletLabel: string) {
    let profile: WalletProfile | null = null;

    try {
      profile = await renameWalletAccountBridge({
        accountId,
        walletLabel,
      });
    } catch {
      return false;
    }

    if (!profile) {
      return false;
    }

    upsertWalletProfile(profile, {
      unlocked: isUnlocked.value,
      makeActive: accountId === activeAccountId.value,
    });

    return true;
  }

  async function deleteWalletAccount(
    accountId: string,
    password: string,
  ): Promise<DeleteWalletAccountResult> {
    const deletedActive = activeAccountId.value === accountId;
    let snapshot: WalletSessionSnapshot | null = null;

    try {
      snapshot = await deleteWalletAccountBridge({
        accountId,
        password,
      });
    } catch (error) {
      return {
        ok: false,
        removedAll: false,
        requiresUnlock: false,
        errorMessage: error instanceof Error ? error.message : "当前无法删除这个账号，请稍后重试。",
      };
    }

    if (!snapshot || snapshot.accounts.length === 0) {
      resetSession();
      clearWalletScopedUiState(accountId);
      clearAllWalletScopedUiState();
      return {
        ok: true,
        removedAll: true,
        requiresUnlock: false,
        errorMessage: "",
      };
    }

    clearWalletScopedUiState(accountId);
    applyWalletSession(snapshot, {
      unlocked: deletedActive ? false : isUnlocked.value,
    });

    if (deletedActive) {
      clearSendDraft(snapshot.activeAccountId ?? snapshot.accounts[0]?.accountId ?? null);
    }

    return {
      ok: true,
      removedAll: false,
      requiresUnlock: deletedActive,
      errorMessage: "",
    };
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
    lastUnlockError,
    lastUnlockedAt,
    lastVisitedRoute,
    lockWallet,
    primaryAddress,
    resetSession,
    renameWalletAccount,
    selectWalletAccount,
    setBiometricEnabled,
    shellMode,
    statusLabel,
    deleteWalletAccount,
    unlockWallet,
    updateLastVisitedRoute,
    walletLabel,
    walletProfiles,
    walletSecretKind,
    walletSource,
  };
});
