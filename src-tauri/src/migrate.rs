//! One-time move from the old bundle identifier's data folder to the current one.
//!
//! The data folder is named after the identifier, so changing it would otherwise start the app with nothing. On the
//! first start under the new identifier the old folder is copied (never moved: it stays as a backup) into a
//! sibling, then renamed into place, so a copy cut short never looks finished. `updates` (staged downloads) is left
//! behind. Run it while the old app is not running, or the database may be copied between two writes.

use serde_json::json;
use std::fs;
use std::path::Path;
use tauri::Manager;

const OLD_IDENTIFIER: &str = "com.zhaoshangqi.kestrel";
const SKIP: [&str; 1] = ["updates"];

fn copy_dir(from: &Path, to: &Path, top: bool) -> std::io::Result<u64> {
    fs::create_dir_all(to)?;
    let mut bytes = 0;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let name = entry.file_name();
        if top && SKIP.iter().any(|s| name == *s) {
            continue;
        }
        let (src, dst) = (entry.path(), to.join(&name));
        let kind = entry.file_type()?;
        if kind.is_symlink() {
            std::os::unix::fs::symlink(fs::read_link(&src)?, &dst)?;
        } else if kind.is_dir() {
            bytes += copy_dir(&src, &dst, false)?;
        } else {
            bytes += fs::copy(&src, &dst)?;
        }
    }
    Ok(bytes)
}

fn is_empty(dir: &Path) -> bool {
    fs::read_dir(dir).map(|mut d| d.next().is_none()).unwrap_or(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copies_everything_but_staged_updates() {
        let root = std::env::temp_dir().join(format!("kestrel-migrate-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let (old, new) = (root.join("old"), root.join("new"));
        fs::create_dir_all(old.join("remote")).unwrap();
        fs::create_dir_all(old.join("updates/0.1.0")).unwrap();
        fs::write(old.join("kestrel.db"), "db").unwrap();
        fs::write(old.join("remote/cert.pem"), "cert").unwrap();
        fs::write(old.join("updates/0.1.0/app"), "big").unwrap();
        let bytes = copy_dir(&old, &new, true).unwrap();
        assert_eq!(bytes, 6);
        assert_eq!(fs::read_to_string(new.join("remote/cert.pem")).unwrap(), "cert");
        assert!(!new.join("updates").exists());
        assert!(old.join("kestrel.db").exists(), "the old folder stays as a backup");
        let _ = fs::remove_dir_all(&root);
    }
}

pub fn run(app: &tauri::AppHandle) {
    let Ok(new) = app.path().app_data_dir() else { return };
    let Some(parent) = new.parent() else { return };
    let old = parent.join(OLD_IDENTIFIER);
    if new == old || !old.is_dir() || !is_empty(&new) {
        return;
    }
    let started = std::time::Instant::now();
    crate::log::info("migrate", "copying the data folder from the old identifier", json!({ "from": old.to_string_lossy(), "to": new.to_string_lossy() }));
    let tmp = parent.join(format!("{}.migrating", new.file_name().map(|n| n.to_string_lossy()).unwrap_or_default()));
    let _ = fs::remove_dir_all(&tmp);
    let result = copy_dir(&old, &tmp, true).and_then(|bytes| {
        let _ = fs::remove_dir(&new);
        fs::rename(&tmp, &new).map(|_| bytes)
    });
    match result {
        Ok(bytes) => crate::log::info("migrate", "data folder copied", json!({ "bytes": bytes, "ms": started.elapsed().as_millis() as u64 })),
        Err(e) => {
            let _ = fs::remove_dir_all(&tmp);
            crate::log::error("migrate", "the data folder could not be copied; starting empty", json!({ "error": e.to_string() }));
        }
    }
}
