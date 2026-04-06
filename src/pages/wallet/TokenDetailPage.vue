<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { RouterLink, useRoute, useRouter } from "vue-router";
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
  if (!asset.value?.contractAddress || !activeNetwork.value.explorerUrl) {
    return null;
  }

  return `${activeNetwork.value.explorerUrl.replace(/\/$/, "")}/token/${asset.value.contractAddress}`;
});
const addressExplorerUrl = computed(() => {
  if (!primaryAddress.value || !activeNetwork.value.explorerUrl) {
    return null;
  }

  return `${activeNetwork.value.explorerUrl.replace(/\/$/, "")}/address/${primaryAddress.value}`;
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
</script>

<template>
  <WalletChrome
    eyebrow="Token Detail"
    :title="asset ? `${asset.symbol} 资产详情` : '资产详情'"
    :subtitle="
      asset
        ? `当前展示 ${activeNetwork.name} 网络下的余额、资产元数据和最近提交记录。`
        : '当前路由对应的 Token 在这个网络下不可用。'
    "
  >
    <template #actions>
      <RouterLink
        v-if="asset"
        class="button button--primary"
        :to="{ name: 'wallet-send', query: { asset: asset.id } }"
      >
        发送 {{ asset.symbol }}
      </RouterLink>
      <RouterLink class="button button--secondary" to="/wallet/receive">收款</RouterLink>
      <button class="button button--ghost" type="button" @click="refreshTokenContext">刷新</button>
    </template>

    <section v-if="asset" class="status-grid">
      <SectionCard title="Balance" description="当前链上余额" tone="accent">
        <p class="metric-value">{{ assetBalance }} {{ asset.symbol }}</p>
        <p>同步时间：{{ syncTimestamp }}</p>
      </SectionCard>

      <SectionCard title="Network" description="当前资产所在网络">
        <p class="metric-value">{{ activeNetwork.name }}</p>
        <p>Chain ID {{ activeNetwork.chainId }}</p>
      </SectionCard>

      <SectionCard title="Asset Type" description="当前支持范围">
        <p class="metric-value">{{ asset.type === "native" ? "Native" : "ERC20" }}</p>
        <p>{{ asset.source === "custom" ? "Custom tracked token" : "Preset asset" }}</p>
      </SectionCard>

      <SectionCard title="Precision" description="资产精度">
        <p class="metric-value">{{ asset.decimals }}</p>
        <p>Decimals</p>
      </SectionCard>
    </section>

    <section v-if="asset" class="page-grid page-grid--2">
      <SectionCard title="Asset Overview" description="核心资产信息">
        <div class="chip-row">
          <span class="status-chip status-chip--accent">{{ asset.symbol }}</span>
          <span class="status-chip">{{ asset.type === "native" ? "Native Token" : "ERC20 Token" }}</span>
          <span class="status-chip">{{ activeNetwork.name }}</span>
        </div>

        <div class="key-value-list">
          <div class="key-value-row">
            <span>资产名称</span>
            <strong>{{ asset.name }}</strong>
          </div>
          <div class="key-value-row">
            <span>我的地址</span>
            <strong>{{ shortenAddress(primaryAddress) }}</strong>
          </div>
          <div class="key-value-row">
            <span>最新区块</span>
            <strong>{{ snapshot.latestBlock ?? "Pending" }}</strong>
          </div>
          <div class="key-value-row">
            <span>数据状态</span>
            <strong>{{ snapshot.status }}</strong>
          </div>
        </div>

        <p v-if="pageError" class="helper-text helper-text--error">{{ pageError }}</p>
        <p v-else class="helper-text">
          {{ asset.type === "native" ? "发送和 Gas 都以当前网络原生币结算。" : "该 Token 仅在当前网络下被本地跟踪。" }}
        </p>
      </SectionCard>

      <SectionCard
        :title="asset.type === 'native' ? 'Receive Context' : 'Contract Detail'"
        :description="
          asset.type === 'native'
            ? '收款前请确认对方转入网络一致'
            : '当前 ERC20 合约与跟踪来源'
        "
      >
        <template v-if="asset.contractAddress">
          <p class="address-block">{{ asset.contractAddress }}</p>
          <div class="key-value-list">
            <div class="key-value-row">
              <span>跟踪来源</span>
              <strong>{{ asset.source === "custom" ? "Custom" : "Preset" }}</strong>
            </div>
            <div class="key-value-row">
              <span>浏览器支持</span>
              <strong>{{ tokenExplorerUrl ? "Available" : "Unavailable" }}</strong>
            </div>
          </div>
          <div class="form-actions">
            <a
              v-if="tokenExplorerUrl"
              class="button button--secondary"
              :href="tokenExplorerUrl"
              rel="noreferrer"
              target="_blank"
            >
              查看合约
            </a>
          </div>
        </template>
        <template v-else>
          <div class="key-value-list">
            <div class="key-value-row">
              <span>收款地址</span>
              <strong>{{ shortenAddress(primaryAddress) }}</strong>
            </div>
            <div class="key-value-row">
              <span>原生币符号</span>
              <strong>{{ activeNetwork.symbol }}</strong>
            </div>
            <div class="key-value-row">
              <span>地址浏览器</span>
              <strong>{{ addressExplorerUrl ? "Available" : "Unavailable" }}</strong>
            </div>
          </div>
          <div class="form-actions">
            <a
              v-if="addressExplorerUrl"
              class="button button--secondary"
              :href="addressExplorerUrl"
              rel="noreferrer"
              target="_blank"
            >
              查看地址
            </a>
          </div>
        </template>
      </SectionCard>
    </section>

    <section v-if="asset" class="page-grid page-grid--2">
      <SectionCard title="Recent Submitted Activity" description="当前网络下最近提交的相关转账">
        <div v-if="relatedActivity.length" class="token-list">
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
              <div class="chip-row token-row__chips">
                <span class="status-chip">{{ activeNetwork.name }}</span>
                <span v-if="item.assetSymbol" class="status-chip">{{ activityAmountLabel(item) }}</span>
                <span v-if="item.recipientAddress" class="status-chip">
                  {{ activityRecipientLabel(item) }}
                </span>
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
          </RouterLink>
        </div>
        <p v-else class="empty-state">
          当前还没有和这个资产相关的最近活动。发起一笔转账后，这里会显示当前账户的相关活动记录。
        </p>
      </SectionCard>

      <SectionCard title="Next Action" description="当前资产相关的直接入口">
        <div class="card-stack">
          <RouterLink class="button button--primary" :to="{ name: 'wallet-send', query: { asset: asset.id } }">
            继续发送 {{ asset.symbol }}
          </RouterLink>
          <RouterLink class="button button--secondary" to="/wallet/receive">打开收款页</RouterLink>
          <RouterLink class="button button--ghost" to="/wallet">返回资产首页</RouterLink>
        </div>
      </SectionCard>
    </section>

    <section v-if="canRemoveCustomToken" class="page-grid page-grid--1">
      <SectionCard title="Tracked Token Management" description="只影响当前设备上的本地跟踪状态" tone="warning">
        <div class="card-stack">
          <p class="helper-text">
            这个 Token 是你手动添加的自定义 ERC20。移除后会从当前网络的资产列表中消失，但不会影响链上资产本身。
          </p>
          <p v-if="removeTokenFeedback" class="helper-text helper-text--error">
            {{ removeTokenFeedback }}
          </p>
        </div>
        <div class="form-actions">
          <button
            class="button button--danger"
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
            class="button button--ghost"
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

    <section v-if="!asset" class="page-grid page-grid--1">
      <SectionCard title="Token Missing" description="当前网络下找不到这个资产" tone="warning">
        <p class="helper-text helper-text--error">{{ pageError }}</p>
        <div class="form-actions">
          <RouterLink class="button button--primary" to="/wallet">返回资产首页</RouterLink>
          <RouterLink class="button button--ghost" to="/wallet/token/add">手动添加 Token</RouterLink>
        </div>
      </SectionCard>
    </section>
  </WalletChrome>
</template>
