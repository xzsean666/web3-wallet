<script setup lang="ts">
import { computed, ref } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import SectionCard from "../../components/SectionCard.vue";
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
  <main class="page-shell">
    <section class="marketing-hero marketing-hero--compact">
      <div class="hero-copy">
        <p class="eyebrow">{{ isAddAccountMode ? "Create Account" : "Create Wallet" }}</p>
        <h1>{{ isAddAccountMode ? "新账号也走完整的本地创建和备份流程。" : "先把创建流程收稳，再往资产和发送走。" }}</h1>
        <p class="subtitle">
          {{
            isAddAccountMode
              ? "这里会创建一个新的本地账号档案，并在下一步展示助记词。完成备份确认后，新账号会成为当前激活账号。"
              : "这一页只负责创建本地钱包基础资料和解锁密码。助记词会在下一步展示，你必须完成备份确认后才会进入首页。"
          }}
        </p>
      </div>
      <SectionCard title="安全提醒" :description="isAddAccountMode ? '新增账号同样只处理本地恢复材料' : '创建阶段只处理本地钱包与恢复材料'">
        <ul class="bullet-list">
          <li>钱包密码用于后续解锁</li>
          <li>助记词只会在备份页展示一次</li>
          <li>私钥类数据不会进入 Pinia</li>
        </ul>
      </SectionCard>
    </section>

    <section class="page-grid page-grid--2">
      <SectionCard :title="isAddAccountMode ? 'Create Account' : 'Create'" description="填写基础信息">
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
            <span>钱包密码</span>
            <input
              v-model="password"
              autocomplete="new-password"
              :disabled="previewSecretFlowBlocked"
              type="password"
              placeholder="至少 8 位"
            />
          </label>

          <label class="field">
            <span>确认密码</span>
            <input
              v-model="confirmPassword"
              autocomplete="new-password"
              :disabled="previewSecretFlowBlocked"
              type="password"
              placeholder="再次输入密码"
            />
          </label>

          <label class="toggle-row">
            <input v-model="enableBiometric" :disabled="previewSecretFlowBlocked" type="checkbox" />
            <span>默认开启生物识别解锁入口</span>
          </label>

          <p v-if="formError" class="helper-text helper-text--error">{{ formError }}</p>
          <p v-else-if="previewSecretFlowBlocked" class="helper-text helper-text--error">
            {{ PREVIEW_SECRET_FLOW_BLOCKED_MESSAGE }}
          </p>

          <div class="form-actions">
            <button
              :disabled="isSubmitting || previewSecretFlowBlocked"
              class="button button--primary"
              type="submit"
            >
              {{ isSubmitting ? "正在生成助记词..." : isAddAccountMode ? "继续并创建新账号" : "继续并生成助记词" }}
            </button>
            <RouterLink class="button button--ghost" :to="backTarget">返回</RouterLink>
          </div>
        </form>
      </SectionCard>

      <SectionCard title="What Happens Next" :description="isAddAccountMode ? '新增账号后的流程' : '创建后的流程'">
        <ol class="ordered-list">
          <li>生成 12 个英文助记词</li>
          <li>展示备份页并要求人工确认</li>
          <li>{{ isAddAccountMode ? "完成后切换到新账号并继续使用钱包" : "完成后进入资产首页并继续使用钱包" }}</li>
        </ol>
      </SectionCard>
    </section>
  </main>
</template>
