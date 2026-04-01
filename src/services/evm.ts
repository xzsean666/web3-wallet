import {
  createPublicClient,
  defineChain,
  erc20Abi,
  formatEther,
  formatGwei,
  formatUnits,
  http,
  parseUnits,
  type Address,
  type Hash,
} from "viem";
import type { NetworkConfig } from "../types/network";
import type { PortfolioSnapshot, TransactionDetails, TransferPreview } from "../types/portfolio";
import type { TrackedToken, WalletHex } from "../types/wallet";

const clientCache = new Map<string, ReturnType<typeof createPublicClient>>();

function buildChain(network: NetworkConfig) {
  return defineChain({
    id: network.chainId,
    name: network.name,
    nativeCurrency: {
      name: network.symbol,
      symbol: network.symbol,
      decimals: 18,
    },
    rpcUrls: {
      default: {
        http: [network.rpcUrl],
      },
    },
    blockExplorers: network.explorerUrl
      ? {
          default: {
            name: `${network.name} Explorer`,
            url: network.explorerUrl,
          },
        }
      : undefined,
  });
}

function getPublicClient(network: NetworkConfig) {
  const cacheKey = `${network.id}:${network.rpcUrl}`;
  const existing = clientCache.get(cacheKey);

  if (existing) {
    return existing;
  }

  const client = createPublicClient({
    chain: buildChain(network),
    transport: http(network.rpcUrl),
  });

  clientCache.set(cacheKey, client);
  return client;
}

export async function fetchPortfolioSnapshot(options: {
  network: NetworkConfig;
  address: Address;
  tokens: TrackedToken[];
}): Promise<PortfolioSnapshot> {
  const client = getPublicClient(options.network);
  const [blockNumber, nativeBalance, tokenEntries] = await Promise.all([
    client.getBlockNumber(),
    client.getBalance({
      address: options.address,
    }),
    Promise.all(
      options.tokens.map(async (token) => {
        try {
          const balance = await client.readContract({
            address: token.contractAddress,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [options.address],
          });

          return [token.id, formatUnits(balance, token.decimals)] as const;
        } catch {
          return [token.id, "Unavailable"] as const;
        }
      }),
    ),
  ]);

  return {
    networkId: options.network.id,
    nativeBalance: formatEther(nativeBalance),
    latestBlock: blockNumber.toString(),
    tokenBalances: Object.fromEntries(tokenEntries),
    lastSyncedAt: new Date().toISOString(),
    status: "ready",
    error: "",
  };
}

export async function estimateTransferPreview(options: {
  network: NetworkConfig;
  account: Address;
  recipientAddress: Address;
  amount: string;
  asset:
    | {
        type: "native";
      }
    | {
        type: "erc20";
        token: TrackedToken;
      };
}): Promise<TransferPreview> {
  const chain = buildChain(options.network);
  const client = getPublicClient(options.network);
  const [nonce, dynamicFees, legacyFees] = await Promise.all([
    client.getTransactionCount({
      address: options.account,
      blockTag: "pending",
    }),
    client.estimateFeesPerGas().catch(() => null),
    client.estimateFeesPerGas({ chain, type: "legacy" }).catch(() => null),
  ]);
  const feeMode = dynamicFees?.maxFeePerGas && dynamicFees.maxPriorityFeePerGas
    ? "eip1559"
    : legacyFees?.gasPrice
      ? "legacy"
      : null;

  if (!feeMode) {
    throw new Error("当前 RPC 无法返回可用的 Gas 费用参数");
  }

  if (options.asset.type === "native") {
    const parsedAmount = parseUnits(options.amount, 18);
    const gasLimit = await client.estimateGas({
      account: options.account,
      to: options.recipientAddress,
      value: parsedAmount,
    });
    const feePerGas = feeMode === "eip1559" ? dynamicFees?.maxFeePerGas : legacyFees?.gasPrice;

    return {
      assetType: "native",
      feeMode,
      nonce: nonce.toString(),
      gasLimit: gasLimit.toString(),
      gasPriceWei: legacyFees?.gasPrice?.toString() ?? null,
      gasPriceGwei: legacyFees?.gasPrice ? formatGwei(legacyFees.gasPrice) : null,
      maxFeePerGasWei: dynamicFees?.maxFeePerGas?.toString() ?? null,
      maxFeePerGasGwei: dynamicFees?.maxFeePerGas ? formatGwei(dynamicFees.maxFeePerGas) : null,
      maxPriorityFeePerGasWei: dynamicFees?.maxPriorityFeePerGas?.toString() ?? null,
      maxPriorityFeePerGasGwei: dynamicFees?.maxPriorityFeePerGas
        ? formatGwei(dynamicFees.maxPriorityFeePerGas)
        : null,
      estimatedNetworkFee:
        feePerGas ? formatEther(gasLimit * feePerGas) : null,
      parsedAmount: parsedAmount.toString(),
    };
  }

  const parsedAmount = parseUnits(options.amount, options.asset.token.decimals);
  const gasLimit = await client.estimateContractGas({
    address: options.asset.token.contractAddress,
    abi: erc20Abi,
    functionName: "transfer",
    args: [options.recipientAddress, parsedAmount],
    account: options.account,
  });
  const feePerGas = feeMode === "eip1559" ? dynamicFees?.maxFeePerGas : legacyFees?.gasPrice;

  return {
    assetType: "erc20",
      feeMode,
    nonce: nonce.toString(),
    gasLimit: gasLimit.toString(),
    gasPriceWei: legacyFees?.gasPrice?.toString() ?? null,
    gasPriceGwei: legacyFees?.gasPrice ? formatGwei(legacyFees.gasPrice) : null,
    maxFeePerGasWei: dynamicFees?.maxFeePerGas?.toString() ?? null,
    maxFeePerGasGwei: dynamicFees?.maxFeePerGas ? formatGwei(dynamicFees.maxFeePerGas) : null,
    maxPriorityFeePerGasWei: dynamicFees?.maxPriorityFeePerGas?.toString() ?? null,
    maxPriorityFeePerGasGwei: dynamicFees?.maxPriorityFeePerGas
      ? formatGwei(dynamicFees.maxPriorityFeePerGas)
      : null,
    estimatedNetworkFee:
      feePerGas ? formatEther(gasLimit * feePerGas) : null,
    parsedAmount: parsedAmount.toString(),
    contractAddress: options.asset.token.contractAddress,
  };
}

export async function broadcastSignedTransaction(options: {
  network: NetworkConfig;
  rawTransaction: WalletHex;
}) {
  const client = getPublicClient(options.network);

  return client.sendRawTransaction({
    serializedTransaction: options.rawTransaction,
  });
}

export async function fetchTransactionDetails(options: {
  network: NetworkConfig;
  txHash: Hash;
}): Promise<TransactionDetails> {
  const client = getPublicClient(options.network);
  const [transaction, receipt] = await Promise.all([
    client.getTransaction({ hash: options.txHash }),
    client.getTransactionReceipt({ hash: options.txHash }).catch(() => null),
  ]);

  return {
    hash: transaction.hash,
    from: transaction.from,
    to: transaction.to,
    nonce: transaction.nonce.toString(),
    value: formatEther(transaction.value),
    blockNumber: transaction.blockNumber ? transaction.blockNumber.toString() : null,
    status: receipt
      ? receipt.status === "success"
        ? "success"
        : "reverted"
      : "pending",
    gasLimit: transaction.gas.toString(),
    gasPriceGwei: transaction.gasPrice ? formatGwei(transaction.gasPrice) : null,
    maxFeePerGasGwei: transaction.maxFeePerGas ? formatGwei(transaction.maxFeePerGas) : null,
    maxPriorityFeePerGasGwei: transaction.maxPriorityFeePerGas
      ? formatGwei(transaction.maxPriorityFeePerGas)
      : null,
    explorerUrl: options.network.explorerUrl
      ? `${options.network.explorerUrl.replace(/\/$/, "")}/tx/${transaction.hash}`
      : null,
  };
}
