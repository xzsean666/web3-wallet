import { describe, expect, it } from "vitest";
import {
  createPasswordVerifier,
  decryptSecret,
  encryptSecret,
  verifyPassword,
} from "../security";

describe("security helpers", () => {
  it("verifies passwords with salted digests", async () => {
    const verifier = await createPasswordVerifier("super-secret");

    await expect(verifyPassword("super-secret", verifier)).resolves.toBe(true);
    await expect(verifyPassword("wrong-secret", verifier)).resolves.toBe(false);
  });

  it("encrypts and decrypts preview secrets with the wallet password", async () => {
    const payload = await encryptSecret(
      "test test test test test test test test test test test junk",
      "super-secret",
    );

    await expect(decryptSecret(payload, "super-secret")).resolves.toBe(
      "test test test test test test test test test test test junk",
    );
    await expect(decryptSecret(payload, "wrong-secret")).rejects.toThrow();
  });

  it("rejects malformed hex payloads instead of silently coercing them", async () => {
    await expect(
      verifyPassword("super-secret", {
        salt: "zz",
        hash: "00".repeat(32),
      }),
    ).rejects.toThrow("Invalid password salt payload");

    await expect(
      decryptSecret(
        {
          salt: "00".repeat(16),
          iv: "gg",
          ciphertext: "00",
        },
        "super-secret",
      ),
    ).rejects.toThrow("Invalid encryption iv payload");
  });
});
