// ─────────────────────────────────────────────────────────────────────────────
// Aahi — IPC Bridge
// Manages the Node.js Intelligence Runtime process.
// Communication via WebSocket between Tauri shell and Node.js runtime.
// ─────────────────────────────────────────────────────────────────────────────

use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::State;

pub struct RuntimeState {
    process: Mutex<Option<Child>>,
}

impl Default for RuntimeState {
    fn default() -> Self {
        Self {
            process: Mutex::new(None),
        }
    }
}

#[tauri::command]
pub fn start_runtime(state: State<RuntimeState>) -> Result<String, String> {
    let mut process_guard = state.process.lock().map_err(|e| e.to_string())?;

    if process_guard.is_some() {
        return Ok("Runtime already running".to_string());
    }

    let child = Command::new("node")
        .arg("runtime/server.ts")
        .env("AAHI_IPC_PORT", "9741")
        .spawn()
        .map_err(|e| format!("Failed to start runtime: {}", e))?;

    *process_guard = Some(child);
    Ok("Runtime started on port 9741".to_string())
}

#[tauri::command]
pub fn stop_runtime(state: State<RuntimeState>) -> Result<String, String> {
    let mut process_guard = state.process.lock().map_err(|e| e.to_string())?;

    if let Some(mut child) = process_guard.take() {
        child.kill().map_err(|e| e.to_string())?;
        Ok("Runtime stopped".to_string())
    } else {
        Ok("Runtime was not running".to_string())
    }
}
