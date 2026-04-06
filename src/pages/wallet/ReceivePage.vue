<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { storeToRefs } from "pinia";
import { RouterLink } from "vue-router";
import ReceiveQrCard from "../../components/ReceiveQrCard.vue";
import SectionCard from "../../components/SectionCard.vue";
import WalletChrome from "../../components/WalletChrome.vue";
import { useNetworksStore } from "../../stores/networks";
import { useSessionStore } from "../../stores/session";
import { shortenAddress } from "../../utils/format";

const sessionStore = useSessionStore();
const networksStore = useNetworksStore();

const { primaryAddress } = storeToRefs(sessionStore);
const { activeNetwork } = storeToRefs(networksStore);

const copyState = ref<"idle" | "success" | "error">("idle");
let copyStateTimer: number | null = null;

const addressExplorerUrl = computed(() => {
  if (!primaryAddress.value || !activeNetwork.value.explorerUrl) {
    return null;
  }

  return `${activeNetwork.value.explorerUrl.replace(/\/$/, "")}/address/${primaryAddress.value}`;
});

function resetCopyState() {
  if (copyStateTimer) {
    window.clearTimeout(copyStateTimer);
    copyStateTimer = null;
  }

  copyState.value = "idle";
}

async function copyAddress() {
  if (!primaryAddress.value) {
    copyState.value = "error";
    return;
  }

  try {
    await navigator.clipboard.writeText(primaryAddress.value);
    copyState.value = "success";
  } catch {
    copyState.value = "error";
  }

  if (copyStateTimer) {
    window.clearTimeout(copyStateTimer);
  }

  copyStateTimer = window.setTimeout(() => {
    copyState.value = "idle";
    copyStateTimer = null;
  }, 2200);
}

onBeforeUnmount(resetCopyState);
</script>

<template>
  <WalletChrome
    eyebrow="Receive"
    title="收款页已经补到可以直接发给别人。"
    subtitle="当前优先保证地址、网络和复制动作都清晰可确认，避免对方转错链或复制失败。"
  >
    <template #actions>
      <button class="button button--primary" type="button" @click="copyAddress">复制地址</button>
      <RouterLink class="button button--secondary" to="/wallet">返回资产首页</RouterLink>
    </template>

    <section class="page-grid page-grid--2">
      <ReceiveQrCard
        :address="primaryAddress"
        :chain-id="activeNetwork.chainId"
        :network-name="activeNetwork.name"
      />

      <SectionCard title="Address" description="当前账户收款地址">
        <div class="chip-row">
          <span class="status-chip status-chip--accent">{{ activeNetwork.name }}</span>
          <span class="status-chip">{{ shortenAddress(primaryAddress) }}</span>
          <span v-if="copyState === 'success'" class="status-chip status-chip--accent">已复制</span>
          <span v-else-if="copyState === 'error'" class="status-chip status-chip--danger">复制失败</span>
        </div>
        <p class="address-block">{{ primaryAddress }}</p>
        <div class="form-actions">
          <button class="button button--primary" type="button" @click="copyAddress">复制完整地址</button>
          <a
            v-if="addressExplorerUrl"
            class="button button--ghost"
            :href="addressExplorerUrl"
            rel="noreferrer"
            target="_blank"
          >
            打开区块浏览器
          </a>
        </div>
        <p v-if="copyState === 'success'" class="helper-text">地址已写入剪贴板，可以直接发给对方。</p>
        <p v-else-if="copyState === 'error'" class="helper-text helper-text--error">
          当前环境无法完成复制，请手动复制地址。
        </p>
      </SectionCard>
    </section>

    <section class="page-grid page-grid--2">
      <SectionCard title="Network" description="请确认对方转入的网络一致">
        <p class="metric-value">{{ activeNetwork.name }}</p>
        <div class="key-value-list">
          <div class="key-value-row">
            <span>Chain ID</span>
            <strong>{{ activeNetwork.chainId }}</strong>
          </div>
          <div class="key-value-row">
            <span>Native Symbol</span>
            <strong>{{ activeNetwork.symbol }}</strong>
          </div>
          <div class="key-value-row">
            <span>Explorer</span>
            <strong>{{ activeNetwork.explorerUrl ? "Available" : "Unavailable" }}</strong>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Share Summary" description="可直接给对方确认的最小信息">
        <div class="key-value-list">
          <div class="key-value-row">
            <span>地址简称</span>
            <strong>{{ shortenAddress(primaryAddress) }}</strong>
          </div>
          <div class="key-value-row">
            <span>网络</span>
            <strong>{{ activeNetwork.name }}</strong>
          </div>
          <div class="key-value-row">
            <span>原生币</span>
            <strong>{{ activeNetwork.symbol }}</strong>
          </div>
        </div>
        <div class="form-actions">
          <RouterLink class="button button--ghost" to="/settings/networks">查看网络设置</RouterLink>
          <RouterLink class="button button--secondary" to="/wallet/send">去发送页</RouterLink>
        </div>
      </SectionCard>
    </section>

    <section class="page-grid page-grid--1">
      <SectionCard title="Receive Checklist" description="发地址前先确认这几项">
        <ul class="bullet-list">
          <li>只让对方转入当前显示的 {{ activeNetwork.name }} 网络</li>
          <li>优先让对方扫码当前二维码，再让对方口头复核地址后四位</li>
          <li>当前 MVP 只重点覆盖 Native Token 与 ERC20 资产</li>
          <li>大额转账前先用小额测试，确认链路和地址都正确</li>
        </ul>
      </SectionCard>
    </section>
  </WalletChrome>
</template>
