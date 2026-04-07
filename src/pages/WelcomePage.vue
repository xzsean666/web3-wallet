<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import SectionCard from "../components/SectionCard.vue";
import { getAppOverview } from "../services/system";
import type { AppOverview } from "../types/app";

const overview = ref<AppOverview | null>(null);
const loadError = ref("");

onMounted(async () => {
  try {
    overview.value = await getAppOverview();
  } catch (error) {
    loadError.value =
      error instanceof Error
        ? error.message
        : "Tauri runtime info is unavailable in plain web preview.";
  }
});

const runtimeLabel = computed(() => {
  if (!overview.value) {
    return "加载中...";
  }

  return overview.value.runtime.includes("Browser") ? "浏览器预览" : "Tauri 运行时";
});

const securityLabel = computed(() => {
  if (!overview.value) {
    return "加载中...";
  }

  return overview.value.runtime.includes("Browser") ? "真实签名仅限 Tauri" : "本地签名";
});

const storageLabel = computed(() => {
  if (!overview.value) {
    return "加载中...";
  }

  return overview.value.storageStrategy.includes("Stronghold") ? "Stronghold + SQLite" : "本地存储";
});
</script>

<template>
  <main class="marketing-shell marketing-shell--landing">
    <section class="marketing-hero marketing-hero--landing">
      <div class="hero-copy hero-copy--landing">
        <p class="eyebrow">Web3 Wallet</p>
        <h1>创建或导入钱包</h1>
        <p class="subtitle">只保留常用操作。支持 Native Token 和 ERC20。</p>
        <div class="button-row">
          <RouterLink class="button button--primary" to="/onboarding/create">
            创建钱包
          </RouterLink>
          <RouterLink class="button button--secondary welcome-import-button" to="/onboarding/import">
            已有钱包
          </RouterLink>
        </div>
      </div>
    </section>

    <SectionCard class="welcome-note" title="预览说明">
      <div class="key-value-list">
        <div class="key-value-row">
          <span>模式</span>
          <strong>{{ runtimeLabel }}</strong>
        </div>
        <div class="key-value-row">
          <span>签名</span>
          <strong>{{ securityLabel }}</strong>
        </div>
        <div class="key-value-row">
          <span>存储</span>
          <strong>{{ storageLabel }}</strong>
        </div>
      </div>
      <p v-if="loadError" class="helper-text helper-text--error">
        {{ loadError }}
      </p>
    </SectionCard>
  </main>
</template>
