<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { RouterLink, useRouter } from "vue-router";
import packageJson from "../../../package.json";
import PatternLock from "../../components/PatternLock.vue";
import SectionCard from "../../components/SectionCard.vue";
import WalletChrome from "../../components/WalletChrome.vue";
import { clearPatternLock, hasPatternLock, savePatternLock } from "../../services/patternLock";
import { getAppOverview } from "../../services/system";
import { unlockWallet as unlockWalletBridge } from "../../services/walletBridge";
import { useNetworksStore } from "../../stores/networks";
import { useSessionStore } from "../../stores/session";
import { shortenAddress } from "../../utils/format";

type PatternSetupStep = "verify-password" | "draw" | "confirm" | "ready";

const router = useRouter();
const sessionStore = useSessionStore();
const networksStore = useNetworksStore();

const securityMessage = ref("");
const hasPattern = ref(false);
const showPatternSetup = ref(false);
const isConfirmingRemovePattern = ref(false);
const patternStep = ref<PatternSetupStep>("verify-password");
const firstPattern = ref<number[]>([]);
const confirmedPattern = ref<number[]>([]);
const patternPassword = ref("");
const verifiedPatternPassword = ref("");
const isVerifyingPassword = ref(false);
const isSavingPattern = ref(false);
const patternFeedback = ref("");
const patternStatus = ref<"normal" | "success" | "error">("normal");
const patternLockRef = ref<InstanceType<typeof PatternLock> | null>(null);
const isAddressCopied = ref(false);
const appVersion = ref(`v${packageJson.version}`);

let copyResetTimer: number | null = null;
let patternResetTimer: number | null = null;

const {
  activeAccountId,
  hasBackedUpMnemonic,
  primaryAddress,
  walletLabel,
  walletSecretKind,
} = storeToRefs(sessionStore);
const { activeNetwork } = storeToRefs(networksStore);

const backupLabel = computed(() => {
  if (walletSecretKind.value === "privateKey") {
    return "私钥导入";
  }

  return hasBackedUpMnemonic.value ? "已备份" : "待备份";
});

const securityTone = computed(() =>
  walletSecretKind.value === "mnemonic" && !hasBackedUpMnemonic.value ? "warning" : "accent",
);

const patternStepHeading = computed(() => {
  switch (patternStep.value) {
    case "verify-password":
      return "第 1 步：验证当前钱包密码";
    case "draw":
      return "第 2 步：绘制新手势连线（至少 4 个点）";
    case "confirm":
      return "第 3 步：请再次绘制相同手势确认";
    case "ready":
      return "第 4 步：手势已确认，点击保存生效";
  }
});

function clearTimers() {
  if (copyResetTimer) {
    window.clearTimeout(copyResetTimer);
    copyResetTimer = null;
  }
  if (patternResetTimer) {
    window.clearTimeout(patternResetTimer);
    patternResetTimer = null;
  }
}

function clearPatternResetTimer() {
  if (patternResetTimer) {
    window.clearTimeout(patternResetTimer);
    patternResetTimer = null;
  }
}

function resetPatternSetupState() {
  clearPatternResetTimer();
  showPatternSetup.value = false;
  patternStep.value = "verify-password";
  firstPattern.value = [];
  confirmedPattern.value = [];
  patternPassword.value = "";
  verifiedPatternPassword.value = "";
  isVerifyingPassword.value = false;
  isSavingPattern.value = false;
  patternFeedback.value = "";
  patternStatus.value = "normal";
  patternLockRef.value?.reset();
}

function checkPatternState() {
  if (activeAccountId.value) {
    hasPattern.value = hasPatternLock(activeAccountId.value);
  } else {
    hasPattern.value = false;
  }
}

onMounted(async () => {
  checkPatternState();
  try {
    const overview = await getAppOverview();
    if (overview?.appVersion && overview.appVersion !== "preview") {
      appVersion.value = `v${overview.appVersion}`;
    }
  } catch {
    // Keep package.json version fallback
  }
});

onBeforeUnmount(() => {
  clearTimers();
  resetPatternSetupState();
});

watch(activeAccountId, () => {
  checkPatternState();
  isConfirmingRemovePattern.value = false;
  resetPatternSetupState();
});

async function copyPrimaryAddress() {
  if (!primaryAddress.value) return;
  try {
    await navigator.clipboard.writeText(primaryAddress.value);
    isAddressCopied.value = true;
    if (copyResetTimer) {
      window.clearTimeout(copyResetTimer);
    }
    copyResetTimer = window.setTimeout(() => {
      isAddressCopied.value = false;
      copyResetTimer = null;
    }, 2000);
  } catch {
    // fallback
  }
}

async function lockWallet() {
  resetPatternSetupState();
  sessionStore.lockWallet();
  await router.push("/unlock");
}

function openPatternSetup() {
  resetPatternSetupState();
  securityMessage.value = "";
  isConfirmingRemovePattern.value = false;
  showPatternSetup.value = true;
}

function cancelPatternSetup() {
  resetPatternSetupState();
}

function restartPatternDraw() {
  clearPatternResetTimer();
  firstPattern.value = [];
  confirmedPattern.value = [];
  patternStep.value = "draw";
  patternStatus.value = "normal";
  patternFeedback.value = "";
  patternLockRef.value?.reset();
}

async function verifyPasswordForPattern() {
  if (!patternPassword.value) {
    patternStatus.value = "error";
    patternFeedback.value = "请输入当前钱包密码";
    return;
  }

  if (!activeAccountId.value) {
    patternStatus.value = "error";
    patternFeedback.value = "当前没有可用的账号";
    return;
  }

  isVerifyingPassword.value = true;
  patternStatus.value = "normal";
  patternFeedback.value = "";

  try {
    const candidatePassword = patternPassword.value;
    const verifiedProfile = await unlockWalletBridge({
      accountId: activeAccountId.value,
      password: candidatePassword,
    });

    if (!verifiedProfile) {
      patternStatus.value = "error";
      patternFeedback.value = "钱包密码不正确，请重新输入";
      return;
    }

    verifiedPatternPassword.value = candidatePassword;
    patternPassword.value = "";
    patternStep.value = "draw";
    firstPattern.value = [];
    confirmedPattern.value = [];
    patternStatus.value = "normal";
    patternFeedback.value = "";
  } catch (error) {
    patternStatus.value = "error";
    patternFeedback.value = error instanceof Error ? error.message : "密码校验失败，请重试";
  } finally {
    isVerifyingPassword.value = false;
  }
}

function onPatternDrawn(pattern: number[]) {
  if (patternStep.value === "verify-password" || patternStep.value === "ready") {
    return;
  }

  clearPatternResetTimer();

  if (pattern.length < 4) {
    patternStatus.value = "error";
    patternFeedback.value = "手势连线至少需要连接 4 个点";
    patternResetTimer = window.setTimeout(() => {
      patternStatus.value = "normal";
      patternLockRef.value?.reset();
      patternResetTimer = null;
    }, 900);
    return;
  }

  if (patternStep.value === "draw") {
    firstPattern.value = [...pattern];
    patternStep.value = "confirm";
    patternStatus.value = "normal";
    patternFeedback.value = "请再次绘制相同手势以确认";
    patternLockRef.value?.reset();
    return;
  }

  if (firstPattern.value.join("-") !== pattern.join("-")) {
    patternStatus.value = "error";
    patternFeedback.value = "两次绘制手势不一致，请重新绘制或点击重绘";
    patternResetTimer = window.setTimeout(() => {
      patternStatus.value = "normal";
      patternLockRef.value?.reset();
      patternResetTimer = null;
    }, 900);
    return;
  }

  confirmedPattern.value = [...pattern];
  patternStep.value = "ready";
  patternStatus.value = "success";
  patternFeedback.value = "两次手势一致，请点击下方确认按钮保存";
}

async function confirmSavePattern() {
  if (!activeAccountId.value || !verifiedPatternPassword.value) {
    patternStatus.value = "error";
    patternFeedback.value = "密码验证状态已过期，请重新验证钱包密码";
    patternStep.value = "verify-password";
    return;
  }

  if (confirmedPattern.value.length < 4) {
    patternStatus.value = "error";
    patternFeedback.value = "请先完成两次一致的手势绘制";
    patternStep.value = "draw";
    return;
  }

  isSavingPattern.value = true;
  try {
    await savePatternLock(
      activeAccountId.value,
      confirmedPattern.value,
      verifiedPatternPassword.value,
    );
    hasPattern.value = true;
    securityMessage.value = "手势连线密码已成功设置！";
    resetPatternSetupState();
  } catch (error) {
    patternStatus.value = "error";
    patternFeedback.value = error instanceof Error ? error.message : "设置手势失败";
  } finally {
    isSavingPattern.value = false;
  }
}

function removePattern() {
  if (activeAccountId.value) {
    clearPatternLock(activeAccountId.value);
    hasPattern.value = false;
    isConfirmingRemovePattern.value = false;
    resetPatternSetupState();
    securityMessage.value = "手势密码已清除";
  }
}
</script>

<template>
  <WalletChrome :show-hero="false" :show-nav="true">
    <section class="page-grid page-grid--1">
      <!-- Profile Header Card -->
      <section class="section-card settings-profile-card">
        <div class="settings-profile-card__row">
          <div class="settings-profile-card__identity">
            <div class="settings-profile-card__avatar">
              {{ (walletLabel || "W").slice(0, 1).toUpperCase() }}
            </div>
            <div class="settings-profile-card__meta">
              <div class="settings-profile-card__name-row">
                <strong>{{ walletLabel || "当前钱包" }}</strong>
                <span class="status-chip status-chip--accent status-chip--nowrap">已连接</span>
              </div>
              <div class="settings-profile-card__address-row">
                <span class="settings-profile-card__address">
                  {{ shortenAddress(primaryAddress) }}
                </span>
                <button
                  class="button button--ghost button--small settings-copy-btn"
                  type="button"
                  @click="copyPrimaryAddress"
                >
                  {{ isAddressCopied ? "已复制" : "复制" }}
                </button>
              </div>
            </div>
          </div>

          <div class="settings-profile-card__actions">
            <span class="meta-pill meta-pill--compact">{{ activeNetwork.name }}</span>
            <RouterLink class="button button--ghost button--small" to="/wallet">
              返回钱包
            </RouterLink>
          </div>
        </div>
      </section>

      <!-- Category 1: Navigation & Management Menu -->
      <SectionCard title="核心管理">
        <div class="settings-menu-list">
          <RouterLink to="/settings/accounts" class="settings-menu-item">
            <div class="settings-menu-item__main">
              <div class="settings-menu-item__icon settings-menu-item__icon--indigo">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </div>
              <div class="settings-menu-item__text">
                <strong>账号管理</strong>
                <span>多账户管理、HD 派生新地址与切换</span>
              </div>
            </div>
            <span class="settings-menu-item__chevron">›</span>
          </RouterLink>

          <RouterLink to="/settings/networks" class="settings-menu-item">
            <div class="settings-menu-item__main">
              <div class="settings-menu-item__icon settings-menu-item__icon--cyan">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
              </div>
              <div class="settings-menu-item__text">
                <strong>网络与 Chainlist</strong>
                <span>多链网络、Chainlist 节点测速与自定义 RPC</span>
              </div>
            </div>
            <span class="settings-menu-item__chevron">›</span>
          </RouterLink>

          <RouterLink to="/settings/address-book" class="settings-menu-item">
            <div class="settings-menu-item__main">
              <div class="settings-menu-item__icon settings-menu-item__icon--emerald">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z" />
                  <path d="M6 6h10" />
                  <path d="M6 10h10" />
                </svg>
              </div>
              <div class="settings-menu-item__text">
                <strong>常用地址簿</strong>
                <span>转账常用联系人与地址别名</span>
              </div>
            </div>
            <span class="settings-menu-item__chevron">›</span>
          </RouterLink>
        </div>
      </SectionCard>

      <!-- Category 2: Security & Pattern Lock -->
      <SectionCard title="安全与锁屏" :tone="securityTone">
        <div class="settings-pattern-block">
          <div class="settings-pattern-header">
            <div class="settings-pattern-title">
              <strong>手势连线密码</strong>
              <span :class="['status-chip', 'status-chip--nowrap', hasPattern ? 'status-chip--accent' : '']">
                {{ hasPattern ? "已设置" : "未设置" }}
              </span>
            </div>

            <div class="settings-pattern-actions">
              <button
                v-if="!showPatternSetup"
                class="button button--secondary button--small"
                type="button"
                @click="openPatternSetup"
              >
                {{ hasPattern ? "修改手势" : "设置手势" }}
              </button>

              <template v-if="hasPattern && !showPatternSetup">
                <button
                  v-if="!isConfirmingRemovePattern"
                  class="button button--ghost button--small"
                  type="button"
                  @click="isConfirmingRemovePattern = true"
                >
                  清除
                </button>
                <template v-else>
                  <button
                    class="button button--danger button--small"
                    type="button"
                    @click="removePattern"
                  >
                    确认清除
                  </button>
                  <button
                    class="button button--ghost button--small"
                    type="button"
                    @click="isConfirmingRemovePattern = false"
                  >
                    取消
                  </button>
                </template>
              </template>
            </div>
          </div>

          <p class="settings-pattern-desc">
            九宫格 3x3 滑动连线，支持默认解锁及转账快速签名
          </p>

          <!-- Step-by-step Pattern Setup Drawer -->
          <div v-if="showPatternSetup" class="settings-pattern-drawer">
            <div class="settings-pattern-steps" aria-label="设置步骤">
              <span
                :class="[
                  'settings-step-pill',
                  patternStep === 'verify-password' ? 'settings-step-pill--active' : 'settings-step-pill--done',
                ]"
              >
                1. 验证密码
              </span>
              <span
                :class="[
                  'settings-step-pill',
                  patternStep === 'draw' || patternStep === 'confirm'
                    ? 'settings-step-pill--active'
                    : patternStep === 'ready'
                      ? 'settings-step-pill--done'
                      : '',
                ]"
              >
                2. 绘制连线
              </span>
              <span
                :class="[
                  'settings-step-pill',
                  patternStep === 'ready' ? 'settings-step-pill--active' : '',
                ]"
              >
                3. 确认保存
              </span>
            </div>

            <strong class="settings-pattern-step-title">
              {{ patternStepHeading }}
            </strong>

            <!-- Step 1: Verify wallet password BEFORE showing PatternLock -->
            <form
              v-if="patternStep === 'verify-password'"
              class="form-grid settings-pattern-password-form"
              @submit.prevent="verifyPasswordForPattern"
            >
              <label class="field">
                <span>当前钱包密码（验证通过后才可绘制手势）</span>
                <input
                  v-model="patternPassword"
                  type="password"
                  placeholder="请输入当前钱包密码"
                  autocomplete="current-password"
                  :disabled="isVerifyingPassword"
                />
              </label>

              <p
                v-if="patternFeedback"
                :class="['helper-text', patternStatus === 'error' ? 'helper-text--error' : '']"
              >
                {{ patternFeedback }}
              </p>

              <div class="form-actions">
                <button
                  class="button button--primary button--small"
                  type="submit"
                  :disabled="isVerifyingPassword || !patternPassword"
                >
                  {{ isVerifyingPassword ? "正在验证..." : "验证密码并继续" }}
                </button>
                <button
                  class="button button--ghost button--small"
                  type="button"
                  :disabled="isVerifyingPassword"
                  @click="cancelPatternSetup"
                >
                  取消设置
                </button>
              </div>
            </form>

            <!-- Step 2-4: Draw -> Confirm Draw -> Explicit Save Confirmation -->
            <template v-else>
              <PatternLock
                ref="patternLockRef"
                :size="210"
                :disabled="patternStep === 'ready' || isSavingPattern"
                :status="patternStatus"
                @completed="onPatternDrawn"
              />

              <p
                v-if="patternFeedback"
                :class="[
                  'helper-text',
                  patternStatus === 'error'
                    ? 'helper-text--error'
                    : patternStatus === 'success'
                      ? 'helper-text--success'
                      : '',
                ]"
                style="text-align: center;"
              >
                {{ patternFeedback }}
              </p>

              <div class="form-actions settings-pattern-drawer-actions">
                <button
                  v-if="patternStep === 'ready'"
                  class="button button--primary button--small"
                  type="button"
                  :disabled="isSavingPattern"
                  @click="confirmSavePattern"
                >
                  {{ isSavingPattern ? "正在保存..." : "确认保存手势" }}
                </button>
                <button
                  v-if="patternStep === 'confirm' || patternStep === 'ready'"
                  class="button button--secondary button--small"
                  type="button"
                  :disabled="isSavingPattern"
                  @click="restartPatternDraw"
                >
                  重新绘制
                </button>
                <button
                  class="button button--ghost button--small"
                  type="button"
                  :disabled="isSavingPattern"
                  @click="cancelPatternSetup"
                >
                  取消设置
                </button>
              </div>
            </template>
          </div>

          <p
            v-if="securityMessage"
            class="helper-text helper-text--success"
            style="margin-top: 2px;"
          >
            {{ securityMessage }}
          </p>
        </div>
      </SectionCard>

      <!-- Category 3: System & Info -->
      <details class="collapsible-card">
        <summary class="collapsible-summary">
          <span>ℹ️ 关于与状态 ({{ appVersion }})</span>
          <span class="collapsible-chevron">›</span>
        </summary>
        <div class="collapsible-content">
          <div class="key-value-list">
            <div class="key-value-row">
              <span>当前版本</span>
              <strong>{{ appVersion }}</strong>
            </div>
            <div class="key-value-row">
              <span>助记词备份</span>
              <strong>{{ backupLabel }}</strong>
            </div>
            <div class="key-value-row">
              <span>存储方案</span>
              <strong>Stronghold + SQLite</strong>
            </div>
          </div>
        </div>
      </details>

      <!-- Standalone Lock Wallet Action (separated from security setup box) -->
      <div class="settings-lock-section">
        <button
          class="button button--primary settings-lock-btn"
          type="button"
          @click="lockWallet"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          锁定钱包
        </button>
      </div>
    </section>
  </WalletChrome>
</template>

<style scoped>
.settings-profile-card {
  padding: 16px 18px;
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.16) 0%, rgba(6, 182, 212, 0.1) 100%);
  border-color: rgba(99, 102, 241, 0.28);
}

.settings-profile-card__row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px 12px;
}

.settings-profile-card__identity {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  flex: 1 1 220px;
}

.settings-profile-card__avatar {
  width: 44px;
  height: 44px;
  border-radius: var(--radius-full);
  background: linear-gradient(135deg, #6366f1 0%, #06b6d4 100%);
  display: grid;
  place-items: center;
  color: #fff;
  font-weight: 800;
  font-size: 1.15rem;
  box-shadow: 0 4px 14px rgba(99, 102, 241, 0.4);
  flex-shrink: 0;
}

.settings-profile-card__meta {
  min-width: 0;
  flex: 1;
}

.settings-profile-card__name-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.settings-profile-card__name-row strong {
  font-size: 1rem;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings-profile-card__address-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
}

.settings-profile-card__address {
  font-family: var(--font-mono);
  font-size: 0.76rem;
  color: var(--text-secondary);
}

.settings-copy-btn {
  padding: 2px 7px;
  min-height: 22px;
  font-size: 0.68rem;
}

.settings-profile-card__actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  flex-shrink: 0;
  margin-left: auto;
}

.meta-pill--compact {
  font-size: 0.72rem;
  padding: 4px 10px;
}

.settings-menu-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.settings-menu-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.07);
  text-decoration: none;
  color: inherit;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.settings-menu-item:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.14);
}

.settings-menu-item__main {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
}

.settings-menu-item__icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}

.settings-menu-item__icon--indigo {
  background: rgba(99, 102, 241, 0.15);
  color: #818cf8;
}

.settings-menu-item__icon--cyan {
  background: rgba(6, 182, 212, 0.15);
  color: #22d3ee;
}

.settings-menu-item__icon--emerald {
  background: rgba(16, 185, 129, 0.15);
  color: #34d399;
}

.settings-menu-item__text {
  min-width: 0;
}

.settings-menu-item__text strong {
  font-size: 0.88rem;
  display: block;
}

.settings-menu-item__text span {
  font-size: 0.72rem;
  color: var(--text-muted);
  display: block;
}

.settings-menu-item__chevron {
  color: var(--text-muted);
  font-size: 0.95rem;
  flex-shrink: 0;
}

.settings-pattern-block {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.settings-pattern-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.settings-pattern-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-wrap: nowrap;
}

.settings-pattern-title strong {
  font-size: 0.9rem;
  white-space: nowrap;
}

.settings-pattern-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.settings-pattern-actions .button {
  white-space: nowrap;
  flex-shrink: 0;
}

.settings-pattern-desc {
  margin: 0;
  font-size: 0.75rem;
  color: var(--text-secondary);
  line-height: 1.45;
}

.settings-pattern-drawer {
  margin-top: 4px;
  padding: 16px;
  border-radius: var(--radius-md);
  background: rgba(0, 0, 0, 0.28);
  border: 1px solid rgba(99, 102, 241, 0.3);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.settings-pattern-steps {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex-wrap: wrap;
  width: 100%;
}

.settings-step-pill {
  padding: 3px 9px;
  border-radius: var(--radius-full);
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--text-muted);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  white-space: nowrap;
}

.settings-step-pill--active {
  color: #c7d2fe;
  background: rgba(99, 102, 241, 0.2);
  border-color: rgba(99, 102, 241, 0.45);
}

.settings-step-pill--done {
  color: #34d399;
  background: rgba(16, 185, 129, 0.12);
  border-color: rgba(16, 185, 129, 0.32);
}

.settings-pattern-step-title {
  font-size: 0.88rem;
  text-align: center;
  color: var(--text-primary);
}

.settings-pattern-password-form {
  width: 100%;
}

.settings-pattern-drawer-actions {
  width: 100%;
  flex-wrap: wrap;
}

.settings-lock-section {
  margin-top: 2px;
}

.settings-lock-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
</style>
