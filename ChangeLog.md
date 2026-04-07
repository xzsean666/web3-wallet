# ChangeLog

## [Unreleased]
- 修复 ERC20 代币转账网络构建失败问题（"合约地址有问题"）：在前端 `src/stores/wallet.ts` 中针对手动添加的代币以及地址簿统一应用 `viem/getAddress`进行 EIP-55 Checksum 校验化，修正了默认预置代币列表中的非规范化地址。
- 重构全局样式表 `src/styles/main.css`：全面采用毛玻璃（Glassmorphism）、深色暗黑模式与炫彩霓虹渐变重绘，将原有桌面视图整体改造为专属移动端样式规范的 APP。
- 更新桌面端容器配置 `src-tauri/tauri.conf.json`：缩小桌面端默认窗口宽高（适配 393x852，iPhone 形态），配合移动化样式的深度改造。
- 修复本地签名转账时 Rust 反序列化报错（`missing field contract_address`）：因为 Serde 枚举标签解析不包含 `Erc20` 内部字段的驼峰映射，已通过在 `TransferAsset` 的 `contract_address` 前显式添加 `#[serde(rename = "contractAddress")]`，修复了前端 `contractAddress` 传参与后端缺失绑定的问题。
- 修复点击“打开区块浏览器”无法在新窗口弹出的问题：将原本的原生 `<a>` 标签跳转更改为利用 `@tauri-apps/plugin-opener` 插件的 `openUrl` 接口调用，从而安全地触发系统默认浏览器打开相关链接。
