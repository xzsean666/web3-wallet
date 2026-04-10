#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

DEFAULT_INPUT_APK="$PROJECT_ROOT/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk"

INPUT_APK="${ANDROID_UNSIGNED_APK_PATH:-$DEFAULT_INPUT_APK}"
OUTPUT_APK="${ANDROID_SIGNED_APK_PATH:-}"
KEYSTORE_PATH="${ANDROID_KEYSTORE_PATH:-}"
KEY_ALIAS="${ANDROID_KEY_ALIAS:-}"
STORE_PASSWORD="${ANDROID_KEYSTORE_PASSWORD:-}"
KEY_PASSWORD="${ANDROID_KEY_PASSWORD:-}"

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
EOF
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
  read -r -s -p "Keystore password: " STORE_PASSWORD
  printf '\n'
fi

if [[ -z "$KEY_PASSWORD" ]]; then
  read -r -s -p "Key password (press Enter to reuse keystore password): " KEY_PASSWORD
  printf '\n'
  if [[ -z "$KEY_PASSWORD" ]]; then
    KEY_PASSWORD="$STORE_PASSWORD"
  fi
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
trap 'rm -f "$TMP_ALIGNED_APK"' EXIT

zipalign -p -f 4 "$INPUT_APK" "$TMP_ALIGNED_APK"

apksigner sign \
  --ks "$KEYSTORE_PATH" \
  --ks-key-alias "$KEY_ALIAS" \
  --ks-pass "pass:$STORE_PASSWORD" \
  --key-pass "pass:$KEY_PASSWORD" \
  --out "$OUTPUT_APK" \
  "$TMP_ALIGNED_APK"

printf 'Signed APK: %s\n' "$OUTPUT_APK"
apksigner verify --print-certs "$OUTPUT_APK"
