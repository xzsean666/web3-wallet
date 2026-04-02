import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { clearPersistedUiState } from "../../services/uiState";
import { useWalletStore } from "../wallet";

describe("wallet store", () => {
  beforeEach(() => {
    clearPersistedUiState();
    setActivePinia(createPinia());
  });

  it("adds a valid custom token", () => {
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

  it("rejects invalid token drafts", () => {
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

  it("removes only custom tokens", () => {
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

    const presetRemoval = store.removeCustomToken("usdc");
    expect(presetRemoval.ok).toBe(false);
    expect(presetRemoval.error).toBe("预置 Token 不能被移除");

    const customRemoval = store.removeCustomToken(added.token.id);
    expect(customRemoval.ok).toBe(true);
    expect(store.findTokenById(added.token.id)).toBeNull();
  });

  it("syncs recent activity status from pending to final state", () => {
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
    const rehydratedStore = useWalletStore();

    expect(rehydratedStore.trackedTokens.some((token) => token.symbol === "CD")).toBe(true);
    expect(rehydratedStore.recentActivity[0]).toMatchObject({
      title: "CD 转账已提交",
      status: "pending",
      assetSymbol: "CD",
    });
  });

  it("upserts, marks, and removes address book entries", () => {
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
    const store = useWalletStore();

    store.upsertAddressBookEntry({
      networkId: "base",
      label: "Payroll",
      address: "0x2222222222222222222222222222222222222222",
      note: "Monthly payouts",
    });
    await nextTick();

    setActivePinia(createPinia());
    const rehydratedStore = useWalletStore();

    expect(rehydratedStore.contactsForNetwork("base")[0]).toMatchObject({
      label: "Payroll",
      address: "0x2222222222222222222222222222222222222222",
      note: "Monthly payouts",
    });
  });
});
