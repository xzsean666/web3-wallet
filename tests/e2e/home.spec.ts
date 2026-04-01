import { expect, test } from "@playwright/test";

test("shows wallet scaffold title", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Web3 Wallet" })).toBeVisible();
});
