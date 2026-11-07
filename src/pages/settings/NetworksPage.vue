<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
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
let validationRequestId = 0;
let rpcValidationRequestId = 0;

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
const validationTone = computed(() => {
  if (validation.value?.status === "ok") {
    return "accent";
  }

  if (validation.value) {
    return "warning";
  }

  return "default";
});
const rpcValidationTone = computed(() => {
  if (rpcValidation.value?.status === "ok") {
    return "accent";
  }

  if (rpcValidation.value) {
    return "warning";
  }

  return "default";
});
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
const activeNetworkTone = computed(() =>
  activeNetwork.value.environment === "testnet" ? "warning" : "accent",
);
const activeNetworkEnvironmentLabel = computed(() => networkEnvironmentLabel(activeNetwork.value));

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
}

async function loadChainlistForEditingNetwork(network: NetworkConfig, forceRefresh = false) {
  rpcLatencyResults.value = {};
  chainlistFilter.value = "";

  // Pre-seed with fallback/preset RPCs so the candidates are immediately available to the user
  const defaultRpc = defaultRpcUrl(network);
  const fallbacks = PRESET_RPC_FALLBACKS[network.chainId] ?? [];
  const seedUrls = new Set<string>();
  const seedList: ChainlistRpcItem[] = [];

  if (defaultRpc) {
    seedUrls.add(defaultRpc);
    seedList.push({ url: defaultRpc, tracking: "none" });
  }
  if (network.rpcUrl && !seedUrls.has(network.rpcUrl)) {
    seedUrls.add(network.rpcUrl);
    seedList.push({ url: network.rpcUrl, tracking: "unknown" });
  }
  for (const item of fallbacks) {
    if (!seedUrls.has(item.url)) {
      seedUrls.add(item.url);
      seedList.push(item);
    }
  }
  chainlistRpcs.value = seedList;

  isLoadingChainlist.value = true;
  try {
    const list = await getChainlistRpcsForChain(network.chainId, { forceRefresh, timeoutMs: 3000 });

    const existingUrls = new Set(list.map((item) => item.url));
    const extraRpcs: ChainlistRpcItem[] = [];

    if (defaultRpc && !existingUrls.has(defaultRpc)) {
      existingUrls.add(defaultRpc);
      extraRpcs.push({ url: defaultRpc, tracking: "none" });
    }
    if (network.rpcUrl && !existingUrls.has(network.rpcUrl)) {
      existingUrls.add(network.rpcUrl);
      extraRpcs.push({ url: network.rpcUrl, tracking: "unknown" });
    }

    chainlistRpcs.value = [...extraRpcs, ...list];
  } finally {
    isLoadingChainlist.value = false;
  }
}

function resetRpcOverrideForm() {
  rpcEditingNetworkId.value = null;
  rpcDraft.value = "";
  rpcErrors.value = [];
  rpcValidation.value = null;
  validatedRpcDraftKey.value = "";
  chainlistRpcs.value = [];
  rpcLatencyResults.value = {};
  chainlistFilter.value = "";
}

function startRpcOverrideEdit(network: NetworkConfig) {
  rpcEditingNetworkId.value = network.id;
  rpcDraft.value = network.rpcUrl;
  rpcErrors.value = [];
  rpcValidation.value = null;
  validatedRpcDraftKey.value = "";
  void loadChainlistForEditingNetwork(network);
}

onMounted(() => {
  if (!rpcEditingNetworkId.value && activeNetwork.value) {
    startRpcOverrideEdit(activeNetwork.value);
  }
});

const popularChainlistPresets = [
  { name: "Arbitrum One", chainId: "42161", symbol: "ETH", rpcUrl: "https://arb1.arbitrum.io/rpc" },
  { name: "Optimism", chainId: "10", symbol: "ETH", rpcUrl: "https://mainnet.optimism.io" },
  { name: "Polygon", chainId: "137", symbol: "POL", rpcUrl: "https://polygon-rpc.com" },
  { name: "Base", chainId: "8453", symbol: "ETH", rpcUrl: "https://mainnet.base.org" },
  { name: "BNB Chain", chainId: "56", symbol: "BNB", rpcUrl: "https://bsc-dataseed.binance.org" },
];

function selectPresetChainlist(preset: (typeof popularChainlistPresets)[number]) {
  draft.value = {
    name: preset.name,
    chainId: preset.chainId,
    symbol: preset.symbol,
    rpcUrl: preset.rpcUrl,
    explorerUrl: "",
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
  return rpcDraft.value.trim() === url.trim() || rpcDraft.value.trim() === url.replace(/\/$/, "");
}

function isActiveNetworkRpc(url: string) {
  const current = rpcEditingNetwork.value?.rpcUrl;
  if (!current) return false;
  return current.trim() === url.trim() || current.trim() === url.replace(/\/$/, "");
}

function isDefaultPresetRpc(url: string) {
  if (!rpcEditingNetwork.value) return false;
  const def = defaultRpcUrl(rpcEditingNetwork.value);
  if (!def) return false;
  return def.trim() === url.trim() || def.trim() === url.replace(/\/$/, "");
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

function networkSourceLabel(network: NetworkConfig) {
  return network.source === "custom" ? "自定义" : "预置";
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

    <section class="status-grid status-grid--2">
      <SectionCard title="当前生效" description="当前激活网络" :tone="activeNetworkTone">
        <p class="metric-value">{{ activeNetwork.name }}</p>
        <p>{{ activeNetworkEnvironmentLabel }} · {{ formatChainLabel(activeNetwork.chainId) }}</p>
      </SectionCard>

      <SectionCard title="网络概览" description="多链网络与节点状态">
        <p class="metric-value">{{ allNetworks.length }} 个网络</p>
        <p>{{ mainnetNetworkCount }} 正式网 · {{ testnetNetworkCount }} 测试网</p>
        <p>{{ isRpcOverridden(activeNetwork) ? "已覆盖自定义 RPC" : "预置官方 RPC" }}</p>
      </SectionCard>
    </section>

    <section class="page-grid page-grid--2">
      <SectionCard
        title="正式网络"
        description="正式网与测试网分开展示，切换前先确认链环境。"
      >
        <p class="metric-value">{{ mainnetNetworkCount }} 正式网</p>
        <div class="network-list">
          <div
            v-for="network in mainnetNetworks"
            :key="network.id"
            :class="['network-item', { 'network-item--active': activeNetwork.id === network.id }]"
          >
            <div class="network-item__body">
              <div class="network-item__meta">
                <strong>{{ network.name }}</strong>
                <div class="chip-row">
                  <span :class="['status-chip', environmentChipClass(network)]">
                    {{ networkEnvironmentLabel(network) }}
                  </span>
                  <span class="status-chip">{{ networkSourceLabel(network) }}</span>
                  <span v-if="isRpcOverridden(network)" class="status-chip status-chip--warning">
                    自定义 RPC
                  </span>
                  <span class="status-chip">{{ network.symbol }}</span>
                  <span class="status-chip">{{ formatChainLabel(network.chainId) }}</span>
                </div>
              </div>
              <p>{{ network.rpcUrl }}</p>
              <p v-if="isRpcOverridden(network)" class="helper-text">
                预置默认 RPC：{{ defaultRpcUrl(network) }}
              </p>
            </div>
            <div class="inline-actions">
              <button
                class="button button--ghost button--small"
                type="button"
                :disabled="activeNetwork.id === network.id"
                @click="networksStore.setActiveNetwork(network.id)"
              >
                {{ activeNetwork.id === network.id ? "当前使用" : "切换到此网络" }}
              </button>
              <button
                class="button button--ghost button--small"
                type="button"
                @click="startRpcOverrideEdit(network)"
              >
                更改 RPC
              </button>
              <button
                v-if="isRpcOverridden(network)"
                class="button button--ghost button--small"
                type="button"
                @click="restoreDefaultRpc(network)"
              >
                恢复默认 RPC
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

      <SectionCard
        title="测试网络"
        description="测试网资产仅用于开发和验证，不应当作正式网余额。"
        tone="warning"
      >
        <p class="metric-value">{{ testnetNetworkCount }} 测试网</p>
        <div class="network-list">
          <div
            v-for="network in testnetNetworks"
            :key="network.id"
            :class="['network-item', { 'network-item--active': activeNetwork.id === network.id }]"
          >
            <div class="network-item__body">
              <div class="network-item__meta">
                <strong>{{ network.name }}</strong>
                <div class="chip-row">
                  <span :class="['status-chip', environmentChipClass(network)]">
                    {{ networkEnvironmentLabel(network) }}
                  </span>
                  <span class="status-chip">{{ networkSourceLabel(network) }}</span>
                  <span v-if="isRpcOverridden(network)" class="status-chip status-chip--warning">
                    自定义 RPC
                  </span>
                  <span class="status-chip">{{ network.symbol }}</span>
                  <span class="status-chip">{{ formatChainLabel(network.chainId) }}</span>
                </div>
              </div>
              <p>{{ network.rpcUrl }}</p>
              <p v-if="isRpcOverridden(network)" class="helper-text">
                预置默认 RPC：{{ defaultRpcUrl(network) }}
              </p>
            </div>
            <div class="inline-actions">
              <button
                class="button button--ghost button--small"
                type="button"
                :disabled="activeNetwork.id === network.id"
                @click="networksStore.setActiveNetwork(network.id)"
              >
                {{ activeNetwork.id === network.id ? "当前使用" : "切换到此网络" }}
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
                @click="restoreDefaultRpc(network)"
              >
                恢复默认 RPC
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
    </section>

    <section class="page-grid page-grid--2">
      <SectionCard
        title="Chainlist 节点与 RPC 选配"
        description="支持从 Chainlist 实时选择公共 RPC 节点或填入自定义节点，保存前会自动校验 Chain ID。"
        :tone="rpcValidationTone"
      >
        <template v-if="rpcEditingNetwork">
          <form class="form-grid" @submit.prevent="submitRpcOverride">
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); margin-bottom: 8px;">
              <div>
                <span class="helper-text" style="display: block; font-size: 0.72rem;">目标网络</span>
                <strong style="font-size: 0.95rem;">{{ rpcEditingNetwork.name }}</strong>
              </div>
              <div class="chip-row">
                <span class="status-chip">{{ formatChainLabel(rpcEditingNetwork.chainId) }}</span>
                <span :class="['status-chip', environmentChipClass(rpcEditingNetwork)]">
                  {{ networkEnvironmentLabel(rpcEditingNetwork) }}
                </span>
              </div>
            </div>

            <!-- Chainlist Candidates Section -->
            <div class="rpc-candidate-section">
              <div class="rpc-toolbar">
                <strong>Chainlist 节点候选 ({{ chainlistRpcs.length }})</strong>
                <div class="inline-actions">
                  <button
                    class="button button--secondary button--small"
                    type="button"
                    :disabled="isTestingBatchLatency || chainlistRpcs.length === 0"
                    @click="testAllCandidateRpcs"
                  >
                    {{ isTestingBatchLatency ? "正在测速..." : "一键测速全部" }}
                  </button>
                  <button
                    class="button button--ghost button--small"
                    type="button"
                    :disabled="isLoadingChainlist"
                    @click="loadChainlistForEditingNetwork(rpcEditingNetwork, true)"
                  >
                    {{ isLoadingChainlist ? "刷新中..." : "刷新 Chainlist" }}
                  </button>
                </div>
              </div>

              <input
                v-if="chainlistRpcs.length > 5"
                v-model="chainlistFilter"
                class="field"
                placeholder="筛选候选 RPC 节点地址..."
              />

              <div v-if="isLoadingChainlist" class="empty-state">
                正在从 Chainlist 获取可用节点列表...
              </div>
              <div v-else-if="sortedAndFilteredCandidates.length > 0" class="rpc-candidate-list">
                <div
                  v-for="candidate in sortedAndFilteredCandidates"
                  :key="candidate.url"
                  :class="['rpc-candidate-item', { 'rpc-candidate-item--active': isSelectedCandidate(candidate.url) }]"
                  @click="selectCandidateRpc(candidate.url)"
                >
                  <div class="rpc-candidate-main">
                    <p class="rpc-candidate-url">{{ candidate.url }}</p>
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
                      <span v-if="isSelectedCandidate(candidate.url)" class="status-chip status-chip--accent">
                        已选定
                      </span>
                    </div>
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
                      测速
                    </button>
                    <button
                      class="button button--secondary button--small"
                      type="button"
                      @click.stop="selectCandidateRpc(candidate.url)"
                    >
                      选择
                    </button>
                  </div>
                </div>
              </div>
              <p v-else class="empty-state">
                未找到匹配的 RPC 节点。可在下方手动填入。
              </p>
            </div>

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

            <p v-if="rpcValidation" class="helper-text">
              {{ rpcValidationStatusLabel }} · {{ rpcValidation.message }}
              <template v-if="rpcValidation.latencyMs">
                · 延迟 {{ rpcValidation.latencyMs }} ms
              </template>
              <template v-if="rpcValidation.latestBlock">
                · 最新区块 {{ rpcValidation.latestBlock }}
              </template>
            </p>

            <div class="form-actions">
              <button
                class="button button--secondary"
                type="button"
                :disabled="isValidatingRpcOverride"
                @click="runRpcOverrideValidation"
              >
                {{ isValidatingRpcOverride ? "正在校验 RPC..." : "校验当前 RPC" }}
              </button>
              <button class="button button--primary" type="submit" :disabled="isValidatingRpcOverride">
                校验并保存 RPC
              </button>
              <button
                v-if="isRpcOverridden(rpcEditingNetwork)"
                class="button button--ghost"
                type="button"
                @click="restoreDefaultRpc(rpcEditingNetwork)"
              >
                恢复默认 RPC
              </button>
              <button class="button button--ghost" type="button" @click="resetRpcOverrideForm">
                取消
              </button>
            </div>
          </form>
        </template>
        <p v-else class="empty-state">
          在上方正式网或测试网列表中点击“更改 RPC”，可从 Chainlist 提供的海量节点中挑选。
        </p>
      </SectionCard>

      <SectionCard
        :title="editingId ? 'Edit Custom Network' : 'Add Custom Network'"
        description="支持从 Chainlist 搜索网络一键导入，或手动配置 EVM 参数"
      >
        <div v-if="!editingId" class="chainlist-search">
          <label class="field">
            <span>从 Chainlist 快速搜索预填网络</span>
            <input
              v-model="chainlistSearchQuery"
              placeholder="搜索网络名称 (如 Gnosis, Scroll) 或 Chain ID (如 100)"
              @input="handleChainlistSearch"
            />
          </label>

          <!-- Quick Chainlist Presets -->
          <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 6px;">
            <span style="font-size: 0.74rem; color: var(--text-muted);">Chainlist 热门:</span>
            <button
              v-for="preset in popularChainlistPresets"
              :key="preset.chainId"
              class="status-chip"
              type="button"
              style="cursor: pointer; padding: 2px 7px; font-size: 0.72rem;"
              @click="selectPresetChainlist(preset)"
            >
              + {{ preset.name }}
            </button>
          </div>

          <div v-if="chainlistSearchResults.length > 0" class="chainlist-search-results">
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
          <label class="field">
            <span>网络名称</span>
            <input v-model="draft.name" placeholder="My Rollup" />
          </label>
          <label class="field">
            <span>Chain ID</span>
            <input v-model="draft.chainId" inputmode="numeric" placeholder="84532" />
          </label>
          <label class="field">
            <span>网络类型</span>
            <select v-model="draft.environment">
              <option value="mainnet">正式网</option>
              <option value="testnet">测试网</option>
            </select>
          </label>

          <div v-if="draftCandidateRpcs.length > 0" class="rpc-candidate-section">
            <div class="rpc-toolbar">
              <strong>Chainlist 节点候选 ({{ draftCandidateRpcs.length }})</strong>
              <span class="helper-text">点击候选节点直接选用</span>
            </div>
            <div class="rpc-candidate-list" style="max-height: 160px;">
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
            <span>原生币符号</span>
            <input v-model="draft.symbol" maxlength="8" placeholder="ETH" />
          </label>
          <label class="field">
            <span>区块浏览器 URL</span>
            <input v-model="draft.explorerUrl" placeholder="https://scan.example.org" />
          </label>

          <ul v-if="formErrors.length" class="bullet-list helper-text helper-text--error">
            <li v-for="error in formErrors" :key="error">{{ error }}</li>
          </ul>

          <div class="form-actions">
            <button class="button button--secondary" type="button" :disabled="isValidating" @click="runRpcValidation">
              {{ isValidating ? "正在校验 RPC..." : "先校验 RPC" }}
            </button>
            <button class="button button--primary" type="submit" :disabled="isValidating">
              {{ editingId ? "校验并保存修改" : "校验并添加网络" }}
            </button>
            <button class="button button--ghost" type="button" @click="resetForm">
              重置表单
            </button>
          </div>
        </form>
      </SectionCard>
    </section>

    <section class="page-grid page-grid--2">
      <SectionCard title="RPC 校验详情" description="最近一次链上校验结果" :tone="validationTone">
        <template v-if="validation">
          <div class="key-value-list">
            <div class="key-value-row">
              <span>状态</span>
              <strong>{{ validationStatusLabel }}</strong>
            </div>
            <div class="key-value-row">
              <span>Expected Chain ID</span>
              <strong>{{ validation.expectedChainId }}</strong>
            </div>
            <div class="key-value-row">
              <span>Returned Chain ID</span>
              <strong>{{ validation.actualChainId ?? "N/A" }}</strong>
            </div>
            <div class="key-value-row">
              <span>Latest Block</span>
              <strong>{{ validation.latestBlock ?? "N/A" }}</strong>
            </div>
            <div class="key-value-row">
              <span>Latency</span>
              <strong>{{ validation.latencyMs ? `${validation.latencyMs} ms` : "N/A" }}</strong>
            </div>
            <div class="key-value-row">
              <span>Checked At</span>
              <strong>{{ formatDateTime(validation.checkedAt) }}</strong>
            </div>
          </div>
          <p class="helper-text">{{ validation.message }}</p>
        </template>
        <p v-else class="empty-state">
          当前还没有校验结果。输入网络参数后点击“先校验 RPC”，或直接保存时自动校验。
        </p>
      </SectionCard>

      <SectionCard title="Rules" description="当前网络与 RPC 规则">
        <ul class="bullet-list">
          <li>只允许保存 EVM 兼容网络与 HTTPS 协议 RPC</li>
          <li>支持从 Chainlist 实时选择公共节点，并提供防追踪隐私标识</li>
          <li>支持一键测速或单节点测速，比对节点响应延迟与最新块高</li>
          <li>Chain ID 不能和现有网络重复</li>
          <li>预置网络可随时切换 RPC，并一键恢复预置默认 RPC</li>
          <li>公共 RPC 即使响应迅速且校验通过，也不代表节点返回结果不可篡改</li>
        </ul>
      </SectionCard>
    </section>
  </WalletChrome>
</template>
