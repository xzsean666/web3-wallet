#!/usr/bin/env node

/**
 * bump-version.js
 * Synchronizes and bumps app versions across:
 * - package.json
 * - src-tauri/tauri.conf.json
 * - src-tauri/Cargo.toml
 *
 * Usage:
 *   node scripts/bump-version.js [--get]
 *   node scripts/bump-version.js [patch|minor|major]
 *   node scripts/bump-version.js custom <version>
 *   node scripts/bump-version.js <version>
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const packageJsonPath = path.join(projectRoot, 'package.json');
const tauriConfPath = path.join(projectRoot, 'src-tauri', 'tauri.conf.json');
const cargoTomlPath = path.join(projectRoot, 'src-tauri', 'Cargo.toml');

function readCurrentVersion() {
  if (fs.existsSync(packageJsonPath)) {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    if (pkg.version) return pkg.version;
  }
  if (fs.existsSync(tauriConfPath)) {
    const conf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
    if (conf.version) return conf.version;
  }
  return '0.1.0';
}

function computeNextVersion(currentVersion, bumpType, customVersion) {
  if (customVersion && customVersion.trim()) {
    return customVersion.trim();
  }

  const type = (bumpType || 'patch').toLowerCase().trim();

  // If type looks like an explicit version string (e.g., "1.2.3")
  if (/^\d+\.\d+/.test(type)) {
    return type;
  }

  const semverMatch = String(currentVersion).trim().match(/^(\d+)\.(\d+)\.(\d+)(.*)$/);
  if (semverMatch) {
    const [, majorStr, minorStr, patchStr, extra] = semverMatch;
    const major = parseInt(majorStr, 10);
    const minor = parseInt(minorStr, 10);
    const patch = parseInt(patchStr, 10);

    switch (type) {
      case 'major':
        return `${major + 1}.0.0`;
      case 'minor':
        return `${major}.${minor + 1}.0`;
      case 'patch':
      default:
        return `${major}.${minor}.${patch + 1}${extra || ''}`;
    }
  }

  // Fallback for non-strict semver versions: bump trailing numeric digits
  const trailingMatch = String(currentVersion).match(/^(.*?)(\d+)$/);
  if (trailingMatch) {
    const [, prefix, suffix] = trailingMatch;
    const nextNum = (BigInt(suffix) + 1n).toString();
    const padded = suffix.startsWith('0') ? nextNum.padStart(suffix.length, '0') : nextNum;
    return `${prefix}${padded}`;
  }

  throw new Error(`Unable to determine next version from current version: ${currentVersion}`);
}

function updateJsonVersion(filePath, newVersion) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(content);
  data.version = newVersion;
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function updateCargoVersion(filePath, newVersion) {
  if (!fs.existsSync(filePath)) return;
  let content = fs.readFileSync(filePath, 'utf8');
  // Match version = "..." inside the [package] table
  const packageRegex = /(\[package\][\s\S]*?\n\s*version\s*=\s*")([^"]+)(")/;
  if (packageRegex.test(content)) {
    content = content.replace(packageRegex, `$1${newVersion}$3`);
    fs.writeFileSync(filePath, content, 'utf8');
  }
}

function main() {
  const args = process.argv.slice(2);
  const currentVersion = readCurrentVersion();

  if (args.includes('--get') || args.includes('-g')) {
    process.stdout.write(currentVersion + '\n');
    return;
  }

  let bumpType = 'patch';
  let customVersion = '';

  if (args[0] === 'custom') {
    bumpType = 'custom';
    customVersion = args[1] || '';
    if (!customVersion) {
      console.error('Error: "custom" requires a version argument, e.g. "custom 1.0.0"');
      process.exit(1);
    }
  } else if (args[0]) {
    bumpType = args[0];
    if (args[1]) {
      customVersion = args[1];
    }
  }

  const nextVersion = computeNextVersion(currentVersion, bumpType, customVersion);

  updateJsonVersion(packageJsonPath, nextVersion);
  updateJsonVersion(tauriConfPath, nextVersion);
  updateCargoVersion(cargoTomlPath, nextVersion);

  // Print next version to stdout for easy shell consumption
  process.stdout.write(nextVersion + '\n');
}

main();
