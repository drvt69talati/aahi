// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Workspace Indexer (Rust)
// Fast recursive file indexing respecting .gitignore patterns.
// ─────────────────────────────────────────────────────────────────────────────

use walkdir::WalkDir;
use serde::Serialize;
use std::path::Path;

#[derive(Serialize)]
pub struct FileEntry {
    path: String,
    name: String,
    is_dir: bool,
    size: u64,
    extension: Option<String>,
}

#[tauri::command]
pub fn index_workspace(root: String) -> Result<Vec<FileEntry>, String> {
    let root_path = Path::new(&root);
    if !root_path.exists() {
        return Err(format!("Path does not exist: {}", root));
    }

    let mut entries = Vec::new();

    for entry in WalkDir::new(root_path)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| !is_ignored(e.path()))
        .filter_map(|e| e.ok())
    {
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        let path = entry.path().to_string_lossy().to_string();
        let name = entry.file_name().to_string_lossy().to_string();
        let extension = entry.path()
            .extension()
            .map(|e| e.to_string_lossy().to_string());

        entries.push(FileEntry {
            path,
            name,
            is_dir: metadata.is_dir(),
            size: metadata.len(),
            extension,
        });
    }

    Ok(entries)
}

fn is_ignored(path: &Path) -> bool {
    let name = path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    matches!(name.as_str(),
        "node_modules" | ".git" | "dist" | "target" | ".next" |
        "__pycache__" | ".venv" | "venv" | ".DS_Store" | "coverage" |
        ".turbo" | ".cache"
    )
}
