import { computed, ref } from "vue";
import { defineStore } from "pinia";
import type { PortfolioSnapshot } from "../types/portfolio";

const emptySnapshot = (networkId: string): PortfolioSnapshot => ({
  networkId,
  nativeBalance: "0",
  latestBlock: null,
  tokenBalances: {},
  lastSyncedAt: null,
  status: "idle",
  error: "",
});

export const usePortfolioStore = defineStore("portfolio", () => {
  const snapshots = ref<Record<string, PortfolioSnapshot>>({});

  const networkIds = computed(() => Object.keys(snapshots.value));

  function getSnapshot(networkId: string) {
    return snapshots.value[networkId] ?? emptySnapshot(networkId);
  }

  function markLoading(networkId: string) {
    const current = getSnapshot(networkId);

    snapshots.value = {
      ...snapshots.value,
      [networkId]: {
        ...current,
        status: "loading",
        error: "",
      },
    };
  }

  function setSnapshot(snapshot: PortfolioSnapshot) {
    snapshots.value = {
      ...snapshots.value,
      [snapshot.networkId]: snapshot,
    };
  }

  function setError(networkId: string, error: string) {
    const current = getSnapshot(networkId);

    snapshots.value = {
      ...snapshots.value,
      [networkId]: {
        ...current,
        status: "error",
        error,
      },
    };
  }

  return {
    getSnapshot,
    markLoading,
    networkIds,
    setError,
    setSnapshot,
    snapshots,
  };
});

