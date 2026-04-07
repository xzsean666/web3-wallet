import { defineComponent } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AddTokenPage from "../wallet/AddTokenPage.vue";
import { useWalletStore } from "../../stores/wallet";

const { readErc20TokenMetadataMock, routerReplaceMock } = vi.hoisted(() => ({
  readErc20TokenMetadataMock: vi.fn(),
  routerReplaceMock: vi.fn(),
}));

vi.mock("../../services/evm", () => ({
  readErc20TokenMetadata: readErc20TokenMetadataMock,
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
    replace: routerReplaceMock,
  }),
}));

const passthroughStub = defineComponent({
  template: "<div><slot /><slot name='actions' /></div>",
});

describe("AddTokenPage", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    readErc20TokenMetadataMock.mockReset();
    routerReplaceMock.mockReset();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("always saves the verified on-chain decimals even if the field is edited afterwards", async () => {
    readErc20TokenMetadataMock.mockResolvedValue({
      name: "Mock USD",
      symbol: "MUSD",
      decimals: 6,
    });

    const walletStore = useWalletStore();
    const addCustomTokenSpy = vi.spyOn(walletStore, "addCustomToken");

    const wrapper = mount(AddTokenPage, {
      global: {
        stubs: {
          SectionCard: passthroughStub,
          WalletChrome: passthroughStub,
        },
      },
    });

    await wrapper.get('input[placeholder="0x..."]').setValue(
      "0x5555555555555555555555555555555555555555",
    );
    await wrapper.get('button[type="button"]').trigger("click");
    await flushPromises();

    await wrapper.get('input[readonly]').setValue("18");
    await wrapper.get('button[type="submit"]').trigger("submit");
    await flushPromises();

    expect(addCustomTokenSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        contractAddress: "0x5555555555555555555555555555555555555555",
        decimals: "6",
        name: "Mock USD",
        symbol: "MUSD",
      }),
    );
    expect(routerReplaceMock).toHaveBeenCalledWith("/wallet");
  });
});
