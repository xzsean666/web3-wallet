<script setup lang="ts">
import { storeToRefs } from "pinia";
import { RouterLink } from "vue-router";
import { useNetworksStore } from "../stores/networks";
import { useSessionStore } from "../stores/session";
import { shortenAddress } from "../utils/format";

defineProps<{
  eyebrow: string;
  title: string;
  subtitle: string;
}>();

const sessionStore = useSessionStore();
const networksStore = useNetworksStore();

const { primaryAddress, walletLabel } = storeToRefs(sessionStore);
const { activeNetwork } = storeToRefs(networksStore);
</script>

<template>
  <main class="page-shell">
    <header class="wallet-chrome">
      <RouterLink class="brand-link" to="/wallet">Web3 Wallet</RouterLink>
      <nav class="wallet-nav">
        <RouterLink to="/wallet">Assets</RouterLink>
        <RouterLink to="/settings/networks">Networks</RouterLink>
        <RouterLink to="/settings">Settings</RouterLink>
      </nav>
      <div class="wallet-meta">
        <span class="meta-pill">{{ activeNetwork.name }}</span>
        <span class="meta-pill meta-pill--subtle">
          {{ walletLabel || shortenAddress(primaryAddress) }}
        </span>
      </div>
    </header>

    <section class="wallet-hero">
      <div>
        <p class="eyebrow">{{ eyebrow }}</p>
        <h1>{{ title }}</h1>
        <p class="subtitle">{{ subtitle }}</p>
      </div>
      <div class="wallet-hero__actions">
        <slot name="actions" />
      </div>
    </section>

    <slot />
  </main>
</template>

