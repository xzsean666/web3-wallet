#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ANDROID_RES_DIR="$PROJECT_ROOT/src-tauri/gen/android/app/src/main/res"
ICONS_SRC_DIR="$PROJECT_ROOT/src-tauri/icons/android"

if [[ ! -d "$ANDROID_RES_DIR" ]]; then
  echo "Android resource directory not found at $ANDROID_RES_DIR. Skipping icon sync."
  exit 0
fi

if [[ ! -d "$ICONS_SRC_DIR" ]]; then
  echo "Source icons directory not found at $ICONS_SRC_DIR. Skipping icon sync."
  exit 0
fi

echo "Syncing Android launcher icons to $ANDROID_RES_DIR..."

# 1. Copy mipmap directories (standard and adaptive launcher icons)
for dir in "$ICONS_SRC_DIR"/mipmap-*; do
  if [[ -d "$dir" ]]; then
    base_name="$(basename "$dir")"
    target_dir="$ANDROID_RES_DIR/$base_name"
    mkdir -p "$target_dir"
    cp -rf "$dir"/* "$target_dir/"
  fi
done

# 2. Ensure ic_launcher_round.xml exists in mipmap-anydpi-v26
if [[ -f "$ANDROID_RES_DIR/mipmap-anydpi-v26/ic_launcher.xml" && ! -f "$ANDROID_RES_DIR/mipmap-anydpi-v26/ic_launcher_round.xml" ]]; then
  cp -f "$ANDROID_RES_DIR/mipmap-anydpi-v26/ic_launcher.xml" "$ANDROID_RES_DIR/mipmap-anydpi-v26/ic_launcher_round.xml"
fi

# 3. Copy values (ic_launcher_background.xml)
if [[ -d "$ICONS_SRC_DIR/values" ]]; then
  mkdir -p "$ANDROID_RES_DIR/values"
  cp -rf "$ICONS_SRC_DIR/values"/* "$ANDROID_RES_DIR/values/"
fi

# 4. Remove Tauri template default vector foreground/background if present
# (Tauri android init generates drawable-v24/ic_launcher_foreground.xml with the default Tauri robot logo)
if [[ -f "$ANDROID_RES_DIR/drawable-v24/ic_launcher_foreground.xml" ]]; then
  rm -f "$ANDROID_RES_DIR/drawable-v24/ic_launcher_foreground.xml"
fi

if [[ -f "$ANDROID_RES_DIR/drawable/ic_launcher_background.xml" ]]; then
  rm -f "$ANDROID_RES_DIR/drawable/ic_launcher_background.xml"
fi

echo "Successfully synced Android launcher icons."
