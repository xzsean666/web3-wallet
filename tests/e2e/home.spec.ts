import { expect, test } from "@playwright/test";

test("shows wallet scaffold title", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "面向 Native Token 和 ERC20 的精简型桌面钱包。" })).toBeVisible();
});

test("completes the browser preview create-wallet flow", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("link", { name: "创建钱包" }).click();
  await page.getByLabel("钱包名称").fill("Preview Wallet");
  await page.getByLabel("钱包密码").fill("super-secret");
  await page.getByLabel("确认密码").fill("super-secret");
  await page.getByRole("button", { name: "继续并生成助记词" }).click();

  await expect(page.getByText("这一步不要偷懒，助记词只展示一次。")).toBeVisible();
  await expect(page.locator(".word-chip")).toHaveCount(12);

  await page.getByLabel("我已经离线备份这组助记词").check();
  await page.getByRole("button", { name: "完成备份并进入钱包" }).click();

  await expect(page).toHaveURL(/\/wallet$/);
  await expect(page.getByText("资产首页已经有落点了。")).toBeVisible();
});
