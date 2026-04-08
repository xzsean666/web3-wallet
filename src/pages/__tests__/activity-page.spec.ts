import { defineComponent } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ActivityPage from "../wallet/ActivityPage.vue";
import { clearPersistedUiState } from "../../services/uiState";
import { useSessionStore } from "../../stores/session";
import { useWalletStore } from "../../stores/wallet";

const { fetchTransactionDetailsMock } = vi.hoisted(() => ({
  fetchTransactionDetailsMock: vi.fn(),
}));

vi.mock("../../services/evm", () => ({
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
}));

const passthroughStub = defineComponent({
  template: "<div><slot /><slot name='actions' /></div>",
});

describe("ActivityPage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
    clearPersistedUiState();
    window.localStorage.clear();
    fetchTransactionDetailsMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps polling pending activity while the page stays open", async () => {
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

    fetchTransactionDetailsMock.mockResolvedValue({
      hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      from: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222",
      nonce: "1",
      value: "1",
      blockNumber: null,
      confirmedAt: null,
      status: "pending",
      gasLimit: "21000",
      gasUsed: null,
      gasPriceGwei: "1",
      effectiveGasPriceGwei: null,
      maxFeePerGasGwei: null,
      maxPriorityFeePerGasGwei: null,
      actualNetworkFee: null,
      explorerUrl: null,
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

    const wrapper = mount(ActivityPage, {
      global: {
        stubs: {
          SectionCard: passthroughStub,
          WalletChrome: passthroughStub,
        },
      },
    });

    await flushPromises();
    expect(fetchTransactionDetailsMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(12000);
    await flushPromises();
    expect(fetchTransactionDetailsMock).toHaveBeenCalledTimes(2);

    wrapper.unmount();
  });
});
