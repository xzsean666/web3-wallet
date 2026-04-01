<script setup lang="ts">
import { storeToRefs } from "pinia";
import { onMounted, ref } from "vue";
import { getAppOverview } from "../services/system";
import { useAppStore } from "../stores/app";
import type { AppOverview } from "../types/app";

const appStore = useAppStore();
const { projectName, status, targetPlatforms } = storeToRefs(appStore);
const overview = ref<AppOverview | null>(null);
const loadError = ref("");

onMounted(async () => {
  try {
    overview.value = await getAppOverview();
  } catch (error) {
    loadError.value =
      error instanceof Error ? error.message : "Failed to load app overview";
  }
});
</script>

<template>
  <main class="shell">
    <section class="hero">
      <p class="eyebrow">Tauri 2 Wallet Scaffold</p>
      <h1>{{ projectName }}</h1>
      <p class="intro">
        当前骨架已经切到钱包方向：路由、状态管理、Rust 命令入口和文档规约都已建立，
        后续可以直接往账户、资产、签名和 dApp 连接模块上迭代。
      </p>
      <div class="hero-actions">
        <span class="status-pill">{{ status }}</span>
        <span class="status-subtle">Targets: {{ targetPlatforms.join(" / ") }}</span>
      </div>
    </section>

    <section class="grid">
      <article class="panel">
        <h2>Runtime</h2>
        <p>{{ overview?.runtime ?? "Loading runtime info..." }}</p>
      </article>
      <article class="panel">
        <h2>Security Boundary</h2>
        <p>{{ overview?.securityPolicy ?? "Loading security policy..." }}</p>
      </article>
      <article class="panel">
        <h2>Storage Strategy</h2>
        <p>{{ overview?.storageStrategy ?? "Loading storage strategy..." }}</p>
      </article>
      <article class="panel">
        <h2>Version</h2>
        <p>{{ overview?.appVersion ?? "Loading version..." }}</p>
      </article>
    </section>

    <section class="roadmap panel">
      <h2>Next Build Targets</h2>
      <ul>
        <li>接入 Stronghold、Biometric、Deep Linking</li>
        <li>实现账户创建、导入和解锁状态机</li>
        <li>增加 EVM 网络配置、资产页和签名确认页</li>
      </ul>
      <p v-if="loadError" class="error">{{ loadError }}</p>
    </section>
  </main>
</template>

