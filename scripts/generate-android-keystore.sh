#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

DEFAULT_KEYSTORE_PATH="$PROJECT_ROOT/.local/android-upload.keystore"
DEFAULT_KEY_ALIAS="upload"
DEFAULT_VALIDITY_DAYS="10000"
DEFAULT_DNAME="CN=Web3 Wallet, OU=Mobile, O=Web3 Wallet, L=Shanghai, ST=Shanghai, C=CN"

KEYSTORE_PATH="${ANDROID_KEYSTORE_PATH:-$DEFAULT_KEYSTORE_PATH}"
KEY_ALIAS="${ANDROID_KEY_ALIAS:-$DEFAULT_KEY_ALIAS}"
VALIDITY_DAYS="${ANDROID_KEY_VALIDITY_DAYS:-$DEFAULT_VALIDITY_DAYS}"
DNAME="${ANDROID_KEY_DNAME:-$DEFAULT_DNAME}"
STORE_PASSWORD="${ANDROID_KEYSTORE_PASSWORD:-}"
KEY_PASSWORD="${ANDROID_KEY_PASSWORD:-}"
STORE_PASSWORD_FILE="${ANDROID_KEYSTORE_PASSWORD_FILE:-}"
KEY_PASSWORD_FILE="${ANDROID_KEY_PASSWORD_FILE:-}"

usage() {
  cat <<'EOF'
Usage:
  bash scripts/generate-android-keystore.sh [options]

Options:
  --out PATH          Keystore output path
  --alias NAME        Key alias
  --validity DAYS     Certificate validity days
  --dname VALUE       Distinguished name
  --help              Show this help

Environment variables:
  ANDROID_KEYSTORE_PATH
  ANDROID_KEY_ALIAS
  ANDROID_KEY_VALIDITY_DAYS
  ANDROID_KEY_DNAME
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
    --out)
      KEYSTORE_PATH="$2"
      shift 2
      ;;
    --alias)
      KEY_ALIAS="$2"
      shift 2
      ;;
    --validity)
      VALIDITY_DAYS="$2"
      shift 2
      ;;
    --dname)
      DNAME="$2"
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

if ! command -v keytool >/dev/null 2>&1; then
  printf 'keytool not found in PATH\n' >&2
  exit 1
fi

if [[ -e "$KEYSTORE_PATH" ]]; then
  printf 'Refusing to overwrite existing keystore: %s\n' "$KEYSTORE_PATH" >&2
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

if [[ -z "$KEY_PASSWORD" ]]; then
  read -r -s -p "Key password (press Enter to reuse keystore password): " KEY_PASSWORD
  printf '\n'
  if [[ -z "$KEY_PASSWORD" ]]; then
    KEY_PASSWORD="$STORE_PASSWORD"
  fi
fi

mkdir -p "$(dirname "$KEYSTORE_PATH")"

KEYTOOL_STORE_PASS_ENV="WEB3_WALLET_KEYSTORE_PASS_$$"
KEYTOOL_KEY_PASS_ENV="WEB3_WALLET_KEY_PASS_$$"

cleanup_secret_env() {
  unset "$KEYTOOL_STORE_PASS_ENV" "$KEYTOOL_KEY_PASS_ENV"
}

export "$KEYTOOL_STORE_PASS_ENV=$STORE_PASSWORD"
export "$KEYTOOL_KEY_PASS_ENV=$KEY_PASSWORD"
trap cleanup_secret_env EXIT

keytool -genkeypair \
  -v \
  -storetype PKCS12 \
  -keystore "$KEYSTORE_PATH" \
  -alias "$KEY_ALIAS" \
  -keyalg RSA \
  -keysize 2048 \
  -validity "$VALIDITY_DAYS" \
  -storepass:env "$KEYTOOL_STORE_PASS_ENV" \
  -keypass:env "$KEYTOOL_KEY_PASS_ENV" \
  -dname "$DNAME"

unset STORE_PASSWORD KEY_PASSWORD STORE_PASSWORD_FILE KEY_PASSWORD_FILE

printf 'Created keystore: %s\n' "$KEYSTORE_PATH"
printf 'Alias: %s\n' "$KEY_ALIAS"
