<script setup lang="ts">
import { computed, ref } from "vue";
import { storeToRefs } from "pinia";
import { RouterLink, useRouter } from "vue-router";
import SectionCard from "../../components/SectionCard.vue";
import WalletChrome from "../../components/WalletChrome.vue";
import { deriveMnemonicAccount } from "../../services/walletBridge";
import { useSessionStore } from "../../stores/session";
import { formatDateTime, shortenAddress } from "../../utils/format";
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
type AccountEntry = (typeof walletProfiles.value)[number];

const activeAccount = computed(
  () => walletProfiles.value.find((entry) => entry.accountId === activeAccountId.value) ?? walletProfiles.value[0] ?? null,
);
const accountGroups = computed(() => groupWalletProfiles(walletProfiles.value, activeAccountId.value));

function sourceLabel(value: "created" | "imported") {
  return value === "created" ? "创建" : "导入";
}

function secretKindLabel(value: "mnemonic" | "privateKey") {
  return value === "mnemonic" ? "助记词" : "私钥";
}

function derivationLabel(index: number) {
  return index === 0 ? "Root" : `Path #${index}`;
}

function groupTypeLabel(group: (typeof accountGroups.value)[number]) {
  if (group.secretKind === "privateKey") {
    return "独立私钥账号";
  }

  return group.accountCount > 1 ? "助记词派生组" : "单地址助记词组";
}

function groupSummary(group: (typeof accountGroups.value)[number]) {
  if (group.secretKind === "privateKey") {
    return "当前组只有一个独立导入账号。";
  }

  return `当前组共 ${group.accountCount} 个地址档案，下一派生索引 ${group.nextDerivationIndex ?? 1}。`;
}

function nextDerivationIndex(account: (typeof walletProfiles.value)[number]) {
  return getNextMnemonicDerivationIndex(walletProfiles.value, account);
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
    const updated = await sessionStore.renameWalletAccount(account.accountId, renameLabel.value.trim());

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
    eyebrow="Accounts"
    title="多账号先收敛到本地管理，不做云同步或扩展账户体系。"
    subtitle="这里管理当前设备上的账号档案。新增账号支持创建、助记词导入和私钥导入，切换账号后会重新走解锁。"
  >
    <template #actions>
      <RouterLink class="button button--primary" to="/settings/accounts/create">创建账号</RouterLink>
      <RouterLink class="button button--secondary" to="/settings/accounts/import">导入账号</RouterLink>
      <RouterLink class="button button--ghost" to="/settings">返回设置</RouterLink>
    </template>

    <section class="status-grid">
      <SectionCard title="Accounts" description="当前本地账号数量" tone="accent">
        <p class="metric-value">{{ walletProfiles.length }}</p>
        <p>All local profiles</p>
      </SectionCard>

      <SectionCard title="Groups" description="按恢复材料划分的账号组">
        <p class="metric-value">{{ accountGroups.length }}</p>
        <p>Recovery groups</p>
      </SectionCard>

      <SectionCard title="Active" description="当前正在使用的账号">
        <p class="metric-value">
          {{ activeAccount?.walletLabel ?? "N/A" }}
        </p>
        <p>{{ activeAccount ? shortenAddress(activeAccount.address) : "N/A" }}</p>
      </SectionCard>

      <SectionCard title="Mnemonic Groups" description="可继续派生新地址的账号组">
        <p class="metric-value">{{ accountGroups.filter((group) => group.secretKind === "mnemonic").length }}</p>
        <p>Derivable groups</p>
      </SectionCard>
    </section>

    <section class="page-grid page-grid--1">
      <SectionCard title="Account Groups" description="按恢复材料归拢后的账号结构">
        <div class="account-group-list">
          <section
            v-for="group in accountGroups"
            :key="group.id"
            :class="['account-group', group.containsActiveAccount ? 'account-group--active' : '']"
          >
            <div class="account-group__header">
              <div class="account-group__summary">
                <p class="eyebrow account-group__eyebrow">{{ groupTypeLabel(group) }}</p>
                <h3 class="account-group__title">{{ group.primaryAccount.walletLabel }}</h3>
                <p class="helper-text">
                  主地址：{{ shortenAddress(group.primaryAccount.address) }} · {{ groupSummary(group) }}
                </p>
              </div>
              <div class="chip-row">
                <span class="status-chip status-chip--accent">{{ secretKindLabel(group.secretKind) }}</span>
                <span class="status-chip">{{ sourceLabel(group.source) }}</span>
                <span class="status-chip">{{ group.accountCount }} 个账号</span>
                <span v-if="group.nextDerivationIndex !== null" class="status-chip">
                  Next #{{ group.nextDerivationIndex }}
                </span>
                <span v-if="group.containsActiveAccount" class="status-chip status-chip--accent">当前账号组</span>
              </div>
            </div>

            <div class="network-list">
              <article
                v-for="account in group.accounts"
                :key="account.accountId"
                :class="['network-item', account.accountId === activeAccountId ? 'network-item--active' : '']"
              >
                <div class="network-item__body">
                  <div class="chip-row">
                    <span class="status-chip status-chip--accent">{{ account.walletLabel }}</span>
                    <span class="status-chip">{{ derivationLabel(account.derivationIndex) }}</span>
                    <span
                      :class="[
                        'status-chip',
                        account.accountId === activeAccountId ? 'status-chip--accent' : '',
                      ]"
                    >
                      {{ account.accountId === activeAccountId ? "当前账号" : "可切换" }}
                    </span>
                  </div>
                  <p>{{ account.address }}</p>
                  <div class="key-value-list">
                    <div class="key-value-row">
                      <span>创建时间</span>
                      <strong>{{ formatDateTime(account.createdAt) }}</strong>
                    </div>
                    <div class="key-value-row">
                      <span>派生索引</span>
                      <strong>{{ account.derivationIndex }}</strong>
                    </div>
                    <div class="key-value-row">
                      <span>最近解锁</span>
                      <strong>{{ formatDateTime(account.lastUnlockedAt) }}</strong>
                    </div>
                  </div>
                </div>

                <div class="network-item__meta">
                  <strong>{{ shortenAddress(account.address) }}</strong>
                  <div class="form-actions form-actions--compact">
                    <button
                      v-if="account.accountId !== activeAccountId"
                      class="button button--secondary button--small"
                      type="button"
                      :disabled="isSwitchingAccountId === account.accountId"
                      @click="switchAccount(account.accountId)"
                    >
                      {{ isSwitchingAccountId === account.accountId ? "切换中..." : "切换并解锁" }}
                    </button>
                    <RouterLink
                      v-else
                      class="button button--ghost button--small"
                      to="/wallet"
                    >
                      返回当前账号
                    </RouterLink>
                    <button
                      v-if="account.secretKind === 'mnemonic'"
                      class="button button--ghost button--small"
                      type="button"
                      @click="deriveTargetAccountId === account.accountId ? cancelDeriveForm() : openDeriveForm(account)"
                    >
                      {{ deriveTargetAccountId === account.accountId ? "取消派生" : "派生新地址" }}
                    </button>
                    <button
                      class="button button--ghost button--small"
                      type="button"
                      @click="renameTargetAccountId === account.accountId ? cancelRenameForm() : openRenameForm(account)"
                    >
                      {{ renameTargetAccountId === account.accountId ? "取消重命名" : "重命名" }}
                    </button>
                    <button
                      class="button button--danger button--small"
                      type="button"
                      @click="deleteTargetAccountId === account.accountId ? cancelDeleteForm() : openDeleteForm(account)"
                    >
                      {{ deleteTargetAccountId === account.accountId ? "取消删除" : "删除账号" }}
                    </button>
                  </div>
                </div>

                <div v-if="deriveTargetAccountId === account.accountId" class="form-grid">
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
                  <p class="helper-text">
                    将从当前助记词继续派生下一个地址索引 `{{ nextDerivationIndex(account) }}`。
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

                <div v-if="renameTargetAccountId === account.accountId" class="form-grid">
                  <label class="field">
                    <span>账号名称</span>
                    <input v-model="renameLabel" autocomplete="off" placeholder="输入新的账号名称" />
                  </label>
                  <p class="helper-text">
                    只会更新当前设备上的本地账号名称，不影响地址、派生关系和链上资产。
                  </p>
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

                <div v-if="deleteTargetAccountId === account.accountId" class="form-grid">
                  <p class="helper-text helper-text--error">
                    删除后，这个账号会从当前设备移除；如果它已经是该恢复材料组最后一个账号，对应本地 secret snapshot 也会一起清理。
                  </p>
                  <p class="helper-text">
                    输入账号名称 `{{ account.walletLabel }}` 以确认删除。
                    <span v-if="account.accountId === activeAccountId">如果删除当前账号，剩余账号需要重新解锁。</span>
                    <span v-else>删除其他账号不会影响当前已解锁状态。</span>
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
          </section>
        </div>

        <p v-if="switchFeedback" class="helper-text helper-text--error">{{ switchFeedback }}</p>
      </SectionCard>
    </section>
  </WalletChrome>
</template>
