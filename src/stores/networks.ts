import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import {
  clearNetworkScopedUiState,
  loadPersistedUiState,
  patchPersistedUiState,
} from "../services/uiState";
import type {
  NetworkConfig,
  NetworkDraft,
  NetworkEnvironment,
  NetworkRpcOverrides,
} from "../types/network";
import {
  normalizeAllowedExplorerUrl,
  normalizeAllowedRpcUrl,
} from "../utils/runtimeSafety";
import { useWalletStore } from "./wallet";

const presetNetworks: NetworkConfig[] = [
  {
    id: "ethereum",
    source: "preset",
    environment: "mainnet",
    name: "Ethereum",
    chainId: 1,
    rpcUrl: "https://ethereum-rpc.publicnode.com",
    symbol: "ETH",
    explorerUrl: "https://etherscan.io",
  },
  {
    id: "base",
    source: "preset",
    environment: "mainnet",
    name: "Base",
    chainId: 8453,
    rpcUrl: "https://base-rpc.publicnode.com",
    symbol: "ETH",
    explorerUrl: "https://basescan.org",
  },
  {
    id: "optimism",
    source: "preset",
    environment: "mainnet",
    name: "Optimism",
    chainId: 10,
    rpcUrl: "https://optimism-rpc.publicnode.com",
    symbol: "ETH",
    explorerUrl: "https://optimistic.etherscan.io",
  },
  {
    id: "arbitrum",
    source: "preset",
    environment: "mainnet",
    name: "Arbitrum One",
    chainId: 42161,
    rpcUrl: "https://arbitrum-one-rpc.publicnode.com",
    symbol: "ETH",
    explorerUrl: "https://arbiscan.io",
  },
  {
    id: "bsc",
    source: "preset",
    environment: "mainnet",
    name: "BNB Smart Chain",
    chainId: 56,
    rpcUrl: "https://bsc-dataseed.bnbchain.org",
    symbol: "BNB",
    explorerUrl: "https://bscscan.com",
  },
  {
    id: "polygon",
    source: "preset",
    environment: "mainnet",
    name: "Polygon",
    chainId: 137,
    rpcUrl: "https://polygon.drpc.org",
    symbol: "POL",
    explorerUrl: "https://polygonscan.com",
  },
  {
    id: "astar",
    source: "preset",
    environment: "mainnet",
    name: "Astar",
    chainId: 592,
    rpcUrl: "https://evm.astar.network",
    symbol: "ASTR",
    explorerUrl: "https://blockscout.com/astar",
  },
  {
    id: "soneium",
    source: "preset",
    environment: "mainnet",
    name: "Soneium",
    chainId: 1868,
    rpcUrl: "https://rpc.soneium.org",
    symbol: "ETH",
    explorerUrl: "https://soneium.blockscout.com",
  },
  {
    id: "base-sepolia",
    source: "preset",
    environment: "testnet",
    name: "Base Sepolia",
    chainId: 84532,
    rpcUrl: "https://sepolia.base.org",
    symbol: "ETH",
    explorerUrl: "https://sepolia.basescan.org",
  },
  {
    id: "op-sepolia",
    source: "preset",
    environment: "testnet",
    name: "OP Sepolia",
    chainId: 11155420,
    rpcUrl: "https://sepolia.optimism.io",
    symbol: "ETH",
    explorerUrl: "https://sepolia-optimism.etherscan.io",
  },
  {
    id: "bsc-testnet",
    source: "preset",
    environment: "testnet",
    name: "BSC Testnet",
    chainId: 97,
    rpcUrl: "https://data-seed-prebsc-1-s1.bnbchain.org:8545",
    symbol: "tBNB",
    explorerUrl: "https://testnet.bscscan.com",
  },
  {
    id: "opbnb-testnet",
    source: "preset",
    environment: "testnet",
    name: "opBNB Testnet",
    chainId: 5611,
    rpcUrl: "https://opbnb-testnet-rpc.bnbchain.org",
    symbol: "tBNB",
    explorerUrl: "https://testnet.opbnbscan.com",
  },
  {
    id: "polygon-amoy",
    source: "preset",
    environment: "testnet",
    name: "Polygon Amoy",
    chainId: 80002,
    rpcUrl: "https://rpc-amoy.polygon.technology",
    symbol: "POL",
    explorerUrl: "https://amoy.polygonscan.com",
  },
  {
    id: "astar-shibuya",
    source: "preset",
    environment: "testnet",
    name: "Astar Shibuya",
    chainId: 81,
    rpcUrl: "https://evm.shibuya.astar.network",
    symbol: "SBY",
    explorerUrl: "https://blockscout.com/shibuya",
  },
  {
    id: "soneium-minato",
    source: "preset",
    environment: "testnet",
    name: "Soneium Minato",
    chainId: 1946,
    rpcUrl: "https://rpc.minato.soneium.org",
    symbol: "ETH",
    explorerUrl: "https://soneium-minato.blockscout.com",
  },
];

type PersistedNetworkConfig = Omit<NetworkConfig, "environment"> & {
  environment?: NetworkEnvironment;
};

type NormalizedNetworkDraft = Omit<NetworkDraft, "environment"> & {
  environment: NetworkEnvironment;
};

function isNetworkEnvironment(value: unknown): value is NetworkEnvironment {
  return value === "mainnet" || value === "testnet";
}

function normalizeNetworkEnvironment(value: unknown): NetworkEnvironment {
  return value === "testnet" ? "testnet" : "mainnet";
}

function normalizeNetworkDraft(draft: NetworkDraft): NormalizedNetworkDraft {
  return {
    name: draft.name.trim(),
    chainId: draft.chainId.trim(),
    rpcUrl: draft.rpcUrl.trim(),
    symbol: draft.symbol.trim().toUpperCase(),
    explorerUrl: draft.explorerUrl.trim(),
    environment: normalizeNetworkEnvironment(draft.environment),
  };
}

function isPersistedCustomNetwork(value: unknown): value is PersistedNetworkConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const network = value as Record<string, unknown>;
  const rpcUrl =
    typeof network.rpcUrl === "string" ? normalizeAllowedRpcUrl(network.rpcUrl) : null;
  const explorerUrl =
    typeof network.explorerUrl === "string"
      ? normalizeAllowedExplorerUrl(network.explorerUrl)
      : network.explorerUrl === undefined
        ? undefined
        : null;

  return (
    typeof network.id === "string" &&
    typeof network.name === "string" &&
    (network.environment === undefined || isNetworkEnvironment(network.environment)) &&
    typeof network.chainId === "number" &&
    Number.isInteger(network.chainId) &&
    network.chainId > 0 &&
    rpcUrl !== null &&
    typeof network.symbol === "string" &&
    explorerUrl !== null
  );
}

function hydrateCustomNetworks(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isPersistedCustomNetwork)
    .map((network) => {
      const normalizedRpcUrl =
        normalizeAllowedRpcUrl(network.rpcUrl)?.toString() ?? network.rpcUrl;
      const normalizedExplorerUrl = network.explorerUrl
        ? normalizeAllowedExplorerUrl(network.explorerUrl)?.toString() ?? undefined
        : undefined;

      return {
        ...network,
        rpcUrl: normalizedRpcUrl,
        explorerUrl: normalizedExplorerUrl,
        environment: normalizeNetworkEnvironment(network.environment),
        source: "custom" as const,
      };
    });
}

function hydrateNetworkRpcOverrides(value: unknown): NetworkRpcOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([networkId]) => presetNetworks.some((network) => network.id === networkId))
      .map(([networkId, rpcUrl]) => {
        if (typeof rpcUrl !== "string") {
          return null;
        }

        const normalizedRpcUrl = normalizeAllowedRpcUrl(rpcUrl);
        return normalizedRpcUrl ? [networkId, normalizedRpcUrl.toString()] : null;
      })
      .filter((entry): entry is [string, string] => entry !== null),
  );
}

export const useNetworksStore = defineStore("networks", () => {
  const walletStore = useWalletStore();
  const persistedState = loadPersistedUiState();
  const customNetworks = ref<NetworkConfig[]>(
    hydrateCustomNetworks(persistedState.customNetworks),
  );
  const networkRpcOverrides = ref<NetworkRpcOverrides>(
    hydrateNetworkRpcOverrides(persistedState.networkRpcOverrides),
  );
  const activeNetworkId = ref(
    typeof persistedState.activeNetworkId === "string" ? persistedState.activeNetworkId : "ethereum",
  );

  const presetNetworksWithRpcOverrides = computed(() =>
    presetNetworks.map((network) => ({
      ...network,
      rpcUrl: networkRpcOverrides.value[network.id] ?? network.rpcUrl,
    })),
  );
  const allNetworks = computed(() => [...presetNetworksWithRpcOverrides.value, ...customNetworks.value]);
  const activeNetwork = computed(
    () => allNetworks.value.find((network) => network.id === activeNetworkId.value) ?? presetNetworks[0],
  );

  if (!allNetworks.value.some((network) => network.id === activeNetworkId.value)) {
    activeNetworkId.value = presetNetworks[0].id;
  }

  function validateDraft(draft: NetworkDraft, editingId?: string) {
    const normalizedDraft = normalizeNetworkDraft(draft);
    const errors: string[] = [];

    if (!normalizedDraft.name) {
      errors.push("网络名称不能为空");
    }

    const chainIdValue = Number(normalizedDraft.chainId);
    if (!Number.isInteger(chainIdValue) || chainIdValue <= 0) {
      errors.push("Chain ID 必须是大于 0 的整数");
    }

    try {
      if (!normalizeAllowedRpcUrl(normalizedDraft.rpcUrl)) {
        errors.push("RPC URL 必须是 HTTPS 地址，或本机回环地址上的 HTTP/HTTPS");
      }
    } catch {
      errors.push("RPC URL 必须是 HTTPS 地址，或本机回环地址上的 HTTP/HTTPS");
    }

    if (!normalizedDraft.symbol || normalizedDraft.symbol.length > 8) {
      errors.push("原生币符号不能为空，且长度不能超过 8 个字符");
    }

    if (normalizedDraft.explorerUrl) {
      try {
        if (!normalizeAllowedExplorerUrl(normalizedDraft.explorerUrl)) {
          errors.push("区块浏览器 URL 必须是 HTTPS 地址，或本机回环地址上的 HTTP/HTTPS");
        }
      } catch {
        errors.push("区块浏览器 URL 必须是 HTTPS 地址，或本机回环地址上的 HTTP/HTTPS");
      }
    }

    const hasDuplicateChainId = allNetworks.value.some(
      (network) => network.chainId === chainIdValue && network.id !== editingId,
    );

    if (hasDuplicateChainId) {
      errors.push("Chain ID 已存在，请避免和当前网络重复");
    }

    return {
      errors,
      normalizedDraft,
    };
  }

  function saveCustomNetwork(draft: NetworkDraft, editingId?: string) {
    const { errors, normalizedDraft } = validateDraft(draft, editingId);

    if (errors.length > 0) {
      return {
        ok: false as const,
        errors,
      };
    }

    const existingNetwork = editingId
      ? customNetworks.value.find((network) => network.id === editingId) ?? null
      : null;
    const shouldRotateScopeId =
      existingNetwork !== null && existingNetwork.chainId !== Number(normalizedDraft.chainId);
    const nextNetworkId = shouldRotateScopeId
      ? `custom-${Number(normalizedDraft.chainId)}`
      : editingId ?? `custom-${Number(normalizedDraft.chainId)}`;
    const normalizedRpcUrl = normalizeAllowedRpcUrl(normalizedDraft.rpcUrl);
    const normalizedExplorerUrl = normalizedDraft.explorerUrl
      ? normalizeAllowedExplorerUrl(normalizedDraft.explorerUrl)
      : null;

    if (!normalizedRpcUrl || (normalizedDraft.explorerUrl && !normalizedExplorerUrl)) {
      return {
        ok: false as const,
        errors: ["网络 URL 校验失败，请重新检查 RPC / 区块浏览器地址"],
      };
    }

    const nextNetwork: NetworkConfig = {
      id: nextNetworkId,
      source: "custom",
      environment: normalizedDraft.environment,
      name: normalizedDraft.name,
      chainId: Number(normalizedDraft.chainId),
      rpcUrl: normalizedRpcUrl.toString(),
      symbol: normalizedDraft.symbol,
      explorerUrl: normalizedDraft.explorerUrl
        ? normalizedExplorerUrl?.toString() ?? undefined
        : undefined,
    };

    if (editingId) {
      customNetworks.value = customNetworks.value.map((network) =>
        network.id === editingId ? nextNetwork : network,
      );
      if (shouldRotateScopeId) {
        clearNetworkScopedUiState(editingId);
        walletStore.removeNetworkScopedData(editingId);
      }
    } else {
      customNetworks.value = [...customNetworks.value, nextNetwork];
    }

    activeNetworkId.value = nextNetwork.id;

    return {
      ok: true as const,
      errors: [],
      network: nextNetwork,
    };
  }

  function removeCustomNetwork(id: string) {
    customNetworks.value = customNetworks.value.filter((network) => network.id !== id);
    clearNetworkScopedUiState(id);
    walletStore.removeNetworkScopedData(id);

    if (activeNetworkId.value === id) {
      activeNetworkId.value = presetNetworks[0].id;
    }
  }

  function setActiveNetwork(id: string) {
    if (allNetworks.value.some((network) => network.id === id)) {
      activeNetworkId.value = id;
    }
  }

  function validateRpcUrl(rpcUrl: string) {
    const normalizedRpcUrl = normalizeAllowedRpcUrl(rpcUrl.trim());

    if (!normalizedRpcUrl) {
      return {
        errors: ["RPC URL 必须是 HTTPS 地址，或本机回环地址上的 HTTP/HTTPS"],
        normalizedRpcUrl: null,
      };
    }

    return {
      errors: [],
      normalizedRpcUrl: normalizedRpcUrl.toString(),
    };
  }

  function saveNetworkRpcUrl(id: string, rpcUrl: string) {
    const network = allNetworks.value.find((entry) => entry.id === id) ?? null;

    if (!network) {
      return {
        ok: false as const,
        errors: ["找不到要更新 RPC 的网络"],
      };
    }

    const { errors, normalizedRpcUrl } = validateRpcUrl(rpcUrl);

    if (errors.length > 0 || !normalizedRpcUrl) {
      return {
        ok: false as const,
        errors,
      };
    }

    if (network.source === "preset") {
      const presetNetwork = presetNetworks.find((entry) => entry.id === id);

      if (!presetNetwork) {
        return {
          ok: false as const,
          errors: ["找不到预置网络默认 RPC"],
        };
      }

      const nextOverrides = { ...networkRpcOverrides.value };

      if (normalizedRpcUrl === presetNetwork.rpcUrl) {
        delete nextOverrides[id];
      } else {
        nextOverrides[id] = normalizedRpcUrl;
      }

      networkRpcOverrides.value = nextOverrides;
    } else {
      customNetworks.value = customNetworks.value.map((entry) =>
        entry.id === id ? { ...entry, rpcUrl: normalizedRpcUrl } : entry,
      );
    }

    return {
      ok: true as const,
      errors: [],
    };
  }

  function clearNetworkRpcOverride(id: string) {
    if (!networkRpcOverrides.value[id]) {
      return;
    }

    const nextOverrides = { ...networkRpcOverrides.value };
    delete nextOverrides[id];
    networkRpcOverrides.value = nextOverrides;
  }

  function hasNetworkRpcOverride(id: string) {
    return Boolean(networkRpcOverrides.value[id]);
  }

  function getDefaultNetworkRpcUrl(id: string) {
    return presetNetworks.find((network) => network.id === id)?.rpcUrl ?? null;
  }

  watch(
    customNetworks,
    (nextNetworks) => {
      patchPersistedUiState({
        customNetworks: nextNetworks,
      });
    },
    {
      deep: true,
    },
  );

  watch(
    networkRpcOverrides,
    (nextOverrides) => {
      patchPersistedUiState({
        networkRpcOverrides:
          Object.keys(nextOverrides).length > 0 ? nextOverrides : undefined,
      });
    },
    {
      deep: true,
    },
  );

  watch(activeNetworkId, (nextActiveNetworkId) => {
    patchPersistedUiState({
      activeNetworkId: nextActiveNetworkId,
    });
  });

  return {
    activeNetwork,
    activeNetworkId,
    allNetworks,
    clearNetworkRpcOverride,
    customNetworks,
    getDefaultNetworkRpcUrl,
    hasNetworkRpcOverride,
    networkRpcOverrides,
    removeCustomNetwork,
    saveNetworkRpcUrl,
    saveCustomNetwork,
    setActiveNetwork,
    validateDraft,
    validateRpcUrl,
  };
});
