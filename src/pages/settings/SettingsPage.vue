<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { storeToRefs } from "pinia";
import { RouterLink, useRouter } from "vue-router";
import SectionCard from "../../components/SectionCard.vue";
import WalletChrome from "../../components/WalletChrome.vue";
import { getAppOverview } from "../../services/system";
import { useNetworksStore } from "../../stores/networks";
import { useSessionStore } from "../../stores/session";
import { useWalletStore } from "../../stores/wallet";
import type { AppOverview } from "../../types/app";
import { formatDateTime, shortenAddress } from "../../utils/format";

const router = useRouter();
const sessionStore = useSessionStore();
const networksStore = useNetworksStore();
const walletStore = useWalletStore();
const overview = ref<AppOverview | null>(null);
const loadError = ref("");
const securityMessage = ref("");
const isSavingBiometric = ref(false);

const {
  accountCount,
  createdAt,
  hasBackedUpMnemonic,
  isBiometricEnabled,
  lastUnlockedAt,
  primaryAddress,
  shellMode,
  statusLabel,
  walletLabel,
  walletSecretKind,
  walletSource,
} = storeToRefs(sessionStore);
const { activeNetwork } = storeToRefs(networksStore);
const { addressBookCount } = storeToRefs(walletStore);

const backupLabel = computed(() => {
  if (walletSecretKind.value === "privateKey") {
    return "Private key import";
  }

  return hasBackedUpMnemonic.value ? "Backed up" : "Pending backup";
});
const securityTone = computed(() =>
  walletSecretKind.value === "mnemonic" && !hasBackedUpMnemonic.value ? "warning" : "accent",
);
const runtimeLabel = computed(() =>
  shellMode.value === "tauri" ? "Tauri secure runtime" : "Browser preview",
);
const activeNetworkContactCount = computed(() => walletStore.contactsForNetwork(activeNetwork.value.id).length);

onMounted(async () => {
  try {
    overview.value = await getAppOverview();
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : "无法读取运行时概览";
  }
});

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
    eyebrow="Settings"
    title="设置页只保留 MVP 真正会影响使用和安全的项。"
    subtitle="这里聚焦账户状态、安全开关、运行时边界和网络入口，不做一堆噪音配置。"
  >
    <template #actions>
      <RouterLink class="button button--secondary" to="/settings/accounts">账号管理</RouterLink>
      <RouterLink class="button button--secondary" to="/settings/address-book">地址簿</RouterLink>
      <RouterLink class="button button--ghost" to="/settings/networks">网络管理</RouterLink>
      <RouterLink class="button button--ghost" to="/wallet/receive">收款信息</RouterLink>
      <button class="button button--primary" type="button" @click="lockWallet">立即锁定</button>
    </template>

    <section class="status-grid">
      <SectionCard title="Wallet Status" description="当前会话状态" tone="accent">
        <p class="metric-value">{{ statusLabel }}</p>
        <p>{{ walletLabel }}</p>
        <p>Accounts {{ accountCount }}</p>
      </SectionCard>

      <SectionCard title="Runtime" description="当前运行环境">
        <p class="metric-value">{{ shellMode === "tauri" ? "Tauri" : "Preview" }}</p>
        <p>{{ runtimeLabel }}</p>
      </SectionCard>

      <SectionCard title="Backup" description="恢复材料状态" :tone="securityTone">
        <p class="metric-value">{{ walletSecretKind === "mnemonic" ? "Mnemonic" : "Private Key" }}</p>
        <p>{{ backupLabel }}</p>
      </SectionCard>

      <SectionCard title="Active Network" description="当前默认网络">
        <p class="metric-value">{{ activeNetwork.name }}</p>
        <p>Chain ID {{ activeNetwork.chainId }}</p>
      </SectionCard>
    </section>

    <section class="page-grid page-grid--2">
      <SectionCard title="Account Profile" description="账户与恢复来源">
        <div class="key-value-list">
          <div class="key-value-row">
            <span>钱包名称</span>
            <strong>{{ walletLabel }}</strong>
          </div>
          <div class="key-value-row">
            <span>账户地址</span>
            <strong>{{ shortenAddress(primaryAddress) }}</strong>
          </div>
          <div class="key-value-row">
            <span>本地账号数</span>
            <strong>{{ accountCount }}</strong>
          </div>
          <div class="key-value-row">
            <span>创建方式</span>
            <strong>{{ walletSource ?? "N/A" }}</strong>
          </div>
          <div class="key-value-row">
            <span>恢复材料</span>
            <strong>{{ walletSecretKind ?? "N/A" }}</strong>
          </div>
          <div class="key-value-row">
            <span>创建时间</span>
            <strong>{{ formatDateTime(createdAt) }}</strong>
          </div>
          <div class="key-value-row">
            <span>最近解锁</span>
            <strong>{{ formatDateTime(lastUnlockedAt) }}</strong>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Security Controls" description="当前可操作的安全开关" :tone="securityTone">
        <div class="chip-row">
          <span class="status-chip status-chip--accent">{{ statusLabel }}</span>
          <span class="status-chip">{{ runtimeLabel }}</span>
          <span class="status-chip">{{ backupLabel }}</span>
        </div>

        <label class="toggle-row">
          <input
            :checked="isBiometricEnabled"
            :disabled="isSavingBiometric"
            type="checkbox"
            @change="toggleBiometric"
          />
          <span>{{ isSavingBiometric ? "正在更新生物识别入口..." : "显示生物识别解锁入口" }}</span>
        </label>

        <p class="helper-text">
          浏览器预览模式不会提供真实生物识别能力；这里只控制是否展示对应入口。
        </p>
        <p v-if="securityMessage" class="helper-text">{{ securityMessage }}</p>

        <div class="form-actions">
          <button class="button button--primary" type="button" @click="lockWallet">锁定钱包</button>
          <RouterLink class="button button--ghost" to="/wallet">返回资产首页</RouterLink>
        </div>
      </SectionCard>
    </section>

    <section class="page-grid page-grid--2">
      <SectionCard title="Runtime Overview" description="当前应用运行时与存储边界">
        <div class="key-value-list">
          <div class="key-value-row">
            <span>Runtime</span>
            <strong>{{ overview?.runtime ?? runtimeLabel }}</strong>
          </div>
          <div class="key-value-row">
            <span>Security Policy</span>
            <strong>{{ overview?.securityPolicy ?? "Loading..." }}</strong>
          </div>
          <div class="key-value-row">
            <span>Storage Strategy</span>
            <strong>{{ overview?.storageStrategy ?? "Loading..." }}</strong>
          </div>
          <div class="key-value-row">
            <span>App Version</span>
            <strong>{{ overview?.appVersion ?? "N/A" }}</strong>
          </div>
        </div>
        <p v-if="loadError" class="helper-text helper-text--error">{{ loadError }}</p>
      </SectionCard>

      <SectionCard title="Address Book" description="本地联系人管理入口">
        <div class="key-value-list">
          <div class="key-value-row">
            <span>当前网络联系人</span>
            <strong>{{ activeNetworkContactCount }}</strong>
          </div>
          <div class="key-value-row">
            <span>本地联系人总数</span>
            <strong>{{ addressBookCount }}</strong>
          </div>
          <div class="key-value-row">
            <span>存储边界</span>
            <strong>Only local UI state</strong>
          </div>
        </div>
        <p class="helper-text">
          联系人标签和备注只保存在当前设备，不会写入链上或同步到云端。
        </p>
        <div class="form-actions">
          <RouterLink class="button button--secondary" to="/settings/address-book">管理地址簿</RouterLink>
          <RouterLink class="button button--ghost" :to="{ name: 'wallet-send' }">发起转账</RouterLink>
        </div>
      </SectionCard>
    </section>

    <section class="page-grid page-grid--1">
      <SectionCard title="Quick Access" description="MVP 中最常用的设置相关入口">
        <div class="card-stack">
          <RouterLink class="button button--secondary" to="/settings/accounts">管理账号</RouterLink>
          <RouterLink class="button button--secondary" to="/settings/networks">管理网络</RouterLink>
          <RouterLink class="button button--ghost" to="/settings/address-book">管理地址簿</RouterLink>
          <RouterLink class="button button--ghost" to="/wallet/send">发起转账</RouterLink>
          <RouterLink class="button button--ghost" to="/wallet/token/add">手动添加 Token</RouterLink>
        </div>
      </SectionCard>
    </section>
  </WalletChrome>
</template>
