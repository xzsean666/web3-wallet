import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, isTauriMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  isTauriMock: vi.fn(() => false),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  isTauri: isTauriMock,
}));

async function loadUiState() {
  vi.resetModules();
  return import("../uiState");
}

async function flushAsyncWork() {
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

describe("uiState", () => {
  beforeEach(() => {
    vi.resetModules();
    invokeMock.mockReset();
    isTauriMock.mockReset();
    isTauriMock.mockReturnValue(false);
    window.localStorage.clear();
  });

  it("reads and writes preview state from localStorage", async () => {
    const uiState = await loadUiState();

    uiState.patchPersistedUiState({
      activeNetworkId: "ethereum",
      customNetworks: [
        {
          id: "custom-1",
          source: "custom",
          name: "Custom",
          chainId: 10,
          rpcUrl: "https://rpc.example.org",
          symbol: "ETH",
        },
      ],
    });

    uiState.patchWalletScopedUiState("account-1", {
      recentActivity: [
        {
          id: "activity-1",
          title: "Sent ETH",
          subtitle: "local",
          status: "pending",
        },
      ],
    });

    expect(uiState.loadPersistedUiState()).toMatchObject({
      activeNetworkId: "ethereum",
      customNetworks: [{ id: "custom-1" }],
    });
    expect(uiState.loadWalletScopedUiState("account-1")).toMatchObject({
      recentActivity: [{ id: "activity-1" }],
    });

    uiState.clearWalletScopedUiState("account-1");
    expect(uiState.loadWalletScopedUiState("account-1")).toEqual({});

    uiState.clearPersistedUiState();
    expect(uiState.loadPersistedUiState()).toEqual({});
  });

  it("hydrates legacy wallet-scoped state when no scoped envelope exists", async () => {
    window.localStorage.setItem(
      "web3-wallet/ui-state/v1",
      JSON.stringify({
        customTokens: [
          {
            id: "token-1",
            symbol: "USDC",
            name: "USD Coin",
            balance: "0",
            decimals: 6,
            contractAddress: "0x1111111111111111111111111111111111111111",
            networkIds: ["ethereum"],
            source: "custom",
          },
        ],
        addressBook: [
          {
            id: "contact-1",
            networkId: "ethereum",
            label: "Treasury",
            address: "0x2222222222222222222222222222222222222222",
            note: "",
            createdAt: "2026-04-06T00:00:00.000Z",
            updatedAt: "2026-04-06T00:00:00.000Z",
            lastUsedAt: null,
          },
        ],
      }),
    );

    const uiState = await loadUiState();

    expect(uiState.loadWalletScopedUiState("account-1")).toMatchObject({
      customTokens: [{ id: "token-1" }],
      addressBook: [{ id: "contact-1" }],
    });
  });

  it("bootstraps tauri state, persists patches and clears scoped data", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue(undefined);
    invokeMock.mockResolvedValueOnce({
      global: {
        activeNetworkId: "base",
      },
      walletScopes: {
        "account-9": {
          recentActivity: [
            {
              id: "activity-9",
              title: "Sent USDC",
              subtitle: "remote",
              status: "complete",
            },
          ],
        },
      },
    });

    const uiState = await loadUiState();
    await uiState.bootstrapUiState();

    expect(invokeMock).toHaveBeenNthCalledWith(1, "load_ui_state");
    expect(uiState.loadPersistedUiState()).toMatchObject({
      activeNetworkId: "base",
    });
    expect(uiState.loadWalletScopedUiState("account-9")).toMatchObject({
      recentActivity: [{ id: "activity-9" }],
    });

    uiState.patchPersistedUiState({
      activeNetworkId: "arbitrum",
    });
    uiState.clearAllWalletScopedUiState();
    await flushAsyncWork();

    expect(invokeMock).toHaveBeenNthCalledWith(2, "save_ui_state", {
      state: expect.objectContaining({
        global: expect.objectContaining({
          activeNetworkId: "arbitrum",
        }),
      }),
    });
    expect(invokeMock).toHaveBeenNthCalledWith(3, "save_ui_state", {
      state: expect.objectContaining({
        walletScopes: {},
      }),
    });
  });

  it("migrates local state into tauri storage when remote state is empty", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue(undefined);
    window.localStorage.setItem(
      "web3-wallet/ui-state/v2",
      JSON.stringify({
        global: {
          activeNetworkId: "optimism",
        },
        walletScopes: {
          "account-2": {
            recentActivity: [
              {
                id: "activity-2",
                title: "Migrated",
                subtitle: "local",
                status: "pending",
              },
            ],
          },
        },
      }),
    );
    invokeMock.mockResolvedValueOnce({
      global: {},
      walletScopes: {},
    });

    const uiState = await loadUiState();
    await uiState.bootstrapUiState();

    expect(uiState.loadPersistedUiState()).toMatchObject({
      activeNetworkId: "optimism",
    });
    expect(window.localStorage.getItem("web3-wallet/ui-state/v2")).toBeNull();

    uiState.clearPersistedUiState();
    await flushAsyncWork();

    expect(invokeMock).toHaveBeenLastCalledWith("save_ui_state", {
      state: {
        global: {},
        walletScopes: {},
      },
    });
  });

  it("falls back to local state when tauri loading fails", async () => {
    isTauriMock.mockReturnValue(true);
    window.localStorage.setItem(
      "web3-wallet/ui-state/v2",
      JSON.stringify({
        global: {
          activeNetworkId: "ethereum",
        },
      }),
    );
    invokeMock.mockRejectedValueOnce(new Error("offline"));

    const uiState = await loadUiState();
    await uiState.bootstrapUiState();

    expect(uiState.loadPersistedUiState()).toMatchObject({
      activeNetworkId: "ethereum",
    });
  });

  it("keeps a local tauri backup when persisting fails and replays it on the next bootstrap", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValueOnce({
      global: {},
      walletScopes: {},
    });
    invokeMock.mockRejectedValueOnce(new Error("sqlite offline"));

    let uiState = await loadUiState();
    await uiState.bootstrapUiState();

    uiState.patchPersistedUiState({
      activeNetworkId: "base",
    });
    await flushAsyncWork();

    expect(window.localStorage.getItem("web3-wallet/ui-state/v2")).toContain("\"activeNetworkId\":\"base\"");
    expect(window.localStorage.getItem("web3-wallet/ui-state/tauri-pending/v1")).toBe("1");

    vi.resetModules();
    invokeMock.mockReset();
    isTauriMock.mockReset();
    isTauriMock.mockReturnValue(true);
    invokeMock
      .mockResolvedValueOnce({
        global: {},
        walletScopes: {},
      })
      .mockResolvedValueOnce(undefined);

    uiState = await loadUiState();
    await uiState.bootstrapUiState();

    expect(uiState.loadPersistedUiState()).toMatchObject({
      activeNetworkId: "base",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "save_ui_state", {
      state: {
        global: {
          activeNetworkId: "base",
        },
        walletScopes: {},
      },
    });
    expect(window.localStorage.getItem("web3-wallet/ui-state/v2")).toBeNull();
    expect(window.localStorage.getItem("web3-wallet/ui-state/tauri-pending/v1")).toBeNull();
  });

  it("clears a removed network from every wallet scope", async () => {
    const uiState = await loadUiState();

    uiState.patchWalletScopedUiState("account-1", {
      customTokens: [
        {
          id: "token-keep",
          symbol: "USDC",
          name: "USD Coin",
          balance: "0",
          decimals: 6,
          contractAddress: "0x1111111111111111111111111111111111111111",
          networkIds: ["ethereum"],
          source: "custom",
        },
        {
          id: "token-drop",
          symbol: "LRC",
          name: "Local Rollup Coin",
          balance: "0",
          decimals: 18,
          contractAddress: "0x2222222222222222222222222222222222222222",
          networkIds: ["custom-31337"],
          source: "custom",
        },
      ],
      recentActivity: [
        {
          id: "activity-drop",
          title: "Sent LRC",
          subtitle: "custom network",
          status: "pending",
          networkId: "custom-31337",
        },
      ],
      addressBook: [
        {
          id: "contact-drop",
          networkId: "custom-31337",
          label: "Rollup",
          address: "0x3333333333333333333333333333333333333333",
          note: "",
          createdAt: "2026-04-06T00:00:00.000Z",
          updatedAt: "2026-04-06T00:00:00.000Z",
          lastUsedAt: null,
        },
      ],
    });
    uiState.patchWalletScopedUiState("account-2", {
      addressBook: [
        {
          id: "contact-keep",
          networkId: "ethereum",
          label: "Mainnet",
          address: "0x4444444444444444444444444444444444444444",
          note: "",
          createdAt: "2026-04-06T00:00:00.000Z",
          updatedAt: "2026-04-06T00:00:00.000Z",
          lastUsedAt: null,
        },
      ],
    });

    uiState.clearNetworkScopedUiState("custom-31337");

    expect(uiState.loadWalletScopedUiState("account-1")).toMatchObject({
      customTokens: [{ id: "token-keep" }],
    });
    expect(uiState.loadWalletScopedUiState("account-1").recentActivity).toEqual([]);
    expect(uiState.loadWalletScopedUiState("account-1").addressBook).toEqual([]);
    expect(uiState.loadWalletScopedUiState("account-2")).toMatchObject({
      addressBook: [{ id: "contact-keep" }],
    });
  });
});
