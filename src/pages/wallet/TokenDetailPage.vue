<script setup lang="ts">
import { computed, onMounted, watch } from "vue";
import { useRoute } from "vue-router";
import { storeToRefs } from "pinia";
import SectionCard from "../../components/SectionCard.vue";
import WalletChrome from "../../components/WalletChrome.vue";
import { fetchPortfolioSnapshot } from "../../services/evm";
import { useNetworksStore } from "../../stores/networks";
import { usePortfolioStore } from "../../stores/portfolio";
import { useSessionStore } from "../../stores/session";
import { useWalletStore } from "../../stores/wallet";

const route = useRoute();
const networksStore = useNetworksStore();
const portfolioStore = usePortfolioStore();
const sessionStore = useSessionStore();
const walletStore = useWalletStore();

const tokenId = computed(() => String(route.params.tokenId));
const { activeNetwork } = storeToRefs(networksStore);
const { primaryAddress } = storeToRefs(sessionStore);
const snapshot = computed(() => portfolioStore.getSnapshot(activeNetwork.value.id));

const token = computed(() =>
  tokenId.value === "native" ? null : walletStore.findTokenById(tokenId.value),
);

async function refreshTokenContext() {
  if (!primaryAddress.value) {
    return;
  }

  portfolioStore.markLoading(activeNetwork.value.id);

  try {
    const nextSnapshot = await fetchPortfolioSnapshot({
      network: activeNetwork.value,
      address: primaryAddress.value,
      tokens: walletStore.tokensForNetwork(activeNetwork.value.id),
    });

    portfolioStore.setSnapshot(nextSnapshot);
  } catch (error) {
    portfolioStore.setError(
      activeNetwork.value.id,
      error instanceof Error ? error.message : "Failed to load token detail",
    );
  }
}

onMounted(refreshTokenContext);
watch([activeNetwork, primaryAddress], refreshTokenContext);
</script>

<template>
  <WalletChrome
    eyebrow="Token Detail"
    title="代币详情页已经有路由位置。"
    subtitle="这一页后续会放余额、合约地址、最近交易和发送入口。当前先把页面位置和导航关系确定下来。"
  >
    <section class="page-grid page-grid--2">
      <SectionCard title="Current Token" description="当前路由参数">
        <p class="metric-value">{{ tokenId === "native" ? activeNetwork.symbol : token?.symbol ?? tokenId }}</p>
        <p>{{ tokenId === "native" ? activeNetwork.name : token?.name ?? "Unknown token" }}</p>
        <p>
          Balance:
          {{
            tokenId === "native"
              ? snapshot.nativeBalance
              : snapshot.tokenBalances[token?.id ?? ""] ?? token?.balance ?? "0.00"
          }}
        </p>
        <p v-if="token">Contract: {{ token.contractAddress }}</p>
      </SectionCard>
      <SectionCard title="Planned Content" description="后续补充">
        <ul class="bullet-list">
          <li>代币余额</li>
          <li>合约地址</li>
          <li>最近交易</li>
          <li>发送入口</li>
        </ul>
        <p v-if="snapshot.latestBlock">Latest block: {{ snapshot.latestBlock }}</p>
        <p v-if="snapshot.error" class="helper-text helper-text--error">{{ snapshot.error }}</p>
      </SectionCard>
    </section>
  </WalletChrome>
</template>
