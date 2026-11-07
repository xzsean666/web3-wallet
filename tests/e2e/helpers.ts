import { expect, type Page } from "@playwright/test";
import { encodeAbiParameters } from "viem";

export const WALLET_PASSWORD = "super-secret";
export const TEST_MNEMONIC =
  "legal winner thank year wave sausage worth useful legal winner thank yellow";

const DEFAULT_ETHEREUM_RPC_URL = "https://ethereum-rpc.publicnode.com";
const PREVIEW_SECRET_OVERRIDE_FLAG = "__WEB3_WALLET_UNSAFE_PREVIEW_SECRETS__";
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

export const DEFAULT_MOCK_TX_HASH =
  "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
export const DEFAULT_MOCK_BLOCK_HASH =
  "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";

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
      case "eth_gasPrice":
        return { result: "0x4a817c800" }; // 20 Gwei
      case "eth_estimateGas":
        return { result: "0x5208" }; // 21000
      case "eth_getTransactionCount":
        return { result: "0x1" };
      case "eth_maxPriorityFeePerGas":
        return { result: "0x77359400" }; // 2 Gwei
      case "eth_feeHistory":
        return {
          result: {
            oldestBlock: "0x1230",
            baseFeePerGas: ["0x3b9aca00", "0x3b9aca00"],
            gasUsedRatio: [0.5],
            reward: [["0x77359400"]],
          },
        };
      case "eth_getBlockByNumber":
        return {
          result: {
            number: options.latestBlockHex ?? "0x1234",
            hash: DEFAULT_MOCK_BLOCK_HASH,
            parentHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
            timestamp: "0x660e8000",
            baseFeePerGas: "0x3b9aca00",
            gasLimit: "0x1c9c380",
            gasUsed: "0x5208",
          },
        };
      case "eth_getTransactionByHash": {
        const hash = String(params[0] ?? DEFAULT_MOCK_TX_HASH);
        return {
          result: {
            hash,
            nonce: "0x1",
            blockHash: DEFAULT_MOCK_BLOCK_HASH,
            blockNumber: options.latestBlockHex ?? "0x1234",
            transactionIndex: "0x0",
            from: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
            to: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
            value: "0xde0b6b3a7640000", // 1.0 ETH
            gas: "0x5208",
            gasPrice: "0x4a817c800",
            input: "0x",
          },
        };
      }
      case "eth_getTransactionReceipt": {
        const hash = String(params[0] ?? DEFAULT_MOCK_TX_HASH);
        return {
          result: {
            transactionHash: hash,
            transactionIndex: "0x0",
            blockHash: DEFAULT_MOCK_BLOCK_HASH,
            blockNumber: options.latestBlockHex ?? "0x1234",
            from: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
            to: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
            cumulativeGasUsed: "0x5208",
            gasUsed: "0x5208",
            effectiveGasPrice: "0x4a817c800",
            status: "0x1",
            logs: [],
          },
        };
      }
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

export async function allowUnsafePreviewSecretFlow(page: Page) {
  await page.addInitScript((flag: string) => {
    (globalThis as Record<string, unknown>)[flag] = true;
  }, PREVIEW_SECRET_OVERRIDE_FLAG);
}

export async function createFreshWallet(
  page: Page,
  walletLabel = "Preview Wallet",
  rpcOptions?: EthereumRpcMockOptions,
) {
  await allowUnsafePreviewSecretFlow(page);
  await setupDefaultEthereumRpcMock(page, rpcOptions);
  await page.goto("/");
  await page.getByRole("link", { name: "创建钱包" }).click();
  await page.getByLabel("钱包名称").fill(walletLabel);
  await page.getByLabel("设置密码").fill(WALLET_PASSWORD);
  await page.getByLabel("确认密码").fill(WALLET_PASSWORD);
  await page.getByRole("button", { name: /下一步/ }).click();
  await expect(page.getByText(/助记词用于控制和恢复钱包资产/)).toBeVisible();
  await page.getByPlaceholder("输入创建这个钱包时设置的密码").fill(WALLET_PASSWORD);
  await page.getByRole("button", { name: "验证密码并显示助记词" }).click();
  await expect(page.locator(".word-chip")).toHaveCount(12);
  await page.getByLabel("我已按顺序在纸上正确抄写助记词").check();
  await page.getByRole("button", { name: "完成备份并进入钱包" }).click();
  await expect(page).toHaveURL(/\/wallet$/);
  await expect(page.getByRole("heading", { name: "资产" })).toBeVisible();
}
