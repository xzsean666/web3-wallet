import { computed, ref } from "vue";
import { defineStore } from "pinia";
import type { PortfolioSnapshot } from "../types/portfolio";

function buildSnapshotKey(networkId: string, accountAddress: string | null | undefined) {
  return `${networkId}:${accountAddress?.toLowerCase() ?? "__none__"}`;
}

const emptySnapshot = (
  networkId: string,
  accountAddress: string | null | undefined,
): PortfolioSnapshot => ({
  networkId,
  accountAddress: (accountAddress ?? null) as PortfolioSnapshot["accountAddress"],
  nativeBalance: "0",
  latestBlock: null,
  tokenBalances: {},
  lastSyncedAt: null,
  status: "idle",
  error: "",
});

export const usePortfolioStore = defineStore("portfolio", () => {
  const snapshots = ref<Record<string, PortfolioSnapshot>>({});

  const snapshotKeys = computed(() => Object.keys(snapshots.value));

  function getSnapshot(networkId: string, accountAddress: string | null | undefined) {
    return (
      snapshots.value[buildSnapshotKey(networkId, accountAddress)] ??
      emptySnapshot(networkId, accountAddress)
    );
  }

  function markLoading(options: {
    networkId: string;
    accountAddress: string | null | undefined;
  }) {
    const snapshotKey = buildSnapshotKey(options.networkId, options.accountAddress);
    const current = getSnapshot(options.networkId, options.accountAddress);

    snapshots.value = {
      ...snapshots.value,
      [snapshotKey]: {
        ...current,
        status: "loading",
        error: "",
      },
    };
  }

  function setSnapshot(snapshot: PortfolioSnapshot) {
    snapshots.value = {
      ...snapshots.value,
      [buildSnapshotKey(snapshot.networkId, snapshot.accountAddress)]: snapshot,
    };
  }

  function setError(options: {
    networkId: string;
    accountAddress: string | null | undefined;
    error: string;
  }) {
    const snapshotKey = buildSnapshotKey(options.networkId, options.accountAddress);
    const current = getSnapshot(options.networkId, options.accountAddress);

    snapshots.value = {
      ...snapshots.value,
      [snapshotKey]: {
        ...current,
        status: "error",
        error: options.error,
      },
    };
  }

  return {
    getSnapshot,
    markLoading,
    snapshotKeys,
    setError,
    setSnapshot,
    snapshots,
  };
});
