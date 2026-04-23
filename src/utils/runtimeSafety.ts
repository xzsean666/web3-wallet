import { getAddress, isAddress } from "viem";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
export const PREVIEW_SECRET_OVERRIDE_FLAG = "__WEB3_WALLET_UNSAFE_PREVIEW_SECRETS__";
export const PREVIEW_SECRET_FORCE_BLOCK_FLAG = "__WEB3_WALLET_FORCE_PREVIEW_SECRETS_BLOCKED__";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD";

export const PREVIEW_SECRET_FLOW_BLOCKED_MESSAGE =
  "浏览器预览模式已默认禁用真实助记词/私钥流程，请改用 `pnpm tauri dev`。如仅为本地测试，可显式开启不安全预览开关。";

function canUseUnsafePreviewOverride() {
  if (
    typeof globalThis !== "undefined" &&
    (globalThis as Record<string, unknown>)[PREVIEW_SECRET_FORCE_BLOCK_FLAG] === true
  ) {
    return false;
  }

  if (import.meta.env.MODE === "test") {
    return true;
  }

  if (typeof globalThis === "undefined") {
    return false;
  }

  return (globalThis as Record<string, unknown>)[PREVIEW_SECRET_OVERRIDE_FLAG] === true;
}

export function isPreviewSecretFlowAllowed() {
  return canUseUnsafePreviewOverride();
}

export function assertPreviewSecretFlowAllowed() {
  if (!isPreviewSecretFlowAllowed()) {
    throw new Error(PREVIEW_SECRET_FLOW_BLOCKED_MESSAGE);
  }
}

export function isLoopbackHost(hostname: string) {
  return LOOPBACK_HOSTS.has(hostname);
}

function normalizeAllowedUrl(
  value: string,
  options: {
    allowLoopbackHttp: boolean;
  },
) {
  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  try {
    const url = new URL(normalized);

    if (url.protocol === "https:") {
      return url;
    }

    if (
      options.allowLoopbackHttp &&
      (url.protocol === "http:" || url.protocol === "https:") &&
      isLoopbackHost(url.hostname)
    ) {
      return url;
    }
  } catch {
    return null;
  }

  return null;
}

export function normalizeAllowedRpcUrl(value: string) {
  return normalizeAllowedUrl(value, {
    allowLoopbackHttp: true,
  });
}

export function normalizeAllowedExplorerUrl(value: string) {
  return normalizeAllowedUrl(value, {
    allowLoopbackHttp: true,
  });
}

export function isAllowedRpcUrl(value: string) {
  return normalizeAllowedRpcUrl(value) !== null;
}

export function isAllowedExplorerUrl(value: string) {
  return normalizeAllowedExplorerUrl(value) !== null;
}

export function toSafeExternalUrl(value: string | null | undefined) {
  return value ? normalizeAllowedExplorerUrl(value)?.toString() ?? null : null;
}

function buildSafeExplorerUrl(baseUrl: string | null | undefined, path: string) {
  if (!baseUrl) {
    return null;
  }

  const normalizedBase = normalizeAllowedExplorerUrl(baseUrl);

  if (!normalizedBase) {
    return null;
  }

  const nextUrl = new URL(normalizedBase.toString());
  const basePath = nextUrl.pathname.replace(/\/$/, "");
  nextUrl.pathname = `${basePath}/${path.replace(/^\//, "")}`;

  return nextUrl.toString();
}

export function buildAddressExplorerUrl(
  explorerUrl: string | null | undefined,
  address: string | null | undefined,
) {
  if (!address || !isAddress(address)) {
    return null;
  }

  return buildSafeExplorerUrl(explorerUrl, `address/${getAddress(address)}`);
}

export function buildTokenExplorerUrl(
  explorerUrl: string | null | undefined,
  contractAddress: string | null | undefined,
) {
  if (!contractAddress || !isAddress(contractAddress)) {
    return null;
  }

  return buildSafeExplorerUrl(explorerUrl, `token/${getAddress(contractAddress)}`);
}

export function buildTransactionExplorerUrl(
  explorerUrl: string | null | undefined,
  txHash: string | null | undefined,
) {
  const normalizedHash = txHash?.trim() ?? "";

  if (!/^0x[0-9a-fA-F]{64}$/.test(normalizedHash)) {
    return null;
  }

  return buildSafeExplorerUrl(explorerUrl, `tx/${normalizedHash}`);
}

export function getRestrictedAddressReason(address: string) {
  if (!isAddress(address)) {
    return null;
  }

  const normalized = getAddress(address);

  if (normalized === getAddress(ZERO_ADDRESS)) {
    return "不允许向零地址发送或保存联系人，这会直接销毁资产。";
  }

  if (normalized === getAddress(DEAD_ADDRESS)) {
    return "不允许把常见 burn 地址作为默认发送目标或联系人。";
  }

  return null;
}
