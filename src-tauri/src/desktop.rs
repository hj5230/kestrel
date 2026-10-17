use std::io::Write;
use tauri::Manager;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

use crate::{Backend, BackendInfo};

fn parse_ready(line: &str) -> Option<BackendInfo> {
    let json = line.trim().strip_prefix("KESTREL_READY ")?;
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    Some(BackendInfo {
        port: v.get("port")?.as_u64()? as u16,
        token: v.get("token")?.as_str()?.to_string(),
    })
}

pub fn spawn_backend(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let data_dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&data_dir)?;
    let log_dir = app.path().app_log_dir()?;
    std::fs::create_dir_all(&log_dir)?;
    let token = uuid::Uuid::new_v4().simple().to_string();
    let data_arg = data_dir.to_string_lossy().to_string();
    let mut args = vec![
        "--data-dir".to_string(),
        data_arg,
        "--port".to_string(),
        "0".to_string(),
        "--token".to_string(),
        token,
        "--watch-stdin".to_string(),
    ];

    let shell = app.shell();
    let command = if cfg!(debug_assertions) {
        args.push("--dev".to_string());
        let entry = concat!(env!("CARGO_MANIFEST_DIR"), "/../sidecar/main.ts");
        let mut full = vec!["run".to_string(), entry.to_string()];
        full.extend(args);
        shell.command("bun").args(full)
    } else {
        shell.sidecar("kestrel-agent")?.args(args)
    };

    let (mut rx, child) = command.spawn()?;
    *app.state::<Backend>().child.lock().unwrap() = Some(child);

    let handle = app.clone();
    let log_path = log_dir.join("agent.log");
    tauri::async_runtime::spawn(async move {
        let mut log = std::fs::OpenOptions::new().create(true).append(true).open(&log_path).ok();
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let text = String::from_utf8_lossy(&bytes).to_string();
                    for line in text.lines() {
                        if let Some(info) = parse_ready(line) {
                            *handle.state::<Backend>().info.lock().unwrap() = Some(info);
                        } else if let Some(f) = log.as_mut() {
                            let _ = writeln!(f, "{line}");
                        }
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    if let Some(f) = log.as_mut() {
                        let _ = f.write_all(&bytes);
                    }
                }
                CommandEvent::Terminated(status) => {
                    if let Some(f) = log.as_mut() {
                        let _ = writeln!(f, "agent exited: {:?}", status.code);
                    }
                    let state = handle.state::<Backend>();
                    *state.info.lock().unwrap() = None;
                    *state.child.lock().unwrap() = None;
                    if *state.shutting_down.lock().unwrap() {
                        break;
                    }
                    let allowed = {
                        let mut restarts = state.restarts.lock().unwrap();
                        let now = std::time::Instant::now();
                        restarts.retain(|t| now.duration_since(*t).as_secs() < 60);
                        restarts.push(now);
                        restarts.len() <= 5
                    };
                    if allowed {
                        let h = handle.clone();
                        tauri::async_runtime::spawn(async move {
                            std::thread::sleep(std::time::Duration::from_millis(800));
                            if let Err(e) = spawn_backend(&h) {
                                eprintln!("failed to restart agent: {e}");
                            }
                        });
                    }
                    break;
                }
                _ => {}
            }
        }
    });
    Ok(())
}

pub fn shutdown_backend(app: &tauri::AppHandle) {
    let state = app.state::<Backend>();
    *state.shutting_down.lock().unwrap() = true;
    let child = state.child.lock().unwrap().take();
    if let Some(child) = child {
        let _ = child.kill();
    }
}
