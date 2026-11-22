import { defineComponent } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import UnlockWalletPage from "../onboarding/UnlockWalletPage.vue";
import PatternLock from "../../components/PatternLock.vue";
import { savePatternLock } from "../../services/patternLock";
import { useSessionStore } from "../../stores/session";

const routerReplaceMock = vi.fn();

vi.mock("vue-router", () => ({
  RouterLink: defineComponent({
    name: "RouterLink",
    props: {
      to: {
        type: [String, Object],
        required: false,
        default: "",
      },
    },
    template: "<a><slot /></a>",
  }),
  useRouter: () => ({
    replace: routerReplaceMock,
  }),
}));

function setupTestWallet() {
  const sessionStore = useSessionStore();
  const accountId = "account-unlock-test";

  sessionStore.applyWalletSession(
    {
      activeAccountId: accountId,
      accounts: [
        {
          accountId,
          derivationGroupId: accountId,
          derivationIndex: 0,
          walletLabel: "Test Wallet",
          address: "0x1111111111111111111111111111111111111111",
          source: "created",
          secretKind: "mnemonic",
          isBiometricEnabled: true,
          hasBackedUpMnemonic: true,
          createdAt: "2026-04-07T00:00:00.000Z",
          lastUnlockedAt: null,
        },
      ],
    },
    { unlocked: false },
  );

  return { sessionStore, accountId };
}

describe("UnlockWalletPage", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    window.localStorage.clear();
    routerReplaceMock.mockReset();
  });

  it("defaults to password unlock when pattern lock is not configured", async () => {
    setupTestWallet();

    const wrapper = mount(UnlockWalletPage);
    await flushPromises();

    expect(wrapper.find('input[type="password"]').exists()).toBe(true);
    expect(wrapper.findComponent(PatternLock).exists()).toBe(false);
    // Ensure biometric quick unlock button is completely gone
    expect(wrapper.text()).not.toContain("生物识别快速解锁");
  });

  it("defaults to pattern unlock when account has gesture pattern configured", async () => {
    const { accountId } = setupTestWallet();
    await savePatternLock(accountId, [0, 1, 2, 5, 8], "vault-pass-123");

    const wrapper = mount(UnlockWalletPage);
    await flushPromises();

    // Default mode must be gesture pattern
    expect(wrapper.text()).toContain("绘制手势连线解锁");
    expect(wrapper.findComponent(PatternLock).exists()).toBe(true);
    // Ensure biometric quick unlock button is not present
    expect(wrapper.text()).not.toContain("生物识别快速解锁");
  });

  it("allows switching between pattern and password unlock modes", async () => {
    const { accountId } = setupTestWallet();
    await savePatternLock(accountId, [0, 1, 2, 5, 8], "vault-pass-123");

    const wrapper = mount(UnlockWalletPage);
    await flushPromises();

    expect(wrapper.findComponent(PatternLock).exists()).toBe(true);

    // Click password mode tab
    const pwdTab = wrapper.findAll("button").find((b) => b.text().includes("密码解锁"));
    expect(pwdTab).toBeDefined();
    await pwdTab!.trigger("click");
    await flushPromises();

    expect(wrapper.find('input[type="password"]').exists()).toBe(true);
  });

  it("opens reset wallet modal and handles wallet reset", async () => {
    const { sessionStore } = setupTestWallet();
    const resetWalletSpy = vi.spyOn(sessionStore, "resetWallet").mockResolvedValue();

    const wrapper = mount(UnlockWalletPage);
    await flushPromises();

    const resetBtn = wrapper.findAll("button").find((b) => b.text().includes("重置钱包"));
    expect(resetBtn).toBeDefined();
    await resetBtn!.trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("重置将清除本地保存的所有钱包数据");

    const confirmBtn = wrapper.findAll("button").find((b) => b.text().includes("确认重置"));
    expect(confirmBtn).toBeDefined();
    await confirmBtn!.trigger("click");
    await flushPromises();

    expect(resetWalletSpy).toHaveBeenCalled();
    expect(routerReplaceMock).toHaveBeenCalledWith("/welcome");
  });
});
