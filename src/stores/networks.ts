import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import {
  clearNetworkScopedUiState,
  loadPersistedUiState,
  patchPersistedUiState,
} from "../services/uiState";
import type { NetworkConfig, NetworkDraft } from "../types/network";
import {
  normalizeAllowedExplorerUrl,
  normalizeAllowedRpcUrl,
} from "../utils/runtimeSafety";
import { useWalletStore } from "./wallet";

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
    id: "base-sepolia",
    source: "preset",
    name: "Base Sepolia",
    chainId: 84532,
    rpcUrl: "https://sepolia.base.org",
    symbol: "ETH",
    explorerUrl: "https://sepolia.basescan.org",
  },
  {
    id: "op-sepolia",
    source: "preset",
    name: "OP Sepolia",
    chainId: 11155420,
    rpcUrl: "https://sepolia.optimism.io",
    symbol: "ETH",
    explorerUrl: "https://sepolia-optimism.etherscan.io",
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
  {
    id: "bsc-testnet",
    source: "preset",
    name: "BSC Testnet",
    chainId: 97,
    rpcUrl: "https://data-seed-prebsc-1-s1.bnbchain.org:8545",
    symbol: "tBNB",
    explorerUrl: "https://testnet.bscscan.com",
  },
  {
    id: "opbnb-testnet",
    source: "preset",
    name: "opBNB Testnet",
    chainId: 5611,
    rpcUrl: "https://opbnb-testnet-rpc.bnbchain.org",
    symbol: "tBNB",
    explorerUrl: "https://testnet.opbnbscan.com",
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
        source: "custom" as const,
      };
    });
}

export const useNetworksStore = defineStore("networks", () => {
  const walletStore = useWalletStore();
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
