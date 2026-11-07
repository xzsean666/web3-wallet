import { beforeEach, describe, expect, it } from "vitest";
import {
  authenticateBiometric,
  checkBiometricCapability,
  clearBiometricUnlockCredential,
  getBiometricUnlockPassword,
  hasBiometricUnlockCredential,
  saveBiometricUnlockCredential,
} from "../biometrics";

describe("biometrics service", () => {
  const accountId = "test-bio-account";

  beforeEach(() => {
    localStorage.clear();
  });

  it("checks biometric capability", async () => {
    const cap = await checkBiometricCapability();
    expect(cap).toHaveProperty("available");
    expect(cap).toHaveProperty("typeLabel");
  });

  it("saves, checks and clears biometric credentials", () => {
    expect(hasBiometricUnlockCredential(accountId)).toBe(false);

    saveBiometricUnlockCredential(accountId, "my-secret-password");
    expect(hasBiometricUnlockCredential(accountId)).toBe(true);

    clearBiometricUnlockCredential(accountId);
    expect(hasBiometricUnlockCredential(accountId)).toBe(false);
  });

  it("authenticates biometrics and retrieves cached password", async () => {
    saveBiometricUnlockCredential(accountId, "vault-password-xyz");

    const pass = await getBiometricUnlockPassword(accountId);
    expect(pass).toBe("vault-password-xyz");
  });

  it("returns null when no credential exists", async () => {
    const pass = await getBiometricUnlockPassword("non-existent-account");
    expect(pass).toBeNull();
  });

  it("authenticates successfully with platform fallback", async () => {
    const success = await authenticateBiometric();
    expect(success).toBe(true);
  });
});
