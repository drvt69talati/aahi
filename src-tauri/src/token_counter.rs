// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Token Counter (Rust, via tiktoken-rs)
// Performance-critical: called on every keystroke for context budget display.
// ─────────────────────────────────────────────────────────────────────────────

use tiktoken_rs::cl100k_base;

#[tauri::command]
pub fn count_tokens(text: String, _model: Option<String>) -> Result<usize, String> {
    // cl100k_base is the tokenizer for GPT-4, Claude, and most modern models
    let bpe = cl100k_base().map_err(|e| e.to_string())?;
    let tokens = bpe.encode_with_special_tokens(&text);
    Ok(tokens.len())
}
