<script setup lang="ts">
import { computed, ref } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { saveBiometricUnlockCredential } from "../../services/biometrics";
import { importWallet, isTauriWalletRuntime } from "../../services/walletBridge";
import { useOnboardingStore } from "../../stores/onboarding";
import { useSessionStore } from "../../stores/session";
import type { SecretKind } from "../../types/wallet";
import {
  isPreviewSecretFlowAllowed,
  PREVIEW_SECRET_FLOW_BLOCKED_MESSAGE,
} from "../../utils/runtimeSafety";

const route = useRoute();
const router = useRouter();
const onboardingStore = useOnboardingStore();
const sessionStore = useSessionStore();

const isAddAccountMode = computed(() => route.name === "account-import");
const importMode = ref<SecretKind>("mnemonic");
const walletLabel = ref(
  isAddAccountMode.value ? `Imported Account ${sessionStore.accountCount + 1}` : "Imported Wallet",
);
const secretValue = ref("");
const password = ref("");
const confirmPassword = ref("");
const enableBiometric = ref(true);
const formError = ref("");
const isSubmitting = ref(false);
const backTarget = computed(() => {
  if (!isAddAccountMode.value) {
    return "/welcome";
  }

  return sessionStore.isUnlocked ? "/settings/accounts" : "/unlock";
});
const previewSecretFlowBlocked = computed(
  () => !isTauriWalletRuntime() && !isPreviewSecretFlowAllowed(),
);

async function submitImport() {
  formError.value = "";

  if (previewSecretFlowBlocked.value) {
    formError.value = PREVIEW_SECRET_FLOW_BLOCKED_MESSAGE;
    return;
  }

  if (onboardingStore.hasPendingDraft) {
    formError.value = "当前有一笔待完成的备份流程，请先完成或取消后再继续。";
    await router.push("/onboarding/backup");
    return;
  }

  if (!walletLabel.value.trim()) {
    formError.value = "钱包名称不能为空";
    return;
  }

  if (!secretValue.value.trim()) {
    formError.value = "导入内容不能为空";
    return;
  }

  if (password.value.length < 8) {
    formError.value = "钱包密码至少需要 8 位";
    return;
  }

  if (password.value !== confirmPassword.value) {
    formError.value = "两次输入的钱包密码不一致";
    return;
  }

  isSubmitting.value = true;

  try {
    const profile = await importWallet({
      walletLabel: walletLabel.value.trim(),
      password: password.value,
      isBiometricEnabled: enableBiometric.value,
      secretKind: importMode.value,
      secretValue: secretValue.value,
    });

    if (profile.isBiometricEnabled && password.value) {
      saveBiometricUnlockCredential(profile.accountId, password.value);
    }
    onboardingStore.clearDraft();
    sessionStore.applyWalletProfile(profile, { unlocked: true });
    secretValue.value = "";
    password.value = "";
    confirmPassword.value = "";
    await router.replace("/wallet");
  } catch (error) {
    formError.value =
      error instanceof Error ? error.message : "导入失败，请检查助记词或私钥格式";
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <main class="page-shell" style="justify-content: center;">
    <section class="section-card" style="padding: 24px;">
      <header class="section-card__header">
        <div>
          <h2>{{ isAddAccountMode ? "导入账号" : "导入钱包" }}</h2>
          <p>{{ isAddAccountMode ? "使用助记词或私钥导入新账号" : "输入助记词或私钥恢复已有资产" }}</p>
        </div>
        <RouterLink class="button button--ghost button--small" :to="backTarget">返回</RouterLink>
      </header>

      <div class="segmented-control">
        <button
          :class="['segment', { 'segment--active': importMode === 'mnemonic' }]"
          type="button"
          @click="importMode = 'mnemonic'"
        >
          助记词
        </button>
        <button
          :class="['segment', { 'segment--active': importMode === 'privateKey' }]"
          type="button"
          @click="importMode = 'privateKey'"
        >
          私钥
        </button>
      </div>

      <form class="form-grid" @submit.prevent="submitImport">
        <label class="field">
          <span>{{ isAddAccountMode ? "账号名称" : "钱包名称" }}</span>
          <input
            v-model="walletLabel"
            autocomplete="off"
            :disabled="previewSecretFlowBlocked"
            :placeholder="isAddAccountMode ? `Imported Account ${sessionStore.accountCount + 1}` : 'Imported Wallet'"
          />
        </label>

        <label class="field">
          <span>{{ importMode === "mnemonic" ? "助记词 (12 个单词，空格隔开)" : "私钥 (以 0x 开头的 64 位十六进制)" }}</span>
          <textarea
            v-model="secretValue"
            :disabled="previewSecretFlowBlocked"
            :placeholder="
              importMode === 'mnemonic'
                ? '例如: apple banana cherry ...'
                : '例如: 0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d'
            "
            rows="3"
            style="font-family: var(--font-mono); font-size: 0.85rem;"
          />
        </label>

        <label class="field">
          <span>设置解锁密码</span>
          <input
            v-model="password"
            autocomplete="new-password"
            :disabled="previewSecretFlowBlocked"
            type="password"
            placeholder="不少于 8 位"
          />
        </label>

        <label class="field">
          <span>确认密码</span>
          <input
            v-model="confirmPassword"
            autocomplete="new-password"
            :disabled="previewSecretFlowBlocked"
            type="password"
            placeholder="再次输入解锁密码"
          />
        </label>

        <label class="toggle-row">
          <input v-model="enableBiometric" :disabled="previewSecretFlowBlocked" type="checkbox" />
          <span>启用生物识别快捷解锁</span>
        </label>

        <p v-if="formError" class="helper-text helper-text--error">{{ formError }}</p>
        <p v-else-if="previewSecretFlowBlocked" class="helper-text helper-text--error">
          {{ PREVIEW_SECRET_FLOW_BLOCKED_MESSAGE }}
        </p>

        <div class="form-actions" style="margin-top: 8px;">
          <button
            :disabled="isSubmitting || previewSecretFlowBlocked || !secretValue.trim() || !password"
            class="button button--primary"
            type="submit"
          >
            {{ isSubmitting ? "正在导入..." : isAddAccountMode ? "确认导入并切换账号" : "确认导入钱包" }}
          </button>
        </div>
      </form>
    </section>
  </main>
</template>
