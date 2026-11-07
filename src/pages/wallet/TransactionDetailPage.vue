<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";
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
import { formatDateTime, formatTokenAmount } from "../../utils/format";
import { toSafeExternalUrl } from "../../utils/runtimeSafety";

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
const externalLinkError = ref("");
const isHashCopied = ref(false);
let pollTimer: number | null = null;
const safeExplorerUrl = computed(() => toSafeExternalUrl(details.value?.explorerUrl ?? null));

async function copyTxHash() {
  if (!txHash.value) return;
  try {
    await navigator.clipboard.writeText(txHash.value);
    isHashCopied.value = true;
    setTimeout(() => {
      isHashCopied.value = false;
    }, 2000);
  } catch {}
}

function statusBadgeInfo() {
  const status = details.value?.status ?? activityRecord.value?.status ?? "pending";
  if (status === "success" || status === "complete") {
    return { label: "交易已确认", chipClass: "status-chip--accent" };
  }
  if (status === "reverted") {
    return { label: "交易已失败", chipClass: "status-chip--danger" };
  }
  return { label: "链上打包中", chipClass: "status-chip--warning" };
}

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
  const safeUrl = toSafeExternalUrl(url);

  if (!safeUrl) {
    externalLinkError.value = "已拦截不安全的外链地址";
    return;
  }

  externalLinkError.value = "";
  if (isTauri()) {
    await openUrl(safeUrl);
  } else {
    const openedWindow = window.open(safeUrl, "_blank", "noopener,noreferrer");
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
    eyebrow="交易活动"
    title="交易详情"
    subtitle="查看链上交易确认状态、转账金额及网络费用"
    :show-nav="false"
  >
    <template #actions>
      <RouterLink class="button button--ghost button--small" to="/wallet/activity">
        返回活动
      </RouterLink>
      <RouterLink class="button button--ghost button--small" to="/wallet">
        返回钱包
      </RouterLink>
    </template>

    <!-- Top Status & Amount Hero Card -->
    <section class="section-card home-balance-card" style="padding: 24px 20px; text-align: center;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span :class="['status-chip', statusBadgeInfo().chipClass]">
          {{ statusBadgeInfo().label }}
        </span>
        <span class="meta-pill">{{ selectedNetwork.name }}</span>
      </div>

      <div style="margin: 12px 0 6px;">
        <p class="home-balance-card__amount" style="margin: 0; font-size: 2.1rem; font-weight: 800;">
          {{
            details?.summary?.amount
              ? formatTokenAmount(details.summary.amount)
              : (activityRecord?.amount ? formatTokenAmount(activityRecord.amount) : (details?.value ? formatTokenAmount(details.value) : "0"))
          }}
          {{ details?.summary?.symbol ?? activityRecord?.assetSymbol ?? selectedNetwork.symbol }}
        </p>
        <p style="margin: 4px 0 0; font-size: 0.85rem; color: var(--text-secondary);">
          {{ details?.summary?.label ?? activityTitle() ?? "转账交易" }}
        </p>
      </div>

      <p v-if="isLoading" class="helper-text" style="margin: 4px 0 0;">正在从 RPC 实时拉取最新状态...</p>
      <p v-else-if="loadError" class="helper-text helper-text--error" style="margin: 4px 0 0;">{{ loadError }}</p>
    </section>

    <!-- Core Transaction Overview Card -->
    <section class="page-grid page-grid--1">
      <SectionCard title="交易概览">
        <div class="key-value-list">
          <div class="key-value-row">
            <span>交易状态</span>
            <strong style="display: inline-flex; align-items: center; gap: 6px;">
              <span :class="['status-chip', statusBadgeInfo().chipClass]" style="padding: 1px 6px; font-size: 0.68rem;">
                {{ details?.status ?? activityRecord?.status ?? "pending" }}
              </span>
              <span>Block {{ details?.blockNumber ?? "打包中" }}</span>
            </strong>
          </div>
          <div class="key-value-row">
            <span>所属网络</span>
            <strong>{{ selectedNetwork.name }} (Chain ID: {{ selectedNetwork.chainId }})</strong>
          </div>
          <div v-if="details?.from" class="key-value-row">
            <span>发送方</span>
            <strong>{{ labeledAddress(details.from) }}</strong>
          </div>
          <div class="key-value-row">
            <span>接收方</span>
            <strong>{{ labeledAddress(details?.summary?.recipientAddress ?? activityRecord?.recipientAddress ?? details?.to) }}</strong>
          </div>
          <div v-if="details?.summary?.contractAddress" class="key-value-row">
            <span>Token 合约</span>
            <strong>{{ details.summary.contractAddress }}</strong>
          </div>
          <div class="key-value-row">
            <span>实际网络费</span>
            <strong>
              {{ details?.actualNetworkFee ? `${formatTokenAmount(details.actualNetworkFee)} ${selectedNetwork.symbol}` : (details?.gasLimit ? "估算中" : "Pending") }}
            </strong>
          </div>
          <div v-if="activityRecord?.createdAt" class="key-value-row">
            <span>本地提交</span>
            <strong>{{ formatDateTime(activityRecord.createdAt) }}</strong>
          </div>
          <div v-if="details?.confirmedAt" class="key-value-row">
            <span>链上确认</span>
            <strong>{{ formatDateTime(details.confirmedAt) }}</strong>
          </div>
        </div>
      </SectionCard>

      <!-- Technical Details Card -->
      <SectionCard title="技术参数">
        <div class="key-value-list">
          <div class="key-value-row" style="flex-direction: column; align-items: flex-start; gap: 4px;">
            <div style="display: flex; justify-content: space-between; width: 100%; align-items: center;">
              <span>交易哈希 (TxHash)</span>
              <button
                class="button button--ghost button--small"
                type="button"
                style="padding: 1px 6px; font-size: 0.7rem;"
                @click="copyTxHash"
              >
                {{ isHashCopied ? "已复制" : "复制哈希" }}
              </button>
            </div>
            <p class="address-block" style="width: 100%; margin: 0; font-size: 0.72rem; word-break: break-all;">
              {{ txHash }}
            </p>
          </div>
          <div class="key-value-row">
            <span>Nonce</span>
            <strong>{{ details?.nonce ?? "N/A" }}</strong>
          </div>
          <div class="key-value-row">
            <span>Gas Limit / Used</span>
            <strong>{{ details?.gasLimit ?? "N/A" }} / {{ details?.gasUsed ?? "Pending" }}</strong>
          </div>
          <div v-if="details?.effectiveGasPriceGwei" class="key-value-row">
            <span>Effective Gas Price</span>
            <strong>{{ details.effectiveGasPriceGwei }} gwei</strong>
          </div>
          <div v-else-if="details?.gasPriceGwei" class="key-value-row">
            <span>Gas Price</span>
            <strong>{{ details.gasPriceGwei }} gwei</strong>
          </div>
        </div>

        <div class="form-actions" style="margin-top: 14px;">
          <button
            v-if="safeExplorerUrl"
            class="button button--primary"
            type="button"
            @click="openExternal(safeExplorerUrl)"
          >
            打开区块浏览器
          </button>
          <button class="button button--ghost" type="button" @click="loadTransactionDetails">
            立即刷新
          </button>
        </div>
        <p v-if="externalLinkError" class="helper-text helper-text--error">
          {{ externalLinkError }}
        </p>
      </SectionCard>
    </section>
  </WalletChrome>
</template>
