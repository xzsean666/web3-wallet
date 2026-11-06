import type {
  ChainlistNetworkData,
  ChainlistRpcItem,
  RpcSpeedTestResult,
  RpcTrackingPolicy,
} from "../types/network";
import { normalizeAllowedRpcUrl } from "../utils/runtimeSafety";
import { validateRpcEndpoint } from "./evm";

export const CHAINLIST_RPCS_URL = "https://chainlist.org/rpcs.json";
export const CHAINID_NETWORK_URL = "https://chainid.network/chains.json";
export const CHAINLIST_CACHE_KEY = "web3_wallet_chainlist_networks_cache_v1";
export const CHAINLIST_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export const PRESET_RPC_FALLBACKS: Record<number, ChainlistRpcItem[]> = {
  // Ethereum Mainnet
  1: [
    { url: "https://ethereum-rpc.publicnode.com", tracking: "none" },
    { url: "https://cloudflare-eth.com", tracking: "none" },
    { url: "https://1rpc.io/eth", tracking: "none" },
    { url: "https://rpc.ankr.com/eth", tracking: "limited" },
    { url: "https://eth.llamarpc.com", tracking: "none" },
  ],
  // Base
  8453: [
    { url: "https://base-rpc.publicnode.com", tracking: "none" },
    { url: "https://mainnet.base.org", tracking: "none" },
    { url: "https://1rpc.io/base", tracking: "none" },
    { url: "https://base.llamarpc.com", tracking: "none" },
  ],
  // Optimism
  10: [
    { url: "https://optimism-rpc.publicnode.com", tracking: "none" },
    { url: "https://mainnet.optimism.io", tracking: "none" },
    { url: "https://1rpc.io/op", tracking: "none" },
    { url: "https://optimism.llamarpc.com", tracking: "none" },
  ],
  // Arbitrum One
  42161: [
    { url: "https://arbitrum-one-rpc.publicnode.com", tracking: "none" },
    { url: "https://arb1.arbitrum.io/rpc", tracking: "none" },
    { url: "https://1rpc.io/arb", tracking: "none" },
    { url: "https://arbitrum.llamarpc.com", tracking: "none" },
  ],
  // BNB Smart Chain
  56: [
    { url: "https://bsc-dataseed.bnbchain.org", tracking: "none" },
    { url: "https://binance.llamarpc.com", tracking: "none" },
    { url: "https://1rpc.io/bnb", tracking: "none" },
    { url: "https://bsc-dataseed1.defibit.io", tracking: "none" },
  ],
  // Polygon
  137: [
    { url: "https://polygon.drpc.org", tracking: "limited" },
    { url: "https://polygon-rpc.com", tracking: "none" },
    { url: "https://1rpc.io/matic", tracking: "none" },
    { url: "https://polygon.llamarpc.com", tracking: "none" },
  ],
  // Astar
  592: [
    { url: "https://evm.astar.network", tracking: "none" },
    { url: "https://astar.public.blastapi.io", tracking: "none" },
    { url: "https://1rpc.io/astr", tracking: "none" },
  ],
  // Soneium
  1868: [
    { url: "https://rpc.soneium.org", tracking: "none" },
  ],
  // Base Sepolia
  84532: [
    { url: "https://sepolia.base.org", tracking: "none" },
    { url: "https://base-sepolia-rpc.publicnode.com", tracking: "none" },
  ],
  // OP Sepolia
  11155420: [
    { url: "https://sepolia.optimism.io", tracking: "none" },
    { url: "https://op-sepolia-rpc.publicnode.com", tracking: "none" },
  ],
  // BSC Testnet
  97: [
    { url: "https://data-seed-prebsc-1-s1.bnbchain.org:8545", tracking: "none" },
    { url: "https://bsc-testnet.publicnode.com", tracking: "none" },
  ],
  // opBNB Testnet
  5611: [
    { url: "https://opbnb-testnet-rpc.bnbchain.org", tracking: "none" },
  ],
  // Polygon Amoy
  80002: [
    { url: "https://rpc-amoy.polygon.technology", tracking: "none" },
    { url: "https://polygon-amoy.drpc.org", tracking: "limited" },
  ],
  // Astar Shibuya
  81: [
    { url: "https://evm.shibuya.astar.network", tracking: "none" },
  ],
  // Soneium Minato
  1946: [
    { url: "https://rpc.minato.soneium.org", tracking: "none" },
  ],
};

let inMemoryCache: { timestamp: number; networks: ChainlistNetworkData[] } | null = null;

export function sanitizeRpcUrl(rawUrl: unknown): string | null {
  if (typeof rawUrl !== "string") {
    return null;
  }

  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return null;
  }

  // Filter out URLs containing variables like ${INFURA_API_KEY} or WebSocket urls
  if (trimmed.includes("${") || trimmed.includes("<") || trimmed.toLowerCase().startsWith("wss:")) {
    return null;
  }

  const normalized = normalizeAllowedRpcUrl(trimmed);
  if (!normalized) {
    return null;
  }

  return normalized.toString();
}

export function normalizeTrackingPolicy(value: unknown): RpcTrackingPolicy {
  if (value === "none" || value === "limited" || value === "yes") {
    return value;
  }
  return "unknown";
}

function parseRawChainItem(raw: unknown): ChainlistNetworkData | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const item = raw as Record<string, unknown>;
  const chainId = typeof item.chainId === "number" ? item.chainId : Number(item.chainId);
  if (!Number.isInteger(chainId) || chainId <= 0) {
    return null;
  }

  const name = typeof item.name === "string" ? item.name.trim() : `Chain ${chainId}`;
  const rawRpcList = Array.isArray(item.rpc) ? item.rpc : [];

  const seenUrls = new Set<string>();
  const rpcItems: ChainlistRpcItem[] = [];

  for (const rawRpc of rawRpcList) {
    let candidateUrl: string | null = null;
    let tracking: RpcTrackingPolicy = "unknown";
    let isOpenSource = false;

    if (typeof rawRpc === "string") {
      candidateUrl = sanitizeRpcUrl(rawRpc);
    } else if (rawRpc && typeof rawRpc === "object") {
      const obj = rawRpc as Record<string, unknown>;
      candidateUrl = sanitizeRpcUrl(obj.url);
      tracking = normalizeTrackingPolicy(obj.tracking);
      isOpenSource = Boolean(obj.isOpenSource);
    }

    if (candidateUrl && !seenUrls.has(candidateUrl)) {
      seenUrls.add(candidateUrl);
      rpcItems.push({
        url: candidateUrl,
        tracking,
        isOpenSource: isOpenSource || undefined,
      });
    }
  }

  const nativeCurrency =
    item.nativeCurrency && typeof item.nativeCurrency === "object"
      ? {
          name: String((item.nativeCurrency as Record<string, unknown>).name ?? "Ether"),
          symbol: String((item.nativeCurrency as Record<string, unknown>).symbol ?? "ETH"),
          decimals: Number((item.nativeCurrency as Record<string, unknown>).decimals ?? 18),
        }
      : undefined;

  const rawExplorers = Array.isArray(item.explorers) ? item.explorers : [];
  const explorers = rawExplorers
    .filter((exp): exp is Record<string, unknown> => Boolean(exp && typeof exp === "object"))
    .map((exp) => ({
      name: String(exp.name ?? "Explorer"),
      url: String(exp.url ?? ""),
      standard: typeof exp.standard === "string" ? exp.standard : undefined,
    }))
    .filter((exp) => exp.url.startsWith("http"));

  return {
    chainId,
    name,
    chain: typeof item.chain === "string" ? item.chain : undefined,
    rpc: rpcItems,
    nativeCurrency,
    explorers: explorers.length > 0 ? explorers : undefined,
    infoURL: typeof item.infoURL === "string" ? item.infoURL : undefined,
    isTestnet: Boolean(item.isTestnet || item.status === "deprecated"),
  };
}

export function parseChainlistData(raw: unknown): ChainlistNetworkData[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const results: ChainlistNetworkData[] = [];
  for (const item of raw) {
    const parsed = parseRawChainItem(item);
    if (parsed) {
      results.push(parsed);
    }
  }

  return results;
}

export function readPersistedChainlistCache(): ChainlistNetworkData[] | null {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }

  try {
    const stored = window.localStorage.getItem(CHAINLIST_CACHE_KEY);
    if (!stored) {
      return null;
    }

    const parsed = JSON.parse(stored);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.timestamp === "number" &&
      Array.isArray(parsed.networks)
    ) {
      const isExpired = Date.now() - parsed.timestamp > CHAINLIST_CACHE_TTL_MS;
      if (!isExpired) {
        return parsed.networks as ChainlistNetworkData[];
      }
    }
  } catch {
    // Ignore read / parse errors
  }

  return null;
}

export function writePersistedChainlistCache(networks: ChainlistNetworkData[]): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  try {
    window.localStorage.setItem(
      CHAINLIST_CACHE_KEY,
      JSON.stringify({
        timestamp: Date.now(),
        networks,
      }),
    );
  } catch {
    // Ignore storage write errors (e.g. quota exceeded)
  }
}

export function clearChainlistCache(): void {
  inMemoryCache = null;
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      window.localStorage.removeItem(CHAINLIST_CACHE_KEY);
    } catch {
      // Ignore
    }
  }
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchChainlistNetworks(options: {
  forceRefresh?: boolean;
  timeoutMs?: number;
} = {}): Promise<ChainlistNetworkData[]> {
  const { forceRefresh = false, timeoutMs = 8000 } = options;

  if (!forceRefresh) {
    if (inMemoryCache && Date.now() - inMemoryCache.timestamp < CHAINLIST_CACHE_TTL_MS) {
      return inMemoryCache.networks;
    }

    const persisted = readPersistedChainlistCache();
    if (persisted && persisted.length > 0) {
      inMemoryCache = {
        timestamp: Date.now(),
        networks: persisted,
      };
      return persisted;
    }
  }

  let networks: ChainlistNetworkData[] = [];

  try {
    const res = await fetchWithTimeout(CHAINLIST_RPCS_URL, timeoutMs);
    if (res.ok) {
      const data = await res.json();
      networks = parseChainlistData(data);
    }
  } catch {
    // Primary failed, attempt fallback
  }

  if (networks.length === 0) {
    try {
      const resFallback = await fetchWithTimeout(CHAINID_NETWORK_URL, timeoutMs);
      if (resFallback.ok) {
        const data = await resFallback.json();
        networks = parseChainlistData(data);
      }
    } catch {
      // Fallback failed
    }
  }

  if (networks.length > 0) {
    inMemoryCache = {
      timestamp: Date.now(),
      networks,
    };
    writePersistedChainlistCache(networks);
    return networks;
  }

  // If both network requests failed, check if we have any stale cache
  const stale = readPersistedChainlistCache();
  if (stale && stale.length > 0) {
    return stale;
  }

  // Otherwise return preset fallback networks
  return buildFallbackChainlistNetworks();
}

function buildFallbackChainlistNetworks(): ChainlistNetworkData[] {
  return Object.entries(PRESET_RPC_FALLBACKS).map(([chainIdStr, rpcs]) => ({
    chainId: Number(chainIdStr),
    name: `Chain ${chainIdStr}`,
    rpc: rpcs,
  }));
}

export async function getChainlistRpcsForChain(
  chainId: number,
  options: { forceRefresh?: boolean; timeoutMs?: number } = {},
): Promise<ChainlistRpcItem[]> {
  const networks = await fetchChainlistNetworks(options);
  const matched = networks.find((net) => net.chainId === chainId);

  const seen = new Set<string>();
  const combined: ChainlistRpcItem[] = [];

  // Add Chainlist discovered RPCs first
  if (matched?.rpc) {
    for (const item of matched.rpc) {
      const normalized = sanitizeRpcUrl(item.url);
      if (normalized && !seen.has(normalized)) {
        seen.add(normalized);
        combined.push({
          url: normalized,
          tracking: item.tracking ?? "unknown",
          isOpenSource: item.isOpenSource,
        });
      }
    }
  }

  // Complement with curated fallback RPCs
  const fallbacks = PRESET_RPC_FALLBACKS[chainId] ?? [];
  for (const item of fallbacks) {
    const normalized = sanitizeRpcUrl(item.url);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      combined.push({
        url: normalized,
        tracking: item.tracking ?? "unknown",
        isOpenSource: item.isOpenSource,
      });
    }
  }

  return combined;
}

export async function getChainlistChain(
  chainId: number,
  options?: { forceRefresh?: boolean },
): Promise<ChainlistNetworkData | null> {
  const networks = await fetchChainlistNetworks(options);
  return networks.find((net) => net.chainId === chainId) ?? null;
}

export async function searchChainlistChains(
  keyword: string,
  options: { limit?: number; forceRefresh?: boolean } = {},
): Promise<ChainlistNetworkData[]> {
  const { limit = 20, forceRefresh = false } = options;
  const trimmed = keyword.trim().toLowerCase();
  if (!trimmed) {
    return [];
  }

  const networks = await fetchChainlistNetworks({ forceRefresh });
  const isNumeric = /^\d+$/.test(trimmed);
  const targetChainId = isNumeric ? Number(trimmed) : null;

  const matches: ChainlistNetworkData[] = [];

  for (const net of networks) {
    if (targetChainId !== null && net.chainId === targetChainId) {
      matches.unshift(net); // Exact chainId match takes priority
      continue;
    }

    const nameMatch = net.name.toLowerCase().includes(trimmed);
    const symbolMatch = net.nativeCurrency?.symbol.toLowerCase().includes(trimmed);
    const chainMatch = net.chain?.toLowerCase().includes(trimmed);

    if (nameMatch || symbolMatch || chainMatch) {
      matches.push(net);
    }

    if (matches.length >= limit) {
      break;
    }
  }

  return matches;
}

export async function testRpcLatency(
  chainId: number,
  rpcUrl: string,
  timeoutMs = 6000,
): Promise<RpcSpeedTestResult> {
  const validation = await validateRpcEndpoint({
    expectedChainId: chainId,
    rpcUrl,
    timeoutMs,
  });

  return {
    url: rpcUrl,
    status: validation.status,
    latencyMs: validation.latencyMs,
    latestBlock: validation.latestBlock,
    message: validation.message,
  };
}

export async function batchTestRpcLatencies(
  chainId: number,
  rpcUrls: string[],
  onProgress?: (result: RpcSpeedTestResult) => void,
  concurrency = 3,
): Promise<Record<string, RpcSpeedTestResult>> {
  const results: Record<string, RpcSpeedTestResult> = {};
  const queue = [...rpcUrls];

  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const url = queue.shift();
      if (!url) {
        break;
      }

      const result = await testRpcLatency(chainId, url);
      results[url] = result;
      if (onProgress) {
        onProgress(result);
      }
    }
  });

  await Promise.all(workers);
  return results;
}
