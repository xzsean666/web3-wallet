import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => false),
}));

async function loadWalletBridge() {
  vi.resetModules();
  return import("../walletBridge");
}

describe("walletBridge preview derivation flow", () => {
  beforeEach(() => {
    vi.resetModules();
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

  it("renames and deletes accounts inside preview mode", async () => {
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

    const renamed = await walletBridge.renameWalletAccount({
      accountId: secondAccount.accountId,
      walletLabel: "Ops Key Renamed",
    });

    expect(renamed?.walletLabel).toBe("Ops Key Renamed");

    const sessionAfterDelete = await walletBridge.deleteWalletAccount({
      accountId: secondAccount.accountId,
    });

    expect(sessionAfterDelete.accounts).toHaveLength(1);
    expect(sessionAfterDelete.accounts[0].accountId).toBe(firstAccount.accountId);
    expect(sessionAfterDelete.activeAccountId).toBe(firstAccount.accountId);
  });
});
