<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { RouterLink, useRouter } from "vue-router";
import PatternLock from "../../components/PatternLock.vue";
import { clearPatternLock, hasPatternLock } from "../../services/patternLock";
import { clearBiometricUnlockCredential } from "../../services/biometrics";
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
const showResetModal = ref(false);
const resetModalError = ref("");
const isResetting = ref(false);

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
    if (accountHasPattern.value) {
      unlockMode.value = "pattern";
    } else {
      unlockMode.value = "password";
    }
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
    } else {
      accountHasPattern.value = hasPatternLock(accountId);
      if (accountHasPattern.value) {
        unlockMode.value = "pattern";
      } else {
        unlockMode.value = "password";
      }
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

async function handleResetWallet() {
  isResetting.value = true;
  resetModalError.value = "";

  try {
    walletProfiles.value.forEach((p) => {
      clearPatternLock(p.accountId);
      clearBiometricUnlockCredential(p.accountId);
    });
    await sessionStore.resetWallet();
    showResetModal.value = false;
    await router.replace("/welcome");
  } catch (error) {
    resetModalError.value = error instanceof Error ? error.message : "重置钱包失败，请稍后重试。";
  } finally {
    isResetting.value = false;
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

      <!-- Unlock Mode Switcher Tabs (only shown when pattern lock is configured) -->
      <div
        v-if="accountHasPattern"
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
          :class="['button', unlockMode === 'pattern' ? 'button--secondary' : 'button--ghost']"
          type="button"
          style="flex: 1; padding: 6px 12px; font-size: 0.8rem;"
          @click="unlockMode = 'pattern'; formError = '';"
        >
          手势解锁
        </button>
        <button
          :class="['button', unlockMode === 'password' ? 'button--secondary' : 'button--ghost']"
          type="button"
          style="flex: 1; padding: 6px 12px; font-size: 0.8rem;"
          @click="unlockMode = 'password'; formError = '';"
        >
          密码解锁
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
            :disabled="isSubmitting || !password"
            class="button button--primary"
            type="submit"
          >
            {{ isSubmitting ? "正在解锁..." : "解锁钱包" }}
          </button>
        </div>

        <p v-if="!accountHasPattern" class="helper-text" style="font-size: 0.72rem; text-align: center;">
          解锁后可在【设置 → 安全与锁屏】中开启手势连线快速解锁
        </p>
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
            切换到密码解锁
          </button>
        </template>
      </div>

      <!-- Manage Accounts link -->
      <div
        style="
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          width: 100%;
          padding-top: 10px;
          border-top: 1px solid rgba(255, 255, 255, 0.06);
          font-size: 0.82rem;
          flex-wrap: wrap;
        "
      >
        <RouterLink class="button button--ghost button--small" to="/settings/accounts/import">
          导入其他账号
        </RouterLink>
        <RouterLink class="button button--ghost button--small" to="/settings/accounts/create">
          创建新账号
        </RouterLink>
        <button
          class="button button--ghost button--small"
          style="color: var(--text-muted);"
          type="button"
          @click="showResetModal = true; resetModalError = '';"
        >
          重置钱包
        </button>
      </div>

      <!-- Reset Wallet Confirmation Modal -->
      <div
        v-if="showResetModal"
        style="
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.72);
          backdrop-filter: blur(4px);
          display: grid;
          place-items: center;
          padding: 20px;
          z-index: 100;
        "
        @click.self="!isResetting && (showResetModal = false)"
      >
        <div
          class="section-card"
          style="
            max-width: 360px;
            width: 100%;
            padding: 24px 20px;
            background: var(--bg-surface, #12131b);
            border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.1));
            border-radius: var(--radius-md, 12px);
            text-align: left;
            display: flex;
            flex-direction: column;
            gap: 14px;
          "
        >
          <h3 style="margin: 0; font-size: 1.1rem; font-weight: 700; color: var(--text-primary);">
            重置本地钱包
          </h3>
          <p style="margin: 0; font-size: 0.84rem; color: var(--text-secondary); line-height: 1.5;">
            重置将清除本地保存的所有钱包数据、派生地址及解锁配置。如果有助记词或私钥备份，重置后可以重新导入恢复。此操作不可逆，请确认。
          </p>
          <p v-if="resetModalError" class="helper-text helper-text--error" style="margin: 0;">
            {{ resetModalError }}
          </p>
          <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px;">
            <button
              class="button button--ghost button--small"
              type="button"
              :disabled="isResetting"
              @click="showResetModal = false"
            >
              取消
            </button>
            <button
              class="button button--primary button--small"
              style="background: #ef4444; border-color: #ef4444;"
              type="button"
              :disabled="isResetting"
              @click="handleResetWallet"
            >
              {{ isResetting ? "正在重置..." : "确认重置" }}
            </button>
          </div>
        </div>
      </div>
    </section>
  </main>
</template>
