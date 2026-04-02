mod wallet;

use serde::Serialize;
use tauri::Manager;

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
        storage_strategy:
            "Stronghold for secrets, SQLite/WebView local storage for non-sensitive state",
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let local_data_dir = app.path().app_local_data_dir()?;
            std::fs::create_dir_all(&local_data_dir)?;
            let salt_path = local_data_dir.join("salt.txt");

            app.manage(wallet::WalletRuntimeState::default());

            app.handle()
                .plugin(tauri_plugin_stronghold::Builder::with_argon2(&salt_path).build())?;

            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_app_overview,
            wallet::cancel_pending_wallet,
            wallet::create_wallet,
            wallet::derive_mnemonic_account,
            wallet::finalize_pending_wallet,
            wallet::get_pending_backup_phrase,
            wallet::import_wallet,
            wallet::load_pending_wallet_draft,
            wallet::load_wallet_profile,
            wallet::load_wallet_session,
            wallet::set_active_wallet,
            wallet::sign_transfer_transaction,
            wallet::unlock_wallet,
            wallet::update_biometric_setting,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
