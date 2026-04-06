import { expect, test } from "@playwright/test";
import { createFreshWallet, setupDefaultEthereumRpcMock } from "./helpers";

test("shows wallet scaffold title", async ({ page }) => {
  await setupDefaultEthereumRpcMock(page);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "面向 Native Token 和 ERC20 的精简型桌面钱包。" })).toBeVisible();
});

test("completes the browser preview create-wallet flow", async ({ page }) => {
  await createFreshWallet(page);
});
