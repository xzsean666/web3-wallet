<script setup lang="ts">
import { storeToRefs } from "pinia";
import { RouterLink } from "vue-router";
import { useNetworksStore } from "../stores/networks";
import { useSessionStore } from "../stores/session";
import { shortenAddress } from "../utils/format";

withDefaults(
  defineProps<{
    eyebrow?: string;
    title?: string;
    subtitle?: string;
    showHero?: boolean;
    compactNav?: boolean;
    showNav?: boolean;
  }>(),
  {
    eyebrow: "",
    title: "",
    subtitle: "",
    showHero: true,
    compactNav: false,
    showNav: true,
  },
);

const sessionStore = useSessionStore();
const networksStore = useNetworksStore();

const { primaryAddress, walletLabel } = storeToRefs(sessionStore);
const { activeNetwork } = storeToRefs(networksStore);
</script>

<template>
  <main class="page-shell">
    <header :class="['wallet-chrome', compactNav ? 'wallet-chrome--compact' : '']">
      <div class="wallet-chrome__main">
        <div class="wallet-chrome__brand">
          <RouterLink class="brand-link" to="/wallet">钱包</RouterLink>
          <p class="wallet-chrome__account">
            {{ walletLabel || shortenAddress(primaryAddress) }}
          </p>
        </div>
        <div class="wallet-meta">
          <RouterLink
            :class="['meta-pill', activeNetwork.environment === 'testnet' ? 'meta-pill--testnet' : '']"
            to="/settings/networks"
            :aria-label="`网络：${activeNetwork.name}`"
          >
            {{ activeNetwork.name }}
          </RouterLink>
          <span v-if="activeNetwork.environment === 'testnet'" class="meta-pill meta-pill--testnet">
            测试网
          </span>
        </div>
      </div>

      <nav v-if="showNav" :class="['wallet-nav', compactNav ? 'wallet-nav--compact' : '']">
        <RouterLink to="/wallet">首页</RouterLink>
        <RouterLink to="/wallet/send">发送</RouterLink>
        <RouterLink to="/settings">设置</RouterLink>
      </nav>
    </header>

    <section v-if="showHero && (eyebrow || title || subtitle)" class="wallet-hero">
      <div class="wallet-hero__copy">
        <p v-if="eyebrow" class="eyebrow">{{ eyebrow }}</p>
        <h1>{{ title }}</h1>
        <p v-if="subtitle" class="subtitle">{{ subtitle }}</p>
      </div>
      <div class="wallet-hero__actions">
        <slot name="actions" />
      </div>
    </section>

    <slot />
  </main>
</template>
