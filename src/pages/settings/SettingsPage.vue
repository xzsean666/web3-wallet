<script setup lang="ts">
import { storeToRefs } from "pinia";
import { useRouter } from "vue-router";
import SectionCard from "../../components/SectionCard.vue";
import WalletChrome from "../../components/WalletChrome.vue";
import { useSessionStore } from "../../stores/session";
import { shortenAddress } from "../../utils/format";

const router = useRouter();
const sessionStore = useSessionStore();

const {
  createdAt,
  hasBackedUpMnemonic,
  isBiometricEnabled,
  lastUnlockedAt,
  primaryAddress,
  walletLabel,
  walletSource,
} = storeToRefs(sessionStore);

async function lockWallet() {
  sessionStore.lockWallet();
  await router.push("/unlock");
}

async function toggleBiometric(event: Event) {
  const target = event.target as HTMLInputElement;
  await sessionStore.setBiometricEnabled(target.checked);
}
</script>

<template>
  <WalletChrome
    eyebrow="Settings"
    title="设置页只留必要项，不做 MetaMask 那种大杂烩。"
    subtitle="MVP 阶段设置页只关心账户摘要、锁定状态和网络入口，不会堆太多非关键配置。"
  >
    <section class="page-grid page-grid--2">
      <SectionCard title="Account Summary" description="当前账户元数据">
        <ul class="bullet-list">
          <li>{{ walletLabel }}</li>
          <li>{{ shortenAddress(primaryAddress) }}</li>
          <li>Source: {{ walletSource }}</li>
          <li>Created: {{ createdAt ?? "N/A" }}</li>
          <li>Last Unlock: {{ lastUnlockedAt ?? "N/A" }}</li>
        </ul>
      </SectionCard>

      <SectionCard title="Security" description="Milestone 1 先做基础开关">
        <label class="toggle-row">
          <input
            :checked="isBiometricEnabled"
            type="checkbox"
            @change="toggleBiometric"
          />
          <span>显示生物识别解锁入口</span>
        </label>
        <p>助记词备份确认：{{ hasBackedUpMnemonic ? "Yes" : "No" }}</p>
        <div class="form-actions">
          <button class="button button--primary" type="button" @click="lockWallet">
            立即锁定
          </button>
        </div>
      </SectionCard>
    </section>

    <section class="page-grid page-grid--2">
      <SectionCard title="Network Entry" description="网络管理入口">
        <RouterLink class="button button--secondary" to="/settings/networks">
          打开网络管理
        </RouterLink>
      </SectionCard>

      <SectionCard title="Next Milestone" description="后续设置项">
        <ul class="bullet-list">
          <li>自动锁屏时间</li>
          <li>默认网络与默认账户</li>
          <li>安全导出与恢复流程</li>
        </ul>
      </SectionCard>
    </section>
  </WalletChrome>
</template>
