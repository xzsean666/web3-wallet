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
  formatDateTime,
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
const { recentActivity, trackedTokenCount, trackedTokens } = storeToRefs(walletStore);

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
    label: "当前网络",
  },
  {
    id: "pending" as const,
    label: "Pending",
  },
];
const assetFilterOptions = [
  {
    id: "all" as const,
    label: "全部",
  },
  {
    id: "preset" as const,
    label: "预置",
  },
  {
    id: "custom" as const,
    label: "自定义",
  },
];
const activityEmptyStateMessage = computed(() => {
  if (!hasSubmittedActivity.value) {
    return "当前还没有最近活动。发起一笔 Native 或 ERC20 转账后，这里会显示当前账户的最近活动记录。";
  }

  if (activityFilter.value === "network") {
    return `当前筛选下没有 ${activeNetwork.value.name} 网络的最近活动。`;
  }

  if (activityFilter.value === "pending") {
    return "当前没有待确认的本地活动记录。";
  }

  return "当前没有可展示的最近活动。";
});
const activitySummaryLabel = computed(() => {
  if (!hasSubmittedActivity.value) {
    return "等待第一笔本地转账记录";
  }

  return `显示 ${filteredActivity.value.length} / ${submittedActivity.value.length} 条记录`;
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
const assetSummaryLabel = computed(() => {
  if (!normalizedAssetQuery.value && assetFilter.value === "all") {
    return `显示 ${visibleAssetCount.value} / ${totalAssetCount.value} 个资产`;
  }

  return `筛选后显示 ${visibleAssetCount.value} / ${totalAssetCount.value} 个资产`;
});
const assetEmptyStateMessage = computed(() => {
  const keyword = assetQuery.value.trim();

  if (keyword) {
    return `当前筛选下没有匹配“${keyword}”的资产。`;
  }

  if (assetFilter.value === "custom") {
    return "当前网络下还没有自定义 Token。";
  }

  if (assetFilter.value === "preset") {
    return "当前筛选下没有可展示的预置资产。";
  }

  return "当前没有可展示的资产。";
});
const pendingActivities = computed(() =>
  submittedActivity.value.filter((item) => item.status === "pending" && item.txHash),
);
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

function activityAmountLabel(item: ActivityItem) {
  if (item.amount && item.assetSymbol) {
    return `${formatTokenAmount(item.amount)} ${item.assetSymbol}`;
  }

  if (item.assetSymbol) {
    return item.assetSymbol;
  }

  return "Transfer";
}

function activityRecipientLabel(item: ActivityItem) {
  if (!item.recipientAddress) {
    return "收款地址待解析";
  }

  return (
    walletStore.formatActivityRecipient({
      networkId: resolveActivityNetwork(item).id,
      address: item.recipientAddress,
      includeAddress: true,
    }) ?? "收款地址待解析"
  );
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
    eyebrow="Wallet Shell"
    title="资产首页已经有落点了。"
    subtitle="当前已经接入链上余额、真实签名发送入口和最近活动视图，主流程已经成形，剩余工作集中在历史深度和错误细节。"
  >
    <template #actions>
      <button class="button button--ghost" type="button" :disabled="isRefreshingHome" @click="refreshHomeContext">
        {{ isRefreshingHome ? "正在刷新..." : "刷新" }}
      </button>
      <RouterLink class="button button--secondary" to="/wallet/receive">Receive</RouterLink>
      <RouterLink class="button button--primary" to="/wallet/send">Send</RouterLink>
      <RouterLink class="button button--ghost" to="/wallet/token/add">Add Token</RouterLink>
      <button class="button button--ghost" type="button" @click="lockNow">Lock</button>
    </template>

    <section class="status-grid">
      <SectionCard title="Account" description="当前账户">
        <p class="metric-value">{{ walletLabel }}</p>
        <p>{{ shortenAddress(primaryAddress) }}</p>
      </SectionCard>
      <SectionCard title="Network" description="当前生效网络">
        <p class="metric-value">{{ activeNetwork.name }}</p>
        <p>Chain ID {{ activeNetwork.chainId }}</p>
      </SectionCard>
      <SectionCard title="Native Asset" description="只支持 Native Token 和 ERC20">
        <p class="metric-value">{{ nativeAsset.balance }} {{ nativeAsset.symbol }}</p>
        <p>{{ nativeAsset.name }}</p>
        <p v-if="snapshot.latestBlock">Latest block: {{ snapshot.latestBlock }}</p>
      </SectionCard>
      <SectionCard title="Tracked Tokens" description="当前已跟踪的 ERC20">
        <p class="metric-value">{{ tokensForActiveNetwork.length }}</p>
        <p>Total tracked: {{ trackedTokenCount }}</p>
        <p v-if="snapshot.lastSyncedAt">Synced: {{ snapshot.lastSyncedAt }}</p>
      </SectionCard>
    </section>

    <section class="page-grid page-grid--2">
      <SectionCard title="Assets" description="Native Token + ERC20 Token">
        <div class="form-actions form-actions--compact">
          <RouterLink class="button button--ghost button--small" to="/wallet/token/add">
            手动添加 ERC20
          </RouterLink>
        </div>

        <div class="asset-toolbar">
          <label class="field asset-toolbar__search">
            <span>搜索资产</span>
            <input
              v-model.trim="assetQuery"
              type="text"
              placeholder="按名称或符号搜索，例如 ETH / USDT"
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

        <p class="helper-text">{{ assetSummaryLabel }}</p>

        <div v-if="hasVisibleAssets" class="token-list">
          <RouterLink v-if="showNativeAsset" class="token-row" to="/wallet/token/native">
            <div>
              <strong>{{ nativeAsset.symbol }}</strong>
              <p>{{ nativeAsset.name }}</p>
            </div>
            <span>{{ nativeAsset.balance }}</span>
          </RouterLink>

          <template
            v-for="token in filteredTokensForActiveNetwork"
            :key="token.id"
          >
            <RouterLink v-if="token.source !== 'custom'" :to="`/wallet/token/${token.id}`" class="token-row">
              <div>
                <strong>{{ token.symbol }}</strong>
                <p>{{ token.name }}</p>
              </div>
              <span>{{ snapshot.tokenBalances[token.id] ?? token.balance }}</span>
            </RouterLink>

            <article
              v-else
              :class="[
                'token-row',
                'token-row--managed',
                confirmingRemovalTokenId === token.id ? 'token-row--confirming' : '',
              ]"
            >
              <div class="token-row__content">
                <div>
                  <strong>{{ token.symbol }}</strong>
                  <p>{{ token.name }} <span>· Custom</span></p>
                </div>
              </div>
              <div class="token-row__meta token-row__meta--managed">
                <strong class="token-row__balance">{{ snapshot.tokenBalances[token.id] ?? token.balance }}</strong>
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
                        ? "移除中..."
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
                  再次确认后会从当前设备的本地跟踪列表移除，不影响链上资产。
                </p>
              </div>
            </article>
          </template>
        </div>
        <p v-else class="empty-state">{{ assetEmptyStateMessage }}</p>

        <p v-if="assetActionFeedback" :class="removeFeedbackClass()">{{ assetActionFeedback }}</p>
        <p v-if="tokensForActiveNetwork.some((token) => token.source === 'custom')" class="helper-text">
          自定义 Token 支持在首页直接查看详情或移除，本地删除不会影响链上余额。
        </p>
        <p v-if="snapshot.status === 'loading'" class="helper-text">正在同步链上余额...</p>
        <p v-if="snapshot.error" class="helper-text helper-text--error">{{ snapshot.error }}</p>
      </SectionCard>

      <SectionCard title="Recent Activity" description="当前展示这个账户的最近活动记录">
        <template #header>
          <button
            class="button button--ghost button--small"
            type="button"
            :disabled="isRefreshingHome"
            @click="refreshHomeContext"
          >
            {{ isRefreshingHome ? "刷新中..." : "立即检查" }}
          </button>
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

        <p class="helper-text">
          {{ activitySummaryLabel }}
          <span v-if="lastActivityCheckAt"> · 最近检查 {{ formatRelativeTime(lastActivityCheckAt) }}</span>
        </p>
        <p v-if="lastActivityCheckAt" class="helper-text">{{ formatDateTime(lastActivityCheckAt) }}</p>

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
            <div class="token-row__content">
              <strong>{{ activityTitle(item) }}</strong>
              <p>{{ activitySubtitle(item) }}</p>
              <div class="chip-row token-row__chips">
                <span class="status-chip">{{ activityNetworkName(item) }}</span>
                <span v-if="item.assetSymbol" class="status-chip">{{ activityAmountLabel(item) }}</span>
                <span v-if="item.recipientAddress" class="status-chip">{{ activityRecipientLabel(item) }}</span>
              </div>
            </div>
            <div class="token-row__meta">
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
              <strong class="token-row__timestamp">{{ formatRelativeTime(item.createdAt) }}</strong>
              <span class="helper-text">{{ formatDateTime(item.createdAt) }}</span>
            </div>
          </component>
        </div>
        <p v-else class="empty-state">
          {{ activityEmptyStateMessage }}
        </p>
      </SectionCard>
    </section>

    <section class="page-grid page-grid--2">
      <SectionCard title="Quick Access" description="钱包常用入口">
        <div class="button-row">
          <RouterLink class="button button--secondary" to="/settings/networks">
            管理网络
          </RouterLink>
          <RouterLink class="button button--ghost" to="/settings">
            查看设置
          </RouterLink>
        </div>
      </SectionCard>

      <SectionCard title="MVP Status" description="当前版本边界与已完成能力">
        <ul class="bullet-list">
          <li>当前资产页已接入 Native Token 与 ERC20 余额拉取</li>
          <li>发送页已经接入本地签名与原始交易广播</li>
          <li>最近活动和地址簿等非敏感状态已接入本地持久化</li>
          <li>自定义网络管理页已经可点击流转</li>
        </ul>
      </SectionCard>
    </section>
  </WalletChrome>
</template>
