# Tauri + Vue 全平台 Web3 钱包设计与初始化方案

更新时间：2026-04-01

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

## 2. 钱包架构原则

- `Vue` 负责页面、路由、交互、状态编排。
- `Rust/Tauri Core` 负责密钥管理、签名、深链、安全存储、系统能力。
- 私钥类数据永不出网、永不进日志、永不进普通数据库、永不进云备份。
- 助记词、seed、私钥不进入 Pinia、不进入浏览器存储、不进入普通 `SQLite`。

## 3. 目录建议

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

## 4. 本地存储与加密

敏感层：

- 助记词、seed、私钥使用 `Tauri Stronghold`。
- 生物识别只做解锁门禁，不替代主密钥体系。

业务层：

- 地址、公钥、链配置、代币缓存、交易缓存使用 `SQLite`。
- 不把敏感密钥材料写入普通数据库。

配置层：

- 主题、语言、界面开关使用 `Store` 或轻量配置文件。

## 5. 平台注意事项

- Desktop 优先用于开发调试。
- Android 重点处理深链、生物识别、后台恢复。
- iOS 初始化与构建只能在 macOS 上完成。
- 桌面更新可用 Tauri Updater，移动端默认走应用商店更新。

## 6. 初始化命令

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

## 7. 参考资料

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

