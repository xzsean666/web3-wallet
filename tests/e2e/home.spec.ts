import { expect, test } from "@playwright/test";
import { createFreshWallet, setupDefaultEthereumRpcMock } from "./helpers";

test("shows wallet scaffold title", async ({ page }) => {
  await setupDefaultEthereumRpcMock(page);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "极简 Web3 钱包" })).toBeVisible();
});

test("completes the browser preview create-wallet flow", async ({ page }) => {
  await createFreshWallet(page);
});
