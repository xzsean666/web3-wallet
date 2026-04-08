import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useOnboardingStore } from "../onboarding";

const { loadPendingWalletSessionMock } = vi.hoisted(() => ({
  loadPendingWalletSessionMock: vi.fn(),
}));

vi.mock("../../services/walletBridge", () => ({
  loadPendingWalletSession: loadPendingWalletSessionMock,
}));

describe("onboarding store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    loadPendingWalletSessionMock.mockReset();
  });

  it("stores the backup access token in memory and restores it from the bridge session", async () => {
    const store = useOnboardingStore();

    store.stageDraft({
      draft: {
        accountId: "account-1",
        derivationIndex: 0,
        walletLabel: "Primary Wallet",
        address: "0x1111111111111111111111111111111111111111",
        isBiometricEnabled: true,
        source: "created",
        secretKind: "mnemonic",
        createdAt: "2026-04-07T00:00:00.000Z",
      },
      backupAccessToken: "backup-token",
    });

    expect(store.backupAccessToken).toBe("backup-token");

    setActivePinia(createPinia());
    loadPendingWalletSessionMock.mockResolvedValueOnce({
      draft: {
        accountId: "account-1",
        derivationIndex: 0,
        walletLabel: "Primary Wallet",
        address: "0x1111111111111111111111111111111111111111",
        isBiometricEnabled: true,
        source: "created",
        secretKind: "mnemonic",
        createdAt: "2026-04-07T00:00:00.000Z",
      },
      backupAccessToken: "backup-token",
    });

    const rehydratedStore = useOnboardingStore();
    await rehydratedStore.bootstrap();

    expect(rehydratedStore.backupAccessToken).toBe("backup-token");
    expect(rehydratedStore.hasPendingBackup).toBe(true);
  });

  it("clears the in-memory backup token when the draft is cleared", () => {
    const store = useOnboardingStore();

    store.stageDraft({
      draft: {
        accountId: "account-1",
        derivationIndex: 0,
        walletLabel: "Primary Wallet",
        address: "0x1111111111111111111111111111111111111111",
        isBiometricEnabled: true,
        source: "created",
        secretKind: "mnemonic",
        createdAt: "2026-04-07T00:00:00.000Z",
      },
      backupAccessToken: "backup-token",
    });

    store.clearDraft();

    expect(store.backupAccessToken).toBeNull();
  });
});
