<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { RouterLink, useRouter } from "vue-router";
import PatternLock from "../../components/PatternLock.vue";
import SectionCard from "../../components/SectionCard.vue";
import WalletChrome from "../../components/WalletChrome.vue";
import { checkBiometricCapability } from "../../services/biometrics";
import { clearPatternLock, hasPatternLock, savePatternLock } from "../../services/patternLock";
import { useNetworksStore } from "../../stores/networks";
import { useSessionStore } from "../../stores/session";
import { shortenAddress } from "../../utils/format";

const router = useRouter();
const sessionStore = useSessionStore();
const networksStore = useNetworksStore();

const securityMessage = ref("");
const isSavingBiometric = ref(false);
const biometricCapability = ref("检测中...");
const hasPattern = ref(false);
const showPatternSetup = ref(false);
const patternStep = ref<"draw" | "confirm">("draw");
const firstPattern = ref<number[]>([]);
const patternPassword = ref("");
const patternFeedback = ref("");
const patternStatus = ref<"normal" | "success" | "error">("normal");
const patternLockRef = ref<InstanceType<typeof PatternLock> | null>(null);
const isAddressCopied = ref(false);

const {
  activeAccountId,
  hasBackedUpMnemonic,
  isBiometricEnabled,
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

function checkPatternState() {
  if (activeAccountId.value) {
    hasPattern.value = hasPatternLock(activeAccountId.value);
  }
}

onMounted(async () => {
  checkPatternState();
  const cap = await checkBiometricCapability();
  biometricCapability.value = cap.available ? cap.typeLabel : "当前环境不可用";
});

watch(activeAccountId, checkPatternState);

async function copyPrimaryAddress() {
  if (!primaryAddress.value) return;
  try {
    await navigator.clipboard.writeText(primaryAddress.value);
    isAddressCopied.value = true;
    setTimeout(() => {
      isAddressCopied.value = false;
    }, 2000);
  } catch {
    // fallback
  }
}

async function lockWallet() {
  sessionStore.lockWallet();
  await router.push("/unlock");
}

async function toggleBiometric(event: Event) {
  const target = event.target as HTMLInputElement;
  securityMessage.value = "";
  isSavingBiometric.value = true;

  try {
    const updated = await sessionStore.setBiometricEnabled(target.checked);
    securityMessage.value = updated ? "生物识别状态已更新" : "当前环境无法更新生物识别";
  } finally {
    isSavingBiometric.value = false;
  }
}

function openPatternSetup() {
  showPatternSetup.value = true;
  patternStep.value = "draw";
  firstPattern.value = [];
  patternPassword.value = "";
  patternFeedback.value = "";
  patternStatus.value = "normal";
}

function cancelPatternSetup() {
  showPatternSetup.value = false;
  firstPattern.value = [];
  patternFeedback.value = "";
}

async function onPatternDrawn(pattern: number[]) {
  if (pattern.length < 4) {
    patternStatus.value = "error";
    patternFeedback.value = "手势连线至少需要连接 4 个点";
    setTimeout(() => {
      patternStatus.value = "normal";
      patternLockRef.value?.reset();
    }, 1000);
    return;
  }

  if (patternStep.value === "draw") {
    firstPattern.value = [...pattern];
    patternStep.value = "confirm";
    patternFeedback.value = "请再次绘制手势以确认";
    patternLockRef.value?.reset();
    return;
  }

  if (firstPattern.value.join("-") !== pattern.join("-")) {
    patternStatus.value = "error";
    patternFeedback.value = "两次绘制手势不一致，请重试";
    setTimeout(() => {
      patternStep.value = "draw";
      firstPattern.value = [];
      patternStatus.value = "normal";
      patternLockRef.value?.reset();
    }, 1200);
    return;
  }

  if (!patternPassword.value.trim()) {
    patternFeedback.value = "请输入当前钱包密码，以绑定快速手势解锁";
    return;
  }

  if (!activeAccountId.value) return;

  try {
    await savePatternLock(activeAccountId.value, pattern, patternPassword.value.trim());
    patternStatus.value = "success";
    patternFeedback.value = "手势连线密码已成功设置！";
    hasPattern.value = true;
    setTimeout(() => {
      showPatternSetup.value = false;
    }, 1000);
  } catch (error) {
    patternFeedback.value = error instanceof Error ? error.message : "设置手势失败";
  }
}

function removePattern() {
  if (activeAccountId.value) {
    clearPatternLock(activeAccountId.value);
    hasPattern.value = false;
    securityMessage.value = "手势密码已清除";
  }
}
</script>

<template>
  <WalletChrome :show-hero="false" :show-nav="true">
    <section class="page-grid page-grid--1">
      <!-- Profile Header Card -->
      <section
        class="section-card"
        style="
          padding: 18px 20px;
          background: linear-gradient(135deg, rgba(99, 102, 241, 0.16) 0%, rgba(6, 182, 212, 0.1) 100%);
          border-color: rgba(99, 102, 241, 0.28);
        "
      >
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <div
              style="
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
              "
            >
              {{ (walletLabel || "W").slice(0, 1).toUpperCase() }}
            </div>
            <div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <strong style="font-size: 1rem; color: var(--text-primary);">{{ walletLabel || "当前钱包" }}</strong>
                <span class="status-chip status-chip--accent" style="padding: 2px 7px; font-size: 0.7rem;">已连接</span>
              </div>
              <div style="display: flex; align-items: center; gap: 6px; margin-top: 2px;">
                <span style="font-family: var(--font-mono); font-size: 0.76rem; color: var(--text-secondary);">
                  {{ shortenAddress(primaryAddress) }}
                </span>
                <button
                  class="button button--ghost button--small"
                  type="button"
                  style="padding: 1px 6px; font-size: 0.68rem;"
                  @click="copyPrimaryAddress"
                >
                  {{ isAddressCopied ? "已复制" : "复制" }}
                </button>
              </div>
            </div>
          </div>

          <div style="display: flex; gap: 6px; align-items: center;">
            <span class="meta-pill" style="font-size: 0.74rem;">
              {{ activeNetwork.name }}
            </span>
            <RouterLink class="button button--ghost button--small" to="/wallet" style="font-size: 0.74rem;">
              返回钱包
            </RouterLink>
          </div>
        </div>
      </section>

      <!-- Category 1: Navigation & Management Menu -->
      <SectionCard title="核心管理">
        <div style="display: flex; flex-direction: column; gap: 8px;">
          <RouterLink
            to="/settings/accounts"
            class="settings-menu-item"
            style="
              display: flex;
              justify-content: space-between;
              align-items: center;
              padding: 12px 14px;
              border-radius: var(--radius-sm);
              background: rgba(255, 255, 255, 0.03);
              border: 1px solid rgba(255, 255, 255, 0.07);
              text-decoration: none;
              color: inherit;
            "
          >
            <div style="display: flex; align-items: center; gap: 10px;">
              <div style="width: 32px; height: 32px; border-radius: 8px; background: rgba(99, 102, 241, 0.15); display: grid; place-items: center; color: #818cf8;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </div>
              <div>
                <strong style="font-size: 0.88rem; display: block;">账号管理</strong>
                <span style="font-size: 0.72rem; color: var(--text-muted);">多账户管理、HD 派生新地址与切换</span>
              </div>
            </div>
            <span style="color: var(--text-muted); font-size: 0.85rem;">›</span>
          </RouterLink>

          <RouterLink
            to="/settings/networks"
            class="settings-menu-item"
            style="
              display: flex;
              justify-content: space-between;
              align-items: center;
              padding: 12px 14px;
              border-radius: var(--radius-sm);
              background: rgba(255, 255, 255, 0.03);
              border: 1px solid rgba(255, 255, 255, 0.07);
              text-decoration: none;
              color: inherit;
            "
          >
            <div style="display: flex; align-items: center; gap: 10px;">
              <div style="width: 32px; height: 32px; border-radius: 8px; background: rgba(6, 182, 212, 0.15); display: grid; place-items: center; color: #22d3ee;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
              </div>
              <div>
                <strong style="font-size: 0.88rem; display: block;">网络与 Chainlist</strong>
                <span style="font-size: 0.72rem; color: var(--text-muted);">多链网络、Chainlist 节点测速与自定义 RPC</span>
              </div>
            </div>
            <span style="color: var(--text-muted); font-size: 0.85rem;">›</span>
          </RouterLink>

          <RouterLink
            to="/settings/address-book"
            class="settings-menu-item"
            style="
              display: flex;
              justify-content: space-between;
              align-items: center;
              padding: 12px 14px;
              border-radius: var(--radius-sm);
              background: rgba(255, 255, 255, 0.03);
              border: 1px solid rgba(255, 255, 255, 0.07);
              text-decoration: none;
              color: inherit;
            "
          >
            <div style="display: flex; align-items: center; gap: 10px;">
              <div style="width: 32px; height: 32px; border-radius: 8px; background: rgba(16, 185, 129, 0.15); display: grid; place-items: center; color: #34d399;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z" />
                  <path d="M6 6h10" />
                  <path d="M6 10h10" />
                </svg>
              </div>
              <div>
                <strong style="font-size: 0.88rem; display: block;">常用地址簿</strong>
                <span style="font-size: 0.72rem; color: var(--text-muted);">转账常用联系人与地址别名</span>
              </div>
            </div>
            <span style="color: var(--text-muted); font-size: 0.85rem;">›</span>
          </RouterLink>
        </div>
      </SectionCard>

      <!-- Category 2: Security & Unlock Center -->
      <SectionCard title="安全与锁屏" :tone="securityTone">
        <div style="display: flex; flex-direction: column; gap: 14px;">
          <!-- Biometric Toggle Row -->
          <div style="display: flex; justify-content: space-between; align-items: center; padding-bottom: 12px; border-bottom: 1px solid rgba(255, 255, 255, 0.06);">
            <div>
              <strong style="font-size: 0.88rem;">生物识别解锁</strong>
              <p style="margin: 2px 0 0; font-size: 0.74rem; color: var(--text-secondary);">
                {{ biometricCapability }}
              </p>
            </div>
            <label class="toggle-row" style="margin: 0;">
              <input
                :checked="isBiometricEnabled"
                :disabled="isSavingBiometric"
                type="checkbox"
                @change="toggleBiometric"
              />
              <span style="font-size: 0.8rem;">{{ isSavingBiometric ? "更新中..." : (isBiometricEnabled ? "已启用" : "未开启") }}</span>
            </label>
          </div>

          <!-- Pattern Lock Row -->
          <div style="display: flex; justify-content: space-between; align-items: center; padding-bottom: 12px; border-bottom: 1px solid rgba(255, 255, 255, 0.06);">
            <div>
              <strong style="font-size: 0.88rem;">手势连线解锁</strong>
              <p style="margin: 2px 0 0; font-size: 0.74rem; color: var(--text-secondary);">
                九宫格 3x3 滑动连线快速解锁
              </p>
            </div>
            <div style="display: flex; align-items: center; gap: 6px;">
              <span :class="['status-chip', hasPattern ? 'status-chip--accent' : '']" style="font-size: 0.72rem;">
                {{ hasPattern ? "已设置" : "未设置" }}
              </span>
              <button
                class="button button--secondary button--small"
                type="button"
                style="font-size: 0.74rem; padding: 4px 8px;"
                @click="openPatternSetup"
              >
                {{ hasPattern ? "修改手势" : "设置手势" }}
              </button>
              <button
                v-if="hasPattern"
                class="button button--ghost button--small"
                type="button"
                style="font-size: 0.74rem; padding: 4px 8px;"
                @click="removePattern"
              >
                清除
              </button>
            </div>
          </div>

          <!-- Inline Pattern Setup Drawer -->
          <div
            v-if="showPatternSetup"
            style="
              padding: 16px;
              border-radius: var(--radius-sm);
              background: rgba(0, 0, 0, 0.25);
              border: 1px solid rgba(99, 102, 241, 0.3);
              display: flex;
              flex-direction: column;
              align-items: center;
              gap: 12px;
            "
          >
            <strong style="font-size: 0.9rem;">
              {{ patternStep === "draw" ? "绘制新手势连线 (至少 4 个点)" : "请再次绘制相同手势确认" }}
            </strong>

            <PatternLock
              ref="patternLockRef"
              :size="200"
              :status="patternStatus"
              @completed="onPatternDrawn"
            />

            <label class="field" style="width: 100%; max-width: 260px;">
              <span style="font-size: 0.74rem;">当前钱包密码 (用于绑定手势解锁)</span>
              <input
                v-model="patternPassword"
                type="password"
                placeholder="输入当前钱包密码"
                autocomplete="current-password"
              />
            </label>

            <p v-if="patternFeedback" :class="['helper-text', patternStatus === 'error' ? 'helper-text--error' : '']" style="margin: 0; font-size: 0.76rem;">
              {{ patternFeedback }}
            </p>

            <div style="display: flex; gap: 8px;">
              <button class="button button--ghost button--small" type="button" @click="cancelPatternSetup">
                取消设置
              </button>
            </div>
          </div>

          <p v-if="securityMessage" class="helper-text" style="margin: 0;">{{ securityMessage }}</p>

          <!-- Primary Lock Action -->
          <div class="form-actions" style="margin-top: 2px;">
            <button
              class="button button--primary"
              type="button"
              style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px;"
              @click="lockWallet"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              锁定钱包
            </button>
          </div>
        </div>
      </SectionCard>

      <!-- Category 3: System & Info -->
      <SectionCard title="关于与状态">
        <div class="key-value-list">
          <div class="key-value-row">
            <span>当前版本</span>
            <strong>v0.1.7</strong>
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
      </SectionCard>
    </section>
  </WalletChrome>
</template>
