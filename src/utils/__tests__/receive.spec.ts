import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import {
  buildReceiveQrPayload,
  buildReceiveQrSvg,
  formatRawEvmAmount,
  parseEvmPaymentRequest,
} from "../receive";

describe("receive helpers", () => {
  it("builds an EIP-681 style receive payload with chain id", () => {
    expect(
      buildReceiveQrPayload(
        "0x1111111111111111111111111111111111111111",
        8453,
      ),
    ).toBe("ethereum:0x1111111111111111111111111111111111111111@8453");
  });

  it("renders svg markup for the receive payload", async () => {
    const svg = await buildReceiveQrSvg(
      "ethereum:0x1111111111111111111111111111111111111111@1",
    );

    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
  });

  it("parses an ERC20 transfer EIP-681 payment request", () => {
    expect(
      parseEvmPaymentRequest(
        "ethereum:0xebe1af878adc36994cebe5f8fd3bf772661e3d14@80002/transfer?address=0x18be3bc1fa455fcc19db8fa0bbacf178d8aa884f&uint256=1000000000000000000",
      ),
    ).toMatchObject({
      type: "erc20-transfer",
      contractAddress: getAddress("0xebe1af878adc36994cebe5f8fd3bf772661e3d14"),
      recipientAddress: getAddress("0x18be3bc1fa455fcc19db8fa0bbacf178d8aa884f"),
      chainId: 80002,
      rawAmount: "1000000000000000000",
    });
  });

  it("parses a native ethereum payment request with value", () => {
    expect(
      parseEvmPaymentRequest(
        "ethereum:0x2222222222222222222222222222222222222222@8453?value=2500000000000000000",
      ),
    ).toMatchObject({
      type: "native",
      recipientAddress: "0x2222222222222222222222222222222222222222",
      chainId: 8453,
      rawAmount: "2500000000000000000",
    });
  });

  it("formats integer base-unit amounts with token decimals", () => {
    expect(formatRawEvmAmount("1000000000000000000", 18)).toBe("1");
    expect(formatRawEvmAmount("1250000", 6)).toBe("1.25");
  });

  it("rejects unsupported ethereum payment methods", () => {
    expect(() =>
      parseEvmPaymentRequest(
        "ethereum:0x1111111111111111111111111111111111111111@1/approve?address=0x2222222222222222222222222222222222222222&uint256=1",
      ),
    ).toThrow("当前只支持 ERC20 transfer");
  });
});
