<script setup lang="ts">
import { computed, ref } from "vue";
import { storeToRefs } from "pinia";
import { RouterLink, useRouter } from "vue-router";
import SectionCard from "../../components/SectionCard.vue";
import WalletChrome from "../../components/WalletChrome.vue";
import { deriveMnemonicAccount } from "../../services/walletBridge";
import { useSessionStore } from "../../stores/session";
import { shortenAddress } from "../../utils/format";
import { getNextMnemonicDerivationIndex, groupWalletProfiles } from "../../utils/wallet";

const router = useRouter();
const sessionStore = useSessionStore();

const { activeAccountId, walletProfiles } = storeToRefs(sessionStore);
const switchFeedback = ref("");
const isSwitchingAccountId = ref<string | null>(null);
const deriveTargetAccountId = ref<string | null>(null);
const deriveLabel = ref("");
const derivePassword = ref("");
const deriveFeedback = ref("");
const isDeriving = ref(false);
const renameTargetAccountId = ref<string | null>(null);
const renameLabel = ref("");
const renameFeedback = ref("");
const isRenaming = ref(false);
const deleteTargetAccountId = ref<string | null>(null);
const deleteConfirmLabel = ref("");
const deletePassword = ref("");
const deleteFeedback = ref("");
const isDeleting = ref(false);
const copiedAddress = ref<string | null>(null);

type AccountEntry = (typeof walletProfiles.value)[number];

const accountGroups = computed(() =>
  groupWalletProfiles(walletProfiles.value, activeAccountId.value),
);

function sourceLabel(value: "created" | "imported") {
  return value === "created" ? "创建" : "导入";
}

function secretKindLabel(value: "mnemonic" | "privateKey") {
  return value === "mnemonic" ? "助记词" : "私钥";
}

function derivationLabel(index: number) {
  return index === 0 ? "主地址" : `派生 #${index}`;
}

function nextDerivationIndex(account: (typeof walletProfiles.value)[number]) {
  return getNextMnemonicDerivationIndex(walletProfiles.value, account);
}

async function copyAddress(address: string) {
  let succeeded = false;
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(address);
      succeeded = true;
    }
  } catch {
    succeeded = false;
  }

  if (!succeeded) {
    try {
      const textArea = document.createElement("textarea");
      textArea.value = address;
      textArea.style.position = "fixed";
      textArea.style.opacity = "0";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      succeeded = document.execCommand("copy");
      document.body.removeChild(textArea);
    } catch {
      succeeded = false;
    }
  }

  if (succeeded) {
    copiedAddress.value = address;
    setTimeout(() => {
      if (copiedAddress.value === address) {
        copiedAddress.value = null;
      }
    }, 2000);
  }
}

async function switchAccount(accountId: string) {
  if (accountId === activeAccountId.value) {
    await router.push("/wallet");
    return;
  }

  switchFeedback.value = "";
  isSwitchingAccountId.value = accountId;

  try {
    const didSwitch = await sessionStore.selectWalletAccount(accountId, { lock: true });

    if (!didSwitch) {
      switchFeedback.value = "当前无法切换账号，请稍后重试。";
      return;
    }

    await router.push("/unlock");
  } finally {
    isSwitchingAccountId.value = null;
  }
}

function openDeriveForm(account: AccountEntry) {
  cancelRenameForm();
  cancelDeleteForm();
  deriveTargetAccountId.value = account.accountId;
  deriveLabel.value = `${account.walletLabel} / ${nextDerivationIndex(account)}`;
  derivePassword.value = "";
  deriveFeedback.value = "";
}

function cancelDeriveForm() {
  deriveTargetAccountId.value = null;
  deriveLabel.value = "";
  derivePassword.value = "";
  deriveFeedback.value = "";
}

function openRenameForm(account: AccountEntry) {
  cancelDeriveForm();
  cancelDeleteForm();
  renameTargetAccountId.value = account.accountId;
  renameLabel.value = account.walletLabel;
  renameFeedback.value = "";
}

function cancelRenameForm() {
  renameTargetAccountId.value = null;
  renameLabel.value = "";
  renameFeedback.value = "";
}

function openDeleteForm(account: AccountEntry) {
  cancelDeriveForm();
  cancelRenameForm();
  deleteTargetAccountId.value = account.accountId;
  deleteConfirmLabel.value = "";
  deletePassword.value = "";
  deleteFeedback.value = "";
}

function cancelDeleteForm() {
  deleteTargetAccountId.value = null;
  deleteConfirmLabel.value = "";
  deletePassword.value = "";
  deleteFeedback.value = "";
}

async function submitDerive(account: AccountEntry) {
  deriveFeedback.value = "";

  if (!deriveLabel.value.trim()) {
    deriveFeedback.value = "新地址名称不能为空。";
    return;
  }

  if (!derivePassword.value.trim()) {
    deriveFeedback.value = "需要输入当前助记词账号的钱包密码。";
    return;
  }

  isDeriving.value = true;

  try {
    const profile = await deriveMnemonicAccount({
      sourceAccountId: account.accountId,
      walletLabel: deriveLabel.value.trim(),
      password: derivePassword.value,
    });

    sessionStore.applyWalletProfile(profile, { unlocked: true });
    cancelDeriveForm();
    await router.push("/wallet");
  } catch (error) {
    deriveFeedback.value = error instanceof Error ? error.message : "派生地址失败，请稍后重试。";
  } finally {
    isDeriving.value = false;
  }
}

async function submitRename(account: AccountEntry) {
  renameFeedback.value = "";

  if (!renameLabel.value.trim()) {
    renameFeedback.value = "账号名称不能为空。";
    return;
  }

  isRenaming.value = true;

  try {
    const updated = await sessionStore.renameWalletAccount(
      account.accountId,
      renameLabel.value.trim(),
    );

    if (!updated) {
      renameFeedback.value = "当前无法重命名这个账号，请稍后重试。";
      return;
    }

    cancelRenameForm();
  } finally {
    isRenaming.value = false;
  }
}

async function submitDelete(account: AccountEntry) {
  deleteFeedback.value = "";

  if (deleteConfirmLabel.value.trim() !== account.walletLabel) {
    deleteFeedback.value = "请输入当前账号名称以确认删除。";
    return;
  }

  if (!deletePassword.value.trim()) {
    deleteFeedback.value = "请输入当前账号的钱包密码，才能删除这个账号。";
    return;
  }

  isDeleting.value = true;

  try {
    const result = await sessionStore.deleteWalletAccount(account.accountId, deletePassword.value);

    if (!result.ok) {
      deleteFeedback.value = result.errorMessage || "当前无法删除这个账号，请稍后重试。";
      return;
    }

    cancelDeleteForm();

    if (result.removedAll) {
      await router.push("/welcome");
      return;
    }

    if (result.requiresUnlock) {
      await router.push("/unlock");
    }
  } finally {
    isDeleting.value = false;
  }
}
</script>

<template>
  <WalletChrome
    eyebrow="账户管理"
    title="账号管理"
    subtitle="管理本地多钱包与 HD 派生地址"
    :show-nav="false"
  >
    <template #actions>
      <div class="accounts-header-actions">
        <RouterLink class="button button--primary button--small accounts-header-btn" to="/settings/accounts/create">
          + 创建账号
        </RouterLink>
        <RouterLink class="button button--secondary button--small accounts-header-btn" to="/settings/accounts/import">
          📥 导入账号
        </RouterLink>
        <RouterLink class="button button--ghost button--small accounts-header-btn" to="/settings">
          返回设置
        </RouterLink>
      </div>
    </template>

    <section class="page-grid page-grid--1">
      <SectionCard title="本地账号列表">
        <template #header>
          <div class="section-card__actions">
            <span class="section-card__meta">共 {{ walletProfiles.length }} 个账号</span>
          </div>
        </template>

        <div style="display: flex; flex-direction: column; gap: 14px;">
          <!-- Loop through groups -->
          <div
            v-for="group in accountGroups"
            :key="group.id"
            style="display: flex; flex-direction: column; gap: 10px;"
          >
            <!-- Clean subtle group tag -->
            <div class="account-group-bar">
              <div class="account-group-tags">
                <span class="status-chip status-chip--accent" style="padding: 2px 7px; font-size: 0.68rem;">
                  {{ secretKindLabel(group.secretKind) }}
                </span>
                <span class="status-chip" style="padding: 2px 7px; font-size: 0.68rem;">
                  {{ sourceLabel(group.source) }}
                </span>
              </div>
              <span class="account-group-count">
                {{ group.accountCount }} 个地址
                <template v-if="group.nextDerivationIndex !== null">· 下一派生 #{{ group.nextDerivationIndex }}</template>
              </span>
            </div>

            <!-- Account cards in group -->
            <article
              v-for="account in group.accounts"
              :key="account.accountId"
              :class="['account-card', account.accountId === activeAccountId ? 'account-card--active' : '']"
            >
              <!-- Card Top: Avatar + Name + Active Pill / Switch Button -->
              <div class="account-card__header">
                <div class="account-card__identity">
                  <div class="account-card__avatar">
                    {{ (account.walletLabel || "W").slice(0, 1).toUpperCase() }}
                  </div>
                  <div class="account-card__meta">
                    <div class="account-card__name-row">
                      <strong class="account-card__name" :title="account.walletLabel">
                        {{ account.walletLabel }}
                      </strong>
                    </div>
                    <div class="account-card__address-row">
                      <span class="account-card__address">{{ shortenAddress(account.address) }}</span>
                      <button
                        class="account-card__copy-btn"
                        type="button"
                        title="复制地址"
                        @click="copyAddress(account.address)"
                      >
                        {{ copiedAddress === account.address ? "已复制" : "复制" }}
                      </button>
                      <span class="account-card__derivation">
                        {{ derivationLabel(account.derivationIndex) }}
                      </span>
                    </div>
                  </div>
                </div>

                <!-- Right Status: Active Badge or Switch Button -->
                <div class="account-card__status">
                  <span v-if="account.accountId === activeAccountId" class="account-card__active-badge">
                    <span class="account-card__active-dot"></span>
                    当前激活
                  </span>
                  <button
                    v-else
                    class="button button--secondary button--small account-card__switch-btn"
                    type="button"
                    :disabled="isSwitchingAccountId === account.accountId"
                    @click="switchAccount(account.accountId)"
                  >
                    {{ isSwitchingAccountId === account.accountId ? "切换中..." : "切换" }}
                  </button>
                </div>
              </div>

              <!-- Card Bottom: Toolbar with 3 Equal Width Action Buttons -->
              <div class="account-card__toolbar">
                <button
                  v-if="account.secretKind === 'mnemonic'"
                  class="account-card__tool-btn"
                  type="button"
                  @click="deriveTargetAccountId === account.accountId ? cancelDeriveForm() : openDeriveForm(account)"
                >
                  {{ deriveTargetAccountId === account.accountId ? "取消派生" : "派生新地址" }}
                </button>
                <button
                  class="account-card__tool-btn"
                  type="button"
                  @click="renameTargetAccountId === account.accountId ? cancelRenameForm() : openRenameForm(account)"
                >
                  {{ renameTargetAccountId === account.accountId ? "取消重命名" : "重命名" }}
                </button>
                <button
                  class="account-card__tool-btn account-card__tool-btn--danger"
                  type="button"
                  @click="deleteTargetAccountId === account.accountId ? cancelDeleteForm() : openDeleteForm(account)"
                >
                  {{ deleteTargetAccountId === account.accountId ? "取消删除" : "删除账号" }}
                </button>
              </div>

              <!-- Inline Derive Form -->
              <div
                v-if="deriveTargetAccountId === account.accountId"
                class="account-card__form"
              >
                <label class="field">
                  <span>新地址名称</span>
                  <input v-model="deriveLabel" autocomplete="off" placeholder="例如 Trading Account / 1" />
                </label>
                <label class="field">
                  <span>当前账号密码</span>
                  <input
                    v-model="derivePassword"
                    autocomplete="current-password"
                    type="password"
                    placeholder="输入当前助记词账号密码"
                  />
                </label>
                <p class="helper-text" style="font-size: 0.74rem;">
                  将派生下一地址索引 #{{ nextDerivationIndex(account) }}。
                </p>
                <p v-if="deriveFeedback" class="helper-text helper-text--error">{{ deriveFeedback }}</p>
                <div class="form-actions form-actions--compact">
                  <button
                    class="button button--primary button--small"
                    type="button"
                    :disabled="isDeriving"
                    @click="submitDerive(account)"
                  >
                    {{ isDeriving ? "派生中..." : "确认派生" }}
                  </button>
                  <button class="button button--ghost button--small" type="button" @click="cancelDeriveForm">
                    收起
                  </button>
                </div>
              </div>

              <!-- Inline Rename Form -->
              <div
                v-if="renameTargetAccountId === account.accountId"
                class="account-card__form"
              >
                <label class="field">
                  <span>账号名称</span>
                  <input v-model="renameLabel" autocomplete="off" placeholder="输入新的账号名称" />
                </label>
                <p v-if="renameFeedback" class="helper-text helper-text--error">{{ renameFeedback }}</p>
                <div class="form-actions form-actions--compact">
                  <button
                    class="button button--primary button--small"
                    type="button"
                    :disabled="isRenaming"
                    @click="submitRename(account)"
                  >
                    {{ isRenaming ? "保存中..." : "保存名称" }}
                  </button>
                  <button class="button button--ghost button--small" type="button" @click="cancelRenameForm">
                    收起
                  </button>
                </div>
              </div>

              <!-- Inline Delete Form -->
              <div
                v-if="deleteTargetAccountId === account.accountId"
                class="account-card__form account-card__form--danger"
              >
                <p class="helper-text helper-text--error" style="font-size: 0.74rem;">
                  删除后账号将从当前设备移除。请输入账号名称 <strong>{{ account.walletLabel }}</strong> 确认。
                </p>
                <label class="field">
                  <span>确认账号名称</span>
                  <input
                    v-model="deleteConfirmLabel"
                    autocomplete="off"
                    placeholder="输入当前账号名称以确认"
                  />
                </label>
                <label class="field">
                  <span>账号密码</span>
                  <input
                    v-model="deletePassword"
                    autocomplete="current-password"
                    type="password"
                    placeholder="输入当前账号的钱包密码"
                  />
                </label>
                <p v-if="deleteFeedback" class="helper-text helper-text--error">{{ deleteFeedback }}</p>
                <div class="form-actions form-actions--compact">
                  <button
                    class="button button--danger button--small"
                    type="button"
                    :disabled="isDeleting"
                    @click="submitDelete(account)"
                  >
                    {{ isDeleting ? "删除中..." : "确认删除" }}
                  </button>
                  <button class="button button--ghost button--small" type="button" @click="cancelDeleteForm">
                    收起
                  </button>
                </div>
              </div>
            </article>
          </div>
        </div>

        <p v-if="switchFeedback" class="helper-text helper-text--error" style="margin-top: 8px;">{{ switchFeedback }}</p>
      </SectionCard>
    </section>
  </WalletChrome>
</template>

<style scoped>
.accounts-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.accounts-header-btn {
  flex: 1;
  white-space: nowrap;
  justify-content: center;
  text-align: center;
  font-size: 0.76rem;
  padding: 6px 6px;
}

.account-group-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 4px;
}

.account-group-tags {
  display: flex;
  align-items: center;
  gap: 6px;
}

.account-group-count {
  font-size: 0.72rem;
  color: var(--text-muted);
  white-space: nowrap;
}

.account-card {
  padding: 14px 16px;
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  gap: 12px;
  transition: all 0.2s ease;
}

.account-card--active {
  border-color: rgba(99, 102, 241, 0.45);
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.1) 0%, rgba(18, 19, 27, 0.85) 100%);
  box-shadow: 0 4px 20px rgba(99, 102, 241, 0.18);
}

.account-card__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}

.account-card__identity {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
}

.account-card__avatar {
  width: 38px;
  height: 38px;
  border-radius: var(--radius-full);
  background: linear-gradient(135deg, #6366f1 0%, #06b6d4 100%);
  display: grid;
  place-items: center;
  color: #fff;
  font-weight: 800;
  font-size: 1rem;
  flex-shrink: 0;
  box-shadow: 0 2px 8px rgba(99, 102, 241, 0.35);
}

.account-card__meta {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1;
}

.account-card__name-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.account-card__name {
  font-size: 0.94rem;
  font-weight: 700;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 175px;
}

.account-card__derivation {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 9999px;
  font-size: 0.65rem;
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-secondary);
  border: 1px solid rgba(255, 255, 255, 0.08);
  white-space: nowrap;
  flex-shrink: 0;
}

.account-card__address-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.account-card__address {
  font-family: var(--font-mono);
  font-size: 0.74rem;
  color: var(--text-secondary);
  white-space: nowrap;
}

.account-card__copy-btn {
  padding: 1px 6px;
  font-size: 0.68rem;
  line-height: 1.4;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: var(--text-primary);
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s ease;
}

.account-card__copy-btn:hover {
  background: rgba(255, 255, 255, 0.12);
}

.account-card__status {
  flex-shrink: 0;
}

.account-card__active-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  border-radius: 9999px;
  font-size: 0.72rem;
  font-weight: 600;
  color: #34d399;
  background: rgba(16, 185, 129, 0.12);
  border: 1px solid rgba(16, 185, 129, 0.28);
  white-space: nowrap;
}

.account-card__active-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #34d399;
  box-shadow: 0 0 6px #34d399;
}

.account-card__switch-btn {
  white-space: nowrap;
  font-size: 0.75rem;
  padding: 4px 10px;
}

.account-card__toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.account-card__tool-btn {
  flex: 1;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px 4px;
  font-size: 0.74rem;
  font-weight: 500;
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
  text-align: center;
  transition: all 0.15s ease;
}

.account-card__tool-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-primary);
}

.account-card__tool-btn--danger {
  color: #f87171;
  border-color: rgba(239, 68, 68, 0.25);
  background: rgba(239, 68, 68, 0.06);
}

.account-card__tool-btn--danger:hover {
  background: rgba(239, 68, 68, 0.12);
  color: #fca5a5;
}

.account-card__form {
  margin-top: 10px;
  padding: 12px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: var(--radius-sm);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.account-card__form--danger {
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.25);
}
</style>
