import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, isTauriMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  isTauriMock: vi.fn(() => false),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  isTauri: isTauriMock,
}));

async function loadWalletBridge() {
  vi.resetModules();
  return import("../walletBridge");
}

describe("walletBridge", () => {
  beforeEach(() => {
    vi.resetModules();
    invokeMock.mockReset();
    isTauriMock.mockReset();
    isTauriMock.mockReturnValue(false);
  });

  it("creates a preview backup session that requires an access token to finalize", async () => {
    const walletBridge = await loadWalletBridge();

    const pendingSession = await walletBridge.createWallet({
      walletLabel: "Primary Wallet",
      password: "super-secret",
      isBiometricEnabled: true,
    });

    expect(pendingSession.draft.walletLabel).toBe("Primary Wallet");
    expect(pendingSession.backupAccessToken).toBeTruthy();

    await expect(
      walletBridge.finalizePendingWallet({
        backupAccessToken: pendingSession.backupAccessToken,
        confirmedBackup: true,
      }),
    ).rejects.toThrow("请先查看助记词");

    const phrase = await walletBridge.getPendingBackupPhrase(pendingSession.backupAccessToken);
    expect(phrase.split(" ")).toHaveLength(12);

    const profile = await walletBridge.finalizePendingWallet({
      backupAccessToken: pendingSession.backupAccessToken,
      confirmedBackup: true,
    });

    expect(profile.hasBackedUpMnemonic).toBe(true);
  });

  it("keeps the same derivation group and allocates the next free index", async () => {
    const walletBridge = await loadWalletBridge();

    const imported = await walletBridge.importWallet({
      walletLabel: "Seed Root",
      password: "super-secret",
      isBiometricEnabled: false,
      secretKind: "mnemonic",
      secretValue: "test test test test test test test test test test test junk",
    });

    const firstDerived = await walletBridge.deriveMnemonicAccount({
      sourceAccountId: imported.accountId,
      walletLabel: "Seed / 1",
      password: "super-secret",
    });

    const secondDerived = await walletBridge.deriveMnemonicAccount({
      sourceAccountId: imported.accountId,
      walletLabel: "Seed / 2",
      password: "super-secret",
    });

    expect(imported.derivationGroupId).toBe(imported.accountId);
    expect(firstDerived.derivationGroupId).toBe(imported.derivationGroupId);
    expect(secondDerived.derivationGroupId).toBe(imported.derivationGroupId);
    expect(firstDerived.derivationIndex).toBe(1);
    expect(secondDerived.derivationIndex).toBe(2);

    const session = await walletBridge.loadWalletSession();
    expect(session.activeAccountId).toBe(secondDerived.accountId);
    expect(session.accounts.map((account) => account.derivationIndex)).toEqual([2, 1, 0]);
  });

  it("requires the correct password before deleting preview accounts", async () => {
    const walletBridge = await loadWalletBridge();

    const firstAccount = await walletBridge.importWallet({
      walletLabel: "Seed Root",
      password: "super-secret",
      isBiometricEnabled: false,
      secretKind: "mnemonic",
      secretValue: "test test test test test test test test test test test junk",
    });

    const secondAccount = await walletBridge.importWallet({
      walletLabel: "Ops Key",
      password: "super-secret",
      isBiometricEnabled: false,
      secretKind: "privateKey",
      secretValue: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });

    await expect(
      walletBridge.deleteWalletAccount({
        accountId: secondAccount.accountId,
        password: "wrong-secret",
      }),
    ).rejects.toThrow("钱包密码不正确");

    const sessionAfterDelete = await walletBridge.deleteWalletAccount({
      accountId: secondAccount.accountId,
      password: "super-secret",
    });

    expect(sessionAfterDelete.accounts).toHaveLength(1);
    expect(sessionAfterDelete.accounts[0].accountId).toBe(firstAccount.accountId);
    expect(sessionAfterDelete.activeAccountId).toBe(firstAccount.accountId);
  });

  it("uses explicit tauri command payloads for backup and deletion flows", async () => {
    isTauriMock.mockReturnValue(true);
    const walletBridge = await loadWalletBridge();

    invokeMock
      .mockResolvedValueOnce({
        draft: {
          accountId: "account-1",
          derivationIndex: 0,
          walletLabel: "Primary Wallet",
          address: "0x1111111111111111111111111111111111111111",
          isBiometricEnabled: true,
          source: "created",
          secretKind: "mnemonic",
          createdAt: "2026-04-06T00:00:00.000Z",
        },
        backupAccessToken: "backup-token",
      })
      .mockResolvedValueOnce("word ".repeat(11) + "final")
      .mockResolvedValueOnce({
        accountId: "account-1",
        derivationGroupId: "account-1",
        derivationIndex: 0,
        walletLabel: "Primary Wallet",
        address: "0x1111111111111111111111111111111111111111",
        isBiometricEnabled: true,
        source: "created",
        secretKind: "mnemonic",
        hasBackedUpMnemonic: true,
        createdAt: "2026-04-06T00:00:00.000Z",
        lastUnlockedAt: "2026-04-06T00:00:00.000Z",
      })
      .mockResolvedValueOnce({
        accounts: [],
        activeAccountId: null,
      });

    await walletBridge.createWallet({
      walletLabel: "Primary Wallet",
      password: "super-secret",
      isBiometricEnabled: true,
    });
    await walletBridge.getPendingBackupPhrase("backup-token");
    await walletBridge.finalizePendingWallet({
      backupAccessToken: "backup-token",
      confirmedBackup: true,
    });
    await walletBridge.deleteWalletAccount({
      accountId: "account-1",
      password: "super-secret",
    });

    expect(invokeMock).toHaveBeenNthCalledWith(1, "create_wallet", {
      request: {
        walletLabel: "Primary Wallet",
        password: "super-secret",
        isBiometricEnabled: true,
      },
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "get_pending_backup_phrase", {
      request: {
        backupAccessToken: "backup-token",
      },
    });
    expect(invokeMock).toHaveBeenNthCalledWith(3, "finalize_pending_wallet", {
      request: {
        backupAccessToken: "backup-token",
        confirmedBackup: true,
      },
    });
    expect(invokeMock).toHaveBeenNthCalledWith(4, "delete_wallet_account", {
      request: {
        accountId: "account-1",
        password: "super-secret",
      },
    });
  });
});
