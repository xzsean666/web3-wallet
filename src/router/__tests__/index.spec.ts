import { beforeEach, describe, expect, it } from "vitest";
import { pinia } from "../../stores";
import { useOnboardingStore } from "../../stores/onboarding";
import { useSessionStore } from "../../stores/session";
import { router } from "../index";

function applyWalletSession(unlocked: boolean) {
  useSessionStore(pinia).applyWalletSession(
    {
      activeAccountId: "account-1",
      accounts: [
        {
          accountId: "account-1",
          derivationGroupId: "account-1",
          derivationIndex: 0,
          walletLabel: "Primary Wallet",
          address: "0x1111111111111111111111111111111111111111",
          isBiometricEnabled: true,
          source: "created",
          secretKind: "mnemonic",
          hasBackedUpMnemonic: true,
          createdAt: "2026-04-06T00:00:00.000Z",
          lastUnlockedAt: "2026-04-06T00:00:00.000Z",
        },
      ],
    },
    { unlocked },
  );
}

describe("router guards", () => {
  beforeEach(async () => {
    useSessionStore(pinia).resetSession();
    useOnboardingStore(pinia).clearDraft();
    await router.replace("/welcome");
  });

  it("redirects protected wallet routes to welcome when no wallet exists", async () => {
    await router.push("/wallet");
    expect(router.currentRoute.value.fullPath).toBe("/welcome");

    await router.push("/unlock");
    expect(router.currentRoute.value.fullPath).toBe("/welcome");
  });

  it("redirects locked wallet sessions to unlock", async () => {
    applyWalletSession(false);

    await router.push("/wallet/send");
    expect(router.currentRoute.value.fullPath).toBe("/unlock");
  });

  it("redirects guest-only routes away from existing wallets", async () => {
    applyWalletSession(false);
    await router.push("/onboarding/create");
    expect(router.currentRoute.value.fullPath).toBe("/unlock");

    applyWalletSession(true);
    await router.push("/onboarding/import");
    expect(router.currentRoute.value.fullPath).toBe("/wallet");
  });

  it("blocks backup routes when there is no pending backup session", async () => {
    applyWalletSession(true);

    await router.push("/onboarding/backup");
    expect(router.currentRoute.value.fullPath).toBe("/wallet");
  });
});
