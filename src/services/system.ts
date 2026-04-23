import { invoke, isTauri } from "@tauri-apps/api/core";
import type { AppOverview } from "../types/app";

const previewOverview: AppOverview = {
  appName: "Web3 Wallet",
  appVersion: "preview",
  runtime: "Browser preview (no Tauri IPC)",
  securityPolicy:
    "浏览器预览默认禁用真实助记词/私钥流程；真实恢复材料保护、Stronghold 存储和本地签名仅在 Tauri 运行时生效。",
  storageStrategy:
    "预览模式把非敏感演示状态保存在浏览器存储；Tauri 运行时使用 Stronghold 保存敏感材料，并用 SQLite 持久化 UI 状态。",
};

export function getAppOverview() {
  if (!isTauri()) {
    return Promise.resolve(previewOverview);
  }

  return invoke<AppOverview>("get_app_overview");
}
