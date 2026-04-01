<script setup lang="ts">
import { computed, ref, watchEffect } from "vue";
import { useRoute } from "vue-router";
import { storeToRefs } from "pinia";
import SectionCard from "../../components/SectionCard.vue";
import WalletChrome from "../../components/WalletChrome.vue";
import { fetchTransactionDetails } from "../../services/evm";
import { useNetworksStore } from "../../stores/networks";
import type { TransactionDetails } from "../../types/portfolio";

const route = useRoute();
const networksStore = useNetworksStore();

const { activeNetwork, allNetworks } = storeToRefs(networksStore);

const txHash = computed(() => String(route.params.txHash));
const networkId = computed(() =>
  typeof route.query.networkId === "string" ? route.query.networkId : activeNetwork.value.id,
);
const selectedNetwork = computed(
  () => allNetworks.value.find((network) => network.id === networkId.value) ?? activeNetwork.value,
);
const details = ref<TransactionDetails | null>(null);
const isLoading = ref(false);
const loadError = ref("");

watchEffect(async () => {
  if (!txHash.value.startsWith("0x")) {
    loadError.value = "交易哈希格式不正确";
    details.value = null;
    return;
  }

  isLoading.value = true;
  loadError.value = "";

  try {
    details.value = await fetchTransactionDetails({
      network: selectedNetwork.value,
      txHash: txHash.value as `0x${string}`,
    });
  } catch (error) {
    details.value = null;
    loadError.value = error instanceof Error ? error.message : "无法加载交易详情";
  } finally {
    isLoading.value = false;
  }
});
</script>

<template>
  <WalletChrome
    eyebrow="Transaction Detail"
    title="交易详情已经接到 RPC 查询。"
    subtitle="当前展示基础交易状态、金额、Gas 与浏览器跳转。只覆盖 Native Token / ERC20 转账的基础场景。"
  >
    <section class="page-grid page-grid--2">
      <SectionCard title="Hash" description="当前交易哈希">
        <p class="address-block">{{ txHash }}</p>
        <p class="helper-text">网络：{{ selectedNetwork.name }}</p>
      </SectionCard>

      <SectionCard title="Status" description="链上状态">
        <p v-if="isLoading" class="helper-text">正在从当前 RPC 拉取交易详情...</p>
        <p v-else-if="loadError" class="helper-text helper-text--error">{{ loadError }}</p>
        <template v-else-if="details">
          <p class="metric-value">{{ details.status }}</p>
          <p>Block: {{ details.blockNumber ?? "Pending" }}</p>
          <p>Nonce: {{ details.nonce }}</p>
        </template>
      </SectionCard>
    </section>

    <section v-if="details" class="page-grid page-grid--2">
      <SectionCard title="Transfer" description="基础交易信息">
        <ul class="bullet-list">
          <li>From：{{ details.from }}</li>
          <li>To：{{ details.to ?? "Contract Creation" }}</li>
          <li>Value：{{ details.value }} {{ selectedNetwork.symbol }}</li>
          <li>Gas Limit：{{ details.gasLimit }}</li>
        </ul>
      </SectionCard>

      <SectionCard title="Fees" description="广播时的费用参数">
        <ul class="bullet-list">
          <li v-if="details.gasPriceGwei">Gas Price：{{ details.gasPriceGwei }} gwei</li>
          <li v-if="details.maxFeePerGasGwei">Max Fee：{{ details.maxFeePerGasGwei }} gwei</li>
          <li v-if="details.maxPriorityFeePerGasGwei">
            Priority Fee：{{ details.maxPriorityFeePerGasGwei }} gwei
          </li>
        </ul>
        <a
          v-if="details.explorerUrl"
          class="button button--secondary"
          :href="details.explorerUrl"
          rel="noreferrer"
          target="_blank"
        >
          打开区块浏览器
        </a>
      </SectionCard>
    </section>
  </WalletChrome>
</template>
