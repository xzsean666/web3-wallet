<script setup lang="ts">
import { ref } from "vue";
import { storeToRefs } from "pinia";
import SectionCard from "../../components/SectionCard.vue";
import WalletChrome from "../../components/WalletChrome.vue";
import { useNetworksStore } from "../../stores/networks";
import type { NetworkConfig, NetworkDraft } from "../../types/network";
import { formatChainLabel } from "../../utils/format";

const networksStore = useNetworksStore();
const { activeNetwork, allNetworks, customNetworks } = storeToRefs(networksStore);

const editingId = ref<string | null>(null);
const formErrors = ref<string[]>([]);
const draft = ref<NetworkDraft>({
  name: "",
  chainId: "",
  rpcUrl: "",
  symbol: "",
  explorerUrl: "",
});

function resetForm() {
  editingId.value = null;
  formErrors.value = [];
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
  draft.value = {
    name: network.name,
    chainId: String(network.chainId),
    rpcUrl: network.rpcUrl,
    symbol: network.symbol,
    explorerUrl: network.explorerUrl ?? "",
  };
}

function submitNetwork() {
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
    title="自定义网络已经进入 MVP 正式范围。"
    subtitle="这里只允许配置 EVM 兼容网络，能力边界仍然锁在 Native Token 和 ERC20 Token。"
  >
    <section class="page-grid page-grid--2">
      <SectionCard title="All Networks" description="预置网络 + 自定义网络">
        <div class="network-list">
          <div
            v-for="network in allNetworks"
            :key="network.id"
            :class="['network-item', { 'network-item--active': activeNetwork.id === network.id }]"
          >
            <div>
              <strong>{{ network.name }}</strong>
              <p>{{ formatChainLabel(network.chainId) }} · {{ network.symbol }}</p>
            </div>
            <div class="inline-actions">
              <button
                class="button button--ghost button--small"
                type="button"
                @click="networksStore.setActiveNetwork(network.id)"
              >
                Use
              </button>
              <button
                v-if="network.source === 'custom'"
                class="button button--ghost button--small"
                type="button"
                @click="startEdit(network)"
              >
                Edit
              </button>
              <button
                v-if="network.source === 'custom'"
                class="button button--ghost button--small"
                type="button"
                @click="removeNetwork(network.id)"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        :title="editingId ? 'Edit Custom Network' : 'Add Custom Network'"
        description="只接受 EVM 网络参数"
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
            <button class="button button--primary" type="submit">
              {{ editingId ? "保存修改" : "添加网络" }}
            </button>
            <button class="button button--ghost" type="button" @click="resetForm">
              重置表单
            </button>
          </div>
        </form>
      </SectionCard>
    </section>

    <section class="page-grid page-grid--2">
      <SectionCard title="Current Active" description="当前已选网络">
        <p class="metric-value">{{ activeNetwork.name }}</p>
        <p>{{ activeNetwork.rpcUrl }}</p>
      </SectionCard>
      <SectionCard title="Custom Count" description="当前自定义网络数量">
        <p class="metric-value">{{ customNetworks.length }}</p>
      </SectionCard>
    </section>
  </WalletChrome>
</template>

