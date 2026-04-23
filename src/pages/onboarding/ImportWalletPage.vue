<script setup lang="ts">
import { computed, ref } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import SectionCard from "../../components/SectionCard.vue";
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
const backTarget = computed(() => (isAddAccountMode.value ? "/settings/accounts" : "/welcome"));
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

    onboardingStore.clearDraft();
    sessionStore.applyWalletProfile(profile, {
      unlocked: sessionStore.hasWallet ? sessionStore.isUnlocked : true,
    });
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
  <main class="page-shell">
    <section class="marketing-hero marketing-hero--compact">
      <div class="hero-copy">
        <p class="eyebrow">{{ isAddAccountMode ? "Import Account" : "Import Wallet" }}</p>
        <h1>{{ isAddAccountMode ? "新增账号时只接受助记词或私钥导入。" : "导入只接受助记词或私钥，其他都不支持。" }}</h1>
        <p class="subtitle">
          {{
            isAddAccountMode
              ? "新增账号不会走云同步、硬件钱包或社交恢复。先把助记词和私钥导入链路做稳。"
              : "MVP 不做扩展同步、硬件钱包或社交恢复。把输入范围压小，先把导入链路和地址推导做对。"
          }}
        </p>
      </div>
      <SectionCard title="Import Scope" :description="isAddAccountMode ? '当前可新增的账号来源' : '当前可导入形式'">
        <ul class="bullet-list">
          <li>助记词</li>
          <li>单个私钥</li>
          <li>不支持 Keystore JSON</li>
        </ul>
      </SectionCard>
    </section>

    <section class="page-grid page-grid--2">
      <SectionCard :title="isAddAccountMode ? 'Import Account' : 'Import'" description="选择导入方式并设置解锁密码">
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
            <span>{{ importMode === "mnemonic" ? "助记词" : "私钥" }}</span>
            <textarea
              v-model="secretValue"
              :disabled="previewSecretFlowBlocked"
              :placeholder="
                importMode === 'mnemonic'
                  ? '输入 12 个英文助记词'
                  : '输入 64 位十六进制私钥'
              "
              rows="5"
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
            <span>导入后默认显示生物识别入口</span>
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
              {{ isSubmitting ? "正在导入..." : isAddAccountMode ? "导入并切换账号" : "导入钱包" }}
            </button>
            <RouterLink class="button button--ghost" :to="backTarget">返回</RouterLink>
          </div>
        </form>
      </SectionCard>

      <SectionCard title="Validation" :description="isAddAccountMode ? '当前新增账号的导入校验' : '当前导入校验'">
        <ul class="bullet-list">
          <li>助记词必须能推导出 EVM 账户地址</li>
          <li>私钥必须是合法十六进制格式</li>
          <li>密码长度至少 8 位</li>
          <li>{{ isAddAccountMode ? "导入后会切换到新账号" : "导入后直接进入钱包首页" }}</li>
        </ul>
      </SectionCard>
    </section>
  </main>
</template>
