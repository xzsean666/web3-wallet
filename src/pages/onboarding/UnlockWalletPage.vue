<script setup lang="ts">
import { computed, ref } from "vue";
import { storeToRefs } from "pinia";
import { useRouter } from "vue-router";
import SectionCard from "../../components/SectionCard.vue";
import { useSessionStore } from "../../stores/session";
import { formatDateTime, shortenAddress } from "../../utils/format";

const router = useRouter();
const sessionStore = useSessionStore();
const { activeAccountId, isBiometricEnabled, primaryAddress, statusLabel, walletLabel, walletProfiles } =
  storeToRefs(sessionStore);
const password = ref("");
const formError = ref("");
const isSubmitting = ref(false);
const isSelectingAccountId = ref<string | null>(null);

const activeProfile = computed(
  () => walletProfiles.value.find((profile) => profile.accountId === activeAccountId.value) ?? walletProfiles.value[0] ?? null,
);

async function selectAccount(accountId: string) {
  if (accountId === activeAccountId.value) {
    return;
  }

  formError.value = "";
  password.value = "";
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
        <h1>每次进入钱包前，都先过这一道本地解锁门。</h1>
        <p class="subtitle">
          当前密码解锁已经接入本地钱包资料校验。多账号模式下请先选中要进入的账号，
          再输入对应账号的本地解锁密码。
        </p>
      </div>
      <SectionCard title="Wallet" description="当前待解锁账号">
        <ul class="bullet-list">
          <li>{{ walletLabel }}</li>
          <li>{{ shortenAddress(primaryAddress) }}</li>
          <li>{{ statusLabel }}</li>
        </ul>
      </SectionCard>
    </section>

    <section class="page-grid page-grid--2">
      <SectionCard title="Accounts" description="选择要解锁的本地账号">
        <div class="network-list">
          <article
            v-for="account in walletProfiles"
            :key="account.accountId"
            :class="['network-item', account.accountId === activeAccountId ? 'network-item--active' : '']"
          >
            <div class="network-item__body">
              <strong>{{ account.walletLabel }}</strong>
              <p>{{ account.address }}</p>
              <p>最近解锁：{{ formatDateTime(account.lastUnlockedAt) }}</p>
            </div>
            <div class="network-item__meta">
              <span class="status-chip">{{ shortenAddress(account.address) }}</span>
              <button
                v-if="account.accountId !== activeAccountId"
                class="button button--ghost button--small"
                type="button"
                :disabled="isSelectingAccountId === account.accountId"
                @click="selectAccount(account.accountId)"
              >
                {{ isSelectingAccountId === account.accountId ? "切换中..." : "解锁这个账号" }}
              </button>
              <span v-else class="status-chip status-chip--accent">当前目标</span>
            </div>
          </article>
        </div>
      </SectionCard>

      <SectionCard title="Password" description="输入你创建或导入时设置的钱包密码">
        <form class="form-grid" @submit.prevent="unlockWallet">
          <p class="helper-text">
            当前账号：{{ activeProfile?.walletLabel ?? "N/A" }} · {{ shortenAddress(primaryAddress) }}
          </p>
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

      <SectionCard title="Biometric" description="当前展示的是入口状态，不承诺平台能力">
        <p>
          生物识别开关当前状态：
          <strong>{{ isBiometricEnabled ? "Enabled" : "Disabled" }}</strong>
        </p>
      </SectionCard>
    </section>
  </main>
</template>
