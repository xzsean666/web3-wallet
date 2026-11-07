<script setup lang="ts">
import { RouterLink } from "vue-router";
</script>

<template>
  <main class="marketing-shell marketing-shell--landing">
    <section class="marketing-hero marketing-hero--landing">
      <div class="hero-copy hero-copy--landing">
        <div
          style="
            width: 68px;
            height: 68px;
            border-radius: 20px;
            background: linear-gradient(135deg, #6366f1 0%, #06b6d4 100%);
            display: grid;
            place-items: center;
            box-shadow: 0 10px 28px rgba(99, 102, 241, 0.45);
            margin-bottom: 12px;
          "
        >
          <svg
            width="36"
            height="36"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#ffffff"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
            <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
            <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
          </svg>
        </div>
        <p class="eyebrow">Web3 Wallet</p>
        <h1>极简 Web3 钱包</h1>
        <p class="subtitle">安全、极速、自主掌控多链资产与代币</p>
        <div class="button-row" style="margin-top: 12px;">
          <RouterLink class="button button--primary" to="/onboarding/create">
            创建钱包
          </RouterLink>
          <RouterLink class="button button--secondary welcome-import-button" to="/onboarding/import">
            导入钱包
          </RouterLink>
        </div>
      </div>
    </section>
  </main>
</template>
