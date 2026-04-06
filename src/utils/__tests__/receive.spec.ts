import { describe, expect, it } from "vitest";
import { buildReceiveQrPayload, buildReceiveQrSvg } from "../receive";

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
});
