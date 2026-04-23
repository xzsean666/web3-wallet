import {
  BaseError,
  createPublicClient,
  decodeFunctionData,
  ExecutionRevertedError,
  FeeCapTooLowError,
  defineChain,
  erc20Abi,
  formatEther,
  formatGwei,
  formatUnits,
  http,
  HttpRequestError,
  InsufficientFundsError,
  IntrinsicGasTooHighError,
  IntrinsicGasTooLowError,
  NonceTooHighError,
  NonceTooLowError,
  parseUnits,
  RpcRequestError,
  TimeoutError,
  TransactionReceiptNotFoundError,
  type Address,
  type Hash,
} from "viem";
import type { NetworkConfig, RpcEndpointValidation } from "../types/network";
import type {
  PortfolioSnapshot,
  TransactionDetails,
  TransferErrorFeedback,
  TransactionSummary,
  TransferPreview,
} from "../types/portfolio";
import type { TrackedToken, WalletAddress, WalletHex } from "../types/wallet";
import { buildTransactionExplorerUrl } from "../utils/runtimeSafety";
import { normalizeTokenName, normalizeTokenSymbol } from "../utils/tokenSafety";

const clientCache = new Map<string, ReturnType<typeof createPublicClient>>();
const MAX_NATIVE_TRANSFER_GAS_LIMIT = 100_000n;
const MAX_ERC20_TRANSFER_GAS_LIMIT = 500_000n;
const MAX_TRANSFER_FEE_PER_GAS_WEI = parseUnits("5000", 9);
const MAX_PRIORITY_FEE_PER_GAS_WEI = parseUnits("1000", 9);
const MAX_ESTIMATED_NETWORK_FEE_WEI = parseUnits("0.1", 18);

interface TokenMetadata {
  symbol: string | null;
  name: string | null;
  decimals: number | null;
}

export interface Erc20TokenMetadata {
  symbol: string;
  name: string;
  decimals: number;
}

interface TransactionSummaryInput {
  to: WalletAddress | null;
  value: bigint;
  input: WalletHex;
}

interface DecodedErc20Transfer {
  recipientAddress: WalletAddress;
  amount: bigint;
  method: "transfer(address,uint256)";
}

type TransferStage = TransferErrorFeedback["stage"];

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

function normalizeRpcValidationError(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return "RPC 节点当前不可用，无法完成链上校验";
}

function isPendingReceiptError(error: unknown) {
  if (error instanceof TransactionReceiptNotFoundError) {
    return true;
  }

  if (error instanceof BaseError) {
    return Boolean(
      error.walk((current) => current instanceof TransactionReceiptNotFoundError),
    );
  }

  return false;
}

function formatBlockTimestamp(timestamp: bigint) {
  return new Date(Number(timestamp) * 1000).toISOString();
}

function sanitizeErrorText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function getTransferStageLabel(stage: TransferStage) {
  switch (stage) {
    case "estimate":
      return "预估阶段";
    case "sign":
      return "签名阶段";
    case "broadcast":
      return "广播阶段";
  }
}

function buildTransferFeedback(
  stage: TransferStage,
  category: TransferErrorFeedback["category"],
  title: string,
  message: string,
  hints: string[],
): TransferErrorFeedback {
  return {
    stage,
    category,
    title,
    message,
    hints,
  };
}

function extractRevertReason(message: string) {
  const matched = message.match(/with reason:\s*(.+?)\.?$/i);

  if (!matched) {
    return null;
  }

  return sanitizeErrorText(matched[1]);
}

function describeTransferMessageFallback(
  stage: TransferStage,
  message: string,
): TransferErrorFeedback | null {
  const normalized = sanitizeErrorText(message).toLowerCase();

  if (!normalized) {
    return null;
  }

  if (/insufficient funds|exceeds transaction sender account balance/.test(normalized)) {
    return buildTransferFeedback(
      stage,
      "funds",
      "余额不足",
      "账户余额不足以同时覆盖转账金额和 Gas 费用。",
      ["减少发送金额后重新估算", "确认原生币余额足够支付手续费"],
    );
  }

  if (/nonce too low|already known|transaction already imported/.test(normalized)) {
    return buildTransferFeedback(
      stage,
      "nonce",
      "Nonce 已过期",
      "当前交易使用的 nonce 已经过时，节点不会再次接受它。",
      ["点击“重新估算”获取新的 nonce", "确认是否有同地址交易刚刚发出"],
    );
  }

  if (/nonce too high/.test(normalized)) {
    return buildTransferFeedback(
      stage,
      "nonce",
      "Nonce 过高",
      "当前交易使用的 nonce 高于节点预期，通常说明确认摘要已经过时。",
      ["点击“重新估算”重新生成确认摘要"],
    );
  }

  if (/max fee per gas less than block base fee|fee cap less than block base fee|transaction is outdated/.test(normalized)) {
    return buildTransferFeedback(
      stage,
      "fee",
      "Gas 费用参数过低",
      "当前 Gas 费用参数已经落后于链上最新 base fee，节点不会接受这笔交易。",
      ["点击“重新估算”刷新费用参数"],
    );
  }

  if (/intrinsic gas too low|intrinsic gas too high|gas limit reached/.test(normalized)) {
    return buildTransferFeedback(
      stage,
      "gas",
      "Gas Limit 不可用",
      "当前交易使用的 Gas Limit 没有通过节点校验。",
      ["点击“重新估算”刷新 Gas Limit"],
    );
  }

  if (/gas limit 异常/.test(normalized)) {
    return buildTransferFeedback(
      stage,
      "gas",
      "Gas Limit 异常",
      "当前 RPC 返回了明显异常的 Gas Limit，已拒绝继续使用这组估算参数。",
      ["切换到可信 RPC 后重新估算", "不要继续使用这次返回的费用参数"],
    );
  }

  if (/gas price 异常|max fee 异常|priority fee 异常|网络费异常|网络费已经高于发送金额/.test(normalized)) {
    return buildTransferFeedback(
      stage,
      "fee",
      "Gas 费用参数异常",
      message,
      ["切换到可信 RPC 后重新估算", "不要继续使用这次返回的费用参数"],
    );
  }

  if (/execution reverted|gas required exceeds allowance/.test(normalized)) {
    const reason = extractRevertReason(message);

    return buildTransferFeedback(
      stage,
      "revert",
      `${getTransferStageLabel(stage)}检测到链上回退`,
      reason ? `合约执行会回退：${reason}` : "合约执行会回退，但当前节点没有返回明确原因。",
      ["确认收款地址、金额和 Token 合约都正确"],
    );
  }

  if (/rpc request failed|http request failed|request took too long|socket has been closed/.test(normalized)) {
    return buildTransferFeedback(
      stage,
      "rpc",
      "RPC 节点响应异常",
      "当前 RPC 节点没有稳定返回结果，发送流程无法继续。",
      ["稍后重试", "必要时切换到其他可用 RPC 节点"],
    );
  }

  return null;
}

function assertReasonableTransferQuote(options: {
  assetType: "native" | "erc20";
  amountWei: bigint;
  gasLimit: bigint;
  gasPriceWei: bigint | null;
  maxFeePerGasWei: bigint | null;
  maxPriorityFeePerGasWei: bigint | null;
}) {
  const gasLimitCap =
    options.assetType === "native" ? MAX_NATIVE_TRANSFER_GAS_LIMIT : MAX_ERC20_TRANSFER_GAS_LIMIT;

  if (options.gasLimit <= 0n || options.gasLimit > gasLimitCap) {
    throw new Error("当前 RPC 返回的 Gas Limit 异常，已拒绝使用这组估算参数");
  }

  if (
    options.gasPriceWei !== null &&
    (options.gasPriceWei <= 0n || options.gasPriceWei > MAX_TRANSFER_FEE_PER_GAS_WEI)
  ) {
    throw new Error("当前 RPC 返回的 Gas Price 异常偏高，已拒绝使用这组估算参数");
  }

  if (
    options.maxFeePerGasWei !== null &&
    (options.maxFeePerGasWei <= 0n || options.maxFeePerGasWei > MAX_TRANSFER_FEE_PER_GAS_WEI)
  ) {
    throw new Error("当前 RPC 返回的 Max Fee 异常偏高，已拒绝使用这组估算参数");
  }

  if (
    options.maxPriorityFeePerGasWei !== null &&
    (
      options.maxPriorityFeePerGasWei <= 0n ||
      options.maxPriorityFeePerGasWei > MAX_PRIORITY_FEE_PER_GAS_WEI ||
      (
        options.maxFeePerGasWei !== null &&
        options.maxPriorityFeePerGasWei > options.maxFeePerGasWei
      )
    )
  ) {
    throw new Error("当前 RPC 返回的 Priority Fee 异常，已拒绝使用这组估算参数");
  }

  const effectiveFeePerGas = options.maxFeePerGasWei ?? options.gasPriceWei;

  if (effectiveFeePerGas === null) {
    return;
  }

  const estimatedNetworkFee = options.gasLimit * effectiveFeePerGas;

  if (estimatedNetworkFee > MAX_ESTIMATED_NETWORK_FEE_WEI) {
    throw new Error("当前 RPC 返回的预计网络费异常偏高，已拒绝继续签名");
  }

  if (
    options.assetType === "native" &&
    options.amountWei > 0n &&
    estimatedNetworkFee >= options.amountWei
  ) {
    throw new Error("当前预计网络费已经高于发送金额，已拒绝继续签名");
  }
}

function describeSigningFailure(message: string): Omit<TransferErrorFeedback, "stage"> {
  if (message.includes("钱包密码不正确")) {
    return {
      category: "signing",
      title: "钱包密码不正确",
      message: "本地签名器没有解锁成功，当前密码无法用于签名发送。",
      hints: ["重新输入钱包密码", "确认正在操作的是当前这个钱包"],
    };
  }

  if (message.includes("缺少可签名的本地密钥记录")) {
    return {
      category: "signing",
      title: "本地签名密钥不可用",
      message: "当前钱包缺少可用的本地密钥记录，无法继续完成签名。",
      hints: ["重新导入钱包", "或重新创建当前测试钱包后再发送"],
    };
  }

  if (message.includes("本地密钥记录已损坏")) {
    return {
      category: "signing",
      title: "本地密钥记录已损坏",
      message: "当前设备里的签名材料已经不可用，发送流程无法继续。",
      hints: ["重新导入钱包", "完成导入前不要继续尝试发送"],
    };
  }

  return {
    category: "signing",
    title: "本地签名失败",
    message: message || "本地签名器返回了未分类错误，当前无法完成签名。",
    hints: ["确认钱包密码正确", "如问题持续，请重新导入或重新创建钱包"],
  };
}

export function describeTransferError(options: {
  error: unknown;
  stage: TransferStage;
}): TransferErrorFeedback {
  const { error, stage } = options;
  const baseError = error instanceof BaseError ? error : null;
  const signingMessage =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? sanitizeErrorText(error.message)
        : "";

  if (stage === "sign" && signingMessage) {
    const signingFeedback = describeSigningFailure(signingMessage);

    return buildTransferFeedback(
      stage,
      signingFeedback.category,
      signingFeedback.title,
      signingFeedback.message,
      signingFeedback.hints,
    );
  }

  if (baseError) {
    const insufficientFundsError = baseError.walk(
      (current) => current instanceof InsufficientFundsError,
    );
    if (insufficientFundsError instanceof InsufficientFundsError) {
      return buildTransferFeedback(
        stage,
        "funds",
        "余额不足",
        "账户余额不足以同时覆盖转账金额和 Gas 费用。",
        [
          "减少发送金额后重新估算",
          "确认当前网络的原生币余额足够支付手续费",
        ],
      );
    }

    const nonceTooLowError = baseError.walk((current) => current instanceof NonceTooLowError);
    if (nonceTooLowError instanceof NonceTooLowError) {
      return buildTransferFeedback(
        stage,
        "nonce",
        "Nonce 已过期",
        "当前交易使用的 nonce 已经落后于账户最新状态，节点拒绝了这笔交易。",
        ["点击“重新估算”获取新的 nonce", "确认是否有同地址交易刚刚发出"],
      );
    }

    const nonceTooHighError = baseError.walk((current) => current instanceof NonceTooHighError);
    if (nonceTooHighError instanceof NonceTooHighError) {
      return buildTransferFeedback(
        stage,
        "nonce",
        "Nonce 过高",
        "当前交易使用的 nonce 高于节点预期，通常意味着本地确认摘要已经过时。",
        ["点击“重新估算”重新生成确认摘要"],
      );
    }

    const feeCapTooLowError = baseError.walk((current) => current instanceof FeeCapTooLowError);
    if (feeCapTooLowError instanceof FeeCapTooLowError) {
      return buildTransferFeedback(
        stage,
        "fee",
        "Gas 费用参数过低",
        "当前 `maxFeePerGas` 已经低于链上最新 base fee，节点不会接受这笔交易。",
        ["点击“重新估算”刷新费用参数", "在网络拥堵时尽量不要长时间停留在旧确认摘要"],
      );
    }

    const intrinsicGasTooLowError = baseError.walk(
      (current) => current instanceof IntrinsicGasTooLowError,
    );
    if (intrinsicGasTooLowError instanceof IntrinsicGasTooLowError) {
      return buildTransferFeedback(
        stage,
        "gas",
        "Gas Limit 过低",
        "当前交易提供的 Gas Limit 低于节点要求，无法继续执行。",
        ["点击“重新估算”刷新 Gas Limit"],
      );
    }

    const intrinsicGasTooHighError = baseError.walk(
      (current) => current instanceof IntrinsicGasTooHighError,
    );
    if (intrinsicGasTooHighError instanceof IntrinsicGasTooHighError) {
      return buildTransferFeedback(
        stage,
        "gas",
        "Gas Limit 过高",
        "当前交易提供的 Gas Limit 超出了节点允许范围，节点拒绝处理。",
        ["点击“重新估算”刷新 Gas Limit", "确认当前 RPC 节点状态正常"],
      );
    }

    const revertedError = baseError.walk(
      (current) => current instanceof ExecutionRevertedError,
    );
    if (revertedError instanceof ExecutionRevertedError) {
      const reason = extractRevertReason(revertedError.shortMessage);

      return buildTransferFeedback(
        stage,
        "revert",
        `${getTransferStageLabel(stage)}检测到链上回退`,
        reason ? `合约执行会回退：${reason}` : "合约执行会回退，但当前节点没有返回明确原因。",
        [
          "确认收款地址、金额和 Token 合约都正确",
          "如是 ERC20，请确认发送地址持有足够 Token 余额",
        ],
      );
    }

    const rpcRequestError = baseError.walk((current) => current instanceof RpcRequestError);
    if (rpcRequestError instanceof RpcRequestError) {
      const fallback = describeTransferMessageFallback(
        stage,
        rpcRequestError.details ?? rpcRequestError.shortMessage,
      );
      if (fallback) {
        return fallback;
      }

      return buildTransferFeedback(
        stage,
        "rpc",
        "RPC 节点拒绝了请求",
        rpcRequestError.details
          ? sanitizeErrorText(rpcRequestError.details)
          : "当前 RPC 节点拒绝了请求，无法继续完成发送流程。",
        [
          "确认当前网络 RPC 可用",
          "必要时切换网络设置里的 RPC 节点后重试",
        ],
      );
    }

    const httpRequestError = baseError.walk((current) => current instanceof HttpRequestError);
    if (httpRequestError instanceof HttpRequestError) {
      return buildTransferFeedback(
        stage,
        "rpc",
        "RPC 网络请求失败",
        "当前 RPC 节点没有正常响应，请求在网络层已经失败。",
        [
          "检查节点 URL 是否可用",
          "稍后重试，或切换到其他可用 RPC",
        ],
      );
    }

    const timeoutError = baseError.walk((current) => current instanceof TimeoutError);
    if (timeoutError instanceof TimeoutError) {
      return buildTransferFeedback(
        stage,
        "rpc",
        "RPC 请求超时",
        "当前 RPC 节点响应过慢，发送流程在等待节点返回时超时。",
        [
          "稍后重试",
          "如频繁超时，切换到其他可用 RPC 节点",
        ],
      );
    }

    const fallbackFromBaseError = describeTransferMessageFallback(
      stage,
      `${baseError.shortMessage} ${baseError.details}`,
    );
    if (fallbackFromBaseError) {
      return fallbackFromBaseError;
    }

    return buildTransferFeedback(
      stage,
      "unknown",
      `${getTransferStageLabel(stage)}失败`,
      sanitizeErrorText(baseError.shortMessage || baseError.details || baseError.message),
      ["如提示已过期，请重新估算", "如问题持续，请检查当前 RPC 节点和账户状态"],
    );
  }

  const fallbackFromPlainMessage = describeTransferMessageFallback(stage, signingMessage);
  if (fallbackFromPlainMessage) {
    return fallbackFromPlainMessage;
  }

  return buildTransferFeedback(
    stage,
    "unknown",
    `${getTransferStageLabel(stage)}失败`,
    signingMessage || "当前阶段发生了未分类错误，无法继续发送流程。",
    ["重新估算并重试", "如问题持续，请检查当前网络和钱包状态"],
  );
}

function findTrackedTokenByContract(trackedTokens: TrackedToken[], contractAddress: WalletAddress) {
  return (
    trackedTokens.find(
      (token) => token.contractAddress.toLowerCase() === contractAddress.toLowerCase(),
    ) ?? null
  );
}

async function resolveTokenMetadata(options: {
  client: ReturnType<typeof createPublicClient>;
  contractAddress: WalletAddress;
  trackedToken: TrackedToken | null;
}): Promise<TokenMetadata> {
  if (options.trackedToken) {
    return {
      symbol: options.trackedToken.symbol,
      name: options.trackedToken.name,
      decimals: options.trackedToken.decimals,
    };
  }

  const [symbol, name, decimals] = await Promise.all([
    options.client
      .readContract({
        address: options.contractAddress,
        abi: erc20Abi,
        functionName: "symbol",
      })
      .catch(() => null),
    options.client
      .readContract({
        address: options.contractAddress,
        abi: erc20Abi,
        functionName: "name",
      })
      .catch(() => null),
    options.client
      .readContract({
        address: options.contractAddress,
        abi: erc20Abi,
        functionName: "decimals",
      })
      .catch(() => null),
  ]);

  return {
    symbol: typeof symbol === "string" ? symbol : null,
    name: typeof name === "string" ? name : null,
    decimals:
      typeof decimals === "number"
        ? decimals
        : typeof decimals === "bigint"
          ? Number(decimals)
          : null,
  };
}

export function normalizeErc20TokenMetadata(
  metadata: TokenMetadata,
): Erc20TokenMetadata | null {
  const symbol = normalizeTokenSymbol(metadata.symbol)?.toUpperCase() ?? "";
  const name = normalizeTokenName(metadata.name, symbol) ?? "";

  if (!symbol) {
    return null;
  }

  if (
    metadata.decimals === null ||
    !Number.isInteger(metadata.decimals) ||
    metadata.decimals < 0 ||
    metadata.decimals > 36
  ) {
    return null;
  }

  return {
    symbol,
    name: name || symbol,
    decimals: metadata.decimals,
  };
}

export async function readErc20TokenMetadata(options: {
  network: NetworkConfig;
  contractAddress: WalletAddress;
  trackedTokens?: TrackedToken[];
}): Promise<Erc20TokenMetadata> {
  const client = getPublicClient(options.network);
  const metadata = await resolveTokenMetadata({
    client,
    contractAddress: options.contractAddress,
    trackedToken: findTrackedTokenByContract(options.trackedTokens ?? [], options.contractAddress),
  });
  const normalizedMetadata = normalizeErc20TokenMetadata(metadata);

  if (!normalizedMetadata) {
    throw new Error("当前合约没有返回可用的 ERC20 元数据");
  }

  return normalizedMetadata;
}

export function decodeErc20TransferData(data: WalletHex): DecodedErc20Transfer | null {
  if (data === "0x") {
    return null;
  }

  try {
    const decoded = decodeFunctionData({
      abi: erc20Abi,
      data,
    });

    if (decoded.functionName !== "transfer") {
      return null;
    }

    const [recipientAddress, amount] = decoded.args;

    if (typeof recipientAddress !== "string" || typeof amount !== "bigint") {
      return null;
    }

    return {
      recipientAddress: recipientAddress as WalletAddress,
      amount,
      method: "transfer(address,uint256)",
    };
  } catch {
    return null;
  }
}

export function buildTransactionSummary(options: {
  networkSymbol: string;
  transaction: TransactionSummaryInput;
  decodedErc20Transfer?: DecodedErc20Transfer | null;
  tokenMetadata?: TokenMetadata | null;
}): TransactionSummary {
  if (options.transaction.to && options.decodedErc20Transfer) {
    const decimals = options.tokenMetadata?.decimals;
    const formattedAmount =
      typeof decimals === "number"
        ? formatUnits(options.decodedErc20Transfer.amount, decimals)
        : options.decodedErc20Transfer.amount.toString();

    return {
      kind: "erc20-transfer",
      label: "ERC20 Transfer",
      method: options.decodedErc20Transfer.method,
      amount: formattedAmount,
      symbol: options.tokenMetadata?.symbol ?? null,
      assetName: options.tokenMetadata?.name ?? null,
      recipientAddress: options.decodedErc20Transfer.recipientAddress,
      contractAddress: options.transaction.to,
    };
  }

  if (options.transaction.to && options.transaction.input === "0x") {
    return {
      kind: "native-transfer",
      label: "Native Transfer",
      method: null,
      amount: formatEther(options.transaction.value),
      symbol: options.networkSymbol,
      assetName: `${options.networkSymbol} Native Token`,
      recipientAddress: options.transaction.to,
      contractAddress: null,
    };
  }

  return {
    kind: "contract-call",
    label: options.transaction.to ? "Contract Call" : "Contract Creation",
    method:
      options.transaction.input !== "0x" && options.transaction.input.length >= 10
        ? options.transaction.input.slice(0, 10)
        : null,
    amount: null,
    symbol: null,
    assetName: null,
    recipientAddress: null,
    contractAddress: options.transaction.to,
  };
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
    accountAddress: options.address,
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

    assertReasonableTransferQuote({
      assetType: "native",
      amountWei: parsedAmount,
      gasLimit,
      gasPriceWei: feeMode === "legacy" ? legacyFees?.gasPrice ?? null : null,
      maxFeePerGasWei: feeMode === "eip1559" ? dynamicFees?.maxFeePerGas ?? null : null,
      maxPriorityFeePerGasWei:
        feeMode === "eip1559" ? dynamicFees?.maxPriorityFeePerGas ?? null : null,
    });

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

  assertReasonableTransferQuote({
    assetType: "erc20",
    amountWei: parsedAmount,
    gasLimit,
    gasPriceWei: feeMode === "legacy" ? legacyFees?.gasPrice ?? null : null,
    maxFeePerGasWei: feeMode === "eip1559" ? dynamicFees?.maxFeePerGas ?? null : null,
    maxPriorityFeePerGasWei:
      feeMode === "eip1559" ? dynamicFees?.maxPriorityFeePerGas ?? null : null,
  });

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

export async function validateRpcEndpoint(options: {
  expectedChainId: number;
  rpcUrl: string;
}): Promise<RpcEndpointValidation> {
  const startedAt = Date.now();
  const client = createPublicClient({
    transport: http(options.rpcUrl),
  });

  try {
    const [actualChainId, latestBlock] = await Promise.all([
      client.getChainId(),
      client.getBlockNumber(),
    ]);
    const latencyMs = Date.now() - startedAt;

    if (actualChainId !== options.expectedChainId) {
      return {
        status: "mismatch",
        message: `RPC 返回的 Chain ID 是 ${actualChainId}，和表单中的 ${options.expectedChainId} 不一致`,
        expectedChainId: options.expectedChainId,
        actualChainId,
        latestBlock: latestBlock.toString(),
        latencyMs,
        checkedAt: new Date().toISOString(),
      };
    }

    return {
      status: "ok",
      message: "RPC 可访问，Chain ID 与最新区块响应匹配，但这不代表该 RPC 可信",
      expectedChainId: options.expectedChainId,
      actualChainId,
      latestBlock: latestBlock.toString(),
      latencyMs,
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: "error",
      message: normalizeRpcValidationError(error),
      expectedChainId: options.expectedChainId,
      actualChainId: null,
      latestBlock: null,
      latencyMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
    };
  }
}

export async function fetchTransactionDetails(options: {
  network: NetworkConfig;
  txHash: Hash;
  trackedTokens?: TrackedToken[];
}): Promise<TransactionDetails> {
  const client = getPublicClient(options.network);
  const receiptPromise = client.getTransactionReceipt({ hash: options.txHash }).catch((error) => {
    if (isPendingReceiptError(error)) {
      return null;
    }

    throw error;
  });
  const [transaction, receipt] = await Promise.all([
    client.getTransaction({ hash: options.txHash }),
    receiptPromise,
  ]);
  const confirmedBlock =
    receipt?.blockNumber !== undefined
      ? await client.getBlock({ blockNumber: receipt.blockNumber }).catch(() => null)
      : null;
  const transactionTo = transaction.to as WalletAddress | null;

  if (transaction.hash.toLowerCase() !== options.txHash.toLowerCase()) {
    throw new Error("RPC 返回的交易哈希和请求不一致");
  }

  if (
    receipt?.transactionHash &&
    receipt.transactionHash.toLowerCase() !== options.txHash.toLowerCase()
  ) {
    throw new Error("RPC 返回的交易回执和请求哈希不一致");
  }

  if (
    typeof transaction.blockHash === "string" &&
    typeof receipt?.blockHash === "string" &&
    transaction.blockHash.toLowerCase() !== receipt.blockHash.toLowerCase()
  ) {
    throw new Error("RPC 返回的交易和回执区块不一致");
  }

  const decodedErc20Transfer = decodeErc20TransferData(transaction.input as WalletHex);
  const tokenMetadata =
    transactionTo && decodedErc20Transfer
      ? await resolveTokenMetadata({
          client,
          contractAddress: transactionTo,
          trackedToken: findTrackedTokenByContract(options.trackedTokens ?? [], transactionTo),
        })
      : null;
  const effectiveGasPrice = receipt?.effectiveGasPrice ?? transaction.gasPrice ?? null;
  const actualNetworkFee =
    receipt?.gasUsed && effectiveGasPrice ? formatEther(receipt.gasUsed * effectiveGasPrice) : null;

  return {
    hash: transaction.hash,
    from: transaction.from,
    to: transaction.to,
    nonce: transaction.nonce.toString(),
    value: formatEther(transaction.value),
    blockNumber: transaction.blockNumber ? transaction.blockNumber.toString() : null,
    confirmedAt: confirmedBlock ? formatBlockTimestamp(confirmedBlock.timestamp) : null,
    status: receipt
      ? receipt.status === "success"
        ? "success"
        : "reverted"
      : "pending",
    gasLimit: transaction.gas.toString(),
    gasUsed: receipt?.gasUsed ? receipt.gasUsed.toString() : null,
    gasPriceGwei: transaction.gasPrice ? formatGwei(transaction.gasPrice) : null,
    effectiveGasPriceGwei: effectiveGasPrice ? formatGwei(effectiveGasPrice) : null,
    maxFeePerGasGwei: transaction.maxFeePerGas ? formatGwei(transaction.maxFeePerGas) : null,
    maxPriorityFeePerGasGwei: transaction.maxPriorityFeePerGas
      ? formatGwei(transaction.maxPriorityFeePerGas)
      : null,
    actualNetworkFee,
    explorerUrl: buildTransactionExplorerUrl(options.network.explorerUrl, transaction.hash),
    summary: buildTransactionSummary({
      networkSymbol: options.network.symbol,
      transaction: {
        to: transactionTo,
        value: transaction.value,
        input: transaction.input as WalletHex,
      },
      decodedErc20Transfer,
      tokenMetadata,
    }),
  };
}
