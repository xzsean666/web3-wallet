import { beforeEach, describe, expect, it } from "vitest";
import {
  clearPatternLock,
  getPatternUnlockPassword,
  hasPatternLock,
  savePatternLock,
  verifyPatternLock,
} from "../patternLock";

describe("patternLock service", () => {
  const accountId = "test-account-123";

  beforeEach(() => {
    localStorage.clear();
  });

  it("checks whether pattern lock is set", async () => {
    expect(hasPatternLock(accountId)).toBe(false);

    await savePatternLock(accountId, [0, 1, 2, 5, 8], "password123");
    expect(hasPatternLock(accountId)).toBe(true);
  });

  it("requires at least 4 dots", async () => {
    await expect(savePatternLock(accountId, [0, 1, 2])).rejects.toThrow(
      "手势连线至少需要连接 4 个点",
    );
  });

  it("verifies matching pattern and rejects mismatched pattern", async () => {
    const pattern = [0, 1, 2, 5, 8];
    await savePatternLock(accountId, pattern, "wallet-pwd");

    expect(await verifyPatternLock(accountId, [0, 1, 2, 5, 8])).toBe(true);
    expect(await verifyPatternLock(accountId, [0, 1, 2, 3, 4])).toBe(false);
  });

  it("retrieves the cached password when pattern matches", async () => {
    const pattern = [0, 1, 2, 4, 6];
    await savePatternLock(accountId, pattern, "super-secret-password");

    const retrieved = await getPatternUnlockPassword(accountId, [0, 1, 2, 4, 6]);
    expect(retrieved).toBe("super-secret-password");

    const failed = await getPatternUnlockPassword(accountId, [0, 1, 2, 4, 7]);
    expect(failed).toBeNull();
  });

  it("clears pattern lock", async () => {
    await savePatternLock(accountId, [0, 1, 2, 5, 8], "wallet-pwd");
    expect(hasPatternLock(accountId)).toBe(true);

    clearPatternLock(accountId);
    expect(hasPatternLock(accountId)).toBe(false);
  });
});
