import { defineComponent } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SendPage from "../wallet/SendPage.vue";
import { useNetworksStore } from "../../stores/networks";
import { useSessionStore } from "../../stores/session";

const {
  broadcastSignedTransactionMock,
  describeTransferErrorMock,
  estimateTransferPreviewMock,
  fetchPortfolioSnapshotMock,
  routerPushMock,
  signTransferTransactionMock,
} = vi.hoisted(() => ({
  broadcastSignedTransactionMock: vi.fn(),
  describeTransferErrorMock: vi.fn((options: { stage: "estimate" | "sign" | "broadcast" }) => ({
    stage: options.stage,
    category: "unknown" as const,
    title: "failed",
    message: "failed",
    hints: [],
  })),
  estimateTransferPreviewMock: vi.fn(),
  fetchPortfolioSnapshotMock: vi.fn(),
  routerPushMock: vi.fn(),
  signTransferTransactionMock: vi.fn(),
}));

vi.mock("../../services/evm", () => ({
  broadcastSignedTransaction: broadcastSignedTransactionMock,
  describeTransferError: describeTransferErrorMock,
  estimateTransferPreview: estimateTransferPreviewMock,
  fetchPortfolioSnapshot: fetchPortfolioSnapshotMock,
}));

vi.mock("../../services/walletBridge", () => ({
  signTransferTransaction: signTransferTransactionMock,
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
  useRoute: () => ({
    params: {},
    query: {},
  }),
  useRouter: () => ({
    push: routerPushMock,
  }),
}));

const passthroughStub = defineComponent({
  template: "<div><slot /><slot name='actions' /></div>",
});

function createDeferredPromise<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    promise,
    resolve,
    reject,
  };
}

describe("SendPage", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    window.localStorage.clear();
    window.sessionStorage.clear();
    broadcastSignedTransactionMock.mockReset();
    describeTransferErrorMock.mockClear();
    estimateTransferPreviewMock.mockReset();
    fetchPortfolioSnapshotMock.mockReset();
    routerPushMock.mockReset();
    signTransferTransactionMock.mockReset();
  });

  it("aborts broadcasting when the network changes after signing starts", async () => {
    const sessionStore = useSessionStore();
    const networksStore = useNetworksStore();

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
    sessionStore.shellMode = "tauri";

    const customNetworkResult = networksStore.saveCustomNetwork({
      name: "Switch Target",
      chainId: "84532",
      rpcUrl: "https://sepolia.base.org",
      symbol: "ETH",
      explorerUrl: "",
    });
    expect(customNetworkResult.ok).toBe(true);
    const customNetworkId = customNetworkResult.ok ? customNetworkResult.network.id : "";
    networksStore.setActiveNetwork("ethereum");

    fetchPortfolioSnapshotMock.mockImplementation(async ({ network, address }) => ({
      networkId: network.id,
      accountAddress: address,
      nativeBalance: "10",
      latestBlock: "123",
      tokenBalances: {},
      lastSyncedAt: "2026-04-07T00:00:00.000Z",
      status: "ready",
      error: "",
    }));
    estimateTransferPreviewMock.mockResolvedValue({
      assetType: "native",
      feeMode: "eip1559",
      nonce: "1",
      gasLimit: "21000",
      gasPriceWei: null,
      gasPriceGwei: null,
      maxFeePerGasWei: "100",
      maxFeePerGasGwei: "0.0000001",
      maxPriorityFeePerGasWei: "10",
      maxPriorityFeePerGasGwei: "0.00000001",
      estimatedNetworkFee: "0.001",
      parsedAmount: "1000000000000000000",
    });

    const signDeferred = createDeferredPromise<{
      rawTransaction: `0x${string}`;
      txHash: `0x${string}`;
    }>();
    signTransferTransactionMock.mockReturnValue(signDeferred.promise);

    const wrapper = mount(SendPage, {
      global: {
        stubs: {
          SectionCard: passthroughStub,
          WalletChrome: passthroughStub,
        },
      },
    });

    await flushPromises();
    await wrapper.get('input[placeholder="0x..."]').setValue(
      "0x2222222222222222222222222222222222222222",
    );
    await wrapper.get('input[placeholder="0.00"]').setValue("1");
    await wrapper.get('button[type="submit"]').trigger("submit");
    await flushPromises();

    await wrapper.get('input[placeholder="发送时再次输入钱包密码"]').setValue("super-secret");
    const signButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("签名并广播"));
    expect(signButton).toBeDefined();

    const signing = signButton!.trigger("click");
    await flushPromises();
    expect(wrapper.get('input[placeholder="0x..."]').attributes("disabled")).toBeDefined();
    expect(wrapper.get('input[placeholder="0.00"]').attributes("disabled")).toBeDefined();
    const reestimateButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("重新估算"));
    expect(reestimateButton?.attributes("disabled")).toBeDefined();

    networksStore.setActiveNetwork(customNetworkId);
    signDeferred.resolve({
      rawTransaction: "0xdeadbeef",
      txHash: "0xabc123",
    });

    await signing;
    await flushPromises();

    expect(broadcastSignedTransactionMock).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("确认摘要已过期");
    expect(routerPushMock).not.toHaveBeenCalled();
  });
});
