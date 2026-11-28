import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChainlistNetworkData } from "../../types/network";
import {
  CHAINLIST_CACHE_KEY,
  clearChainlistCache,
  readPersistedChainlistCache,
  writePersistedChainlistCache,
} from "../chainlist";
import {
  clearBiometricUnlockCredential,
  hasBiometricUnlockCredential,
  saveBiometricUnlockCredential,
} from "../biometrics";
import {
  clearPatternLock,
  hasPatternLock,
  savePatternLock,
} from "../patternLock";

const tauriDb = vi.hoisted(() => ({
  uiState: null as Record<string, unknown> | null,
}));

const invokeMock = vi.hoisted(() =>
  vi.fn(async (command: string, payload?: Record<string, unknown>) => {
    if (command === "load_ui_state") {
      return tauriDb.uiState ? JSON.parse(JSON.stringify(tauriDb.uiState)) : null;
    }
    if (command === "save_ui_state") {
      tauriDb.uiState = payload?.state
        ? JSON.parse(JSON.stringify(payload.state))
        : null;
      return null;
    }
    return null;
  }),
);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  isTauri: () => Boolean((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__),
}));

function installTauriRuntime() {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: { invoke: invokeMock },
  });
}

function uninstallTauriRuntime() {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
}

describe("Persistence & Cleanup Regressions", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    tauriDb.uiState = null;
    invokeMock.mockClear();
    uninstallTauriRuntime();
    clearChainlistCache();
    setActivePinia(createPinia());
  });

  afterEach(() => {
    uninstallTauriRuntime();
  });

  it("persists preset Chainlist RPC overrides and sendDraft across cold Tauri restart", async () => {
    installTauriRuntime();

    const uiStateMod1 = await import("../uiState");
    await uiStateMod1.bootstrapUiState();

    const networksMod1 = await import("../../stores/networks");
    const networksStore1 = networksMod1.useNetworksStore();

    const rpcResult = networksStore1.saveNetworkRpcUrl(
      "ethereum",
      "https://eth.llamarpc.com",
    );
    expect(rpcResult.ok).toBe(true);
    expect(networksStore1.hasNetworkRpcOverride("ethereum")).toBe(true);
    expect(
      networksStore1.allNetworks.find((item) => item.id === "ethereum")?.rpcUrl,
    ).toBe("https://eth.llamarpc.com/");

    uiStateMod1.patchWalletScopedUiState("acc-1", {
      sendDraft: {
        networkId: "ethereum",
        assetId: "native",
        recipientAddress: "0x1111111111111111111111111111111111111111",
        amount: "0.42",
      },
    });

    await vi.waitFor(() => {
      expect(tauriDb.uiState).not.toBeNull();
      const persisted = tauriDb.uiState as {
        global?: { networkRpcOverrides?: Record<string, string> };
        walletScopes?: Record<string, { sendDraft?: { amount?: string } }>;
      };
      expect(persisted.global?.networkRpcOverrides?.ethereum).toBe(
        "https://eth.llamarpc.com/",
      );
      expect(persisted.walletScopes?.["acc-1"]?.sendDraft?.amount).toBe("0.42");
    });

    // Simulate cold relaunch with localStorage wiped: SQLite must restore everything
    vi.resetModules();
    localStorage.clear();
    setActivePinia(createPinia());

    const uiStateMod2 = await import("../uiState");
    await uiStateMod2.bootstrapUiState();

    const networksMod2 = await import("../../stores/networks");
    const networksStore2 = networksMod2.useNetworksStore();

    expect(networksStore2.hasNetworkRpcOverride("ethereum")).toBe(true);
    expect(
      networksStore2.allNetworks.find((item) => item.id === "ethereum")?.rpcUrl,
    ).toBe("https://eth.llamarpc.com/");
    expect(uiStateMod2.loadWalletScopedUiState("acc-1").sendDraft).toEqual({
      networkId: "ethereum",
      assetId: "native",
      recipientAddress: "0x1111111111111111111111111111111111111111",
      amount: "0.42",
    });

    // Selecting default preset URL without trailing slash clears override instead of false custom badge
    const defaultUrl = networksStore2.getDefaultNetworkRpcUrl("ethereum")!;
    const defaultWithoutSlash = defaultUrl.replace(/\/$/, "");
    const resetResult = networksStore2.saveNetworkRpcUrl(
      "ethereum",
      defaultWithoutSlash,
    );
    expect(resetResult.ok).toBe(true);
    expect(networksStore2.hasNetworkRpcOverride("ethereum")).toBe(false);
  });

  it("compacts oversized (>1.5MB) Chainlist caches so Android WebView storage preserves priority chains", () => {
    const oversized: ChainlistNetworkData[] = [
      {
        chainId: 1,
        name: "Ethereum Mainnet",
        chain: "ETH",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpc: [
          { url: "https://eth.llamarpc.com", tracking: "none" },
          { url: "https://ethereum-rpc.publicnode.com", tracking: "none" },
        ],
      },
    ];

    for (let i = 1000; i < 4200; i += 1) {
      oversized.push({
        chainId: i,
        name: `Long Network Name Entry Number ${i}`,
        chain: "NET",
        nativeCurrency: { name: "Coin", symbol: "COIN", decimals: 18 },
        rpc: Array.from({ length: 4 }, (_, idx) => ({
          url: `https://rpc-${idx}.very-long-chain-node-domain-${i}.example.com/v1/mainnet`,
          tracking: "limited",
          isOpenSource: true,
        })),
      });
    }

    expect(JSON.stringify({ timestamp: Date.now(), networks: oversized }).length).toBeGreaterThan(
      1_500_000,
    );

    writePersistedChainlistCache(oversized);

    const rawStored = localStorage.getItem(CHAINLIST_CACHE_KEY);
    expect(rawStored).not.toBeNull();
    expect(rawStored!.length).toBeLessThan(1_500_000);

    const restored = readPersistedChainlistCache();
    expect(restored).not.toBeNull();
    expect(restored!.some((item) => item.chainId === 1)).toBe(true);
    expect(restored!.length).toBeGreaterThan(0);
    expect(restored!.length).toBeLessThan(oversized.length);
    expect(restored!.length).toBeLessThanOrEqual(800);
  });

  it("clears pattern lock and biometric credentials when deleting a wallet account", async () => {
    const accountId = "acc-delete-test";
    await savePatternLock(accountId, [0, 1, 2, 5], "strong-pass-1");
    saveBiometricUnlockCredential(accountId, "strong-pass-1");

    expect(hasPatternLock(accountId)).toBe(true);
    expect(hasBiometricUnlockCredential(accountId)).toBe(true);

    vi.doMock("../walletBridge", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../walletBridge")>();
      return {
        ...actual,
        deleteWalletAccount: vi.fn().mockResolvedValue({
          accounts: [],
          activeAccountId: null,
          biometricEnabled: false,
        }),
      };
    });

    const { useSessionStore } = await import("../../stores/session");
    const sessionStore = useSessionStore();
    const res = await sessionStore.deleteWalletAccount(accountId, "strong-pass-1");

    expect(res.ok).toBe(true);
    expect(res.removedAll).toBe(true);
    expect(hasPatternLock(accountId)).toBe(false);
    expect(hasBiometricUnlockCredential(accountId)).toBe(false);

    clearPatternLock(accountId);
    clearBiometricUnlockCredential(accountId);
  });
});
