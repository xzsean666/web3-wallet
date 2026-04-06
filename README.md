# Web3 Wallet

基于 `Tauri 2 + Vue 3 + TypeScript` 的全平台 Web3 钱包项目。

## 当前状态

- 已完成创建 / 导入 / 备份确认 / 解锁主流程
- 已完成 Native Token / ERC20 余额读取、Tauri 运行时发送、收款和交易详情页
- 已完成预置网络切换、自定义网络管理、手动添加 ERC20 Token
- 已接入 `vue-router`、`pinia`、`Vitest`、`Playwright`
- 非敏感运行时状态在 Tauri 环境下已落本地 `SQLite`

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
pnpm test:e2e
```

## 注意

- 当前 Linux 环境如缺少 `webkit2gtk` / `rsvg2`，Tauri 桌面构建不会直接通过。
- iOS 初始化和构建只能在 macOS 上完成。
- `Playwright` 当前覆盖的是浏览器预览模式下的页面流和路由/表单行为，不直接驱动 Tauri 窗口。
- 真实本地签名与广播仍需在 `pnpm tauri dev` 运行时里验证；仓库内已补对应的服务层和 Rust 单测。
