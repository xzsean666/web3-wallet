use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppOverview {
    app_name: &'static str,
    app_version: &'static str,
    runtime: &'static str,
    security_policy: &'static str,
    storage_strategy: &'static str,
}

#[tauri::command]
fn get_app_overview() -> AppOverview {
    AppOverview {
        app_name: "Web3 Wallet",
        app_version: env!("CARGO_PKG_VERSION"),
        runtime: "Tauri 2 + Vue 3 + TypeScript",
        security_policy: "Sensitive keys stay in Rust/Tauri Core only",
        storage_strategy: "Stronghold for secrets, SQLite for non-sensitive cache",
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![get_app_overview])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
