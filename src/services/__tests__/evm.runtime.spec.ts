import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  TransactionReceiptNotFoundError,
  encodeFunctionData,
  erc20Abi,
  parseUnits,
} from "viem";

const { createPublicClientMock, defineChainMock, httpMock } = vi.hoisted(() => ({
  createPublicClientMock: vi.fn(),
  defineChainMock: vi.fn((value) => value),
  httpMock: vi.fn((value) => ({ url: value })),
}));

vi.mock("viem", async () => {
  const actual = await vi.importActual<typeof import("viem")>("viem");

  return {
    ...actual,
    createPublicClient: createPublicClientMock,
    defineChain: defineChainMock,
    http: httpMock,
  };
});

function createClientMock() {
  return {
    estimateContractGas: vi.fn(),
    estimateFeesPerGas: vi.fn(),
    estimateGas: vi.fn(),
    getBalance: vi.fn(),
    getBlock: vi.fn(),
    getBlockNumber: vi.fn(),
    getChainId: vi.fn(),
    getTransaction: vi.fn(),
    getTransactionCount: vi.fn(),
    getTransactionReceipt: vi.fn(),
    readContract: vi.fn(),
    sendRawTransaction: vi.fn(),
  };
}

async function loadEvm() {
  vi.resetModules();
  return import("../evm");
}

const network = {
  id: "ethereum",
  source: "preset" as const,
  name: "Ethereum",
  chainId: 1,
  rpcUrl: "https://rpc.example.org",
  symbol: "ETH",
  explorerUrl: "https://etherscan.io",
};

const account = "0x1111111111111111111111111111111111111111" as const;
const recipient = "0x2222222222222222222222222222222222222222" as const;
const contractAddress = "0x3333333333333333333333333333333333333333" as const;

describe("evm runtime flows", () => {
  beforeEach(() => {
    vi.resetModules();
    createPublicClientMock.mockReset();
    defineChainMock.mockClear();
    httpMock.mockClear();
  });

  it("reads erc20 metadata from the mocked client", async () => {
    const client = createClientMock();
    client.readContract.mockImplementation(({ functionName }) => {
      if (functionName === "symbol") {
        return Promise.resolve("USDC");
      }

      if (functionName === "name") {
        return Promise.resolve("USD Coin");
      }

      if (functionName === "decimals") {
        return Promise.resolve(6);
      }

      return Promise.resolve(null);
    });
    createPublicClientMock.mockReturnValue(client);
    const evm = await loadEvm();

    await expect(
      evm.readErc20TokenMetadata({
        network,
        contractAddress,
      }),
    ).resolves.toEqual({
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6,
    });
  });

  it("rejects token metadata when the contract does not expose erc20 fields", async () => {
    const client = createClientMock();
    client.readContract.mockRejectedValue(new Error("not erc20"));
    createPublicClientMock.mockReturnValue(client);
    const evm = await loadEvm();

    await expect(
      evm.readErc20TokenMetadata({
        network,
        contractAddress,
      }),
    ).rejects.toThrow("当前合约没有返回可用的 ERC20 元数据");
  });

  it("builds a portfolio snapshot and marks failed token calls as unavailable", async () => {
    const client = createClientMock();
    client.getBlockNumber.mockResolvedValue(123n);
    client.getBalance.mockResolvedValue(parseUnits("5", 18));
    client.readContract
      .mockResolvedValueOnce(parseUnits("12.34", 6))
      .mockRejectedValueOnce(new Error("offline"));
    createPublicClientMock.mockReturnValue(client);
    const evm = await loadEvm();

    const snapshot = await evm.fetchPortfolioSnapshot({
      network,
      address: account,
      tokens: [
        {
          id: "usdc",
          symbol: "USDC",
          name: "USD Coin",
          balance: "0",
          decimals: 6,
          contractAddress,
          networkIds: [network.id],
          source: "custom",
        },
        {
          id: "dai",
          symbol: "DAI",
          name: "Dai",
          balance: "0",
          decimals: 18,
          contractAddress: "0x4444444444444444444444444444444444444444",
          networkIds: [network.id],
          source: "custom",
        },
      ],
    });

    expect(snapshot).toMatchObject({
      networkId: network.id,
      accountAddress: account,
      nativeBalance: "5",
      latestBlock: "123",
      tokenBalances: {
        usdc: "12.34",
        dai: "Unavailable",
      },
      status: "ready",
      error: "",
    });
  });

  it("estimates a native transfer with eip1559 fees", async () => {
    const client = createClientMock();
    client.getTransactionCount.mockResolvedValue(9);
    client.estimateFeesPerGas.mockImplementation((options?: { type?: string }) => {
      if (options?.type === "legacy") {
        return Promise.resolve({ gasPrice: 20_000_000_000n });
      }

      return Promise.resolve({
        maxFeePerGas: 30_000_000_000n,
        maxPriorityFeePerGas: 2_000_000_000n,
      });
    });
    client.estimateGas.mockResolvedValue(21_000n);
    createPublicClientMock.mockReturnValue(client);
    const evm = await loadEvm();

    const preview = await evm.estimateTransferPreview({
      network,
      account,
      recipientAddress: recipient,
      amount: "1.25",
      asset: {
        type: "native",
      },
    });

    expect(preview).toMatchObject({
      assetType: "native",
      feeMode: "eip1559",
      nonce: "9",
      gasLimit: "21000",
      parsedAmount: parseUnits("1.25", 18).toString(),
      maxFeePerGasWei: "30000000000",
      maxPriorityFeePerGasWei: "2000000000",
    });
  });

  it("estimates an erc20 transfer with legacy fees", async () => {
    const client = createClientMock();
    client.getTransactionCount.mockResolvedValue(4);
    client.estimateFeesPerGas.mockImplementation((options?: { type?: string }) => {
      if (options?.type === "legacy") {
        return Promise.resolve({ gasPrice: 12_000_000_000n });
      }

      return Promise.resolve({});
    });
    client.estimateContractGas.mockResolvedValue(65_000n);
    createPublicClientMock.mockReturnValue(client);
    const evm = await loadEvm();

    const preview = await evm.estimateTransferPreview({
      network,
      account,
      recipientAddress: recipient,
      amount: "12.5",
      asset: {
        type: "erc20",
        token: {
          id: "usdc",
          symbol: "USDC",
          name: "USD Coin",
          balance: "0",
          decimals: 6,
          contractAddress,
          networkIds: [network.id],
          source: "custom",
        },
      },
    });

    expect(preview).toMatchObject({
      assetType: "erc20",
      feeMode: "legacy",
      nonce: "4",
      gasLimit: "65000",
      parsedAmount: parseUnits("12.5", 6).toString(),
      contractAddress,
      gasPriceWei: "12000000000",
    });
  });

  it("fails transfer estimation when the rpc does not provide any fee mode", async () => {
    const client = createClientMock();
    client.getTransactionCount.mockResolvedValue(1);
    client.estimateFeesPerGas.mockResolvedValue(null);
    createPublicClientMock.mockReturnValue(client);
    const evm = await loadEvm();

    await expect(
      evm.estimateTransferPreview({
        network,
        account,
        recipientAddress: recipient,
        amount: "0.1",
        asset: {
          type: "native",
        },
      }),
    ).rejects.toThrow("当前 RPC 无法返回可用的 Gas 费用参数");
  });

  it("broadcasts a signed transaction through the mocked client", async () => {
    const client = createClientMock();
    client.sendRawTransaction.mockResolvedValue("0xabc");
    createPublicClientMock.mockReturnValue(client);
    const evm = await loadEvm();

    await expect(
      evm.broadcastSignedTransaction({
        network,
        rawTransaction: "0xdeadbeef",
      }),
    ).resolves.toBe("0xabc");

    expect(client.sendRawTransaction).toHaveBeenCalledWith({
      serializedTransaction: "0xdeadbeef",
    });
  });

  it("validates rpc endpoints for ok, mismatch and transport errors", async () => {
    const okClient = createClientMock();
    okClient.getChainId.mockResolvedValue(1);
    okClient.getBlockNumber.mockResolvedValue(88n);

    const mismatchClient = createClientMock();
    mismatchClient.getChainId.mockResolvedValue(10);
    mismatchClient.getBlockNumber.mockResolvedValue(99n);

    const errorClient = createClientMock();
    errorClient.getChainId.mockRejectedValue(new Error("rpc offline"));

    createPublicClientMock
      .mockReturnValueOnce(okClient)
      .mockReturnValueOnce(mismatchClient)
      .mockReturnValueOnce(errorClient);

    const evm = await loadEvm();

    await expect(
      evm.validateRpcEndpoint({
        expectedChainId: 1,
        rpcUrl: network.rpcUrl,
      }),
    ).resolves.toMatchObject({
      status: "ok",
      actualChainId: 1,
      latestBlock: "88",
    });

    await expect(
      evm.validateRpcEndpoint({
        expectedChainId: 1,
        rpcUrl: "https://other-rpc.example.org",
      }),
    ).resolves.toMatchObject({
      status: "mismatch",
      actualChainId: 10,
      latestBlock: "99",
    });

    await expect(
      evm.validateRpcEndpoint({
        expectedChainId: 1,
        rpcUrl: "https://broken-rpc.example.org",
      }),
    ).resolves.toMatchObject({
      status: "error",
      actualChainId: null,
      latestBlock: null,
      message: "rpc offline",
    });
  });

  it("hydrates confirmed erc20 transaction details", async () => {
    const client = createClientMock();
    const transferData = encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [recipient, parseUnits("12.34", 6)],
    });
    client.getTransaction.mockResolvedValue({
      hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      from: account,
      to: contractAddress,
      nonce: 7,
      value: 0n,
      blockNumber: 11n,
      gas: 65_000n,
      gasPrice: null,
      input: transferData,
      maxFeePerGas: 30_000_000_000n,
      maxPriorityFeePerGas: 2_000_000_000n,
    });
    client.getTransactionReceipt.mockResolvedValue({
      blockNumber: 11n,
      status: "success",
      gasUsed: 55_000n,
      effectiveGasPrice: 20_000_000_000n,
    });
    client.getBlock.mockResolvedValue({
      timestamp: 1_700_000_000n,
    });
    createPublicClientMock.mockReturnValue(client);
    const evm = await loadEvm();

    const details = await evm.fetchTransactionDetails({
      network,
      txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      trackedTokens: [
        {
          id: "usdc",
          symbol: "USDC",
          name: "USD Coin",
          balance: "0",
          decimals: 6,
          contractAddress,
          networkIds: [network.id],
          source: "preset",
        },
      ],
    });

    expect(details).toMatchObject({
      hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      status: "success",
      blockNumber: "11",
      gasUsed: "55000",
      explorerUrl: "https://etherscan.io/tx/0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    expect(details.summary).toMatchObject({
      kind: "erc20-transfer",
      symbol: "USDC",
      recipientAddress: recipient,
      contractAddress,
    });
  });

  it("returns pending native transaction details when the receipt is unavailable", async () => {
    const client = createClientMock();
    client.getTransaction.mockResolvedValue({
      hash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      from: account,
      to: recipient,
      nonce: 3,
      value: parseUnits("0.5", 18),
      blockNumber: null,
      gas: 21_000n,
      gasPrice: 15_000_000_000n,
      input: "0x",
      maxFeePerGas: null,
      maxPriorityFeePerGas: null,
    });
    client.getTransactionReceipt.mockRejectedValue(
      new TransactionReceiptNotFoundError({
        hash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      }),
    );
    createPublicClientMock.mockReturnValue(client);
    const evm = await loadEvm();

    const details = await evm.fetchTransactionDetails({
      network,
      txHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });

    expect(details).toMatchObject({
      status: "pending",
      blockNumber: null,
      gasUsed: null,
      actualNetworkFee: null,
      gasPriceGwei: "15",
    });
    expect(details.summary).toMatchObject({
      kind: "native-transfer",
      recipientAddress: recipient,
      symbol: "ETH",
      amount: "0.5",
    });
  });

  it("rethrows unexpected receipt errors when the RPC call fails", async () => {
    const client = createClientMock();
    client.getTransaction.mockResolvedValue({
      hash: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      from: account,
      to: recipient,
      nonce: 4,
      value: parseUnits("1", 18),
      blockNumber: null,
      gas: 21_000n,
      gasPrice: 15_000_000_000n,
      input: "0x",
      maxFeePerGas: null,
      maxPriorityFeePerGas: null,
    });
    client.getTransactionReceipt.mockRejectedValue(new Error("rpc offline"));
    createPublicClientMock.mockReturnValue(client);
    const evm = await loadEvm();

    await expect(
      evm.fetchTransactionDetails({
        network,
        txHash: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      }),
    ).rejects.toThrow("rpc offline");
  });
});
