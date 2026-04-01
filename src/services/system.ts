import { invoke } from "@tauri-apps/api/core";
import type { AppOverview } from "../types/app";

export function getAppOverview() {
  return invoke<AppOverview>("get_app_overview");
}

