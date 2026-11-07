import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  DEFAULT_MOCK_TX_HASH,
  TEST_MNEMONIC,
  WALLET_PASSWORD,
  allowUnsafePreviewSecretFlow,
  setupDefaultEthereumRpcMock,
} from "./helpers";

const SCREENSHOT_DIR = path.resolve(process.cwd(), "docs/screenshots");

async function snap(page: Page, filename: string) {
  // Give CSS transitions, blur effects and UI states time to settle
  await page.waitForTimeout(400);
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, filename),
    fullPage: false,
  });
}

async function clientNavigate(page: Page, targetUrl: string) {
  await page.evaluate((url) => {
    const router = (window as unknown as { __APP_ROUTER__?: { push: (to: string) => Promise<void> } })
      .__APP_ROUTER__;
    if (router) {
      return router.push(url);
    }
    return Promise.resolve();
  }, targetUrl);
  await page.waitForTimeout(300);
}

test.describe("Visual E2E Walkthrough & Screenshot Generation", () => {
  test("complete wallet walkthrough with screenshots", async ({ page }) => {
    test.setTimeout(60_000);

    // Set a crisp modern mobile viewport matching the wallet design
    await page.setViewportSize({ width: 412, height: 915 });

    const mockTokenAddress = "0x5555555555555555555555555555555555555555" as const;
    await allowUnsafePreviewSecretFlow(page);
    await setupDefaultEthereumRpcMock(page, {
      trackedToken: {
        address: mockTokenAddress,
        name: "Mock USD",
        symbol: "MUSD",
        decimals: 6,
        balanceHex: "0x1dcd6500", // 500 MUSD
      },
    });

    // -------------------------------------------------------------------------
    // 01. Welcome Page
    // -------------------------------------------------------------------------
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "极简 Web3 钱包" })).toBeVisible();
    await snap(page, "01-welcome-page.png");

    // -------------------------------------------------------------------------
    // 02. Create Wallet Form
    // -------------------------------------------------------------------------
    await page.getByRole("link", { name: "创建钱包" }).click();
    await expect(page).toHaveURL(/\/onboarding\/create$/);
    await page.getByLabel("钱包名称").fill("Genesis Luxury Wallet");
    await page.getByLabel("设置密码").fill(WALLET_PASSWORD);
    await page.getByLabel("确认密码").fill(WALLET_PASSWORD);
    await snap(page, "02-create-wallet.png");

    // -------------------------------------------------------------------------
    // 03. Create Wallet Validation Error
    // -------------------------------------------------------------------------
    await page.getByLabel("确认密码").fill("mismatch-pass");
    await page.getByRole("button", { name: /下一步/ }).click();
    await expect(page.getByText("两次输入的钱包密码不一致")).toBeVisible();
    await snap(page, "03-create-wallet-validation.png");

    // Fix password and proceed to backup
    await page.getByLabel("确认密码").fill(WALLET_PASSWORD);
    await page.getByRole("button", { name: /下一步/ }).click();
    await expect(page).toHaveURL(/\/onboarding\/backup$/);

    // -------------------------------------------------------------------------
    // 04. Backup Phrase Locked
    // -------------------------------------------------------------------------
    await expect(page.getByText(/助记词用于控制和恢复钱包资产/)).toBeVisible();
    await snap(page, "04-backup-phrase-locked.png");

    // -------------------------------------------------------------------------
    // 05. Backup Phrase Revealed & Confirmed
    // -------------------------------------------------------------------------
    await page.getByPlaceholder("输入创建这个钱包时设置的密码").fill(WALLET_PASSWORD);
    await page.getByRole("button", { name: "验证密码并显示助记词" }).click();
    await expect(page.locator(".word-chip")).toHaveCount(12);
    await expect(page.locator(".copy-phrase-button")).toBeVisible();
    await page.locator(".copy-phrase-button").click();
    await page.getByLabel("我已按顺序在纸上正确抄写助记词").check();
    await snap(page, "05-backup-phrase-revealed.png");

    // Complete backup into wallet home
    await page.getByRole("button", { name: "完成备份并进入钱包" }).click();
    await expect(page).toHaveURL(/\/wallet$/);
    await expect(page.getByRole("heading", { name: "资产" })).toBeVisible();

    // -------------------------------------------------------------------------
    // 06. Wallet Home Page
    // -------------------------------------------------------------------------
    await expect(page.getByText("1.5 ETH")).toBeVisible();
    await snap(page, "06-wallet-home.png");

    // -------------------------------------------------------------------------
    // 07. Receive Page
    // -------------------------------------------------------------------------
    await page.getByRole("link", { name: "收款" }).click();
    await expect(page).toHaveURL(/\/wallet\/receive$/);
    await expect(page.locator(".receive-qr-card")).toBeVisible();
    await snap(page, "07-receive-page.png");
    await page.getByRole("link", { name: "返回" }).click();
    await expect(page).toHaveURL(/\/wallet$/);

    // -------------------------------------------------------------------------
    // 08. Send Page - Native Token
    // -------------------------------------------------------------------------
    await page.getByRole("link", { name: "发送" }).click();
    await expect(page).toHaveURL(/\/wallet\/send$/);
    await page.getByLabel("收款地址").fill("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
    await page.getByLabel("数量").fill("0.1");
    await expect(page.getByRole("button", { name: "生成确认摘要" })).toBeEnabled();
    await snap(page, "08-send-page-native.png");

    // -------------------------------------------------------------------------
    // 09. Send Confirmation Section
    // -------------------------------------------------------------------------
    await page.getByRole("button", { name: "生成确认摘要" }).click();
    await expect(page.getByRole("heading", { name: "确认" })).toBeVisible();
    await snap(page, "09-send-confirmation.png");
    await page.getByRole("link", { name: "返回" }).first().click();
    await expect(page).toHaveURL(/\/wallet$/);

    // -------------------------------------------------------------------------
    // 10. Add Custom ERC20 Token
    // -------------------------------------------------------------------------
    await page.locator('a[href="/wallet/token/add"]').click();
    await expect(page).toHaveURL(/\/wallet\/token\/add$/);
    await page.getByLabel("合约地址").fill(mockTokenAddress);
    await page.getByRole("button", { name: "读取合约元数据" }).click();
    await expect(page.getByLabel("代币名称")).toHaveValue("Mock USD");
    await snap(page, "10-add-token.png");

    await page.getByRole("button", { name: "添加代币" }).click();
    await expect(page).toHaveURL(/\/wallet$/);

    // -------------------------------------------------------------------------
    // 11. Wallet Home with Custom Token
    // -------------------------------------------------------------------------
    await expect(page.getByText("MUSD")).toBeVisible();
    await snap(page, "11-wallet-home-with-token.png");

    // -------------------------------------------------------------------------
    // 12. Token Detail - Native ETH
    // -------------------------------------------------------------------------
    await page.locator('a[href="/wallet/token/native"]').click();
    await expect(page).toHaveURL(/\/wallet\/token\/native$/);
    await expect(page.getByText("原生币")).toBeVisible();
    await snap(page, "12-token-detail-native.png");
    await page.getByRole("link", { name: "返回" }).first().click();
    await expect(page).toHaveURL(/\/wallet$/);

    // -------------------------------------------------------------------------
    // 13. Token Detail - Custom ERC20 (MUSD)
    // -------------------------------------------------------------------------
    await page.locator('a[href^="/wallet/token/"]').filter({ hasText: "MUSD" }).first().click();
    await expect(page.getByText("ERC20 代币", { exact: true })).toBeVisible();
    await snap(page, "13-token-detail-erc20.png");

    // -------------------------------------------------------------------------
    // 14. Activity Page
    // -------------------------------------------------------------------------
    // Inject mock activity into reactive store state
    await page.evaluate(
      ({ txHash }) => {
        const pinia = (window as unknown as { __APP_PINIA__?: { state: { value: Record<string, any> } } })
          .__APP_PINIA__;
        const walletState = pinia?.state?.value?.wallet;
        if (walletState) {
          walletState.recentActivity = [
            {
              id: "tx-mock-1",
              title: "发送 ETH",
              subtitle: "转给 0x7099...79C8",
              status: "complete",
              txHash: txHash,
              networkId: "ethereum-mainnet",
              assetSymbol: "ETH",
              amount: "0.1",
              recipientAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
              createdAt: new Date().toISOString(),
            },
          ];
        }
      },
      { txHash: DEFAULT_MOCK_TX_HASH },
    );

    await clientNavigate(page, "/wallet/activity");
    await expect(page).toHaveURL(/\/wallet\/activity$/);
    await snap(page, "14-activity-page.png");

    // -------------------------------------------------------------------------
    // 15. Transaction Detail Page
    // -------------------------------------------------------------------------
    await clientNavigate(page, `/wallet/tx/${DEFAULT_MOCK_TX_HASH}?networkId=ethereum-mainnet`);
    await expect(page.getByRole("heading", { name: "交易详情" })).toBeVisible();
    await snap(page, "15-transaction-detail.png");

    // -------------------------------------------------------------------------
    // 16. Networks Page (Chainlist RPC Selection & Networks)
    // -------------------------------------------------------------------------
    await clientNavigate(page, "/settings/networks");
    await expect(page).toHaveURL(/\/settings\/networks$/);
    await expect(page.getByRole("heading", { name: "网络管理" })).toBeVisible();
    await page.locator(".rpc-candidate-section").scrollIntoViewIfNeeded();
    await expect(page.getByText(/Chainlist 节点候选/)).toBeVisible();
    await page.locator(".rpc-candidate-list").waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
    await snap(page, "16-networks-page.png");

    // -------------------------------------------------------------------------
    // 17. Add Custom Network Form
    // -------------------------------------------------------------------------
    await page.getByLabel("网络名称").scrollIntoViewIfNeeded();
    await page.getByLabel("网络名称").fill("Arbitrum One (Mock)");
    await page.getByLabel("Chain ID").fill("42161");
    await page.getByLabel("RPC URL").fill("https://arb1.arbitrum.io/rpc");
    await page.getByLabel("原生币符号").fill("ETH");
    await snap(page, "17-add-custom-network.png");

    // -------------------------------------------------------------------------
    // 18. Accounts Page
    // -------------------------------------------------------------------------
    await clientNavigate(page, "/settings/accounts");
    await expect(page).toHaveURL(/\/settings\/accounts$/);
    await expect(page.getByText("Genesis Luxury Wallet").first()).toBeVisible();
    await snap(page, "18-accounts-page.png");

    // -------------------------------------------------------------------------
    // 19. Address Book Page
    // -------------------------------------------------------------------------
    await clientNavigate(page, "/settings/address-book");
    await expect(page).toHaveURL(/\/settings\/address-book$/);
    await page.getByLabel("联系人名称").fill("Alice Cold Wallet");
    await page.getByLabel("联系人地址").fill("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
    await page.getByLabel("备注").fill("常用离线冷钱包存储");
    await page.getByRole("button", { name: "保存联系人" }).click();
    await expect(page.getByText("联系人已保存到本地地址簿")).toBeVisible();
    await snap(page, "19-address-book.png");

    // -------------------------------------------------------------------------
    // 20. Settings Page
    // -------------------------------------------------------------------------
    await clientNavigate(page, "/settings");
    await expect(page).toHaveURL(/\/settings$/);
    await snap(page, "20-settings-page.png");

    // -------------------------------------------------------------------------
    // 21. Lock & Unlock Page
    // -------------------------------------------------------------------------
    await page.getByRole("button", { name: "锁定钱包" }).click();
    await expect(page).toHaveURL(/\/unlock$/);
    await page.getByLabel("输入解锁密码").fill("incorrect-pwd");
    await page.getByRole("button", { name: "解锁钱包" }).click();
    await expect(page.getByText(/密码/)).toBeVisible();
    await snap(page, "21-lock-unlock-page.png");

    // -------------------------------------------------------------------------
    // 22. Import Wallet Page
    // -------------------------------------------------------------------------
    await page.getByRole("link", { name: "导入其他账号" }).click();
    await expect(page).toHaveURL(/\/settings\/accounts\/import$/);
    await page.getByLabel("账号名称").fill("Imported Recovery Account");
    await page.getByLabel(/助记词/).fill(TEST_MNEMONIC);
    await snap(page, "22-import-wallet-page.png");
  });
});
