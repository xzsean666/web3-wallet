<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { RouterLink, useRouter } from "vue-router";
import { isAddress } from "viem";
import SectionCard from "../../components/SectionCard.vue";
import WalletChrome from "../../components/WalletChrome.vue";
import { readErc20TokenMetadata } from "../../services/evm";
import { useNetworksStore } from "../../stores/networks";
import { useWalletStore } from "../../stores/wallet";

const router = useRouter();
const networksStore = useNetworksStore();
const walletStore = useWalletStore();

const { activeNetwork } = storeToRefs(networksStore);

const name = ref("");
const symbol = ref("");
const decimals = ref("18");
const contractAddress = ref("");
const formErrors = ref<string[]>([]);
const metadataLookupError = ref("");
const metadataLookupMessage = ref("");
const isReadingMetadata = ref(false);
const validatedMetadataKey = ref("");
const verifiedMetadata = ref<null | {
  key: string;
  name: string;
  symbol: string;
  decimals: number;
}>(null);
let metadataLookupRequestId = 0;

const canReadMetadata = computed(() => isAddress(contractAddress.value.trim()));
const currentMetadataKey = computed(() =>
  canReadMetadata.value ? `${activeNetwork.value.id}:${contractAddress.value.trim().toLowerCase()}` : "",
);
let autoLookupTimer: number | null = null;

watch([contractAddress, activeNetwork], ([newAddress]) => {
  metadataLookupRequestId += 1;
  validatedMetadataKey.value = "";
  verifiedMetadata.value = null;
  metadataLookupError.value = "";
  metadataLookupMessage.value = "";

  if (autoLookupTimer) {
    window.clearTimeout(autoLookupTimer);
    autoLookupTimer = null;
  }

  const trimmed = typeof newAddress === "string" ? newAddress.trim() : "";
  if (isAddress(trimmed)) {
    autoLookupTimer = window.setTimeout(() => {
      void readMetadataFromContract();
    }, 450);
  }
});

onBeforeUnmount(() => {
  if (autoLookupTimer) {
    window.clearTimeout(autoLookupTimer);
    autoLookupTimer = null;
  }
});

async function readMetadataFromContract() {
  formErrors.value = [];
  metadataLookupError.value = "";
  metadataLookupMessage.value = "";

  const normalizedAddress = contractAddress.value.trim();

  if (!isAddress(normalizedAddress)) {
    metadataLookupError.value = "请先输入合法的 ERC20 合约地址";
    return;
  }

  isReadingMetadata.value = true;
  const requestId = ++metadataLookupRequestId;
  const requestNetwork = activeNetwork.value;
  const requestAddress = normalizedAddress;
  const requestMetadataKey = `${requestNetwork.id}:${requestAddress.toLowerCase()}`;
  validatedMetadataKey.value = "";

  try {
    const metadata = await readErc20TokenMetadata({
      network: requestNetwork,
      contractAddress: normalizedAddress,
      trackedTokens: walletStore.tokensForNetwork(requestNetwork.id),
    });

    if (
      requestId !== metadataLookupRequestId ||
      activeNetwork.value.id !== requestNetwork.id ||
      contractAddress.value.trim().toLowerCase() !== requestAddress.toLowerCase()
    ) {
      return;
    }

    name.value = metadata.name;
    symbol.value = metadata.symbol;
    decimals.value = String(metadata.decimals);
    validatedMetadataKey.value = requestMetadataKey;
    verifiedMetadata.value = {
      key: requestMetadataKey,
      name: metadata.name,
      symbol: metadata.symbol,
      decimals: metadata.decimals,
    };
    metadataLookupMessage.value = "已从当前网络的合约读取 Token 元数据，名称和 Symbol 会按链上结果保存。";
    return true;
  } catch (error) {
    if (
      requestId !== metadataLookupRequestId ||
      activeNetwork.value.id !== requestNetwork.id ||
      contractAddress.value.trim().toLowerCase() !== requestAddress.toLowerCase()
    ) {
      return;
    }

    metadataLookupError.value =
      error instanceof Error ? error.message : "当前无法从合约读取 ERC20 元数据";
    return false;
  } finally {
    if (requestId === metadataLookupRequestId) {
      isReadingMetadata.value = false;
    }
  }
}

async function addToken() {
  if (validatedMetadataKey.value !== currentMetadataKey.value) {
    const didValidate = await readMetadataFromContract();

    if (!didValidate) {
      formErrors.value = ["保存前必须先通过 ERC20 合约元数据校验。"];
      return;
    }
  }

  if (!verifiedMetadata.value || verifiedMetadata.value.key !== currentMetadataKey.value) {
    formErrors.value = ["当前缺少可信的 ERC20 元数据，请重新读取链上元数据。"];
    return;
  }

  const result = walletStore.addCustomToken({
    networkId: activeNetwork.value.id,
    name: verifiedMetadata.value.name,
    symbol: verifiedMetadata.value.symbol,
    decimals: String(verifiedMetadata.value.decimals),
    contractAddress: contractAddress.value,
  });

  if (!result.ok) {
    formErrors.value = result.errors;
    return;
  }

  formErrors.value = [];
  await router.replace("/wallet");
}
</script>

<template>
  <WalletChrome
    eyebrow="自定义代币"
    title="添加代币"
    subtitle="输入 ERC20 合约地址，自动读取链上代币元数据并添加至当前网络。"
    :show-hero="true"
    :show-nav="false"
  >
    <section class="page-grid page-grid--1">
      <SectionCard title="代币信息">
        <form class="form-grid" @submit.prevent="addToken">
          <label class="field">
            <span>当前网络</span>
            <input :value="activeNetwork.name" disabled />
          </label>

          <label class="field">
            <span>合约地址</span>
            <input v-model="contractAddress" placeholder="0x..." />
          </label>

          <div class="form-actions">
            <button
              class="button button--secondary button--small"
              type="button"
              :disabled="isReadingMetadata || !canReadMetadata"
              @click="readMetadataFromContract"
            >
              {{ isReadingMetadata ? "读取中..." : "读取合约元数据" }}
            </button>
          </div>

          <label class="field">
            <span>代币名称</span>
            <input v-model="name" placeholder="USD Coin" readonly />
          </label>

          <label class="field">
            <span>代币符号 (Symbol)</span>
            <input v-model="symbol" maxlength="10" placeholder="USDC" readonly />
          </label>

          <label class="field">
            <span>精度 (Decimals)</span>
            <input
              v-model="decimals"
              inputmode="numeric"
              placeholder="18"
              readonly
            />
          </label>

          <p v-if="metadataLookupMessage" class="helper-text helper-text--success">{{ metadataLookupMessage }}</p>
          <p v-if="metadataLookupError" class="helper-text helper-text--error">
            {{ metadataLookupError }}
          </p>

          <ul v-if="formErrors.length" class="bullet-list helper-text helper-text--error">
            <li v-for="error in formErrors" :key="error">{{ error }}</li>
          </ul>

          <div class="form-actions" style="margin-top: 8px;">
            <button class="button button--primary" type="submit" :disabled="!name || !symbol">添加代币</button>
            <RouterLink class="button button--ghost" to="/wallet">取消</RouterLink>
          </div>
        </form>
      </SectionCard>
    </section>
  </WalletChrome>
</template>
