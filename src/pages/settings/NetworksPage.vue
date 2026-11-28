<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { RouterLink } from "vue-router";
import SectionCard from "../../components/SectionCard.vue";
import WalletChrome from "../../components/WalletChrome.vue";
import {
  batchTestRpcLatencies,
  getChainlistRpcsForChain,
  PRESET_RPC_FALLBACKS,
  searchChainlistChains,
  testRpcLatency,
} from "../../services/chainlist";
import { validateRpcEndpoint } from "../../services/evm";
import { useNetworksStore } from "../../stores/networks";
import type {
  ChainlistNetworkData,
  ChainlistRpcItem,
  NetworkConfig,
  NetworkDraft,
  RpcEndpointValidation,
  RpcSpeedTestResult,
  RpcTrackingPolicy,
} from "../../types/network";
import { formatChainLabel, formatDateTime } from "../../utils/format";

const networksStore = useNetworksStore();
const { activeNetwork, allNetworks } = storeToRefs(networksStore);

const editingId = ref<string | null>(null);
const formErrors = ref<string[]>([]);
const isValidating = ref(false);
const validation = ref<RpcEndpointValidation | null>(null);
const validatedDraftKey = ref("");
const rpcEditingNetworkId = ref<string | null>(null);
const rpcDraft = ref("");
const rpcErrors = ref<string[]>([]);
const isValidatingRpcOverride = ref(false);
const rpcValidation = ref<RpcEndpointValidation | null>(null);
const validatedRpcDraftKey = ref("");
const isRpcModalOpen = ref(false);
const rpcModalSaveMessage = ref("");

// Chainlist RPC Selection for Editing Network
const chainlistRpcs = ref<ChainlistRpcItem[]>([]);
const isLoadingChainlist = ref(false);
const chainlistFilter = ref("");
const rpcLatencyResults = ref<Record<string, RpcSpeedTestResult>>({});
const isTestingBatchLatency = ref(false);
const testingSingleRpc = ref<Record<string, boolean>>({});

// Chainlist Search & Auto-fill for Custom Network
const chainlistSearchQuery = ref("");
const chainlistSearchResults = ref<ChainlistNetworkData[]>([]);
const isSearchingChainlist = ref(false);
const draftCandidateRpcs = ref<ChainlistRpcItem[]>([]);
const isDraftCandidateLoading = ref(false);

const draft = ref<NetworkDraft>({
  name: "",
  chainId: "",
  rpcUrl: "",
  symbol: "",
  explorerUrl: "",
  environment: "mainnet",
});
const customFormRef = ref<HTMLElement | null>(null);
let validationRequestId = 0;
let rpcValidationRequestId = 0;
let modalCloseTimer: number | null = null;

function normalizeRpcCompareKey(url: string | null | undefined) {
  return (url ?? "").trim().replace(/\/+$/, "").toLowerCase();
}

const draftKey = computed(() =>
  JSON.stringify({
    chainId: draft.value.chainId.trim(),
    rpcUrl: draft.value.rpcUrl.trim(),
    explorerUrl: draft.value.explorerUrl.trim(),
  }),
);
const rpcEditingNetwork = computed(() =>
  rpcEditingNetworkId.value
    ? allNetworks.value.find((network) => network.id === rpcEditingNetworkId.value) ?? null
    : null,
);
const rpcDraftKey = computed(() =>
  JSON.stringify({
    networkId: rpcEditingNetwork.value?.id ?? null,
    chainId: rpcEditingNetwork.value?.chainId ?? null,
    rpcUrl: rpcDraft.value.trim(),
  }),
);
const validationStatusLabel = computed(() => {
  if (!validation.value) {
    return "未校验";
  }

  if (validation.value.status === "ok") {
    return "节点可用";
  }

  if (validation.value.status === "mismatch") {
    return "Chain ID 不匹配";
  }

  return "节点不可用";
});
const rpcValidationStatusLabel = computed(() => {
  if (!rpcValidation.value) {
    return "未校验";
  }

  if (rpcValidation.value.status === "ok") {
    return "节点可用";
  }

  if (rpcValidation.value.status === "mismatch") {
    return "Chain ID 不匹配";
  }

  return "节点不可用";
});
const mainnetNetworks = computed(() =>
  allNetworks.value.filter((network) => network.environment === "mainnet"),
);
const testnetNetworks = computed(() =>
  allNetworks.value.filter((network) => network.environment === "testnet"),
);
const mainnetNetworkCount = computed(() => mainnetNetworks.value.length);
const testnetNetworkCount = computed(() => testnetNetworks.value.length);
const activeNetworkEnvironmentLabel = computed(() => networkEnvironmentLabel(activeNetwork.value));

const activeNetworkTab = ref<"mainnet" | "testnet">("mainnet");
const networkSearchQuery = ref("");

const filteredMainnetNetworks = computed(() => {
  const q = networkSearchQuery.value.trim().toLowerCase();
  if (!q) return mainnetNetworks.value;
  return mainnetNetworks.value.filter(
    (n) =>
      n.name.toLowerCase().includes(q) ||
      String(n.chainId).includes(q) ||
      n.symbol.toLowerCase().includes(q),
  );
});

const filteredTestnetNetworks = computed(() => {
  const q = networkSearchQuery.value.trim().toLowerCase();
  if (!q) return testnetNetworks.value;
  return testnetNetworks.value.filter(
    (n) =>
      n.name.toLowerCase().includes(q) ||
      String(n.chainId).includes(q) ||
      n.symbol.toLowerCase().includes(q),
  );
});

const sortedAndFilteredCandidates = computed(() => {
  const query = chainlistFilter.value.trim().toLowerCase();
  let list = chainlistRpcs.value;

  if (query) {
    list = list.filter((item) => item.url.toLowerCase().includes(query));
  }

  return [...list].sort((a, b) => {
    const aSelected = isSelectedCandidate(a.url);
    const bSelected = isSelectedCandidate(b.url);
    if (aSelected && !bSelected) return -1;
    if (!aSelected && bSelected) return 1;

    const aRes = rpcLatencyResults.value[a.url];
    const bRes = rpcLatencyResults.value[b.url];

    if (aRes && bRes) {
      if (aRes.status === "ok" && bRes.status === "ok") {
        return (aRes.latencyMs ?? 9999) - (bRes.latencyMs ?? 9999);
      }
      if (aRes.status === "ok") return -1;
      if (bRes.status === "ok") return 1;
    } else if (aRes && aRes.status === "ok") {
      return -1;
    } else if (bRes && bRes.status === "ok") {
      return 1;
    }

    return 0;
  });
});

watch(draftKey, (nextKey) => {
  if (validatedDraftKey.value && validatedDraftKey.value !== nextKey) {
    validation.value = null;
  }
});

watch(rpcDraftKey, (nextKey) => {
  if (validatedRpcDraftKey.value && validatedRpcDraftKey.value !== nextKey) {
    rpcValidation.value = null;
  }
});

watch(
  () => draft.value.chainId,
  async (newChainId) => {
    const chainIdNum = Number(newChainId.trim());
    if (Number.isInteger(chainIdNum) && chainIdNum > 0) {
      isDraftCandidateLoading.value = true;
      try {
        const rpcs = await getChainlistRpcsForChain(chainIdNum);
        draftCandidateRpcs.value = rpcs;
      } catch {
        draftCandidateRpcs.value = [];
      } finally {
        isDraftCandidateLoading.value = false;
      }
    } else {
      draftCandidateRpcs.value = [];
    }
  },
);

function resetForm() {
  editingId.value = null;
  formErrors.value = [];
  validation.value = null;
  validatedDraftKey.value = "";
  chainlistSearchQuery.value = "";
  chainlistSearchResults.value = [];
  draftCandidateRpcs.value = [];
  draft.value = {
    name: "",
    chainId: "",
    rpcUrl: "",
    symbol: "",
    explorerUrl: "",
    environment: "mainnet",
  };
}

function startEdit(network: NetworkConfig) {
  editingId.value = network.id;
  formErrors.value = [];
  validation.value = null;
  validatedDraftKey.value = "";
  chainlistSearchQuery.value = "";
  chainlistSearchResults.value = [];
  draft.value = {
    name: network.name,
    chainId: String(network.chainId),
    rpcUrl: network.rpcUrl,
    symbol: network.symbol,
    explorerUrl: network.explorerUrl ?? "",
    environment: network.environment,
  };
  customFormRef.value?.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function loadChainlistForEditingNetwork(network: NetworkConfig, forceRefresh = false) {
  rpcLatencyResults.value = {};
  chainlistFilter.value = "";

  // Pre-seed with fallback/preset RPCs so the candidates are immediately available to the user
  const defaultRpc = defaultRpcUrl(network);
  const fallbacks = PRESET_RPC_FALLBACKS[network.chainId] ?? [];
  const seedKeys = new Set<string>();
  const seedList: ChainlistRpcItem[] = [];

  const pushUniqueSeed = (url: string, tracking: RpcTrackingPolicy) => {
    const compareKey = normalizeRpcCompareKey(url);
    if (!compareKey || seedKeys.has(compareKey)) {
      return;
    }
    seedKeys.add(compareKey);
    seedList.push({ url, tracking });
  };

  if (network.rpcUrl) {
    pushUniqueSeed(network.rpcUrl, "unknown");
  }
  if (defaultRpc) {
    pushUniqueSeed(defaultRpc, "none");
  }
  for (const item of fallbacks) {
    const compareKey = normalizeRpcCompareKey(item.url);
    if (compareKey && !seedKeys.has(compareKey)) {
      seedKeys.add(compareKey);
      seedList.push(item);
    }
  }
  chainlistRpcs.value = seedList;

  isLoadingChainlist.value = true;
  try {
    const list = await getChainlistRpcsForChain(network.chainId, { forceRefresh, timeoutMs: 8000 });

    const existingKeys = new Set(list.map((item) => normalizeRpcCompareKey(item.url)));
    const extraRpcs: ChainlistRpcItem[] = [];

    if (network.rpcUrl && !existingKeys.has(normalizeRpcCompareKey(network.rpcUrl))) {
      existingKeys.add(normalizeRpcCompareKey(network.rpcUrl));
      extraRpcs.push({ url: network.rpcUrl, tracking: "unknown" });
    }
    if (defaultRpc && !existingKeys.has(normalizeRpcCompareKey(defaultRpc))) {
      existingKeys.add(normalizeRpcCompareKey(defaultRpc));
      extraRpcs.push({ url: defaultRpc, tracking: "none" });
    }

    chainlistRpcs.value = [...extraRpcs, ...list];
  } finally {
    isLoadingChainlist.value = false;
  }
}

function clearModalCloseTimer() {
  if (modalCloseTimer) {
    window.clearTimeout(modalCloseTimer);
    modalCloseTimer = null;
  }
}

function resetRpcOverrideForm() {
  clearModalCloseTimer();
  rpcEditingNetworkId.value = null;
  rpcDraft.value = "";
  rpcErrors.value = [];
  rpcValidation.value = null;
  validatedRpcDraftKey.value = "";
  chainlistRpcs.value = [];
  rpcLatencyResults.value = {};
  chainlistFilter.value = "";
  isRpcModalOpen.value = false;
  rpcModalSaveMessage.value = "";
}

function openRpcModal(network: NetworkConfig) {
  clearModalCloseTimer();
  rpcEditingNetworkId.value = network.id;
  rpcDraft.value = network.rpcUrl;
  rpcErrors.value = [];
  rpcValidation.value = null;
  validatedRpcDraftKey.value = "";
  rpcModalSaveMessage.value = "";
  isRpcModalOpen.value = true;
  void loadChainlistForEditingNetwork(network);
}

function closeRpcModal() {
  resetRpcOverrideForm();
}

function startRpcOverrideEdit(network: NetworkConfig) {
  openRpcModal(network);
}

function handleGlobalKeydown(e: KeyboardEvent) {
  if (e.key === "Escape" && isRpcModalOpen.value) {
    closeRpcModal();
  }
}

async function submitRpcOverrideModal() {
  await submitRpcOverride();
  if (rpcErrors.value.length === 0) {
    rpcModalSaveMessage.value = `✓ 已成功保存 ${rpcEditingNetwork.value?.name ?? "网络"} 的 RPC 节点！`;
    clearModalCloseTimer();
    modalCloseTimer = window.setTimeout(() => {
      modalCloseTimer = null;
      closeRpcModal();
    }, 650);
  }
}

function restoreDefaultRpcInModal(network: NetworkConfig) {
  restoreDefaultRpc(network);
  rpcModalSaveMessage.value = `✓ 已恢复为官方预置默认 RPC 节点`;
  clearModalCloseTimer();
  modalCloseTimer = window.setTimeout(() => {
    modalCloseTimer = null;
    closeRpcModal();
  }, 650);
}

onMounted(() => {
  window.addEventListener("keydown", handleGlobalKeydown);
  if (activeNetwork.value?.environment === "testnet") {
    activeNetworkTab.value = "testnet";
  }
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleGlobalKeydown);
  clearModalCloseTimer();
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  }
});

const popularChainlistPresets = [
  { name: "Avalanche C-Chain", chainId: "43114", symbol: "AVAX", rpcUrl: "https://api.avax.network/ext/bc/C/rpc", explorerUrl: "https://snowtrace.io" },
  { name: "Linea", chainId: "59144", symbol: "ETH", rpcUrl: "https://rpc.linea.build", explorerUrl: "https://lineascan.build" },
  { name: "Scroll", chainId: "534352", symbol: "ETH", rpcUrl: "https://rpc.scroll.io", explorerUrl: "https://scrollscan.com" },
  { name: "zkSync Era", chainId: "324", symbol: "ETH", rpcUrl: "https://mainnet.era.zksync.io", explorerUrl: "https://explorer.zksync.io" },
  { name: "Gnosis", chainId: "100", symbol: "xDAI", rpcUrl: "https://rpc.gnosischain.com", explorerUrl: "https://gnosisscan.io" },
];
const availablePopularPresets = computed(() =>
  popularChainlistPresets.filter(
    (preset) => !allNetworks.value.some((network) => network.chainId === Number(preset.chainId)),
  ),
);

function selectPresetChainlist(preset: (typeof popularChainlistPresets)[number]) {
  draft.value = {
    name: preset.name,
    chainId: preset.chainId,
    symbol: preset.symbol,
    rpcUrl: preset.rpcUrl,
    explorerUrl: preset.explorerUrl,
    environment: "mainnet",
  };
  formErrors.value = [];
  validation.value = null;
  void runRpcValidation();
}

function selectCandidateRpc(url: string) {
  rpcDraft.value = url;
  rpcErrors.value = [];
  rpcValidation.value = null;
  validatedRpcDraftKey.value = "";
  void runRpcOverrideValidation();
}

function isSelectedCandidate(url: string) {
  return Boolean(rpcDraft.value.trim()) && normalizeRpcCompareKey(rpcDraft.value) === normalizeRpcCompareKey(url);
}

function isActiveNetworkRpc(url: string) {
  const current = rpcEditingNetwork.value?.rpcUrl;
  if (!current) return false;
  return normalizeRpcCompareKey(current) === normalizeRpcCompareKey(url);
}

function isDefaultPresetRpc(url: string) {
  if (!rpcEditingNetwork.value) return false;
  const def = defaultRpcUrl(rpcEditingNetwork.value);
  if (!def) return false;
  return normalizeRpcCompareKey(def) === normalizeRpcCompareKey(url);
}

async function testSingleRpc(url: string) {
  if (!rpcEditingNetwork.value) return;
  testingSingleRpc.value[url] = true;
  try {
    const result = await testRpcLatency(rpcEditingNetwork.value.chainId, url);
    rpcLatencyResults.value[url] = result;
  } finally {
    testingSingleRpc.value[url] = false;
  }
}

async function testAllCandidateRpcs() {
  if (!rpcEditingNetwork.value || chainlistRpcs.value.length === 0) return;
  isTestingBatchLatency.value = true;
  const urls = chainlistRpcs.value.map((r) => r.url);
  try {
    await batchTestRpcLatencies(
      rpcEditingNetwork.value.chainId,
      urls,
      (result) => {
        rpcLatencyResults.value[result.url] = result;
      },
      3,
    );
  } finally {
    isTestingBatchLatency.value = false;
  }
}

function trackingLabel(policy?: RpcTrackingPolicy) {
  switch (policy) {
    case "none":
      return "无追踪";
    case "limited":
      return "有限追踪";
    case "yes":
      return "记录追踪";
    default:
      return "未声明";
  }
}

function trackingChipClass(policy?: RpcTrackingPolicy) {
  switch (policy) {
    case "none":
      return "status-chip--good";
    case "limited":
      return "status-chip--medium";
    case "yes":
      return "status-chip--warning";
    default:
      return "";
  }
}

function latencyLabel(result?: RpcSpeedTestResult, url?: string) {
  if (url && testingSingleRpc.value[url]) {
    return "测速中...";
  }
  if (!result || result.status === "untested") {
    return "未测速";
  }
  if (result.status === "ok" && result.latencyMs !== null) {
    return `${result.latencyMs} ms`;
  }
  if (result.status === "mismatch") {
    return "Chain ID 不符";
  }
  return "不可用";
}

function latencyChipClass(result?: RpcSpeedTestResult) {
  if (!result || result.status === "untested") {
    return "";
  }
  if (result.status === "ok" && result.latencyMs !== null) {
    if (result.latencyMs < 300) return "status-chip--good";
    if (result.latencyMs < 800) return "status-chip--medium";
    return "status-chip--slow";
  }
  return "status-chip--danger";
}

let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
function handleChainlistSearch() {
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
  }
  searchDebounceTimer = setTimeout(async () => {
    const query = chainlistSearchQuery.value.trim();
    if (!query) {
      chainlistSearchResults.value = [];
      return;
    }
    isSearchingChainlist.value = true;
    try {
      chainlistSearchResults.value = await searchChainlistChains(query, { limit: 6 });
    } finally {
      isSearchingChainlist.value = false;
    }
  }, 250);
}

function selectChainlistChain(chain: ChainlistNetworkData) {
  draft.value = {
    name: chain.name,
    chainId: String(chain.chainId),
    symbol: chain.nativeCurrency?.symbol ?? "ETH",
    explorerUrl: chain.explorers?.[0]?.url ?? "",
    environment: chain.isTestnet ? "testnet" : "mainnet",
    rpcUrl: chain.rpc[0]?.url ?? "",
  };
  draftCandidateRpcs.value = chain.rpc;
  chainlistSearchResults.value = [];
  chainlistSearchQuery.value = "";
  formErrors.value = [];
  validation.value = null;
  validatedDraftKey.value = "";
  void runRpcValidation();
}

function selectDraftCandidateRpc(url: string) {
  draft.value.rpcUrl = url;
  void runRpcValidation();
}

function networkEnvironmentLabel(network: NetworkConfig) {
  return network.environment === "testnet" ? "测试网" : "正式网";
}

function environmentChipClass(network: NetworkConfig) {
  return network.environment === "testnet" ? "status-chip--warning" : "status-chip--accent";
}

function isRpcOverridden(network: NetworkConfig) {
  return network.source === "preset" && networksStore.hasNetworkRpcOverride(network.id);
}

function defaultRpcUrl(network: NetworkConfig) {
  return networksStore.getDefaultNetworkRpcUrl(network.id);
}

async function runRpcValidation() {
  const { errors, normalizedDraft } = networksStore.validateDraft(
    draft.value,
    editingId.value ?? undefined,
  );

  if (errors.length > 0) {
    formErrors.value = errors;
    validation.value = null;
    validatedDraftKey.value = "";
    return false;
  }

  formErrors.value = [];
  isValidating.value = true;
  const requestId = ++validationRequestId;
  const requestDraftKey = draftKey.value;

  try {
    const result = await validateRpcEndpoint({
      expectedChainId: Number(normalizedDraft.chainId),
      rpcUrl: normalizedDraft.rpcUrl,
    });

    if (requestId !== validationRequestId || requestDraftKey !== draftKey.value) {
      validation.value = null;
      validatedDraftKey.value = "";
      formErrors.value = ["当前草稿在校验期间发生变化，请重新校验 RPC 参数。"];
      return false;
    }

    validation.value = result;
    validatedDraftKey.value = requestDraftKey;

    if (result.status !== "ok") {
      formErrors.value = [result.message];
      return false;
    }

    return true;
  } finally {
    if (requestId === validationRequestId) {
      isValidating.value = false;
    }
  }
}

async function submitNetwork() {
  const needsValidation =
    !validation.value ||
    validation.value.status !== "ok" ||
    validatedDraftKey.value !== draftKey.value;

  if (needsValidation) {
    const validated = await runRpcValidation();

    if (!validated) {
      return;
    }
  }

  const result = networksStore.saveCustomNetwork(
    draft.value,
    editingId.value ?? undefined,
  );

  if (!result.ok) {
    formErrors.value = result.errors;
    return;
  }

  resetForm();
}

async function runRpcOverrideValidation() {
  const network = rpcEditingNetwork.value;

  if (!network) {
    rpcErrors.value = ["请先选择要更改 RPC 的网络"];
    rpcValidation.value = null;
    validatedRpcDraftKey.value = "";
    return false;
  }

  const { errors, normalizedRpcUrl } = networksStore.validateRpcUrl(rpcDraft.value);

  if (errors.length > 0 || !normalizedRpcUrl) {
    rpcErrors.value = errors;
    rpcValidation.value = null;
    validatedRpcDraftKey.value = "";
    return false;
  }

  rpcErrors.value = [];
  isValidatingRpcOverride.value = true;
  const requestId = ++rpcValidationRequestId;
  const requestDraftKey = rpcDraftKey.value;

  try {
    const result = await validateRpcEndpoint({
      expectedChainId: network.chainId,
      rpcUrl: normalizedRpcUrl,
    });

    if (requestId !== rpcValidationRequestId || requestDraftKey !== rpcDraftKey.value) {
      rpcValidation.value = null;
      validatedRpcDraftKey.value = "";
      rpcErrors.value = ["RPC 地址在校验期间发生变化，请重新校验。"];
      return false;
    }

    rpcValidation.value = result;
    validatedRpcDraftKey.value = requestDraftKey;

    if (result.status !== "ok") {
      rpcErrors.value = [result.message];
      return false;
    }

    return true;
  } finally {
    if (requestId === rpcValidationRequestId) {
      isValidatingRpcOverride.value = false;
    }
  }
}

async function submitRpcOverride() {
  const network = rpcEditingNetwork.value;

  if (!network) {
    rpcErrors.value = ["请先选择要更改 RPC 的网络"];
    return;
  }

  const needsValidation =
    !rpcValidation.value ||
    rpcValidation.value.status !== "ok" ||
    validatedRpcDraftKey.value !== rpcDraftKey.value;

  if (needsValidation) {
    const validated = await runRpcOverrideValidation();

    if (!validated) {
      return;
    }
  }

  const result = networksStore.saveNetworkRpcUrl(network.id, rpcDraft.value);

  if (!result.ok) {
    rpcErrors.value = result.errors;
    return;
  }

  rpcDraft.value = allNetworks.value.find((entry) => entry.id === network.id)?.rpcUrl ?? rpcDraft.value;
  rpcErrors.value = [];
}

function restoreDefaultRpc(network: NetworkConfig) {
  const defaultUrl = defaultRpcUrl(network);

  if (!defaultUrl) {
    return;
  }

  networksStore.clearNetworkRpcOverride(network.id);

  if (rpcEditingNetworkId.value === network.id) {
    rpcDraft.value = defaultUrl;
    rpcErrors.value = [];
    rpcValidation.value = null;
    validatedRpcDraftKey.value = "";
  }
}

function removeNetwork(id: string) {
  networksStore.removeCustomNetwork(id);

  if (editingId.value === id) {
    resetForm();
  }
}
</script>

<template>
  <WalletChrome
    eyebrow="多链网络"
    title="网络管理"
    subtitle="管理多链网络与 RPC 节点，支持从 Chainlist 检索与测速比对"
    :show-nav="false"
  >
    <template #actions>
      <RouterLink class="button button--ghost button--small" to="/settings">
        返回设置
      </RouterLink>
    </template>

    <!-- Chainlist RPC Selection Modal -->
    <div
      v-if="isRpcModalOpen && rpcEditingNetwork"
      class="modal-backdrop"
      @click.self="closeRpcModal"
    >
      <div class="modal-dialog rpc-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="rpc-modal-title">
        <div class="modal-header">
          <div>
            <div class="modal-header__eyebrow">
              <span class="status-chip status-chip--accent">Chainlist 节点库</span>
              <span :class="['status-chip', environmentChipClass(rpcEditingNetwork)]">
                {{ networkEnvironmentLabel(rpcEditingNetwork) }}
              </span>
              <span class="status-chip">{{ formatChainLabel(rpcEditingNetwork.chainId) }}</span>
            </div>
            <h3 id="rpc-modal-title" class="modal-title">
              选择 {{ rpcEditingNetwork.name }} RPC 节点
            </h3>
            <p class="modal-subtitle">
              当前配置：<span class="code-pill">{{ rpcEditingNetwork.rpcUrl }}</span>
            </p>
          </div>
          <button
            class="button button--ghost button--icon button--small modal-close-btn"
            type="button"
            aria-label="关闭弹窗"
            @click="closeRpcModal"
          >
            ✕
          </button>
        </div>

        <form class="rpc-modal-form" @submit.prevent="submitRpcOverrideModal">
          <div class="modal-body">
            <!-- Chainlist Candidates Section -->
            <div class="rpc-candidate-section">
              <div class="rpc-toolbar">
                <div class="rpc-toolbar__title">
                  <strong>Chainlist 节点候选 ({{ chainlistRpcs.length }})</strong>
                  <span class="helper-text">点击节点填入并校验，确认后点击底部保存按钮生效</span>
                </div>
                <div class="inline-actions rpc-toolbar-actions">
                  <button
                    class="button button--secondary button--small"
                    type="button"
                    :disabled="isTestingBatchLatency || chainlistRpcs.length === 0"
                    @click="testAllCandidateRpcs"
                  >
                    <span v-if="isTestingBatchLatency" class="spinner-small" />
                    {{ isTestingBatchLatency ? "测速中..." : "⚡ 一键测速" }}
                  </button>
                  <button
                    class="button button--ghost button--small"
                    type="button"
                    :disabled="isLoadingChainlist"
                    @click="loadChainlistForEditingNetwork(rpcEditingNetwork, true)"
                  >
                    {{ isLoadingChainlist ? "同步中..." : "🔄 刷新列表" }}
                  </button>
                </div>
              </div>

              <div class="rpc-filter-bar">
                <input
                  v-model="chainlistFilter"
                  class="field rpc-filter-input"
                  placeholder="🔍 快速筛选候选 RPC 节点地址..."
                />
              </div>

              <div v-if="isLoadingChainlist" class="rpc-loading-inline">
                <span class="spinner-small" />
                <span>正在后台同步 Chainlist 最新节点列表...</span>
              </div>

              <div v-if="sortedAndFilteredCandidates.length > 0" class="rpc-candidate-list rpc-candidate-list--modal">
                <div
                  v-for="candidate in sortedAndFilteredCandidates"
                  :key="candidate.url"
                  :class="['rpc-candidate-item', { 'rpc-candidate-item--active': isSelectedCandidate(candidate.url) }]"
                  @click="selectCandidateRpc(candidate.url)"
                >
                  <div class="rpc-candidate-url-row">
                    <span class="rpc-radio-indicator">
                      <span v-if="isSelectedCandidate(candidate.url)" class="rpc-radio-dot" />
                    </span>
                    <p class="rpc-candidate-url">{{ candidate.url }}</p>
                  </div>

                  <div class="rpc-candidate-bottom">
                    <div class="rpc-candidate-badges">
                      <span :class="['status-chip', trackingChipClass(candidate.tracking)]">
                        {{ trackingLabel(candidate.tracking) }}
                      </span>
                      <span v-if="isActiveNetworkRpc(candidate.url)" class="status-chip status-chip--accent">
                        当前使用
                      </span>
                      <span v-if="isDefaultPresetRpc(candidate.url)" class="status-chip">
                        预置默认
                      </span>
                      <span
                        v-if="isSelectedCandidate(candidate.url) && !isActiveNetworkRpc(candidate.url)"
                        class="status-chip status-chip--warning"
                      >
                        待保存
                      </span>
                    </div>

                    <div class="rpc-candidate-actions">
                      <span :class="['status-chip', latencyChipClass(rpcLatencyResults[candidate.url])]">
                        {{ latencyLabel(rpcLatencyResults[candidate.url], candidate.url) }}
                      </span>
                      <button
                        class="button button--ghost button--small"
                        type="button"
                        :disabled="testingSingleRpc[candidate.url]"
                        @click.stop="testSingleRpc(candidate.url)"
                      >
                        {{ testingSingleRpc[candidate.url] ? "测速中" : "测速" }}
                      </button>
                      <button
                        class="button button--secondary button--small"
                        type="button"
                        @click.stop="selectCandidateRpc(candidate.url)"
                      >
                        {{ isSelectedCandidate(candidate.url) ? "已选" : "选择" }}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <p v-else-if="!isLoadingChainlist" class="empty-state">
                未找到匹配的 RPC 节点。可在下方手动填入。
              </p>
            </div>

            <div class="rpc-editor-box">
              <label class="field">
                <span>选定节点或自定义端点</span>
                <input v-model="rpcDraft" placeholder="https://rpc.example.org" />
              </label>

              <p v-if="rpcEditingNetwork.source === 'preset'" class="helper-text">
                预置默认 RPC：{{ defaultRpcUrl(rpcEditingNetwork) }}
              </p>

              <ul v-if="rpcErrors.length" class="bullet-list helper-text helper-text--error">
                <li v-for="error in rpcErrors" :key="error">{{ error }}</li>
              </ul>

              <div
                v-if="rpcValidation"
                :class="['rpc-validation-pill', rpcValidation.status === 'ok' ? 'rpc-validation-pill--ok' : 'rpc-validation-pill--warn']"
              >
                {{ rpcValidationStatusLabel }} · {{ rpcValidation.message }}
                <template v-if="rpcValidation.latencyMs">
                  · 延迟 {{ rpcValidation.latencyMs }} ms
                </template>
                <template v-if="rpcValidation.latestBlock">
                  · 最新区块 {{ rpcValidation.latestBlock }}
                </template>
              </div>

              <div v-if="rpcModalSaveMessage" class="rpc-success-banner">
                {{ rpcModalSaveMessage }}
              </div>
            </div>
          </div>

          <div class="modal-footer">
            <button
              class="button button--secondary button--small"
              type="button"
              :disabled="isValidatingRpcOverride"
              @click="runRpcOverrideValidation"
            >
              {{ isValidatingRpcOverride ? "校验中..." : "校验 RPC" }}
            </button>
            <button
              v-if="isRpcOverridden(rpcEditingNetwork)"
              class="button button--ghost button--small"
              type="button"
              @click="restoreDefaultRpcInModal(rpcEditingNetwork)"
            >
              恢复默认
            </button>
            <button class="button button--ghost button--small" type="button" @click="closeRpcModal">
              取消
            </button>
            <button class="button button--primary button--small" type="submit" :disabled="isValidatingRpcOverride">
              {{ isValidatingRpcOverride ? "正在保存..." : "校验并保存 RPC" }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <section class="network-status-bar status-grid">
      <div class="network-status-bar__item">
        <span class="helper-text">当前激活网络</span>
        <div class="network-status-bar__value metric-value">
          <strong>{{ activeNetwork.name }}</strong>
          <span :class="['status-chip', environmentChipClass(activeNetwork)]">
            {{ activeNetworkEnvironmentLabel }}
          </span>
          <span class="status-chip">{{ formatChainLabel(activeNetwork.chainId) }}</span>
          <span v-if="isRpcOverridden(activeNetwork)" class="status-chip status-chip--warning">
            自定义 RPC
          </span>
        </div>
      </div>
      <div class="network-status-bar__item network-status-bar__item--meta">
        <span class="helper-text">网络库</span>
        <div class="network-status-bar__value">
          <span style="font-size: 0.78rem; color: var(--text-secondary);">
            共 {{ allNetworks.length }} 个网络（{{ mainnetNetworkCount }} 正式 · {{ testnetNetworkCount }} 测试）
          </span>
        </div>
      </div>
    </section>

    <!-- Network List Card with Segmented Tabs and Max Height Internal Scroll -->
    <SectionCard title="网络列表" description="切换生效网络或选择 Chainlist 节点与测速">
      <template #header>
        <div class="network-tabs">
          <button
            :class="['network-tab-btn', activeNetworkTab === 'mainnet' ? 'network-tab-btn--active' : '']"
            type="button"
            @click="activeNetworkTab = 'mainnet'"
          >
            正式网 ({{ mainnetNetworkCount }})
          </button>
          <button
            :class="['network-tab-btn', activeNetworkTab === 'testnet' ? 'network-tab-btn--active' : '']"
            type="button"
            @click="activeNetworkTab = 'testnet'"
          >
            测试网 ({{ testnetNetworkCount }})
          </button>
        </div>
      </template>

      <!-- Quick Search Bar -->
      <div class="network-search-box">
        <input
          v-model="networkSearchQuery"
          class="field field--compact"
          placeholder="🔍 筛选当前列表网络 (例如 Arbitrum, 42161)..."
        />
      </div>

      <!-- Mainnet List -->
      <div v-show="activeNetworkTab === 'mainnet'" class="network-scroll-list">
        <div
          v-for="network in filteredMainnetNetworks"
          :key="network.id"
          :class="['network-item network-item--compact', { 'network-item--active': activeNetwork.id === network.id }]"
        >
          <div class="network-item__body">
            <div class="network-item__meta">
              <strong>{{ network.name }}</strong>
              <div class="chip-row">
                <span class="status-chip">{{ formatChainLabel(network.chainId) }}</span>
                <span class="status-chip">{{ network.symbol }}</span>
                <span v-if="isRpcOverridden(network)" class="status-chip status-chip--warning">
                  自定义 RPC
                </span>
              </div>
            </div>
            <p class="network-rpc-text">{{ network.rpcUrl }}</p>
          </div>
          <div class="inline-actions">
            <button
              class="button button--ghost button--small"
              type="button"
              :disabled="activeNetwork.id === network.id"
              @click="networksStore.setActiveNetwork(network.id)"
            >
              {{ activeNetwork.id === network.id ? "当前使用" : "切换" }}
            </button>
            <button
              class="button button--secondary button--small"
              type="button"
              @click="startRpcOverrideEdit(network)"
            >
              更改 RPC (Chainlist)
            </button>
            <button
              v-if="isRpcOverridden(network)"
              class="button button--ghost button--small"
              type="button"
              title="恢复默认 RPC"
              @click="restoreDefaultRpc(network)"
            >
              恢复
            </button>
            <button
              v-if="network.source === 'custom'"
              class="button button--ghost button--small"
              type="button"
              @click="startEdit(network)"
            >
              编辑
            </button>
            <button
              v-if="network.source === 'custom'"
              class="button button--danger button--small"
              type="button"
              @click="removeNetwork(network.id)"
            >
              删除
            </button>
          </div>
        </div>
      </div>

      <!-- Testnet List -->
      <div v-show="activeNetworkTab === 'testnet'" class="network-scroll-list">
        <div
          v-for="network in filteredTestnetNetworks"
          :key="network.id"
          :class="['network-item network-item--compact', { 'network-item--active': activeNetwork.id === network.id }]"
        >
          <div class="network-item__body">
            <div class="network-item__meta">
              <strong>{{ network.name }}</strong>
              <div class="chip-row">
                <span class="status-chip status-chip--warning">测试网</span>
                <span class="status-chip">{{ formatChainLabel(network.chainId) }}</span>
                <span class="status-chip">{{ network.symbol }}</span>
                <span v-if="isRpcOverridden(network)" class="status-chip status-chip--warning">
                  自定义 RPC
                </span>
              </div>
            </div>
            <p class="network-rpc-text">{{ network.rpcUrl }}</p>
          </div>
          <div class="inline-actions">
            <button
              class="button button--ghost button--small"
              type="button"
              :disabled="activeNetwork.id === network.id"
              @click="networksStore.setActiveNetwork(network.id)"
            >
              {{ activeNetwork.id === network.id ? "当前使用" : "切换" }}
            </button>
            <button
              class="button button--secondary button--small"
              type="button"
              @click="startRpcOverrideEdit(network)"
            >
              更改 RPC (Chainlist)
            </button>
            <button
              v-if="isRpcOverridden(network)"
              class="button button--ghost button--small"
              type="button"
              title="恢复默认 RPC"
              @click="restoreDefaultRpc(network)"
            >
              恢复
            </button>
            <button
              v-if="network.source === 'custom'"
              class="button button--ghost button--small"
              type="button"
              @click="startEdit(network)"
            >
              编辑
            </button>
            <button
              v-if="network.source === 'custom'"
              class="button button--danger button--small"
              type="button"
              @click="removeNetwork(network.id)"
            >
              删除
            </button>
          </div>
        </div>
      </div>
    </SectionCard>

    <div ref="customFormRef">
    <SectionCard
      :title="editingId ? '编辑自定义网络' : '添加自定义网络'"
      description="支持从 Chainlist 搜索网络一键导入，或手动配置 EVM 参数"
    >
      <div v-if="!editingId" class="chainlist-search">
        <label class="field" style="margin-bottom: 4px;">
          <span>从 Chainlist 快速搜索预填网络</span>
          <input
            v-model="chainlistSearchQuery"
            placeholder="搜索网络名称 (如 Gnosis, Scroll) 或 Chain ID (如 100)"
            @input="handleChainlistSearch"
          />
        </label>

        <!-- Quick Chainlist Presets -->
        <div
          v-if="availablePopularPresets.length > 0"
          style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 8px;"
        >
          <span style="font-size: 0.72rem; color: var(--text-muted);">热门:</span>
          <button
            v-for="preset in availablePopularPresets"
            :key="preset.chainId"
            class="status-chip"
            type="button"
            style="cursor: pointer; padding: 2px 7px; font-size: 0.7rem;"
            @click="selectPresetChainlist(preset)"
          >
            + {{ preset.name }}
          </button>
        </div>

        <div v-if="chainlistSearchResults.length > 0" class="chainlist-search-results" style="max-height: 180px;">
          <div
            v-for="chain in chainlistSearchResults"
            :key="chain.chainId"
            class="chainlist-search-item"
            @click="selectChainlistChain(chain)"
          >
            <div>
              <strong>{{ chain.name }}</strong>
              <span class="helper-text"> (Chain ID: {{ chain.chainId }}, {{ chain.nativeCurrency?.symbol ?? 'ETH' }})</span>
            </div>
            <button class="button button--secondary button--small" type="button">
              导入此网络
            </button>
          </div>
        </div>
      </div>

      <form class="form-grid" @submit.prevent="submitNetwork">
        <div class="form-grid-row-2">
          <label class="field">
            <span>网络名称</span>
            <input v-model="draft.name" placeholder="My Rollup" />
          </label>
          <label class="field">
            <span>Chain ID</span>
            <input v-model="draft.chainId" inputmode="numeric" placeholder="84532" />
          </label>
        </div>

        <div class="form-grid-row-2">
          <label class="field">
            <span>网络类型</span>
            <select v-model="draft.environment">
              <option value="mainnet">正式网</option>
              <option value="testnet">测试网</option>
            </select>
          </label>
          <label class="field">
            <span>原生币符号</span>
            <input v-model="draft.symbol" maxlength="8" placeholder="ETH" />
          </label>
        </div>

        <div v-if="draftCandidateRpcs.length > 0" class="rpc-candidate-section">
          <div class="rpc-toolbar">
            <strong>Chainlist 节点候选 ({{ draftCandidateRpcs.length }})</strong>
            <span class="helper-text">点击候选节点直接选用</span>
          </div>
          <div class="rpc-candidate-list" style="max-height: 140px;">
            <div
              v-for="candidate in draftCandidateRpcs.slice(0, 8)"
              :key="candidate.url"
              :class="['rpc-candidate-item', { 'rpc-candidate-item--active': draft.rpcUrl === candidate.url }]"
              @click="selectDraftCandidateRpc(candidate.url)"
            >
              <p class="rpc-candidate-url">{{ candidate.url }}</p>
              <div class="rpc-candidate-badges">
                <span :class="['status-chip', trackingChipClass(candidate.tracking)]">
                  {{ trackingLabel(candidate.tracking) }}
                </span>
                <span v-if="draft.rpcUrl === candidate.url" class="status-chip status-chip--accent">
                  已选
                </span>
              </div>
            </div>
          </div>
        </div>

        <label class="field">
          <span>RPC URL</span>
          <input v-model="draft.rpcUrl" placeholder="https://rpc.example.org" />
        </label>
        <label class="field">
          <span>区块浏览器 URL</span>
          <input v-model="draft.explorerUrl" placeholder="https://scan.example.org" />
        </label>

        <ul v-if="formErrors.length" class="bullet-list helper-text helper-text--error">
          <li v-for="error in formErrors" :key="error">{{ error }}</li>
        </ul>

        <div class="form-actions form-actions--compact">
          <button class="button button--secondary button--small" type="button" :disabled="isValidating" @click="runRpcValidation">
            {{ isValidating ? "正在校验..." : "先校验 RPC" }}
          </button>
          <button class="button button--primary button--small" type="submit" :disabled="isValidating">
            {{ editingId ? "校验并保存修改" : "校验并添加网络" }}
          </button>
          <button class="button button--ghost button--small" type="button" @click="resetForm">
            重置
          </button>
        </div>
      </form>
    </SectionCard>
    </div>

    <!-- Collapsible Rules & RPC Details -->
    <details class="collapsible-card">
      <summary class="collapsible-summary">
        <span style="display: flex; align-items: center; gap: 6px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          多链网络规则与校验详情
          <span v-if="validation" class="status-chip" style="margin-left: 4px; padding: 1px 6px; font-size: 0.68rem;">
            {{ validationStatusLabel }}
          </span>
        </span>
        <span class="collapsible-chevron">›</span>
      </summary>
      <div class="collapsible-content">
        <div v-if="validation" class="key-value-list" style="margin-bottom: 10px;">
          <div class="key-value-row">
            <span>状态</span>
            <strong>{{ validationStatusLabel }}</strong>
          </div>
          <div class="key-value-row">
            <span>预期 Chain ID</span>
            <strong>{{ validation.expectedChainId }}</strong>
          </div>
          <div class="key-value-row">
            <span>返回 Chain ID</span>
            <strong>{{ validation.actualChainId ?? "无" }}</strong>
          </div>
          <div class="key-value-row">
            <span>最新区块</span>
            <strong>{{ validation.latestBlock ?? "无" }}</strong>
          </div>
          <div class="key-value-row">
            <span>响应延迟</span>
            <strong>{{ validation.latencyMs ? `${validation.latencyMs} ms` : "无" }}</strong>
          </div>
          <div class="key-value-row">
            <span>校验时间</span>
            <strong>{{ formatDateTime(validation.checkedAt) }}</strong>
          </div>
          <p class="helper-text">{{ validation.message }}</p>
        </div>
        <p v-else class="empty-state" style="margin-bottom: 8px;">
          暂无最近 RPC 校验结果。保存网络或校验 RPC 时会自动显示。
        </p>

        <ul class="bullet-list" style="font-size: 0.74rem;">
          <li>只允许保存 EVM 兼容网络与 HTTPS 协议 RPC</li>
          <li>支持从 Chainlist 实时选择公共节点，并提供防追踪隐私标识</li>
          <li>支持一键测速或单节点测速，比对节点响应延迟与最新块高</li>
          <li>Chain ID 不能和现有网络重复</li>
          <li>预置网络可随时切换 RPC，并一键恢复预置默认 RPC</li>
        </ul>
      </div>
    </details>
  </WalletChrome>
</template>
