import QRCode from "qrcode";
import type { WalletAddress } from "../types/wallet";

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
