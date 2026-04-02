import { describe, expect, it } from "vitest";
import {
  encodeFunctionData,
  erc20Abi,
  ExecutionRevertedError,
  InsufficientFundsError,
  parseUnits,
  RpcRequestError,
} from "viem";
import {
  buildTransactionSummary,
  decodeErc20TransferData,
  describeTransferError,
  normalizeErc20TokenMetadata,
} from "../evm";

describe("evm transaction summary helpers", () => {
  it("builds a native transfer summary", () => {
    const summary = buildTransactionSummary({
      networkSymbol: "ETH",
      transaction: {
        to: "0x1111111111111111111111111111111111111111",
        value: 1_500_000_000_000_000_000n,
        input: "0x",
      },
    });

    expect(summary).toMatchObject({
      kind: "native-transfer",
      label: "Native Transfer",
      amount: "1.5",
      symbol: "ETH",
      recipientAddress: "0x1111111111111111111111111111111111111111",
      contractAddress: null,
    });
  });

  it("decodes erc20 transfer data into a readable summary", () => {
    const recipient = "0x2222222222222222222222222222222222222222" as const;
    const contract = "0x3333333333333333333333333333333333333333" as const;
    const encodedTransfer = encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [recipient, parseUnits("12.34", 6)],
    });
    const decoded = decodeErc20TransferData(encodedTransfer);

    expect(decoded).toMatchObject({
      recipientAddress: recipient,
      amount: parseUnits("12.34", 6),
      method: "transfer(address,uint256)",
    });

    const summary = buildTransactionSummary({
      networkSymbol: "ETH",
      transaction: {
        to: contract,
        value: 0n,
        input: encodedTransfer,
      },
      decodedErc20Transfer: decoded,
      tokenMetadata: {
        symbol: "USDC",
        name: "USD Coin",
        decimals: 6,
      },
    });

    expect(summary).toMatchObject({
      kind: "erc20-transfer",
      label: "ERC20 Transfer",
      amount: "12.34",
      symbol: "USDC",
      assetName: "USD Coin",
      recipientAddress: recipient,
      contractAddress: contract,
      method: "transfer(address,uint256)",
    });
  });

  it("falls back to raw contract call metadata for unsupported calldata", () => {
    const contract = "0x4444444444444444444444444444444444444444" as const;
    const encodedApprove = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: ["0x5555555555555555555555555555555555555555", 1n],
    });

    const summary = buildTransactionSummary({
      networkSymbol: "ETH",
      transaction: {
        to: contract,
        value: 0n,
        input: encodedApprove,
      },
    });

    expect(summary).toMatchObject({
      kind: "contract-call",
      label: "Contract Call",
      method: "0x095ea7b3",
      contractAddress: contract,
    });
  });

  it("normalizes erc20 metadata and falls back to symbol when name is missing", () => {
    expect(
      normalizeErc20TokenMetadata({
        symbol: " USDC ",
        name: "",
        decimals: 6,
      }),
    ).toEqual({
      symbol: "USDC",
      name: "USDC",
      decimals: 6,
    });

    expect(
      normalizeErc20TokenMetadata({
        symbol: null,
        name: "USD Coin",
        decimals: 6,
      }),
    ).toBeNull();
  });

  it("describes insufficient funds errors with actionable hints", () => {
    const feedback = describeTransferError({
      error: new InsufficientFundsError(),
      stage: "broadcast",
    });

    expect(feedback).toMatchObject({
      stage: "broadcast",
      category: "funds",
      title: "余额不足",
    });
    expect(feedback.hints.length).toBeGreaterThan(0);
  });

  it("extracts revert reason into readable transfer feedback", () => {
    const feedback = describeTransferError({
      error: new ExecutionRevertedError({
        message: "execution reverted: ERC20: transfer amount exceeds balance",
      }),
      stage: "estimate",
    });

    expect(feedback).toMatchObject({
      stage: "estimate",
      category: "revert",
      title: "预估阶段检测到链上回退",
    });
    expect(feedback.message).toContain("transfer amount exceeds balance");
  });

  it("maps wallet password failures during signing", () => {
    const feedback = describeTransferError({
      error: new Error("钱包密码不正确，无法解锁本地签名器"),
      stage: "sign",
    });

    expect(feedback).toMatchObject({
      stage: "sign",
      category: "signing",
      title: "钱包密码不正确",
    });
  });

  it("maps rpc request failures to network feedback", () => {
    const feedback = describeTransferError({
      error: new RpcRequestError({
        body: { method: "eth_sendRawTransaction" },
        error: {
          code: -32000,
          message: "upstream unavailable",
        },
        url: "https://rpc.example.org",
      }),
      stage: "broadcast",
    });

    expect(feedback).toMatchObject({
      stage: "broadcast",
      category: "rpc",
      title: "RPC 节点拒绝了请求",
    });
  });

  it("maps duplicate transaction rpc messages to nonce guidance", () => {
    const feedback = describeTransferError({
      error: new RpcRequestError({
        body: { method: "eth_sendRawTransaction" },
        error: {
          code: -32000,
          message: "already known",
        },
        url: "https://rpc.example.org",
      }),
      stage: "broadcast",
    });

    expect(feedback).toMatchObject({
      stage: "broadcast",
      category: "nonce",
      title: "Nonce 已过期",
    });
  });
});
