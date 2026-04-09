#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

ANDROID_SDK_ROOT_VALUE="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"
SHELL_RC_FILE=""
INSTALL_PROJECT_INIT=0
SKIP_APT=0
SKIP_ENV_WRITE=0
CMDLINE_TOOLS_URL="${ANDROID_CMDLINE_TOOLS_URL:-https://dl.google.com/android/repository/commandlinetools-linux-14742923_latest.zip}"
ANDROID_PLATFORM_VERSION="${ANDROID_PLATFORM_VERSION:-}"
ANDROID_BUILD_TOOLS_VERSION="${ANDROID_BUILD_TOOLS_VERSION:-}"
ANDROID_NDK_VERSION_VALUE="${ANDROID_NDK_VERSION:-}"

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  C_RESET=$'\033[0m'
  C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'
  C_RED=$'\033[31m'
  C_BLUE=$'\033[34m'
else
  C_RESET=""
  C_GREEN=""
  C_YELLOW=""
  C_RED=""
  C_BLUE=""
fi

SUDO=()

usage() {
  cat <<EOF
Usage: bash scripts/install-android-build-env.sh [options]

Options:
  --sdk-root PATH       Android SDK install directory. Default: \$HOME/Android/Sdk
  --shell-rc FILE       Shell rc file to update. Default: inferred from current shell
  --init-project        Run pnpm install when needed and pnpm tauri android init --ci
  --skip-apt            Skip apt package installation
  --skip-env-write      Do not write JAVA_HOME / ANDROID_HOME / NDK_HOME to shell rc
  -h, --help            Show this help

Environment overrides:
  ANDROID_CMDLINE_TOOLS_URL
  ANDROID_PLATFORM_VERSION
  ANDROID_BUILD_TOOLS_VERSION
  ANDROID_NDK_VERSION

Examples:
  bash scripts/install-android-build-env.sh
  bash scripts/install-android-build-env.sh --init-project
  bash scripts/install-android-build-env.sh --sdk-root "\$HOME/Android/Sdk"
EOF
}

log_section() {
  printf '\n%s== %s ==%s\n' "$C_BLUE" "$1" "$C_RESET"
}

log_info() {
  printf '  %s\n' "$1"
}

log_ok() {
  printf '%s[OK]%s %s\n' "$C_GREEN" "$C_RESET" "$1"
}

log_warn() {
  printf '%s[WARN]%s %s\n' "$C_YELLOW" "$C_RESET" "$1"
}

die() {
  printf '%s[FAIL]%s %s\n' "$C_RED" "$C_RESET" "$1" >&2
  exit 1
}

run_cmd() {
  printf '%s> %s%s\n' "$C_BLUE" "$*" "$C_RESET"
  "$@"
}

have_cmd() {
  command -v "$1" >/dev/null 2>&1
}

run_in_project() {
  local command_string="$1"
  run_cmd bash -lc "cd \"$PROJECT_ROOT\" && $command_string"
}

detect_shell_rc() {
  local shell_name
  shell_name="${SHELL##*/}"
  case "$shell_name" in
    bash)
      printf '%s\n' "$HOME/.bashrc"
      ;;
    zsh)
      printf '%s\n' "$HOME/.zshrc"
      ;;
    *)
      printf '%s\n' "$HOME/.profile"
      ;;
  esac
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --sdk-root)
        [[ $# -ge 2 ]] || die "--sdk-root requires a path"
        ANDROID_SDK_ROOT_VALUE="$2"
        shift 2
        ;;
      --shell-rc)
        [[ $# -ge 2 ]] || die "--shell-rc requires a file path"
        SHELL_RC_FILE="$2"
        shift 2
        ;;
      --init-project)
        INSTALL_PROJECT_INIT=1
        shift
        ;;
      --skip-apt)
        SKIP_APT=1
        shift
        ;;
      --skip-env-write)
        SKIP_ENV_WRITE=1
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        die "Unknown option: $1"
        ;;
    esac
  done
}

require_supported_os() {
  [[ "$(uname -s)" == "Linux" ]] || die "This installer currently supports Linux only"
  [[ -r /etc/os-release ]] || die "/etc/os-release not found"

  # shellcheck disable=SC1091
  source /etc/os-release

  if [[ "${ID:-}" != "ubuntu" && "${ID:-}" != "debian" && "${ID_LIKE:-}" != *"debian"* ]]; then
    die "This installer currently supports Ubuntu/Debian only"
  fi
}

setup_sudo() {
  if [[ "$(id -u)" -eq 0 ]]; then
    SUDO=()
  elif have_cmd sudo; then
    SUDO=(sudo)
  else
    die "sudo is required to install system packages"
  fi
}

install_apt_packages() {
  if [[ $SKIP_APT -eq 1 ]]; then
    log_warn "Skipping apt package installation"
    return
  fi

  log_section "System Packages"
  run_cmd "${SUDO[@]}" apt-get update
  run_cmd "${SUDO[@]}" apt-get install -y \
    curl \
    git \
    pkg-config \
    unzip \
    zip \
    build-essential \
    libssl-dev \
    openjdk-17-jdk
  log_ok "Base packages installed"
}

ensure_node_and_pnpm() {
  log_section "Node And pnpm"

  have_cmd node || die "node is required; install Node.js LTS first"
  log_ok "node: $(node -v)"

  if have_cmd pnpm; then
    log_ok "pnpm: $(pnpm -v)"
    return
  fi

  if have_cmd corepack; then
    local requested_pnpm
    requested_pnpm="$(sed -n 's/.*"packageManager":[[:space:]]*"pnpm@\([^"]*\)".*/\1/p' "$PROJECT_ROOT/package.json" | sed -n '1p')"
    run_cmd corepack enable
    if [[ -n "$requested_pnpm" ]]; then
      run_cmd corepack prepare "pnpm@$requested_pnpm" --activate
    fi
    have_cmd pnpm || die "pnpm is still unavailable after corepack activation"
    log_ok "pnpm activated via corepack: $(pnpm -v)"
    return
  fi

  die "pnpm is required and corepack is unavailable"
}

ensure_rustup() {
  log_section "Rust"

  if ! have_cmd rustup; then
    run_cmd bash -lc 'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y'
    export PATH="$HOME/.cargo/bin:$PATH"
  fi

  have_cmd rustup || die "rustup installation failed"
  have_cmd cargo || die "cargo not found after rustup installation"
  have_cmd rustc || die "rustc not found after rustup installation"

  run_cmd rustup target add \
    aarch64-linux-android \
    armv7-linux-androideabi \
    i686-linux-android \
    x86_64-linux-android

  log_ok "Rust and Android targets are ready"
}

ensure_java_home_value() {
  if [[ -n "${JAVA_HOME:-}" && -x "${JAVA_HOME}/bin/java" ]]; then
    printf '%s\n' "$JAVA_HOME"
    return 0
  fi

  have_cmd javac || die "javac not found after JDK installation"
  dirname "$(dirname "$(readlink -f "$(command -v javac)")")"
}

bootstrap_android_cmdline_tools() {
  local sdk_root="$1"
  local archive_path tmp_dir backup_path

  if find_sdkmanager "$sdk_root" >/dev/null 2>&1; then
    log_ok "sdkmanager already available"
    return
  fi

  log_section "Android Command-line Tools"
  mkdir -p "$sdk_root/cmdline-tools"

  tmp_dir="$(mktemp -d)"
  archive_path="$tmp_dir/commandlinetools.zip"

  run_cmd curl -fL "$CMDLINE_TOOLS_URL" -o "$archive_path"
  run_cmd unzip -q "$archive_path" -d "$tmp_dir/unpacked"

  if [[ -d "$sdk_root/cmdline-tools/latest" ]]; then
    backup_path="$sdk_root/cmdline-tools/latest.backup.$(date +%s)"
    run_cmd mv "$sdk_root/cmdline-tools/latest" "$backup_path"
    log_warn "Existing cmdline-tools/latest moved to $backup_path"
  fi

  run_cmd mv "$tmp_dir/unpacked/cmdline-tools" "$sdk_root/cmdline-tools/latest"
  rm -rf "$tmp_dir"

  find_sdkmanager "$sdk_root" >/dev/null 2>&1 || die "sdkmanager not found after command-line tools install"
  log_ok "Android command-line tools installed"
}

find_sdkmanager() {
  local sdk_root="$1"
  local candidate

  if have_cmd sdkmanager; then
    command -v sdkmanager
    return 0
  fi

  candidate="$sdk_root/cmdline-tools/latest/bin/sdkmanager"
  if [[ -x "$candidate" ]]; then
    printf '%s\n' "$candidate"
    return 0
  fi

  if [[ -d "$sdk_root/cmdline-tools" ]]; then
    while IFS= read -r candidate; do
      if [[ -x "$candidate" ]]; then
        printf '%s\n' "$candidate"
        return 0
      fi
    done < <(find "$sdk_root/cmdline-tools" -mindepth 2 -maxdepth 3 -type f -name sdkmanager 2>/dev/null | sort)
  fi

  return 1
}

latest_ndk_dir_name() {
  local sdk_root="$1"
  if [[ ! -d "$sdk_root/ndk" ]]; then
    return 1
  fi
  find "$sdk_root/ndk" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sed 's#.*/##' | sort -V | tail -n 1
}

choose_android_package_versions() {
  local sdkmanager_bin="$1"
  local sdk_root="$2"
  local sdk_list normalized_sdk_list package_paths

  sdk_list="$("$sdkmanager_bin" --sdk_root="$sdk_root" --list 2>/dev/null || true)"
  [[ -n "$sdk_list" ]] || die "Failed to query Android SDK package list"
  normalized_sdk_list="$(printf '%s\n' "$sdk_list" | tr -d '\r' | sed 's/^[[:space:]]*//')"
  package_paths="$(
    printf '%s\n' "$normalized_sdk_list" \
      | cut -d'|' -f1 \
      | sed 's/[[:space:]]//g'
  )"

  if [[ -z "$ANDROID_PLATFORM_VERSION" ]]; then
    ANDROID_PLATFORM_VERSION="$(
      printf '%s\n' "$package_paths" \
        | sed -n 's/^platforms;android-//p' \
        | grep -E '^[0-9]+(\.[0-9]+)?$' \
        | sort -V \
        | tail -n 1
    )"
    [[ -n "$ANDROID_PLATFORM_VERSION" ]] || die "Could not determine latest Android platform version"
  fi

  if [[ -z "$ANDROID_BUILD_TOOLS_VERSION" ]]; then
    ANDROID_BUILD_TOOLS_VERSION="$(
      printf '%s\n' "$package_paths" \
        | sed -n 's/^build-tools;//p' \
        | grep -E '^[0-9.]+$' \
        | sort -V \
        | tail -n 1
    )"
    [[ -n "$ANDROID_BUILD_TOOLS_VERSION" ]] || die "Could not determine latest Android build-tools version"
  fi

  if [[ -z "$ANDROID_NDK_VERSION_VALUE" ]]; then
    ANDROID_NDK_VERSION_VALUE="$(
      printf '%s\n' "$package_paths" \
        | sed -n 's/^ndk;//p' \
        | grep -E '^[0-9.]+$' \
        | sort -V \
        | tail -n 1
    )"
    [[ -n "$ANDROID_NDK_VERSION_VALUE" ]] || die "Could not determine latest Android NDK version"
  fi

  log_ok "Android platform: android-$ANDROID_PLATFORM_VERSION"
  log_ok "Android build-tools: $ANDROID_BUILD_TOOLS_VERSION"
  log_ok "Android NDK: $ANDROID_NDK_VERSION_VALUE"
}

install_android_sdk_packages() {
  local sdk_root="$1"
  local sdkmanager_bin pipeline_status

  bootstrap_android_cmdline_tools "$sdk_root"
  sdkmanager_bin="$(find_sdkmanager "$sdk_root")"

  export ANDROID_HOME="$sdk_root"
  export ANDROID_SDK_ROOT="$sdk_root"
  export PATH="$sdk_root/cmdline-tools/latest/bin:$sdk_root/platform-tools:$PATH"

  log_section "Android SDK Packages"
  choose_android_package_versions "$sdkmanager_bin" "$sdk_root"

  set +o pipefail
  yes | "$sdkmanager_bin" --sdk_root="$sdk_root" --licenses >/dev/null
  pipeline_status=$?
  set -o pipefail
  [[ $pipeline_status -eq 0 ]] || die "Failed to accept Android SDK licenses"

  run_cmd "$sdkmanager_bin" --sdk_root="$sdk_root" --install \
    "platform-tools" \
    "platforms;android-$ANDROID_PLATFORM_VERSION" \
    "build-tools;$ANDROID_BUILD_TOOLS_VERSION" \
    "ndk;$ANDROID_NDK_VERSION_VALUE"

  set +o pipefail
  yes | "$sdkmanager_bin" --sdk_root="$sdk_root" --licenses >/dev/null
  pipeline_status=$?
  set -o pipefail
  [[ $pipeline_status -eq 0 ]] || die "Failed to accept Android SDK licenses after installation"

  local ndk_dir_name
  ndk_dir_name="$(latest_ndk_dir_name "$sdk_root")"
  [[ -n "$ndk_dir_name" ]] || die "NDK installation completed but no NDK directory was found"
  export NDK_HOME="$sdk_root/ndk/$ndk_dir_name"

  log_ok "Android SDK packages installed"
}

write_shell_env_block() {
  local shell_rc="$1"
  local java_home_value="$2"
  local sdk_root="$3"
  local tmp_file start_marker end_marker

  start_marker="# >>> web3-wallet android env >>>"
  end_marker="# <<< web3-wallet android env <<<"
  mkdir -p "$(dirname "$shell_rc")"
  touch "$shell_rc"

  tmp_file="$(mktemp)"

  if grep -qF "$start_marker" "$shell_rc"; then
    awk -v start="$start_marker" -v end="$end_marker" '
      $0 == start { skipping = 1; next }
      $0 == end { skipping = 0; next }
      !skipping { print }
    ' "$shell_rc" > "$tmp_file"
  else
    cat "$shell_rc" > "$tmp_file"
  fi

  cat >>"$tmp_file" <<EOF

$start_marker
export JAVA_HOME="$java_home_value"
export ANDROID_HOME="$sdk_root"
export ANDROID_SDK_ROOT="$sdk_root"
case ":\$PATH:" in
  *:"$sdk_root/cmdline-tools/latest/bin":*) ;;
  *) export PATH="$sdk_root/cmdline-tools/latest/bin:\$PATH" ;;
esac
case ":\$PATH:" in
  *:"$sdk_root/platform-tools":*) ;;
  *) export PATH="$sdk_root/platform-tools:\$PATH" ;;
esac
if [ -d "$sdk_root/ndk" ]; then
  export NDK_HOME="$sdk_root/ndk/\$(find "$sdk_root/ndk" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sed 's#.*/##' | sort -V | tail -n 1)"
fi
$end_marker
EOF

  mv "$tmp_file" "$shell_rc"
  log_ok "Environment variables written to $shell_rc"
}

install_project_init() {
  [[ $INSTALL_PROJECT_INIT -eq 1 ]] || return

  log_section "Project Init"

  if [[ ! -d "$PROJECT_ROOT/node_modules" ]]; then
    run_in_project "pnpm install"
  else
    log_ok "node_modules already present"
  fi

  if [[ -d "$PROJECT_ROOT/src-tauri/gen/android" ]]; then
    log_ok "Android project already initialized"
  else
    run_in_project "pnpm tauri android init --ci"
    log_ok "Android project initialized"
  fi
}

run_final_check() {
  log_section "Final Check"
  if [[ -x "$PROJECT_ROOT/scripts/check-android-build-env.sh" || -f "$PROJECT_ROOT/scripts/check-android-build-env.sh" ]]; then
    if bash "$PROJECT_ROOT/scripts/check-android-build-env.sh"; then
      log_ok "Environment check passed"
    else
      log_warn "Environment check reported remaining issues"
    fi
  else
    log_warn "check-android-build-env.sh not found; skipping final check"
  fi
}

main() {
  parse_args "$@"
  require_supported_os
  setup_sudo

  if [[ -z "$SHELL_RC_FILE" ]]; then
    SHELL_RC_FILE="$(detect_shell_rc)"
  fi

  log_section "Install Plan"
  log_info "project_root=$PROJECT_ROOT"
  log_info "android_sdk_root=$ANDROID_SDK_ROOT_VALUE"
  log_info "shell_rc=$SHELL_RC_FILE"
  log_info "init_project=$INSTALL_PROJECT_INIT"

  install_apt_packages
  ensure_node_and_pnpm
  ensure_rustup

  local java_home_value
  java_home_value="$(ensure_java_home_value)"
  export JAVA_HOME="$java_home_value"
  log_ok "JAVA_HOME=$JAVA_HOME"

  install_android_sdk_packages "$ANDROID_SDK_ROOT_VALUE"

  if [[ $SKIP_ENV_WRITE -eq 0 ]]; then
    write_shell_env_block "$SHELL_RC_FILE" "$JAVA_HOME" "$ANDROID_SDK_ROOT_VALUE"
  else
    log_warn "Skipping shell rc update"
  fi

  install_project_init
  run_final_check

  log_section "Done"
  log_info "Restart your terminal or run: source \"$SHELL_RC_FILE\""
  log_info "APK build command: pnpm tauri android build --apk"
}

main "$@"
