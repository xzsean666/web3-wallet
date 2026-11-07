<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import SectionCard from "../../components/SectionCard.vue";
import WalletChrome from "../../components/WalletChrome.vue";
import { fetchPortfolioSnapshot } from "../../services/evm";
import { useNetworksStore } from "../../stores/networks";
import { usePortfolioStore } from "../../stores/portfolio";
import { useSessionStore } from "../../stores/session";
import { useWalletStore } from "../../stores/wallet";
import type { ActivityItem } from "../../types/wallet";
import {
  formatActivityStatus,
  formatDateTime,
  formatRelativeTime,
  formatTokenAmount,
  shortenAddress,
} from "../../utils/format";
import {
  buildAddressExplorerUrl,
  buildTokenExplorerUrl,
  toSafeExternalUrl,
} from "../../utils/runtimeSafety";

const route = useRoute();
const router = useRouter();
const networksStore = useNetworksStore();
const portfolioStore = usePortfolioStore();
const sessionStore = useSessionStore();
const walletStore = useWalletStore();

const tokenId = computed(() => String(route.params.tokenId));
const { activeNetwork } = storeToRefs(networksStore);
const { accountCount, activeAccountId, primaryAddress } = storeToRefs(sessionStore);
const { recentActivity } = storeToRefs(walletStore);
const snapshot = computed(() =>
  portfolioStore.getSnapshot(activeNetwork.value.id, primaryAddress.value || null),
);
const removeTokenFeedback = ref("");
const isRemovingCustomToken = ref(false);
const isRemoveConfirming = ref(false);
const externalLinkError = ref("");
let tokenContextRefreshRequestId = 0;

const isNativeToken = computed(() => tokenId.value === "native");
const trackedToken = computed(() =>
  walletStore.tokensForNetwork(activeNetwork.value.id).find((entry) => entry.id === tokenId.value) ?? null,
);
const asset = computed(() => {
  if (isNativeToken.value) {
    return {
      id: "native",
      type: "native" as const,
      name: `${activeNetwork.value.name} Native Token`,
      symbol: activeNetwork.value.symbol,
      balance: snapshot.value.nativeBalance,
      decimals: 18,
      source: "preset" as const,
      contractAddress: null,
    };
  }

  if (!trackedToken.value) {
    return null;
  }

  return {
    id: trackedToken.value.id,
    type: "erc20" as const,
    name: trackedToken.value.name,
    symbol: trackedToken.value.symbol,
    balance: snapshot.value.tokenBalances[trackedToken.value.id] ?? trackedToken.value.balance,
    decimals: trackedToken.value.decimals,
    source: trackedToken.value.source,
    contractAddress: trackedToken.value.contractAddress,
  };
});

const assetBalance = computed(() => formatTokenAmount(asset.value?.balance));
const canRemoveCustomToken = computed(() =>
  asset.value?.type === "erc20" && asset.value.source === "custom",
);
const syncTimestamp = computed(() => formatDateTime(snapshot.value.lastSyncedAt));
const pageError = computed(() => {
  if (!isNativeToken.value && !trackedToken.value) {
    return "当前网络下找不到这个 Token，请返回资产首页重新选择。";
  }

  return snapshot.value.error;
});
const relatedActivity = computed(() =>
  recentActivity.value.filter((item) => {
    if (!isActivityForCurrentAccount(item)) {
      return false;
    }

    if (!item.txHash || item.networkId !== activeNetwork.value.id) {
      return false;
    }

    return item.assetId === tokenId.value;
  }),
);
const tokenExplorerUrl = computed(() => {
  return buildTokenExplorerUrl(activeNetwork.value.explorerUrl, asset.value?.contractAddress);
});
const addressExplorerUrl = computed(() => {
  return buildAddressExplorerUrl(activeNetwork.value.explorerUrl, primaryAddress.value);
});

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
      networkId: activeNetwork.value.id,
      address: item.recipientAddress,
      includeAddress: true,
    }) ?? "收款地址待解析"
  );
}

function activityTitle(item: ActivityItem) {
  return walletStore.formatActivityTitle({
    ...item,
    networkId: activeNetwork.value.id,
  });
}

function activitySubtitle(item: ActivityItem) {
  return walletStore.formatActivitySubtitle(
    {
      ...item,
      networkId: activeNetwork.value.id,
    },
    activeNetwork.value.name,
  );
}

async function refreshTokenContext() {
  if (!primaryAddress.value) {
    return;
  }

  const requestId = ++tokenContextRefreshRequestId;
  const requestNetwork = activeNetwork.value;
  const requestAddress = primaryAddress.value;
  const requestTokens = [...walletStore.tokensForNetwork(requestNetwork.id)];

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

    if (requestId !== tokenContextRefreshRequestId) {
      return;
    }

    portfolioStore.setSnapshot(nextSnapshot);
  } catch (error) {
    if (requestId !== tokenContextRefreshRequestId) {
      return;
    }

    portfolioStore.setError({
      networkId: requestNetwork.id,
      accountAddress: requestAddress,
      error: error instanceof Error ? error.message : "Failed to load token detail",
    });
  }
}

onMounted(refreshTokenContext);
watch([activeNetwork, primaryAddress, tokenId], refreshTokenContext);
watch([tokenId, activeNetwork], () => {
  removeTokenFeedback.value = "";
  isRemoveConfirming.value = false;
});

async function removeTrackedToken() {
  if (!trackedToken.value) {
    removeTokenFeedback.value = "当前找不到可移除的 Token";
    return;
  }

  if (!isRemoveConfirming.value) {
    isRemoveConfirming.value = true;
    removeTokenFeedback.value = "再次点击“确认移除”后，这个自定义 Token 会从本地跟踪列表中删除。";
    return;
  }

  isRemovingCustomToken.value = true;
  const result = walletStore.removeCustomToken(trackedToken.value.id);

  if (!result.ok) {
    removeTokenFeedback.value = result.error;
    isRemovingCustomToken.value = false;
    return;
  }

  await router.replace("/wallet");
}

async function openExternal(url: string | null) {
  if (!url) {
    return;
  }

  const safeUrl = toSafeExternalUrl(url);

  if (!safeUrl) {
    externalLinkError.value = "已拦截不安全的外链地址";
    return;
  }

  externalLinkError.value = "";
  if (isTauri()) {
    await openUrl(safeUrl);
    return;
  }

  const openedWindow = window.open(safeUrl, "_blank", "noopener,noreferrer");
  if (openedWindow) {
    openedWindow.opener = null;
  }
}
</script>

<template>
  <WalletChrome
    eyebrow="资产详情"
    :title="asset ? `${asset.symbol}` : '资产详情'"
    :subtitle="asset ? `${activeNetwork.name} · ${asset.name}` : '当前网络下资产不可用'"
    :show-nav="false"
  >
    <!-- Asset Balance & Actions Hero -->
    <section v-if="asset" class="section-card home-balance-card" style="padding: 22px 20px;">
      <div style="display: flex; align-items: center; justify-content: space-between;">
        <span class="status-chip status-chip--accent">{{ asset.type === 'native' ? '原生币' : 'ERC20 代币' }}</span>
        <button class="button button--ghost button--small" type="button" @click="refreshTokenContext">
          刷新
        </button>
      </div>

      <p class="home-balance-card__amount" style="margin: 4px 0 0;">
        {{ assetBalance }} {{ asset.symbol }}
      </p>

      <div class="home-quick-actions" style="margin-top: 6px;">
        <RouterLink
          class="button button--secondary"
          :to="{ name: 'wallet-send', query: { asset: asset.id } }"
        >
          发送
        </RouterLink>
        <RouterLink
          class="button button--secondary"
          :to="{ name: 'wallet-send', query: { asset: asset.id, scan: '1' } }"
        >
          扫码
        </RouterLink>
        <RouterLink class="button button--secondary" to="/wallet/receive">
          收款
        </RouterLink>
        <RouterLink class="button button--ghost" to="/wallet">
          返回
        </RouterLink>
      </div>

      <p v-if="pageError" class="helper-text helper-text--error">{{ pageError }}</p>
    </section>

    <!-- Token Information Card -->
    <section v-if="asset" class="page-grid page-grid--1">
      <SectionCard title="代币详情">
        <div class="key-value-list">
          <div class="key-value-row">
            <span>代币全称</span>
            <strong>{{ asset.name }}</strong>
          </div>
          <div class="key-value-row">
            <span>所在网络</span>
            <strong>{{ activeNetwork.name }} (Chain ID: {{ activeNetwork.chainId }})</strong>
          </div>
          <div class="key-value-row">
            <span>代币精度</span>
            <strong>{{ asset.decimals }} Decimals</strong>
          </div>
          <div v-if="snapshot.lastSyncedAt" class="key-value-row">
            <span>数据同步</span>
            <strong>{{ syncTimestamp }}</strong>
          </div>
          <div v-if="asset.contractAddress" class="key-value-row">
            <span>合约地址</span>
            <strong>{{ asset.contractAddress }}</strong>
          </div>
          <div class="key-value-row">
            <span>钱包地址</span>
            <strong>{{ shortenAddress(primaryAddress) }}</strong>
          </div>
          <div v-if="snapshot.latestBlock" class="key-value-row">
            <span>链上最新块高</span>
            <strong>{{ snapshot.latestBlock }}</strong>
          </div>
        </div>

        <div v-if="asset.contractAddress && tokenExplorerUrl" class="form-actions" style="margin-top: 4px;">
          <button
            class="button button--secondary button--small"
            type="button"
            @click="openExternal(tokenExplorerUrl)"
          >
            在区块浏览器中查看合约
          </button>
        </div>
        <div v-else-if="addressExplorerUrl" class="form-actions" style="margin-top: 4px;">
          <button
            class="button button--secondary button--small"
            type="button"
            @click="openExternal(addressExplorerUrl)"
          >
            在区块浏览器中查看地址
          </button>
        </div>
        <p v-if="externalLinkError" class="helper-text helper-text--error">
          {{ externalLinkError }}
        </p>
      </SectionCard>

      <!-- Recent Submitted Activity -->
      <SectionCard v-if="relatedActivity.length" title="相关记录">
        <div class="token-list">
          <RouterLink
            v-for="item in relatedActivity"
            :key="item.id"
            class="token-row token-row--activity"
            :to="{
              name: 'wallet-tx-detail',
              params: {
                txHash: item.txHash,
              },
              query: {
                networkId: item.networkId,
              },
            }"
          >
            <div class="token-row__content">
              <strong>{{ activityTitle(item) }}</strong>
              <p>{{ activitySubtitle(item) }}</p>
              <div class="chip-row token-row__chips" style="margin-top: 4px;">
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
            </div>
          </RouterLink>
        </div>
      </SectionCard>

      <!-- Manage Custom Token -->
      <SectionCard v-if="canRemoveCustomToken" title="管理自选代币" tone="warning">
        <p class="helper-text">
          此代币为自选添加的 ERC20 代币。移除后仅从本地资产列表取消跟踪，不会影响链上资产。
        </p>
        <p v-if="removeTokenFeedback" class="helper-text helper-text--error">
          {{ removeTokenFeedback }}
        </p>
        <div class="form-actions" style="margin-top: 4px;">
          <button
            class="button button--danger button--small"
            type="button"
            :disabled="isRemovingCustomToken"
            @click="removeTrackedToken"
          >
            {{
              isRemovingCustomToken
                ? "移除中..."
                : isRemoveConfirming
                  ? "确认移除这个自定义 Token"
                  : "移除自定义 Token"
            }}
          </button>
          <button
            v-if="isRemoveConfirming && !isRemovingCustomToken"
            class="button button--ghost button--small"
            type="button"
            @click="
              isRemoveConfirming = false;
              removeTokenFeedback = '';
            "
          >
            取消
          </button>
        </div>
      </SectionCard>
    </section>

    <!-- Missing Asset State -->
    <section v-if="!asset" class="page-grid page-grid--1">
      <SectionCard title="未找到资产" tone="warning">
        <p class="helper-text helper-text--error">{{ pageError }}</p>
        <div class="form-actions">
          <RouterLink class="button button--primary" to="/wallet">返回资产首页</RouterLink>
          <RouterLink class="button button--ghost" to="/wallet/token/add">手动添加代币</RouterLink>
        </div>
      </SectionCard>
    </section>
  </WalletChrome>
</template>
