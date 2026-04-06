import { computed, ref, watch } from "vue";
import { defineStore, storeToRefs } from "pinia";
import { isAddress } from "viem";
import { loadWalletScopedUiState, patchWalletScopedUiState } from "../services/uiState";
import { useSessionStore } from "./session";
import { formatTokenAmount, shortenAddress } from "../utils/format";
import type {
  ActivityItem,
  AddressBookDraft,
  AddressBookEntry,
  TokenDraft,
  TrackedToken,
  WalletHex,
} from "../types/wallet";

const defaultTrackedTokens: TrackedToken[] = [
  {
    id: "usdc-ethereum",
    symbol: "USDC",
    name: "USD Coin",
    balance: "0.00",
    decimals: 6,
    contractAddress: "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    networkIds: ["ethereum"],
    source: "preset",
  },
  {
    id: "usdc-base",
    symbol: "USDC",
    name: "USD Coin",
    balance: "0.00",
    decimals: 6,
    contractAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    networkIds: ["base"],
    source: "preset",
  },
  {
    id: "usdc-optimism",
    symbol: "USDC",
    name: "USD Coin",
    balance: "0.00",
    decimals: 6,
    contractAddress: "0x0b2c639c533813f4aa9d7837caf62653d097ff85",
    networkIds: ["optimism"],
    source: "preset",
  },
  {
    id: "usdc-arbitrum",
    symbol: "USDC",
    name: "USD Coin",
    balance: "0.00",
    decimals: 6,
    contractAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    networkIds: ["arbitrum"],
    source: "preset",
  },
  {
    id: "usdt-ethereum",
    symbol: "USDT",
    name: "Tether",
    balance: "0.00",
    decimals: 6,
    contractAddress: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    networkIds: ["ethereum"],
    source: "preset",
  },
  {
    id: "dai-ethereum",
    symbol: "DAI",
    name: "Dai",
    balance: "0.00",
    decimals: 18,
    contractAddress: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
    networkIds: ["ethereum"],
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

function isPersistedTrackedToken(value: unknown): value is TrackedToken {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const token = value as Record<string, unknown>;

  return (
    typeof token.id === "string" &&
    typeof token.symbol === "string" &&
    typeof token.name === "string" &&
    typeof token.balance === "string" &&
    typeof token.decimals === "number" &&
    Number.isInteger(token.decimals) &&
    token.decimals >= 0 &&
    token.decimals <= 36 &&
    typeof token.contractAddress === "string" &&
    Array.isArray(token.networkIds) &&
    token.networkIds.every((entry) => typeof entry === "string")
  );
}

function hydrateCustomTrackedTokens(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isPersistedTrackedToken)
    .map((token) => ({
      ...token,
      source: "custom" as const,
    }));
}

function isPersistedActivityItem(value: unknown): value is ActivityItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const item = value as Record<string, unknown>;

  return (
    typeof item.id === "string" &&
    typeof item.title === "string" &&
    typeof item.subtitle === "string" &&
    (typeof item.accountId === "string" || typeof item.accountId === "undefined") &&
    (
      typeof item.accountAddress === "undefined" ||
      (typeof item.accountAddress === "string" && isAddress(item.accountAddress))
    ) &&
    (item.status === "pending" ||
      item.status === "complete" ||
      item.status === "reverted" ||
      item.status === "empty")
  );
}

function hydrateRecentActivity(value: unknown) {
  if (!Array.isArray(value)) {
    return defaultActivity;
  }

  const nextActivity = value
    .filter(isPersistedActivityItem)
    .filter((item) => item.id !== "empty-state")
    .slice(0, 12);

  return nextActivity.length > 0 ? nextActivity : defaultActivity;
}

function isPersistedAddressBookEntry(value: unknown): value is AddressBookEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const entry = value as Record<string, unknown>;

  return (
    typeof entry.id === "string" &&
    typeof entry.networkId === "string" &&
    typeof entry.label === "string" &&
    typeof entry.address === "string" &&
    isAddress(entry.address) &&
    typeof entry.note === "string" &&
    typeof entry.createdAt === "string" &&
    typeof entry.updatedAt === "string" &&
    (typeof entry.lastUsedAt === "string" || entry.lastUsedAt === null)
  );
}

function hydrateAddressBook(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isPersistedAddressBookEntry);
}

function getAddressBookSortValue(entry: AddressBookEntry) {
  return entry.lastUsedAt ?? entry.updatedAt ?? entry.createdAt;
}

export const useWalletStore = defineStore("wallet", () => {
  const sessionStore = useSessionStore();
  const { activeAccountId } = storeToRefs(sessionStore);
  const persistedScopeAccountId = ref<string | null>(activeAccountId.value);
  const trackedTokens = ref<TrackedToken[]>([...defaultTrackedTokens]);
  const recentActivity = ref<ActivityItem[]>(defaultActivity);
  const addressBook = ref<AddressBookEntry[]>([]);

  function applyWalletScopedState(accountId: string | null) {
    const persistedState = loadWalletScopedUiState(accountId);

    persistedScopeAccountId.value = accountId;
    trackedTokens.value = [
      ...hydrateCustomTrackedTokens(persistedState.customTokens),
      ...defaultTrackedTokens,
    ];
    recentActivity.value = hydrateRecentActivity(persistedState.recentActivity);
    addressBook.value = hydrateAddressBook(persistedState.addressBook);
  }

  applyWalletScopedState(activeAccountId.value);

  const trackedTokenCount = computed(() => trackedTokens.value.length);
  const addressBookCount = computed(() => addressBook.value.length);

  function tokensForNetwork(networkId: string) {
    return trackedTokens.value.filter((token) => token.networkIds.includes(networkId));
  }

  function contactsForNetwork(networkId: string) {
    return [...addressBook.value]
      .filter((entry) => entry.networkId === networkId)
      .sort((left, right) => {
        const leftSortValue = new Date(getAddressBookSortValue(left)).getTime();
        const rightSortValue = new Date(getAddressBookSortValue(right)).getTime();

        return rightSortValue - leftSortValue;
      });
  }

  function findTokenById(tokenId: string) {
    return trackedTokens.value.find((token) => token.id === tokenId) ?? null;
  }

  function findAddressBookEntry(networkId: string, address: string) {
    return (
      addressBook.value.find(
        (entry) =>
          entry.networkId === networkId && entry.address.toLowerCase() === address.trim().toLowerCase(),
      ) ?? null
    );
  }

  function resolveAddressBookLabel(networkId: string, address: string | null | undefined) {
    if (!address) {
      return null;
    }

    return findAddressBookEntry(networkId, address)?.label ?? null;
  }

  function formatActivityRecipient(options: {
    networkId?: string;
    address?: string | null;
    includeAddress?: boolean;
  }) {
    if (!options.address) {
      return null;
    }

    const shortenedAddress = shortenAddress(options.address);
    const contactLabel = options.networkId
      ? resolveAddressBookLabel(options.networkId, options.address)
      : null;

    if (!contactLabel) {
      return shortenedAddress;
    }

    return options.includeAddress ? `${contactLabel} (${shortenedAddress})` : contactLabel;
  }

  function formatActivityTitle(item: ActivityItem) {
    if (!item.recipientAddress || !item.assetSymbol) {
      return item.title;
    }

    const recipientLabel = formatActivityRecipient({
      networkId: item.networkId,
      address: item.recipientAddress,
    });

    if (!recipientLabel) {
      return item.title;
    }

    const statusLabel =
      item.status === "complete"
        ? "已确认"
        : item.status === "reverted"
          ? "已回退"
          : item.status === "pending"
            ? "已提交"
            : null;

    if (!statusLabel) {
      return item.title;
    }

    return `向 ${recipientLabel} 发送 ${item.assetSymbol} ${statusLabel}`;
  }

  function formatActivitySubtitle(item: ActivityItem, networkLabel?: string) {
    if (!item.recipientAddress) {
      return item.subtitle;
    }

    const recipientLabel = formatActivityRecipient({
      networkId: item.networkId,
      address: item.recipientAddress,
      includeAddress: true,
    });
    const activityParts = [
      networkLabel ?? item.networkId ?? "",
      item.amount && item.assetSymbol ? `${formatTokenAmount(item.amount)} ${item.assetSymbol}` : item.assetSymbol ?? "",
    ].filter(Boolean);

    if (!recipientLabel || activityParts.length === 0) {
      return item.status === "reverted" && !item.subtitle.includes("链上回退")
        ? `${item.subtitle} · 链上回退`
        : item.subtitle;
    }

    const subtitle = `${activityParts.join(" · ")} -> ${recipientLabel}`;

    return item.status === "reverted" ? `${subtitle} · 链上回退` : subtitle;
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

  function validateAddressBookDraft(draft: AddressBookDraft) {
    const errors: string[] = [];
    const normalizedLabel = draft.label.trim();
    const normalizedAddress = draft.address.trim();
    const normalizedNote = draft.note.trim();

    if (!normalizedLabel) {
      errors.push("联系人名称不能为空");
    } else if (normalizedLabel.length > 24) {
      errors.push("联系人名称不能超过 24 个字符");
    }

    if (!isAddress(normalizedAddress)) {
      errors.push("联系人地址必须是合法的 EVM 地址");
    }

    if (normalizedNote.length > 120) {
      errors.push("备注不能超过 120 个字符");
    }

    return {
      errors,
      normalizedAddress,
      normalizedLabel,
      normalizedNote,
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

  function removeCustomToken(tokenId: string) {
    const token = findTokenById(tokenId);

    if (!token) {
      return {
        ok: false as const,
        error: "当前找不到这个 Token",
      };
    }

    if (token.source !== "custom") {
      return {
        ok: false as const,
        error: "预置 Token 不能被移除",
      };
    }

    trackedTokens.value = trackedTokens.value.filter((entry) => entry.id !== tokenId);

    return {
      ok: true as const,
      error: "",
      token,
    };
  }

  function upsertAddressBookEntry(draft: AddressBookDraft) {
    const { errors, normalizedAddress, normalizedLabel, normalizedNote } = validateAddressBookDraft(draft);

    if (errors.length > 0) {
      return {
        ok: false as const,
        errors,
      };
    }

    const now = new Date().toISOString();
    const existingEntry = findAddressBookEntry(draft.networkId, normalizedAddress);

    if (existingEntry) {
      const nextEntry: AddressBookEntry = {
        ...existingEntry,
        label: normalizedLabel,
        note: normalizedNote,
        updatedAt: now,
      };

      addressBook.value = addressBook.value.map((entry) =>
        entry.id === existingEntry.id ? nextEntry : entry,
      );

      return {
        ok: true as const,
        errors: [],
        entry: nextEntry,
      };
    }

    const nextEntry: AddressBookEntry = {
      id: `contact-${draft.networkId}-${normalizedAddress.toLowerCase()}`,
      networkId: draft.networkId,
      label: normalizedLabel,
      address: normalizedAddress as `0x${string}`,
      note: normalizedNote,
      createdAt: now,
      updatedAt: now,
      lastUsedAt: null,
    };

    addressBook.value = [nextEntry, ...addressBook.value];

    return {
      ok: true as const,
      errors: [],
      entry: nextEntry,
    };
  }

  function removeAddressBookEntry(entryId: string) {
    addressBook.value = addressBook.value.filter((entry) => entry.id !== entryId);
  }

  function removeNetworkScopedData(networkId: string) {
    trackedTokens.value = trackedTokens.value.filter(
      (token) => token.source !== "custom" || !token.networkIds.includes(networkId),
    );

    const nextActivity = recentActivity.value.filter(
      (item) => item.id !== "empty-state" && item.networkId !== networkId,
    );
    recentActivity.value = nextActivity.length > 0 ? nextActivity : defaultActivity;

    addressBook.value = addressBook.value.filter((entry) => entry.networkId !== networkId);
  }

  function markAddressBookEntryUsed(options: {
    networkId: string;
    address: string;
  }) {
    const matchedEntry = findAddressBookEntry(options.networkId, options.address);

    if (!matchedEntry) {
      return;
    }

    const now = new Date().toISOString();
    addressBook.value = addressBook.value.map((entry) =>
      entry.id === matchedEntry.id
        ? {
            ...entry,
            lastUsedAt: now,
            updatedAt: now,
          }
        : entry,
    );
  }

  function prependActivity(item: ActivityItem) {
    const nextActivity = recentActivity.value.filter((activity) => activity.id !== "empty-state");
    recentActivity.value = [item, ...nextActivity].slice(0, 12);
  }

  function syncActivityStatus(options: {
    txHash: WalletHex;
    status: "pending" | "complete" | "reverted";
  }) {
    recentActivity.value = recentActivity.value.map((activity) => {
      if (activity.txHash !== options.txHash) {
        return activity;
      }

      const assetSymbol = activity.assetSymbol ?? "Transfer";
      const title =
        options.status === "complete"
          ? `${assetSymbol} 转账已确认`
          : options.status === "reverted"
            ? `${assetSymbol} 转账已回退`
            : activity.title;
      const subtitle =
        options.status === "reverted" && !activity.subtitle.includes("链上回退")
          ? `${activity.subtitle} · 链上回退`
          : activity.subtitle;

      return {
        ...activity,
        status: options.status,
        title,
        subtitle,
      };
    });
  }

  watch(
    trackedTokens,
    (nextTrackedTokens) => {
      patchWalletScopedUiState(persistedScopeAccountId.value, {
        customTokens: nextTrackedTokens.filter((token) => token.source === "custom"),
      });
    },
    {
      deep: true,
    },
  );

  watch(
    recentActivity,
    (nextRecentActivity) => {
      patchWalletScopedUiState(persistedScopeAccountId.value, {
        recentActivity: nextRecentActivity.filter((item) => item.id !== "empty-state"),
      });
    },
    {
      deep: true,
    },
  );

  watch(
    addressBook,
    (nextAddressBook) => {
      patchWalletScopedUiState(persistedScopeAccountId.value, {
        addressBook: nextAddressBook,
      });
    },
    {
      deep: true,
    },
  );

  watch(activeAccountId, (nextAccountId) => {
    applyWalletScopedState(nextAccountId);
  });

  return {
    addCustomToken,
    addTrackedToken,
    addressBook,
    addressBookCount,
    contactsForNetwork,
    findTokenById,
    findAddressBookEntry,
    formatActivityRecipient,
    formatActivitySubtitle,
    formatActivityTitle,
    markAddressBookEntryUsed,
    prependActivity,
    recentActivity,
    removeAddressBookEntry,
    removeCustomToken,
    removeNetworkScopedData,
    resolveAddressBookLabel,
    syncActivityStatus,
    trackedTokenCount,
    trackedTokens,
    tokensForNetwork,
    upsertAddressBookEntry,
    validateAddressBookDraft,
    validateTokenDraft,
  };
});
