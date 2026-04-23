import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PREVIEW_SECRET_FLOW_BLOCKED_MESSAGE,
  PREVIEW_SECRET_FORCE_BLOCK_FLAG,
  PREVIEW_SECRET_OVERRIDE_FLAG,
} from "../../utils/runtimeSafety";

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
    delete (globalThis as Record<string, unknown>)[PREVIEW_SECRET_FORCE_BLOCK_FLAG];
    delete (globalThis as Record<string, unknown>)[PREVIEW_SECRET_OVERRIDE_FLAG];
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

    const phrase = await walletBridge.getPendingBackupPhrase({
      backupAccessToken: pendingSession.backupAccessToken,
      password: "super-secret",
    });
    expect(phrase.split(" ")).toHaveLength(12);

    const profile = await walletBridge.finalizePendingWallet({
      backupAccessToken: pendingSession.backupAccessToken,
      confirmedBackup: true,
    });

    expect(profile.hasBackedUpMnemonic).toBe(true);
  });

  it("does not let preview create or import overwrite an unfinished backup flow", async () => {
    const walletBridge = await loadWalletBridge();

    const pendingSession = await walletBridge.createWallet({
      walletLabel: "Primary Wallet",
      password: "super-secret",
      isBiometricEnabled: true,
    });

    await expect(
      walletBridge.createWallet({
        walletLabel: "Second Wallet",
        password: "super-secret",
        isBiometricEnabled: false,
      }),
    ).rejects.toThrow("当前有一笔待完成的备份流程");

    await expect(
      walletBridge.importWallet({
        walletLabel: "Imported Wallet",
        password: "super-secret",
        isBiometricEnabled: false,
        secretKind: "mnemonic",
        secretValue: "test test test test test test test test test test test junk",
      }),
    ).rejects.toThrow("当前有一笔待完成的备份流程");

    const session = await walletBridge.loadPendingWalletSession();
    expect(session?.draft.accountId).toBe(pendingSession.draft.accountId);
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
    await walletBridge.getPendingBackupPhrase({
      backupAccessToken: "backup-token",
      password: "super-secret",
    });
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
        password: "super-secret",
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

  describe("preview helpers", () => {
    it("exposes pending drafts and cancels them", async () => {
      const walletBridge = await loadWalletBridge();

      const pending = await walletBridge.createWallet({
        walletLabel: "Cancel Flow",
        password: "super-secret",
        isBiometricEnabled: false,
      });

      const session = await walletBridge.loadPendingWalletSession();
      expect(session?.draft.accountId).toBe(pending.draft.accountId);

      await walletBridge.cancelPendingWallet();
      await expect(walletBridge.loadPendingWalletSession()).resolves.toBeNull();
    });

    it("returns the active profile after finalizing a preview wallet", async () => {
      const walletBridge = await loadWalletBridge();

      const pending = await walletBridge.createWallet({
        walletLabel: "Finalize Flow",
        password: "super-secret",
        isBiometricEnabled: true,
      });
      await walletBridge.getPendingBackupPhrase({
        backupAccessToken: pending.backupAccessToken,
        password: "super-secret",
      });

      const profile = await walletBridge.finalizePendingWallet({
        backupAccessToken: pending.backupAccessToken,
        confirmedBackup: true,
      });

      const activeProfile = await walletBridge.loadWalletProfile();
      expect(activeProfile?.accountId).toBe(profile.accountId);
    });

    it("supports unlocking, switching, biometric toggles and renaming", async () => {
      const walletBridge = await loadWalletBridge();
      const first = await walletBridge.importWallet({
        walletLabel: "First",
        password: "super-secret",
        isBiometricEnabled: false,
        secretKind: "mnemonic",
        secretValue: "test test test test test test test test test test test junk",
      });
      const second = await walletBridge.importWallet({
        walletLabel: "Second",
        password: "super-secret",
        isBiometricEnabled: false,
        secretKind: "privateKey",
        secretValue: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      });

      await expect(
        walletBridge.unlockWallet({ accountId: first.accountId, password: "wrong" }),
      ).resolves.toBeNull();

      const unlocked = await walletBridge.unlockWallet({
        accountId: first.accountId,
        password: "super-secret",
      });
      expect(unlocked?.accountId).toBe(first.accountId);

      const switched = await walletBridge.setActiveWallet({ accountId: second.accountId });
      expect(switched?.accountId).toBe(second.accountId);

      const biometrics = await walletBridge.updateBiometricSetting({
        accountId: second.accountId,
        isBiometricEnabled: true,
      });
      expect(biometrics?.isBiometricEnabled).toBe(true);

      const renamed = await walletBridge.renameWalletAccount({
        accountId: second.accountId,
        walletLabel: "Renamed",
      });
      expect(renamed?.walletLabel).toBe("Renamed");

      await expect(
        walletBridge.renameWalletAccount({
          accountId: second.accountId,
          walletLabel: "   ",
        }),
      ).rejects.toThrow("钱包名称不能为空");
    });

    it("rejects signTransferTransaction in preview", async () => {
      const walletBridge = await loadWalletBridge();
      const profile = await walletBridge.importWallet({
        walletLabel: "Signer",
        password: "super-secret",
        isBiometricEnabled: false,
        secretKind: "privateKey",
        secretValue: "0xbbbb000000000000000000000000000000000000000000000000000000000000",
      });

      await expect(
        walletBridge.signTransferTransaction({
          accountId: profile.accountId,
          password: "super-secret",
          confirmationId: "confirmation-1",
        }),
      ).rejects.toThrow("浏览器预览模式不支持真实签名与广播，请使用 pnpm tauri dev");
    });

    it("refuses preview secret flows when secure randomness is missing", async () => {
      const walletBridge = await loadWalletBridge();
      const originalCrypto = globalThis.crypto;
      vi.stubGlobal("crypto", {
        subtle: originalCrypto?.subtle,
      } as Crypto);
      try {
        await expect(
          walletBridge.createWallet({
            walletLabel: "Fallback",
            password: "super-secret",
            isBiometricEnabled: false,
          }),
        ).rejects.toThrow("缺少安全随机数来源");
      } finally {
        vi.stubGlobal("crypto", originalCrypto);
      }
    });

    it("blocks preview wallet creation when the test-only force block flag is enabled", async () => {
      const walletBridge = await loadWalletBridge();
      (globalThis as Record<string, unknown>)[PREVIEW_SECRET_FORCE_BLOCK_FLAG] = true;

      await expect(
        walletBridge.createWallet({
          walletLabel: "Blocked Create",
          password: "super-secret",
          isBiometricEnabled: false,
        }),
      ).rejects.toThrow(PREVIEW_SECRET_FLOW_BLOCKED_MESSAGE);
    });

    it("blocks preview wallet import when the test-only force block flag is enabled", async () => {
      const walletBridge = await loadWalletBridge();
      (globalThis as Record<string, unknown>)[PREVIEW_SECRET_FORCE_BLOCK_FLAG] = true;

      await expect(
        walletBridge.importWallet({
          walletLabel: "Blocked Import",
          password: "super-secret",
          isBiometricEnabled: false,
          secretKind: "mnemonic",
          secretValue: "test test test test test test test test test test test junk",
        }),
      ).rejects.toThrow(PREVIEW_SECRET_FLOW_BLOCKED_MESSAGE);
    });

    it("blocks preview backup phrase reveal when the test-only force block flag is enabled", async () => {
      const walletBridge = await loadWalletBridge();
      const pending = await walletBridge.createWallet({
        walletLabel: "Blocked Backup",
        password: "super-secret",
        isBiometricEnabled: false,
      });
      (globalThis as Record<string, unknown>)[PREVIEW_SECRET_FORCE_BLOCK_FLAG] = true;

      await expect(
        walletBridge.getPendingBackupPhrase({
          backupAccessToken: pending.backupAccessToken,
          password: "super-secret",
        }),
      ).rejects.toThrow(PREVIEW_SECRET_FLOW_BLOCKED_MESSAGE);
    });
  });

  describe("tauri commands", () => {
    beforeEach(() => {
      isTauriMock.mockReturnValue(true);
    });

    it("invokes cancelPendingWallet via invoke", async () => {
      const walletBridge = await loadWalletBridge();
      await walletBridge.cancelPendingWallet();
      expect(invokeMock).toHaveBeenCalledWith("cancel_pending_wallet");
    });

    it("delegates loadPendingWalletSession and loadWalletProfile to invoke", async () => {
      const walletBridge = await loadWalletBridge();
      invokeMock.mockResolvedValueOnce({
        draft: { accountId: "id" },
        backupAccessToken: "backup-token",
      });

      const session = await walletBridge.loadPendingWalletSession();
      expect(session?.draft.accountId).toBe("id");
      expect(invokeMock).toHaveBeenNthCalledWith(1, "load_pending_wallet_session");

      const sessionSnapshot = {
        accounts: [{ accountId: "profile-1" }],
        activeAccountId: "profile-1",
      };
      invokeMock.mockResolvedValueOnce(sessionSnapshot);
      const profile = await walletBridge.loadWalletProfile();
      expect(profile?.accountId).toBe("profile-1");
      expect(invokeMock).toHaveBeenNthCalledWith(2, "load_wallet_session");
    });

    it("passes unlock/setActive/updateBiometric/rename payloads to invoke", async () => {
      const walletBridge = await loadWalletBridge();
      invokeMock
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ accountId: "active" })
        .mockResolvedValueOnce({ accountId: "bio" })
        .mockResolvedValueOnce({ accountId: "renamed" });

      await walletBridge.unlockWallet({
        accountId: "active",
        password: "pw",
      });
      expect(invokeMock).toHaveBeenNthCalledWith(1, "unlock_wallet", {
        request: { accountId: "active", password: "pw" },
      });

      await walletBridge.setActiveWallet({ accountId: "active" });
      expect(invokeMock).toHaveBeenNthCalledWith(2, "set_active_wallet", {
        request: { accountId: "active" },
      });

      await walletBridge.updateBiometricSetting({
        accountId: "active",
        isBiometricEnabled: true,
      });
      expect(invokeMock).toHaveBeenNthCalledWith(3, "update_biometric_setting", {
        request: { accountId: "active", isBiometricEnabled: true },
      });

      await walletBridge.renameWalletAccount({
        accountId: "renamed",
        walletLabel: "new",
      });
      expect(invokeMock).toHaveBeenNthCalledWith(4, "rename_wallet_account", {
        request: { accountId: "renamed", walletLabel: "new" },
      });
    });

    it("sends exact prepare/sign transfer payloads to invoke", async () => {
      const walletBridge = await loadWalletBridge();
      invokeMock
        .mockResolvedValueOnce({
          confirmationId: "confirmation-1",
        })
        .mockResolvedValueOnce({
          rawTransaction: "0x00",
          txHash: "0x01",
        })
        .mockResolvedValueOnce({
          confirmationId: "confirmation-2",
        })
        .mockResolvedValueOnce({
          rawTransaction: "0x02",
          txHash: "0x03",
        });

      const preparedNative = await walletBridge.prepareTransferConfirmation({
        accountId: "account",
        chainId: "1",
        nonce: "0",
        amount: "1",
        maxPriorityFeePerGasWei: "1",
        maxFeePerGasWei: "2",
        gasLimit: "21000",
        recipientAddress: "0x1111111111111111111111111111111111111111",
        feeMode: "eip1559",
        asset: {
          type: "native",
        },
      });

      expect(invokeMock).toHaveBeenNthCalledWith(1, "prepare_transfer_confirmation", {
        request: {
          accountId: "account",
          chainId: "1",
          nonce: "0",
          amount: "1",
          maxPriorityFeePerGasWei: "1",
          maxFeePerGasWei: "2",
          gasLimit: "21000",
          recipientAddress: "0x1111111111111111111111111111111111111111",
          feeMode: "eip1559",
          asset: {
            type: "native",
          },
        },
      });
      expect(preparedNative).toEqual({
        confirmationId: "confirmation-1",
      });

      const payload = await walletBridge.signTransferTransaction({
        accountId: "account",
        password: "pw",
        confirmationId: "confirmation-1",
      });

      expect(invokeMock).toHaveBeenNthCalledWith(2, "sign_transfer_transaction", {
        request: {
          accountId: "account",
          password: "pw",
          confirmationId: "confirmation-1",
        },
      });
      expect(payload).toEqual({
        rawTransaction: "0x00",
        txHash: "0x01",
      });

      const preparedErc20 = await walletBridge.prepareTransferConfirmation({
        accountId: "account",
        chainId: "8453",
        nonce: "7",
        amount: "1000000",
        gasPriceWei: "42",
        gasLimit: "65000",
        recipientAddress: "0x2222222222222222222222222222222222222222",
        feeMode: "legacy",
        asset: {
          type: "erc20",
          contractAddress: "0x3333333333333333333333333333333333333333",
        },
      });

      expect(invokeMock).toHaveBeenNthCalledWith(3, "prepare_transfer_confirmation", {
        request: {
          accountId: "account",
          chainId: "8453",
          nonce: "7",
          amount: "1000000",
          gasPriceWei: "42",
          gasLimit: "65000",
          recipientAddress: "0x2222222222222222222222222222222222222222",
          feeMode: "legacy",
          asset: {
            type: "erc20",
            contractAddress: "0x3333333333333333333333333333333333333333",
          },
        },
      });
      expect(preparedErc20).toEqual({
        confirmationId: "confirmation-2",
      });

      await walletBridge.signTransferTransaction({
        accountId: "account",
        password: "pw",
        confirmationId: "confirmation-2",
      });

      expect(invokeMock).toHaveBeenNthCalledWith(4, "sign_transfer_transaction", {
        request: {
          accountId: "account",
          password: "pw",
          confirmationId: "confirmation-2",
        },
      });
    });
  });
});
