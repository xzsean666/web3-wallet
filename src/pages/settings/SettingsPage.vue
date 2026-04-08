<script setup lang="ts">
import { computed, ref } from "vue";
import { storeToRefs } from "pinia";
import { RouterLink, useRouter } from "vue-router";
import SectionCard from "../../components/SectionCard.vue";
import WalletChrome from "../../components/WalletChrome.vue";
import { useNetworksStore } from "../../stores/networks";
import { useSessionStore } from "../../stores/session";
import { shortenAddress } from "../../utils/format";

const router = useRouter();
const sessionStore = useSessionStore();
const networksStore = useNetworksStore();
const securityMessage = ref("");
const isSavingBiometric = ref(false);

const {
  hasBackedUpMnemonic,
  isBiometricEnabled,
  primaryAddress,
  statusLabel,
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
    securityMessage.value = updated ? "生物识别入口状态已更新" : "当前运行时无法更新生物识别状态";
  } finally {
    isSavingBiometric.value = false;
  }
}
</script>

<template>
  <WalletChrome
    :show-hero="false"
    :show-nav="false"
  >
    <section class="page-grid page-grid--1">
      <SectionCard title="设置">
        <template #header>
          <div class="section-card__actions">
            <RouterLink class="button button--ghost button--small" to="/wallet">
              返回
            </RouterLink>
          </div>
        </template>

        <div class="key-value-list">
          <div class="key-value-row">
            <span>钱包</span>
            <strong>{{ walletLabel || "当前钱包" }}</strong>
          </div>
          <div class="key-value-row">
            <span>地址</span>
            <strong>{{ shortenAddress(primaryAddress) }}</strong>
          </div>
          <div class="key-value-row">
            <span>网络</span>
            <strong>{{ activeNetwork.name }}</strong>
          </div>
          <div class="key-value-row">
            <span>状态</span>
            <strong>{{ statusLabel }}</strong>
          </div>
          <div class="key-value-row">
            <span>备份</span>
            <strong>{{ backupLabel }}</strong>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="入口">
        <div class="quick-link-grid">
          <RouterLink class="button button--secondary" to="/settings/accounts">账号</RouterLink>
          <RouterLink class="button button--secondary" to="/settings/networks">网络</RouterLink>
          <RouterLink class="button button--secondary" to="/settings/address-book">地址簿</RouterLink>
          <RouterLink class="button button--secondary" to="/wallet/receive">收款</RouterLink>
          <RouterLink class="button button--ghost" to="/wallet/token/add">添加代币</RouterLink>
        </div>
      </SectionCard>

      <SectionCard title="安全" :tone="securityTone">
        <label class="toggle-row">
          <input
            :checked="isBiometricEnabled"
            :disabled="isSavingBiometric"
            type="checkbox"
            @change="toggleBiometric"
          />
          <span>{{ isSavingBiometric ? "更新中..." : "显示生物识别入口" }}</span>
        </label>

        <p v-if="securityMessage" class="helper-text">{{ securityMessage }}</p>

        <div class="form-actions">
          <button class="button button--primary" type="button" @click="lockWallet">锁定钱包</button>
          <RouterLink class="button button--ghost" to="/wallet/send">去发送</RouterLink>
        </div>
      </SectionCard>
    </section>
  </WalletChrome>
</template>
