import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useNetworksStore } from "../networks";

describe("networks store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("rejects invalid custom network drafts", () => {
    const store = useNetworksStore();

    const result = store.saveCustomNetwork({
      name: "",
      chainId: "-1",
      rpcUrl: "abc",
      symbol: "",
      explorerUrl: "ftp://scan.example.org",
    });

    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("adds and removes a custom network", () => {
    const store = useNetworksStore();

    const createResult = store.saveCustomNetwork({
      name: "Local Rollup",
      chainId: "31337",
      rpcUrl: "https://rpc.local-rollup.dev",
      symbol: "LRC",
      explorerUrl: "https://scan.local-rollup.dev",
    });

    expect(createResult.ok).toBe(true);
    expect(store.customNetworks.length).toBe(1);

    store.removeCustomNetwork("custom-31337");

    expect(store.customNetworks.length).toBe(0);
    expect(store.activeNetworkId).toBe("ethereum");
  });
});

