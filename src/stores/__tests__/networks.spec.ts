import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { clearPersistedUiState } from "../../services/uiState";
import { useSessionStore } from "../session";
import { useNetworksStore } from "../networks";
import { useWalletStore } from "../wallet";

function bootstrapSession(
  accountId = "account-1",
  address = "0x1111111111111111111111111111111111111111",
) {
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
}

describe("networks store", () => {
  beforeEach(() => {
    clearPersistedUiState();
    setActivePinia(createPinia());
  });

  it("rejects invalid custom network drafts", () => {
    const store = useNetworksStore();

    const result = store.saveCustomNetwork({
      name: "",
      chainId: "-1",
      rpcUrl: "abc",
      symbol: "",
      explorerUrl: "ftp://scan.example.org",
    });

    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("ships preset test networks and lets the user switch to them", () => {
    const store = useNetworksStore();

    expect(store.allNetworks.map((network) => network.id)).toEqual(
      expect.arrayContaining(["base-sepolia", "op-sepolia", "bsc-testnet", "opbnb-testnet"]),
    );

    store.setActiveNetwork("bsc-testnet");

    expect(store.activeNetworkId).toBe("bsc-testnet");
    expect(store.activeNetwork).toMatchObject({
      name: "BSC Testnet",
      chainId: 97,
      symbol: "tBNB",
    });
  });

  it("adds and removes a custom network", () => {
    const store = useNetworksStore();

    const createResult = store.saveCustomNetwork({
      name: "Local Rollup",
      chainId: "31337",
      rpcUrl: "https://rpc.local-rollup.dev",
      symbol: "LRC",
      explorerUrl: "https://scan.local-rollup.dev",
    });

    expect(createResult.ok).toBe(true);
    expect(store.customNetworks.length).toBe(1);

    store.removeCustomNetwork("custom-31337");

    expect(store.customNetworks.length).toBe(0);
    expect(store.activeNetworkId).toBe("ethereum");
  });

  it("hydrates persisted custom networks and active network id", async () => {
    const store = useNetworksStore();

    store.saveCustomNetwork({
      name: "Local Rollup",
      chainId: "31337",
      rpcUrl: "https://rpc.local-rollup.dev",
      symbol: "LRC",
      explorerUrl: "https://scan.local-rollup.dev",
    });
    await nextTick();

    setActivePinia(createPinia());
    const rehydratedStore = useNetworksStore();

    expect(rehydratedStore.customNetworks).toHaveLength(1);
    expect(rehydratedStore.activeNetworkId).toBe("custom-31337");
    expect(rehydratedStore.activeNetwork.name).toBe("Local Rollup");
  });

  it("removes custom-network scoped wallet state and prevents resurrection on re-add", async () => {
    bootstrapSession();
    const networksStore = useNetworksStore();
    const walletStore = useWalletStore();

    const createResult = networksStore.saveCustomNetwork({
      name: "Local Rollup",
      chainId: "31337",
      rpcUrl: "https://rpc.local-rollup.dev",
      symbol: "LRC",
      explorerUrl: "https://scan.local-rollup.dev",
    });

    expect(createResult.ok).toBe(true);
    walletStore.addCustomToken({
      networkId: "custom-31337",
      name: "Rollup Dollar",
      symbol: "rUSD",
      decimals: "18",
      contractAddress: "0x1111111111111111111111111111111111111111",
    });
    walletStore.prependActivity({
      id: "activity-rollup",
      title: "Rollup transfer",
      subtitle: "custom network",
      status: "pending",
      networkId: "custom-31337",
    });
    walletStore.upsertAddressBookEntry({
      networkId: "custom-31337",
      label: "Rollup Treasury",
      address: "0x2222222222222222222222222222222222222222",
      note: "custom",
    });
    await nextTick();

    networksStore.removeCustomNetwork("custom-31337");
    await nextTick();

    expect(walletStore.tokensForNetwork("custom-31337")).toHaveLength(0);
    expect(walletStore.contactsForNetwork("custom-31337")).toHaveLength(0);
    expect(walletStore.recentActivity.some((item) => item.networkId === "custom-31337")).toBe(false);

    networksStore.saveCustomNetwork({
      name: "Local Rollup Recreated",
      chainId: "31337",
      rpcUrl: "https://rpc2.local-rollup.dev",
      symbol: "LRC",
      explorerUrl: "https://scan2.local-rollup.dev",
    });
    await nextTick();

    setActivePinia(createPinia());
    bootstrapSession();
    const rehydratedNetworksStore = useNetworksStore();
    const rehydratedWalletStore = useWalletStore();

    expect(rehydratedNetworksStore.customNetworks).toHaveLength(1);
    expect(rehydratedWalletStore.tokensForNetwork("custom-31337")).toHaveLength(0);
    expect(rehydratedWalletStore.contactsForNetwork("custom-31337")).toHaveLength(0);
    expect(
      rehydratedWalletStore.recentActivity.some((item) => item.networkId === "custom-31337"),
    ).toBe(false);
  });

  it("rotates the custom network scope id when editing to a different chain id", async () => {
    bootstrapSession();
    const networksStore = useNetworksStore();
    const walletStore = useWalletStore();

    expect(
      networksStore.saveCustomNetwork({
        name: "Local Rollup",
        chainId: "31337",
        rpcUrl: "https://rpc.local-rollup.dev",
        symbol: "LRC",
        explorerUrl: "https://scan.local-rollup.dev",
      }).ok,
    ).toBe(true);

    walletStore.addCustomToken({
      networkId: "custom-31337",
      name: "Rollup Dollar",
      symbol: "rUSD",
      decimals: "18",
      contractAddress: "0x1111111111111111111111111111111111111111",
    });
    walletStore.prependActivity({
      id: "activity-rollup",
      title: "Rollup transfer",
      subtitle: "custom network",
      status: "pending",
      networkId: "custom-31337",
    });
    walletStore.upsertAddressBookEntry({
      networkId: "custom-31337",
      label: "Rollup Treasury",
      address: "0x2222222222222222222222222222222222222222",
      note: "custom",
    });
    await nextTick();

    const updateResult = networksStore.saveCustomNetwork(
      {
        name: "Rollup Sepolia",
        chainId: "11155111",
        rpcUrl: "https://rpc.rollup-sepolia.dev",
        symbol: "ETH",
        explorerUrl: "https://scan.rollup-sepolia.dev",
      },
      "custom-31337",
    );

    expect(updateResult.ok).toBe(true);
    expect(updateResult.ok && updateResult.network.id).toBe("custom-11155111");
    expect(networksStore.activeNetworkId).toBe("custom-11155111");
    expect(walletStore.tokensForNetwork("custom-31337")).toHaveLength(0);
    expect(walletStore.contactsForNetwork("custom-31337")).toHaveLength(0);
    expect(
      walletStore.recentActivity.some((item) => item.networkId === "custom-31337"),
    ).toBe(false);
  });
});
