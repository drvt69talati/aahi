// ─────────────────────────────────────────────────────────────────────────────
// Aahi — OS Keychain Integration
// Secrets are NEVER stored in plaintext. Always OS keychain or Vault.
// ─────────────────────────────────────────────────────────────────────────────

use keyring::Entry;

const SERVICE_NAME: &str = "dev.aahi.app";

#[tauri::command]
pub fn get_secret(key: String) -> Result<String, String> {
    let entry = Entry::new(SERVICE_NAME, &key).map_err(|e| e.to_string())?;
    entry.get_password().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_secret(key: String, value: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, &key).map_err(|e| e.to_string())?;
    entry.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_secret(key: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, &key).map_err(|e| e.to_string())?;
    entry.delete_credential().map_err(|e| e.to_string())
}
