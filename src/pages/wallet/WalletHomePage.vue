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
const { accountCount, activeAccountId, primaryAddress } = storeToRefs(sessionStore);
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
const isAddressCopied = ref(false);
let portfolioRefreshRequestId = 0;

async function copyHomeAddress() {
  if (!primaryAddress.value) return;
  try {
    await navigator.clipboard.writeText(primaryAddress.value);
    isAddressCopied.value = true;
    setTimeout(() => {
      isAddressCopied.value = false;
    }, 2000);
  } catch {}
}

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
    :compact-nav="false"
    :show-hero="false"
    :show-nav="true"
  >
    <section class="section-card home-balance-card">
      <div class="home-balance-card__top">
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
        <div class="home-balance-card__controls">
          <button class="button button--ghost button--small" type="button" @click="lockNow" title="锁定钱包">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            锁定
          </button>
        </div>
      </div>

      <div v-if="isActiveTestnet" class="home-testnet-banner">
        <strong>测试网</strong>
        <span>当前显示的是测试网络资产，请勿当作正式网余额。</span>
      </div>

      <div style="text-align: center; margin: 10px 0 6px;">
        <p class="home-balance-card__amount" style="margin: 0; font-size: 2.2rem; font-weight: 800; letter-spacing: -0.02em;">
          {{ formatTokenAmount(nativeAsset.balance) }} {{ nativeAsset.symbol }}
        </p>
        <button
          v-if="primaryAddress"
          type="button"
          class="home-balance-card__address-btn"
          style="margin-top: 8px; display: inline-flex; align-items: center; gap: 5px; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: var(--radius-full); padding: 3px 10px; font-family: var(--font-mono); font-size: 0.74rem; color: var(--text-secondary); cursor: pointer; transition: all 0.2s;"
          :title="primaryAddress"
          @click="copyHomeAddress"
        >
          <span>{{ shortenAddress(primaryAddress) }}</span>
          <span v-if="isAddressCopied" style="color: var(--accent-success); font-weight: 600;">已复制</span>
          <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        </button>
      </div>

      <div class="home-quick-actions">
        <RouterLink class="button button--secondary" to="/wallet/send">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;">
            <line x1="7" y1="17" x2="17" y2="7" />
            <polyline points="7 7 17 7 17 17" />
          </svg>
          发送
        </RouterLink>
        <RouterLink class="button button--secondary" to="/wallet/receive">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;">
            <line x1="17" y1="7" x2="7" y2="17" />
            <polyline points="17 17 7 17 7 7" />
          </svg>
          收款
        </RouterLink>
        <RouterLink class="button button--secondary" :to="{ name: 'wallet-send', query: { scan: '1' } }">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;">
            <path d="M3 7V5a2 2 0 0 1 2-2h2" />
            <path d="M17 3h2a2 2 0 0 1 2 2v2" />
            <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
            <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
          </svg>
          扫码
        </RouterLink>
        <button
          class="button button--secondary"
          type="button"
          :disabled="isRefreshingHome"
          @click="refreshHomeContext"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;">
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          {{ isRefreshingHome ? "同步中" : "刷新" }}
        </button>
      </div>

      <p v-if="snapshot.error" class="helper-text helper-text--error">{{ snapshot.error }}</p>
    </section>

    <section class="page-grid page-grid--1">
      <SectionCard class="wallet-stream-card" title="资产">
        <template #header>
          <div class="section-card__actions">
            <span class="section-card__meta">{{ assetSummaryLabel }}</span>
            <RouterLink class="button button--ghost button--small" to="/wallet/token/add">
              + 添加代币
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
