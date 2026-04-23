import { defineComponent } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TransactionDetailPage from "../wallet/TransactionDetailPage.vue";
import { clearPersistedUiState } from "../../services/uiState";
import { useNetworksStore } from "../../stores/networks";
import { useSessionStore } from "../../stores/session";
import { useWalletStore } from "../../stores/wallet";

const { fetchTransactionDetailsMock } = vi.hoisted(() => ({
  fetchTransactionDetailsMock: vi.fn(),
}));

vi.mock("../../services/evm", () => ({
  fetchTransactionDetails: fetchTransactionDetailsMock,
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: vi.fn(() => false),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

vi.mock("vue-router", () => ({
  useRoute: () => ({
    params: {
      txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
    query: {
      networkId: "custom-31337",
    },
  }),
}));

const passthroughStub = defineComponent({
  template: "<div><slot /><slot name='actions' /></div>",
});

describe("TransactionDetailPage", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    clearPersistedUiState();
    window.localStorage.clear();
    fetchTransactionDetailsMock.mockReset();
  });

  it("loads transaction details on the network from the route query and syncs the activity status", async () => {
    const sessionStore = useSessionStore();

    sessionStore.applyWalletSession(
      {
        activeAccountId: "account-1",
        accounts: [
          {
            accountId: "account-1",
            derivationGroupId: "account-1",
            derivationIndex: 0,
            walletLabel: "Primary Wallet",
            address: "0x1111111111111111111111111111111111111111",
            source: "created",
            secretKind: "mnemonic",
            isBiometricEnabled: true,
            hasBackedUpMnemonic: true,
            createdAt: "2026-04-07T00:00:00.000Z",
            lastUnlockedAt: "2026-04-07T00:00:00.000Z",
          },
        ],
      },
      { unlocked: true },
    );
    const networksStore = useNetworksStore();
    const walletStore = useWalletStore();
    networksStore.saveCustomNetwork({
      name: "Local Rollup",
      chainId: "31337",
      rpcUrl: "https://rpc.local-rollup.dev",
      symbol: "LRC",
      explorerUrl: "https://scan.local-rollup.dev",
    });
    walletStore.prependActivity({
      id: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      title: "Pending transfer",
      subtitle: "pending",
      status: "pending",
      accountId: "account-1",
      accountAddress: "0x1111111111111111111111111111111111111111",
      txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      networkId: "custom-31337",
      assetId: "native",
      assetType: "native",
      assetSymbol: "LRC",
      amount: "1",
      recipientAddress: "0x2222222222222222222222222222222222222222",
      createdAt: "2026-04-07T00:00:00.000Z",
    });

    fetchTransactionDetailsMock.mockResolvedValue({
      hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      from: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222",
      nonce: "3",
      value: "1",
      blockNumber: "500",
      confirmedAt: "2026-04-07T00:05:00.000Z",
      status: "success",
      gasLimit: "21000",
      gasUsed: "21000",
      gasPriceGwei: "1",
      effectiveGasPriceGwei: "1",
      maxFeePerGasGwei: null,
      maxPriorityFeePerGasGwei: null,
      actualNetworkFee: "0.000021",
      explorerUrl: "https://scan.local-rollup.dev/tx/0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      summary: {
        kind: "native-transfer",
        label: "Native transfer",
        method: null,
        amount: "1",
        symbol: "LRC",
        assetName: "Local Rollup Native Token",
        recipientAddress: "0x2222222222222222222222222222222222222222",
        contractAddress: null,
      },
    });

    const wrapper = mount(TransactionDetailPage, {
      global: {
        stubs: {
          SectionCard: passthroughStub,
          WalletChrome: passthroughStub,
        },
      },
    });

    await flushPromises();

    expect(fetchTransactionDetailsMock).toHaveBeenCalledWith({
      network: expect.objectContaining({
        id: "custom-31337",
      }),
      txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      trackedTokens: [],
    });
    expect(walletStore.recentActivity[0]).toMatchObject({
      txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      status: "complete",
    });

    wrapper.unmount();
  });

  it("hides the explorer button when the returned explorer url is unsafe", async () => {
    const sessionStore = useSessionStore();

    sessionStore.applyWalletSession(
      {
        activeAccountId: "account-1",
        accounts: [
          {
            accountId: "account-1",
            derivationGroupId: "account-1",
            derivationIndex: 0,
            walletLabel: "Primary Wallet",
            address: "0x1111111111111111111111111111111111111111",
            source: "created",
            secretKind: "mnemonic",
            isBiometricEnabled: true,
            hasBackedUpMnemonic: true,
            createdAt: "2026-04-07T00:00:00.000Z",
            lastUnlockedAt: "2026-04-07T00:00:00.000Z",
          },
        ],
      },
      { unlocked: true },
    );

    fetchTransactionDetailsMock.mockResolvedValue({
      hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      from: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222",
      nonce: "3",
      value: "1",
      blockNumber: "500",
      confirmedAt: "2026-04-07T00:05:00.000Z",
      status: "success",
      gasLimit: "21000",
      gasUsed: "21000",
      gasPriceGwei: "1",
      effectiveGasPriceGwei: "1",
      maxFeePerGasGwei: null,
      maxPriorityFeePerGasGwei: null,
      actualNetworkFee: "0.000021",
      explorerUrl: "javascript:alert(1)",
      summary: {
        kind: "native-transfer",
        label: "Native transfer",
        method: null,
        amount: "1",
        symbol: "ETH",
        assetName: "Ether",
        recipientAddress: "0x2222222222222222222222222222222222222222",
        contractAddress: null,
      },
    });

    const wrapper = mount(TransactionDetailPage, {
      global: {
        stubs: {
          SectionCard: passthroughStub,
          WalletChrome: passthroughStub,
        },
      },
    });

    await flushPromises();

    expect(wrapper.findAll("button").map((button) => button.text())).not.toContain("打开区块浏览器");

    wrapper.unmount();
  });
});
