# Tauri + Vue 全平台 Web3 钱包设计与初始化方案

更新时间：2026-04-01 17:08 CST

## 1. 技术基线

- Tauri 2
- Vue 3.5
- Vite 8
- TypeScript 6
- Pinia 3
- Vue Router 5
- Rust stable

推荐初始化路径：

- 使用 `create-tauri-app` 生成 `vue-ts` 模板。
- 再补齐 `pinia`、`vue-router`、`vitest`、`playwright`。
- 保持单应用根目录结构，`docs/` 单独管理文档。

## 2. 产品定位

产品定位：

- 一个精简版的 `MetaMask` 风格钱包。
- 只做 `EVM-only` 钱包，不做全链钱包。
- 界面和交互参考 MetaMask，但入口更少、层级更浅、设置更少。
- MVP 目标不是“功能多”，而是“边界清晰、转账稳定、安全可控”。

核心边界：

- 只支持 `Native Token` 转账。
- 只支持 `ERC20 Token` 转账。
- 支持预置 EVM 网络。
- 支持自定义 EVM 网络。
- 除以上范围之外的链上能力，MVP 一律不支持。

## 3. MVP 目标

MVP 必须完成：

- 创建钱包
- 导入助记词
- 导入私钥
- 设置钱包密码
- 生物识别解锁
- 锁定与解锁钱包
- 查看账户地址和收款二维码
- 查看 `Native Token` 余额
- 查看 `ERC20 Token` 余额
- 发送 `Native Token`
- 发送 `ERC20 Token`
- 查看最近交易记录
- 切换预置 EVM 网络
- 添加、编辑、删除自定义 EVM 网络
- 手动添加 ERC20 Token 合约

MVP 成功标准：

- 用户可以在几分钟内完成创建钱包并进入资产首页。
- 用户可以完成一次 `Native Token` 转账。
- 用户可以完成一次 `ERC20 Token` 转账。
- 用户可以在预置网络和自定义 EVM 网络之间切换。
- 私钥类数据始终留在本地安全边界内。

## 4. 非目标

以下功能不属于 MVP：

- NFT
- Swap
- Bridge
- Staking
- DeFi 入口
- dApp 浏览器
- WalletConnect
- 浏览器扩展同步
- 消息签名
- Typed Data 签名
- 任意合约交互
- 多链非 EVM 支持
- 硬件钱包
- 法币入金
- 推送通知
- 社交恢复

解释：

- 本项目的 MVP 是“转账钱包”，不是“全功能 Web3 门户”。
- 所有会稀释核心体验或提高安全复杂度的功能，统一延期到后续版本。

## 5. 钱包架构原则

- `Vue` 负责页面、路由、交互、状态编排。
- `Rust/Tauri Core` 负责密钥管理、签名、深链、安全存储、系统能力。
- 真实转账时，前端只负责 `RPC` 估算和原始交易广播，最终签名必须在 `Rust/Tauri Core` 内完成。
- 私钥类数据永不出网、永不进日志、永不进普通数据库、永不进云备份。
- 助记词、seed、私钥不进入 Pinia、不进入浏览器存储、不进入普通 `SQLite`。

## 6. 网络支持策略

支持范围：

- 预置 EVM 网络
- 自定义 EVM 网络

自定义网络仅限：

- 自定义 `RPC URL`
- 自定义 `Chain ID`
- 自定义网络名称
- 自定义原生币符号
- 可选区块浏览器 URL

自定义网络不代表支持任意链协议：

- 只接受 EVM 兼容网络
- 只支持该网络上的 `Native Token`
- 只支持该网络上的 `ERC20 Token`
- 不支持该网络上的 NFT、非 ERC20 标准或任意合约交互

自定义网络校验要求：

- `Chain ID` 必须合法
- `RPC URL` 必须可用
- 网络返回结果必须符合 EVM 预期
- 用户保存前应给出明确校验反馈

## 7. 页面范围

MVP 建议页面：

- 欢迎页
- 创建钱包页
- 导入钱包页
- 助记词备份确认页
- 解锁页
- 资产首页
- 代币详情页
- 发送页
- 收款页
- 交易详情页
- 网络管理页
- 设置页

页面原则：

- 首页只展示核心资产和账户信息
- 不堆太多快捷入口
- 不把设置页做成超级控制台
- 发送流程尽量压缩到最少步骤

推荐路由草案：

- `/welcome`
- `/onboarding/create`
- `/onboarding/import`
- `/onboarding/backup`
- `/unlock`
- `/wallet`
- `/wallet/token/:tokenId`
- `/wallet/send`
- `/wallet/receive`
- `/wallet/tx/:txHash`
- `/settings/networks`
- `/settings`

页面说明：

- `/wallet` 是唯一主首页，默认展示当前账户、当前网络、Native Token 和 Token 列表。
- `/wallet/send` 同时承载 Native Token 与 ERC20 发送流程，通过参数或状态切换资产类型。
- `/settings/networks` 专门处理预置网络切换和自定义网络管理，不把网络配置散落到其他页面。

## 8. 功能优先级

### P0

P0 是 MVP 上线前必须完成的能力：

- 创建钱包
- 导入助记词
- 导入私钥
- 设置钱包密码
- 解锁与锁定
- 账户地址展示
- 收款二维码
- 查看 Native Token 余额
- 查看 ERC20 Token 余额
- 发送 Native Token
- 发送 ERC20 Token
- 预置网络切换
- 自定义 EVM 网络新增
- 自定义 EVM 网络编辑
- 自定义 EVM 网络删除
- 手动添加 ERC20 Token
- 最近交易列表
- 交易详情页

### P1

P1 可以在 MVP 稳定后快速跟进：

- 多账户管理优化
- 代币搜索与排序
- Gas 费用分档展示
- 网络可用性检测
- RPC 失败自动重试
- 自定义网络导入表单增强校验

### P2

P2 明确不是第一阶段要做的：

- NFT
- Swap
- WalletConnect
- 消息签名
- Typed Data 签名
- dApp 浏览器
- Bridge
- Staking

## 9. 开发顺序

建议按里程碑推进，不要并行摊太多页面。

### Milestone 1：安全底座与 Onboarding

- Stronghold 集成
- 钱包密码
- 创建钱包
- 导入助记词
- 导入私钥
- 助记词备份确认
- 解锁页

交付标准：

- 用户可以创建或导入钱包
- 重新打开应用后可以用密码或生物识别解锁
- 私钥类数据不进入前端状态树

当前落地状态：

- 创建钱包由 Rust 侧生成助记词和 EVM 地址。
- 创建流程在备份确认前，助记词只保留在 Rust 内存态，不写入前端状态树。
- 导入钱包由 Rust 侧校验助记词或私钥并推导地址。
- 钱包密码校验由 Rust 侧完成，前端不再持有长期密码 hash。
- 钱包非敏感元数据已落本地 `SQLite`，私钥类数据已落 `Stronghold`。
- `Stronghold` 内的私钥类数据采用可运行时读取的加密 `store record` 持久化，便于后续本地签名。

### Milestone 2：资产首页与网络切换

- 资产首页
- Native Token 余额
- ERC20 Token 列表
- 预置网络切换
- 自定义 EVM 网络管理
- 手动添加 ERC20 Token

交付标准：

- 用户可以切换到预置网络
- 用户可以添加并保存自定义 EVM 网络
- 用户可以在不同网络下看到 Native Token 和 ERC20 余额

### Milestone 3：发送流程

- Native Token 发送
- ERC20 Token 发送
- 地址校验
- 金额校验
- Gas 估算
- 交易确认页
- 发送结果反馈

交付标准：

- 用户可以独立完成一笔 Native Token 转账
- 用户可以独立完成一笔 ERC20 Token 转账
- 发送失败时能拿到明确错误提示

当前落地状态：

- Send 页面已经接入真实签名与广播，不再只是确认摘要。
- 当前签名范围严格限定为：
  - Native Token 转账
  - ERC20 `transfer(address,uint256)`
- 发送时前端会先拉取：
  - `nonce`
  - `gasLimit`
  - `legacy` 或 `eip1559` 费用参数
- 真实签名由 Rust/Tauri Core 完成，发送时必须再次输入钱包密码。
- 广播仍通过前端 `RPC` 客户端发送 `rawTransaction`，私钥类数据不触网。

### Milestone 4：历史与设置完善

- 最近交易记录
- 交易详情页
- 设置页
- 网络管理细节优化
- 生物识别开关

交付标准：

- 用户可以查看最近交易
- 用户可以回看交易详情
- 用户可以管理网络和基础安全设置

## 10. 验收标准

页面级验收：

- 欢迎页只负责进入创建或导入流程，不承载无关入口。
- 创建/导入流程在移动端单手操作可完成。
- 资产首页首屏能看到账户、网络、Native Token 和 Token 列表。
- 发送页必须在提交前展示目标地址、资产、金额、Gas 和网络。
- 网络管理页必须清晰区分“预置网络”和“自定义网络”。

流程级验收：

- 新用户首次安装后，3 分钟内可以创建钱包并进入首页。
- 用户 1 分钟内可以完成一次 Native Token 转账。
- 用户 1 分钟内可以完成一次 ERC20 Token 转账。
- 用户可以成功新增一个自定义 EVM 网络并切换过去。
- 错误 RPC、错误 Chain ID、错误地址都必须给出阻断式反馈。

安全验收：

- 助记词、seed、私钥不进入 Pinia。
- 助记词、seed、私钥不进入浏览器存储。
- 助记词、seed、私钥不进入普通 SQLite。
- 助记词、seed、私钥不进入日志与埋点。
- 自定义网络不会放开非 EVM 或任意合约交互能力。
- 创建钱包时，备份确认前的助记词只允许短暂存在于 Rust 内存态。

## 11. 目录建议

```text
docs/
src/
  pages/
  components/
  router/
  stores/
  services/
  styles/
  types/
src-tauri/
  capabilities/
  src/
    commands/
    wallet/
    signer/
    keystore/
```

## 12. 组件拆分建议

建议优先抽这些组件，不要一开始就做太散的通用组件库：

- `AccountHeader`
- `NetworkSwitcher`
- `AssetList`
- `TokenRow`
- `BalanceCard`
- `SendForm`
- `ReceiveQrCard`
- `TransactionList`
- `TransactionStatusBadge`
- `CustomNetworkForm`

建议优先抽这些状态模块：

- `sessionStore`
- `walletStore`
- `accountsStore`
- `networksStore`
- `assetsStore`
- `transactionsStore`
- `settingsStore`

## 13. 本地存储与加密

敏感层：

- 助记词、seed、私钥使用 `Tauri Stronghold`。
- 生物识别只做解锁门禁，不替代主密钥体系。
- 创建钱包时的待备份助记词仅在 Rust 内存态短暂保存，确认备份后才写入 Stronghold。
- 用于真实签名的钱包密钥记录保存在 `Stronghold` 加密快照里的 `store record` 中，不写入普通数据库。
- 发送链路默认使用“每次发送都要求钱包密码”模式，不在前端长期缓存解锁态签名器。

业务层：

- 地址、公钥、链配置、代币缓存、交易缓存使用 `SQLite`。
- 不把敏感密钥材料写入普通数据库。
- 当前已落地的钱包摘要元数据包括：`walletLabel`、`address`、`source`、`secretKind`、`isBiometricEnabled`、`hasBackedUpMnemonic`、`createdAt`、`lastUnlockedAt`。

配置层：

- 主题、语言、界面开关使用 `Store` 或轻量配置文件。

开发期说明：

- 浏览器里的 `pnpm dev` 预览仅用于 UI/路由联调，不代表最终安全边界。
- 浏览器预览模式不支持真实签名与广播。
- 真正的安全存储、密码校验与交易签名以 Tauri Runtime 下的 Rust + Stronghold + SQLite 实现为准。

## 14. 平台注意事项

- Desktop 优先用于开发调试。
- Android 重点处理深链、生物识别、后台恢复。
- iOS 初始化与构建只能在 macOS 上完成。
- 桌面更新可用 Tauri Updater，移动端默认走应用商店更新。

## 15. 初始化命令

```bash
pnpm dlx create-tauri-app@latest . \
  --template vue-ts \
  --manager pnpm \
  --identifier com.sean.web3wallet \
  --tauri-version 2 \
  --force \
  --yes
```

安装与开发：

```bash
pnpm install
pnpm dev
pnpm tauri dev
```

移动端：

```bash
pnpm tauri android init
pnpm tauri ios init
```

## 16. 参考资料

- Tauri 创建项目: https://v2.tauri.app/start/create-project/
- Tauri 环境准备: https://v2.tauri.app/start/prerequisites/
- Tauri CLI: https://v2.tauri.app/reference/cli/
- Tauri + Vite: https://v2.tauri.app/start/frontend/vite/
- Tauri Stronghold: https://v2.tauri.app/plugin/stronghold/
- Tauri Biometric: https://v2.tauri.app/plugin/biometric/
- Tauri Deep Linking: https://v2.tauri.app/plugin/deep-linking/
- Tauri WebSocket: https://v2.tauri.app/plugin/websocket/
- Vue Quick Start: https://vuejs.org/guide/quick-start.html
- Pinia: https://pinia.vuejs.org/introduction.html
- Vue Router 5: https://router.vuejs.org/guide/migration/v4-to-v5.html
- Android Auto Backup: https://developer.android.com/identity/data/autobackup
- Apple 文件备份排除: https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/FileSystemProgrammingGuide/FileSystemOverview/FileSystemOverview.html
