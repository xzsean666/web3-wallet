<script setup lang="ts">
import { computed, ref } from "vue";
import { storeToRefs } from "pinia";
import { RouterLink, useRouter } from "vue-router";
import SectionCard from "../../components/SectionCard.vue";
import WalletChrome from "../../components/WalletChrome.vue";
import { deriveMnemonicAccount } from "../../services/walletBridge";
import { useSessionStore } from "../../stores/session";
import { formatDateTime, shortenAddress } from "../../utils/format";

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

const accounts = computed(() =>
  [...walletProfiles.value].sort((left, right) => {
    if (left.accountId === activeAccountId.value) {
      return -1;
    }

    if (right.accountId === activeAccountId.value) {
      return 1;
    }

    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  }),
);

function sourceLabel(value: "created" | "imported") {
  return value === "created" ? "创建" : "导入";
}

function secretKindLabel(value: "mnemonic" | "privateKey") {
  return value === "mnemonic" ? "助记词" : "私钥";
}

function derivationLabel(index: number) {
  return index === 0 ? "Root" : `Path #${index}`;
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

function openDeriveForm(account: (typeof accounts.value)[number]) {
  deriveTargetAccountId.value = account.accountId;
  deriveLabel.value = `${account.walletLabel} / ${account.derivationIndex + 1}`;
  derivePassword.value = "";
  deriveFeedback.value = "";
}

function cancelDeriveForm() {
  deriveTargetAccountId.value = null;
  deriveLabel.value = "";
  derivePassword.value = "";
  deriveFeedback.value = "";
}

async function submitDerive(account: (typeof accounts.value)[number]) {
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

      <SectionCard title="Active" description="当前正在使用的账号">
        <p class="metric-value">
          {{ accounts[0]?.walletLabel ?? "N/A" }}
        </p>
        <p>{{ accounts[0] ? shortenAddress(accounts[0].address) : "N/A" }}</p>
      </SectionCard>

      <SectionCard title="Create" description="新增一个全新账号">
        <p class="metric-value">Mnemonic</p>
        <p>生成 12 词并备份</p>
      </SectionCard>

      <SectionCard title="Import" description="导入现有账号">
        <p class="metric-value">Mnemonic / PK</p>
        <p>支持助记词与私钥</p>
      </SectionCard>
    </section>

    <section class="page-grid page-grid--1">
      <SectionCard title="Account List" description="当前设备上的全部账号">
        <div class="network-list">
          <article
            v-for="account in accounts"
            :key="account.accountId"
            :class="['network-item', account.accountId === activeAccountId ? 'network-item--active' : '']"
          >
            <div class="network-item__body">
              <div class="chip-row">
                <span class="status-chip status-chip--accent">{{ account.walletLabel }}</span>
                <span class="status-chip">{{ sourceLabel(account.source) }}</span>
                <span class="status-chip">{{ secretKindLabel(account.secretKind) }}</span>
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
                将从当前助记词继续派生下一个地址索引 `{{ account.derivationIndex + 1 }}`。
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
          </article>
        </div>

        <p v-if="switchFeedback" class="helper-text helper-text--error">{{ switchFeedback }}</p>
      </SectionCard>
    </section>
  </WalletChrome>
</template>
