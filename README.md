# Web3 Wallet

基于 `Tauri 2 + Vue 3 + TypeScript` 的全平台 Web3 钱包项目骨架。

## 当前状态

- 已生成 Tauri + Vue 基础模板
- 已接入 `vue-router`、`pinia` 和测试配置
- 文档和 AI 规约单独维护

## 目录

```text
docs/
src/
src-tauri/
Agent.md
buildprogtess.md
```

## 开发命令

```bash
pnpm install
pnpm dev
pnpm tauri dev
pnpm test:unit
```

## 注意

- 当前 Linux 环境如缺少 `webkit2gtk` / `rsvg2`，Tauri 桌面构建不会直接通过。
- iOS 初始化和构建只能在 macOS 上完成。
