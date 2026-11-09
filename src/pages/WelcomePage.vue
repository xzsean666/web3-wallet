<script setup lang="ts">
import { RouterLink } from "vue-router";
</script>

<template>
  <main class="marketing-shell marketing-shell--landing">
    <section class="marketing-hero marketing-hero--landing">
      <div class="hero-copy hero-copy--landing">
        <img
          src="/icon.png"
          alt="Web3 Wallet Logo"
          style="
            width: 72px;
            height: 72px;
            border-radius: 20px;
            box-shadow: 0 10px 28px rgba(99, 102, 241, 0.45);
            margin-bottom: 12px;
            display: block;
          "
        />
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
