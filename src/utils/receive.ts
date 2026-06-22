import QRCode from "qrcode";
import { formatUnits, getAddress } from "viem";
import type { WalletAddress } from "../types/wallet";

export type ParsedEvmPaymentRequest =
  | {
      type: "native";
      recipientAddress: WalletAddress;
      chainId?: number;
      rawAmount?: string;
      raw: string;
    }
  | {
      type: "erc20-transfer";
      contractAddress: WalletAddress;
      recipientAddress: WalletAddress;
      chainId?: number;
      rawAmount: string;
      raw: string;
    };

export function buildReceiveQrPayload(
  address: WalletAddress,
  chainId?: number | string | null,
) {
  const normalizedChainId = `${chainId ?? ""}`.trim();

  if (!normalizedChainId) {
    return `ethereum:${address}`;
  }

  return `ethereum:${address}@${normalizedChainId}`;
}

export async function buildReceiveQrSvg(payload: string) {
  return QRCode.toString(payload, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
    width: 264,
    color: {
      dark: "#06121f",
      light: "#f8fbff",
    },
  });
}

export function parseEvmPaymentRequest(payload: string): ParsedEvmPaymentRequest {
  const raw = payload.trim();

  if (!raw) {
    throw new Error("二维码内容为空");
  }

  if (isLikelyEvmAddress(raw)) {
    return {
      type: "native",
      recipientAddress: normalizeEvmAddress(raw, "收款地址"),
      raw,
    };
  }

  if (!raw.toLowerCase().startsWith("ethereum:")) {
    throw new Error("当前只支持 EVM 地址或 ethereum: 支付二维码");
  }

  let body = raw.slice("ethereum:".length).trim();
  if (body.startsWith("//")) {
    body = body.slice(2);
  }

  const [pathPart, queryPart = ""] = splitOnce(body, "?");
  const [targetPart, methodPart = ""] = splitOnce(pathPart, "/");
  const { address: targetAddress, chainId } = parseTargetAddressAndChainId(targetPart);
  const params = new URLSearchParams(queryPart);
  const methodName = methodPart.trim().toLowerCase();

  if (!methodName) {
    const rawAmount = readOptionalRawAmount(params, "value");

    return {
      type: "native",
      recipientAddress: targetAddress,
      chainId,
      rawAmount,
      raw,
    };
  }

  if (methodName !== "transfer") {
    throw new Error("当前只支持 ERC20 transfer(address,uint256) 二维码");
  }

  const recipientAddress = params.get("address");
  if (!recipientAddress) {
    throw new Error("ERC20 转账二维码缺少 address 参数");
  }

  const rawAmount = readRequiredRawAmount(params, "uint256");

  return {
    type: "erc20-transfer",
    contractAddress: targetAddress,
    recipientAddress: normalizeEvmAddress(recipientAddress, "ERC20 收款地址"),
    chainId,
    rawAmount,
    raw,
  };
}

export function formatRawEvmAmount(rawAmount: string, decimals: number) {
  const normalizedAmount = normalizeRawAmount(rawAmount, "金额");

  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error("Token decimals 必须是 0 到 36 之间的整数");
  }

  return formatUnits(BigInt(normalizedAmount), decimals);
}

function splitOnce(value: string, separator: string): [string, string?] {
  const separatorIndex = value.indexOf(separator);

  if (separatorIndex === -1) {
    return [value];
  }

  return [
    value.slice(0, separatorIndex),
    value.slice(separatorIndex + separator.length),
  ];
}

function parseTargetAddressAndChainId(value: string) {
  const normalizedValue = value.trim();
  const [addressPart, chainIdPart, ...extraParts] = normalizedValue.split("@");

  if (!addressPart || extraParts.length > 0) {
    throw new Error("ethereum: 二维码目标地址格式无效");
  }

  const chainId = chainIdPart === undefined || chainIdPart.trim() === ""
    ? undefined
    : normalizeChainId(chainIdPart);

  return {
    address: normalizeEvmAddress(stripPaymentTargetPrefix(addressPart), "二维码目标地址"),
    chainId,
  };
}

function stripPaymentTargetPrefix(value: string) {
  return value.toLowerCase().startsWith("pay-") ? value.slice(4) : value;
}

function normalizeChainId(value: string) {
  const normalizedValue = value.trim();

  if (!/^\d+$/u.test(normalizedValue)) {
    throw new Error("Chain ID 必须是正整数");
  }

  const chainId = Number(normalizedValue);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error("Chain ID 超出当前钱包支持范围");
  }

  return chainId;
}

function readOptionalRawAmount(params: URLSearchParams, name: string) {
  const rawAmount = params.get(name);

  if (rawAmount === null || rawAmount.trim() === "") {
    return undefined;
  }

  return normalizeRawAmount(rawAmount, name);
}

function readRequiredRawAmount(params: URLSearchParams, name: string) {
  const rawAmount = params.get(name);

  if (rawAmount === null || rawAmount.trim() === "") {
    throw new Error(`ERC20 转账二维码缺少 ${name} 参数`);
  }

  return normalizeRawAmount(rawAmount, name);
}

function normalizeRawAmount(value: string, label: string) {
  const normalizedValue = value.trim();

  if (!/^(0|[1-9]\d*)$/u.test(normalizedValue)) {
    throw new Error(`${label} 必须是十进制整数最小单位`);
  }

  if (BigInt(normalizedValue) <= 0n) {
    throw new Error(`${label} 必须大于 0`);
  }

  return normalizedValue;
}

function isLikelyEvmAddress(value: string) {
  return /^0x[a-fA-F0-9]{40}$/u.test(value.trim());
}

function normalizeEvmAddress(value: string, label: string): WalletAddress {
  try {
    return getAddress(value.trim()) as WalletAddress;
  } catch {
    throw new Error(`${label} 必须是合法的 EVM 地址`);
  }
}
