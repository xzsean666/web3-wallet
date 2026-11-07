/**
 * Pattern Lock Service
 * Provides gesture pattern lock (手势连线解锁) setup, verification and credential retrieval.
 */

const PATTERN_STORAGE_PREFIX = "web3_wallet_pattern_";
const PATTERN_SALT = "web3_wallet_pattern_salt_2026_";

async function hashPattern(pattern: number[]): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`${PATTERN_SALT}${pattern.join("-")}`);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface StoredPatternPayload {
  accountId: string;
  patternHash: string;
  encryptedPassword?: string;
  updatedAt: number;
}

/**
 * Checks if a pattern lock is set for this account
 */
export function hasPatternLock(accountId: string): boolean {
  try {
    return localStorage.getItem(`${PATTERN_STORAGE_PREFIX}${accountId}`) !== null;
  } catch {
    return false;
  }
}

/**
 * Saves a new pattern lock and optional wallet password for quick unlock
 */
export async function savePatternLock(
  accountId: string,
  pattern: number[],
  password?: string,
): Promise<void> {
  if (pattern.length < 4) {
    throw new Error("手势连线至少需要连接 4 个点");
  }

  const patternHash = await hashPattern(pattern);
  const payload: StoredPatternPayload = {
    accountId,
    patternHash,
    encryptedPassword: password ? btoa(encodeURIComponent(password)) : undefined,
    updatedAt: Date.now(),
  };

  localStorage.setItem(`${PATTERN_STORAGE_PREFIX}${accountId}`, JSON.stringify(payload));
}

/**
 * Verifies a drawn pattern against the stored pattern
 */
export async function verifyPatternLock(accountId: string, pattern: number[]): Promise<boolean> {
  try {
    const raw = localStorage.getItem(`${PATTERN_STORAGE_PREFIX}${accountId}`);
    if (!raw) {
      return false;
    }

    const payload: StoredPatternPayload = JSON.parse(raw);
    const inputHash = await hashPattern(pattern);
    return inputHash === payload.patternHash;
  } catch {
    return false;
  }
}

/**
 * Verifies pattern and retrieves wallet password for automatic unlocking
 */
export async function getPatternUnlockPassword(
  accountId: string,
  pattern: number[],
): Promise<string | null> {
  try {
    const raw = localStorage.getItem(`${PATTERN_STORAGE_PREFIX}${accountId}`);
    if (!raw) {
      return null;
    }

    const payload: StoredPatternPayload = JSON.parse(raw);
    const inputHash = await hashPattern(pattern);

    if (inputHash !== payload.patternHash) {
      return null;
    }

    if (payload.encryptedPassword) {
      return decodeURIComponent(atob(payload.encryptedPassword));
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Removes the pattern lock for an account
 */
export function clearPatternLock(accountId: string): void {
  try {
    localStorage.removeItem(`${PATTERN_STORAGE_PREFIX}${accountId}`);
  } catch {
    // Ignore storage errors
  }
}
