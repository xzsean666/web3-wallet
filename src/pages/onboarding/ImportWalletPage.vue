<script setup lang="ts">
import { ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import SectionCard from "../../components/SectionCard.vue";
import { importWallet } from "../../services/walletBridge";
import { useOnboardingStore } from "../../stores/onboarding";
import { useSessionStore } from "../../stores/session";
import type { SecretKind } from "../../types/wallet";

const router = useRouter();
const onboardingStore = useOnboardingStore();
const sessionStore = useSessionStore();

const importMode = ref<SecretKind>("mnemonic");
const walletLabel = ref("Imported Wallet");
const secretValue = ref("");
const password = ref("");
const confirmPassword = ref("");
const enableBiometric = ref(true);
const formError = ref("");
const isSubmitting = ref(false);

async function submitImport() {
  formError.value = "";

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
  <main class="page-shell">
    <section class="marketing-hero marketing-hero--compact">
      <div class="hero-copy">
        <p class="eyebrow">Import Wallet</p>
        <h1>导入只接受助记词或私钥，其他都不支持。</h1>
        <p class="subtitle">
          MVP 不做扩展同步、硬件钱包或社交恢复。把输入范围压小，先把导入链路和地址推导做对。
        </p>
      </div>
      <SectionCard title="Import Scope" description="当前可导入形式">
        <ul class="bullet-list">
          <li>助记词</li>
          <li>单个私钥</li>
          <li>不支持 Keystore JSON</li>
        </ul>
      </SectionCard>
    </section>

    <section class="page-grid page-grid--2">
      <SectionCard title="Import" description="选择导入方式并设置解锁密码">
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
            <span>钱包名称</span>
            <input v-model="walletLabel" autocomplete="off" placeholder="Imported Wallet" />
          </label>

          <label class="field">
            <span>{{ importMode === "mnemonic" ? "助记词" : "私钥" }}</span>
            <textarea
              v-model="secretValue"
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
              type="password"
              placeholder="至少 8 位"
            />
          </label>

          <label class="field">
            <span>确认密码</span>
            <input
              v-model="confirmPassword"
              autocomplete="new-password"
              type="password"
              placeholder="再次输入密码"
            />
          </label>

          <label class="toggle-row">
            <input v-model="enableBiometric" type="checkbox" />
            <span>导入后默认显示生物识别入口</span>
          </label>

          <p v-if="formError" class="helper-text helper-text--error">{{ formError }}</p>

          <div class="form-actions">
            <button :disabled="isSubmitting" class="button button--primary" type="submit">
              {{ isSubmitting ? "正在导入..." : "导入钱包" }}
            </button>
            <RouterLink class="button button--ghost" to="/welcome">返回</RouterLink>
          </div>
        </form>
      </SectionCard>

      <SectionCard title="Validation" description="当前导入校验">
        <ul class="bullet-list">
          <li>助记词必须能推导出 EVM 账户地址</li>
          <li>私钥必须是合法十六进制格式</li>
          <li>密码长度至少 8 位</li>
          <li>导入后直接进入钱包首页</li>
        </ul>
      </SectionCard>
    </section>
  </main>
</template>
