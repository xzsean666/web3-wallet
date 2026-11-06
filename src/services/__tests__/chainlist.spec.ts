import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHAINLIST_CACHE_KEY,
  clearChainlistCache,
  fetchChainlistNetworks,
  getChainlistRpcsForChain,
  normalizeTrackingPolicy,
  parseChainlistData,
  readPersistedChainlistCache,
  sanitizeRpcUrl,
  searchChainlistChains,
  writePersistedChainlistCache,
} from "../chainlist";

describe("chainlist service", () => {
  beforeEach(() => {
    clearChainlistCache();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    clearChainlistCache();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  describe("sanitizeRpcUrl", () => {
    it("sanitizes valid HTTPS URLs and normalizes them", () => {
      expect(sanitizeRpcUrl("https://rpc.example.org")).toBe("https://rpc.example.org/");
      expect(sanitizeRpcUrl("  https://mainnet.base.org/  ")).toBe("https://mainnet.base.org/");
    });

    it("rejects non-string or empty URLs", () => {
      expect(sanitizeRpcUrl(null)).toBeNull();
      expect(sanitizeRpcUrl(undefined)).toBeNull();
      expect(sanitizeRpcUrl("   ")).toBeNull();
      expect(sanitizeRpcUrl(123)).toBeNull();
    });

    it("rejects URLs with environment variable / API key placeholders", () => {
      expect(sanitizeRpcUrl("https://mainnet.infura.io/v3/${INFURA_API_KEY}")).toBeNull();
      expect(sanitizeRpcUrl("https://eth-mainnet.alchemyapi.io/v2/${ALCHEMY_API_KEY}")).toBeNull();
      expect(sanitizeRpcUrl("https://api.example.com/<api-key>")).toBeNull();
    });

    it("rejects websocket URLs", () => {
      expect(sanitizeRpcUrl("wss://ethereum-rpc.publicnode.com")).toBeNull();
      expect(sanitizeRpcUrl("ws://localhost:8545")).toBeNull();
    });
  });

  describe("normalizeTrackingPolicy", () => {
    it("preserves recognized tracking labels", () => {
      expect(normalizeTrackingPolicy("none")).toBe("none");
      expect(normalizeTrackingPolicy("limited")).toBe("limited");
      expect(normalizeTrackingPolicy("yes")).toBe("yes");
    });

    it("defaults to unknown for unrecognized or missing values", () => {
      expect(normalizeTrackingPolicy(null)).toBe("unknown");
      expect(normalizeTrackingPolicy(undefined)).toBe("unknown");
      expect(normalizeTrackingPolicy("random")).toBe("unknown");
    });
  });

  describe("parseChainlistData", () => {
    it("parses chainlist objects and cleans RPC endpoints", () => {
      const mockRaw = [
        {
          name: "Ethereum Mainnet",
          chainId: 1,
          chain: "ETH",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpc: [
            { url: "https://ethereum-rpc.publicnode.com", tracking: "none" },
            { url: "wss://ethereum-rpc.publicnode.com", tracking: "none" },
            { url: "https://mainnet.infura.io/v3/${INFURA_API_KEY}", tracking: "limited" },
            "https://cloudflare-eth.com",
          ],
          explorers: [
            { name: "etherscan", url: "https://etherscan.io", standard: "EIP3091" },
          ],
        },
      ];

      const parsed = parseChainlistData(mockRaw);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].chainId).toBe(1);
      expect(parsed[0].name).toBe("Ethereum Mainnet");
      expect(parsed[0].nativeCurrency?.symbol).toBe("ETH");
      expect(parsed[0].rpc).toEqual([
        { url: "https://ethereum-rpc.publicnode.com/", tracking: "none", isOpenSource: undefined },
        { url: "https://cloudflare-eth.com/", tracking: "unknown", isOpenSource: undefined },
      ]);
      expect(parsed[0].explorers?.[0].url).toBe("https://etherscan.io");
    });

    it("ignores non-array or invalid chain entries", () => {
      expect(parseChainlistData(null)).toEqual([]);
      expect(parseChainlistData({})).toEqual([]);
      expect(parseChainlistData([{ chainId: "invalid" }, null, { chainId: -5 }])).toEqual([]);
    });
  });

  describe("cache persistence", () => {
    it("writes and reads persisted chainlist data", () => {
      const mockData = [
        {
          chainId: 1,
          name: "Ethereum",
          rpc: [{ url: "https://ethereum-rpc.publicnode.com/", tracking: "none" as const }],
        },
      ];

      writePersistedChainlistCache(mockData);
      const readBack = readPersistedChainlistCache();
      expect(readBack).toEqual(mockData);

      clearChainlistCache();
      expect(readPersistedChainlistCache()).toBeNull();
    });

    it("ignores expired cache entries", () => {
      window.localStorage.setItem(
        CHAINLIST_CACHE_KEY,
        JSON.stringify({
          timestamp: Date.now() - 48 * 60 * 60 * 1000, // 48h ago (TTL is 24h)
          networks: [{ chainId: 1, name: "Ethereum", rpc: [] }],
        }),
      );

      expect(readPersistedChainlistCache()).toBeNull();
    });
  });

  describe("getChainlistRpcsForChain", () => {
    it("returns merged RPC candidates including curated presets for known chains", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Offline"));
      vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Offline"));

      const rpcs = await getChainlistRpcsForChain(1);
      expect(rpcs.length).toBeGreaterThan(0);
      const urls = rpcs.map((r) => r.url);
      expect(urls).toContain("https://ethereum-rpc.publicnode.com/");
      expect(urls).toContain("https://cloudflare-eth.com/");
    });

    it("prioritizes freshly fetched RPCs and complements with fallback presets", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              name: "Optimism",
              chainId: 10,
              rpc: [{ url: "https://custom-op.example.org", tracking: "none" }],
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

      const rpcs = await getChainlistRpcsForChain(10, { forceRefresh: true });
      const urls = rpcs.map((r) => r.url);
      expect(urls).toContain("https://custom-op.example.org/");
      expect(urls).toContain("https://optimism-rpc.publicnode.com/");
    });
  });

  describe("searchChainlistChains", () => {
    it("finds chains by chainId or name keyword", async () => {
      const mockData = [
        {
          chainId: 8453,
          name: "Base",
          chain: "ETH",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpc: [{ url: "https://mainnet.base.org/", tracking: "none" as const }],
        },
        {
          chainId: 10,
          name: "OP Mainnet",
          chain: "ETH",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpc: [{ url: "https://mainnet.optimism.io/", tracking: "none" as const }],
        },
      ];

      writePersistedChainlistCache(mockData);

      const searchById = await searchChainlistChains("8453");
      expect(searchById).toHaveLength(1);
      expect(searchById[0].name).toBe("Base");

      const searchByName = await searchChainlistChains("base");
      expect(searchByName).toHaveLength(1);
      expect(searchByName[0].chainId).toBe(8453);

      const emptySearch = await searchChainlistChains("   ");
      expect(emptySearch).toEqual([]);
    });
  });

  describe("fetchChainlistNetworks error handling", () => {
    it("falls back gracefully when both endpoints throw network errors", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network offline"));

      const networks = await fetchChainlistNetworks({ forceRefresh: true });
      expect(networks.length).toBeGreaterThan(0);
      expect(networks.some((n) => n.chainId === 1)).toBe(true);
    });
  });
});
