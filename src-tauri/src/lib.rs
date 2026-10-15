use serde::Serialize;
use std::io::Write;
use std::sync::Mutex;
use tauri::{Manager, RunEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

#[derive(Clone, Serialize)]
struct BackendInfo {
    port: u16,
    token: String,
}

#[derive(Default)]
struct Backend {
    info: Mutex<Option<BackendInfo>>,
    child: Mutex<Option<CommandChild>>,
    shutting_down: Mutex<bool>,
    restarts: Mutex<Vec<std::time::Instant>>,
}

#[tauri::command]
fn backend_info(state: tauri::State<Backend>) -> Option<BackendInfo> {
    state.info.lock().unwrap().clone()
}

fn parse_ready(line: &str) -> Option<BackendInfo> {
    let json = line.trim().strip_prefix("HELM_READY ")?;
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    Some(BackendInfo {
        port: v.get("port")?.as_u64()? as u16,
        token: v.get("token")?.as_str()?.to_string(),
    })
}

fn spawn_backend(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
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
        shell.sidecar("helm-agent")?.args(args)
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .activate_ignoring_other_apps(false)
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(Backend::default())
        .invoke_handler(tauri::generate_handler![backend_info])
        .setup(|app| {
            spawn_backend(app.handle())?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Helm");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            *handle.state::<Backend>().shutting_down.lock().unwrap() = true;
            if let Some(child) = handle.state::<Backend>().child.lock().unwrap().take() {
                let _ = child.kill();
            }
        }
    });
}
