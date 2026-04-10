#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ANDROID_ROOT="$PROJECT_ROOT/src-tauri/gen/android"

if [[ ! -d "$ANDROID_ROOT/app/src/main" ]]; then
  printf 'Android project not initialized at %s, skipping system bar sync\n' "$ANDROID_ROOT"
  exit 0
fi

PROJECT_ROOT="$PROJECT_ROOT" ANDROID_ROOT="$ANDROID_ROOT" node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = process.env.PROJECT_ROOT;
const androidRoot = process.env.ANDROID_ROOT;

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const nextPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      const found = walk(nextPath);
      if (found) {
        return found;
      }
      continue;
    }

    if (entry.isFile() && entry.name === "MainActivity.kt") {
      return nextPath;
    }
  }

  return null;
}

function updateFile(filePath, transform) {
  const current = fs.readFileSync(filePath, "utf8");
  const next = transform(current);

  if (next !== current) {
    fs.writeFileSync(filePath, next, "utf8");
  }
}

function syncMainActivity(filePath) {
  updateFile(filePath, (source) => {
    let next = source.replace(/\nimport androidx\.activity\.enableEdgeToEdge\s*/u, "\n");
    next = next.replace(/^\s*enableEdgeToEdge\(\)\s*\n/mu, "");
    return next;
  });
}

function syncColors(filePath) {
  updateFile(filePath, (source) => {
    const colorLine = '    <color name="wallet_system_bar">#FFF5EFE6</color>';

    if (source.includes('name="wallet_system_bar"')) {
      return source.replace(
        /<color name="wallet_system_bar">.*?<\/color>/u,
        "<color name=\"wallet_system_bar\">#FFF5EFE6</color>",
      );
    }

    return source.replace("</resources>", `${colorLine}\n</resources>`);
  });
}

function syncTheme(filePath) {
  updateFile(filePath, (source) => {
    const replacement = `    <style name="Theme.web3_wallet" parent="Theme.MaterialComponents.DayNight.NoActionBar">\n        <item name="android:windowBackground">@color/wallet_system_bar</item>\n        <item name="android:statusBarColor">@color/wallet_system_bar</item>\n        <item name="android:navigationBarColor">@color/wallet_system_bar</item>\n        <item name="android:windowLightStatusBar">true</item>\n        <item name="android:windowLightNavigationBar">true</item>\n    </style>`;

    return source.replace(
      /    <style name="Theme\.web3_wallet" parent="Theme\.MaterialComponents\.DayNight\.NoActionBar">[\s\S]*?    <\/style>/u,
      replacement,
    );
  });
}

function syncManifest(filePath) {
  updateFile(filePath, (source) =>
    source.replace(/<activity\b[\s\S]*?android:name="\.MainActivity"[\s\S]*?>/u, (activityBlock) => {
      if (activityBlock.includes('android:windowSoftInputMode=')) {
        return activityBlock.replace(
          /android:windowSoftInputMode="[^"]*"/u,
          'android:windowSoftInputMode="adjustResize"',
        );
      }

      return activityBlock.replace(
        /android:exported="true"/u,
        'android:exported="true"\n            android:windowSoftInputMode="adjustResize"',
      );
    }),
  );
}

const mainActivityPath = walk(path.join(androidRoot, "app", "src", "main", "java"));
if (!mainActivityPath) {
  throw new Error(`MainActivity.kt not found under ${androidRoot}`);
}

const manifestPath = path.join(androidRoot, "app", "src", "main", "AndroidManifest.xml");
const colorsPath = path.join(androidRoot, "app", "src", "main", "res", "values", "colors.xml");
const themesPath = path.join(androidRoot, "app", "src", "main", "res", "values", "themes.xml");
const nightThemesPath = path.join(androidRoot, "app", "src", "main", "res", "values-night", "themes.xml");

for (const requiredPath of [manifestPath, colorsPath, themesPath, nightThemesPath]) {
  if (!fs.existsSync(requiredPath)) {
    throw new Error(`Required Android resource file not found: ${requiredPath}`);
  }
}

syncMainActivity(mainActivityPath);
syncManifest(manifestPath);
syncColors(colorsPath);
syncTheme(themesPath);
syncTheme(nightThemesPath);

console.log(`Synced Android system bar defaults in ${path.relative(projectRoot, androidRoot)}`);
NODE
