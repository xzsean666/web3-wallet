<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { RouterLink, useRouter } from "vue-router";
import SectionCard from "../../components/SectionCard.vue";
import WalletChrome from "../../components/WalletChrome.vue";
import { fetchPortfolioSnapshot, fetchTransactionDetails } from "../../services/evm";
import { useNetworksStore } from "../../stores/networks";
import { usePortfolioStore } from "../../stores/portfolio";
import { useSessionStore } from "../../stores/session";
import { useWalletStore } from "../../stores/wallet";
import type { ActivityItem, TrackedToken } from "../../types/wallet";
import {
  formatActivityStatus,
  formatRelativeTime,
  formatTokenAmount,
  shortenAddress,
} from "../../utils/format";

const router = useRouter();
const sessionStore = useSessionStore();
const networksStore = useNetworksStore();
const portfolioStore = usePortfolioStore();
const walletStore = useWalletStore();

type ActivityFilter = "all" | "network" | "pending";
type AssetFilter = "all" | "preset" | "custom";

const { activeNetwork, allNetworks } = storeToRefs(networksStore);
const { accountCount, activeAccountId, primaryAddress, walletLabel } = storeToRefs(sessionStore);
const { recentActivity, trackedTokens } = storeToRefs(walletStore);

const tokensForActiveNetwork = computed(() =>
  trackedTokens.value.filter((token) => token.networkIds.includes(activeNetwork.value.id)),
);
const snapshot = computed(() =>
  portfolioStore.getSnapshot(activeNetwork.value.id, primaryAddress.value || null),
);
const activityFilter = ref<ActivityFilter>("all");
const assetFilter = ref<AssetFilter>("all");
const assetQuery = ref("");
const submittedActivity = computed(() =>
  recentActivity.value.filter(isActivityForCurrentAccount),
);
const hasSubmittedActivity = computed(() => submittedActivity.value.length > 0);
const accountDisplayLabel = computed(() =>
  walletLabel.value || shortenAddress(primaryAddress.value) || "当前账户",
);
const accountMonogram = computed(() => {
  const source = walletLabel.value?.trim() || activeNetwork.value.symbol || "W";

  return source.slice(0, 1).toUpperCase();
});
const filteredActivity = computed(() =>
  submittedActivity.value.filter((item) => {
    if (activityFilter.value === "pending") {
      return item.status === "pending";
    }

    if (activityFilter.value === "network") {
      return resolveActivityNetwork(item).id === activeNetwork.value.id;
    }

    return true;
  }),
);
const activityFilterOptions = [
  {
    id: "all" as const,
    label: "全部",
  },
  {
    id: "network" as const,
    label: "本链",
  },
  {
    id: "pending" as const,
    label: "待处理",
  },
];
const assetFilterOptions = [
  {
    id: "all" as const,
    label: "全部",
  },
  {
    id: "preset" as const,
    label: "默认",
  },
  {
    id: "custom" as const,
    label: "自选",
  },
];
const activityEmptyStateMessage = computed(() => {
  if (!hasSubmittedActivity.value) {
    return "还没有活动";
  }

  if (activityFilter.value === "network") {
    return `${activeNetwork.value.name} 上暂无活动`;
  }

  if (activityFilter.value === "pending") {
    return "没有待处理交易";
  }

  return "暂无可显示活动";
});
const activitySummaryLabel = computed(() => {
  if (!hasSubmittedActivity.value) {
    return "暂无活动";
  }

  return `${filteredActivity.value.length} / ${submittedActivity.value.length} 条`;
});
const normalizedAssetQuery = computed(() => assetQuery.value.trim().toLowerCase());

const nativeAsset = computed(() => ({
  name: `${activeNetwork.value.name} Native Token`,
  symbol: activeNetwork.value.symbol,
  balance: snapshot.value.nativeBalance,
}));
const filteredTokensForActiveNetwork = computed(() =>
  tokensForActiveNetwork.value.filter((token) => {
    if (assetFilter.value === "preset" && token.source !== "preset") {
      return false;
    }

    if (assetFilter.value === "custom" && token.source !== "custom") {
      return false;
    }

    if (!normalizedAssetQuery.value) {
      return true;
    }

    return `${token.symbol} ${token.name}`.toLowerCase().includes(normalizedAssetQuery.value);
  }),
);
const showNativeAsset = computed(() => {
  if (assetFilter.value === "custom") {
    return false;
  }

  if (!normalizedAssetQuery.value) {
    return true;
  }

  return `${nativeAsset.value.symbol} ${nativeAsset.value.name}`.toLowerCase().includes(normalizedAssetQuery.value);
});
const visibleAssetCount = computed(() =>
  filteredTokensForActiveNetwork.value.length + (showNativeAsset.value ? 1 : 0),
);
const totalAssetCount = computed(() => tokensForActiveNetwork.value.length + 1);
const hasVisibleAssets = computed(() => visibleAssetCount.value > 0);
const assetSummaryLabel = computed(() => `${visibleAssetCount.value} / ${totalAssetCount.value} 项`);
const assetEmptyStateMessage = computed(() => {
  const keyword = assetQuery.value.trim();

  if (keyword) {
    return `没有找到“${keyword}”`;
  }

  if (assetFilter.value === "custom") {
    return "还没有自选代币";
  }

  if (assetFilter.value === "preset") {
    return "没有默认资产";
  }

  return "没有可显示资产";
});
const pendingActivities = computed(() =>
  submittedActivity.value.filter((item) => item.status === "pending" && item.txHash),
);
const homeSyncLabel = computed(() => {
  if (snapshot.value.status === "loading") {
    return "同步中";
  }

  if (snapshot.value.status === "error") {
    return "同步失败";
  }

  if (snapshot.value.lastSyncedAt) {
    return `已更新 ${formatRelativeTime(snapshot.value.lastSyncedAt)}`;
  }

  return "等待同步";
});
let activitySyncTimer: number | null = null;
const isRefreshingHome = ref(false);
const lastActivityCheckAt = ref<string | null>(null);
const confirmingRemovalTokenId = ref<string | null>(null);
const removingTokenId = ref<string | null>(null);
const assetActionFeedback = ref("");
const assetActionFeedbackTone = ref<"success" | "error" | "neutral">("neutral");
let portfolioRefreshRequestId = 0;

function resolveActivityNetwork(item: ActivityItem) {
  if (item.networkId) {
    const matchedNetwork = allNetworks.value.find((network) => network.id === item.networkId);

    if (matchedNetwork) {
      return matchedNetwork;
    }
  }

  return activeNetwork.value;
}

function activityNetworkName(item: ActivityItem) {
  return resolveActivityNetwork(item).name;
}

function activityTitle(item: ActivityItem) {
  return walletStore.formatActivityTitle({
    ...item,
    networkId: resolveActivityNetwork(item).id,
  });
}

function activitySubtitle(item: ActivityItem) {
  return walletStore.formatActivitySubtitle(
    {
      ...item,
      networkId: resolveActivityNetwork(item).id,
    },
    activityNetworkName(item),
  );
}

function assetBadgeLabel(symbol: string) {
  return symbol.slice(0, 2).toUpperCase();
}

function isActivityForCurrentAccount(item: ActivityItem) {
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

function resetAssetActionState() {
  confirmingRemovalTokenId.value = null;
  removingTokenId.value = null;
  assetActionFeedback.value = "";
  assetActionFeedbackTone.value = "neutral";
}

function resetAssetFilterState() {
  assetFilter.value = "all";
  assetQuery.value = "";
}

function removeFeedbackClass() {
  if (assetActionFeedbackTone.value === "success") {
    return "helper-text helper-text--success";
  }

  if (assetActionFeedbackTone.value === "error") {
    return "helper-text helper-text--error";
  }

  return "helper-text";
}

function requestCustomTokenRemoval(token: TrackedToken) {
  if (removingTokenId.value) {
    return;
  }

  if (confirmingRemovalTokenId.value !== token.id) {
    confirmingRemovalTokenId.value = token.id;
    assetActionFeedback.value = "";
    assetActionFeedbackTone.value = "neutral";
    return;
  }

  removingTokenId.value = token.id;
  const result = walletStore.removeCustomToken(token.id);
  removingTokenId.value = null;

  if (!result.ok) {
    assetActionFeedback.value = result.error;
    assetActionFeedbackTone.value = "error";
    return;
  }

  confirmingRemovalTokenId.value = null;
  assetActionFeedback.value = `${token.symbol} 已从当前资产列表移除，只影响本地跟踪状态。`;
  assetActionFeedbackTone.value = "success";
}

function cancelCustomTokenRemoval(tokenId: string) {
  if (confirmingRemovalTokenId.value === tokenId) {
    confirmingRemovalTokenId.value = null;
  }
}

async function refreshPortfolio() {
  if (!primaryAddress.value) {
    return;
  }

  const requestId = ++portfolioRefreshRequestId;
  const requestNetwork = activeNetwork.value;
  const requestAddress = primaryAddress.value;
  const requestTokens = [...tokensForActiveNetwork.value];

  portfolioStore.markLoading({
    networkId: requestNetwork.id,
    accountAddress: requestAddress,
  });

  try {
    const nextSnapshot = await fetchPortfolioSnapshot({
      network: requestNetwork,
      address: requestAddress,
      tokens: requestTokens,
    });

    if (requestId !== portfolioRefreshRequestId) {
      return;
    }

    portfolioStore.setSnapshot(nextSnapshot);
  } catch (error) {
    if (requestId !== portfolioRefreshRequestId) {
      return;
    }

    portfolioStore.setError({
      networkId: requestNetwork.id,
      accountAddress: requestAddress,
      error: error instanceof Error ? error.message : "Failed to load portfolio snapshot",
    });
  }
}

async function syncPendingActivityStatus() {
  if (pendingActivities.value.length === 0) {
    lastActivityCheckAt.value = new Date().toISOString();
    return;
  }

  await Promise.all(
    pendingActivities.value.map(async (item) => {
      const itemNetwork = resolveActivityNetwork(item);

      try {
        const details = await fetchTransactionDetails({
          network: itemNetwork,
          txHash: item.txHash!,
          trackedTokens: walletStore.tokensForNetwork(itemNetwork.id),
        });

        if (details.status === "success") {
          walletStore.syncActivityStatus({
            txHash: item.txHash!,
            status: "complete",
          });
        }

        if (details.status === "reverted") {
          walletStore.syncActivityStatus({
            txHash: item.txHash!,
            status: "reverted",
          });
        }
      } catch {
        // Keep pending activity untouched when the current RPC cannot resolve it yet.
      }
    }),
  );

  lastActivityCheckAt.value = new Date().toISOString();
}

async function refreshHomeContext() {
  if (isRefreshingHome.value) {
    return;
  }

  isRefreshingHome.value = true;

  try {
    await Promise.all([refreshPortfolio(), syncPendingActivityStatus()]);
  } finally {
    isRefreshingHome.value = false;
  }
}

function startActivitySyncLoop() {
  if (activitySyncTimer) {
    window.clearInterval(activitySyncTimer);
  }

  activitySyncTimer = window.setInterval(() => {
    void syncPendingActivityStatus();
  }, 12000);
}

function stopActivitySyncLoop() {
  if (activitySyncTimer) {
    window.clearInterval(activitySyncTimer);
    activitySyncTimer = null;
  }
}

async function lockNow() {
  sessionStore.lockWallet();
  await router.push("/unlock");
}

onMounted(() => {
  void refreshHomeContext();
  startActivitySyncLoop();
});

onBeforeUnmount(stopActivitySyncLoop);

watch([activeNetwork, primaryAddress, tokensForActiveNetwork], refreshPortfolio, {
  deep: true,
});

watch(activeNetwork, () => {
  resetAssetActionState();
  resetAssetFilterState();
});
watch(primaryAddress, resetAssetActionState);
watch(tokensForActiveNetwork, (tokens) => {
  if (!confirmingRemovalTokenId.value) {
    return;
  }

  if (!tokens.some((token) => token.id === confirmingRemovalTokenId.value)) {
    confirmingRemovalTokenId.value = null;
  }
}, {
  deep: true,
});
watch([assetFilter, assetQuery], () => {
  confirmingRemovalTokenId.value = null;
});

watch([pendingActivities, allNetworks], () => {
  void syncPendingActivityStatus();
}, {
  deep: true,
});
</script>

<template>
  <WalletChrome
    :compact-nav="true"
    :show-hero="false"
  >
    <section class="section-card home-balance-card">
      <div class="home-balance-card__top">
        <div class="wallet-mini-profile">
          <span class="wallet-mini-profile__badge">{{ accountMonogram }}</span>
          <div>
            <strong>{{ accountDisplayLabel }}</strong>
            <p>{{ shortenAddress(primaryAddress) }}</p>
          </div>
        </div>
        <div class="home-balance-card__controls">
          <button
            class="button button--ghost button--small"
            type="button"
            :disabled="isRefreshingHome"
            @click="refreshHomeContext"
          >
            {{ isRefreshingHome ? "同步中" : "刷新" }}
          </button>
          <button class="button button--ghost button--small" type="button" @click="lockNow">锁定</button>
        </div>
      </div>

      <div class="home-balance-card__network">
        <span class="meta-pill">{{ activeNetwork.name }}</span>
        <span class="home-balance-card__meta">{{ homeSyncLabel }}</span>
        <span v-if="snapshot.latestBlock" class="home-balance-card__meta">块高 {{ snapshot.latestBlock }}</span>
      </div>
      <p class="home-balance-card__amount">{{ formatTokenAmount(nativeAsset.balance) }} {{ nativeAsset.symbol }}</p>

      <p class="home-balance-card__eyebrow">{{ visibleAssetCount }} 项资产</p>

      <div class="home-quick-actions">
        <RouterLink class="button button--secondary" to="/wallet/send">发送</RouterLink>
        <RouterLink class="button button--secondary" to="/wallet/receive">收款</RouterLink>
      </div>

      <p v-if="snapshot.error" class="helper-text helper-text--error">{{ snapshot.error }}</p>
    </section>

    <section class="page-grid page-grid--1">
      <SectionCard class="wallet-stream-card" title="资产">
        <template #header>
          <div class="section-card__actions">
            <span class="section-card__meta">{{ assetSummaryLabel }}</span>
            <RouterLink class="button button--ghost button--small" to="/wallet/token/add">
              添加
            </RouterLink>
          </div>
        </template>

        <div class="asset-toolbar">
          <label class="asset-toolbar__search">
            <input
              v-model.trim="assetQuery"
              aria-label="搜索资产"
              type="text"
              placeholder="搜索资产"
            />
          </label>

          <div class="segmented-control asset-toolbar__filters">
            <button
              v-for="option in assetFilterOptions"
              :key="option.id"
              type="button"
              :class="['segment', assetFilter === option.id ? 'segment--active' : '']"
              @click="assetFilter = option.id"
            >
              {{ option.label }}
            </button>
          </div>
        </div>
        <div v-if="hasVisibleAssets" class="token-list">
          <RouterLink v-if="showNativeAsset" class="token-row" to="/wallet/token/native">
            <div class="token-row__main">
              <span class="asset-badge asset-badge--native">{{ assetBadgeLabel(nativeAsset.symbol) }}</span>
              <div class="token-row__text">
                <strong>{{ nativeAsset.symbol }}</strong>
                <p>{{ nativeAsset.name }}</p>
              </div>
            </div>
            <div class="token-row__meta">
              <strong class="token-row__balance">{{ formatTokenAmount(nativeAsset.balance) }}</strong>
              <span class="token-row__subvalue">{{ nativeAsset.symbol }}</span>
            </div>
          </RouterLink>

          <template v-for="token in filteredTokensForActiveNetwork" :key="token.id">
            <RouterLink v-if="token.source !== 'custom'" :to="`/wallet/token/${token.id}`" class="token-row">
              <div class="token-row__main">
                <span class="asset-badge asset-badge--preset">{{ assetBadgeLabel(token.symbol) }}</span>
                <div class="token-row__text">
                  <strong>{{ token.symbol }}</strong>
                  <p>{{ token.name }}</p>
                </div>
              </div>
              <div class="token-row__meta">
                <strong class="token-row__balance">
                  {{ formatTokenAmount(snapshot.tokenBalances[token.id] ?? token.balance) }}
                </strong>
                <span class="token-row__subvalue">{{ token.symbol }}</span>
              </div>
            </RouterLink>

            <article
              v-else
              :class="[
                'token-row',
                'token-row--managed',
                confirmingRemovalTokenId === token.id ? 'token-row--confirming' : '',
              ]"
            >
              <div class="token-row__managed-summary">
                <div class="token-row__main">
                  <span class="asset-badge asset-badge--custom">{{ assetBadgeLabel(token.symbol) }}</span>
                  <div class="token-row__text">
                    <strong>{{ token.symbol }}</strong>
                    <p>{{ token.name }}</p>
                  </div>
                </div>
                <div class="token-row__meta token-row__meta--managed">
                  <strong class="token-row__balance">
                    {{ formatTokenAmount(snapshot.tokenBalances[token.id] ?? token.balance) }}
                  </strong>
                  <span class="token-row__subvalue">自选</span>
                </div>
              </div>
              <div class="inline-actions token-row__actions">
                <RouterLink class="button button--ghost button--small" :to="`/wallet/token/${token.id}`">
                  详情
                </RouterLink>
                <button
                  class="button button--danger button--small"
                  type="button"
                  :disabled="removingTokenId === token.id"
                  @click="requestCustomTokenRemoval(token)"
                >
                  {{
                    removingTokenId === token.id
                      ? "移除中"
                      : confirmingRemovalTokenId === token.id
                        ? "确认移除"
                        : "移除"
                  }}
                </button>
                <button
                  v-if="confirmingRemovalTokenId === token.id"
                  class="button button--ghost button--small"
                  type="button"
                  :disabled="removingTokenId === token.id"
                  @click="cancelCustomTokenRemoval(token.id)"
                >
                  取消
                </button>
              </div>
              <p v-if="confirmingRemovalTokenId === token.id" class="helper-text token-row__hint">
                仅移除本地跟踪，不影响链上资产。
              </p>
            </article>
          </template>
        </div>
        <p v-else class="empty-state">{{ assetEmptyStateMessage }}</p>

        <p v-if="assetActionFeedback" :class="removeFeedbackClass()">{{ assetActionFeedback }}</p>
        <p v-if="snapshot.status === 'loading'" class="helper-text">正在同步链上余额...</p>
      </SectionCard>

      <SectionCard class="wallet-stream-card" title="活动">
        <template #header>
          <div class="section-card__actions">
            <span class="section-card__meta">
              {{ lastActivityCheckAt ? `${activitySummaryLabel} · ${formatRelativeTime(lastActivityCheckAt)}` : activitySummaryLabel }}
            </span>
            <button
              class="button button--ghost button--small"
              type="button"
              :disabled="isRefreshingHome"
              @click="refreshHomeContext"
            >
              {{ isRefreshingHome ? "刷新中" : "刷新" }}
            </button>
          </div>
        </template>

        <div class="segmented-control">
          <button
            v-for="option in activityFilterOptions"
            :key="option.id"
            type="button"
            :class="['segment', activityFilter === option.id ? 'segment--active' : '']"
            @click="activityFilter = option.id"
          >
            {{ option.label }}
          </button>
        </div>

        <div v-if="filteredActivity.length" class="token-list">
          <component
            :is="item.txHash ? RouterLink : 'div'"
            v-for="item in filteredActivity"
            :key="item.id"
            class="token-row token-row--muted token-row--activity"
            v-bind="
              item.txHash
                ? {
                    to: {
                      name: 'wallet-tx-detail',
                      params: {
                        txHash: item.txHash,
                      },
                      query: {
                        networkId: item.networkId ?? activeNetwork.id,
                      },
                    },
                  }
                : {}
            "
          >
            <div class="token-row__main token-row__content">
              <span class="asset-badge asset-badge--activity">{{ assetBadgeLabel(item.assetSymbol ?? "TX") }}</span>
              <div class="token-row__text">
                <strong>{{ activityTitle(item) }}</strong>
                <p>{{ activitySubtitle(item) }}</p>
              </div>
            </div>
            <div class="token-row__meta">
              <strong class="token-row__timestamp">{{ formatRelativeTime(item.createdAt) }}</strong>
              <span
                :class="[
                  'status-chip',
                  item.status === 'complete'
                    ? 'status-chip--accent'
                    : item.status === 'reverted'
                      ? 'status-chip--danger'
                      : item.status === 'pending'
                        ? 'status-chip--warning'
                        : '',
                ]"
              >
                {{ formatActivityStatus(item.status) }}
              </span>
            </div>
          </component>
        </div>
        <p v-else class="empty-state">
          {{ activityEmptyStateMessage }}
        </p>
      </SectionCard>
    </section>
  </WalletChrome>
</template>
