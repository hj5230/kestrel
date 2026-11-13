//! What the front end can ask of the log: write records, read them back, change the verbosity, export, reveal.
//! The same commands serve the desktop window and the phone, each on its own log.

use super::read;
#[cfg(desktop)]
use serde_json::json;
use serde_json::Value;

/// A batch of records from the web view. `src` is fixed by the platform, never taken from the caller.
#[tauri::command]
pub fn log_write(records: Vec<Value>) {
    let src = if cfg!(mobile) { "phone" } else { "ui" };
    for r in records.iter().take(200) {
        super::ingest(r, src);
    }
}

#[tauri::command]
pub fn log_info() -> Result<read::Info, String> {
    super::dir().map(read::info).ok_or_else(|| "logging is not started".to_string())
}

#[tauri::command]
pub fn log_query(query: read::Query) -> Result<read::Page, String> {
    super::dir().map(|d| read::query(d, &query)).ok_or_else(|| "logging is not started".to_string())
}

#[tauri::command]
pub fn log_set_verbose(verbose: bool) {
    super::set_verbose(verbose);
}

/// Zips the log folder into Downloads and shows it in Finder. Desktop only; the phone shares logs from its own screen.
#[cfg(desktop)]
#[tauri::command]
pub fn log_export() -> Result<String, String> {
    let dir = super::dir().ok_or("logging is not started")?;
    let stamp = super::files::now_iso().replace([':', '.'], "-");
    let home = std::env::var("HOME").map_err(|_| "no home folder".to_string())?;
    let out = format!("{home}/Downloads/kestrel-logs-{}.zip", &stamp[..19]);
    let status = std::process::Command::new("/usr/bin/ditto").args(["-c", "-k", "--keepParent"]).arg(dir).arg(&out).status().map_err(|e| e.to_string())?;
    if !status.success() {
        super::error("log", "export failed", json!({ "status": status.code() }));
        return Err("could not create the log archive".into());
    }
    let _ = std::process::Command::new("/usr/bin/open").args(["-R", &out]).status();
    super::info("log", "logs exported", json!({ "size": std::fs::metadata(&out).map(|m| m.len()).unwrap_or(0) }));
    Ok(out)
}

#[cfg(desktop)]
#[tauri::command]
pub fn log_reveal() {
    if let Some(dir) = super::dir() {
        let _ = std::process::Command::new("/usr/bin/open").arg(dir).status();
    }
}
