<script setup lang="ts">
import { ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import SectionCard from "../../components/SectionCard.vue";
import { createWallet } from "../../services/walletBridge";
import { useOnboardingStore } from "../../stores/onboarding";

const router = useRouter();
const onboardingStore = useOnboardingStore();

const walletLabel = ref("Primary Wallet");
const password = ref("");
const confirmPassword = ref("");
const enableBiometric = ref(true);
const formError = ref("");
const isSubmitting = ref(false);

async function submitCreateWallet() {
  formError.value = "";

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
    const draft = await createWallet({
      walletLabel: walletLabel.value.trim(),
      password: password.value,
      isBiometricEnabled: enableBiometric.value,
    });

    onboardingStore.stageDraft(draft);

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
        <p class="eyebrow">Create Wallet</p>
        <h1>先把创建流程收稳，再往资产和发送走。</h1>
        <p class="subtitle">
          这一页只负责创建本地钱包基础资料和解锁密码。助记词会在下一步展示，
          你必须完成备份确认后才会进入首页。
        </p>
      </div>
      <SectionCard title="安全提醒" description="这一轮先搭骨架，不做转账">
        <ul class="bullet-list">
          <li>钱包密码用于后续解锁</li>
          <li>助记词只会在备份页展示一次</li>
          <li>私钥类数据不会进入 Pinia</li>
        </ul>
      </SectionCard>
    </section>

    <section class="page-grid page-grid--2">
      <SectionCard title="Create" description="填写基础信息">
        <form class="form-grid" @submit.prevent="submitCreateWallet">
          <label class="field">
            <span>钱包名称</span>
            <input v-model="walletLabel" autocomplete="off" placeholder="Primary Wallet" />
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
            <span>默认开启生物识别解锁入口</span>
          </label>

          <p v-if="formError" class="helper-text helper-text--error">{{ formError }}</p>

          <div class="form-actions">
            <button :disabled="isSubmitting" class="button button--primary" type="submit">
              {{ isSubmitting ? "正在生成助记词..." : "继续并生成助记词" }}
            </button>
            <RouterLink class="button button--ghost" to="/welcome">返回</RouterLink>
          </div>
        </form>
      </SectionCard>

      <SectionCard title="What Happens Next" description="创建后的流程">
        <ol class="ordered-list">
          <li>生成 12 个英文助记词</li>
          <li>展示备份页并要求人工确认</li>
          <li>完成后进入资产首页壳</li>
        </ol>
      </SectionCard>
    </section>
  </main>
</template>
