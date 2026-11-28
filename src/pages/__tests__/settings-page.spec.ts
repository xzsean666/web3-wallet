import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, defineStore, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { ref } from "vue";
import PatternLock from "../../components/PatternLock.vue";
import SettingsPage from "../settings/SettingsPage.vue";
import {
  clearPatternLock,
  getPatternUnlockPassword,
  hasPatternLock,
  savePatternLock,
} from "../../services/patternLock";

const { unlockWalletMock, getAppOverviewMock, lockWalletMock } = vi.hoisted(() => ({
  unlockWalletMock: vi.fn(),
  getAppOverviewMock: vi.fn(),
  lockWalletMock: vi.fn(),
}));

vi.mock("../../services/walletBridge", () => ({
  unlockWallet: unlockWalletMock,
}));

vi.mock("../../services/system", () => ({
  getAppOverview: getAppOverviewMock,
}));

vi.mock("../../stores/session", () => ({
  useSessionStore: defineStore("session", () => ({
    activeAccountId: ref("acc-1"),
    hasBackedUpMnemonic: ref(true),
    primaryAddress: ref("0x1111111111111111111111111111111111111111"),
    walletLabel: ref("主钱包"),
    walletSecretKind: ref<"mnemonic" | "privateKey">("mnemonic"),
    lockWallet: lockWalletMock,
  })),
}));

vi.mock("../../stores/networks", () => ({
  useNetworksStore: defineStore("networks", () => ({
    activeNetwork: ref({
      id: "ethereum",
      name: "Ethereum Mainnet",
      symbol: "ETH",
      chainId: 1,
      rpcUrl: "https://ethereum-rpc.publicnode.com/",
      source: "preset",
    }),
  })),
}));

function buildRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/settings", component: SettingsPage },
      { path: "/wallet", component: { template: "<div>Wallet</div>" } },
      { path: "/wallet/send", component: { template: "<div>Send</div>" } },
      { path: "/wallet/receive", component: { template: "<div>Receive</div>" } },
      { path: "/wallet/activity", component: { template: "<div>Activity</div>" } },
      { path: "/unlock", component: { template: "<div>Unlock</div>" } },
      { path: "/settings/accounts", component: { template: "<div>Accounts</div>" } },
      { path: "/settings/networks", component: { template: "<div>Networks</div>" } },
      { path: "/settings/address-book", component: { template: "<div>AddressBook</div>" } },
    ],
  });
}

describe("SettingsPage", () => {
  beforeEach(() => {
    localStorage.clear();
    clearPatternLock("acc-1");
    setActivePinia(createPinia());
    unlockWalletMock.mockReset();
    getAppOverviewMock.mockReset();
    getAppOverviewMock.mockResolvedValue({ appVersion: "0.1.11" });
    lockWalletMock.mockReset();
  });

  it("renders non-wrapping pattern status and places lock button outside 安全与锁屏 card", async () => {
    const router = buildRouter();
    await router.push("/settings");
    await router.isReady();

    const wrapper = mount(SettingsPage, {
      global: {
        plugins: [router],
      },
    });
    await flushPromises();

    const chip = wrapper.find(".settings-pattern-title .status-chip--nowrap");
    expect(chip.exists()).toBe(true);
    expect(chip.text()).toBe("未设置");

    const setupBtn = wrapper.findAll("button").find((item) => item.text() === "设置手势");
    expect(setupBtn).toBeTruthy();

    const lockSection = wrapper.find(".settings-lock-section");
    expect(lockSection.exists()).toBe(true);
    const lockBtn = lockSection.find("button");
    expect(lockBtn.text()).toContain("锁定钱包");
    expect(lockBtn.element.closest(".section-card")).toBeNull();
  });

  it("verifies password first, shows PatternLock only afterward, and requires explicit confirmation click", async () => {
    const router = buildRouter();
    await router.push("/settings");
    await router.isReady();

    const wrapper = mount(SettingsPage, {
      global: {
        plugins: [router],
      },
    });
    await flushPromises();

    await wrapper
      .findAll("button")
      .find((item) => item.text() === "设置手势")!
      .trigger("click");

    // Step 1: password input visible, PatternLock hidden
    expect(wrapper.find('input[placeholder="请输入当前钱包密码"]').exists()).toBe(true);
    expect(wrapper.findComponent(PatternLock).exists()).toBe(false);

    // Wrong password stays on step 1
    unlockWalletMock.mockResolvedValueOnce(null);
    await wrapper.find('input[placeholder="请输入当前钱包密码"]').setValue("wrong-pass");
    await wrapper.find("form.settings-pattern-password-form").trigger("submit");
    await flushPromises();

    expect(unlockWalletMock).toHaveBeenCalledWith({
      accountId: "acc-1",
      password: "wrong-pass",
    });
    expect(wrapper.text()).toContain("钱包密码不正确，请重新输入");
    expect(wrapper.findComponent(PatternLock).exists()).toBe(false);

    // Correct password (with leading/trailing spaces preserved) advances to draw step
    unlockWalletMock.mockResolvedValueOnce({
      accountId: "acc-1",
      walletLabel: "主钱包",
      primaryAddress: "0x1111111111111111111111111111111111111111",
      hasBackedUpMnemonic: true,
      secretKind: "mnemonic",
    });
    await wrapper.find('input[placeholder="请输入当前钱包密码"]').setValue("  secret-pass  ");
    await wrapper.find("form.settings-pattern-password-form").trigger("submit");
    await flushPromises();

    expect(unlockWalletMock).toHaveBeenLastCalledWith({
      accountId: "acc-1",
      password: "  secret-pass  ",
    });
    const patternComp = wrapper.findComponent(PatternLock);
    expect(patternComp.exists()).toBe(true);
    expect(wrapper.text()).toContain("第 2 步：绘制新手势连线");

    // Fewer than 4 dots rejected
    patternComp.vm.$emit("completed", [0, 1, 2]);
    await flushPromises();
    expect(wrapper.text()).toContain("手势连线至少需要连接 4 个点");

    // Valid first draw moves to confirm step
    patternComp.vm.$emit("completed", [0, 1, 4, 7]);
    await flushPromises();
    expect(wrapper.text()).toContain("第 3 步：请再次绘制相同手势确认");

    // Mismatched confirm draw shows mismatch error
    patternComp.vm.$emit("completed", [0, 3, 6, 7]);
    await flushPromises();
    expect(wrapper.text()).toContain("两次绘制手势不一致");

    // Matching confirm draw moves to explicit confirm step without saving yet
    patternComp.vm.$emit("completed", [0, 1, 4, 7]);
    await flushPromises();
    expect(wrapper.text()).toContain("第 4 步：手势已确认，点击保存生效");
    expect(hasPatternLock("acc-1")).toBe(false);

    const confirmBtn = wrapper
      .findAll("button")
      .find((item) => item.text() === "确认保存手势");
    expect(confirmBtn).toBeTruthy();

    await confirmBtn!.trigger("click");
    await vi.waitFor(() => {
      expect(hasPatternLock("acc-1")).toBe(true);
    });
    await flushPromises();

    expect(await getPatternUnlockPassword("acc-1", [0, 1, 4, 7])).toBe("  secret-pass  ");
    expect(wrapper.text()).toContain("手势连线密码已成功设置");
    expect(wrapper.find(".settings-pattern-drawer").exists()).toBe(false);
    expect(wrapper.find(".settings-pattern-title .status-chip--nowrap").text()).toBe("已设置");
  });

  it("supports two-step pattern removal and standalone lock action", async () => {
    await savePatternLock("acc-1", [0, 1, 2, 5], "pass-123");

    const router = buildRouter();
    await router.push("/settings");
    await router.isReady();

    const wrapper = mount(SettingsPage, {
      global: {
        plugins: [router],
      },
    });
    await flushPromises();

    expect(wrapper.find(".settings-pattern-title .status-chip--nowrap").text()).toBe("已设置");
    expect(wrapper.findAll("button").some((item) => item.text() === "修改手势")).toBe(true);

    await wrapper
      .findAll("button")
      .find((item) => item.text() === "清除")!
      .trigger("click");
    expect(hasPatternLock("acc-1")).toBe(true);

    await wrapper
      .findAll("button")
      .find((item) => item.text() === "确认清除")!
      .trigger("click");
    expect(hasPatternLock("acc-1")).toBe(false);
    expect(wrapper.find(".settings-pattern-title .status-chip--nowrap").text()).toBe("未设置");

    await wrapper.find(".settings-lock-btn").trigger("click");
    await flushPromises();
    expect(lockWalletMock).toHaveBeenCalledTimes(1);
    expect(router.currentRoute.value.path).toBe("/unlock");
  });
});
