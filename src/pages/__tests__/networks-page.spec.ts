import { defineComponent } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NetworksPage from "../settings/NetworksPage.vue";
import { clearPersistedUiState } from "../../services/uiState";
import { useNetworksStore } from "../../stores/networks";

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

vi.mock("../../services/evm", () => ({
  validateRpcEndpoint: vi.fn(async (options: { expectedChainId: number; rpcUrl: string }) => {
    if (options.rpcUrl.includes("invalid")) {
      return {
        status: "error" as const,
        message: "RPC connection failed",
        expectedChainId: options.expectedChainId,
        actualChainId: null,
        latestBlock: null,
        latencyMs: 1200,
        checkedAt: "2026-11-06T00:00:00.000Z",
      };
    }
    return {
      status: "ok" as const,
      message: "RPC reachable",
      expectedChainId: options.expectedChainId,
      actualChainId: options.expectedChainId,
      latestBlock: "12345678",
      latencyMs: 95,
      checkedAt: "2026-11-06T00:00:00.000Z",
    };
  }),
}));

vi.mock("../../services/chainlist", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/chainlist")>();
  return {
    ...actual,
    getChainlistRpcsForChain: vi.fn(async (_chainId: number) => [
      { url: "https://rpc1.example.org/", tracking: "none" as const },
      { url: "https://rpc2.example.org/", tracking: "limited" as const },
    ]),
    searchChainlistChains: vi.fn(async (query: string) => {
      if (query.toLowerCase().includes("gnosis") || query.includes("100")) {
        return [
          {
            chainId: 100,
            name: "Gnosis",
            chain: "GNO",
            nativeCurrency: { name: "xDAI", symbol: "xDAI", decimals: 18 },
            rpc: [{ url: "https://rpc.gnosischain.com/", tracking: "none" as const }],
            explorers: [{ name: "gnosisscan", url: "https://gnosisscan.io" }],
          },
        ];
      }
      return [];
    }),
    testRpcLatency: vi.fn(async (_chainId: number, url: string) => ({
      url,
      status: "ok" as const,
      latencyMs: 88,
      latestBlock: "999999",
      message: "Reachable",
    })),
    batchTestRpcLatencies: vi.fn(
      async (_chainId: number, urls: string[], onProgress?: (res: any) => void) => {
        const results: Record<string, any> = {};
        for (const url of urls) {
          const res = {
            url,
            status: "ok" as const,
            latencyMs: 65,
            latestBlock: "999999",
            message: "Reachable",
          };
          results[url] = res;
          if (onProgress) {
            onProgress(res);
          }
        }
        return results;
      },
    ),
  };
});

describe("NetworksPage", () => {
  beforeEach(() => {
    clearPersistedUiState();
    window.localStorage.clear();
    setActivePinia(createPinia());
  });

  it("renders mainnet and testnet network cards", () => {
    const wrapper = mount(NetworksPage);
    expect(wrapper.text()).toContain("Ethereum");
    expect(wrapper.text()).toContain("Polygon");
    expect(wrapper.text()).toContain("Base Sepolia");
  });

  it("opens RPC editor with Chainlist candidates when clicking '更改 RPC'", async () => {
    const wrapper = mount(NetworksPage);

    // Find and click "更改 RPC" for Ethereum
    const changeButtons = wrapper
      .findAll("button")
      .filter((b) => b.text().includes("更改 RPC"));
    expect(changeButtons.length).toBeGreaterThan(0);
    await changeButtons[0].trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("Chainlist 节点候选");
    expect(wrapper.text()).toContain("https://rpc1.example.org/");
    expect(wrapper.text()).toContain("https://rpc2.example.org/");
  });

  it("selects a Chainlist candidate on click and saves the override", async () => {
    const wrapper = mount(NetworksPage);
    const store = useNetworksStore();

    const changeButtons = wrapper
      .findAll("button")
      .filter((b) => b.text().includes("更改 RPC"));
    await changeButtons[0].trigger("click");
    await flushPromises();

    // Find candidate item with example.org and click it
    const candidateItem = wrapper
      .findAll(".rpc-candidate-item")
      .find((item) => item.text().includes("rpc1.example.org"));
    expect(candidateItem).toBeDefined();

    await candidateItem!.trigger("click");
    await flushPromises();

    // Check that draft was populated
    const rpcInput = wrapper.find('input[placeholder="https://rpc.example.org"]');
    expect((rpcInput.element as HTMLInputElement).value).toContain("rpc1.example.org");

    // Submit the form
    const form = wrapper.find("form");
    await form.trigger("submit");
    await flushPromises();

    expect(store.hasNetworkRpcOverride("ethereum")).toBe(true);
  });

  it("searches and auto-populates custom network from Chainlist", async () => {
    const wrapper = mount(NetworksPage);

    const searchInput = wrapper.find('input[placeholder*="搜索网络名称"]');
    expect(searchInput.exists()).toBe(true);

    await searchInput.setValue("gnosis");
    // Trigger input and wait debounce
    await new Promise((r) => setTimeout(r, 300));
    await flushPromises();

    expect(wrapper.text()).toContain("Gnosis");
    expect(wrapper.text()).toContain("Chain ID: 100");

    const importButton = wrapper
      .findAll(".chainlist-search-item button")
      .find((b) => b.text().includes("导入此网络"));
    expect(importButton).toBeDefined();
    await importButton!.trigger("click");
    await flushPromises();

    // Verify draft input fields were populated
    const nameInput = wrapper.find('input[placeholder="My Rollup"]');
    expect((nameInput.element as HTMLInputElement).value).toBe("Gnosis");

    const chainIdInput = wrapper.find('input[placeholder="84532"]');
    expect((chainIdInput.element as HTMLInputElement).value).toBe("100");

    const symbolInput = wrapper.find('input[placeholder="ETH"]');
    expect((symbolInput.element as HTMLInputElement).value).toBe("xDAI");
  });
});
