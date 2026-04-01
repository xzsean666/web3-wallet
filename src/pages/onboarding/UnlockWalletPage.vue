<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import SectionCard from "../../components/SectionCard.vue";
import { useSessionStore } from "../../stores/session";
import { shortenAddress } from "../../utils/format";

const router = useRouter();
const sessionStore = useSessionStore();
const password = ref("");
const formError = ref("");
const isSubmitting = ref(false);

async function unlockWallet() {
  formError.value = "";
  isSubmitting.value = true;

  try {
    const didUnlock = await sessionStore.unlockWallet(password.value);

    if (!didUnlock) {
      formError.value = "密码不正确，请重新输入";
      return;
    }

    await router.replace(sessionStore.lastVisitedRoute || "/wallet");
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <main class="page-shell">
    <section class="marketing-hero marketing-hero--compact">
      <div class="hero-copy">
        <p class="eyebrow">Unlock</p>
        <h1>把解锁流程先做清楚，后面功能才有落点。</h1>
        <p class="subtitle">
          当前是 Milestone 1 的解锁壳。等真实安全存储和移动端生物识别闭环接上后，这里就是每次进入钱包的第一道门。
        </p>
      </div>
      <SectionCard title="Wallet" description="当前待解锁钱包">
        <ul class="bullet-list">
          <li>{{ sessionStore.walletLabel }}</li>
          <li>{{ shortenAddress(sessionStore.primaryAddress) }}</li>
          <li>{{ sessionStore.statusLabel }}</li>
        </ul>
      </SectionCard>
    </section>

    <section class="page-grid page-grid--2">
      <SectionCard title="Password" description="输入你创建或导入时设置的钱包密码">
        <form class="form-grid" @submit.prevent="unlockWallet">
          <label class="field">
            <span>钱包密码</span>
            <input
              v-model="password"
              autocomplete="current-password"
              type="password"
              placeholder="输入钱包密码"
            />
          </label>

          <p v-if="formError" class="helper-text helper-text--error">{{ formError }}</p>

          <div class="form-actions">
            <button :disabled="isSubmitting" class="button button--primary" type="submit">
              {{ isSubmitting ? "正在解锁..." : "解锁钱包" }}
            </button>
          </div>
        </form>
      </SectionCard>

      <SectionCard title="Biometric" description="当前阶段只是状态开关，平台集成后续补上">
        <p>
          生物识别开关当前状态：
          <strong>{{ sessionStore.isBiometricEnabled ? "Enabled" : "Disabled" }}</strong>
        </p>
      </SectionCard>
    </section>
  </main>
</template>

