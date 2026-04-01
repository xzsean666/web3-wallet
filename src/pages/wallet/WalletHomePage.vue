<script setup lang="ts">
import { computed, onMounted, watch } from "vue";
import { storeToRefs } from "pinia";
import { RouterLink, useRouter } from "vue-router";
import SectionCard from "../../components/SectionCard.vue";
import WalletChrome from "../../components/WalletChrome.vue";
import { fetchPortfolioSnapshot } from "../../services/evm";
import { useNetworksStore } from "../../stores/networks";
import { usePortfolioStore } from "../../stores/portfolio";
import { useSessionStore } from "../../stores/session";
import { useWalletStore } from "../../stores/wallet";
import { shortenAddress } from "../../utils/format";

const router = useRouter();
const sessionStore = useSessionStore();
const networksStore = useNetworksStore();
const portfolioStore = usePortfolioStore();
const walletStore = useWalletStore();

const { activeNetwork } = storeToRefs(networksStore);
const { primaryAddress, walletLabel } = storeToRefs(sessionStore);
const { recentActivity, trackedTokenCount, trackedTokens } = storeToRefs(walletStore);

const tokensForActiveNetwork = computed(() =>
  trackedTokens.value.filter((token) => token.networkIds.includes(activeNetwork.value.id)),
);
const snapshot = computed(() => portfolioStore.getSnapshot(activeNetwork.value.id));

const nativeAsset = computed(() => ({
  name: `${activeNetwork.value.name} Native Token`,
  symbol: activeNetwork.value.symbol,
  balance: snapshot.value.nativeBalance,
}));

async function refreshPortfolio() {
  if (!primaryAddress.value) {
    return;
  }

  portfolioStore.markLoading(activeNetwork.value.id);

  try {
    const nextSnapshot = await fetchPortfolioSnapshot({
      network: activeNetwork.value,
      address: primaryAddress.value,
      tokens: tokensForActiveNetwork.value,
    });

    portfolioStore.setSnapshot(nextSnapshot);
  } catch (error) {
    portfolioStore.setError(
      activeNetwork.value.id,
      error instanceof Error ? error.message : "Failed to load portfolio snapshot",
    );
  }
}

async function lockNow() {
  sessionStore.lockWallet();
  await router.push("/unlock");
}

onMounted(refreshPortfolio);

watch([activeNetwork, primaryAddress, tokensForActiveNetwork], refreshPortfolio, {
  deep: true,
});
</script>

<template>
  <WalletChrome
    eyebrow="Wallet Shell"
    title="资产首页已经有落点了。"
    subtitle="这一版先把账户、网络、资产和最近活动放到一个稳定壳里，发送与链上数据下一步继续补。"
  >
    <template #actions>
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

        <div class="token-list">
          <RouterLink class="token-row" to="/wallet/token/native">
            <div>
              <strong>{{ nativeAsset.symbol }}</strong>
              <p>{{ nativeAsset.name }}</p>
            </div>
            <span>{{ nativeAsset.balance }}</span>
          </RouterLink>

          <RouterLink
            v-for="token in tokensForActiveNetwork"
            :key="token.id"
            :to="`/wallet/token/${token.id}`"
            class="token-row"
          >
            <div>
              <strong>{{ token.symbol }}</strong>
              <p>
                {{ token.name }}
                <span v-if="token.source === 'custom'">· Custom</span>
              </p>
            </div>
            <span>{{ snapshot.tokenBalances[token.id] ?? token.balance }}</span>
          </RouterLink>
        </div>

        <p v-if="snapshot.status === 'loading'" class="helper-text">正在同步链上余额...</p>
        <p v-if="snapshot.error" class="helper-text helper-text--error">{{ snapshot.error }}</p>
      </SectionCard>

      <SectionCard title="Recent Activity" description="Milestone 3 再接真实交易">
        <div class="token-list">
          <component
            :is="item.txHash ? RouterLink : 'div'"
            v-for="item in recentActivity"
            :key="item.id"
            class="token-row token-row--muted"
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
            <div>
              <strong>{{ item.title }}</strong>
              <p>{{ item.subtitle }}</p>
            </div>
            <span>{{ item.status }}</span>
          </component>
        </div>
      </SectionCard>
    </section>

    <section class="page-grid page-grid--2">
      <SectionCard title="Next" description="Milestone 2 / 3 的直接入口">
        <div class="button-row">
          <RouterLink class="button button--secondary" to="/settings/networks">
            管理网络
          </RouterLink>
          <RouterLink class="button button--ghost" to="/settings">
            查看设置
          </RouterLink>
        </div>
      </SectionCard>

      <SectionCard title="Build Note" description="当前首页是钱包骨架，不是最终产品 UI">
        <ul class="bullet-list">
          <li>当前资产数据仍是占位状态</li>
          <li>发送页已经有入口，但还没有真实交易逻辑</li>
          <li>自定义网络管理页已经可点击流转</li>
        </ul>
      </SectionCard>
    </section>
  </WalletChrome>
</template>
