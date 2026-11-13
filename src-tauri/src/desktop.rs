use serde::Serialize;
use std::sync::Mutex;
use tauri::{Manager, RunEvent, Runtime};
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
    let json = line.trim().strip_prefix("KESTREL_READY ")?;
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    Some(BackendInfo {
        port: v.get("port")?.as_u64()? as u16,
        token: v.get("token")?.as_str()?.to_string(),
    })
}

fn spawn_backend(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let data_dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&data_dir)?;
    // The log was opened in setup(); the sidecar is told where it lives only so a hand-run copy can find its own.
    let log_dir = app.path().app_log_dir()?;
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
        "--log-stdout".to_string(),
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

    let (mut rx, child) = command.spawn().map_err(|e| {
        crate::log::error("shell", "the sidecar could not be started", serde_json::json!({ "error": e.to_string() }));
        e
    })?;
    let pid = child.pid();
    *app.state::<Backend>().child.lock().unwrap() = Some(child);

    let handle = app.clone();
    let _ = log_dir;
    crate::log::info("shell", "sidecar started", serde_json::json!({ "pid": pid }));
    tauri::async_runtime::spawn(async move {
        let started = std::time::Instant::now();
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let text = String::from_utf8_lossy(&bytes).to_string();
                    for line in text.lines() {
                        if let Some(info) = parse_ready(line) {
                            *handle.state::<Backend>().info.lock().unwrap() = Some(info);
                            crate::log::info("shell", "sidecar is ready", serde_json::json!({ "port": handle.state::<Backend>().info.lock().unwrap().as_ref().map(|i| i.port), "ms": started.elapsed().as_millis() as u64 }));
                        } else if !crate::log::ingest_sidecar_line(line) {
                            // Anything that is not a record is raw output (a library's print, a runtime message).
                            crate::log::info("sidecar-stdout", line, serde_json::Value::Null);
                        }
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    for line in String::from_utf8_lossy(&bytes).lines().filter(|l| !l.trim().is_empty()) {
                        crate::log::warn("sidecar-stderr", line, serde_json::Value::Null);
                    }
                }
                CommandEvent::Error(e) => crate::log::error("shell", "the sidecar reported an error", serde_json::json!({ "error": e })),
                CommandEvent::Terminated(status) => {
                    let expected = *handle.state::<Backend>().shutting_down.lock().unwrap();
                    let fields = serde_json::json!({ "code": status.code, "signal": status.signal, "uptimeMs": started.elapsed().as_millis() as u64, "expected": expected });
                    if expected {
                        crate::log::info("shell", "sidecar exited", fields);
                    } else {
                        crate::log::error("shell", "sidecar exited unexpectedly", fields);
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
                        crate::log::warn("shell", "restarting the sidecar", serde_json::Value::Null);
                        let h = handle.clone();
                        tauri::async_runtime::spawn(async move {
                            std::thread::sleep(std::time::Duration::from_millis(800));
                            if let Err(e) = spawn_backend(&h) {
                                crate::log::error("shell", "the sidecar could not be restarted", serde_json::json!({ "error": e.to_string() }));
                            }
                        });
                    } else {
                        crate::log::error("shell", "the sidecar keeps crashing; not restarting it", serde_json::Value::Null);
                    }
                    break;
                }
                _ => {}
            }
        }
    });
    Ok(())
}

pub fn setup(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder
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
        .manage(Backend::default())
        .invoke_handler(tauri::generate_handler![
            backend_info,
            crate::update::install_update,
            crate::log::commands::log_write,
            crate::log::commands::log_info,
            crate::log::commands::log_query,
            crate::log::commands::log_set_verbose,
            crate::log::commands::log_export,
            crate::log::commands::log_reveal
        ])
        .setup(|app| {
            crate::log::init(app.path().app_log_dir()?);
            spawn_backend(app.handle())?;
            Ok(())
        })
}

pub fn on_event<R: Runtime>(app: &tauri::AppHandle<R>, event: &RunEvent) {
    if let RunEvent::Exit = event {
        let state = app.state::<Backend>();
        *state.shutting_down.lock().unwrap() = true;
        crate::log::info("shell", "app exiting", serde_json::Value::Null);
        let child = state.child.lock().unwrap().take();
        if let Some(child) = child {
            let _ = child.kill();
        }
    }
}
