<script setup lang="ts">
import { computed } from "vue";
import { storeToRefs } from "pinia";
import { RouterLink } from "vue-router";
import { useNetworksStore } from "../stores/networks";
import { useSessionStore } from "../stores/session";
import { shortenAddress } from "../utils/format";

const props = withDefaults(
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
    showNav: false,
  },
);

const sessionStore = useSessionStore();
const networksStore = useNetworksStore();

const { primaryAddress, walletLabel } = storeToRefs(sessionStore);
const { activeNetwork } = storeToRefs(networksStore);

const accountMonogram = computed(() => {
  const label = walletLabel.value?.trim() || "W";
  return label.slice(0, 1).toUpperCase();
});
</script>

<template>
  <main class="page-shell">
    <header :class="['wallet-chrome', compactNav ? 'wallet-chrome--compact' : '']">
      <div class="wallet-chrome__main">
        <RouterLink class="wallet-chrome__brand" to="/settings/accounts" title="切换或查看账号">
          <span class="wallet-mini-profile__badge" style="width: 28px; height: 28px; font-size: 0.76rem;">
            {{ accountMonogram }}
          </span>
          <div style="display: flex; flex-direction: column; min-width: 0;">
            <strong class="brand-link" style="font-size: 0.88rem; line-height: 1.2;">
              {{ walletLabel || "当前钱包" }}
            </strong>
            <p class="wallet-chrome__account" style="font-size: 0.72rem; line-height: 1.2;">
              {{ shortenAddress(primaryAddress) }}
            </p>
          </div>
        </RouterLink>

        <div class="wallet-meta">
          <RouterLink
            :class="['meta-pill', activeNetwork.environment === 'testnet' ? 'meta-pill--testnet' : '']"
            to="/settings/networks"
            :aria-label="`网络：${activeNetwork.name}`"
          >
            {{ activeNetwork.name }}
            <span v-if="activeNetwork.environment === 'testnet'" style="margin-left: 4px; opacity: 0.85; font-size: 0.72rem;">测试网</span>
          </RouterLink>
        </div>
      </div>
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

    <!-- Bottom Dock Floating Navigation Bar -->
    <nav v-if="showNav" :class="['wallet-nav', compactNav ? 'wallet-nav--compact' : '']">
      <RouterLink to="/wallet">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;">
          <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
          <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
          <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
        </svg>
        资产
      </RouterLink>
      <RouterLink to="/wallet/activity">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
        活动
      </RouterLink>
      <RouterLink to="/settings">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;">
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        设置
      </RouterLink>
    </nav>
  </main>
</template>
