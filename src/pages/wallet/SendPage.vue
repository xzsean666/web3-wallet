<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { isAddress } from "viem";
import { storeToRefs } from "pinia";
import { RouterLink, useRoute, useRouter } from "vue-router";
import SectionCard from "../../components/SectionCard.vue";
import WalletChrome from "../../components/WalletChrome.vue";
import { broadcastSignedTransaction, estimateTransferPreview } from "../../services/evm";
import { signTransferTransaction } from "../../services/walletBridge";
import { useNetworksStore } from "../../stores/networks";
import { useSessionStore } from "../../stores/session";
import { useWalletStore } from "../../stores/wallet";
import type { TransferPreview } from "../../types/portfolio";
import type { WalletHex } from "../../types/wallet";
import { shortenAddress } from "../../utils/format";

const route = useRoute();
const router = useRouter();
const networksStore = useNetworksStore();
const sessionStore = useSessionStore();
const walletStore = useWalletStore();

const { activeNetwork } = storeToRefs(networksStore);
const { primaryAddress, shellMode } = storeToRefs(sessionStore);

const selectedAssetId = ref("native");
const recipientAddress = ref("");
const amount = ref("");
const walletPassword = ref("");
const formErrors = ref<string[]>([]);
const estimateError = ref("");
const broadcastError = ref("");
const isEstimating = ref(false);
const isBroadcasting = ref(false);
const confirmation = ref<null | {
  assetLabel: string;
  assetSymbol: string;
  assetType: "native" | "erc20";
  recipientAddress: string;
  amount: string;
  networkName: string;
  gas: TransferPreview;
  contractAddress?: string;
}>(null);

const activeTokens = computed(() => walletStore.tokensForNetwork(activeNetwork.value.id));
const assetOptions = computed(() => [
  {
    id: "native",
    type: "native" as const,
    label: `${activeNetwork.value.symbol} · Native Token`,
  },
  ...activeTokens.value.map((token) => ({
    id: token.id,
    type: "erc20" as const,
    label: `${token.symbol} · ERC20`,
  })),
]);

const selectedAsset = computed(() => {
  if (selectedAssetId.value === "native") {
    return {
      id: "native",
      type: "native" as const,
      label: `${activeNetwork.value.symbol} · Native Token`,
      symbol: activeNetwork.value.symbol,
    };
  }

  const token = walletStore.findTokenById(selectedAssetId.value);
  if (!token) {
    return null;
  }

  return {
    id: token.id,
    type: "erc20" as const,
    label: `${token.symbol} · ERC20`,
    symbol: token.symbol,
    contractAddress: token.contractAddress,
    decimals: token.decimals,
  };
});

watch(
  () => route.query.asset,
  (nextAsset) => {
    if (typeof nextAsset === "string" && assetOptions.value.some((asset) => asset.id === nextAsset)) {
      selectedAssetId.value = nextAsset;
    }
  },
  { immediate: true },
);

watch(activeNetwork, () => {
  if (!assetOptions.value.some((asset) => asset.id === selectedAssetId.value)) {
    selectedAssetId.value = "native";
  }
});

watch([selectedAssetId, recipientAddress, amount, () => activeNetwork.value.id], () => {
  confirmation.value = null;
  estimateError.value = "";
  broadcastError.value = "";
});

const isTauriRuntime = computed(() => shellMode.value === "tauri");

async function buildConfirmation() {
  formErrors.value = [];
  estimateError.value = "";
  broadcastError.value = "";
  confirmation.value = null;

  if (!selectedAsset.value) {
    formErrors.value.push("请选择一个可发送的资产");
  }

  if (!primaryAddress.value) {
    formErrors.value.push("当前钱包地址不可用，无法估算发送交易");
  }

  if (!isAddress(recipientAddress.value.trim())) {
    formErrors.value.push("收款地址必须是合法的 EVM 地址");
  }

  const numericAmount = Number(amount.value);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    formErrors.value.push("金额必须是大于 0 的数字");
  }

  if (formErrors.value.length > 0 || !selectedAsset.value || !primaryAddress.value) {
    return;
  }

  isEstimating.value = true;
  const nextConfirmation = {
    assetLabel: selectedAsset.value.label,
    assetSymbol: selectedAsset.value.symbol,
    assetType: selectedAsset.value.type,
    recipientAddress: recipientAddress.value.trim(),
    amount: amount.value.trim(),
    networkName: activeNetwork.value.name,
    contractAddress:
      selectedAsset.value.type === "erc20" ? selectedAsset.value.contractAddress : undefined,
  };

  const assetPayload =
    selectedAsset.value.type === "native"
      ? { type: "native" as const }
      : {
          type: "erc20" as const,
          token: walletStore.findTokenById(selectedAsset.value.id)!,
        };

  try {
    const preview = await estimateTransferPreview({
      network: activeNetwork.value,
      account: primaryAddress.value,
      recipientAddress: recipientAddress.value.trim() as `0x${string}`,
      amount: amount.value.trim(),
      asset: assetPayload,
    });

    confirmation.value = {
      ...nextConfirmation,
      gas: preview,
    };
  } catch (error) {
    estimateError.value = error instanceof Error ? error.message : "无法从当前 RPC 估算 Gas";
  } finally {
    isEstimating.value = false;
  }
}

async function signAndBroadcast() {
  if (!confirmation.value) {
    broadcastError.value = "请先生成确认摘要";
    return;
  }

  if (!walletPassword.value.trim()) {
    broadcastError.value = "请输入钱包密码后再签名";
    return;
  }

  if (!isTauriRuntime.value) {
    broadcastError.value = "浏览器预览模式不支持真实签名与广播，请使用 pnpm tauri dev";
    return;
  }

  isBroadcasting.value = true;
  broadcastError.value = "";

  try {
    const signedPayload = await signTransferTransaction({
      password: walletPassword.value,
      chainId: String(activeNetwork.value.chainId),
      nonce: confirmation.value.gas.nonce,
      gasLimit: confirmation.value.gas.gasLimit,
      recipientAddress: confirmation.value.recipientAddress as `0x${string}`,
      amount: confirmation.value.gas.parsedAmount,
      feeMode: confirmation.value.gas.feeMode,
      gasPriceWei: confirmation.value.gas.gasPriceWei,
      maxFeePerGasWei: confirmation.value.gas.maxFeePerGasWei,
      maxPriorityFeePerGasWei: confirmation.value.gas.maxPriorityFeePerGasWei,
      asset:
        confirmation.value.assetType === "native"
          ? {
              type: "native",
            }
          : {
              type: "erc20",
              contractAddress: confirmation.value.contractAddress as `0x${string}`,
            },
    });
    const broadcastHash = await broadcastSignedTransaction({
      network: activeNetwork.value,
      rawTransaction: signedPayload.rawTransaction,
    });
    const txHash = (broadcastHash || signedPayload.txHash) as WalletHex;

    walletStore.prependActivity({
      id: txHash,
      title: `${confirmation.value.assetSymbol} 转账已提交`,
      subtitle: `${activeNetwork.value.name} · ${confirmation.value.amount} ${confirmation.value.assetSymbol} -> ${shortenAddress(confirmation.value.recipientAddress)}`,
      status: "pending",
      txHash,
      networkId: activeNetwork.value.id,
    });

    walletPassword.value = "";

    await router.push({
      name: "wallet-tx-detail",
      params: {
        txHash,
      },
      query: {
        networkId: activeNetwork.value.id,
      },
    });
  } catch (error) {
    broadcastError.value = error instanceof Error ? error.message : "交易广播失败";
  } finally {
    isBroadcasting.value = false;
  }
}
</script>

<template>
  <WalletChrome
    eyebrow="Send"
    title="发送页已经接到真实签名广播。"
    subtitle="当前只支持 Native Token 与 ERC20 Token。签名在本地 Tauri Core 内完成，发送时需要再次输入钱包密码。"
  >
    <section class="page-grid page-grid--2">
      <SectionCard title="Send Form" description="当前支持 Native Token 与 ERC20">
        <form class="form-grid" @submit.prevent="buildConfirmation">
          <label class="field">
            <span>资产</span>
            <select v-model="selectedAssetId">
              <option v-for="asset in assetOptions" :key="asset.id" :value="asset.id">
                {{ asset.label }}
              </option>
            </select>
          </label>

          <label class="field">
            <span>收款地址</span>
            <input
              v-model="recipientAddress"
              autocomplete="off"
              placeholder="0x..."
            />
          </label>

          <label class="field">
            <span>数量</span>
            <input v-model="amount" inputmode="decimal" placeholder="0.00" />
          </label>

          <ul v-if="formErrors.length" class="bullet-list helper-text helper-text--error">
            <li v-for="error in formErrors" :key="error">{{ error }}</li>
          </ul>

          <p v-if="estimateError" class="helper-text helper-text--error">{{ estimateError }}</p>

          <div class="form-actions">
            <button class="button button--primary" type="submit">
              {{ isEstimating ? "正在估算..." : "生成确认摘要" }}
            </button>
          </div>
        </form>
      </SectionCard>

      <SectionCard title="Current Network" description="发送会基于当前激活网络">
        <p class="metric-value">{{ activeNetwork.name }}</p>
        <p>Chain ID {{ activeNetwork.chainId }}</p>
        <div class="form-actions">
          <RouterLink class="button button--secondary" to="/settings/networks">
            切换网络
          </RouterLink>
          <RouterLink class="button button--ghost" to="/wallet">
            返回首页
          </RouterLink>
        </div>
      </SectionCard>
    </section>

    <section v-if="confirmation" class="page-grid page-grid--1">
      <SectionCard
        title="Confirmation Preview"
        description="本地 Tauri Core 会用钱包密码解锁 Stronghold 并签名，私钥不会出网。"
      >
        <ul class="bullet-list">
          <li>资产：{{ confirmation.assetLabel }}</li>
          <li>类型：{{ confirmation.assetType }}</li>
          <li>网络：{{ confirmation.networkName }}</li>
          <li>地址：{{ confirmation.recipientAddress }}</li>
          <li>数量：{{ confirmation.amount }}</li>
          <li>Nonce：{{ confirmation.gas.nonce }}</li>
          <li v-if="confirmation.contractAddress">合约：{{ confirmation.contractAddress }}</li>
          <li>Gas Limit：{{ confirmation.gas.gasLimit }}</li>
          <li v-if="confirmation.gas.feeMode === 'legacy' && confirmation.gas.gasPriceGwei">
            Gas Price：{{ confirmation.gas.gasPriceGwei }} gwei
          </li>
          <li v-if="confirmation.gas.maxFeePerGasGwei">
            Max Fee：{{ confirmation.gas.maxFeePerGasGwei }} gwei
          </li>
          <li v-if="confirmation.gas.maxPriorityFeePerGasGwei">
            Priority Fee：{{ confirmation.gas.maxPriorityFeePerGasGwei }} gwei
          </li>
          <li v-if="confirmation.gas.estimatedNetworkFee">
            预计网络费：{{ confirmation.gas.estimatedNetworkFee }} {{ activeNetwork.symbol }}
          </li>
        </ul>
        <label class="field">
          <span>钱包密码</span>
          <input
            v-model="walletPassword"
            autocomplete="current-password"
            placeholder="发送时再次输入钱包密码"
            type="password"
          />
        </label>
        <p v-if="!isTauriRuntime" class="helper-text">
          浏览器预览模式只保留 UI 流程，真实签名与广播请使用 `pnpm tauri dev`。
        </p>
        <p v-if="broadcastError" class="helper-text helper-text--error">{{ broadcastError }}</p>
        <div class="form-actions">
          <button
            class="button button--primary"
            type="button"
            :disabled="isBroadcasting"
            @click="signAndBroadcast"
          >
            {{ isBroadcasting ? "正在签名并广播..." : "签名并广播" }}
          </button>
          <button class="button button--ghost" type="button" @click="buildConfirmation">
            重新估算
          </button>
        </div>
      </SectionCard>
    </section>
  </WalletChrome>
</template>
