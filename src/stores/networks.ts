import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import { loadPersistedUiState, patchPersistedUiState } from "../services/uiState";
import type { NetworkConfig, NetworkDraft } from "../types/network";

const presetNetworks: NetworkConfig[] = [
  {
    id: "ethereum",
    source: "preset",
    name: "Ethereum",
    chainId: 1,
    rpcUrl: "https://ethereum-rpc.publicnode.com",
    symbol: "ETH",
    explorerUrl: "https://etherscan.io",
  },
  {
    id: "base",
    source: "preset",
    name: "Base",
    chainId: 8453,
    rpcUrl: "https://base-rpc.publicnode.com",
    symbol: "ETH",
    explorerUrl: "https://basescan.org",
  },
  {
    id: "optimism",
    source: "preset",
    name: "Optimism",
    chainId: 10,
    rpcUrl: "https://optimism-rpc.publicnode.com",
    symbol: "ETH",
    explorerUrl: "https://optimistic.etherscan.io",
  },
  {
    id: "arbitrum",
    source: "preset",
    name: "Arbitrum One",
    chainId: 42161,
    rpcUrl: "https://arbitrum-one-rpc.publicnode.com",
    symbol: "ETH",
    explorerUrl: "https://arbiscan.io",
  },
];

function normalizeNetworkDraft(draft: NetworkDraft): NetworkDraft {
  return {
    name: draft.name.trim(),
    chainId: draft.chainId.trim(),
    rpcUrl: draft.rpcUrl.trim(),
    symbol: draft.symbol.trim().toUpperCase(),
    explorerUrl: draft.explorerUrl.trim(),
  };
}

function isPersistedCustomNetwork(value: unknown): value is NetworkConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const network = value as Record<string, unknown>;

  return (
    typeof network.id === "string" &&
    typeof network.name === "string" &&
    typeof network.chainId === "number" &&
    Number.isInteger(network.chainId) &&
    network.chainId > 0 &&
    typeof network.rpcUrl === "string" &&
    typeof network.symbol === "string" &&
    (!("explorerUrl" in network) ||
      typeof network.explorerUrl === "string" ||
      typeof network.explorerUrl === "undefined")
  );
}

function hydrateCustomNetworks(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isPersistedCustomNetwork)
    .map((network) => ({
      ...network,
      source: "custom" as const,
    }));
}

export const useNetworksStore = defineStore("networks", () => {
  const persistedState = loadPersistedUiState();
  const customNetworks = ref<NetworkConfig[]>(
    hydrateCustomNetworks(persistedState.customNetworks),
  );
  const activeNetworkId = ref(
    typeof persistedState.activeNetworkId === "string" ? persistedState.activeNetworkId : "ethereum",
  );

  const allNetworks = computed(() => [...presetNetworks, ...customNetworks.value]);
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
      const rpc = new URL(normalizedDraft.rpcUrl);
      if (!["http:", "https:"].includes(rpc.protocol)) {
        errors.push("RPC URL 必须是合法的 HTTP 或 HTTPS 地址");
      }
    } catch {
      errors.push("RPC URL 必须是合法的 HTTP 或 HTTPS 地址");
    }

    if (!normalizedDraft.symbol || normalizedDraft.symbol.length > 8) {
      errors.push("原生币符号不能为空，且长度不能超过 8 个字符");
    }

    if (normalizedDraft.explorerUrl) {
      try {
        const explorer = new URL(normalizedDraft.explorerUrl);
        if (!["http:", "https:"].includes(explorer.protocol)) {
          errors.push("区块浏览器 URL 必须是合法的 HTTP 或 HTTPS 地址");
        }
      } catch {
        errors.push("区块浏览器 URL 必须是合法的 HTTP 或 HTTPS 地址");
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

    const nextNetwork: NetworkConfig = {
      id: editingId ?? `custom-${Number(normalizedDraft.chainId)}`,
      source: "custom",
      name: normalizedDraft.name,
      chainId: Number(normalizedDraft.chainId),
      rpcUrl: normalizedDraft.rpcUrl,
      symbol: normalizedDraft.symbol,
      explorerUrl: normalizedDraft.explorerUrl || undefined,
    };

    if (editingId) {
      customNetworks.value = customNetworks.value.map((network) =>
        network.id === editingId ? nextNetwork : network,
      );
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

    if (activeNetworkId.value === id) {
      activeNetworkId.value = presetNetworks[0].id;
    }
  }

  function setActiveNetwork(id: string) {
    if (allNetworks.value.some((network) => network.id === id)) {
      activeNetworkId.value = id;
    }
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

  watch(activeNetworkId, (nextActiveNetworkId) => {
    patchPersistedUiState({
      activeNetworkId: nextActiveNetworkId,
    });
  });

  return {
    activeNetwork,
    activeNetworkId,
    allNetworks,
    customNetworks,
    removeCustomNetwork,
    saveCustomNetwork,
    setActiveNetwork,
    validateDraft,
  };
});
