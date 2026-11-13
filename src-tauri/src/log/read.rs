//! Reading the log back for the in-app viewer and for export. Files are read newest first until enough matching
//! records are found, so a large folder never has to be loaded whole.

use super::{files, Level};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;

#[derive(Serialize)]
pub struct FileInfo {
    pub name: String,
    pub size: u64,
    pub modified: u64,
    pub tier: String,
}

#[derive(Serialize)]
pub struct Info {
    pub dir: String,
    pub verbose: bool,
    pub files: Vec<FileInfo>,
    #[serde(rename = "routineDays")]
    pub routine_days: u64,
    #[serde(rename = "importantDays")]
    pub important_days: u64,
}

#[derive(Deserialize)]
pub struct Query {
    pub tier: String,
    #[serde(rename = "minLevel")]
    pub min_level: Option<String>,
    pub module: Option<String>,
    pub src: Option<String>,
    pub search: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Serialize)]
pub struct Page {
    pub records: Vec<Value>,
    pub mods: Vec<String>,
    pub truncated: bool,
}

pub fn list(dir: &Path) -> Vec<FileInfo> {
    let mut out: Vec<FileInfo> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            let (tier, _, _) = files::parse_name(&name)?;
            let meta = e.metadata().ok()?;
            let modified = meta.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_millis() as u64;
            Some(FileInfo { tier: tier.to_string(), name, size: meta.len(), modified })
        })
        .collect();
    out.sort_by(|a, b| b.modified.cmp(&a.modified));
    out
}

pub fn info(dir: &Path) -> Info {
    Info { dir: dir.to_string_lossy().to_string(), verbose: super::verbose(), files: list(dir), routine_days: files::ROUTINE_DAYS, important_days: files::IMPORTANT_DAYS }
}

pub fn query(dir: &Path, q: &Query) -> Page {
    let limit = q.limit.unwrap_or(300).clamp(1, 2000);
    let min = q.min_level.as_deref().and_then(Level::parse).unwrap_or(Level::Debug);
    let needle = q.search.as_deref().map(str::to_lowercase);
    let mut mods = std::collections::BTreeSet::new();
    let mut found: Vec<Value> = Vec::new();
    let mut truncated = false;
    'files: for f in list(dir).into_iter().filter(|f| f.tier == q.tier) {
        let Ok(text) = std::fs::read_to_string(dir.join(&f.name)) else { continue };
        for line in text.lines().rev() {
            let Ok(rec) = serde_json::from_str::<Value>(line) else { continue };
            let level = rec.get("level").and_then(Value::as_str).and_then(Level::parse).unwrap_or(Level::Info);
            let module = rec.get("mod").and_then(Value::as_str).unwrap_or("");
            mods.insert(module.to_string());
            if level < min || q.module.as_deref().is_some_and(|m| m != module) || q.src.as_deref().is_some_and(|s| rec.get("src").and_then(Value::as_str) != Some(s)) {
                continue;
            }
            if needle.as_ref().is_some_and(|n| !line.to_lowercase().contains(n)) {
                continue;
            }
            if found.len() >= limit {
                truncated = true;
                break 'files;
            }
            found.push(rec);
        }
    }
    found.reverse();
    Page { records: found, mods: mods.into_iter().collect(), truncated }
}
