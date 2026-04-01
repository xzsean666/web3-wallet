<script setup lang="ts">
import { ref } from "vue";
import { storeToRefs } from "pinia";
import { RouterLink, useRouter } from "vue-router";
import SectionCard from "../../components/SectionCard.vue";
import WalletChrome from "../../components/WalletChrome.vue";
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
    title="手动添加 ERC20 已经有入口了。"
    subtitle="MVP 不做自动搜索合约，先让用户在当前网络下手动录入 ERC20 基础信息。"
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
          <li>Symbol 长度不超过 10</li>
          <li>Decimals 只接受 0 到 36 的整数</li>
        </ul>
      </SectionCard>
    </section>
  </WalletChrome>
</template>

