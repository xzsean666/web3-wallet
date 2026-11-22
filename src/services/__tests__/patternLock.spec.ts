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

    // Verify it is encrypted with AES-GCM and not plaintext Base64
    const stored = JSON.parse(localStorage.getItem(`web3_wallet_pattern_${accountId}`)!);
    expect(stored.encryptedPassword).toBeTypeOf("object");
    expect(stored.encryptedPassword).toHaveProperty("ciphertext");
    expect(stored.encryptedPassword).toHaveProperty("iv");
    expect(stored.encryptedPassword).toHaveProperty("salt");
    expect(JSON.stringify(stored)).not.toContain("super-secret-password");

    const retrieved = await getPatternUnlockPassword(accountId, [0, 1, 2, 4, 6]);
    expect(retrieved).toBe("super-secret-password");

    const failed = await getPatternUnlockPassword(accountId, [0, 1, 2, 4, 7]);
    expect(failed).toBeNull();
  });

  it("handles legacy base64-stored pattern locks backwards-compatibly", async () => {
    const legacyPattern = [0, 1, 2, 4, 6];
    const legacySalt = "web3_wallet_pattern_salt_2026_";
    const encoder = new TextEncoder();
    const data = encoder.encode(`${legacySalt}${legacyPattern.join("-")}`);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const patternHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const legacyPayload = {
      accountId,
      patternHash,
      encryptedPassword: btoa(encodeURIComponent("legacy-plain-pwd")),
      updatedAt: Date.now(),
    };
    localStorage.setItem(`web3_wallet_pattern_${accountId}`, JSON.stringify(legacyPayload));

    const retrieved = await getPatternUnlockPassword(accountId, legacyPattern);
    expect(retrieved).toBe("legacy-plain-pwd");
  });

  it("clears pattern lock", async () => {
    await savePatternLock(accountId, [0, 1, 2, 5, 8], "wallet-pwd");
    expect(hasPatternLock(accountId)).toBe(true);

    clearPatternLock(accountId);
    expect(hasPatternLock(accountId)).toBe(false);
  });
});
