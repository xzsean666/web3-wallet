import { expect, type Page } from "@playwright/test";
import { encodeAbiParameters } from "viem";

export const WALLET_PASSWORD = "super-secret";
export const TEST_MNEMONIC =
  "legal winner thank year wave sausage worth useful legal winner thank yellow";

const DEFAULT_ETHEREUM_RPC_URL = "https://ethereum-rpc.publicnode.com";
const ERC20_NAME_SELECTOR = "0x06fdde03";
const ERC20_SYMBOL_SELECTOR = "0x95d89b41";
const ERC20_DECIMALS_SELECTOR = "0x313ce567";
const ERC20_BALANCE_OF_SELECTOR = "0x70a08231";

type RpcMockResponse =
  | {
      result: unknown;
    }
  | {
      error: {
        code: number;
        message: string;
      };
    };

type EthereumRpcMockOptions = {
  latestBlockHex?: `0x${string}`;
  nativeBalanceHex?: `0x${string}`;
  trackedToken?: {
    address: `0x${string}`;
    name: string;
    symbol: string;
    decimals: number;
    balanceHex?: `0x${string}`;
  };
};

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rpcPattern(rpcUrl: string) {
  const parsed = new URL(rpcUrl);
  const pathname = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "");
  return new RegExp(`^${escapeRegex(`${parsed.origin}${pathname}`)}\/?(?:\\?.*)?$`);
}

function encodeStringResult(value: string) {
  return encodeAbiParameters([{ type: "string" }], [value]);
}

function encodeUint8Result(value: number) {
  return encodeAbiParameters([{ type: "uint8" }], [value]);
}

function encodeUint256Result(valueHex: `0x${string}`) {
  return valueHex;
}

export async function mockJsonRpc(
  page: Page,
  rpcUrl: string,
  responder: (method: string, params: unknown[]) => RpcMockResponse,
) {
  await page.route(rpcPattern(rpcUrl), async (route) => {
    const payload = route.request().postDataJSON() as {
      id?: string | number | null;
      method: string;
      params?: unknown[];
    };
    const response = responder(payload.method, payload.params ?? []);

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        "error" in response
          ? {
              jsonrpc: "2.0",
              id: payload.id ?? null,
              error: response.error,
            }
          : {
              jsonrpc: "2.0",
              id: payload.id ?? null,
              result: response.result,
            },
      ),
    });
  });
}

export async function setupDefaultEthereumRpcMock(
  page: Page,
  options: EthereumRpcMockOptions = {},
) {
  await mockJsonRpc(page, DEFAULT_ETHEREUM_RPC_URL, (method, params) => {
    switch (method) {
      case "eth_chainId":
        return { result: "0x1" };
      case "eth_blockNumber":
        return { result: options.latestBlockHex ?? "0x1234" };
      case "eth_getBalance":
        return { result: options.nativeBalanceHex ?? "0x14d1120d7b160000" };
      case "eth_call": {
        const request = (params[0] ?? {}) as {
          to?: string;
          data?: string;
        };
        const targetAddress = request.to?.toLowerCase();
        const callData = request.data?.toLowerCase() ?? "";
        const trackedToken = options.trackedToken;

        if (
          trackedToken &&
          targetAddress === trackedToken.address.toLowerCase()
        ) {
          if (callData.startsWith(ERC20_NAME_SELECTOR)) {
            return { result: encodeStringResult(trackedToken.name) };
          }

          if (callData.startsWith(ERC20_SYMBOL_SELECTOR)) {
            return { result: encodeStringResult(trackedToken.symbol) };
          }

          if (callData.startsWith(ERC20_DECIMALS_SELECTOR)) {
            return { result: encodeUint8Result(trackedToken.decimals) };
          }

          if (callData.startsWith(ERC20_BALANCE_OF_SELECTOR)) {
            return {
              result: encodeUint256Result(trackedToken.balanceHex ?? "0x0"),
            };
          }
        }

        if (callData.startsWith(ERC20_BALANCE_OF_SELECTOR)) {
          return { result: "0x0" };
        }

        return {
          error: {
            code: -32000,
            message: "unsupported eth_call",
          },
        };
      }
      default:
        return {
          error: {
            code: -32601,
            message: `unsupported rpc method: ${method}`,
          },
        };
    }
  });
}

export async function createFreshWallet(
  page: Page,
  walletLabel = "Preview Wallet",
  rpcOptions?: EthereumRpcMockOptions,
) {
  await setupDefaultEthereumRpcMock(page, rpcOptions);
  await page.goto("/");
  await page.getByRole("link", { name: "创建钱包" }).click();
  await page.getByLabel("钱包名称").fill(walletLabel);
  await page.getByLabel("钱包密码").fill(WALLET_PASSWORD);
  await page.getByLabel("确认密码").fill(WALLET_PASSWORD);
  await page.getByRole("button", { name: "继续并生成助记词" }).click();
  await expect(page.getByText("这一步不要偷懒，助记词只展示一次。")).toBeVisible();
  await expect(page.locator(".word-chip")).toHaveCount(12);
  await page.getByLabel("我已经离线备份这组助记词").check();
  await page.getByRole("button", { name: "完成备份并进入钱包" }).click();
  await expect(page).toHaveURL(/\/wallet$/);
  await expect(page.getByText("资产首页已经有落点了。")).toBeVisible();
}
