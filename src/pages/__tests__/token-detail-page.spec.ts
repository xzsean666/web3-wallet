import { computed, defineComponent } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TokenDetailPage from "../wallet/TokenDetailPage.vue";
import { clearPersistedUiState } from "../../services/uiState";
import { useSessionStore } from "../../stores/session";

const { fetchPortfolioSnapshotMock, routeParamsMock, routerReplaceMock } = vi.hoisted(() => ({
  fetchPortfolioSnapshotMock: vi.fn(),
  routeParamsMock: {
    tokenId: "native",
  } as Record<string, string>,
  routerReplaceMock: vi.fn(),
}));

vi.mock("../../services/evm", () => ({
  fetchPortfolioSnapshot: fetchPortfolioSnapshotMock,
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: vi.fn(() => false),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
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
    setup(props) {
      const serializedTo = computed(() => JSON.stringify(props.to));

      return {
        serializedTo,
      };
    },
    template: "<a :data-to='serializedTo'><slot /></a>",
  }),
  useRoute: () => ({
    params: routeParamsMock,
  }),
  useRouter: () => ({
    replace: routerReplaceMock,
  }),
}));

const passthroughStub = defineComponent({
  template: "<div><slot /><slot name='actions' /></div>",
});

function bootstrapTokenSession() {
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
      ],
    },
    { unlocked: true },
  );

  fetchPortfolioSnapshotMock.mockResolvedValue({
    networkId: "ethereum",
    accountAddress: "0x1111111111111111111111111111111111111111",
    nativeBalance: "10",
    latestBlock: "123",
    tokenBalances: {},
    lastSyncedAt: "2026-04-07T00:00:00.000Z",
    status: "ready",
    error: "",
  });
}

describe("TokenDetailPage", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    clearPersistedUiState();
    window.localStorage.clear();
    fetchPortfolioSnapshotMock.mockReset();
    routerReplaceMock.mockReset();
    routeParamsMock.tokenId = "native";
  });

  it("links asset scan actions to the send page with scan enabled", async () => {
    bootstrapTokenSession();

    const wrapper = mount(TokenDetailPage, {
      global: {
        stubs: {
          SectionCard: passthroughStub,
          WalletChrome: passthroughStub,
        },
      },
    });

    await flushPromises();

    const scanLinks = wrapper
      .findAll("a")
      .filter((link) => link.text().includes("扫码"));

    expect(scanLinks.length).toBeGreaterThanOrEqual(1);
    expect(scanLinks[0].attributes("data-to")).toContain('"name":"wallet-send"');
    expect(scanLinks[0].attributes("data-to")).toContain('"asset":"native"');
    expect(scanLinks[0].attributes("data-to")).toContain('"scan":"1"');
  });
});
