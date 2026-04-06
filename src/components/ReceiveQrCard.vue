<script setup lang="ts">
import { computed, ref, watch } from "vue";
import SectionCard from "./SectionCard.vue";
import { buildReceiveQrPayload, buildReceiveQrSvg } from "../utils/receive";
import type { WalletAddress } from "../types/wallet";

const props = defineProps<{
  address: WalletAddress | "";
  chainId: number | string;
  networkName: string;
}>();

const qrSvgMarkup = ref("");
const qrError = ref("");
let latestRenderId = 0;

const receivePayload = computed(() => {
  if (!props.address) {
    return "";
  }

  return buildReceiveQrPayload(props.address, props.chainId);
});

watch(
  receivePayload,
  async (nextPayload) => {
    latestRenderId += 1;
    const renderId = latestRenderId;

    qrSvgMarkup.value = "";
    qrError.value = "";

    if (!nextPayload) {
      qrError.value = "当前缺少可生成二维码的地址。";
      return;
    }

    try {
      const nextMarkup = await buildReceiveQrSvg(nextPayload);

      if (renderId !== latestRenderId) {
        return;
      }

      qrSvgMarkup.value = nextMarkup;
    } catch {
      if (renderId !== latestRenderId) {
        return;
      }

      qrError.value = "二维码生成失败，请先复制地址进行收款。";
    }
  },
  {
    immediate: true,
  },
);
</script>

<template>
  <SectionCard title="Receive QR" description="扫码内容会绑定当前地址与 Chain ID" tone="accent">
    <div v-if="qrSvgMarkup" class="receive-qr-card">
      <div class="receive-qr-card__frame" v-html="qrSvgMarkup"></div>
      <div class="chip-row">
        <span class="status-chip status-chip--accent">{{ networkName }}</span>
        <span class="status-chip">Chain {{ chainId }}</span>
      </div>
      <p class="helper-text">
        当前二维码内容：`{{ receivePayload }}`。对方扫码后仍应确认网络与地址。
      </p>
    </div>
    <p v-else-if="qrError" class="helper-text helper-text--error">{{ qrError }}</p>
  </SectionCard>
</template>
