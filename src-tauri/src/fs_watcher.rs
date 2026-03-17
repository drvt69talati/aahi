// ─────────────────────────────────────────────────────────────────────────────
// Aahi — File System Watcher
// Watches workspace for changes, emits events to the UI via Tauri events.
// ─────────────────────────────────────────────────────────────────────────────

use notify::{Watcher, RecursiveMode, Event, EventKind};
use std::path::Path;
use tauri::AppHandle;
use tauri::Emitter;

pub fn watch_workspace(app: AppHandle) {
    let (tx, rx) = std::sync::mpsc::channel::<notify::Result<Event>>();

    let mut watcher = match notify::recommended_watcher(tx) {
        Ok(w) => w,
        Err(e) => {
            eprintln!("Failed to create file watcher: {}", e);
            return;
        }
    };

    // Watch current directory — in production, this would be the workspace root
    if let Err(e) = watcher.watch(Path::new("."), RecursiveMode::Recursive) {
        eprintln!("Failed to start watching: {}", e);
        return;
    }

    for result in rx {
        match result {
            Ok(event) => {
                let event_type = match event.kind {
                    EventKind::Create(_) => "create",
                    EventKind::Modify(_) => "modify",
                    EventKind::Remove(_) => "remove",
                    _ => continue,
                };

                let paths: Vec<String> = event.paths
                    .iter()
                    .map(|p| p.to_string_lossy().to_string())
                    .collect();

                let payload = serde_json::json!({
                    "type": event_type,
                    "paths": paths,
                });

                let _ = app.emit("fs-change", payload);
            }
            Err(e) => eprintln!("Watch error: {}", e),
        }
    }
}
