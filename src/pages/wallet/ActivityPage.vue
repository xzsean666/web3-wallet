<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { RouterLink } from "vue-router";
import SectionCard from "../../components/SectionCard.vue";
import WalletChrome from "../../components/WalletChrome.vue";
import { fetchTransactionDetails } from "../../services/evm";
import { useNetworksStore } from "../../stores/networks";
import { useSessionStore } from "../../stores/session";
import { useWalletStore } from "../../stores/wallet";
import type { ActivityItem } from "../../types/wallet";
import { formatActivityStatus, formatRelativeTime } from "../../utils/format";

const sessionStore = useSessionStore();
const networksStore = useNetworksStore();
const walletStore = useWalletStore();

const { activeAccountId, accountCount, primaryAddress } = storeToRefs(sessionStore);
const { activeNetwork, allNetworks } = storeToRefs(networksStore);
const { recentActivity } = storeToRefs(walletStore);

const isRefreshing = ref(false);
const lastCheckedAt = ref<string | null>(null);
let activitySyncTimer: number | null = null;

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

function resolveActivityNetwork(item: ActivityItem) {
  if (item.networkId) {
    const matchedNetwork = allNetworks.value.find((network) => network.id === item.networkId);

    if (matchedNetwork) {
      return matchedNetwork;
    }
  }

  return activeNetwork.value;
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
    resolveActivityNetwork(item).name,
  );
}

function assetBadgeLabel(symbol: string) {
  return symbol.slice(0, 2).toUpperCase();
}

const submittedActivity = computed(() =>
  recentActivity.value.filter(isActivityForCurrentAccount),
);
const pendingActivities = computed(() =>
  submittedActivity.value.filter((item) => item.status === "pending" && item.txHash),
);

async function refreshActivity() {
  if (isRefreshing.value) {
    return;
  }

  isRefreshing.value = true;

  try {
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
  } finally {
    lastCheckedAt.value = new Date().toISOString();
    isRefreshing.value = false;
  }
}

onMounted(() => {
  void refreshActivity();
  activitySyncTimer = window.setInterval(() => {
    void refreshActivity();
  }, 12000);
});

onBeforeUnmount(() => {
  if (activitySyncTimer) {
    window.clearInterval(activitySyncTimer);
    activitySyncTimer = null;
  }
});

watch([pendingActivities, allNetworks], () => {
  void refreshActivity();
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
    <SectionCard class="simple-sheet" title="活动">
      <template #header>
        <div class="section-card__actions">
          <span class="section-card__meta">
            {{ lastCheckedAt ? `已刷新 ${formatRelativeTime(lastCheckedAt)}` : `${submittedActivity.length} 条` }}
          </span>
          <RouterLink class="button button--ghost button--small" to="/wallet">
            返回
          </RouterLink>
        </div>
      </template>

      <div class="form-actions form-actions--compact">
        <button
          class="button button--secondary button--small"
          type="button"
          :disabled="isRefreshing"
          @click="refreshActivity"
        >
          {{ isRefreshing ? "刷新中" : "刷新" }}
        </button>
      </div>

      <div v-if="submittedActivity.length" class="token-list">
        <component
          :is="item.txHash ? RouterLink : 'div'"
          v-for="item in submittedActivity"
          :key="item.id"
          class="token-row token-row--activity token-row--activity-page"
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
            <span class="meta-pill meta-pill--subtle">{{ resolveActivityNetwork(item).name }}</span>
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

      <p v-else class="empty-state">还没有记录</p>
    </SectionCard>
  </WalletChrome>
</template>
