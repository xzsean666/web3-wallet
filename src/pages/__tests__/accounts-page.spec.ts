import { defineComponent } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AccountsPage from "../settings/AccountsPage.vue";
import { clearPersistedUiState } from "../../services/uiState";
import { useSessionStore } from "../../stores/session";

const { deriveMnemonicAccountMock, routerPushMock } = vi.hoisted(() => ({
  deriveMnemonicAccountMock: vi.fn(),
  routerPushMock: vi.fn(),
}));

vi.mock("../../services/walletBridge", () => ({
  deriveMnemonicAccount: deriveMnemonicAccountMock,
}));

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
    push: routerPushMock,
  }),
}));

const passthroughStub = defineComponent({
  template: "<div><slot /><slot name='actions' /></div>",
});

function applyAccountSession() {
  const sessionStore = useSessionStore();
  sessionStore.applyWalletSession(
    {
      activeAccountId: "account-1",
      accounts: [
        {
          accountId: "account-1",
          derivationGroupId: "account-1",
          derivationIndex: 0,
          walletLabel: "Primary Wallet",
          address: "0x1111111111111111111111111111111111111111",
          source: "created",
          secretKind: "mnemonic",
          isBiometricEnabled: true,
          hasBackedUpMnemonic: true,
          createdAt: "2026-04-07T00:00:00.000Z",
          lastUnlockedAt: "2026-04-07T00:00:00.000Z",
        },
        {
          accountId: "account-2",
          derivationGroupId: "account-2",
          derivationIndex: 0,
          walletLabel: "Ops Wallet",
          address: "0x2222222222222222222222222222222222222222",
          source: "imported",
          secretKind: "privateKey",
          isBiometricEnabled: false,
          hasBackedUpMnemonic: false,
          createdAt: "2026-04-07T01:00:00.000Z",
          lastUnlockedAt: "2026-04-07T01:00:00.000Z",
        },
      ],
    },
    { unlocked: true },
  );

  return sessionStore;
}

function findButtonByText(wrapper: ReturnType<typeof mount>, text: string) {
  return wrapper.findAll("button").find((button) => button.text().includes(text));
}

describe("AccountsPage", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    clearPersistedUiState();
    deriveMnemonicAccountMock.mockReset();
    routerPushMock.mockReset();
  });

  it("submits the derive form and applies the returned profile", async () => {
    const sessionStore = applyAccountSession();
    deriveMnemonicAccountMock.mockResolvedValue({
      accountId: "account-3",
      derivationGroupId: "account-1",
      derivationIndex: 1,
      walletLabel: "Primary Wallet / 1",
      address: "0x3333333333333333333333333333333333333333",
      source: "created",
      secretKind: "mnemonic",
      isBiometricEnabled: true,
      hasBackedUpMnemonic: true,
      createdAt: "2026-04-07T02:00:00.000Z",
      lastUnlockedAt: "2026-04-07T02:00:00.000Z",
    });

    const wrapper = mount(AccountsPage, {
      global: {
        stubs: {
          SectionCard: passthroughStub,
          WalletChrome: passthroughStub,
        },
      },
    });

    await findButtonByText(wrapper, "派生新地址")!.trigger("click");
    await wrapper.get('input[placeholder="例如 Trading Account / 1"]').setValue("Primary Wallet / 1");
    await wrapper.get('input[placeholder="输入当前助记词账号密码"]').setValue("super-secret");
    await findButtonByText(wrapper, "确认派生")!.trigger("click");
    await flushPromises();

    expect(deriveMnemonicAccountMock).toHaveBeenCalledWith({
      sourceAccountId: "account-1",
      walletLabel: "Primary Wallet / 1",
      password: "super-secret",
    });
    expect(sessionStore.activeAccountId).toBe("account-3");
    expect(routerPushMock).toHaveBeenCalledWith("/wallet");
  });

  it("submits the delete flow and routes to unlock when deleting the active account", async () => {
    const sessionStore = applyAccountSession();
    const deleteWalletAccountSpy = vi.spyOn(sessionStore, "deleteWalletAccount").mockResolvedValue({
      ok: true,
      removedAll: false,
      requiresUnlock: true,
      errorMessage: "",
    });

    const wrapper = mount(AccountsPage, {
      global: {
        stubs: {
          SectionCard: passthroughStub,
          WalletChrome: passthroughStub,
        },
      },
    });

    await findButtonByText(wrapper, "删除账号")!.trigger("click");
    await wrapper.get('input[placeholder="输入当前账号名称以确认"]').setValue("Primary Wallet");
    await wrapper.get('input[placeholder="输入当前账号的钱包密码"]').setValue("super-secret");
    await findButtonByText(wrapper, "确认删除")!.trigger("click");
    await flushPromises();

    expect(deleteWalletAccountSpy).toHaveBeenCalledWith("account-1", "super-secret");
    expect(routerPushMock).toHaveBeenCalledWith("/unlock");
  });
});
