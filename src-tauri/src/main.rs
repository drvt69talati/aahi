// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Tauri Shell
// Native desktop shell for the Aahi IDE. Provides OS-level integration:
// keychain, file system, process management, token counting, IPC bridge.
// ─────────────────────────────────────────────────────────────────────────────

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod keychain;
mod fs_watcher;
mod token_counter;
mod indexer;
mod secret_scanner;
mod ipc;

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            keychain::get_secret,
            keychain::set_secret,
            keychain::delete_secret,
            token_counter::count_tokens,
            indexer::index_workspace,
            secret_scanner::scan_for_secrets,
            ipc::start_runtime,
            ipc::stop_runtime,
        ])
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();
            window.set_title("Aahi — AI-native Software Operations Platform").ok();

            // Start file watcher for the workspace
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                fs_watcher::watch_workspace(app_handle);
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Aahi");
}
