// Installs an update the sidecar has already downloaded, verified and unpacked. The running app can't
// replace its own bundle safely, so a small detached shell waits for this process to exit, swaps the
// bundles (restoring the old one if the swap fails) and opens the app again.
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::Manager;

const SWAP: &str = r#"pid="$1"; app="$2"; new="$3"; old="$app.previous-$$"
while kill -0 "$pid" 2>/dev/null; do sleep 0.2; done
if mv "$app" "$old"; then
  if mv "$new" "$app"; then rm -rf "$old"; else mv "$old" "$app"; fi
fi
open "$app""#;

/// The .app this process runs from: …/Kestrel.app/Contents/MacOS/kestrel.
fn running_bundle() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let bundle = exe.ancestors().nth(3).ok_or("not running from an app bundle")?;
    if bundle.extension().and_then(|e| e.to_str()) != Some("app") {
        return Err("not running from an app bundle".into());
    }
    Ok(bundle.to_path_buf())
}

/// Only a bundle the updater staged under the app's own data folder may be swapped in.
fn staged_bundle(app: &tauri::AppHandle, staged: &str) -> Result<PathBuf, String> {
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?.join("updates");
    let path = Path::new(staged).canonicalize().map_err(|_| "the update is no longer there".to_string())?;
    let root = root.canonicalize().map_err(|_| "no update is staged".to_string())?;
    if !path.starts_with(&root) || path.file_name().and_then(|n| n.to_str()) != Some("Kestrel.app") || !path.join("Contents/Info.plist").is_file() {
        return Err("not a staged update".into());
    }
    Ok(path)
}

#[tauri::command]
pub fn install_update(app: tauri::AppHandle, staged: String) -> Result<(), String> {
    let new = staged_bundle(&app, &staged)?;
    let current = running_bundle()?;
    Command::new("/bin/sh")
        .arg("-c")
        .arg(SWAP)
        .arg("kestrel-update")
        .arg(std::process::id().to_string())
        .arg(&current)
        .arg(&new)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        // Its own process group, so it outlives this app.
        .process_group(0)
        .spawn()
        .map_err(|e| e.to_string())?;
    app.exit(0);
    Ok(())
}
