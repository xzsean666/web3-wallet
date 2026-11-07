<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { RouterLink, useRouter } from "vue-router";
import PatternLock from "../../components/PatternLock.vue";
import { hasPatternLock } from "../../services/patternLock";
import { useSessionStore } from "../../stores/session";
import { shortenAddress } from "../../utils/format";

const router = useRouter();
const sessionStore = useSessionStore();
const { activeAccountId, lastUnlockError, primaryAddress, walletLabel, walletProfiles } =
  storeToRefs(sessionStore);

const unlockMode = ref<"password" | "pattern">("password");
const password = ref("");
const formError = ref("");
const isSubmitting = ref(false);
const isSelectingAccountId = ref<string | null>(null);
const patternStatus = ref<"normal" | "success" | "error">("normal");
const patternRef = ref<InstanceType<typeof PatternLock> | null>(null);
const accountHasPattern = ref(false);

const activeProfile = computed(
  () =>
    walletProfiles.value.find((profile) => profile.accountId === activeAccountId.value) ??
    walletProfiles.value[0] ??
    null,
);

const accountMonogram = computed(() => {
  const source = activeProfile.value?.walletLabel?.trim() || walletLabel.value?.trim() || "W";
  return source.slice(0, 1).toUpperCase();
});

function checkAccountPattern() {
  if (activeAccountId.value) {
    accountHasPattern.value = hasPatternLock(activeAccountId.value);
  }
}

watch(activeAccountId, checkAccountPattern);
onMounted(checkAccountPattern);

async function selectAccount(accountId: string) {
  if (accountId === activeAccountId.value) {
    return;
  }

  formError.value = "";
  password.value = "";
  patternStatus.value = "normal";
  patternRef.value?.reset();
  isSelectingAccountId.value = accountId;

  try {
    const didSwitch = await sessionStore.selectWalletAccount(accountId, { lock: true });

    if (!didSwitch) {
      formError.value = "当前无法切换到这个账号，请稍后重试。";
    }
  } finally {
    isSelectingAccountId.value = null;
  }
}

async function unlockWallet() {
  formError.value = "";
  isSubmitting.value = true;

  try {
    const didUnlock = await sessionStore.unlockWallet(password.value);

    if (!didUnlock) {
      formError.value = lastUnlockError.value || "密码错误，请重新输入。";
      return;
    }

    await router.replace(sessionStore.lastVisitedRoute || "/wallet");
  } finally {
    isSubmitting.value = false;
  }
}

async function onPatternCompleted(pattern: number[]) {
  if (pattern.length < 4) {
    patternStatus.value = "error";
    formError.value = "手势连线至少需要连接 4 个点";
    setTimeout(() => {
      patternStatus.value = "normal";
      patternRef.value?.reset();
    }, 1200);
    return;
  }

  formError.value = "";
  isSubmitting.value = true;

  try {
    const didUnlock = await sessionStore.unlockWithPattern(pattern);

    if (didUnlock) {
      patternStatus.value = "success";
      await router.replace(sessionStore.lastVisitedRoute || "/wallet");
    } else {
      patternStatus.value = "error";
      formError.value = sessionStore.lastUnlockError || "手势密码错误，请重新绘制";
      setTimeout(() => {
        patternStatus.value = "normal";
        patternRef.value?.reset();
      }, 1200);
    }
  } finally {
    isSubmitting.value = false;
  }
}

async function triggerBiometricUnlock() {
  formError.value = "";
  isSubmitting.value = true;

  try {
    const didUnlock = await sessionStore.unlockWithBiometric();

    if (didUnlock) {
      await router.replace(sessionStore.lastVisitedRoute || "/wallet");
    } else {
      formError.value =
        sessionStore.lastUnlockError || "生物识别验证未通过，请使用密码解锁";
    }
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <main class="page-shell" style="justify-content: center; min-height: 100vh; min-height: 100dvh;">
    <section class="section-card" style="padding: 28px 22px; text-align: center; align-items: center; gap: 18px;">
      <!-- Profile Monogram Avatar -->
      <div style="display: flex; flex-direction: column; align-items: center; gap: 10px;">
        <div
          style="
            width: 60px;
            height: 60px;
            border-radius: var(--radius-full);
            background: linear-gradient(135deg, #6366f1 0%, #06b6d4 100%);
            display: grid;
            place-items: center;
            color: #fff;
            font-size: 1.5rem;
            font-weight: 800;
            box-shadow: 0 8px 24px rgba(99, 102, 241, 0.35);
          "
        >
          {{ accountMonogram }}
        </div>
        <div>
          <h1 style="font-size: 1.2rem; font-weight: 800; margin: 0; color: var(--text-primary);">
            {{ activeProfile?.walletLabel || "我的钱包" }}
          </h1>
          <p style="margin: 3px 0 0; font-family: var(--font-mono); font-size: 0.78rem; color: var(--text-secondary);">
            {{ shortenAddress(primaryAddress) }}
          </p>
        </div>
      </div>

      <!-- Multiple Accounts Switcher if > 1 -->
      <div v-if="walletProfiles.length > 1" style="width: 100%; display: flex; flex-direction: column; gap: 6px;">
        <span style="font-size: 0.74rem; color: var(--text-muted); text-align: left;">切换账号:</span>
        <div style="display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px;">
          <button
            v-for="account in walletProfiles"
            :key="account.accountId"
            :class="['status-chip', account.accountId === activeAccountId ? 'status-chip--accent' : '']"
            type="button"
            :disabled="isSelectingAccountId === account.accountId"
            style="cursor: pointer; white-space: nowrap;"
            @click="selectAccount(account.accountId)"
          >
            {{ account.walletLabel }}
          </button>
        </div>
      </div>

      <!-- Biometric Quick Unlock Banner if enabled -->
      <div v-if="activeProfile?.isBiometricEnabled" style="width: 100%;">
        <button
          class="button button--secondary"
          type="button"
          :disabled="isSubmitting"
          style="
            width: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            padding: 10px 16px;
            background: rgba(99, 102, 241, 0.12);
            border: 1px solid rgba(99, 102, 241, 0.3);
            color: #a5b4fc;
          "
          @click="triggerBiometricUnlock"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M12 2a10 10 0 0 0-10 10v2a10 10 0 0 0 20 0v-2a10 10 0 0 0-10-10Z" />
            <path d="M12 6a6 6 0 0 0-6 6v2a6 6 0 0 0 12 0v-2a6 6 0 0 0-6-6Z" />
            <path d="M12 10a2 2 0 0 0-2 2v2a2 2 0 0 0 4 0v-2a2 2 0 0 0-2-2Z" />
          </svg>
          <strong>生物识别快速解锁</strong>
        </button>
      </div>

      <!-- Unlock Mode Switcher Tabs -->
      <div
        style="
          display: flex;
          background: rgba(255, 255, 255, 0.05);
          padding: 3px;
          border-radius: var(--radius-sm);
          width: 100%;
          gap: 4px;
        "
      >
        <button
          :class="['button', unlockMode === 'password' ? 'button--secondary' : 'button--ghost']"
          type="button"
          style="flex: 1; padding: 6px 12px; font-size: 0.8rem;"
          @click="unlockMode = 'password'"
        >
          标准解锁
        </button>
        <button
          :class="['button', unlockMode === 'pattern' ? 'button--secondary' : 'button--ghost']"
          type="button"
          style="flex: 1; padding: 6px 12px; font-size: 0.8rem;"
          @click="unlockMode = 'pattern'"
        >
          手势连线
        </button>
      </div>

      <!-- Mode 1: Password Form -->
      <form
        v-if="unlockMode === 'password'"
        class="form-grid"
        style="width: 100%;"
        @submit.prevent="unlockWallet"
      >
        <label class="field" style="text-align: left;">
          <span>输入解锁密码</span>
          <input
            v-model="password"
            autocomplete="current-password"
            type="password"
            placeholder="输入钱包密码"
            autofocus
          />
        </label>

        <p v-if="formError" class="helper-text helper-text--error" style="text-align: left;">
          {{ formError }}
        </p>

        <div class="form-actions" style="margin-top: 4px;">
          <button
            :disabled="isSubmitting || !password.trim()"
            class="button button--primary"
            type="submit"
          >
            {{ isSubmitting ? "正在解锁..." : "解锁钱包" }}
          </button>
        </div>
      </form>

      <!-- Mode 2: Gesture Pattern Lock -->
      <div
        v-else-if="unlockMode === 'pattern'"
        style="width: 100%; display: flex; flex-direction: column; align-items: center; gap: 12px;"
      >
        <template v-if="accountHasPattern">
          <p style="margin: 0; font-size: 0.8rem; color: var(--text-secondary);">
            绘制手势连线解锁
          </p>

          <PatternLock
            ref="patternRef"
            :disabled="isSubmitting"
            :status="patternStatus"
            @completed="onPatternCompleted"
          />

          <p v-if="formError" class="helper-text helper-text--error" style="text-align: center;">
            {{ formError }}
          </p>
        </template>

        <template v-else>
          <div
            style="
              padding: 16px 12px;
              border-radius: var(--radius-sm);
              background: rgba(255, 255, 255, 0.04);
              border: 1px dashed rgba(255, 255, 255, 0.15);
              font-size: 0.8rem;
              color: var(--text-secondary);
              line-height: 1.5;
            "
          >
            当前账号尚未配置手势连线密码。
            <br />
            请先使用密码解锁，进入【设置 -> 安全与解锁】完成手势配置。
          </div>
          <button
            class="button button--secondary button--small"
            type="button"
            @click="unlockMode = 'password'"
          >
            切换到标准解锁
          </button>
        </template>
      </div>

      <!-- Manage Accounts link -->
      <div
        style="
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 14px;
          width: 100%;
          padding-top: 8px;
          border-top: 1px solid rgba(255, 255, 255, 0.06);
          font-size: 0.82rem;
        "
      >
        <RouterLink class="button button--ghost button--small" to="/settings/accounts/import">
          导入其他账号
        </RouterLink>
        <span style="color: var(--border-subtle);">|</span>
        <RouterLink class="button button--ghost button--small" to="/settings/accounts/create">
          创建新账号
        </RouterLink>
      </div>
    </section>
  </main>
</template>
