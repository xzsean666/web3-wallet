# Web3 Wallet

基于 `Tauri 2 + Vue 3 + TypeScript` 的全平台 Web3 钱包项目。

## 当前状态

- 已完成创建 / 导入 / 备份确认 / 解锁主流程
- 已完成 Native Token / ERC20 余额读取、Tauri 运行时发送、收款和交易详情页
- 已完成预置网络切换、自定义网络管理、手动添加 ERC20 Token
- 接入 `vue-router`、`pinia`、`Vitest`、`Playwright`
- 完成全量移动端 UI/UX Glassmorphism 适配与暗黑炫彩动画重构
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
pnpm android:env
pnpm test:unit
pnpm test:e2e
```

## Android APK 环境检查

```bash
pnpm android:env
```

该脚本会检查 Node.js / pnpm / Tauri CLI、Rust Android targets、Java、Android SDK / NDK、`src-tauri/gen/android` 初始化状态，并输出缺失项的安装建议。

## Android APK 自动安装环境

```bash
pnpm android:install-env
```

可选：

```bash
pnpm android:install-env:init
```

或直接执行脚本：

```bash
bash scripts/install-android-build-env.sh --init-project
```

该脚本目前面向 Ubuntu / Debian，自动安装 OpenJDK 17、Rust Android targets、Android SDK command-line tools、Platform / Build-Tools / NDK，并把 `JAVA_HOME`、`ANDROID_HOME`、`ANDROID_SDK_ROOT`、`NDK_HOME` 写入当前 shell 的 rc 文件。

## Android Release 签名

最省事的方式是直接执行根目录脚本：

```bash
./build_apk
```

或：

```bash
pnpm android:release
```

这个脚本会自动完成：

- 首次无 keystore 时创建 `.local/android-upload.keystore`
- 构建 Android release APK
- 对 `unsigned.apk` 做对齐和签名
- 把最终可安装 APK 放到根目录 `release/`

执行时会让你输入 keystore 密码；首次创建 keystore 和后续签名都复用这一组密码。

默认会生成两个文件：

- `release/web3-wallet-v<version>-android-arm64-release.apk`
- `release/web3-wallet-android-release.apk`

如果你想打全 ABI 通用包：

```bash
./build_apk --universal
```

如果你想改输出目录：

```bash
./build_apk --release-dir /your/output/path
```

下面是拆开的手动流程。

先构建未签名 release APK：

```bash
pnpm tauri android build --apk --target aarch64
```

首次使用先生成 keystore：

```bash
pnpm android:keystore
```

默认会生成到 `.local/android-upload.keystore`，该目录已加入 `.gitignore`。

然后对 `unsigned.apk` 做对齐和签名：

```bash
ANDROID_KEYSTORE_PATH=.local/android-upload.keystore \
ANDROID_KEY_ALIAS=upload \
pnpm android:sign
```

脚本会默认读取：

- `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk`

签名后默认输出：

- `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-signed.apk`

也可以手动指定输入输出：

```bash
bash scripts/sign-android-apk.sh \
  --in src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk \
  --out src-tauri/gen/android/app/build/outputs/apk/universal/release/web3-wallet-release.apk \
  --ks .local/android-upload.keystore \
  --alias upload
```

## 注意

- 当前 Linux 环境如缺少 `webkit2gtk` / `rsvg2`，Tauri 桌面构建不会直接通过。
- iOS 初始化和构建只能在 macOS 上完成。
- `Playwright` 当前覆盖的是浏览器预览模式下的页面流和路由/表单行为，不直接驱动 Tauri 窗口。
- 真实本地签名与广播仍需在 `pnpm tauri dev` 运行时里验证；仓库内已补对应的服务层和 Rust 单测。
