import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useAppStore } from "../app";

describe("app store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("exposes scaffold metadata", () => {
    const store = useAppStore();

    expect(store.projectName).toBe("Web3 Wallet");
    expect(store.status).toBe("Scaffolded");
    expect(store.targetPlatforms).toContain("Android");
  });
});

