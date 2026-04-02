<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import SectionCard from "../../components/SectionCard.vue";
import {
  cancelPendingWallet,
  finalizePendingWallet,
  getPendingBackupPhrase,
} from "../../services/walletBridge";
import { useOnboardingStore } from "../../stores/onboarding";
import { useSessionStore } from "../../stores/session";

const router = useRouter();
const onboardingStore = useOnboardingStore();
const sessionStore = useSessionStore();
const confirmed = ref(false);
const formError = ref("");
const words = ref<string[]>([]);
const backTarget = computed(() => (sessionStore.hasWallet ? "/settings/accounts" : "/welcome"));

onMounted(async () => {
  if (!onboardingStore.hasPendingBackup) {
    await router.replace("/welcome");
    return;
  }

  try {
    const phrase = await getPendingBackupPhrase();
    words.value = phrase.trim().split(/\s+/);
  } catch {
    await router.replace("/welcome");
  }
});

async function finalizeBackup() {
  if (!confirmed.value) {
    formError.value = "你必须确认已经离线备份助记词";
    return;
  }

  try {
    const profile = await finalizePendingWallet();
    onboardingStore.clearDraft();
    sessionStore.applyWalletProfile(profile, { unlocked: true });
    await router.replace("/wallet");
  } catch (error) {
    formError.value =
      error instanceof Error ? error.message : "备份确认失败，请稍后重试";
  }
}

async function cancelFlow() {
  await cancelPendingWallet();
  onboardingStore.clearDraft();
  await router.replace(backTarget.value);
}
</script>

<template>
  <main class="page-shell">
    <section class="marketing-hero marketing-hero--compact">
      <div class="hero-copy">
        <p class="eyebrow">Backup Phrase</p>
        <h1>这一步不要偷懒，助记词只展示一次。</h1>
        <p class="subtitle">
          当前页面只服务于创建钱包流程。确认离线备份后会直接进入资产首页，
          钱包资料会继续保持在本地安全边界内。
        </p>
      </div>
      <SectionCard title="Warning" description="任何人拿到这组词都能控制你的钱包" tone="warning">
        <ul class="bullet-list">
          <li>不要截图</li>
          <li>不要复制到聊天工具</li>
          <li>不要存到云笔记</li>
        </ul>
      </SectionCard>
    </section>

    <section class="page-grid page-grid--2">
      <SectionCard title="Recovery Phrase" description="建议离线抄写">
        <div class="word-grid">
          <span v-for="(word, index) in words" :key="`${index}-${word}`" class="word-chip">
            {{ index + 1 }}. {{ word }}
          </span>
        </div>
      </SectionCard>

      <SectionCard title="Confirm" description="完成确认后才允许进入钱包">
        <label class="toggle-row">
          <input v-model="confirmed" type="checkbox" />
          <span>我已经离线备份这组助记词</span>
        </label>

        <p v-if="formError" class="helper-text helper-text--error">{{ formError }}</p>

        <div class="form-actions">
          <button class="button button--primary" type="button" @click="finalizeBackup">
            完成备份并进入钱包
          </button>
          <button class="button button--ghost" type="button" @click="cancelFlow">
            取消创建流程
          </button>
          <RouterLink class="button button--ghost" :to="backTarget">
            {{ sessionStore.hasWallet ? "返回账号管理" : "返回上一步" }}
          </RouterLink>
        </div>
      </SectionCard>
    </section>
  </main>
</template>
