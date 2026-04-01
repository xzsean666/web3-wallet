import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { isAddress } from "viem";
import type { ActivityItem, TokenDraft, TrackedToken } from "../types/wallet";

const defaultTrackedTokens: TrackedToken[] = [
  {
    id: "usdc",
    symbol: "USDC",
    name: "USD Coin",
    balance: "0.00",
    decimals: 6,
    contractAddress: "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    networkIds: ["ethereum", "base", "optimism", "arbitrum"],
    source: "preset",
  },
  {
    id: "usdt",
    symbol: "USDT",
    name: "Tether",
    balance: "0.00",
    decimals: 6,
    contractAddress: "0xdac17f958d2ee523a2206206994597c13d831ec7",
    networkIds: ["ethereum"],
    source: "preset",
  },
  {
    id: "dai",
    symbol: "DAI",
    name: "Dai",
    balance: "0.00",
    decimals: 18,
    contractAddress: "0x6b175474e89094c44da98b954eedeac495271d0f",
    networkIds: ["ethereum", "arbitrum"],
    source: "preset",
  },
];

const defaultActivity: ActivityItem[] = [
  {
    id: "empty-state",
    title: "No transfers yet",
    subtitle: "Milestone 3 will populate native token and ERC20 transfer history here.",
    status: "empty",
  },
];

export const useWalletStore = defineStore("wallet", () => {
  const trackedTokens = ref<TrackedToken[]>(defaultTrackedTokens);
  const recentActivity = ref<ActivityItem[]>(defaultActivity);

  const trackedTokenCount = computed(() => trackedTokens.value.length);

  function tokensForNetwork(networkId: string) {
    return trackedTokens.value.filter((token) => token.networkIds.includes(networkId));
  }

  function findTokenById(tokenId: string) {
    return trackedTokens.value.find((token) => token.id === tokenId) ?? null;
  }

  function validateTokenDraft(draft: TokenDraft) {
    const errors: string[] = [];
    const normalizedAddress = draft.contractAddress.trim();
    const decimalsValue = Number(draft.decimals.trim());

    if (!draft.name.trim()) {
      errors.push("Token 名称不能为空");
    }

    if (!draft.symbol.trim() || draft.symbol.trim().length > 10) {
      errors.push("Token Symbol 不能为空，且长度不能超过 10 个字符");
    }

    if (!isAddress(normalizedAddress)) {
      errors.push("合约地址必须是合法的 EVM 地址");
    }

    if (!Number.isInteger(decimalsValue) || decimalsValue < 0 || decimalsValue > 36) {
      errors.push("Decimals 必须是 0 到 36 之间的整数");
    }

    const duplicate = trackedTokens.value.some(
      (token) =>
        token.networkIds.includes(draft.networkId) &&
        token.contractAddress.toLowerCase() === normalizedAddress.toLowerCase(),
    );

    if (duplicate) {
      errors.push("当前网络下已经存在相同合约地址的 Token");
    }

    return {
      errors,
      normalizedAddress,
      decimalsValue,
    };
  }

  function addCustomToken(draft: TokenDraft) {
    const { errors, normalizedAddress, decimalsValue } = validateTokenDraft(draft);

    if (errors.length > 0) {
      return {
        ok: false as const,
        errors,
      };
    }

    const token: TrackedToken = {
      id: `custom-${draft.networkId}-${normalizedAddress.toLowerCase()}`,
      symbol: draft.symbol.trim().toUpperCase(),
      name: draft.name.trim(),
      balance: "0.00",
      decimals: decimalsValue,
      contractAddress: normalizedAddress as `0x${string}`,
      networkIds: [draft.networkId],
      source: "custom",
    };

    trackedTokens.value = [token, ...trackedTokens.value];

    return {
      ok: true as const,
      errors: [],
      token,
    };
  }

  function addTrackedToken(token: TrackedToken) {
    trackedTokens.value = [...trackedTokens.value, token];
  }

  function prependActivity(item: ActivityItem) {
    const nextActivity = recentActivity.value.filter((activity) => activity.id !== "empty-state");
    recentActivity.value = [item, ...nextActivity].slice(0, 12);
  }

  return {
    addCustomToken,
    addTrackedToken,
    findTokenById,
    prependActivity,
    recentActivity,
    trackedTokenCount,
    trackedTokens,
    tokensForNetwork,
    validateTokenDraft,
  };
});
