import { defineComponent } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WalletHomePage from "../wallet/WalletHomePage.vue";
import { clearPersistedUiState } from "../../services/uiState";
import { useNetworksStore } from "../../stores/networks";
import { useSessionStore } from "../../stores/session";
import { useWalletStore } from "../../stores/wallet";

const { fetchPortfolioSnapshotMock, fetchTransactionDetailsMock, routerPushMock } = vi.hoisted(() => ({
  fetchPortfolioSnapshotMock: vi.fn(),
  fetchTransactionDetailsMock: vi.fn(),
  routerPushMock: vi.fn(),
}));

vi.mock("../../services/evm", () => ({
  fetchPortfolioSnapshot: fetchPortfolioSnapshotMock,
  fetchTransactionDetails: fetchTransactionDetailsMock,
}));

vi.mock("vue-router", () => ({
  RouterLink: defineComponent({
    name: "RouterLink",
    props: {
      to: {
        type: [String, Object],
        required: false,
        default: "",
      },
    },
    template: "<a><slot /></a>",
  }),
  useRouter: () => ({
    push: routerPushMock,
  }),
}));

const passthroughStub = defineComponent({
  template: "<div><slot /><slot name='actions' /></div>",
});

describe("WalletHomePage", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    clearPersistedUiState();
    window.localStorage.clear();
    fetchPortfolioSnapshotMock.mockReset();
    fetchTransactionDetailsMock.mockReset();
    routerPushMock.mockReset();
  });

  it("syncs pending activity status on mount", async () => {
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
    const walletStore = useWalletStore();
    walletStore.prependActivity({
      id: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      title: "ETH 转账已提交",
      subtitle: "pending",
      status: "pending",
      accountId: "account-1",
      accountAddress: "0x1111111111111111111111111111111111111111",
      txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      networkId: "ethereum",
      assetId: "native",
      assetType: "native",
      assetSymbol: "ETH",
      amount: "1",
      recipientAddress: "0x2222222222222222222222222222222222222222",
      createdAt: "2026-04-07T00:00:00.000Z",
    });

    fetchPortfolioSnapshotMock.mockResolvedValue({
      networkId: "ethereum",
      accountAddress: "0x1111111111111111111111111111111111111111",
      nativeBalance: "10",
      latestBlock: "123",
      tokenBalances: {},
      lastSyncedAt: "2026-04-07T00:00:00.000Z",
      status: "ready",
      error: "",
    });
    fetchTransactionDetailsMock.mockResolvedValue({
      hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      from: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222",
      nonce: "1",
      value: "1",
      blockNumber: "456",
      confirmedAt: "2026-04-07T00:05:00.000Z",
      status: "success",
      gasLimit: "21000",
      gasUsed: "21000",
      gasPriceGwei: "1",
      effectiveGasPriceGwei: "1",
      maxFeePerGasGwei: null,
      maxPriorityFeePerGasGwei: null,
      actualNetworkFee: "0.000021",
      explorerUrl: "https://etherscan.io/tx/0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
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

    const wrapper = mount(WalletHomePage, {
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
        id: "ethereum",
      }),
      txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      trackedTokens: expect.arrayContaining([]),
    });
    expect(walletStore.recentActivity[0]).toMatchObject({
      txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      status: "complete",
    });

    wrapper.unmount();
  });

  it("shows a prominent testnet banner on the wallet home page", async () => {
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
    useNetworksStore().setActiveNetwork("polygon-amoy");
    fetchPortfolioSnapshotMock.mockResolvedValue({
      networkId: "polygon-amoy",
      accountAddress: "0x1111111111111111111111111111111111111111",
      nativeBalance: "0",
      latestBlock: "80002",
      tokenBalances: {},
      lastSyncedAt: "2026-04-07T00:00:00.000Z",
      status: "ready",
      error: "",
    });

    const wrapper = mount(WalletHomePage, {
      global: {
        stubs: {
          SectionCard: passthroughStub,
          WalletChrome: passthroughStub,
        },
      },
    });

    await flushPromises();

    expect(wrapper.find(".home-testnet-banner").text()).toContain("测试网");
    expect(wrapper.find(".home-testnet-banner").text()).toContain("请勿当作正式网余额");

    wrapper.unmount();
  });
});
