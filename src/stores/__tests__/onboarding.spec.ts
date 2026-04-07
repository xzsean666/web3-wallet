import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useOnboardingStore } from "../onboarding";

const { loadPendingWalletDraftMock } = vi.hoisted(() => ({
  loadPendingWalletDraftMock: vi.fn(),
}));

vi.mock("../../services/walletBridge", () => ({
  loadPendingWalletDraft: loadPendingWalletDraftMock,
}));

const BACKUP_TOKEN_STORAGE_KEY = "web3-wallet/onboarding/backup-token/v1";

describe("onboarding store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    loadPendingWalletDraftMock.mockReset();
    window.sessionStorage.clear();
  });

  it("persists and restores the backup access token for pending backup flows", async () => {
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

    expect(window.sessionStorage.getItem(BACKUP_TOKEN_STORAGE_KEY)).toBe("backup-token");

    setActivePinia(createPinia());
    loadPendingWalletDraftMock.mockResolvedValueOnce({
      accountId: "account-1",
      derivationIndex: 0,
      walletLabel: "Primary Wallet",
      address: "0x1111111111111111111111111111111111111111",
      isBiometricEnabled: true,
      source: "created",
      secretKind: "mnemonic",
      createdAt: "2026-04-07T00:00:00.000Z",
    });

    const rehydratedStore = useOnboardingStore();
    await rehydratedStore.bootstrap();

    expect(rehydratedStore.backupAccessToken).toBe("backup-token");
    expect(rehydratedStore.hasPendingBackup).toBe(true);
  });

  it("clears the persisted backup token when the draft is cleared", () => {
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

    expect(window.sessionStorage.getItem(BACKUP_TOKEN_STORAGE_KEY)).toBeNull();
    expect(store.backupAccessToken).toBeNull();
  });
});
