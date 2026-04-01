import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useSessionStore } from "../session";

const { unlockWalletMock } = vi.hoisted(() => ({
  unlockWalletMock: vi.fn(),
}));

vi.mock("../../services/walletBridge", () => ({
  isTauriWalletRuntime: vi.fn(() => false),
  loadWalletProfile: vi.fn(async () => null),
  unlockWallet: unlockWalletMock,
  updateBiometricSetting: vi.fn(async () => null),
}));

describe("session store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    unlockWalletMock.mockReset();
  });

  it("locks and unlocks a wallet session", async () => {
    const store = useSessionStore();

    const profile = {
      walletLabel: "Primary Wallet",
      address: "0x1234567890abcdef1234567890abcdef12345678" as const,
      isBiometricEnabled: true,
      source: "created" as const,
      secretKind: "mnemonic" as const,
      hasBackedUpMnemonic: true,
      createdAt: new Date().toISOString(),
      lastUnlockedAt: new Date().toISOString(),
    };

    store.applyWalletProfile(profile, { unlocked: true });

    expect(store.isUnlocked).toBe(true);

    store.lockWallet();
    expect(store.isUnlocked).toBe(false);

    unlockWalletMock.mockResolvedValueOnce(null);
    unlockWalletMock.mockResolvedValueOnce(profile);

    expect(await store.unlockWallet("wrong-secret")).toBe(false);
    expect(await store.unlockWallet("super-secret")).toBe(true);
  });
});
