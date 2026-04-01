<script setup lang="ts">
import { storeToRefs } from "pinia";
import SectionCard from "../../components/SectionCard.vue";
import WalletChrome from "../../components/WalletChrome.vue";
import { useNetworksStore } from "../../stores/networks";
import { useSessionStore } from "../../stores/session";

const sessionStore = useSessionStore();
const networksStore = useNetworksStore();

const { primaryAddress } = storeToRefs(sessionStore);
const { activeNetwork } = storeToRefs(networksStore);
</script>

<template>
  <WalletChrome
    eyebrow="Receive"
    title="收款页先保持干净，只给地址和网络。"
    subtitle="MVP 不做复杂的收款模板，地址和网络信息必须清晰，避免用户转错链。"
  >
    <section class="page-grid page-grid--2">
      <SectionCard title="Address" description="当前账户收款地址">
        <p class="address-block">{{ primaryAddress }}</p>
      </SectionCard>

      <SectionCard title="Network" description="请确认对方转入的网络一致">
        <p class="metric-value">{{ activeNetwork.name }}</p>
        <p>Native Symbol: {{ activeNetwork.symbol }}</p>
      </SectionCard>
    </section>
  </WalletChrome>
</template>

