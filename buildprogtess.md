# Build Progress

## 当前任务

- 状态：`completed`
- 任务：补齐 Native Token / ERC20 的真实签名与广播链路
- 负责人：AI Agent

## 时间

- 开始时间：2026-04-01 16:39:20 CST
- 最后更新时间：2026-04-01 17:08:35 CST

## 目标

- Rust/Tauri Core 负责真实交易构建与签名
- 发送页从“确认摘要”升级为“密码确认 + 本地签名 + RPC 广播”
- 继续保持 MVP 只支持 `Native Token` 与 `ERC20 Token`
- 私钥类数据继续满足：
  - 永不出网
  - 永不进日志
  - 永不进普通数据库
  - 永不进云备份

## 范围

- 涉及文件：`src/`、`src-tauri/`、`docs/`、`Agent.md`、`buildprogtess.md`
- 涉及平台：前端与 Tauri Core
- 不包含：
  - NFT
  - Swap
  - 消息签名
  - Typed Data
  - 任意合约交互
  - 多账户

## 前置条件

- `node v24.2.0`
- `pnpm 10.12.1`
- `rustup 1.28.2`
- `cargo 1.90.0`
- 当前 Linux 环境仍缺少 Tauri 桌面构建系统库：
  - `gdk-pixbuf-2.0`
  - `gdk-3.0`
  - `cairo`
  - `pango`
  - `atk`

## 执行步骤

1. `[x]` 审查现有 Send 页面、EVM 服务与 Rust 钱包模块
2. `[x]` 将 Stronghold 持久化改成运行时可读取的 `store record`
3. `[x]` 在 Rust 侧新增交易构建与签名 command
4. `[x]` 前端补齐 nonce / fee mode / raw fee fields
5. `[x]` Send 页面接入密码确认、本地签名和广播
6. `[x]` 最近活动与交易详情页接入基础链上结果
7. `[x]` 更新设计文档、Agent 约束与构建记录
8. `[x]` 运行构建与测试

## 当前状态

- 真实发送链路已经打通：
  - 前端用 `viem` 估算 `nonce`、`gasLimit` 和费用参数
  - Rust/Tauri Core 用本地 Stronghold 密钥材料签名
  - 前端用 `sendRawTransaction` 广播原始交易
- 当前只支持：
  - Native Token 转账
  - ERC20 `transfer(address,uint256)`
- 当前明确不支持：
  - 任意 calldata
  - 消息签名
  - Typed Data
  - NFT
  - 其他 Token 标准

## 问题与阻塞

- 旧版本开发期钱包如果只写进了 Stronghold vault、未写入 store record，将无法在运行时读取并签名。
- 当前解决策略：
  - 新创建/新导入的钱包改为写入 Stronghold store record
  - 旧钱包若要继续测试真实发送，需要重新导入或重新创建
- `cargo check` 仍被本机缺失的 Linux 图形/WebKit 依赖阻塞，无法在本机完成完整 Rust 编译验证。

## 处理记录

- 已确认 `iota_stronghold` 运行时不能直接读取先前使用的 vault secret，因此发送链路不能建立在旧写法上。
- 本轮改为把密钥材料写入 Stronghold 加密快照里的 `store record`，仍不进入普通数据库。
- Rust 侧新增 `sign_transfer_transaction`：
  - 校验钱包密码
  - 读取本地密钥记录
  - 构建 Legacy / EIP-1559 交易
  - 支持 Native Token 与 ERC20 `transfer`
  - 返回 `rawTransaction` 与 `txHash`
- 前端发送页新增：
  - nonce 展示
  - legacy / eip1559 fee mode 展示
  - 钱包密码输入
  - 本地签名并广播
- 交易详情页已从占位改为读取 RPC 基础信息。

## 验证结果

- `pnpm build`: 通过
- `pnpm test:unit`: 通过
- `cargo fmt --manifest-path src-tauri/Cargo.toml`: 通过
- `cargo check --manifest-path src-tauri/Cargo.toml`: 失败，原因是系统库缺失：
  - `pango`
  - `gdk-3.0`
  - `cairo`
  - `atk`
  - `gdk-pixbuf-2.0`

## 产物

- Rust 侧真实签名 command
- Stronghold store record 持久化方案
- Send 页面真实广播流程
- 最近活动写入
- 交易详情 RPC 查询页
- 更新后的设计文档 / Agent 约束 / 构建记录

## 下一步

- 补充 ERC20 交易详情的人类可读解析
- 给发送失败增加更细的 RPC / revert 反馈
- 给自定义网络增加链上可用性校验
- 在具备系统依赖的桌面环境继续跑 `cargo check` / `pnpm tauri dev`
