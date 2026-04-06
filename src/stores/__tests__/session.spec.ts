import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useSessionStore } from "../session";

const {
  deleteWalletAccountMock,
  loadWalletSessionMock,
  renameWalletAccountMock,
  setActiveWalletMock,
  unlockWalletMock,
  updateBiometricSettingMock,
} = vi.hoisted(() => ({
  deleteWalletAccountMock: vi.fn(),
  loadWalletSessionMock: vi.fn(),
  renameWalletAccountMock: vi.fn(),
  setActiveWalletMock: vi.fn(),
  unlockWalletMock: vi.fn(),
  updateBiometricSettingMock: vi.fn(),
}));

vi.mock("../../services/walletBridge", () => ({
  deleteWalletAccount: deleteWalletAccountMock,
  isTauriWalletRuntime: vi.fn(() => false),
  loadWalletSession: loadWalletSessionMock,
  renameWalletAccount: renameWalletAccountMock,
  setActiveWallet: setActiveWalletMock,
  unlockWallet: unlockWalletMock,
  updateBiometricSetting: updateBiometricSettingMock,
}));

describe("session store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    deleteWalletAccountMock.mockReset();
    loadWalletSessionMock.mockReset();
    renameWalletAccountMock.mockReset();
    setActiveWalletMock.mockReset();
    unlockWalletMock.mockReset();
    updateBiometricSettingMock.mockReset();
  });

  it("bootstraps multiple wallet profiles and keeps the active account locked", async () => {
    const now = new Date().toISOString();
    loadWalletSessionMock.mockResolvedValueOnce({
      activeAccountId: "account-2",
      accounts: [
        {
          accountId: "account-1",
          derivationGroupId: "account-1",
          derivationIndex: 0,
          walletLabel: "Primary Wallet",
          address: "0x1111111111111111111111111111111111111111" as const,
          isBiometricEnabled: true,
          source: "created" as const,
          secretKind: "mnemonic" as const,
          hasBackedUpMnemonic: true,
          createdAt: now,
          lastUnlockedAt: now,
        },
        {
          accountId: "account-2",
          derivationGroupId: "account-2",
          derivationIndex: 0,
          walletLabel: "Imported Ops",
          address: "0x2222222222222222222222222222222222222222" as const,
          isBiometricEnabled: false,
          source: "imported" as const,
          secretKind: "privateKey" as const,
          hasBackedUpMnemonic: false,
          createdAt: now,
          lastUnlockedAt: null,
        },
      ],
    });

    const store = useSessionStore();
    await store.bootstrap();

    expect(store.hasWallet).toBe(true);
    expect(store.accountCount).toBe(2);
    expect(store.isUnlocked).toBe(false);
    expect(store.activeAccountId).toBe("account-2");
    expect(store.walletLabel).toBe("Imported Ops");
    expect(store.primaryAddress).toBe("0x2222222222222222222222222222222222222222");
  });

  it("switches the active wallet account and locks the session", async () => {
    const store = useSessionStore();
    const now = new Date().toISOString();

    store.applyWalletSession(
      {
        activeAccountId: "account-1",
        accounts: [
          {
            accountId: "account-1",
            derivationGroupId: "account-1",
            derivationIndex: 0,
            walletLabel: "Primary Wallet",
            address: "0x1111111111111111111111111111111111111111" as const,
            isBiometricEnabled: true,
            source: "created" as const,
            secretKind: "mnemonic" as const,
            hasBackedUpMnemonic: true,
            createdAt: now,
            lastUnlockedAt: now,
          },
          {
            accountId: "account-2",
            derivationGroupId: "account-2",
            derivationIndex: 0,
            walletLabel: "Imported Ops",
            address: "0x2222222222222222222222222222222222222222" as const,
            isBiometricEnabled: false,
            source: "imported" as const,
            secretKind: "privateKey" as const,
            hasBackedUpMnemonic: false,
            createdAt: now,
            lastUnlockedAt: null,
          },
        ],
      },
      { unlocked: true },
    );

    setActiveWalletMock.mockResolvedValueOnce({
      accountId: "account-2",
      derivationGroupId: "account-2",
      derivationIndex: 0,
      walletLabel: "Imported Ops",
      address: "0x2222222222222222222222222222222222222222" as const,
      isBiometricEnabled: false,
      source: "imported" as const,
      secretKind: "privateKey" as const,
      hasBackedUpMnemonic: false,
      createdAt: now,
      lastUnlockedAt: null,
    });

    expect(await store.selectWalletAccount("account-2", { lock: true })).toBe(true);
    expect(store.activeAccountId).toBe("account-2");
    expect(store.walletLabel).toBe("Imported Ops");
    expect(store.isUnlocked).toBe(false);
  });

  it("unlocks the currently active wallet account", async () => {
    const store = useSessionStore();
    const now = new Date().toISOString();
    const profile = {
      accountId: "account-2",
      derivationGroupId: "account-2",
      derivationIndex: 0,
      walletLabel: "Imported Ops",
      address: "0x2222222222222222222222222222222222222222" as const,
      isBiometricEnabled: false,
      source: "imported" as const,
      secretKind: "privateKey" as const,
      hasBackedUpMnemonic: false,
      createdAt: now,
      lastUnlockedAt: now,
    };

    store.applyWalletSession(
      {
        activeAccountId: "account-2",
        accounts: [profile],
      },
      { unlocked: false },
    );

    unlockWalletMock.mockResolvedValueOnce(null);
    unlockWalletMock.mockResolvedValueOnce(profile);

    expect(await store.unlockWallet("wrong-secret")).toBe(false);
    expect(await store.unlockWallet("super-secret")).toBe(true);
    expect(store.isUnlocked).toBe(true);
    expect(store.walletLabel).toBe("Imported Ops");
  });

  it("renames the selected wallet account and keeps the session unlocked", async () => {
    const store = useSessionStore();
    const now = new Date().toISOString();

    store.applyWalletSession(
      {
        activeAccountId: "account-2",
        accounts: [
          {
            accountId: "account-2",
            derivationGroupId: "account-2",
            derivationIndex: 0,
            walletLabel: "Imported Ops",
            address: "0x2222222222222222222222222222222222222222" as const,
            isBiometricEnabled: false,
            source: "imported" as const,
            secretKind: "privateKey" as const,
            hasBackedUpMnemonic: false,
            createdAt: now,
            lastUnlockedAt: now,
          },
        ],
      },
      { unlocked: true },
    );

    renameWalletAccountMock.mockResolvedValueOnce({
      accountId: "account-2",
      derivationGroupId: "account-2",
      derivationIndex: 0,
      walletLabel: 'Ops Cold Wallet',
      address: "0x2222222222222222222222222222222222222222" as const,
      isBiometricEnabled: false,
      source: "imported" as const,
      secretKind: "privateKey" as const,
      hasBackedUpMnemonic: false,
      createdAt: now,
      lastUnlockedAt: now,
    });

    expect(await store.renameWalletAccount("account-2", "Ops Cold Wallet")).toBe(true);
    expect(store.walletLabel).toBe("Ops Cold Wallet");
    expect(store.isUnlocked).toBe(true);
  });

  it("deletes the active wallet account and requires unlocking the fallback account", async () => {
    const store = useSessionStore();
    const now = new Date().toISOString();

    store.applyWalletSession(
      {
        activeAccountId: "account-1",
        accounts: [
          {
            accountId: "account-1",
            derivationGroupId: "account-1",
            derivationIndex: 0,
            walletLabel: "Primary Wallet",
            address: "0x1111111111111111111111111111111111111111" as const,
            isBiometricEnabled: true,
            source: "created" as const,
            secretKind: "mnemonic" as const,
            hasBackedUpMnemonic: true,
            createdAt: now,
            lastUnlockedAt: now,
          },
          {
            accountId: "account-2",
            derivationGroupId: "account-2",
            derivationIndex: 0,
            walletLabel: "Imported Ops",
            address: "0x2222222222222222222222222222222222222222" as const,
            isBiometricEnabled: false,
            source: "imported" as const,
            secretKind: "privateKey" as const,
            hasBackedUpMnemonic: false,
            createdAt: now,
            lastUnlockedAt: now,
          },
        ],
      },
      { unlocked: true },
    );

    deleteWalletAccountMock.mockResolvedValueOnce({
      activeAccountId: "account-2",
      accounts: [
        {
          accountId: "account-2",
          derivationGroupId: "account-2",
          derivationIndex: 0,
          walletLabel: "Imported Ops",
          address: "0x2222222222222222222222222222222222222222" as const,
          isBiometricEnabled: false,
          source: "imported" as const,
          secretKind: "privateKey" as const,
          hasBackedUpMnemonic: false,
          createdAt: now,
          lastUnlockedAt: now,
        },
      ],
    });

    expect(await store.deleteWalletAccount("account-1")).toEqual({
      ok: true,
      removedAll: false,
      requiresUnlock: true,
    });
    expect(store.activeAccountId).toBe("account-2");
    expect(store.isUnlocked).toBe(false);
    expect(store.walletLabel).toBe("Imported Ops");
  });
});
