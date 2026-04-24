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
import type { ActivityItem } from "../../types/wallet";
import { formatRelativeTime, formatTokenAmount, shortenAddress } from "../../utils/format";

const router = useRouter();
const sessionStore = useSessionStore();
const networksStore = useNetworksStore();
const portfolioStore = usePortfolioStore();
const walletStore = useWalletStore();

const { activeNetwork, allNetworks } = storeToRefs(networksStore);
const { accountCount, activeAccountId, primaryAddress, walletLabel } = storeToRefs(sessionStore);
const { recentActivity, trackedTokens } = storeToRefs(walletStore);

const tokensForActiveNetwork = computed(() =>
  trackedTokens.value.filter((token) => token.networkIds.includes(activeNetwork.value.id)),
);
const snapshot = computed(() =>
  portfolioStore.getSnapshot(activeNetwork.value.id, primaryAddress.value || null),
);
const submittedActivity = computed(() =>
  recentActivity.value.filter(isActivityForCurrentAccount),
);
const accountDisplayLabel = computed(() =>
  walletLabel.value || shortenAddress(primaryAddress.value) || "当前账户",
);
const accountMonogram = computed(() => {
  const source = walletLabel.value?.trim() || activeNetwork.value.symbol || "W";

  return source.slice(0, 1).toUpperCase();
});

const nativeAsset = computed(() => ({
  name: `${activeNetwork.value.name} Native Token`,
  symbol: activeNetwork.value.symbol,
  balance: snapshot.value.nativeBalance,
}));
const isActiveTestnet = computed(() => activeNetwork.value.environment === "testnet");
const activeNetworkEnvironmentLabel = computed(() =>
  isActiveTestnet.value ? "测试网" : "正式网",
);
const filteredTokensForActiveNetwork = computed(() => tokensForActiveNetwork.value);
const showNativeAsset = computed(() => true);
const visibleAssetCount = computed(() =>
  filteredTokensForActiveNetwork.value.length + (showNativeAsset.value ? 1 : 0),
);
const totalAssetCount = computed(() => tokensForActiveNetwork.value.length + 1);
const hasVisibleAssets = computed(() => visibleAssetCount.value > 0);
const assetSummaryLabel = computed(() => `${totalAssetCount.value} 项`);
const assetEmptyStateMessage = computed(() => "没有可显示资产");
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
    :show-nav="false"
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
        <span :class="['meta-pill', isActiveTestnet ? 'meta-pill--testnet' : '']">
          {{ activeNetwork.name }}
        </span>
        <span :class="['status-chip', isActiveTestnet ? 'status-chip--warning' : 'status-chip--accent']">
          {{ activeNetworkEnvironmentLabel }}
        </span>
        <span class="home-balance-card__meta">{{ homeSyncLabel }}</span>
        <span v-if="snapshot.latestBlock" class="home-balance-card__meta">块高 {{ snapshot.latestBlock }}</span>
      </div>
      <div v-if="isActiveTestnet" class="home-testnet-banner">
        <strong>测试网</strong>
        <span>当前显示的是测试网络资产，请勿当作正式网余额。</span>
      </div>
      <p class="home-balance-card__amount">{{ formatTokenAmount(nativeAsset.balance) }} {{ nativeAsset.symbol }}</p>

      <p class="home-balance-card__eyebrow">{{ visibleAssetCount }} 项资产</p>

      <div class="home-quick-actions">
        <RouterLink class="button button--secondary" to="/wallet/send">发送</RouterLink>
        <RouterLink class="button button--secondary" to="/wallet/receive">收款</RouterLink>
        <RouterLink class="button button--ghost" to="/wallet/activity">活动</RouterLink>
        <RouterLink class="button button--ghost" to="/settings">设置</RouterLink>
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

          <RouterLink
            v-for="token in filteredTokensForActiveNetwork"
            :key="token.id"
            :to="`/wallet/token/${token.id}`"
            class="token-row"
          >
            <div class="token-row__main">
              <span
                :class="[
                  'asset-badge',
                  token.source === 'custom' ? 'asset-badge--custom' : 'asset-badge--preset',
                ]"
              >
                {{ assetBadgeLabel(token.symbol) }}
              </span>
              <div class="token-row__text">
                <strong>{{ token.symbol }}</strong>
                <p>{{ token.name }}</p>
              </div>
            </div>
            <div class="token-row__meta">
              <strong class="token-row__balance">
                {{ formatTokenAmount(snapshot.tokenBalances[token.id] ?? token.balance) }}
              </strong>
              <span class="token-row__subvalue">
                {{ token.source === "custom" ? "自选" : token.symbol }}
              </span>
            </div>
          </RouterLink>
        </div>
        <p v-else class="empty-state">{{ assetEmptyStateMessage }}</p>

        <p v-if="snapshot.status === 'loading'" class="helper-text">正在同步链上余额...</p>
      </SectionCard>
    </section>
  </WalletChrome>
</template>
