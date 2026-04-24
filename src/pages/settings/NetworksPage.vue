<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import SectionCard from "../../components/SectionCard.vue";
import WalletChrome from "../../components/WalletChrome.vue";
import { validateRpcEndpoint } from "../../services/evm";
import { useNetworksStore } from "../../stores/networks";
import type { NetworkConfig, NetworkDraft, RpcEndpointValidation } from "../../types/network";
import { formatChainLabel, formatDateTime } from "../../utils/format";

const networksStore = useNetworksStore();
const { activeNetwork, allNetworks, customNetworks } = storeToRefs(networksStore);

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
    return "Not Checked";
  }

  if (validation.value.status === "ok") {
    return "Reachable";
  }

  if (validation.value.status === "mismatch") {
    return "Chain Mismatch";
  }

  return "Unavailable";
});
const rpcValidationStatusLabel = computed(() => {
  if (!rpcValidation.value) {
    return "Not Checked";
  }

  if (rpcValidation.value.status === "ok") {
    return "Reachable";
  }

  if (rpcValidation.value.status === "mismatch") {
    return "Chain Mismatch";
  }

  return "Unavailable";
});
const mainnetNetworks = computed(() =>
  allNetworks.value.filter((network) => network.environment === "mainnet"),
);
const testnetNetworks = computed(() =>
  allNetworks.value.filter((network) => network.environment === "testnet"),
);
const mainnetNetworkCount = computed(() => mainnetNetworks.value.length);
const testnetNetworkCount = computed(() => testnetNetworks.value.length);
const presetNetworkCount = computed(() =>
  allNetworks.value.filter((network) => network.source === "preset").length,
);
const customNetworkCount = computed(() => customNetworks.value.length);
const activeNetworkTone = computed(() =>
  activeNetwork.value.environment === "testnet" ? "warning" : "accent",
);
const activeNetworkEnvironmentLabel = computed(() => networkEnvironmentLabel(activeNetwork.value));

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

function resetForm() {
  editingId.value = null;
  formErrors.value = [];
  validation.value = null;
  validatedDraftKey.value = "";
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
  draft.value = {
    name: network.name,
    chainId: String(network.chainId),
    rpcUrl: network.rpcUrl,
    symbol: network.symbol,
    explorerUrl: network.explorerUrl ?? "",
    environment: network.environment,
  };
}

function resetRpcOverrideForm() {
  rpcEditingNetworkId.value = null;
  rpcDraft.value = "";
  rpcErrors.value = [];
  rpcValidation.value = null;
  validatedRpcDraftKey.value = "";
}

function startRpcOverrideEdit(network: NetworkConfig) {
  rpcEditingNetworkId.value = network.id;
  rpcDraft.value = network.rpcUrl;
  rpcErrors.value = [];
  rpcValidation.value = null;
  validatedRpcDraftKey.value = "";
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
    eyebrow="Networks"
    title="自定义网络已经进入可校验、可切换、可维护的 MVP 形态。"
    subtitle="保存前会校验 RPC 可访问性、Chain ID 和最新区块，但这只是连通性检查，自定义 RPC 仍然可能返回不可信链上数据。"
  >
    <section class="status-grid">
      <SectionCard title="Active" description="当前生效网络" :tone="activeNetworkTone">
        <p class="metric-value">{{ activeNetwork.name }}</p>
        <p>{{ activeNetworkEnvironmentLabel }} · {{ formatChainLabel(activeNetwork.chainId) }}</p>
      </SectionCard>

      <SectionCard title="Total Networks" description="预置 + 自定义">
        <p class="metric-value">{{ allNetworks.length }}</p>
        <p>{{ mainnetNetworkCount }} 正式网 · {{ testnetNetworkCount }} 测试网</p>
        <p>{{ presetNetworkCount }} preset · {{ customNetworkCount }} custom</p>
      </SectionCard>

      <SectionCard title="Validation" description="当前表单校验状态" :tone="validationTone">
        <p class="metric-value">{{ validationStatusLabel }}</p>
        <p>{{ validation?.message ?? "保存前会自动执行 RPC 校验" }}</p>
      </SectionCard>

      <SectionCard title="RPC" description="当前激活 RPC">
        <p class="metric-value">{{ activeNetwork.symbol }}</p>
        <p>{{ activeNetwork.rpcUrl }}</p>
      </SectionCard>
    </section>

    <section class="page-grid page-grid--2">
      <SectionCard
        title="Mainnet Networks"
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
                默认 RPC：{{ defaultRpcUrl(network) }}
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
        title="Testnet Networks"
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
                默认 RPC：{{ defaultRpcUrl(network) }}
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
    </section>

    <section class="page-grid page-grid--2">
      <SectionCard
        title="Change RPC URL"
        description="只替换当前网络的 RPC 节点，保存前必须返回相同 Chain ID。"
        :tone="rpcValidationTone"
      >
        <template v-if="rpcEditingNetwork">
          <form class="form-grid" @submit.prevent="submitRpcOverride">
            <label class="field">
              <span>网络</span>
              <input :value="rpcEditingNetwork.name" disabled />
            </label>
            <label class="field">
              <span>Chain ID</span>
              <input :value="formatChainLabel(rpcEditingNetwork.chainId)" disabled />
            </label>
            <label class="field">
              <span>RPC URL</span>
              <input v-model="rpcDraft" placeholder="https://rpc.example.org" />
            </label>

            <p v-if="rpcEditingNetwork.source === 'preset'" class="helper-text">
              默认 RPC：{{ defaultRpcUrl(rpcEditingNetwork) }}
            </p>

            <ul v-if="rpcErrors.length" class="bullet-list helper-text helper-text--error">
              <li v-for="error in rpcErrors" :key="error">{{ error }}</li>
            </ul>

            <p v-if="rpcValidation" class="helper-text">
              {{ rpcValidationStatusLabel }} · {{ rpcValidation.message }}
            </p>

            <div class="form-actions">
              <button
                class="button button--secondary"
                type="button"
                :disabled="isValidatingRpcOverride"
                @click="runRpcOverrideValidation"
              >
                {{ isValidatingRpcOverride ? "正在校验 RPC..." : "先校验 RPC" }}
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
          在上方正式网或测试网列表中点击“更改 RPC”。
        </p>
      </SectionCard>

      <SectionCard
        :title="editingId ? 'Edit Custom Network' : 'Add Custom Network'"
        description="只接受 EVM 网络参数，保存前必须通过 RPC 连通性校验"
      >
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
      <SectionCard title="RPC Validation Detail" description="最近一次链上校验结果" :tone="validationTone">
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

      <SectionCard title="Rules" description="当前网络管理规则">
        <ul class="bullet-list">
          <li>只允许保存 EVM 兼容网络</li>
          <li>Chain ID 不能和现有网络重复</li>
          <li>RPC URL 必须是 HTTP 或 HTTPS</li>
          <li>保存前会校验 Chain ID 与最新区块</li>
          <li>预置网络只允许覆盖 RPC URL，可随时恢复默认 RPC</li>
          <li>自定义 RPC 即使校验通过，也不代表节点可信或返回结果未被篡改</li>
        </ul>
      </SectionCard>
    </section>
  </WalletChrome>
</template>
