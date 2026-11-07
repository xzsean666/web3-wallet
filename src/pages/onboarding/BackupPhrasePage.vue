<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink, useRouter } from "vue-router";
import { saveBiometricUnlockCredential } from "../../services/biometrics";
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
const isCopied = ref(false);
let copyResetTimer: number | null = null;

async function copyBackupPhrase() {
  if (words.value.length === 0) {
    return;
  }

  const phrase = words.value.join(" ");
  let succeeded = false;

  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(phrase);
      succeeded = true;
    }
  } catch {
    succeeded = false;
  }

  if (!succeeded) {
    try {
      const textArea = document.createElement("textarea");
      textArea.value = phrase;
      textArea.style.position = "fixed";
      textArea.style.opacity = "0";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      succeeded = document.execCommand("copy");
      document.body.removeChild(textArea);
    } catch {
      succeeded = false;
    }
  }

  if (succeeded) {
    isCopied.value = true;
    if (copyResetTimer) {
      window.clearTimeout(copyResetTimer);
    }
    copyResetTimer = window.setTimeout(() => {
      isCopied.value = false;
    }, 2500);
  }
}
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
    if (profile.isBiometricEnabled && backupPassword.value) {
      saveBiometricUnlockCredential(profile.accountId, backupPassword.value);
    }
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
  <main class="page-shell" style="justify-content: center;">
    <section class="section-card" style="padding: 24px;">
      <header class="section-card__header">
        <div>
          <h2>备份助记词</h2>
          <p>第 2 步：离线抄写并妥善保管助记词</p>
        </div>
        <button class="button button--ghost button--small" type="button" @click="cancelFlow">取消</button>
      </header>

      <div style="padding: 12px; border-radius: var(--radius-sm); background: var(--accent-warning-soft); border: 1px solid rgba(245, 158, 11, 0.28); color: #fde68a; font-size: 0.8rem;">
        <strong>重要提示：</strong> 助记词用于控制和恢复钱包资产。切勿截图、切勿存入网络相册或聊天工具。
      </div>

      <!-- Password to reveal if words not yet revealed -->
      <div v-if="words.length === 0" class="form-grid">
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
        <button
          class="button button--primary"
          type="button"
          :disabled="previewSecretFlowBlocked || !backupPassword.trim()"
          @click="revealBackupPhrase"
        >
          验证密码并显示助记词
        </button>
      </div>

      <!-- Recovery Phrase Words Grid -->
      <div v-if="words.length > 0" class="word-grid">
        <span v-for="(word, index) in words" :key="`${index}-${word}`" class="word-chip">
          <span style="color: var(--text-muted); font-size: 0.74rem; margin-right: 4px;">{{ index + 1 }}.</span>
          <strong>{{ word }}</strong>
        </span>
      </div>

      <!-- One-click Copy Action -->
      <div v-if="words.length > 0" style="display: flex; flex-direction: column; gap: 8px; margin-top: 4px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 0.76rem; color: var(--text-muted);">共 12 个助记词</span>
          <button
            class="button button--ghost button--small copy-phrase-button"
            type="button"
            style="display: inline-flex; align-items: center; gap: 4px;"
            @click="copyBackupPhrase"
          >
            <svg
              v-if="!isCopied"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            <svg
              v-else
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#10b981"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span :style="isCopied ? 'color: #10b981; font-weight: 600;' : ''">
              {{ isCopied ? "已复制可导入助记词" : "一键复制助记词" }}
            </span>
          </button>
        </div>
        <div
          v-if="isCopied"
          style="
            padding: 8px 12px;
            border-radius: var(--radius-sm);
            background: rgba(16, 185, 129, 0.12);
            border: 1px solid rgba(16, 185, 129, 0.28);
            color: #6ee7b7;
            font-size: 0.76rem;
            display: flex;
            align-items: center;
            gap: 6px;
          "
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          已复制到剪贴板（空格分隔），可直接粘贴导入钱包
        </div>
      </div>

      <div v-if="words.length > 0" class="form-grid" style="margin-top: 8px;">
        <label class="toggle-row">
          <input v-model="confirmed" :disabled="previewSecretFlowBlocked" type="checkbox" />
          <span>我已按顺序在纸上正确抄写助记词</span>
        </label>

        <div class="form-actions">
          <button
            class="button button--primary"
            type="button"
            :disabled="previewSecretFlowBlocked || !confirmed"
            @click="finalizeBackup"
          >
            完成备份并进入钱包
          </button>
        </div>
      </div>

      <p v-if="formError" class="helper-text helper-text--error">{{ formError }}</p>
      <p v-else-if="previewSecretFlowBlocked" class="helper-text helper-text--error">
        {{ PREVIEW_SECRET_FLOW_BLOCKED_MESSAGE }}
      </p>

      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 8px; font-size: 0.78rem;">
        <button class="button button--ghost button--small" type="button" @click="cancelFlow">
          取消创建流程
        </button>
        <RouterLink class="button button--ghost button--small" :to="backTarget">
          {{ sessionStore.hasWallet ? "返回账号管理" : "返回上一步" }}
        </RouterLink>
      </div>
    </section>
  </main>
</template>
