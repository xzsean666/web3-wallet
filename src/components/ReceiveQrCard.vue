<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { buildReceiveQrPayload, buildReceiveQrSvg } from "../utils/receive";
import type { WalletAddress } from "../types/wallet";

const props = defineProps<{
  address: WalletAddress | "";
  chainId: number | string;
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
  <div v-if="qrSvgMarkup" class="receive-qr-card">
    <div class="receive-qr-card__frame" v-html="qrSvgMarkup"></div>
  </div>
  <p v-else-if="qrError" class="helper-text helper-text--error">{{ qrError }}</p>
</template>
