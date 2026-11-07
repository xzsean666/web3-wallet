# Build Progress

## 当前任务

- 状态：`completed`
- 任务：全面走查所有 UI 与业务逻辑（简约、易用深度重构），执行缺陷排查、全量测试验证，准备 Git Commit、Push 并触发 GitHub Actions CI/CD Android APK 构建
- 负责人：AI Agent

## 时间

- 开始时间：2026-11-07 12:24:00 CST
- 最后更新时间：2026-11-07 13:18:00 CST

## 全面走查与优化重点清单

1. **钱包主页与导航降噪 (`WalletHomePage.vue` & `WalletChrome.vue`)**：
   - 彻底消除主页顶部与 `WalletChrome` 紧挨着的重复账号头像/名字/地址双层显示。
   - 聚焦核心资产余额与网络状态，精炼测试网标签与同步状态，在主卡片增加地址一键复制交互反馈。
2. **转账发送页极致精炼 (`SendPage.vue`)**：
   - 移除常驻在表单核心区域占满 3 行的“扫码内容”文本框及“解析扫码内容”按钮，降低视觉噪音。
   - 保留扫码相机、剪贴板粘贴与智能识别，地址输入框直接支持 EIP-681 URI 粘贴或输入时自动解析，恢复清爽高效的转账输入体验。
3. **网络管理中心体系化精简 (`NetworksPage.vue`)**：
   - 彻底移除顶部堆叠的 4 张英文/技术指标卡片（`Active`、`Total Networks`、`Validation: Not Checked`、`RPC`），释放半屏空间。
   - 全面中文化：`Mainnet Networks` -> `正式网络`，`Testnet Networks` -> `测试网络`，`Validation` 状态标签中文化。
4. **交易详情页高端极简重构 (`TransactionDetailPage.vue`)**：
   - 消除散乱且数据重复的 6 张中英文调试卡片（`Hash`、`Status`、`Timeline`、`Decoded Action`、`Raw Transaction`、`Fees`）。
   - 重构为现代 Web3 钱包（如 Phantom/Rainbow）标准的交易详情卡：顶部核心金额与状态、核心信息列表、技术细节折叠面板、底部区块浏览器跳转与返回。
5. **常用地址簿页面重构 (`AddressBookPage.vue`)**：
   - 彻底移除顶部 4 张冗余英文指标卡片（`Current Network`、`Network Contacts`、`All Contacts`、`Latest Update`）。
   - 页面标题与分类全面中文化，联系人列表与操作更简洁高效。
6. **添加代币与资产详情体验优化 (`AddTokenPage.vue` & `TokenDetailPage.vue`)**：
   - `AddTokenPage.vue`：输入合法合约地址时自动触发元数据读取（带防抖），免去必须手动点击按钮的繁琐，同时保持按钮兼容。
   - 中文化 Eyebrow 标签，优化视觉层级。
7. **验证结果**：
   - Rust 底层测试：12/12 全部通过（100%）。
   - TypeScript 生产构建：`pnpm build`（vue-tsc 严格类型检查 + Vite 打包）0 报错通过。
   - 单元测试：26 个文件、151 个测试全部通过（100%）。
   - Playwright 端到端测试：10 个用例全部通过（100%）。
   - 全量更新 `docs/screenshots/` 下 22 张高清实际运行截图。

---

## 历史任务记录
- 任务：根据用户反馈对欢迎页、备份页、钱包主页、账号管理页进行 UI 排版深度优化，并实现生物识别完整解锁及 3x3 手势连线多方式解锁（已完成）


## 历史任务记录
5. `[x]` 执行测试并在 22 个核心业务场景下进行截图，保存至 `docs/screenshots/`：
   - `01-welcome-page.png`：欢迎落地页
   - `02-create-wallet.png`：创建钱包表单
   - `03-create-wallet-validation.png`：创建密码校验报错提示
   - `04-backup-phrase-locked.png`：助记词离线备份保护页
   - `05-backup-phrase-revealed.png`：12 助记词药丸卡片与抄写确认
   - `06-wallet-home.png`：钱包资产主页（1.5 ETH 原生币、块高、操作栏）
   - `07-receive-page.png`：收款二维码与地址展示
   - `08-send-page-native.png`：转账发送页与实时 Gas 预估
   - `09-send-confirmation.png`：发送确认摘要卡片
   - `10-add-token.png`：添加自定义代币及元数据自动回填（MUSD 精度 6）
   - `11-wallet-home-with-token.png`：主页资产列表展示自定义代币
   - `12-token-detail-native.png`：原生币 (ETH) 资产详情页
   - `13-token-detail-erc20.png`：ERC20 代币 (MUSD) 资产详情页
   - `14-activity-page.png`：交易活动记录列表与状态胶囊
   - `15-transaction-detail.png`：链上交易确认详情看板
   - `16-networks-page.png`：多链网络管理中心（正式网与测试网分区）
   - `17-add-custom-network.png`：添加自定义 EVM 网络表单
   - `18-accounts-page.png`：多账号管理与 HD 派生
   - `19-address-book.png`：常用收款人地址簿管理
   - `20-settings-page.png`：钱包设置中心
   - `21-lock-unlock-page.png`：安全锁屏与错误密码拦截
   - `22-import-wallet-page.png`：助记词/私钥导入页面
6. `[x]` 编写 `docs/screenshots/README.md` 图文画廊与使用指南，并在 `README.md` 建立索引。
7. `[x]` 执行全量 `pnpm test:e2e`（10/10 passed）与 `pnpm test:unit`（141/141 passed）验收。

## 验证结果

- E2E 测试：`10 passed (51.8s)`
- 单元测试：`24 passed (24), 141 passed (141)`
- 截图产物：`docs/screenshots/` 目录下共 22 张 PNG 截图文件，总大小约 2.3MB。


## 范围

- 涉及文件：
  - `src-tauri/src/lib.rs`
  - `src-tauri/Cargo.toml`
  - `src-tauri/Cargo.lock`
  - `src-tauri/src/wallet.rs`
  - `src/services/uiState.ts`
  - `src/main.ts`
  - `src/pages/settings/NetworksPage.vue`
  - `src/pages/wallet/AddTokenPage.vue`
  - `src/pages/WelcomePage.vue`
  - `src/pages/wallet/WalletHomePage.vue`
  - `src/pages/wallet/TokenDetailPage.vue`
  - `src/services/__tests__/`
  - `tests/e2e/`
  - `README.md`
  - `docs/tauri-vue-wallet-design.md`
  - `buildprogtess.md`
- 涉及验证：
  - `pkg-config --modversion`
  - `pnpm build`
  - `pnpm test:unit`
  - `pnpm test:e2e`
  - `pnpm test:coverage`
  - `cargo fmt --check`
  - `cargo check`
  - `cargo test`
- 不包含：
  - 真实生物识别平台接入
  - 本机 `nvidia-dkms` / 内核升级问题的系统级修复

## 前置条件

- `node_modules` 已存在，可直接运行前端命令
- `serde_json` 和 `rusqlite` 已在 Tauri 侧可用
- 当前机器为 `Ubuntu 24.04.4 LTS`，可使用 `apt-get`
- 当前用户具备可执行 `sudo apt-get` 的权限

## 执行步骤

1. `[x]` 并行审查剩余未完成项，并确认 biometric 从 MVP 移除
2. `[x]` 为 Tauri 侧补充 `ui_state` 表与 `load_ui_state / save_ui_state` command
3. `[x]` 重写 `uiState` 服务为：
   - 预览模式 `localStorage`
   - Tauri 模式 `SQLite + 内存缓存`
   - 首次 Tauri 启动自动迁移旧 localStorage
4. `[x]` 在启动流程里接入 `bootstrapUiState()`
5. `[x]` 收口网络管理、Add Token 校验和近期活动文案
6. `[x]` 补充 `uiState` / `walletBridge` / `evm` 单测与关键 e2e
7. `[x]` 安装 Ubuntu 下 Tauri / WebKitGTK 所需系统开发包
8. `[x]` 修复 `src-tauri/src/wallet.rs` 中被真实编译暴露出的 Rust 类型与 trait 问题
9. `[x]` 运行验证并更新本文件

## 当前状态

- biometric 已从设计文档里的 MVP / P0 / Milestone 必做项移出
- 非敏感运行时状态已在 Tauri 模式下落本地 `SQLite`
  - 全局：自定义网络、当前激活网络
  - 账号作用域：自定义 Token、最近活动、地址簿
- 浏览器预览模式仍保留 `localStorage` fallback，不影响现有预览与测试
- Add Token 页现在保存前必须成功读取 ERC20 `name / symbol / decimals`
- 网络管理页已按 `preset / custom` 分区展示
- 当前 Ubuntu 本机已具备 Tauri Linux 构建所需核心系统库
- `src-tauri` 当前 `cargo check / cargo test` 已通过
- 自动化验证当前为：
  - `10 files / 63 tests`
  - e2e `5 passed`
  - coverage 全局通过

## 问题与风险

- 当前最近活动仍以当前设备持久化的最近活动记录为准，不依赖第三方链上索引服务
- 本机 `apt/dpkg` 仍存在与本项目无关的遗留系统问题：
  - 新内核配置阶段触发 `nvidia-dkms` 构建失败
  - 这会影响后续整机升级或 `apt -f install`，但不影响当前项目所需开发库已安装完成，也不影响当前 `cargo check`

## 处理记录

- 已通过多 agent 并行排查页面层、状态层、bridge、Tauri 命令与测试闭环
- 已新增 Tauri 持久化能力：
  - `ui_state` SQLite 表
  - `load_ui_state`
  - `save_ui_state`
- 已改造 `src/services/uiState.ts`
  - 增加内存缓存
  - 增加 `bootstrapUiState()`
  - 增加 Tauri 模式下的 SQLite 读写
  - 增加旧 `localStorage` -> SQLite 自动迁移
- 已在 `src/main.ts` 里把 `bootstrapUiState()` 提前到 store 初始化前，避免首次启动覆盖旧状态
- 已收口 `AddTokenPage.vue`
  - 当前必须先通过 ERC20 元数据读取
  - 不再允许“只校验地址格式就直接保存”
- 已调整页面与文档文案：
  - biometric 不再作为 MVP
  - 近期活动不再使用“未完成口吻”
  - README 不再描述为“项目骨架”
- 已补充测试：
  - `src/services/__tests__/evm.runtime.spec.ts`
  - `src/services/__tests__/uiState.spec.ts`
  - `src/services/__tests__/walletBridge.spec.ts`
  - `tests/e2e/wallet-flows.spec.ts`
- 已修复 `uiState` 里“空远端状态被误判为有数据”的迁移判断 bug
- 已安装 Linux 桌面开发依赖：
  - `libgtk-3-dev`
  - `libayatana-appindicator3-dev`
  - `librsvg2-dev`
  - `libsoup-3.0-dev`
  - `libjavascriptcoregtk-4.1-dev`
  - `libwebkit2gtk-4.1-dev`
  - 以及其所需 `cairo / pango / gdk-pixbuf / atk / pkg-config` 相关依赖
- 已修复 `src-tauri/src/wallet.rs` 的真实编译问题：
  - 为 Tauri command 错误返回补齐可序列化 `WalletError` 路径
  - 修正 `bip39` 直接 `?` 转换路径
  - 修正 `Zeroizing<[u8; 32]>` 到地址派生函数的参数类型
  - 修正 `k256` 的 `CtOption` / `NonZeroScalar` 用法
  - 修正 `alloy` 交易 envelope 的 `encoded_2718` trait 引入
  - 顺手清理了新暴露的 Rust warning
- 已补充 Rust 依赖声明：
  - `alloy-eips = "=1.6.3"`

## 验证结果

- `pkg-config --modversion gdk-3.0 cairo pango gdk-pixbuf-2.0 atk libsoup-3.0 javascriptcoregtk-4.1` -> 通过
  - `gdk-3.0 3.24.41`
  - `cairo 1.18.0`
  - `pango 1.52.1`
  - `gdk-pixbuf-2.0 2.42.10`
  - `atk 2.52.0`
  - `libsoup-3.0 3.4.4`
  - `javascriptcoregtk-4.1 2.50.4`
- `pnpm build` -> 通过
- `pnpm test:unit` -> `10 passed / 63 passed`
- `pnpm test:e2e` -> `5 passed`
- `pnpm test:coverage` -> 通过
  - lines `80.88%`
  - statements `80.45%`
  - functions `87.83%`
  - branches `68.19%`
- `cargo fmt --check` -> 通过
- `cargo check` -> 通过
- `cargo test` -> 通过
  - `3 passed`

## 产物

- Tauri 数据层：
  - 非敏感 UI 状态 SQLite 持久化
  - 旧 localStorage 自动迁移
- 页面：
  - 预置 / 自定义网络分区
  - ERC20 合约阻断式校验
  - 更新后的近期活动文案
- 自动化测试：
  - `uiState` Tauri / preview / migration 分支
  - `walletBridge` preview / tauri 分支
  - `evm` 余额、Gas、广播、RPC 校验、交易详情
  - 浏览器预览 e2e 的导入、锁定 / 解锁、自定义网络

## 下一步

- 如需继续收口桌面端验证，可补跑完整 Tauri 打包流程
- 如需恢复本机 `apt` 的健康状态，需要单独处理 `nvidia-dkms` 在新内核上的构建失败
- 如后续需要更强历史能力，再决定是否接入链上索引方案或 explorer API
