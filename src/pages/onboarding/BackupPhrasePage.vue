<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink, useRouter } from "vue-router";
import SectionCard from "../../components/SectionCard.vue";
import {
  cancelPendingWallet,
  finalizePendingWallet,
  getPendingBackupPhrase,
  isTauriWalletRuntime,
} from "../../services/walletBridge";
import { useOnboardingStore } from "../../stores/onboarding";
import { useSessionStore } from "../../stores/session";
import {
  isPreviewSecretFlowAllowed,
  PREVIEW_SECRET_FLOW_BLOCKED_MESSAGE,
} from "../../utils/runtimeSafety";

const router = useRouter();
const onboardingStore = useOnboardingStore();
const sessionStore = useSessionStore();
const confirmed = ref(false);
const formError = ref("");
const backupPassword = ref("");
const words = ref<string[]>([]);
const backTarget = computed(() => {
  if (!sessionStore.hasWallet) {
    return "/welcome";
  }

  return sessionStore.isUnlocked ? "/settings/accounts" : "/unlock";
});
const missingBackupTarget = computed(() => {
  if (!sessionStore.hasWallet) {
    return "/welcome";
  }

  return sessionStore.isUnlocked ? "/wallet" : "/unlock";
});
const previewSecretFlowBlocked = computed(
  () => !isTauriWalletRuntime() && !isPreviewSecretFlowAllowed(),
);

async function ensureBackupAccess() {
  if (!onboardingStore.hasPendingBackup) {
    words.value = [];
    await router.replace(missingBackupTarget.value);
    return false;
  }

  return true;
}

watch(
  () => [onboardingStore.hasPendingBackup, sessionStore.hasWallet, sessionStore.isUnlocked] as const,
  async () => {
    await ensureBackupAccess();
  },
);

onMounted(async () => {
  if (!(await ensureBackupAccess())) {
    return;
  }

  if (!onboardingStore.backupAccessToken) {
    formError.value = "当前备份会话无法恢复，请取消本次流程后重新创建钱包。";
  }
});

async function revealBackupPhrase() {
  formError.value = "";

  if (previewSecretFlowBlocked.value) {
    formError.value = PREVIEW_SECRET_FLOW_BLOCKED_MESSAGE;
    return;
  }

  if (!onboardingStore.backupAccessToken) {
    formError.value = "当前备份会话已失效，请取消本次流程后重新创建钱包。";
    return;
  }

  if (!backupPassword.value.trim()) {
    formError.value = "请输入创建该钱包时设置的钱包密码，再显示助记词。";
    return;
  }

  try {
    const phrase = await getPendingBackupPhrase({
      backupAccessToken: onboardingStore.backupAccessToken,
      password: backupPassword.value,
    });
    words.value = phrase.trim().split(/\s+/);
    formError.value = "";
  } catch (error) {
    words.value = [];
    formError.value =
      error instanceof Error
        ? error.message
        : "当前无法恢复备份会话，请取消本次流程后重新创建钱包。";
  }
}

async function finalizeBackup() {
  if (words.value.length === 0) {
    formError.value = "请先输入钱包密码并显示助记词，再完成备份确认。";
    return;
  }

  if (!confirmed.value) {
    formError.value = "你必须确认已经离线备份助记词";
    return;
  }

  try {
    if (!onboardingStore.backupAccessToken) {
      throw new Error("当前备份会话已过期，请重新创建钱包");
    }

    const profile = await finalizePendingWallet({
      backupAccessToken: onboardingStore.backupAccessToken,
      confirmedBackup: confirmed.value,
    });
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
        <label class="field">
          <span>钱包密码</span>
          <input
            v-model="backupPassword"
            autocomplete="current-password"
            :disabled="previewSecretFlowBlocked"
            type="password"
            placeholder="输入创建这个钱包时设置的密码"
          />
        </label>

        <div class="form-actions">
          <button
            class="button button--secondary"
            type="button"
            :disabled="previewSecretFlowBlocked"
            @click="revealBackupPhrase"
          >
            显示助记词
          </button>
        </div>

        <label class="toggle-row">
          <input v-model="confirmed" :disabled="previewSecretFlowBlocked" type="checkbox" />
          <span>我已经离线备份这组助记词</span>
        </label>

        <p v-if="formError" class="helper-text helper-text--error">{{ formError }}</p>
        <p v-else-if="previewSecretFlowBlocked" class="helper-text helper-text--error">
          {{ PREVIEW_SECRET_FLOW_BLOCKED_MESSAGE }}
        </p>

        <div class="form-actions">
          <button
            class="button button--primary"
            type="button"
            :disabled="previewSecretFlowBlocked"
            @click="finalizeBackup"
          >
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
