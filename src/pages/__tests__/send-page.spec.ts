import { defineComponent } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAddress } from "viem";
import SendPage from "../wallet/SendPage.vue";
import { clearPersistedUiState, patchWalletScopedUiState } from "../../services/uiState";
import { useNetworksStore } from "../../stores/networks";
import { useSessionStore } from "../../stores/session";
import { useWalletStore } from "../../stores/wallet";

const {
  broadcastSignedTransactionMock,
  describeTransferErrorMock,
  estimateTransferPreviewMock,
  fetchPortfolioSnapshotMock,
  prepareTransferConfirmationMock,
  readErc20TokenMetadataMock,
  routeQueryMock,
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
  prepareTransferConfirmationMock: vi.fn(),
  readErc20TokenMetadataMock: vi.fn(),
  routeQueryMock: {} as Record<string, string>,
  routerPushMock: vi.fn(),
  signTransferTransactionMock: vi.fn(),
}));

vi.mock("../../services/evm", () => ({
  broadcastSignedTransaction: broadcastSignedTransactionMock,
  describeTransferError: describeTransferErrorMock,
  estimateTransferPreview: estimateTransferPreviewMock,
  fetchPortfolioSnapshot: fetchPortfolioSnapshotMock,
  readErc20TokenMetadata: readErc20TokenMetadataMock,
}));

vi.mock("../../services/walletBridge", () => ({
  prepareTransferConfirmation: prepareTransferConfirmationMock,
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
    query: routeQueryMock,
  }),
  useRouter: () => ({
    push: routerPushMock,
  }),
}));

const passthroughStub = defineComponent({
  template: "<div><slot /><slot name='actions' /></div>",
});

function bootstrapSendSession() {
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
  sessionStore.shellMode = "tauri";

  fetchPortfolioSnapshotMock.mockImplementation(async ({ network, address, tokens }) => ({
    networkId: (network as { id: string }).id,
    accountAddress: address as `0x${string}`,
    nativeBalance: "10",
    latestBlock: "123",
    tokenBalances: Object.fromEntries(
      ((tokens as Array<{ id: string }> | undefined) ?? []).map((token) => [token.id, "12.5"]),
    ),
    lastSyncedAt: "2026-04-07T00:00:00.000Z",
    status: "ready",
    error: "",
  }));

  return {
    sessionStore,
    networksStore: useNetworksStore(),
    walletStore: useWalletStore(),
  };
}

function findButtonByText(wrapper: ReturnType<typeof mount>, text: string) {
  return wrapper.findAll("button").find((button) => button.text().includes(text));
}

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
    clearPersistedUiState();
    window.localStorage.clear();
    window.sessionStorage.clear();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    broadcastSignedTransactionMock.mockReset();
    describeTransferErrorMock.mockClear();
    estimateTransferPreviewMock.mockReset();
    fetchPortfolioSnapshotMock.mockReset();
    prepareTransferConfirmationMock.mockReset();
    readErc20TokenMetadataMock.mockReset();
    Object.keys(routeQueryMock).forEach((key) => delete routeQueryMock[key]);
    routerPushMock.mockReset();
    signTransferTransactionMock.mockReset();
  });

  it("restores the persisted send draft for the active account", async () => {
    bootstrapSendSession();
    patchWalletScopedUiState("account-1", {
      sendDraft: {
        networkId: "ethereum",
        assetId: "usdc-ethereum",
        recipientAddress: "0x2222222222222222222222222222222222222222",
        amount: "2.5",
      },
    });

    const wrapper = mount(SendPage, {
      global: {
        stubs: {
          SectionCard: passthroughStub,
          WalletChrome: passthroughStub,
        },
      },
    });

    await flushPromises();

    expect((wrapper.get("select").element as HTMLSelectElement).value).toBe("usdc-ethereum");
    expect((wrapper.get('input[placeholder="0x..."]').element as HTMLInputElement).value).toBe(
      "0x2222222222222222222222222222222222222222",
    );
    expect((wrapper.get('input[placeholder="0.00"]').element as HTMLInputElement).value).toBe("2.5");
  });

  it("fills an ERC20 transfer from a pasted EIP-681 QR payload", async () => {
    const { networksStore, walletStore } = bootstrapSendSession();
    const tokenAddress = "0xebe1af878adc36994cebe5f8fd3bf772661e3d14";
    const recipientAddress = "0x18be3bc1fa455fcc19db8fa0bbacf178d8aa884f";
    const addTokenResult = walletStore.addCustomToken({
      networkId: "polygon-amoy",
      name: "Payment Token",
      symbol: "PAY",
      decimals: "18",
      contractAddress: tokenAddress,
    });

    expect(addTokenResult.ok).toBe(true);
    const tokenId = addTokenResult.ok ? addTokenResult.token.id : "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: vi.fn().mockResolvedValue(
          `ethereum:${tokenAddress}@80002/transfer?address=${recipientAddress}&uint256=1000000000000000000`,
        ),
      },
    });

    const wrapper = mount(SendPage, {
      global: {
        stubs: {
          SectionCard: passthroughStub,
          WalletChrome: passthroughStub,
        },
      },
    });

    await flushPromises();
    await findButtonByText(wrapper, "粘贴地址/QR")!.trigger("click");
    await flushPromises();

    expect(networksStore.activeNetworkId).toBe("polygon-amoy");
    expect((wrapper.get("select").element as HTMLSelectElement).value).toBe(tokenId);
    expect((wrapper.get('input[placeholder="0x..."]').element as HTMLInputElement).value).toBe(
      getAddress(recipientAddress),
    );
    expect((wrapper.get('input[placeholder="0.00"]').element as HTMLInputElement).value).toBe("1");
    expect(wrapper.text()).toContain("已从剪贴板回填 PAY 转账");
  });

  it("switches network and imports an untracked ERC20 only after explicit confirmation", async () => {
    const { networksStore, walletStore } = bootstrapSendSession();
    const tokenAddress = "0xebe1af878adc36994cebe5f8fd3bf772661e3d14";
    const recipientAddress = "0x18be3bc1fa455fcc19db8fa0bbacf178d8aa884f";

    expect(walletStore.tokensForNetwork("polygon-amoy")).toHaveLength(0);
    readErc20TokenMetadataMock.mockResolvedValue({
      name: "Payment Token",
      symbol: "PAY",
      decimals: 18,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: vi.fn().mockResolvedValue(
          `ethereum:${tokenAddress}@80002/transfer?address=${recipientAddress}&uint256=1000000000000000000`,
        ),
      },
    });

    const wrapper = mount(SendPage, {
      global: {
        stubs: {
          SectionCard: passthroughStub,
          WalletChrome: passthroughStub,
        },
      },
    });

    await flushPromises();
    await findButtonByText(wrapper, "粘贴地址/QR")!.trigger("click");
    await flushPromises();

    // Network is switched automatically, but the token must not be added yet —
    // the user has to confirm first.
    expect(readErc20TokenMetadataMock).toHaveBeenCalledTimes(1);
    expect(networksStore.activeNetworkId).toBe("polygon-amoy");
    expect(walletStore.tokensForNetwork("polygon-amoy")).toHaveLength(0);
    expect(wrapper.text()).toContain("还没添加，确认后再回填转账");

    await findButtonByText(wrapper, "确认添加并回填")!.trigger("click");
    await flushPromises();

    const importedTokens = walletStore.tokensForNetwork("polygon-amoy");
    expect(importedTokens).toHaveLength(1);
    expect(importedTokens[0].contractAddress.toLowerCase()).toBe(tokenAddress);

    expect((wrapper.get("select").element as HTMLSelectElement).value).toBe(importedTokens[0].id);
    expect((wrapper.get('input[placeholder="0x..."]').element as HTMLInputElement).value).toBe(
      getAddress(recipientAddress),
    );
    expect((wrapper.get('input[placeholder="0.00"]').element as HTMLInputElement).value).toBe("1");
    expect(wrapper.text()).toContain("已添加 PAY 并从剪贴板回填转账");
  });

  it("does not import the ERC20 when the confirmation is cancelled", async () => {
    const { networksStore, walletStore } = bootstrapSendSession();
    const tokenAddress = "0xebe1af878adc36994cebe5f8fd3bf772661e3d14";
    const recipientAddress = "0x18be3bc1fa455fcc19db8fa0bbacf178d8aa884f";

    readErc20TokenMetadataMock.mockResolvedValue({
      name: "Payment Token",
      symbol: "PAY",
      decimals: 18,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: vi.fn().mockResolvedValue(
          `ethereum:${tokenAddress}@80002/transfer?address=${recipientAddress}&uint256=1000000000000000000`,
        ),
      },
    });

    const wrapper = mount(SendPage, {
      global: {
        stubs: {
          SectionCard: passthroughStub,
          WalletChrome: passthroughStub,
        },
      },
    });

    await flushPromises();
    await findButtonByText(wrapper, "粘贴地址/QR")!.trigger("click");
    await flushPromises();

    // Network still switches (the user asked for that), but cancelling leaves no token behind.
    expect(networksStore.activeNetworkId).toBe("polygon-amoy");
    await findButtonByText(wrapper, "取消")!.trigger("click");
    await flushPromises();

    expect(walletStore.tokensForNetwork("polygon-amoy")).toHaveLength(0);
    expect((wrapper.get('input[placeholder="0x..."]').element as HTMLInputElement).value).toBe("");
    expect(wrapper.text()).toContain("已取消添加二维码里的 Token");
  });

  it("surfaces a readable error when an untracked ERC20 QR has no on-chain metadata", async () => {
    const { walletStore } = bootstrapSendSession();
    const tokenAddress = "0xebe1af878adc36994cebe5f8fd3bf772661e3d14";
    const recipientAddress = "0x18be3bc1fa455fcc19db8fa0bbacf178d8aa884f";

    readErc20TokenMetadataMock.mockRejectedValue(new Error("当前合约没有返回可用的 ERC20 元数据"));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: vi.fn().mockResolvedValue(
          `ethereum:${tokenAddress}@80002/transfer?address=${recipientAddress}&uint256=1000000000000000000`,
        ),
      },
    });

    const wrapper = mount(SendPage, {
      global: {
        stubs: {
          SectionCard: passthroughStub,
          WalletChrome: passthroughStub,
        },
      },
    });

    await flushPromises();
    await findButtonByText(wrapper, "粘贴地址/QR")!.trigger("click");
    await flushPromises();

    expect(walletStore.tokensForNetwork("polygon-amoy")).toHaveLength(0);
    expect(wrapper.text()).toContain("无法读取二维码里的 ERC20 合约");
    expect(wrapper.text()).toContain("当前合约没有返回可用的 ERC20 元数据");
  });

  it("aborts broadcasting when the network changes after signing starts", async () => {
    const { networksStore } = bootstrapSendSession();

    const customNetworkResult = networksStore.saveCustomNetwork({
      name: "Switch Target",
      chainId: "15420",
      rpcUrl: "https://sepolia.base.org",
      symbol: "ETH",
      explorerUrl: "",
    });
    expect(customNetworkResult.ok).toBe(true);
    const customNetworkId = customNetworkResult.ok ? customNetworkResult.network.id : "";
    networksStore.setActiveNetwork("ethereum");

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
    prepareTransferConfirmationMock.mockResolvedValue({
      confirmationId: "confirmation-switch",
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
    const signButton = findButtonByText(wrapper, "签名并广播");
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

  it("signs, broadcasts, records activity, and marks the recipient contact on the native flow", async () => {
    const { walletStore } = bootstrapSendSession();
    const recipientAddress = "0x2222222222222222222222222222222222222222";
    walletStore.upsertAddressBookEntry({
      networkId: "ethereum",
      label: "Treasury",
      address: recipientAddress,
      note: "ops",
    });

    estimateTransferPreviewMock.mockResolvedValue({
      assetType: "native",
      feeMode: "eip1559",
      nonce: "4",
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
    prepareTransferConfirmationMock.mockResolvedValue({
      confirmationId: "confirmation-native",
    });
    signTransferTransactionMock.mockResolvedValue({
      rawTransaction: "0xdeadbeef",
      txHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });
    broadcastSignedTransactionMock.mockResolvedValue(
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    );

    const wrapper = mount(SendPage, {
      global: {
        stubs: {
          SectionCard: passthroughStub,
          WalletChrome: passthroughStub,
        },
      },
    });

    await flushPromises();
    await wrapper.get('input[placeholder="0x..."]').setValue(recipientAddress);
    await wrapper.get('input[placeholder="0.00"]').setValue("1");
    await wrapper.get('button[type="submit"]').trigger("submit");
    await flushPromises();
    await wrapper.get('input[placeholder="发送时再次输入钱包密码"]').setValue("super-secret");
    await findButtonByText(wrapper, "签名并广播")!.trigger("click");
    await flushPromises();

    expect(prepareTransferConfirmationMock).toHaveBeenCalledWith({
      accountId: "account-1",
      chainId: "1",
      nonce: "4",
      gasLimit: "21000",
      recipientAddress,
      amount: "1000000000000000000",
      feeMode: "eip1559",
      gasPriceWei: null,
      maxFeePerGasWei: "100",
      maxPriorityFeePerGasWei: "10",
      asset: {
        type: "native",
      },
    });
    expect(signTransferTransactionMock).toHaveBeenCalledWith({
      accountId: "account-1",
      password: "super-secret",
      confirmationId: "confirmation-native",
    });
    expect(broadcastSignedTransactionMock).toHaveBeenCalledWith({
      network: expect.objectContaining({
        id: "ethereum",
        chainId: 1,
      }),
      rawTransaction: "0xdeadbeef",
    });
    expect(walletStore.recentActivity[0]).toMatchObject({
      txHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      networkId: "ethereum",
      amount: "1",
      recipientAddress,
      status: "pending",
    });
    expect(walletStore.findAddressBookEntry("ethereum", recipientAddress)?.lastUsedAt).toBeTruthy();
    expect(routerPushMock).toHaveBeenCalledWith({
      name: "wallet-tx-detail",
      params: {
        txHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
      query: {
        networkId: "ethereum",
      },
    });
  });

  it("maps ERC20 confirmation data into the exact signing payload", async () => {
    const { walletStore } = bootstrapSendSession();
    const tokenAddress = "0x5555555555555555555555555555555555555555";
    const recipientAddress = "0x6666666666666666666666666666666666666666";
    const addTokenResult = walletStore.addCustomToken({
      networkId: "ethereum",
      name: "Mock USD",
      symbol: "MUSD",
      decimals: "6",
      contractAddress: tokenAddress,
    });

    expect(addTokenResult.ok).toBe(true);
    const tokenId = addTokenResult.ok ? addTokenResult.token.id : "";
    estimateTransferPreviewMock.mockResolvedValue({
      assetType: "erc20",
      feeMode: "legacy",
      nonce: "9",
      gasLimit: "65000",
      gasPriceWei: "42",
      gasPriceGwei: "0.000000042",
      maxFeePerGasWei: null,
      maxFeePerGasGwei: null,
      maxPriorityFeePerGasWei: null,
      maxPriorityFeePerGasGwei: null,
      estimatedNetworkFee: "0.00273",
      parsedAmount: "1250000",
      contractAddress: tokenAddress,
    });
    prepareTransferConfirmationMock.mockResolvedValue({
      confirmationId: "confirmation-erc20",
    });
    signTransferTransactionMock.mockResolvedValue({
      rawTransaction: "0xfeedface",
      txHash: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    });
    broadcastSignedTransactionMock.mockResolvedValue(
      "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    );

    const wrapper = mount(SendPage, {
      global: {
        stubs: {
          SectionCard: passthroughStub,
          WalletChrome: passthroughStub,
        },
      },
    });

    await flushPromises();
    await wrapper.get("select").setValue(tokenId);
    await wrapper.get('input[placeholder="0x..."]').setValue(recipientAddress);
    await wrapper.get('input[placeholder="0.00"]').setValue("1.25");
    await wrapper.get('button[type="submit"]').trigger("submit");
    await flushPromises();
    await wrapper.get('input[placeholder="发送时再次输入钱包密码"]').setValue("super-secret");
    await findButtonByText(wrapper, "签名并广播")!.trigger("click");
    await flushPromises();

    expect(prepareTransferConfirmationMock).toHaveBeenCalledWith({
      accountId: "account-1",
      chainId: "1",
      nonce: "9",
      gasLimit: "65000",
      recipientAddress,
      amount: "1250000",
      feeMode: "legacy",
      gasPriceWei: "42",
      maxFeePerGasWei: null,
      maxPriorityFeePerGasWei: null,
      asset: {
        type: "erc20",
        contractAddress: tokenAddress,
      },
    });
    expect(signTransferTransactionMock).toHaveBeenCalledWith({
      accountId: "account-1",
      password: "super-secret",
      confirmationId: "confirmation-erc20",
    });
  });

  it("shows the ERC20 contract address in the confirmation summary", async () => {
    const { walletStore } = bootstrapSendSession();
    const tokenAddress = "0x5555555555555555555555555555555555555555";
    const addTokenResult = walletStore.addCustomToken({
      networkId: "ethereum",
      name: "Mock USD",
      symbol: "MUSD",
      decimals: "6",
      contractAddress: tokenAddress,
    });

    expect(addTokenResult.ok).toBe(true);
    const tokenId = addTokenResult.ok ? addTokenResult.token.id : "";
    estimateTransferPreviewMock.mockResolvedValue({
      assetType: "erc20",
      feeMode: "legacy",
      nonce: "9",
      gasLimit: "65000",
      gasPriceWei: "42",
      gasPriceGwei: "0.000000042",
      maxFeePerGasWei: null,
      maxFeePerGasGwei: null,
      maxPriorityFeePerGasWei: null,
      maxPriorityFeePerGasGwei: null,
      estimatedNetworkFee: "0.00273",
      parsedAmount: "1250000",
      contractAddress: tokenAddress,
    });
    prepareTransferConfirmationMock.mockResolvedValue({
      confirmationId: "confirmation-erc20-summary",
    });

    const wrapper = mount(SendPage, {
      global: {
        stubs: {
          SectionCard: passthroughStub,
          WalletChrome: passthroughStub,
        },
      },
    });

    await flushPromises();
    await wrapper.get("select").setValue(tokenId);
    await wrapper.get('input[placeholder="0x..."]').setValue(
      "0x6666666666666666666666666666666666666666",
    );
    await wrapper.get('input[placeholder="0.00"]').setValue("1.25");
    await wrapper.get('button[type="submit"]').trigger("submit");
    await flushPromises();

    expect(wrapper.text()).toContain("合约");
    expect(wrapper.text()).toContain(tokenAddress);
  });
});
