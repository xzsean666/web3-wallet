#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Ensure the Android build-tools (zipalign, apksigner) are reachable on PATH.
# These live under $ANDROID_HOME/build-tools/<version>/ and are not always
# exported by the user's shell, so resolve the newest version here.
ensure_build_tools_on_path() {
  if command -v zipalign >/dev/null 2>&1 && command -v apksigner >/dev/null 2>&1; then
    return 0
  fi

  local sdk_root="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
  [[ -n "$sdk_root" && -d "$sdk_root/build-tools" ]] || return 0

  local latest_build_tools
  latest_build_tools="$(find "$sdk_root/build-tools" -mindepth 1 -maxdepth 1 -type d \
    | sort -V | tail -n 1)"

  if [[ -n "$latest_build_tools" && -x "$latest_build_tools/zipalign" ]]; then
    PATH="$latest_build_tools:$PATH"
    export PATH
  fi
}

ensure_build_tools_on_path

DEFAULT_INPUT_APK="$PROJECT_ROOT/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk"

INPUT_APK="${ANDROID_UNSIGNED_APK_PATH:-$DEFAULT_INPUT_APK}"
OUTPUT_APK="${ANDROID_SIGNED_APK_PATH:-}"
KEYSTORE_PATH="${ANDROID_KEYSTORE_PATH:-}"
KEY_ALIAS="${ANDROID_KEY_ALIAS:-}"
STORE_PASSWORD="${ANDROID_KEYSTORE_PASSWORD:-}"
KEY_PASSWORD="${ANDROID_KEY_PASSWORD:-}"
STORE_PASSWORD_FILE="${ANDROID_KEYSTORE_PASSWORD_FILE:-}"
KEY_PASSWORD_FILE="${ANDROID_KEY_PASSWORD_FILE:-}"

usage() {
  cat <<'EOF'
Usage:
  bash scripts/sign-android-apk.sh [options]

Options:
  --in PATH           Input unsigned APK
  --out PATH          Output signed APK
  --ks PATH           Keystore path
  --alias NAME        Key alias
  --help              Show this help

Environment variables:
  ANDROID_UNSIGNED_APK_PATH
  ANDROID_SIGNED_APK_PATH
  ANDROID_KEYSTORE_PATH
  ANDROID_KEY_ALIAS
  ANDROID_KEYSTORE_PASSWORD
  ANDROID_KEY_PASSWORD
  ANDROID_KEYSTORE_PASSWORD_FILE
  ANDROID_KEY_PASSWORD_FILE
EOF
}

read_secret_from_file() {
  local file_path="$1"
  [[ -f "$file_path" ]] || {
    printf 'Secret file not found: %s\n' "$file_path" >&2
    exit 1
  }
  IFS= read -r secret < "$file_path" || true
  printf '%s' "$secret"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --in)
      INPUT_APK="$2"
      shift 2
      ;;
    --out)
      OUTPUT_APK="$2"
      shift 2
      ;;
    --ks)
      KEYSTORE_PATH="$2"
      shift 2
      ;;
    --alias)
      KEY_ALIAS="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if ! command -v zipalign >/dev/null 2>&1; then
  printf 'zipalign not found in PATH\n' >&2
  exit 1
fi

if ! command -v apksigner >/dev/null 2>&1; then
  printf 'apksigner not found in PATH\n' >&2
  exit 1
fi

if [[ ! -f "$INPUT_APK" ]]; then
  printf 'Input APK not found: %s\n' "$INPUT_APK" >&2
  exit 1
fi

if [[ -z "$KEYSTORE_PATH" ]]; then
  printf 'Keystore path is required. Pass --ks or ANDROID_KEYSTORE_PATH.\n' >&2
  exit 1
fi

if [[ ! -f "$KEYSTORE_PATH" ]]; then
  printf 'Keystore not found: %s\n' "$KEYSTORE_PATH" >&2
  exit 1
fi

if [[ -z "$KEY_ALIAS" ]]; then
  printf 'Key alias is required. Pass --alias or ANDROID_KEY_ALIAS.\n' >&2
  exit 1
fi

if [[ -z "$STORE_PASSWORD" ]]; then
  if [[ -n "$STORE_PASSWORD_FILE" ]]; then
    STORE_PASSWORD="$(read_secret_from_file "$STORE_PASSWORD_FILE")"
  fi
fi

if [[ -z "$STORE_PASSWORD" ]]; then
  read -r -s -p "Keystore password: " STORE_PASSWORD
  printf '\n'
fi

if [[ -z "$KEY_PASSWORD" ]]; then
  if [[ -n "$KEY_PASSWORD_FILE" ]]; then
    KEY_PASSWORD="$(read_secret_from_file "$KEY_PASSWORD_FILE")"
  fi
fi

# Default the key password to the keystore password. PKCS12 keystores normally
# use the same secret for both, so we only ever prompt once. Override with
# ANDROID_KEY_PASSWORD / ANDROID_KEY_PASSWORD_FILE if they genuinely differ.
if [[ -z "$KEY_PASSWORD" ]]; then
  KEY_PASSWORD="$STORE_PASSWORD"
fi

if [[ -z "$OUTPUT_APK" ]]; then
  if [[ "$INPUT_APK" == *-unsigned.apk ]]; then
    OUTPUT_APK="${INPUT_APK%-unsigned.apk}-signed.apk"
  else
    OUTPUT_APK="${INPUT_APK%.apk}-signed.apk"
  fi
fi

if [[ "$INPUT_APK" == "$OUTPUT_APK" ]]; then
  printf 'Output APK must be different from input APK\n' >&2
  exit 1
fi

mkdir -p "$(dirname "$OUTPUT_APK")"

TMP_ALIGNED_APK="$(mktemp "${OUTPUT_APK%.apk}.aligned.XXXXXX.apk")"

APKSIGNER_KS_PASS_ENV="WEB3_WALLET_APKSIGNER_KS_PASS_$$"
APKSIGNER_KEY_PASS_ENV="WEB3_WALLET_APKSIGNER_KEY_PASS_$$"

cleanup_secret_env() {
  unset "$APKSIGNER_KS_PASS_ENV" "$APKSIGNER_KEY_PASS_ENV"
}

export "$APKSIGNER_KS_PASS_ENV=$STORE_PASSWORD"
export "$APKSIGNER_KEY_PASS_ENV=$KEY_PASSWORD"
trap 'rm -f "$TMP_ALIGNED_APK"; cleanup_secret_env' EXIT

zipalign -p -f 4 "$INPUT_APK" "$TMP_ALIGNED_APK"

apksigner sign \
  --ks "$KEYSTORE_PATH" \
  --ks-key-alias "$KEY_ALIAS" \
  --ks-pass "env:$APKSIGNER_KS_PASS_ENV" \
  --key-pass "env:$APKSIGNER_KEY_PASS_ENV" \
  --out "$OUTPUT_APK" \
  "$TMP_ALIGNED_APK"

unset STORE_PASSWORD KEY_PASSWORD STORE_PASSWORD_FILE KEY_PASSWORD_FILE

printf 'Signed APK: %s\n' "$OUTPUT_APK"
apksigner verify --print-certs "$OUTPUT_APK"
