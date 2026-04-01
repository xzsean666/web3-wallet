import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useWalletStore } from "../wallet";

describe("wallet store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("adds a valid custom token", () => {
    const store = useWalletStore();

    const result = store.addCustomToken({
      networkId: "ethereum",
      name: "Custom Dollar",
      symbol: "CD",
      decimals: "18",
      contractAddress: "0x1111111111111111111111111111111111111111",
    });

    expect(result.ok).toBe(true);
    expect(store.trackedTokens.some((token) => token.symbol === "CD")).toBe(true);
  });

  it("rejects invalid token drafts", () => {
    const store = useWalletStore();

    const result = store.addCustomToken({
      networkId: "ethereum",
      name: "",
      symbol: "",
      decimals: "100",
      contractAddress: "abc",
    });

    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
