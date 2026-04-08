import { expect, test } from "@playwright/test";
import {
  TEST_MNEMONIC,
  WALLET_PASSWORD,
  createFreshWallet,
  mockJsonRpc,
  setupDefaultEthereumRpcMock,
} from "./helpers";

test.describe("Playwright wallet flows", () => {
  test("imports a wallet from mnemonic in browser preview", async ({ page }) => {
    await setupDefaultEthereumRpcMock(page);
    await page.goto("/");
    await page.getByRole("link", { name: "导入钱包" }).click();
    await page.getByLabel("钱包名称").fill("Imported Playwright Wallet");
    await page.getByLabel(/助记词/).fill(TEST_MNEMONIC);
    await page.getByLabel("钱包密码").fill(WALLET_PASSWORD);
    await page.getByLabel("确认密码").fill(WALLET_PASSWORD);
    await page.getByRole("button", { name: "导入钱包" }).click();
    await expect(page).toHaveURL(/\/wallet$/);
    await expect(page.getByRole("heading", { name: "资产" })).toBeVisible();
  });

  test("requires password confirmation and backup acknowledgement during wallet creation", async ({
    page,
  }) => {
    await setupDefaultEthereumRpcMock(page);
    await page.goto("/");
    await page.getByRole("link", { name: "创建钱包" }).click();
    await page.getByLabel("钱包名称").fill("Validation Wallet");
    await page.getByLabel("钱包密码").fill(WALLET_PASSWORD);
    await page.getByLabel("确认密码").fill("not-the-same");
    await page.getByRole("button", { name: "继续并生成助记词" }).click();
    await expect(page.getByText("两次输入的钱包密码不一致")).toBeVisible();

    await page.getByLabel("确认密码").fill(WALLET_PASSWORD);
    await page.getByRole("button", { name: "继续并生成助记词" }).click();
    await expect(page.getByText("这一步不要偷懒，助记词只展示一次。")).toBeVisible();
    await page.getByPlaceholder("输入创建这个钱包时设置的密码").fill(WALLET_PASSWORD);
    await page.getByRole("button", { name: "显示助记词" }).click();
    await expect(page.locator(".word-chip")).toHaveCount(12);

    await page.getByRole("button", { name: "完成备份并进入钱包" }).click();
    await expect(page.getByText("你必须确认已经离线备份助记词")).toBeVisible();

    await page.getByLabel("我已经离线备份这组助记词").check();
    await page.getByRole("button", { name: "完成备份并进入钱包" }).click();
    await expect(page).toHaveURL(/\/wallet$/);
  });

  test("locks, surfaces wrong-password errors, and then unlocks successfully", async ({ page }) => {
    await createFreshWallet(page, "Lock Flow Wallet");
    await page.getByRole("button", { name: "锁定" }).click();
    await expect(page).toHaveURL(/\/unlock$/);

    await page.getByLabel("钱包密码").fill("wrong-secret");
    await page.getByRole("button", { name: "解锁钱包" }).click();
    await expect(page.getByText("密码不正确，请重新输入")).toBeVisible();
    await expect(page).toHaveURL(/\/unlock$/);

    await page.getByLabel("钱包密码").fill(WALLET_PASSWORD);
    await page.getByRole("button", { name: "解锁钱包" }).click();
    await expect(page).toHaveURL(/\/wallet$/);
    await expect(page.getByRole("heading", { name: "资产" })).toBeVisible();
  });

  test("opens the native token detail page without a missing-token warning", async ({ page }) => {
    await createFreshWallet(page, "Token Detail Wallet");
    await page.locator('a[href="/wallet/token/native"]').click();

    await expect(page).toHaveURL(/\/wallet\/token\/native$/);
    await expect(page.getByText("Asset Overview")).toBeVisible();
    await expect(page.getByText("Token Missing")).toHaveCount(0);
    await expect(page.getByText("当前网络下找不到这个资产")).toHaveCount(0);
  });

  test("reads mocked chain balances and adds a custom token after metadata validation", async ({
    page,
  }) => {
    const mockTokenAddress = "0x5555555555555555555555555555555555555555" as const;
    await createFreshWallet(page, "Portfolio Wallet", {
      trackedToken: {
        address: mockTokenAddress,
        name: "Mock USD",
        symbol: "MUSD",
        decimals: 6,
        balanceHex: "0x0",
      },
    });

    await expect(page.getByText("块高 4660")).toBeVisible();
    await expect(page.getByText("1.5 ETH")).toBeVisible();

    await page.getByRole("link", { name: "添加" }).click();
    await page.getByLabel("合约地址").fill(mockTokenAddress);
    await page.getByRole("button", { name: "读取合约元数据" }).click();
    await expect(page.getByLabel("Token 名称")).toHaveValue("Mock USD");
    await expect(page.getByLabel("Token Symbol")).toHaveValue("MUSD");
    await expect(page.getByLabel("Decimals")).toHaveValue("6");
    await expect(page.getByText("已从当前网络的合约读取 Token 元数据")).toBeVisible();

    await page.getByRole("button", { name: "添加 Token" }).click();
    await expect(page).toHaveURL(/\/wallet$/);
    await expect(page.getByText("MUSD")).toBeVisible();
  });

  test("adds and activates a custom network from settings without calling a public RPC", async ({
    page,
  }) => {
    const rpcUrl = "http://127.0.0.1:15420/";
    await mockJsonRpc(page, rpcUrl, (method) => {
      if (method === "eth_chainId") {
        return { result: "0xaa36a7" };
      }

      if (method === "eth_blockNumber") {
        return { result: "0x1234" };
      }

      return {
        error: {
          code: -32601,
          message: `unsupported rpc method: ${method}`,
        },
      };
    });

    await createFreshWallet(page, "Network Flow Wallet");
    await page.getByRole("link", { name: "网络" }).click();
    await page.getByLabel("网络名称").fill("Playwright Sepolia");
    await page.getByLabel("Chain ID").fill("11155111");
    await page.getByLabel("RPC URL").fill(rpcUrl);
    await page.getByLabel("原生币符号").fill("ETH");
    await page.getByRole("button", { name: "校验并添加网络" }).click();

    const customNetworkCard = page.locator(".network-item", {
      hasText: "Playwright Sepolia",
    });
    await expect(customNetworkCard).toHaveCount(1);
    await expect(customNetworkCard.getByRole("button", { name: "当前使用" })).toBeVisible();
    await expect(customNetworkCard.getByText("Chain ID 11155111")).toBeVisible();
    await expect(
      page.locator(".status-grid .metric-value").filter({ hasText: "Playwright Sepolia" }),
    ).toBeVisible();
  });
});
