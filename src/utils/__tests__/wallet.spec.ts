import { describe, expect, it } from "vitest";
import { getNextMnemonicDerivationIndex, groupWalletProfiles } from "../wallet";
import type { WalletProfile } from "../../types/wallet";

function buildWalletProfile(overrides: Partial<WalletProfile> = {}): WalletProfile {
  return {
    accountId: "account-1",
    derivationGroupId: "group-1",
    derivationIndex: 0,
    walletLabel: "Primary Wallet",
    address: "0x1111111111111111111111111111111111111111",
    source: "created",
    secretKind: "mnemonic",
    isBiometricEnabled: false,
    hasBackedUpMnemonic: true,
    createdAt: "2026-04-02T00:00:00.000Z",
    lastUnlockedAt: "2026-04-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("wallet helpers", () => {
  it("returns the next available derivation index inside the same mnemonic group", () => {
    const rootAccount = buildWalletProfile();
    const latestDerivedAccount = buildWalletProfile({
      accountId: "account-3",
      address: "0x3333333333333333333333333333333333333333",
      derivationIndex: 2,
      walletLabel: "Trading / 2",
    });
    const otherMnemonicGroup = buildWalletProfile({
      accountId: "account-4",
      derivationGroupId: "group-2",
      address: "0x4444444444444444444444444444444444444444",
      derivationIndex: 6,
      walletLabel: "Other Seed / 6",
    });
    const privateKeyAccount = buildWalletProfile({
      accountId: "account-5",
      derivationGroupId: "account-5",
      address: "0x5555555555555555555555555555555555555555",
      derivationIndex: 99,
      walletLabel: "Imported PK",
      secretKind: "privateKey",
      source: "imported",
      hasBackedUpMnemonic: false,
    });

    expect(
      getNextMnemonicDerivationIndex(
        [rootAccount, latestDerivedAccount, otherMnemonicGroup, privateKeyAccount],
        rootAccount,
      ),
    ).toBe(3);
  });

  it("groups wallet profiles by derivation group and prioritizes the active group", () => {
    const rootAccount = buildWalletProfile();
    const latestDerivedAccount = buildWalletProfile({
      accountId: "account-3",
      address: "0x3333333333333333333333333333333333333333",
      derivationIndex: 2,
      walletLabel: "Trading / 2",
      createdAt: "2026-04-02T01:00:00.000Z",
    });
    const otherMnemonicGroup = buildWalletProfile({
      accountId: "account-4",
      derivationGroupId: "group-2",
      address: "0x4444444444444444444444444444444444444444",
      derivationIndex: 1,
      walletLabel: "Other Seed / 1",
      createdAt: "2026-04-02T02:00:00.000Z",
    });
    const privateKeyAccount = buildWalletProfile({
      accountId: "account-5",
      derivationGroupId: "account-5",
      address: "0x5555555555555555555555555555555555555555",
      derivationIndex: 0,
      walletLabel: "Imported PK",
      secretKind: "privateKey",
      source: "imported",
      hasBackedUpMnemonic: false,
      createdAt: "2026-04-02T03:00:00.000Z",
    });

    const groups = groupWalletProfiles(
      [rootAccount, latestDerivedAccount, otherMnemonicGroup, privateKeyAccount],
      latestDerivedAccount.accountId,
    );

    expect(groups).toHaveLength(3);
    expect(groups[0]).toMatchObject({
      derivationGroupId: "group-1",
      accountCount: 2,
      containsActiveAccount: true,
      nextDerivationIndex: 3,
    });
    expect(groups[0].accounts.map((entry) => entry.accountId)).toEqual(["account-3", "account-1"]);
    expect(groups[1].derivationGroupId).toBe("account-5");
    expect(groups[2].derivationGroupId).toBe("group-2");
  });
});
