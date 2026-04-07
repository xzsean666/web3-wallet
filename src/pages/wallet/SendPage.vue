<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { formatEther, formatUnits, isAddress, parseUnits } from "viem";
import { storeToRefs } from "pinia";
import { RouterLink, useRoute, useRouter } from "vue-router";
import SectionCard from "../../components/SectionCard.vue";
import WalletChrome from "../../components/WalletChrome.vue";
import {
  broadcastSignedTransaction,
  describeTransferError,
  estimateTransferPreview,
  fetchPortfolioSnapshot,
} from "../../services/evm";
import { signTransferTransaction } from "../../services/walletBridge";
import { useNetworksStore } from "../../stores/networks";
import { usePortfolioStore } from "../../stores/portfolio";
import { useSessionStore } from "../../stores/session";
import { useWalletStore } from "../../stores/wallet";
import type { NetworkConfig } from "../../types/network";
import type { TransferErrorFeedback, TransferPreview } from "../../types/portfolio";
import type { AddressBookEntry, WalletAddress, WalletHex } from "../../types/wallet";
import { formatDateTime, formatRelativeTime, formatTokenAmount, shortenAddress } from "../../utils/format";

const route = useRoute();
const router = useRouter();
const networksStore = useNetworksStore();
const portfolioStore = usePortfolioStore();
const sessionStore = useSessionStore();
const walletStore = useWalletStore();

const { activeNetwork } = storeToRefs(networksStore);
const { accountCount, activeAccountId, primaryAddress, shellMode } = storeToRefs(sessionStore);
const { recentActivity } = storeToRefs(walletStore);

const selectedAssetId = ref("native");
const recipientAddress = ref("");
const amount = ref("");
const contactLabel = ref("");
const contactNote = ref("");
const walletPassword = ref("");
const formErrors = ref<string[]>([]);
const estimateFeedback = ref<TransferErrorFeedback | null>(null);
const transferFeedback = ref<TransferErrorFeedback | null>(null);
const isEstimating = ref(false);
const isBroadcasting = ref(false);
const isRefreshingBalance = ref(false);
const isFillingMax = ref(false);
const pasteFeedback = ref<null | {
  tone: "success" | "error";
  message: string;
}>(null);
const amountFeedback = ref<null | {
  tone: "success" | "error";
  message: string;
}>(null);
const contactFeedback = ref<null | {
  tone: "success" | "error";
  message: string;
}>(null);
type TransferConfirmation = {
  requestId: number;
  accountId: string;
  accountAddress: WalletAddress;
  assetId: string;
  assetLabel: string;
  assetSymbol: string;
  assetType: "native" | "erc20";
  chainId: number;
  networkId: string;
  network: NetworkConfig;
  recipientAddress: string;
  amount: string;
  networkName: string;
  networkSymbol: string;
  gas: TransferPreview;
  contractAddress?: WalletAddress;
};

const confirmation = ref<TransferConfirmation | null>(null);

function buildExpiredConfirmationFeedback(): TransferErrorFeedback {
  return {
    stage: "sign",
    category: "signing",
    title: "确认摘要已过期",
    message: "当前发送表单、账号或网络已经变化，请重新生成确认摘要后再继续签名。",
    hints: ["确认资产、收款地址、金额、账号与网络后，重新点击“生成确认摘要”"],
  };
}

function isConfirmationContextCurrent(nextConfirmation: TransferConfirmation) {
  return (
    activeAccountId.value === nextConfirmation.accountId &&
    Boolean(primaryAddress.value) &&
    primaryAddress.value!.toLowerCase() === nextConfirmation.accountAddress.toLowerCase() &&
    activeNetwork.value.id === nextConfirmation.networkId
  );
}

function isConfirmationCurrent(nextConfirmation: TransferConfirmation) {
  return (
    nextConfirmation.requestId === confirmationRequestId &&
    isConfirmationContextCurrent(nextConfirmation)
  );
}

const activeTokens = computed(() => walletStore.tokensForNetwork(activeNetwork.value.id));
const snapshot = computed(() =>
  portfolioStore.getSnapshot(activeNetwork.value.id, primaryAddress.value || null),
);
const savedContacts = computed(() => walletStore.contactsForNetwork(activeNetwork.value.id).slice(0, 4));
const recentRecipients = computed(() => {
  const seenAddresses = new Set<string>();

  return recentActivity.value
    .filter(
      (item) =>
        isActivityForCurrentAccount(item) &&
        item.networkId === activeNetwork.value.id &&
        item.recipientAddress &&
        item.recipientAddress !== primaryAddress.value,
    )
    .reduce<
      Array<{
        address: WalletAddress;
        assetId?: string;
        assetSymbol?: string;
        amount?: string;
        createdAt?: string;
      }>
    >((entries, item) => {
      const normalizedAddress = item.recipientAddress!.toLowerCase();

      if (seenAddresses.has(normalizedAddress)) {
        return entries;
      }

      seenAddresses.add(normalizedAddress);
      entries.push({
        address: item.recipientAddress!,
        assetId: item.assetId,
        assetSymbol: item.assetSymbol,
        amount: item.amount,
        createdAt: item.createdAt,
      });

      return entries;
    }, [])
    .slice(0, 4);
});
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
      decimals: 18,
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
const selectedAssetBalance = computed(() => {
  if (!selectedAsset.value) {
    return null;
  }

  if (selectedAsset.value.type === "native") {
    return snapshot.value.nativeBalance;
  }

  return snapshot.value.tokenBalances[selectedAsset.value.id] ?? walletStore.findTokenById(selectedAsset.value.id)?.balance ?? null;
});
const selectedAssetBalanceLabel = computed(() => {
  if (!selectedAssetBalance.value || selectedAssetBalance.value === "Unavailable") {
    return "Unavailable";
  }

  return formatTokenAmount(selectedAssetBalance.value);
});
const selectedAssetBalanceSummary = computed(() => {
  if (!selectedAsset.value) {
    return "N/A";
  }

  if (!selectedAssetBalance.value || selectedAssetBalance.value === "Unavailable") {
    return "Unavailable";
  }

  return `${selectedAssetBalanceLabel.value} ${selectedAsset.value.symbol}`;
});
const selectedAssetSyncLabel = computed(() => {
  if (snapshot.value.status === "loading") {
    return "同步中";
  }

  if (snapshot.value.status === "error") {
    return "同步失败";
  }

  if (snapshot.value.status === "ready") {
    return `已同步 · ${formatDateTime(snapshot.value.lastSyncedAt)}`;
  }

  return "待同步";
});
const selectedAssetParsedBalance = computed(() => {
  if (!selectedAsset.value) {
    return null;
  }

  return parseStoredBalance(selectedAssetBalance.value, selectedAsset.value.decimals);
});
const matchedSavedContact = computed(() => {
  const normalizedRecipient = recipientAddress.value.trim();

  if (!isAddress(normalizedRecipient)) {
    return null;
  }

  return walletStore.findAddressBookEntry(activeNetwork.value.id, normalizedRecipient);
});
const amountInputResult = computed(() => {
  if (!selectedAsset.value || !amount.value.trim()) {
    return null;
  }

  return parseAmountInput(amount.value, selectedAsset.value.decimals);
});
const amountGuidance = computed(() => {
  if (!selectedAsset.value) {
    return null;
  }

  if (amountInputResult.value && !amountInputResult.value.ok) {
    return {
      tone: "error" as const,
      message: amountInputResult.value.error,
    };
  }

  if (
    amountInputResult.value?.ok &&
    selectedAssetParsedBalance.value !== null &&
    amountInputResult.value.parsed > selectedAssetParsedBalance.value
  ) {
    return {
      tone: "error" as const,
      message: `当前输入超过可用余额 ${selectedAssetBalanceSummary.value}`,
    };
  }

  if (selectedAsset.value.type === "native") {
    return {
      tone: "default" as const,
      message: `可用余额 ${selectedAssetBalanceSummary.value}。原生币发送需要额外预留网络费，Max 会自动帮你计算。`,
    };
  }

  return {
    tone: "default" as const,
    message: `可用余额 ${selectedAssetBalanceSummary.value}。ERC20 的 Gas 仍由 ${activeNetwork.value.symbol} 支付。`,
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

watch(
  () => route.query.recipient,
  (nextRecipient) => {
    if (typeof nextRecipient === "string" && isAddress(nextRecipient)) {
      recipientAddress.value = nextRecipient;
    }
  },
  { immediate: true },
);

watch(activeNetwork, () => {
  if (!assetOptions.value.some((asset) => asset.id === selectedAssetId.value)) {
    selectedAssetId.value = "native";
  }
});

let balanceRefreshRequestId = 0;
let confirmationRequestId = 0;
let fillMaxRequestId = 0;

watch([selectedAssetId, recipientAddress, amount, () => activeNetwork.value.id, activeAccountId, primaryAddress], () => {
  confirmationRequestId += 1;
  confirmation.value = null;
  estimateFeedback.value = null;
  transferFeedback.value = null;
});

watch([() => activeNetwork.value.id, recipientAddress], () => {
  const normalizedRecipient = recipientAddress.value.trim();

  if (!normalizedRecipient) {
    contactLabel.value = "";
    contactNote.value = "";
    return;
  }

  if (!isAddress(normalizedRecipient)) {
    contactLabel.value = "";
    contactNote.value = "";
    return;
  }

  const matchedEntry = walletStore.findAddressBookEntry(activeNetwork.value.id, normalizedRecipient);

  if (!matchedEntry) {
    contactLabel.value = "";
    contactNote.value = "";
    return;
  }

  contactLabel.value = matchedEntry.label;
  contactNote.value = matchedEntry.note;
});

watch([activeNetwork, primaryAddress, activeTokens], () => {
  void refreshBalanceContext();
});

onBeforeUnmount(() => {
  if (pasteFeedbackTimer) {
    window.clearTimeout(pasteFeedbackTimer);
  }

  if (amountFeedbackTimer) {
    window.clearTimeout(amountFeedbackTimer);
  }

  if (contactFeedbackTimer) {
    window.clearTimeout(contactFeedbackTimer);
  }
});

onMounted(() => {
  void refreshBalanceContext();
});

const isTauriRuntime = computed(() => shellMode.value === "tauri");
const estimateStageLabel = computed(() =>
  estimateFeedback.value?.stage === "estimate" ? "预估阶段" : "",
);
const transferStageLabel = computed(() => {
  if (!transferFeedback.value) {
    return "";
  }

  if (transferFeedback.value.stage === "sign") {
    return "签名阶段";
  }

  return "广播阶段";
});
let pasteFeedbackTimer: number | null = null;
let amountFeedbackTimer: number | null = null;
let contactFeedbackTimer: number | null = null;

function isActivityForCurrentAccount(item: {
  id: string;
  accountId?: string;
  accountAddress?: WalletAddress;
}) {
  if (item.id === "empty-state" || !primaryAddress.value) {
    return false;
  }

  if (item.accountId) {
    return item.accountId === activeAccountId.value;
  }

  if (item.accountAddress) {
    return item.accountAddress.toLowerCase() === primaryAddress.value.toLowerCase();
  }

  return accountCount.value <= 1;
}

function parseAmountInput(value: string, decimals: number) {
  const normalizedValue = value.trim();

  if (!normalizedValue) {
    return {
      ok: false as const,
      error: "金额不能为空",
    };
  }

  try {
    const parsed = parseUnits(normalizedValue, decimals);

    if (parsed <= 0n) {
      return {
        ok: false as const,
        error: "金额必须大于 0",
      };
    }

    return {
      ok: true as const,
      parsed,
    };
  } catch {
    return {
      ok: false as const,
      error: decimals > 0 ? `金额格式无效，最多支持 ${decimals} 位小数` : "当前资产不支持小数金额",
    };
  }
}

function parseStoredBalance(value: string | null, decimals: number) {
  if (!value || value === "Unavailable") {
    return null;
  }

  try {
    return parseUnits(value, decimals);
  } catch {
    return null;
  }
}

function recentRecipientAmountLabel(entry: {
  assetSymbol?: string;
  amount?: string;
}) {
  if (entry.amount && entry.assetSymbol) {
    return `${formatTokenAmount(entry.amount)} ${entry.assetSymbol}`;
  }

  return entry.assetSymbol ?? "Recent";
}

function savedContactTimestamp(entry: AddressBookEntry) {
  return entry.lastUsedAt ?? entry.updatedAt;
}

function useRecentRecipient(entry: {
  address: WalletAddress;
  assetId?: string;
}) {
  recipientAddress.value = entry.address;

  if (entry.assetId && assetOptions.value.some((asset) => asset.id === entry.assetId)) {
    selectedAssetId.value = entry.assetId;
  }
}

function useSavedContact(entry: AddressBookEntry) {
  recipientAddress.value = entry.address;
  walletStore.markAddressBookEntryUsed({
    networkId: entry.networkId,
    address: entry.address,
  });
}

function schedulePasteFeedbackReset() {
  if (pasteFeedbackTimer) {
    window.clearTimeout(pasteFeedbackTimer);
  }

  pasteFeedbackTimer = window.setTimeout(() => {
    pasteFeedback.value = null;
    pasteFeedbackTimer = null;
  }, 2200);
}

function scheduleAmountFeedbackReset() {
  if (amountFeedbackTimer) {
    window.clearTimeout(amountFeedbackTimer);
  }

  amountFeedbackTimer = window.setTimeout(() => {
    amountFeedback.value = null;
    amountFeedbackTimer = null;
  }, 2600);
}

function setAmountFeedback(feedback: {
  tone: "success" | "error";
  message: string;
}) {
  amountFeedback.value = feedback;
  scheduleAmountFeedbackReset();
}

function scheduleContactFeedbackReset() {
  if (contactFeedbackTimer) {
    window.clearTimeout(contactFeedbackTimer);
  }

  contactFeedbackTimer = window.setTimeout(() => {
    contactFeedback.value = null;
    contactFeedbackTimer = null;
  }, 2600);
}

function setContactFeedback(feedback: {
  tone: "success" | "error";
  message: string;
}) {
  contactFeedback.value = feedback;
  scheduleContactFeedbackReset();
}

async function pasteRecipientAddress() {
  if (typeof navigator === "undefined" || !navigator.clipboard?.readText) {
    pasteFeedback.value = {
      tone: "error",
      message: "当前环境不支持读取剪贴板",
    };
    schedulePasteFeedbackReset();
    return;
  }

  try {
    const clipboardText = (await navigator.clipboard.readText()).trim();

    if (!isAddress(clipboardText)) {
      throw new Error("剪贴板内容不是合法的 EVM 地址");
    }

    recipientAddress.value = clipboardText;
    pasteFeedback.value = {
      tone: "success",
      message: "已从剪贴板回填收款地址",
    };
  } catch (error) {
    pasteFeedback.value = {
      tone: "error",
      message: error instanceof Error ? error.message : "当前无法读取剪贴板地址",
    };
  }

  schedulePasteFeedbackReset();
}

async function refreshBalanceContext() {
  if (!primaryAddress.value) {
    return;
  }

  const requestId = ++balanceRefreshRequestId;
  const requestNetwork = activeNetwork.value;
  const requestAddress = primaryAddress.value;
  const requestTokens = [...activeTokens.value];

  isRefreshingBalance.value = true;
  portfolioStore.markLoading({
    networkId: requestNetwork.id,
    accountAddress: requestAddress,
  });

  try {
    const nextSnapshot = await fetchPortfolioSnapshot({
      network: requestNetwork,
      address: requestAddress,
      tokens: requestTokens,
    });

    if (requestId !== balanceRefreshRequestId) {
      return;
    }

    portfolioStore.setSnapshot(nextSnapshot);
  } catch (error) {
    if (requestId !== balanceRefreshRequestId) {
      return;
    }

    portfolioStore.setError({
      networkId: requestNetwork.id,
      accountAddress: requestAddress,
      error: error instanceof Error ? error.message : "Failed to load send page balances",
    });
  } finally {
    if (requestId === balanceRefreshRequestId) {
      isRefreshingBalance.value = false;
    }
  }
}

function saveCurrentRecipientAsContact() {
  const hadExistingEntry = Boolean(matchedSavedContact.value);
  const result = walletStore.upsertAddressBookEntry({
    networkId: activeNetwork.value.id,
    label: contactLabel.value,
    address: recipientAddress.value,
    note: contactNote.value,
  });

  if (!result.ok) {
    setContactFeedback({
      tone: "error",
      message: result.errors[0] ?? "当前联系人无法保存",
    });
    return;
  }

  setContactFeedback({
    tone: "success",
    message: hadExistingEntry ? "联系人已更新" : "联系人已保存到地址簿",
  });
}

function removeCurrentRecipientContact() {
  if (!matchedSavedContact.value) {
    return;
  }

  walletStore.removeAddressBookEntry(matchedSavedContact.value.id);
  contactLabel.value = "";
  contactNote.value = "";
  setContactFeedback({
    tone: "success",
    message: "联系人已从地址簿移除",
  });
}

async function fillMaxAmount() {
  if (!selectedAsset.value) {
    setAmountFeedback({
      tone: "error",
      message: "当前没有可发送的资产",
    });
    return;
  }

  const parsedBalance = selectedAssetParsedBalance.value;

  if (parsedBalance === null) {
    setAmountFeedback({
      tone: "error",
      message: "余额还没同步完成，请先刷新后再试",
    });
    return;
  }

  if (parsedBalance <= 0n) {
    amount.value = "";
    setAmountFeedback({
      tone: "error",
      message: "当前可用余额为 0，无法回填 Max",
    });
    return;
  }

  if (selectedAsset.value.type === "erc20") {
    amount.value = formatUnits(parsedBalance, selectedAsset.value.decimals);
    setAmountFeedback({
      tone: "success",
      message: `已回填全部 ${selectedAsset.value.symbol} 余额`,
    });
    return;
  }

  if (!primaryAddress.value) {
    setAmountFeedback({
      tone: "error",
      message: "当前钱包地址不可用，无法计算 Max",
    });
    return;
  }

  const normalizedRecipient = recipientAddress.value.trim();

  if (!isAddress(normalizedRecipient)) {
    setAmountFeedback({
      tone: "error",
      message: "先填写合法收款地址，再计算原生币 Max",
    });
    return;
  }

  isFillingMax.value = true;
  const requestId = ++fillMaxRequestId;
  const requestNetwork = activeNetwork.value;
  const requestAddress = primaryAddress.value;
  const requestRecipient = normalizedRecipient;
  const requestAssetId = selectedAssetId.value;

  try {
    const preview = await estimateTransferPreview({
      network: requestNetwork,
      account: requestAddress,
      recipientAddress: normalizedRecipient as `0x${string}`,
      amount: "0",
      asset: {
        type: "native",
      },
    });

    if (
      requestId !== fillMaxRequestId ||
      activeNetwork.value.id !== requestNetwork.id ||
      primaryAddress.value !== requestAddress ||
      recipientAddress.value.trim() !== requestRecipient ||
      selectedAssetId.value !== requestAssetId
    ) {
      return;
    }

    const feePerGasWei =
      preview.feeMode === "legacy" ? preview.gasPriceWei : preview.maxFeePerGasWei;

    if (!feePerGasWei) {
      throw new Error("当前 RPC 无法返回 Max 所需的 Gas 参数");
    }

    const reservedFeeWei = BigInt(preview.gasLimit) * BigInt(feePerGasWei);
    const maxAmountWei = parsedBalance - reservedFeeWei;

    if (maxAmountWei <= 0n) {
      setAmountFeedback({
        tone: "error",
        message: "当前原生币余额不足以覆盖网络费",
      });
      return;
    }

    amount.value = formatEther(maxAmountWei);
    setAmountFeedback({
      tone: "success",
      message: preview.estimatedNetworkFee
        ? `已回填 Max，并预留约 ${formatTokenAmount(preview.estimatedNetworkFee)} ${requestNetwork.symbol} 网络费`
        : "已回填可发送的最大原生币数量",
    });
  } catch (error) {
    const feedback = describeTransferError({
      error,
      stage: "estimate",
    });

    setAmountFeedback({
      tone: "error",
      message: feedback.message,
    });
  } finally {
    if (requestId === fillMaxRequestId) {
      isFillingMax.value = false;
    }
  }
}

async function buildConfirmation() {
  formErrors.value = [];
  estimateFeedback.value = null;
  transferFeedback.value = null;
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

  const parsedAmountResult = selectedAsset.value
    ? parseAmountInput(amount.value, selectedAsset.value.decimals)
    : null;

  if (!parsedAmountResult?.ok) {
    formErrors.value.push(parsedAmountResult?.error ?? "金额格式无效");
  }

  if (parsedAmountResult?.ok && selectedAssetParsedBalance.value !== null) {
    if (parsedAmountResult.parsed > selectedAssetParsedBalance.value) {
      formErrors.value.push("发送数量不能超过当前可用余额");
    }

    if (selectedAsset.value?.type === "native" && parsedAmountResult.parsed >= selectedAssetParsedBalance.value) {
      formErrors.value.push("发送原生币时必须预留网络费，不能直接发送全部余额");
    }
  }

  if (formErrors.value.length > 0 || !selectedAsset.value || !primaryAddress.value) {
    return;
  }

  const requestId = ++confirmationRequestId;
  const requestNetwork = activeNetwork.value;
  const requestAccountId = activeAccountId.value;
  const requestAccountAddress = primaryAddress.value;
  const requestSelectedAsset = selectedAsset.value;
  const requestRecipientAddress = recipientAddress.value.trim();
  const requestAmount = amount.value.trim();

  if (!requestAccountId) {
    formErrors.value.push("当前没有激活账号，无法生成确认摘要");
    return;
  }

  isEstimating.value = true;
  const nextConfirmation = {
    requestId,
    accountId: requestAccountId,
    accountAddress: requestAccountAddress,
    assetId: requestSelectedAsset.id,
    assetLabel: requestSelectedAsset.label,
    assetSymbol: requestSelectedAsset.symbol,
    assetType: requestSelectedAsset.type,
    chainId: requestNetwork.chainId,
    networkId: requestNetwork.id,
    network: { ...requestNetwork },
    recipientAddress: requestRecipientAddress,
    amount: requestAmount,
    networkName: requestNetwork.name,
    networkSymbol: requestNetwork.symbol,
    contractAddress:
      requestSelectedAsset.type === "erc20" ? requestSelectedAsset.contractAddress : undefined,
  };

  const assetPayload =
    requestSelectedAsset.type === "native"
      ? { type: "native" as const }
      : {
          type: "erc20" as const,
          token: walletStore.findTokenById(requestSelectedAsset.id)!,
        };

  try {
    const preview = await estimateTransferPreview({
      network: requestNetwork,
      account: requestAccountAddress,
      recipientAddress: requestRecipientAddress as `0x${string}`,
      amount: requestAmount,
      asset: assetPayload,
    });

    if (
      requestId !== confirmationRequestId ||
      activeNetwork.value.id !== requestNetwork.id ||
      activeAccountId.value !== requestAccountId ||
      primaryAddress.value !== requestAccountAddress ||
      recipientAddress.value.trim() !== requestRecipientAddress ||
      amount.value.trim() !== requestAmount ||
      selectedAssetId.value !== requestSelectedAsset.id
    ) {
      return;
    }

    confirmation.value = {
      ...nextConfirmation,
      gas: preview,
    };
  } catch (error) {
    if (requestId !== confirmationRequestId) {
      return;
    }

    estimateFeedback.value = describeTransferError({
      error,
      stage: "estimate",
    });
  } finally {
    if (requestId === confirmationRequestId) {
      isEstimating.value = false;
    }
  }
}

async function signAndBroadcast() {
  const nextConfirmation = confirmation.value;

  if (!nextConfirmation) {
    transferFeedback.value = {
      stage: "sign",
      category: "unknown",
      title: "缺少确认摘要",
      message: "当前还没有可签名的确认摘要，请先完成一次估算。",
      hints: ["点击“生成确认摘要”后再继续签名"],
    };
    return;
  }

  if (!isConfirmationCurrent(nextConfirmation)) {
    transferFeedback.value = buildExpiredConfirmationFeedback();
    return;
  }

  if (!walletPassword.value.trim()) {
    transferFeedback.value = {
      stage: "sign",
      category: "signing",
      title: "需要钱包密码",
      message: "发送前必须再次输入钱包密码，才能在本地解锁签名器。",
      hints: ["输入钱包密码后重新点击“签名并广播”"],
    };
    return;
  }

  if (!isTauriRuntime.value) {
    transferFeedback.value = {
      stage: "sign",
      category: "signing",
      title: "当前运行时不支持真实签名",
      message: "浏览器预览模式不会执行本地签名与广播。",
      hints: ["请使用 `pnpm tauri dev` 在 Tauri 运行时里测试真实发送"],
    };
    return;
  }

  if (!activeAccountId.value) {
    transferFeedback.value = {
      stage: "sign",
      category: "signing",
      title: "当前没有激活账号",
      message: "请先选择一个账号，再继续签名和广播。",
      hints: ["前往账号管理页切换或创建账号"],
    };
    return;
  }

  isBroadcasting.value = true;
  transferFeedback.value = null;

  try {
    let signedPayload;

    try {
      signedPayload = await signTransferTransaction({
        accountId: nextConfirmation.accountId,
        password: walletPassword.value,
        chainId: String(nextConfirmation.chainId),
        nonce: nextConfirmation.gas.nonce,
        gasLimit: nextConfirmation.gas.gasLimit,
        recipientAddress: nextConfirmation.recipientAddress as `0x${string}`,
        amount: nextConfirmation.gas.parsedAmount,
        feeMode: nextConfirmation.gas.feeMode,
        gasPriceWei: nextConfirmation.gas.gasPriceWei,
        maxFeePerGasWei: nextConfirmation.gas.maxFeePerGasWei,
        maxPriorityFeePerGasWei: nextConfirmation.gas.maxPriorityFeePerGasWei,
        asset:
          nextConfirmation.assetType === "native"
            ? {
                type: "native",
              }
            : {
                type: "erc20",
                contractAddress: nextConfirmation.contractAddress as `0x${string}`,
              },
      });
    } catch (error) {
      transferFeedback.value = describeTransferError({
        error,
        stage: "sign",
      });
      return;
    }

    if (!isConfirmationCurrent(nextConfirmation)) {
      confirmation.value = nextConfirmation;
      transferFeedback.value = buildExpiredConfirmationFeedback();
      return;
    }

    let broadcastHash;

    try {
      broadcastHash = await broadcastSignedTransaction({
        network: nextConfirmation.network,
        rawTransaction: signedPayload.rawTransaction,
      });
    } catch (error) {
      transferFeedback.value = describeTransferError({
        error,
        stage: "broadcast",
      });
      return;
    }

    const txHash = (broadcastHash || signedPayload.txHash) as WalletHex;

    walletStore.prependActivity({
      id: txHash,
      title: `${nextConfirmation.assetSymbol} 转账已提交`,
      subtitle: `${nextConfirmation.networkName} · ${nextConfirmation.amount} ${nextConfirmation.assetSymbol} -> ${shortenAddress(nextConfirmation.recipientAddress)}`,
      status: "pending",
      accountId: nextConfirmation.accountId,
      accountAddress: nextConfirmation.accountAddress,
      txHash,
      networkId: nextConfirmation.networkId,
      assetId: nextConfirmation.assetId,
      assetType: nextConfirmation.assetType,
      assetSymbol: nextConfirmation.assetSymbol,
      amount: nextConfirmation.amount,
      recipientAddress: nextConfirmation.recipientAddress as `0x${string}`,
      createdAt: new Date().toISOString(),
    });
    walletStore.markAddressBookEntryUsed({
      networkId: nextConfirmation.networkId,
      address: nextConfirmation.recipientAddress,
    });

    walletPassword.value = "";

    await router.push({
      name: "wallet-tx-detail",
      params: {
        txHash,
      },
      query: {
        networkId: nextConfirmation.networkId,
      },
    });
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
            <select v-model="selectedAssetId" :disabled="isBroadcasting">
              <option v-for="asset in assetOptions" :key="asset.id" :value="asset.id">
                {{ asset.label }}
              </option>
            </select>
          </label>

          <section v-if="selectedAsset" class="form-summary">
            <div class="chip-row">
              <span class="status-chip status-chip--accent">{{ selectedAsset.symbol }}</span>
              <span class="status-chip">
                {{ selectedAsset.type === "native" ? "Native Token" : "ERC20 Token" }}
              </span>
              <span class="status-chip">{{ activeNetwork.name }}</span>
            </div>
            <div class="key-value-list">
              <div class="key-value-row">
                <span>可用余额</span>
                <strong>{{ selectedAssetBalanceSummary }}</strong>
              </div>
              <div class="key-value-row">
                <span>余额同步</span>
                <strong>{{ selectedAssetSyncLabel }}</strong>
              </div>
            </div>
          </section>

          <div class="form-actions form-actions--compact">
            <button
              class="button button--ghost button--small"
              type="button"
              :disabled="isRefreshingBalance"
              @click="refreshBalanceContext"
            >
              {{ isRefreshingBalance ? "刷新中..." : "刷新余额" }}
            </button>
            <button
              class="button button--secondary button--small"
              type="button"
              :disabled="isFillingMax || isRefreshingBalance || isBroadcasting"
              @click="fillMaxAmount"
            >
              {{ isFillingMax ? "计算 Max..." : "Max" }}
            </button>
            <span
              v-if="amountFeedback"
              :class="[
                'helper-text',
                amountFeedback.tone === 'error' ? 'helper-text--error' : 'helper-text--success',
              ]"
            >
              {{ amountFeedback.message }}
            </span>
          </div>

          <p v-if="snapshot.error" class="helper-text helper-text--error">{{ snapshot.error }}</p>

          <label class="field">
            <span>收款地址</span>
            <input
              v-model="recipientAddress"
              autocomplete="off"
              :disabled="isBroadcasting"
              placeholder="0x..."
            />
          </label>

          <div class="form-actions form-actions--compact">
            <button
              class="button button--ghost button--small"
              type="button"
              :disabled="isBroadcasting"
              @click="pasteRecipientAddress"
            >
              粘贴地址
            </button>
            <span
              v-if="pasteFeedback"
              :class="[
                'helper-text',
                pasteFeedback.tone === 'error' ? 'helper-text--error' : 'helper-text--success',
              ]"
            >
              {{ pasteFeedback.message }}
            </span>
          </div>

          <div v-if="savedContacts.length" class="card-stack">
            <div class="form-actions form-actions--compact">
              <p class="helper-text">地址簿联系人：点击后可直接回填收款地址</p>
              <RouterLink class="button button--ghost button--small" to="/settings/address-book">
                管理地址簿
              </RouterLink>
            </div>
            <button
              v-for="entry in savedContacts"
              :key="entry.id"
              class="token-row token-row--selectable"
              type="button"
              :disabled="isBroadcasting"
              @click="useSavedContact(entry)"
            >
              <div class="token-row__content">
                <strong>{{ entry.label }}</strong>
                <p class="token-row__address">{{ shortenAddress(entry.address) }} · {{ entry.address }}</p>
                <p v-if="entry.note">{{ entry.note }}</p>
              </div>
              <div class="token-row__meta">
                <strong class="token-row__timestamp">
                  {{ entry.lastUsedAt ? `${formatRelativeTime(entry.lastUsedAt)} 使用` : "未使用" }}
                </strong>
                <span class="helper-text">{{ formatDateTime(savedContactTimestamp(entry)) }}</span>
              </div>
            </button>
          </div>

          <section class="form-summary">
            <div class="form-actions form-actions--compact">
              <p class="helper-text">
                {{ matchedSavedContact ? "当前收款地址已在地址簿中，可直接更新标签或备注。" : "将当前收款地址保存为正式联系人。" }}
              </p>
              <RouterLink class="button button--ghost button--small" to="/settings/address-book">
                地址簿详情
              </RouterLink>
            </div>

            <label class="field">
              <span>联系人名称</span>
              <input v-model="contactLabel" autocomplete="off" placeholder="例如：Treasury / Exchange" />
            </label>

            <label class="field">
              <span>备注</span>
              <textarea
                v-model="contactNote"
                placeholder="例如：业务打款地址 / 交易所充值地址"
                rows="2"
              />
            </label>

            <p
              v-if="contactFeedback"
              :class="[
                'helper-text',
                contactFeedback.tone === 'error' ? 'helper-text--error' : 'helper-text--success',
              ]"
            >
              {{ contactFeedback.message }}
            </p>

            <div class="form-actions">
              <button class="button button--secondary button--small" type="button" @click="saveCurrentRecipientAsContact">
                {{ matchedSavedContact ? "更新联系人" : "保存联系人" }}
              </button>
              <button
                v-if="matchedSavedContact"
                class="button button--danger button--small"
                type="button"
                @click="removeCurrentRecipientContact"
              >
                移除联系人
              </button>
            </div>
          </section>

          <div v-if="recentRecipients.length" class="card-stack">
            <p class="helper-text">最近收款人：点击后可直接回填地址</p>
            <button
              v-for="entry in recentRecipients"
              :key="entry.address"
              class="token-row token-row--selectable"
              type="button"
              :disabled="isBroadcasting"
              @click="useRecentRecipient(entry)"
            >
              <div class="token-row__content">
                <strong>{{ shortenAddress(entry.address) }}</strong>
                <p>{{ activeNetwork.name }} · {{ recentRecipientAmountLabel(entry) }}</p>
              </div>
              <div class="token-row__meta">
                <strong class="token-row__timestamp">{{ formatRelativeTime(entry.createdAt) }}</strong>
                <span class="helper-text">{{ formatDateTime(entry.createdAt) }}</span>
              </div>
            </button>
            <p class="helper-text">只会回填地址，金额仍需要你手动确认。</p>
          </div>

          <label class="field">
            <span>数量</span>
            <input
              v-model="amount"
              :disabled="isBroadcasting"
              inputmode="decimal"
              placeholder="0.00"
            />
          </label>

          <p
            v-if="amountGuidance"
            :class="[
              'helper-text',
              amountGuidance.tone === 'error' ? 'helper-text--error' : '',
            ]"
          >
            {{ amountGuidance.message }}
          </p>

          <ul v-if="formErrors.length" class="bullet-list helper-text helper-text--error">
            <li v-for="error in formErrors" :key="error">{{ error }}</li>
          </ul>

          <div class="form-actions">
            <button class="button button--primary" type="submit" :disabled="isEstimating || isBroadcasting">
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

    <section v-if="estimateFeedback" class="page-grid page-grid--1">
      <SectionCard title="Estimate Feedback" :description="`${estimateStageLabel}返回的诊断结果`" tone="warning">
        <div class="chip-row">
          <span class="status-chip status-chip--accent">{{ estimateStageLabel }}</span>
          <span class="status-chip">{{ estimateFeedback.title }}</span>
        </div>
        <p class="helper-text helper-text--error">{{ estimateFeedback.message }}</p>
        <ul class="bullet-list">
          <li v-for="hint in estimateFeedback.hints" :key="hint">{{ hint }}</li>
        </ul>
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
            预计网络费：{{ confirmation.gas.estimatedNetworkFee }} {{ confirmation.networkSymbol }}
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
        <section v-if="transferFeedback" class="card-stack">
          <div class="chip-row">
            <span class="status-chip status-chip--accent">{{ transferStageLabel }}</span>
            <span class="status-chip">{{ transferFeedback.title }}</span>
          </div>
          <p class="helper-text helper-text--error">{{ transferFeedback.message }}</p>
          <ul class="bullet-list">
            <li v-for="hint in transferFeedback.hints" :key="hint">{{ hint }}</li>
          </ul>
        </section>
        <div class="form-actions">
          <button
            class="button button--primary"
            type="button"
            :disabled="isBroadcasting || (confirmation ? !isConfirmationCurrent(confirmation) : true)"
            @click="signAndBroadcast"
          >
            {{ isBroadcasting ? "正在签名并广播..." : "签名并广播" }}
          </button>
          <button
            class="button button--ghost"
            type="button"
            :disabled="isBroadcasting || isEstimating"
            @click="buildConfirmation"
          >
            重新估算
          </button>
        </div>
      </SectionCard>
    </section>
  </WalletChrome>
</template>
