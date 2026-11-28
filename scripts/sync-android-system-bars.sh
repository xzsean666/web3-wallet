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

    const requiredImports = [
      "import android.os.Bundle",
      "import android.view.View",
      "import androidx.core.view.ViewCompat",
      "import androidx.core.view.WindowCompat",
      "import androidx.core.view.WindowInsetsCompat",
    ];
    for (const imp of requiredImports) {
      if (!next.includes(imp)) {
        next = next.replace(/^(package\s+[^\r\n]+\r?\n)/u, `$1${imp}\n`);
      }
    }

    const insetHelperMarker = "// web3-wallet-system-bar-insets";
    if (!next.includes(insetHelperMarker)) {
      const insetCode = `    ${insetHelperMarker}
    WindowCompat.getInsetsController(window, window.decorView).apply {
      isAppearanceLightStatusBars = false
      isAppearanceLightNavigationBars = false
    }
    findViewById<View>(android.R.id.content)?.let { rootView ->
      ViewCompat.setOnApplyWindowInsetsListener(rootView) { view, windowInsets ->
        val systemBars = windowInsets.getInsets(
          WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout(),
        )
        val ime = windowInsets.getInsets(WindowInsetsCompat.Type.ime())
        val bottomInset = if (ime.bottom > systemBars.bottom) ime.bottom else systemBars.bottom
        view.setPadding(
          systemBars.left,
          systemBars.top,
          systemBars.right,
          bottomInset,
        )
        windowInsets
      }
      ViewCompat.requestApplyInsets(rootView)
    }`;

      if (/super\.onCreate\([^\n]*\)/.test(next)) {
        next = next.replace(
          /(super\.onCreate\([^\n]*\)\n)/u,
          `$1${insetCode}\n`,
        );
      } else if (/class MainActivity\s*:\s*TauriActivity\(\)\s*\{/u.test(next)) {
        next = next.replace(
          /(class MainActivity\s*:\s*TauriActivity\(\)\s*\{)/u,
          `$1\n  override fun onCreate(savedInstanceState: Bundle?) {\n    super.onCreate(savedInstanceState)\n${insetCode}\n  }`,
        );
      } else {
        next = next.replace(
          /(class MainActivity\s*:\s*TauriActivity\(\))/u,
          `$1 {\n  override fun onCreate(savedInstanceState: Bundle?) {\n    super.onCreate(savedInstanceState)\n${insetCode}\n  }\n}`,
        );
      }
    }

    return next;
  });
}

function syncColors(filePath) {
  updateFile(filePath, (source) => {
    const colorLine = '    <color name="wallet_system_bar">#FF090A0F</color>';

    if (source.includes('name="wallet_system_bar"')) {
      return source.replace(
        /<color name="wallet_system_bar">.*?<\/color>/u,
        "<color name=\"wallet_system_bar\">#FF090A0F</color>",
      );
    }

    return source.replace("</resources>", `${colorLine}\n</resources>`);
  });
}

function syncTheme(filePath) {
  updateFile(filePath, (source) => {
    const replacement = `    <style name="Theme.web3_wallet" parent="Theme.MaterialComponents.DayNight.NoActionBar">\n        <item name="android:windowBackground">@color/wallet_system_bar</item>\n        <item name="android:statusBarColor">@color/wallet_system_bar</item>\n        <item name="android:navigationBarColor">@color/wallet_system_bar</item>\n        <item name="android:windowLightStatusBar">false</item>\n        <item name="android:windowLightNavigationBar">false</item>\n    </style>`;

    return source.replace(
      /    <style name="Theme\.web3_wallet" parent="Theme\.MaterialComponents\.DayNight\.NoActionBar">[\s\S]*?    <\/style>/u,
      replacement,
    );
  });
}

function syncManifest(filePath) {
  updateFile(filePath, (source) => {
    let next = source;

    if (!next.includes('android:roundIcon=')) {
      next = next.replace(
        /(android:icon="@mipmap\/ic_launcher")/u,
        '$1\n        android:roundIcon="@mipmap/ic_launcher_round"',
      );
    }

    next = next
      .replace(/\n[^\S\r\n]*<uses-permission android:name="android\.permission\.CAMERA" \/>\n?/gu, "\n")
      .replace(
        /(<uses-permission android:name="android\.permission\.INTERNET" \/>\n)/u,
        '$1    <uses-permission android:name="android.permission.CAMERA" />\n',
      )
      .replace(/\n[^\S\r\n]*<uses-feature android:name="android\.hardware\.camera" android:required="false" \/>\n?/gu, "\n")
      .replace(
        /(<uses-feature android:name="android\.software\.leanback" android:required="false" \/>\n)/u,
        '$1    <uses-feature android:name="android.hardware.camera" android:required="false" />\n',
      )
      .replace(
        /\n[^\S\r\n]*<!-- AndroidTV support -->\s*\n[^\S\r\n]*(<uses-feature android:name="android\.software\.leanback")/u,
        '\n\n    <!-- AndroidTV support -->\n    $1',
      )
      .replace(/\n[^\S\r\n]*<application\b/u, "\n\n    <application");

    return next.replace(/<activity\b[\s\S]*?android:name="\.MainActivity"[\s\S]*?>/u, (activityBlock) => {
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
    });
  });
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

if [[ -f "$SCRIPT_DIR/sync-android-icons.sh" ]]; then
  bash "$SCRIPT_DIR/sync-android-icons.sh"
fi

