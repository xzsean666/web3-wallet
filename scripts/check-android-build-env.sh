#!/usr/bin/env bash

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

PASS_COUNT=0
WARN_COUNT=0
FAIL_COUNT=0

FAILURES=()
WARNINGS=()

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

section() {
  printf '\n%s== %s ==%s\n' "$C_BLUE" "$1" "$C_RESET"
}

note() {
  printf '  %s\n' "$1"
}

ok() {
  PASS_COUNT=$((PASS_COUNT + 1))
  printf '%s[OK]%s %s\n' "$C_GREEN" "$C_RESET" "$1"
}

warn() {
  WARN_COUNT=$((WARN_COUNT + 1))
  WARNINGS+=("$1")
  printf '%s[WARN]%s %s\n' "$C_YELLOW" "$C_RESET" "$1"
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  FAILURES+=("$1")
  printf '%s[FAIL]%s %s\n' "$C_RED" "$C_RESET" "$1"
}

have_cmd() {
  command -v "$1" >/dev/null 2>&1
}

first_line() {
  "$@" 2>&1 | sed -n '1p'
}

join_by() {
  local delimiter="$1"
  shift
  local first=1
  local item
  for item in "$@"; do
    if [[ $first -eq 1 ]]; then
      printf '%s' "$item"
      first=0
    else
      printf '%s%s' "$delimiter" "$item"
    fi
  done
}

detect_host() {
  local kernel os_label distro_hint
  kernel="$(uname -s 2>/dev/null || printf 'unknown')"
  os_label="$kernel"
  distro_hint=""

  case "$kernel" in
    Linux)
      if [[ -r /etc/os-release ]]; then
        # shellcheck disable=SC1091
        source /etc/os-release
        os_label="${PRETTY_NAME:-Linux}"
        distro_hint="${ID:-linux}"
      else
        distro_hint="linux"
      fi
      ;;
    Darwin)
      os_label="macOS"
      distro_hint="macos"
      ;;
    *)
      distro_hint="unknown"
      ;;
  esac

  printf '%s|%s\n' "$os_label" "$distro_hint"
}

guess_android_sdk_root() {
  local candidates=(
    "${ANDROID_HOME:-}"
    "${ANDROID_SDK_ROOT:-}"
    "$HOME/Android/Sdk"
    "$HOME/Android/sdk"
    "$HOME/Library/Android/sdk"
  )
  local candidate
  for candidate in "${candidates[@]}"; do
    if [[ -n "$candidate" && -d "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

find_android_tool() {
  local tool_name="$1"
  local sdk_root="$2"
  local candidate

  if have_cmd "$tool_name"; then
    command -v "$tool_name"
    return 0
  fi

  if [[ -z "$sdk_root" ]]; then
    return 1
  fi

  case "$tool_name" in
    adb)
      candidate="$sdk_root/platform-tools/adb"
      if [[ -x "$candidate" ]]; then
        printf '%s\n' "$candidate"
        return 0
      fi
      ;;
    sdkmanager)
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
      ;;
  esac

  return 1
}

list_subdirs() {
  local base_dir="$1"
  if [[ ! -d "$base_dir" ]]; then
    return 0
  fi
  find "$base_dir" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sed 's#.*/##' | sort
}

check_required_command() {
  local command_name="$1"
  local label="$2"
  if have_cmd "$command_name"; then
    ok "$label: $(first_line "$command_name" --version)"
  else
    fail "$label not found in PATH"
  fi
}

check_project_state() {
  section "Project"

  if [[ -f "$PROJECT_ROOT/package.json" ]]; then
    ok "package.json found"
  else
    fail "package.json missing"
  fi

  if [[ -d "$PROJECT_ROOT/src-tauri" ]]; then
    ok "src-tauri found"
  else
    fail "src-tauri missing"
  fi

  if [[ -d "$PROJECT_ROOT/node_modules" ]]; then
    ok "node_modules present"
  else
    warn "node_modules missing; run pnpm install"
  fi

  if [[ -d "$PROJECT_ROOT/src-tauri/gen/android" ]]; then
    ok "Android project initialized at src-tauri/gen/android"
  else
    warn "Android project not initialized; run pnpm tauri android init"
  fi
}

check_js_and_tauri() {
  section "Node And Tauri"

  check_required_command "node" "Node.js"
  check_required_command "pnpm" "pnpm"

  if have_cmd pnpm; then
    if (cd "$PROJECT_ROOT" && pnpm exec tauri android -h >/dev/null 2>&1); then
      ok "Tauri CLI Android subcommand is available"
    else
      fail "Tauri CLI Android subcommand unavailable; run pnpm install"
    fi
  fi
}

check_rust() {
  section "Rust"

  check_required_command "rustc" "rustc"
  check_required_command "cargo" "cargo"
  check_required_command "rustup" "rustup"

  if ! have_cmd rustup; then
    return
  fi

  local installed_targets required_targets missing_targets target
  installed_targets="$(rustup target list --installed 2>/dev/null)"
  required_targets=(
    "aarch64-linux-android"
    "armv7-linux-androideabi"
    "i686-linux-android"
    "x86_64-linux-android"
  )
  missing_targets=()

  for target in "${required_targets[@]}"; do
    if printf '%s\n' "$installed_targets" | grep -qx "$target"; then
      ok "Rust target installed: $target"
    else
      fail "Rust target missing: $target"
      missing_targets+=("$target")
    fi
  done

  if [[ ${#missing_targets[@]} -gt 0 ]]; then
    note "Install missing targets with:"
    note "rustup target add $(join_by ' ' "${missing_targets[@]}")"
  fi
}

check_java() {
  section "Java"

  if have_cmd java; then
    ok "java: $(first_line java -version)"
  else
    fail "java not found in PATH"
  fi

  if have_cmd javac; then
    ok "javac: $(first_line javac -version)"
  else
    fail "javac not found in PATH"
  fi

  if [[ -n "${JAVA_HOME:-}" ]]; then
    if [[ -x "$JAVA_HOME/bin/java" ]]; then
      ok "JAVA_HOME=$JAVA_HOME"
    else
      fail "JAVA_HOME is set but does not contain bin/java: $JAVA_HOME"
    fi
  else
    warn "JAVA_HOME is not set"
  fi
}

check_android_sdk() {
  section "Android SDK"

  local sdk_root=""
  local android_home_label="${ANDROID_HOME:-}"
  local android_sdk_root_label="${ANDROID_SDK_ROOT:-}"
  local platform_list build_tools_list ndk_list adb_path sdkmanager_path

  if sdk_root="$(guess_android_sdk_root)"; then
    ok "Android SDK root detected: $sdk_root"
  else
    fail "Android SDK root not found; set ANDROID_HOME or ANDROID_SDK_ROOT"
    return
  fi

  if [[ -n "$android_home_label" ]]; then
    ok "ANDROID_HOME=$android_home_label"
  else
    warn "ANDROID_HOME is not set"
  fi

  if [[ -n "$android_sdk_root_label" ]]; then
    ok "ANDROID_SDK_ROOT=$android_sdk_root_label"
  else
    warn "ANDROID_SDK_ROOT is not set"
  fi

  if [[ -d "$sdk_root/platforms" ]]; then
    platform_list="$(list_subdirs "$sdk_root/platforms" | tr '\n' ' ' | sed 's/[[:space:]]*$//')"
    if [[ -n "$platform_list" ]]; then
      ok "Android platforms installed: $platform_list"
    else
      fail "Android platforms directory is empty"
    fi
  else
    fail "Android platforms directory missing: $sdk_root/platforms"
  fi

  if [[ -d "$sdk_root/build-tools" ]]; then
    build_tools_list="$(list_subdirs "$sdk_root/build-tools" | tr '\n' ' ' | sed 's/[[:space:]]*$//')"
    if [[ -n "$build_tools_list" ]]; then
      ok "Android build-tools installed: $build_tools_list"
    else
      fail "Android build-tools directory is empty"
    fi
  else
    fail "Android build-tools directory missing: $sdk_root/build-tools"
  fi

  if [[ -d "$sdk_root/ndk" ]]; then
    ndk_list="$(list_subdirs "$sdk_root/ndk" | tr '\n' ' ' | sed 's/[[:space:]]*$//')"
    if [[ -n "$ndk_list" ]]; then
      ok "Android NDK installed: $ndk_list"
      if [[ -n "${NDK_HOME:-}" ]]; then
        ok "NDK_HOME=$NDK_HOME"
      else
        warn "NDK_HOME is not set"
      fi
    else
      fail "Android NDK directory is empty"
    fi
  else
    fail "Android NDK missing: $sdk_root/ndk"
  fi

  if adb_path="$(find_android_tool adb "$sdk_root")"; then
    ok "adb found: $adb_path"
  else
    warn "adb not found; install Android SDK Platform-Tools"
  fi

  if sdkmanager_path="$(find_android_tool sdkmanager "$sdk_root")"; then
    ok "sdkmanager found: $sdkmanager_path"
  else
    warn "sdkmanager not found; install Android SDK Command-line Tools"
  fi
}

print_install_hints() {
  section "Install Hints"

  local host_info host_name host_family
  host_info="$(detect_host)"
  host_name="${host_info%%|*}"
  host_family="${host_info##*|}"

  note "Host: $host_name"

  case "$host_family" in
    ubuntu|debian)
      note "Base packages:"
      note "sudo apt update"
      note "sudo apt install -y openjdk-17-jdk unzip zip curl git build-essential pkg-config libssl-dev"
      ;;
    arch)
      note "Base packages:"
      note "sudo pacman -S --needed jdk17-openjdk unzip zip curl git base-devel pkgconf openssl"
      ;;
    fedora)
      note "Base packages:"
      note "sudo dnf install -y java-17-openjdk java-17-openjdk-devel unzip zip curl git @development-tools pkgconf-pkg-config openssl-devel"
      ;;
    macos)
      note "Base packages:"
      note "brew install openjdk@17 rustup-init"
      ;;
    *)
      note "Install a JDK 17+, Android Studio, Android SDK Command-line Tools, Build-Tools, Platforms and NDK."
      ;;
  esac

  note "Rust targets for default Tauri Android builds:"
  note "rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android"

  note "Android SDK env vars example:"
  note "export JAVA_HOME=/path/to/jdk-or-android-studio-jbr"
  note "export ANDROID_HOME=\$HOME/Android/Sdk"
  note "export ANDROID_SDK_ROOT=\$ANDROID_HOME"
  note "export NDK_HOME=\$ANDROID_HOME/ndk/<version>"

  note "Android SDK packages to install from Android Studio SDK Manager:"
  note "Android SDK Platform"
  note "Android SDK Build-Tools"
  note "Android SDK Platform-Tools"
  note "Android SDK Command-line Tools"
  note "NDK (Side by side)"

  note "Project setup commands:"
  note "pnpm install"
  note "pnpm tauri android init"
  note "pnpm tauri android build --apk"
}

print_summary() {
  section "Summary"

  note "passed=$PASS_COUNT warning=$WARN_COUNT failed=$FAIL_COUNT"

  if [[ ${#FAILURES[@]} -gt 0 ]]; then
    note "Blocking items:"
    local item
    for item in "${FAILURES[@]}"; do
      note "- $item"
    done
  fi

  if [[ ${#WARNINGS[@]} -gt 0 ]]; then
    note "Recommended fixes:"
    local item
    for item in "${WARNINGS[@]}"; do
      note "- $item"
    done
  fi
}

main() {
  section "Host"
  note "project_root=$PROJECT_ROOT"
  note "shell=${SHELL:-unknown}"
  note "kernel=$(uname -sr 2>/dev/null || printf 'unknown')"

  check_project_state
  check_js_and_tauri
  check_rust
  check_java
  check_android_sdk
  print_install_hints
  print_summary

  if [[ $FAIL_COUNT -gt 0 ]]; then
    exit 1
  fi
}

main "$@"
