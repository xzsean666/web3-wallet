# Build Progress

## 当前任务

- 状态：`completed`
- 任务：修复设置页手势密码 UI/交互逻辑与安全锁屏布局问题、解决 Chainlist/自定义 RPC 未持久化 Bug、适配 Android 沉浸式系统栏、全面走查全应用人类使用体验与边缘逻辑并补充回归测试
- 负责人：AI Agent

## 时间

- 更新时间：2026-11-28 14:06 CST

## 修复与全面走查重点清单

1. **设置页与安全锁屏重构 (`SettingsPage.vue` & `main.css`)**：
   - 固定状态胶囊（`未设置`/`已设置`）与操作按钮（`设置手势`/`修改手势`、`清除`/`确认清除`、`取消`）为 `white-space: nowrap; flex-shrink: 0;`，彻底杜绝窄屏下文字竖排折行。
   - 将`锁定钱包`按钮完全移出`安全与锁屏`卡片，独立放置在页面底部安全操作区；优化设置页顶部钱包身份卡换行布局，避免名称在移动端被极端截断。
   - 重构手势密码设置流程为明确四步：`1. 验证当前钱包密码（通过 unlockWallet 校验）` -> `2. 绘制新手势（隐藏于验证前）` -> `3. 二次绘制确认` -> `4. 点击“确认保存手势”显式确认生效`；并支持两步二次确认清除手势；默认版本号读取 `package.json`。
2. **Chainlist / 预设网络 RPC 与 UI 状态持久化修复 (`src-tauri/src/wallet.rs`, `src/stores/networks.ts`, `src/services/chainlist.ts`)**：
   - 修复 Rust 后端 `PersistedUiState` 缺失 `networkRpcOverrides`、`UiNetworkConfig` 缺失 `environment`、`WalletScopedUiState` 缺失 `sendDraft` 导致的致命持久化丢失 Bug：此前 Tauri 端 `save_ui_state` 会静默丢弃预设网络的 Chainlist RPC 覆盖并在下次启动覆盖或丢失配置。
   - 在 `src/stores/networks.ts` 中统一标准化默认 RPC 与覆盖 URL（忽略末尾 `/` 差异）并启用 `{ flush: "sync" }` 同步落盘；在 `src/services/chainlist.ts` 中为超过 1.5MB 的全量 Chainlist 目录增加压缩降级缓存策略，适配 Android WebView `localStorage` 容量限制。
3. **Android 系统栏与全页体验走查修复**：
   - `scripts/sync-android-system-bars.sh`：更新系统栏底色为暗色 `#FF090A0F`（深色底白字），并为 Android 15 Edge-to-Edge 注入 `WindowInsetsCompat`（状态栏/刘海/导航栏/键盘）安全内边距。
   - `NetworksPage.vue`：移除页面挂载即发起的冗余全量请求；弹窗内先展示预置与已缓存节点并在后台提示同步状态，去重末尾 `/` 重复候选，重构卡片换行与固定弹窗底部提交栏，修正推荐一键添加网络为真实非预设链。
   - `AddressBookPage.vue`、`WalletHomePage.vue`、`WalletChrome.vue`、`ReceivePage.vue`、`TransactionDetailPage.vue`：修复联系人操作按钮被挤出屏幕、大额余额溢出、英文 `Unavailable`/`success` 残留、`key-value-row` 键名换行及缺失样式类等问题。
   - `SendPage.vue`、`AddTokenPage.vue`、`BackupPhrasePage.vue`、`UnlockWalletPage.vue`、`session.ts`：切换账号时隔离转账草稿、未设手势时隐藏手势解锁 Tab、失败广播重置手势盘、改换合约地址重置旧代币元数据、移除无意义循环返回链接、删除/重置账号同步清理手势与生物识别本地凭据，全部密码校验取消 `.trim()` 以保持与 Rust Argon2 原文一致。
4. **验证结果**：
   - `bash -n scripts/sync-android-system-bars.sh`：通过。
   - `pnpm test:rust`：15 个测试全部通过（含新增 `persisted_ui_state_preserves_rpc_overrides_environment_and_send_draft` 序列化回归测试）。
   - `pnpm test:unit`：30 个测试文件、170 个测试全部通过（含新增 `settings-page.spec.ts` 与 `persistence-fixes.spec.ts`）。
   - `pnpm build`（`vue-tsc --noEmit && vite build`）：0 错误通过。
   - `pnpm test:e2e`（Playwright）：10 个端到端用例全部通过，并同步刷新 `docs/screenshots/` 下 22 张端到端截图。

---

## 历史任务记录

- 任务：全面走查所有 UI 与业务逻辑（简约、易用深度重构），执行缺陷排查、全量测试验证，准备 Git Commit、Push 并触发 GitHub Actions CI/CD Android APK 构建（已完成：Rust 12/12、unit 26 files/151 tests、e2e 10/10）
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
