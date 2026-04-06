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
const draft = ref<NetworkDraft>({
  name: "",
  chainId: "",
  rpcUrl: "",
  symbol: "",
  explorerUrl: "",
});
let validationRequestId = 0;

const draftKey = computed(() =>
  JSON.stringify({
    chainId: draft.value.chainId.trim(),
    rpcUrl: draft.value.rpcUrl.trim(),
    explorerUrl: draft.value.explorerUrl.trim(),
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
const validationStatusLabel = computed(() => {
  if (!validation.value) {
    return "Not Checked";
  }

  if (validation.value.status === "ok") {
    return "Ready";
  }

  if (validation.value.status === "mismatch") {
    return "Chain Mismatch";
  }

  return "Unavailable";
});
const presetNetworks = computed(() =>
  allNetworks.value.filter((network) => network.source === "preset"),
);
const presetNetworkCount = computed(() => presetNetworks.value.length);
const customNetworkCount = computed(() => customNetworks.value.length);

watch(draftKey, (nextKey) => {
  if (validatedDraftKey.value && validatedDraftKey.value !== nextKey) {
    validation.value = null;
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
  };
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
    subtitle="保存前会真实校验 RPC 可访问性、Chain ID 和最新区块，避免把错误节点直接写进钱包。"
  >
    <section class="status-grid">
      <SectionCard title="Active" description="当前生效网络" tone="accent">
        <p class="metric-value">{{ activeNetwork.name }}</p>
        <p>{{ formatChainLabel(activeNetwork.chainId) }}</p>
      </SectionCard>

      <SectionCard title="Total Networks" description="预置 + 自定义">
        <p class="metric-value">{{ allNetworks.length }}</p>
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
        title="Preset Networks"
        description="官方预置网络只读但可切换，保证用户始终有可信入口。"
      >
        <p class="metric-value">{{ presetNetworkCount }} preset</p>
        <div class="network-list">
          <div
            v-for="network in presetNetworks"
            :key="network.id"
            :class="['network-item', { 'network-item--active': activeNetwork.id === network.id }]"
          >
            <div class="network-item__body">
              <div class="network-item__meta">
                <strong>{{ network.name }}</strong>
                <div class="chip-row">
                  <span class="status-chip status-chip--accent">{{ network.symbol }}</span>
                  <span class="status-chip">{{ formatChainLabel(network.chainId) }}</span>
                </div>
              </div>
              <p>{{ network.rpcUrl }}</p>
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
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Custom Networks" description="自定义网络支持校验、编辑与删除">
        <p class="metric-value">{{ customNetworkCount }} custom</p>
        <div class="network-list">
          <p v-if="customNetworks.length === 0" class="helper-text">
            还没有自定义网络，保存后会自动添加到列表。
          </p>
          <div
            v-for="network in customNetworks"
            :key="network.id"
            :class="['network-item', { 'network-item--active': activeNetwork.id === network.id }]"
          >
            <div class="network-item__body">
              <div class="network-item__meta">
                <strong>{{ network.name }}</strong>
                <div class="chip-row">
                  <span class="status-chip status-chip--accent">{{ network.symbol }}</span>
                  <span class="status-chip">{{ formatChainLabel(network.chainId) }}</span>
                </div>
              </div>
              <p>{{ network.rpcUrl }}</p>
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
              <button class="button button--ghost button--small" type="button" @click="startEdit(network)">
                编辑
              </button>
              <button class="button button--danger button--small" type="button" @click="removeNetwork(network.id)">
                删除
              </button>
            </div>
          </div>
        </div>
      </SectionCard>
    </section>

    <section class="page-grid page-grid--2">
      <SectionCard
        :title="editingId ? 'Edit Custom Network' : 'Add Custom Network'"
        description="只接受 EVM 网络参数，保存前必须通过 RPC 校验"
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
        </ul>
      </SectionCard>
    </section>
  </WalletChrome>
</template>
