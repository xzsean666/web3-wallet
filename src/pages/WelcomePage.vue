<script setup lang="ts">
import { onMounted, ref } from "vue";
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
</script>

<template>
  <main class="marketing-shell">
    <section class="marketing-hero">
      <div class="hero-copy">
        <p class="eyebrow">Milestone 1</p>
        <h1>精简版 MetaMask 风格钱包，从 Onboarding 开始。</h1>
        <p class="subtitle">
          当前版本只围绕 EVM 钱包最小闭环推进：创建、导入、解锁、资产首页和自定义网络管理。
          功能边界已经收死在 Native Token 与 ERC20 Token。
        </p>
        <div class="button-row">
          <RouterLink class="button button--primary" to="/onboarding/create">
            创建钱包
          </RouterLink>
          <RouterLink class="button button--secondary" to="/onboarding/import">
            导入钱包
          </RouterLink>
        </div>
      </div>

      <SectionCard
        title="Scope"
        description="MVP 只支持 Native Token 和 ERC20 Token"
        tone="accent"
      >
        <ul class="bullet-list">
          <li>支持预置 EVM 网络</li>
          <li>支持自定义 EVM 网络</li>
          <li>不支持 NFT、Swap、WalletConnect、任意合约交互</li>
        </ul>
      </SectionCard>
    </section>

    <section class="page-grid page-grid--3">
      <SectionCard title="Runtime" description="当前项目运行时">
        <p>{{ overview?.runtime ?? "Loading runtime details..." }}</p>
      </SectionCard>
      <SectionCard title="Security" description="当前安全边界">
        <p>{{ overview?.securityPolicy ?? "Loading security policy..." }}</p>
      </SectionCard>
      <SectionCard title="Storage" description="当前存储策略">
        <p>{{ overview?.storageStrategy ?? "Loading storage strategy..." }}</p>
      </SectionCard>
    </section>

    <section class="page-grid page-grid--2">
      <SectionCard title="This Build Includes" description="这一轮已经进入代码实现层">
        <ul class="bullet-list">
          <li>Stronghold 插件初始化</li>
          <li>Onboarding 页面和状态机</li>
          <li>Unlock 与 Wallet Shell</li>
          <li>自定义 EVM 网络管理页</li>
        </ul>
      </SectionCard>

      <SectionCard title="Current Limits" description="后续里程碑再补">
        <ul class="bullet-list">
          <li>还没有真实余额读取</li>
          <li>还没有真实发送交易</li>
          <li>还没有移动端生物识别闭环</li>
          <li>还没有链上历史记录拉取</li>
        </ul>
        <p v-if="loadError" class="helper-text helper-text--error">
          {{ loadError }}
        </p>
      </SectionCard>
    </section>
  </main>
</template>

