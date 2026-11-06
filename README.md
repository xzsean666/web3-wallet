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
pnpm test
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
项目初始化阶段现在会使用 `pnpm install --frozen-lockfile`，避免在构建机上漂移依赖树。

建议在 CI 或发布机固定下载校验值：

```bash
ANDROID_CMDLINE_TOOLS_SHA256=<expected_sha256> \
ANDROID_CMDLINE_TOOLS_REQUIRE_CHECKSUM=1 \
bash scripts/install-android-build-env.sh
```

如果你希望 rustup 安装脚本也强制校验：

```bash
RUSTUP_INIT_SHA256=<expected_sha256> \
RUSTUP_REQUIRE_CHECKSUM=1 \
bash scripts/install-android-build-env.sh
```

如果你覆盖下载 URL，脚本现在会要求同时提供对应 SHA256；默认只接受 `https://` 且受信任主机，除非显式设置 `ALLOW_UNTRUSTED_DOWNLOAD_HOSTS=1`。

## Android Release 构建与签名

### 1. 本地构建 (通过环境变量注入私钥)

支持直接通过环境变量提供 Base64 编码的私钥证书，无需在宿主机落地私钥文件：

```bash
# 环境变量方式（推荐 CI 或无文件环境）
export ANDROID_KEYSTORE_BASE64="$(base64 -w 0 /path/to/upload.keystore)"
export ANDROID_KEYSTORE_PASSWORD="your-keystore-password"
export ANDROID_KEY_ALIAS="upload" # 可选，默认 upload
export ANDROID_KEY_PASSWORD="your-key-password" # 可选，默认等同于 keystore 密码

./build_apk
```

或者通过文件路径指定私钥：

```bash
export ANDROID_KEYSTORE_PATH="/path/to/upload.keystore"
export ANDROID_KEYSTORE_PASSWORD="your-keystore-password"
./build_apk
```

`./build_apk` 常用选项：
- `--bump [patch|minor|major]`: 升级版本号类型（默认 `patch`，如 `0.1.6` -> `0.1.7`）
- `--version <ver>`: 显式指定版本号（如 `0.2.0`）
- `--no-version-bump`: 保持当前版本不自增
- `--target <target>`: 目标 ABI（默认 `aarch64` 即 arm64，可选 `armv7`、`x86_64`）
- `--universal`: 构建全 ABI 通用包
- `--release-dir <dir>`: 输出目录（默认 `./release`）

版本号变更会自动同步更新 `package.json`、`src-tauri/tauri.conf.json` 以及 `src-tauri/Cargo.toml`。

### 2. GitHub Actions 手动触发 Release

项目配置了自动化发布工作流 [`.github/workflows/release.yml`](.github/workflows/release.yml)。每次手动触发发布均会自动更新版本号、打 Git Tag、构建 Signed APK 并创建 GitHub Release。

#### 前置配置 (GitHub Repository Secrets)
在 GitHub 仓库 **Settings -> Secrets and variables -> Actions** 中添加以下密钥：
- `ANDROID_KEYSTORE_BASE64`: Release Keystore 文件的 Base64 编码字符串（可在本地执行 `base64 -w 0 android-upload.keystore` 得到）
- `ANDROID_KEYSTORE_PASSWORD`: Keystore 密码
- `ANDROID_KEY_ALIAS`: 密钥别名（可选，默认 `upload`）
- `ANDROID_KEY_PASSWORD`: 密钥密码（可选，默认与 Keystore 密码相同）

#### 手动触发步骤
1. 进入 GitHub 仓库页面的 **Actions** 标签。
2. 在左侧选择 **Release Android APK** 工作流。
3. 点击右侧 **Run workflow** 下拉菜单：
   - **Version bump type**: 选择版本递增类型，默认 `patch`（每次触发自动递增修订版本号，如 `0.1.6` -> `0.1.7`），亦可选 `minor`、`major` 或 `custom`
   - **Custom version**: 当选择 `custom` 时填入指定版本号（如 `1.0.0`）
   - **Android build target**: 选择构建目标（默认 `aarch64`，可选 `universal` 等）
   - **Create draft release / Mark as pre-release**: 可选发布标记
4. 点击绿色 **Run workflow** 按钮启动发布。

发布成功后，GitHub Action 会自动：
1. 递增并同步版本号到 `package.json`、`tauri.conf.json`、`Cargo.toml`
2. 提交版本变更并创建 Git Tag（如 `v0.1.7`）推送到远程仓库
3. 使用 Secret 私钥自动构建并签名 release APK
4. 创建 GitHub Release 并上传生成的 APK 文件及 SHA256 校验和文件，自动根据 commit 日志生成 Release Notes。

如果某次构建不想递增版本号：

```bash
./build_apk --no-version-bump
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

如果你在 CI 中不希望交互输入，可把口令放到权限受限文件（例如 `chmod 600`）并通过环境变量传入：

```bash
ANDROID_KEYSTORE_PATH=.local/android-upload.keystore \
ANDROID_KEY_ALIAS=upload \
ANDROID_KEYSTORE_PASSWORD_FILE=/secure/path/ks.pass \
ANDROID_KEY_PASSWORD_FILE=/secure/path/key.pass \
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
- 自定义 RPC 的“校验通过”只代表节点可连通且 `chainId` / 最新区块响应匹配，不代表该 RPC 本身可信；发送前仍需核对网络费、地址和链环境。
