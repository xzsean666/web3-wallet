import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { clearPersistedUiState, patchWalletScopedUiState } from "../../services/uiState";
import { useSessionStore } from "../session";
import { useWalletStore } from "../wallet";

function bootstrapSession(accountId = "account-1", address = "0x1111111111111111111111111111111111111111") {
  const sessionStore = useSessionStore();

  sessionStore.applyWalletSession(
    {
      activeAccountId: accountId,
      accounts: [
        {
          accountId,
          derivationGroupId: accountId,
          derivationIndex: 0,
          walletLabel: "Primary Wallet",
          address: address as `0x${string}`,
          isBiometricEnabled: true,
          source: "created" as const,
          secretKind: "mnemonic" as const,
          hasBackedUpMnemonic: true,
          createdAt: "2026-04-06T00:00:00.000Z",
          lastUnlockedAt: "2026-04-06T00:00:00.000Z",
        },
      ],
    },
    { unlocked: true },
  );

  return sessionStore;
}

describe("wallet store", () => {
  beforeEach(() => {
    clearPersistedUiState();
    setActivePinia(createPinia());
  });

  it("adds a valid custom token", () => {
    bootstrapSession();
    const store = useWalletStore();

    const result = store.addCustomToken({
      networkId: "ethereum",
      name: "Custom Dollar",
      symbol: "CD",
      decimals: "18",
      contractAddress: "0x1111111111111111111111111111111111111111",
    });

    expect(result.ok).toBe(true);
    expect(store.trackedTokens.some((token) => token.symbol === "CD")).toBe(true);
  });

  it("sanitizes custom token labels before storing them", () => {
    bootstrapSession();
    const store = useWalletStore();

    const result = store.addCustomToken({
      networkId: "ethereum",
      name: "Mock\u0000 Dollar\u200F",
      symbol: "m\u202eusd",
      decimals: "18",
      contractAddress: "0x1111111111111111111111111111111111111111",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected custom token to be added");
    }

    expect(result.token).toMatchObject({
      symbol: "MUSD",
      name: "Mock Dollar",
    });
  });

  it("rejects invalid token drafts", () => {
    bootstrapSession();
    const store = useWalletStore();

    const result = store.addCustomToken({
      networkId: "ethereum",
      name: "",
      symbol: "",
      decimals: "100",
      contractAddress: "abc",
    });

    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("ships immutable preset stablecoins on the default mainnets", () => {
    bootstrapSession();
    const store = useWalletStore();

    expect(store.tokensForNetwork("ethereum").map((token) => token.id)).toEqual(
      expect.arrayContaining(["usdc-ethereum", "usdt-ethereum"]),
    );
    expect(store.tokensForNetwork("base").map((token) => token.id)).toEqual(
      expect.arrayContaining(["usdc-base", "usdt-base"]),
    );
    expect(store.tokensForNetwork("optimism").map((token) => token.id)).toEqual(
      expect.arrayContaining(["usdc-optimism", "usdt-optimism"]),
    );

    const presetRemoval = store.removeCustomToken("usdt-base");
    expect(presetRemoval.ok).toBe(false);
    expect(presetRemoval.error).toBe("预置 Token 不能被移除");
  });

  it("removes only custom tokens", () => {
    bootstrapSession();
    const store = useWalletStore();

    const added = store.addCustomToken({
      networkId: "ethereum",
      name: "Custom Dollar",
      symbol: "CD",
      decimals: "18",
      contractAddress: "0x1111111111111111111111111111111111111111",
    });

    expect(added.ok).toBe(true);
    if (!added.ok) {
      throw new Error("expected custom token to be added");
    }

    const presetRemoval = store.removeCustomToken("usdc-ethereum");
    expect(presetRemoval.ok).toBe(false);
    expect(presetRemoval.error).toBe("预置 Token 不能被移除");

    const customRemoval = store.removeCustomToken(added.token.id);
    expect(customRemoval.ok).toBe(true);
    expect(store.findTokenById(added.token.id)).toBeNull();
  });

  it("syncs recent activity status from pending to final state", () => {
    bootstrapSession();
    const store = useWalletStore();
    const txHash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;

    store.prependActivity({
      id: txHash,
      title: "USDC 转账已提交",
      subtitle: "Ethereum · 12 USDC -> 0x1234...5678",
      status: "pending",
      txHash,
      assetSymbol: "USDC",
    });

    store.syncActivityStatus({
      txHash,
      status: "complete",
    });

    expect(store.recentActivity[0]).toMatchObject({
      txHash,
      status: "complete",
      title: "USDC 转账已确认",
    });

    store.syncActivityStatus({
      txHash,
      status: "reverted",
    });

    expect(store.recentActivity[0]).toMatchObject({
      txHash,
      status: "reverted",
      title: "USDC 转账已回退",
    });
    expect(store.recentActivity[0].subtitle).toContain("链上回退");
  });

  it("hydrates persisted custom tokens and recent activity", async () => {
    bootstrapSession();
    const store = useWalletStore();

    store.addCustomToken({
      networkId: "ethereum",
      name: "Custom Dollar",
      symbol: "CD",
      decimals: "18",
      contractAddress: "0x1111111111111111111111111111111111111111",
    });
    store.prependActivity({
      id: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      title: "CD 转账已提交",
      subtitle: "Ethereum · 1 CD -> 0x1234...5678",
      status: "pending",
      txHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      assetSymbol: "CD",
    });
    await nextTick();

    setActivePinia(createPinia());
    bootstrapSession();
    const rehydratedStore = useWalletStore();

    expect(rehydratedStore.trackedTokens.some((token) => token.symbol === "CD")).toBe(true);
    expect(rehydratedStore.recentActivity[0]).toMatchObject({
      title: "CD 转账已提交",
      status: "pending",
      assetSymbol: "CD",
    });
  });

  it("deduplicates persisted custom tokens that now match preset mainnet assets", async () => {
    bootstrapSession();
    patchWalletScopedUiState("account-1", {
      customTokens: [
        {
          id: "custom-base-usdt",
          symbol: "USDT",
          name: "Legacy Base USDT",
          balance: "0.00",
          decimals: 6,
          contractAddress: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
          networkIds: ["base"],
          source: "custom",
        },
      ],
    });
    await nextTick();

    setActivePinia(createPinia());
    bootstrapSession();
    const rehydratedStore = useWalletStore();
    const baseUsdtEntries = rehydratedStore
      .tokensForNetwork("base")
      .filter(
        (token) =>
          token.contractAddress.toLowerCase() === "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2".toLowerCase(),
      );

    expect(baseUsdtEntries).toHaveLength(1);
    expect(baseUsdtEntries[0]).toMatchObject({
      id: "usdt-base",
      source: "preset",
    });
  });

  it("drops persisted custom tokens whose labels only contain control characters", async () => {
    bootstrapSession();
    patchWalletScopedUiState("account-1", {
      customTokens: [
        {
          id: "custom-corrupted",
          symbol: "\u200F\u202E",
          name: "\u0000\u0001",
          balance: "0.00",
          decimals: 18,
          contractAddress: "0x1111111111111111111111111111111111111111",
          networkIds: ["ethereum"],
          source: "custom",
        },
      ],
    });
    await nextTick();

    setActivePinia(createPinia());
    bootstrapSession();
    const rehydratedStore = useWalletStore();

    expect(
      rehydratedStore.trackedTokens.some((token) => token.id === "custom-corrupted"),
    ).toBe(false);
  });

  it("upserts, marks, and removes address book entries", () => {
    bootstrapSession();
    const store = useWalletStore();

    const firstResult = store.upsertAddressBookEntry({
      networkId: "ethereum",
      label: "Main Treasury",
      address: "0x1111111111111111111111111111111111111111",
      note: "Primary payout wallet",
    });

    expect(firstResult.ok).toBe(true);
    expect(store.addressBookCount).toBe(1);
    expect(store.contactsForNetwork("ethereum")[0]).toMatchObject({
      label: "Main Treasury",
      note: "Primary payout wallet",
    });
    expect(
      store.resolveAddressBookLabel("ethereum", "0x1111111111111111111111111111111111111111"),
    ).toBe("Main Treasury");

    const secondResult = store.upsertAddressBookEntry({
      networkId: "ethereum",
      label: "Treasury Ops",
      address: "0x1111111111111111111111111111111111111111",
      note: "Updated label",
    });

    expect(secondResult.ok).toBe(true);
    expect(store.addressBookCount).toBe(1);
    expect(store.contactsForNetwork("ethereum")[0]).toMatchObject({
      label: "Treasury Ops",
      note: "Updated label",
    });

    store.markAddressBookEntryUsed({
      networkId: "ethereum",
      address: "0x1111111111111111111111111111111111111111",
    });

    expect(store.contactsForNetwork("ethereum")[0].lastUsedAt).not.toBeNull();

    store.removeAddressBookEntry(store.contactsForNetwork("ethereum")[0].id);
    expect(store.addressBookCount).toBe(0);
    expect(
      store.resolveAddressBookLabel("ethereum", "0x1111111111111111111111111111111111111111"),
    ).toBeNull();
  });

  it("formats activity title and subtitle with address book labels", () => {
    bootstrapSession();
    const store = useWalletStore();

    store.upsertAddressBookEntry({
      networkId: "ethereum",
      label: "Treasury Ops",
      address: "0x1111111111111111111111111111111111111111",
      note: "Primary payout wallet",
    });

    const activity = {
      id: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      title: "USDC 转账已提交",
      subtitle: "Ethereum · 12 USDC -> 0x1111...1111",
      status: "pending" as const,
      networkId: "ethereum",
      assetSymbol: "USDC",
      amount: "12",
      recipientAddress: "0x1111111111111111111111111111111111111111" as const,
    };

    expect(store.formatActivityTitle(activity)).toBe("向 Treasury Ops 发送 USDC 已提交");
    expect(store.formatActivitySubtitle(activity, "Ethereum")).toBe(
      "Ethereum · 12 USDC -> Treasury Ops (0x1111...1111)",
    );

    expect(
      store.formatActivitySubtitle(
        {
          ...activity,
          status: "reverted",
        },
        "Ethereum",
      ),
    ).toBe("Ethereum · 12 USDC -> Treasury Ops (0x1111...1111) · 链上回退");
  });

  it("hydrates persisted address book entries", async () => {
    bootstrapSession();
    const store = useWalletStore();

    store.upsertAddressBookEntry({
      networkId: "base",
      label: "Payroll",
      address: "0x2222222222222222222222222222222222222222",
      note: "Monthly payouts",
    });
    await nextTick();

    setActivePinia(createPinia());
    bootstrapSession();
    const rehydratedStore = useWalletStore();

    expect(rehydratedStore.contactsForNetwork("base")[0]).toMatchObject({
      label: "Payroll",
      address: "0x2222222222222222222222222222222222222222",
      note: "Monthly payouts",
    });
  });

  it("isolates wallet-scoped ui state by account id", async () => {
    const sessionStore = bootstrapSession("account-1", "0x1111111111111111111111111111111111111111");
    const store = useWalletStore();

    store.upsertAddressBookEntry({
      networkId: "ethereum",
      label: "Treasury Ops",
      address: "0x1111111111111111111111111111111111111111",
      note: "Account one only",
    });
    await nextTick();

    sessionStore.applyWalletSession(
      {
        activeAccountId: "account-2",
        accounts: [
          {
            accountId: "account-2",
            derivationGroupId: "account-2",
            derivationIndex: 0,
            walletLabel: "Secondary Wallet",
            address: "0x2222222222222222222222222222222222222222" as const,
            isBiometricEnabled: false,
            source: "imported" as const,
            secretKind: "privateKey" as const,
            hasBackedUpMnemonic: false,
            createdAt: "2026-04-06T00:00:00.000Z",
            lastUnlockedAt: "2026-04-06T00:00:00.000Z",
          },
        ],
      },
      { unlocked: true },
    );
    await nextTick();

    expect(store.contactsForNetwork("ethereum")).toHaveLength(0);
  });
});
