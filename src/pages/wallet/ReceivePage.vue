<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { storeToRefs } from "pinia";
import { RouterLink } from "vue-router";
import ReceiveQrCard from "../../components/ReceiveQrCard.vue";
import WalletChrome from "../../components/WalletChrome.vue";
import { useNetworksStore } from "../../stores/networks";
import { useSessionStore } from "../../stores/session";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

const sessionStore = useSessionStore();
const networksStore = useNetworksStore();

const { primaryAddress } = storeToRefs(sessionStore);
const { activeNetwork } = storeToRefs(networksStore);

const copyState = ref<"idle" | "success" | "error">("idle");
let copyStateTimer: number | null = null;

const addressExplorerUrl = computed(() => {
  if (!primaryAddress.value || !activeNetwork.value.explorerUrl) {
    return null;
  }

  return `${activeNetwork.value.explorerUrl.replace(/\/$/, "")}/address/${primaryAddress.value}`;
});

function resetCopyState() {
  if (copyStateTimer) {
    window.clearTimeout(copyStateTimer);
    copyStateTimer = null;
  }

  copyState.value = "idle";
}

async function copyAddress() {
  if (!primaryAddress.value) {
    copyState.value = "error";
    return;
  }

  try {
    await navigator.clipboard.writeText(primaryAddress.value);
    copyState.value = "success";
  } catch {
    copyState.value = "error";
  }

  if (copyStateTimer) {
    window.clearTimeout(copyStateTimer);
  }

  copyStateTimer = window.setTimeout(() => {
    copyState.value = "idle";
    copyStateTimer = null;
  }, 2200);
}

async function openExternal(url: string | null) {
  if (!url) return;
  if (isTauri()) {
    await openUrl(url);
  } else {
    window.open(url, "_blank");
  }
}

onBeforeUnmount(resetCopyState);
</script>

<template>
  <WalletChrome
    :compact-nav="true"
    :show-hero="false"
    :show-nav="false"
  >
    <section class="section-card receive-sheet">
      <div class="receive-sheet__header">
        <h1>收款</h1>
        <RouterLink class="button button--ghost button--small" to="/wallet">返回</RouterLink>
      </div>

      <div class="receive-sheet__body">
        <ReceiveQrCard
          :address="primaryAddress"
          :chain-id="activeNetwork.chainId"
        />

        <div class="receive-sheet__content">
          <div class="receive-sheet__meta">
            <span class="meta-pill">{{ activeNetwork.name }}</span>
            <span v-if="copyState === 'success'" class="status-chip status-chip--accent">已复制</span>
            <span v-else-if="copyState === 'error'" class="status-chip status-chip--danger">复制失败</span>
          </div>

          <p class="address-block">{{ primaryAddress }}</p>

          <div class="form-actions">
            <button class="button button--primary" type="button" @click="copyAddress">复制地址</button>
            <button
              v-if="addressExplorerUrl"
              class="button button--ghost"
              type="button"
              @click="openExternal(addressExplorerUrl)"
            >
              区块浏览器
            </button>
          </div>

          <p class="receive-sheet__note">建议先小额测试。</p>

          <p v-if="copyState === 'success'" class="helper-text">地址已复制，可以直接发给对方。</p>
          <p v-else-if="copyState === 'error'" class="helper-text helper-text--error">
            当前环境无法完成复制，请手动复制地址。
          </p>
        </div>
      </div>
    </section>
  </WalletChrome>
</template>
