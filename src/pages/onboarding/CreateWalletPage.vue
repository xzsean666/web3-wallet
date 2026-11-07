<script setup lang="ts">
import { computed, ref } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { createWallet, isTauriWalletRuntime } from "../../services/walletBridge";
import { useOnboardingStore } from "../../stores/onboarding";
import { useSessionStore } from "../../stores/session";
import {
  isPreviewSecretFlowAllowed,
  PREVIEW_SECRET_FLOW_BLOCKED_MESSAGE,
} from "../../utils/runtimeSafety";

const route = useRoute();
const router = useRouter();
const onboardingStore = useOnboardingStore();
const sessionStore = useSessionStore();

const isAddAccountMode = computed(() => route.name === "account-create");
const walletLabel = ref(
  isAddAccountMode.value ? `Account ${sessionStore.accountCount + 1}` : "Primary Wallet",
);
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

async function submitCreateWallet() {
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
    const pendingSession = await createWallet({
      walletLabel: walletLabel.value.trim(),
      password: password.value,
      isBiometricEnabled: enableBiometric.value,
    });

    onboardingStore.stageDraft(pendingSession);

    await router.push("/onboarding/backup");
  } catch (error) {
    formError.value =
      error instanceof Error ? error.message : "创建钱包失败，请稍后重试";
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
          <h2>{{ isAddAccountMode ? "创建新账号" : "创建新钱包" }}</h2>
          <p>{{ isAddAccountMode ? "设置新账号名称及本地解锁密码" : "第 1 步：设置钱包名称与本地解锁密码" }}</p>
        </div>
        <RouterLink class="button button--ghost button--small" :to="backTarget">返回</RouterLink>
      </header>

      <form class="form-grid" @submit.prevent="submitCreateWallet">
        <label class="field">
          <span>{{ isAddAccountMode ? "账号名称" : "钱包名称" }}</span>
          <input
            v-model="walletLabel"
            autocomplete="off"
            :disabled="previewSecretFlowBlocked"
            :placeholder="isAddAccountMode ? `Account ${sessionStore.accountCount + 1}` : 'Primary Wallet'"
          />
        </label>

        <label class="field">
          <span>设置密码</span>
          <input
            v-model="password"
            autocomplete="new-password"
            :disabled="previewSecretFlowBlocked"
            type="password"
            placeholder="不少于 8 位字符"
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
            :disabled="isSubmitting || previewSecretFlowBlocked || !password || !confirmPassword"
            class="button button--primary"
            type="submit"
          >
            {{ isSubmitting ? "正在生成助记词..." : isAddAccountMode ? "下一步：备份助记词" : "下一步：生成并备份助记词" }}
          </button>
        </div>
      </form>

      <div style="padding: 12px; border-radius: var(--radius-sm); background: rgba(99, 102, 241, 0.08); border: 1px solid rgba(99, 102, 241, 0.2); font-size: 0.78rem; color: #c7d2fe;">
        <strong>安全提示：</strong> 下一步将展示 12 个英文助记词，助记词是恢复钱包资产的唯一凭证，切勿截屏或在线分享。
      </div>
    </section>
  </main>
</template>
