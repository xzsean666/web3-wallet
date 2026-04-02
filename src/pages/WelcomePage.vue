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
        <p class="eyebrow">Web3 Wallet</p>
        <h1>面向 Native Token 和 ERC20 的精简型桌面钱包。</h1>
        <p class="subtitle">
          当前版本已经具备创建、导入、解锁、资产查看、发送、收款和自定义网络管理能力。
          功能边界仍然严格锁在 Native Token 与 ERC20 Token。
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
      <SectionCard title="This Build Includes" description="当前已经打通的主流程">
        <ul class="bullet-list">
          <li>创建、导入、解锁和助记词备份流程</li>
          <li>Native Token 与 ERC20 余额读取</li>
          <li>本地签名 + 原始交易广播</li>
          <li>自定义 EVM 网络管理与 RPC 校验</li>
        </ul>
      </SectionCard>

      <SectionCard title="Current Limits" description="MVP 边界">
        <ul class="bullet-list">
          <li>不支持 NFT、Swap、WalletConnect</li>
          <li>不支持消息签名、Typed Data、任意合约交互</li>
          <li>浏览器预览模式不支持真实签名</li>
          <li>最近活动仍以本地最近提交记录为主</li>
        </ul>
        <p v-if="loadError" class="helper-text helper-text--error">
          {{ loadError }}
        </p>
      </SectionCard>
    </section>
  </main>
</template>
