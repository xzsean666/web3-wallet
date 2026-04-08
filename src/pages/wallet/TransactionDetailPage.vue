<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { storeToRefs } from "pinia";
import SectionCard from "../../components/SectionCard.vue";
import WalletChrome from "../../components/WalletChrome.vue";
import { fetchTransactionDetails } from "../../services/evm";
import { useNetworksStore } from "../../stores/networks";
import { useSessionStore } from "../../stores/session";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useWalletStore } from "../../stores/wallet";
import type { TransactionDetails } from "../../types/portfolio";
import { formatActivityStatus, formatDateTime, formatTokenAmount } from "../../utils/format";

const route = useRoute();
const networksStore = useNetworksStore();
const sessionStore = useSessionStore();
const walletStore = useWalletStore();

const { activeNetwork, allNetworks } = storeToRefs(networksStore);
const { accountCount, activeAccountId, primaryAddress } = storeToRefs(sessionStore);
const { recentActivity } = storeToRefs(walletStore);

const txHash = computed(() => String(route.params.txHash));
const networkId = computed(() =>
  typeof route.query.networkId === "string" ? route.query.networkId : activeNetwork.value.id,
);
const selectedNetwork = computed(
  () => allNetworks.value.find((network) => network.id === networkId.value) ?? activeNetwork.value,
);
const trackedTokens = computed(() => walletStore.tokensForNetwork(selectedNetwork.value.id));
const activityRecord = computed(
  () =>
    recentActivity.value.find(
      (item) => item.txHash === txHash.value && isActivityForCurrentAccount(item),
    ) ?? null,
);
const details = ref<TransactionDetails | null>(null);
const isLoading = ref(false);
const loadError = ref("");
let pollTimer: number | null = null;

function isActivityForCurrentAccount(item: {
  id: string;
  accountId?: string;
  accountAddress?: string;
}) {
  if (item.id === "empty-state" || !primaryAddress.value) {
    return false;
  }

  if (item.accountId) {
    return item.accountId === activeAccountId.value;
  }

  if (item.accountAddress) {
    return item.accountAddress.toLowerCase() === primaryAddress.value.toLowerCase();
  }

  return accountCount.value <= 1;
}

function labeledAddress(address: string | null | undefined) {
  if (!address) {
    return "N/A";
  }

  const contactLabel = walletStore.resolveAddressBookLabel(selectedNetwork.value.id, address);

  return contactLabel ? `${contactLabel} · ${address}` : address;
}

function activityTitle() {
  if (!activityRecord.value) {
    return null;
  }

  return walletStore.formatActivityTitle({
    ...activityRecord.value,
    networkId: selectedNetwork.value.id,
  });
}

function activitySubtitle() {
  if (!activityRecord.value) {
    return null;
  }

  return walletStore.formatActivitySubtitle(
    {
      ...activityRecord.value,
      networkId: selectedNetwork.value.id,
    },
    selectedNetwork.value.name,
  );
}

function stopPolling() {
  if (pollTimer) {
    window.clearTimeout(pollTimer);
    pollTimer = null;
  }
}

function syncActivityStatus() {
  if (!details.value?.hash) {
    return;
  }

  if (details.value.status === "success") {
    walletStore.syncActivityStatus({
      txHash: details.value.hash,
      status: "complete",
    });
  }

  if (details.value.status === "reverted") {
    walletStore.syncActivityStatus({
      txHash: details.value.hash,
      status: "reverted",
    });
  }
}

function scheduleNextPoll() {
  schedulePoll(false);
}

function schedulePoll(force: boolean) {
  stopPolling();

  if (!force && details.value?.status !== "pending") {
    return;
  }

  pollTimer = window.setTimeout(() => {
    void loadTransactionDetails();
  }, 8000);
}

async function loadTransactionDetails() {
  stopPolling();

  if (!txHash.value.startsWith("0x")) {
    loadError.value = "交易哈希格式不正确";
    details.value = null;
    return;
  }

  isLoading.value = true;
  loadError.value = "";
  const shouldRetryPolling =
    details.value?.status === "pending" || activityRecord.value?.status === "pending";

  try {
    details.value = await fetchTransactionDetails({
      network: selectedNetwork.value,
      txHash: txHash.value as `0x${string}`,
      trackedTokens: trackedTokens.value,
    });
    syncActivityStatus();
    scheduleNextPoll();
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : "无法加载交易详情";

    if (shouldRetryPolling) {
      schedulePoll(true);
    }
  } finally {
    isLoading.value = false;
  }
}

async function openExternal(url: string | null) {
  if (!url) return;
  if (isTauri()) {
    await openUrl(url);
  } else {
    const openedWindow = window.open(url, "_blank", "noopener,noreferrer");
    if (openedWindow) {
      openedWindow.opener = null;
    }
  }
}

watch([txHash, selectedNetwork, trackedTokens], () => {
  void loadTransactionDetails();
}, { immediate: true, deep: true });

onBeforeUnmount(stopPolling);
</script>

<template>
  <WalletChrome
    eyebrow="Transaction Detail"
    title="交易详情已经开始接近可用的 receipt。"
    subtitle="当前会把 Native Transfer 和 ERC20 transfer(address,uint256) 解析成人类可读摘要，并补充本地提交时间、链上确认时间和实际网络费。"
  >
    <section class="page-grid page-grid--2">
      <SectionCard title="Hash" description="当前交易哈希">
        <p class="address-block">{{ txHash }}</p>
        <p class="helper-text">网络：{{ selectedNetwork.name }}</p>
        <p v-if="activityRecord?.createdAt" class="helper-text">
          本地提交：{{ formatDateTime(activityRecord.createdAt) }}
        </p>
        <p v-if="activityTitle()" class="helper-text">{{ activityTitle() }}</p>
        <p v-if="activitySubtitle()" class="helper-text">{{ activitySubtitle() }}</p>
        <p v-if="activityRecord?.recipientAddress" class="helper-text">
          收款目标：{{ labeledAddress(activityRecord.recipientAddress) }}
        </p>
      </SectionCard>

      <SectionCard title="Status" description="链上状态">
        <p v-if="isLoading" class="helper-text">正在从当前 RPC 拉取交易详情...</p>
        <p v-else-if="loadError" class="helper-text helper-text--error">{{ loadError }}</p>
        <template v-else-if="details">
          <div class="chip-row">
            <span
              :class="[
                'status-chip',
                details.status === 'success'
                  ? 'status-chip--accent'
                  : details.status === 'reverted'
                    ? 'status-chip--danger'
                    : 'status-chip--warning',
              ]"
            >
              {{ details.status }}
            </span>
            <span class="status-chip">Block {{ details.blockNumber ?? "Pending" }}</span>
          </div>
          <div class="key-value-list">
            <div class="key-value-row">
              <span>Nonce</span>
              <strong>{{ details.nonce }}</strong>
            </div>
            <div class="key-value-row">
              <span>确认时间</span>
              <strong>{{ formatDateTime(details.confirmedAt) }}</strong>
            </div>
          </div>
        </template>
      </SectionCard>
    </section>

    <section v-if="details || activityRecord" class="page-grid page-grid--2">
      <SectionCard title="Timeline" description="本地记录与链上确认时间线">
        <div class="key-value-list">
          <div class="key-value-row">
            <span>本地提交</span>
            <strong>{{ formatDateTime(activityRecord?.createdAt) }}</strong>
          </div>
          <div class="key-value-row">
            <span>最近活动状态</span>
            <strong>{{ activityRecord ? formatActivityStatus(activityRecord.status) : "N/A" }}</strong>
          </div>
          <div v-if="activityTitle()" class="key-value-row">
            <span>本地活动标题</span>
            <strong>{{ activityTitle() }}</strong>
          </div>
          <div v-if="activitySubtitle()" class="key-value-row">
            <span>本地活动摘要</span>
            <strong>{{ activitySubtitle() }}</strong>
          </div>
          <div class="key-value-row">
            <span>链上确认</span>
            <strong>{{ details ? formatDateTime(details.confirmedAt) : "N/A" }}</strong>
          </div>
        </div>
      </SectionCard>

      <SectionCard v-if="details" title="Decoded Action" description="只解析 Native Transfer 与 ERC20 Transfer">
        <p class="metric-value">{{ details.summary.label }}</p>
        <div class="key-value-list">
          <div v-if="details.summary.assetName" class="key-value-row">
            <span>资产</span>
            <strong>{{ details.summary.assetName }}</strong>
          </div>
          <div v-if="details.summary.amount" class="key-value-row">
            <span>数量</span>
            <strong>
              {{ formatTokenAmount(details.summary.amount) }} {{ details.summary.symbol ?? "" }}
            </strong>
          </div>
          <div v-if="details.summary.recipientAddress" class="key-value-row">
            <span>收款地址</span>
            <strong>{{ labeledAddress(details.summary.recipientAddress) }}</strong>
          </div>
          <div v-if="details.summary.contractAddress" class="key-value-row">
            <span>Token 合约</span>
            <strong>{{ details.summary.contractAddress }}</strong>
          </div>
          <div v-if="details.summary.method" class="key-value-row">
            <span>Method</span>
            <strong>{{ details.summary.method }}</strong>
          </div>
        </div>
        <p v-if="details.summary.kind === 'contract-call'" class="helper-text">
          当前只会对 Native 转账和 ERC20 transfer 做受限解析，其他合约调用保持原始展示。
        </p>
      </SectionCard>

      <SectionCard v-if="details" title="Raw Transaction" description="原始链上字段">
        <div class="key-value-list">
          <div class="key-value-row">
            <span>From</span>
            <strong>{{ labeledAddress(details.from) }}</strong>
          </div>
          <div class="key-value-row">
            <span>Raw To</span>
            <strong>{{ details.to ? labeledAddress(details.to) : "Contract Creation" }}</strong>
          </div>
          <div class="key-value-row">
            <span>Native Value</span>
            <strong>{{ formatTokenAmount(details.value) }} {{ selectedNetwork.symbol }}</strong>
          </div>
          <div class="key-value-row">
            <span>Gas Limit</span>
            <strong>{{ details.gasLimit }}</strong>
          </div>
        </div>
      </SectionCard>

      <SectionCard v-if="details" title="Fees" description="实际执行费用与广播参数">
        <div class="key-value-list">
          <div class="key-value-row">
            <span>实际网络费</span>
            <strong>
              {{ details.actualNetworkFee ? `${formatTokenAmount(details.actualNetworkFee)} ${selectedNetwork.symbol}` : "Pending" }}
            </strong>
          </div>
          <div class="key-value-row">
            <span>Gas Used</span>
            <strong>{{ details.gasUsed ?? "Pending" }}</strong>
          </div>
          <div class="key-value-row">
            <span>Effective Gas Price</span>
            <strong>{{ details.effectiveGasPriceGwei ? `${details.effectiveGasPriceGwei} gwei` : "Pending" }}</strong>
          </div>
          <div v-if="details.gasPriceGwei" class="key-value-row">
            <span>Gas Price</span>
            <strong>{{ details.gasPriceGwei }} gwei</strong>
          </div>
          <div v-if="details.maxFeePerGasGwei" class="key-value-row">
            <span>Max Fee</span>
            <strong>{{ details.maxFeePerGasGwei }} gwei</strong>
          </div>
          <div v-if="details.maxPriorityFeePerGasGwei" class="key-value-row">
            <span>Priority Fee</span>
            <strong>{{ details.maxPriorityFeePerGasGwei }} gwei</strong>
          </div>
        </div>
        <div class="form-actions">
          <button class="button button--ghost" type="button" @click="loadTransactionDetails">
            立即刷新
          </button>
          <button
            v-if="details.explorerUrl"
            class="button button--secondary"
            type="button"
            @click="openExternal(details.explorerUrl)"
          >
            打开区块浏览器
          </button>
        </div>
      </SectionCard>
    </section>
  </WalletChrome>
</template>
