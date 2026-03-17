// ─────────────────────────────────────────────────────────────────────────────
// Aahi — Secret Scanner (Rust)
// Fast regex-based secret detection. Complements the Node.js redaction pipeline.
// ─────────────────────────────────────────────────────────────────────────────

use regex::Regex;
use serde::Serialize;

#[derive(Serialize)]
pub struct SecretFinding {
    file: String,
    line: usize,
    secret_type: String,
    snippet: String,
}

#[tauri::command]
pub fn scan_for_secrets(content: String, filename: String) -> Result<Vec<SecretFinding>, String> {
    let patterns: Vec<(&str, Regex)> = vec![
        ("AWS Access Key", Regex::new(r"AKIA[0-9A-Z]{16}").unwrap()),
        ("API Key", Regex::new(r#"(?i)(?:api[_-]?key|apikey)["'\s:=]+["']?([a-zA-Z0-9_\-]{20,})"#).unwrap()),
        ("Private Key", Regex::new(r"-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----").unwrap()),
        ("GitHub Token", Regex::new(r"gh[ps]_[a-zA-Z0-9]{36,}").unwrap()),
        ("JWT", Regex::new(r#"eyJ[a-zA-Z0-9_\-]+\.eyJ[a-zA-Z0-9_\-]+\.[a-zA-Z0-9_\-+/=]+"#).unwrap()),
        ("Connection String", Regex::new(r#"(?:postgres|mysql|mongodb|redis)://[^\s"']+"#).unwrap()),
        ("Generic Secret", Regex::new(r#"(?i)(?:password|secret|token)["'\s:=]+["']?([^\s"']{8,})"#).unwrap()),
    ];

    let mut findings = Vec::new();

    for (line_num, line) in content.lines().enumerate() {
        for (secret_type, pattern) in &patterns {
            if pattern.is_match(line) {
                // Truncate the line for safe display
                let snippet = if line.len() > 80 {
                    format!("{}...", &line[..80])
                } else {
                    line.to_string()
                };

                findings.push(SecretFinding {
                    file: filename.clone(),
                    line: line_num + 1,
                    secret_type: secret_type.to_string(),
                    snippet,
                });
            }
        }
    }

    Ok(findings)
}
