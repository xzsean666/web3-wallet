<script setup lang="ts">
import { computed, ref, watch } from "vue";
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

const canReadMetadata = computed(() => isAddress(contractAddress.value.trim()));

watch([contractAddress, activeNetwork], () => {
  metadataLookupError.value = "";
  metadataLookupMessage.value = "";
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

  try {
    const metadata = await readErc20TokenMetadata({
      network: activeNetwork.value,
      contractAddress: normalizedAddress,
      trackedTokens: walletStore.tokensForNetwork(activeNetwork.value.id),
    });

    name.value = metadata.name;
    symbol.value = metadata.symbol;
    decimals.value = String(metadata.decimals);
    metadataLookupMessage.value = "已从当前网络的合约读取 Token 元数据，你仍然可以手动修改。";
  } catch (error) {
    metadataLookupError.value =
      error instanceof Error ? error.message : "当前无法从合约读取 ERC20 元数据";
  } finally {
    isReadingMetadata.value = false;
  }
}

async function addToken() {
  const result = walletStore.addCustomToken({
    networkId: activeNetwork.value.id,
    name: name.value,
    symbol: symbol.value,
    decimals: decimals.value,
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
    eyebrow="Add Token"
    title="手动添加 ERC20。"
    subtitle="当前支持按合约读取 ERC20 基础元数据，再手动确认后添加到当前激活网络。"
  >
    <section class="page-grid page-grid--2">
      <SectionCard title="Add ERC20" description="当前网络下新增 Token">
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
              class="button button--secondary"
              type="button"
              :disabled="isReadingMetadata || !canReadMetadata"
              @click="readMetadataFromContract"
            >
              {{ isReadingMetadata ? "读取中..." : "读取合约元数据" }}
            </button>
            <span class="helper-text">会基于当前网络 RPC 调用 `name / symbol / decimals`</span>
          </div>

          <label class="field">
            <span>Token 名称</span>
            <input v-model="name" placeholder="USD Coin" />
          </label>

          <label class="field">
            <span>Token Symbol</span>
            <input v-model="symbol" maxlength="10" placeholder="USDC" />
          </label>

          <label class="field">
            <span>Decimals</span>
            <input v-model="decimals" inputmode="numeric" placeholder="18" />
          </label>

          <p v-if="metadataLookupMessage" class="helper-text">{{ metadataLookupMessage }}</p>
          <p v-if="metadataLookupError" class="helper-text helper-text--error">
            {{ metadataLookupError }}
          </p>

          <ul v-if="formErrors.length" class="bullet-list helper-text helper-text--error">
            <li v-for="error in formErrors" :key="error">{{ error }}</li>
          </ul>

          <div class="form-actions">
            <button class="button button--primary" type="submit">添加 Token</button>
            <RouterLink class="button button--ghost" to="/wallet">取消</RouterLink>
          </div>
        </form>
      </SectionCard>

      <SectionCard title="Rules" description="当前添加规则">
        <ul class="bullet-list">
          <li>只允许当前激活网络下的 ERC20 Token</li>
          <li>必须输入合法 EVM 合约地址</li>
          <li>可以先读取合约元数据，再手动调整表单</li>
          <li>Symbol 长度不超过 10</li>
          <li>Decimals 只接受 0 到 36 的整数</li>
        </ul>
      </SectionCard>
    </section>
  </WalletChrome>
</template>
