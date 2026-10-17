use serde::Serialize;
use std::sync::Mutex;
use tauri::Manager;

#[cfg(desktop)]
mod desktop;

#[derive(Clone, Serialize)]
struct BackendInfo {
    port: u16,
    token: String,
}

#[derive(Default)]
struct Backend {
    info: Mutex<Option<BackendInfo>>,
    #[cfg(desktop)]
    child: Mutex<Option<tauri_plugin_shell::process::CommandChild>>,
    #[cfg(desktop)]
    shutting_down: Mutex<bool>,
    #[cfg(desktop)]
    restarts: Mutex<Vec<std::time::Instant>>,
}

#[tauri::command]
fn backend_info(state: tauri::State<Backend>) -> Option<BackendInfo> {
    state.info.lock().unwrap().clone()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    #[cfg(desktop)]
    let builder = builder
        .activate_ignoring_other_apps(false)
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_shell::init());

    let app = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(Backend::default())
        .invoke_handler(tauri::generate_handler![backend_info])
        .setup(|app| {
            #[cfg(desktop)]
            desktop::spawn_backend(app.handle())?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Kestrel");

    app.run(|_handle, _event| {
        #[cfg(desktop)]
        if let tauri::RunEvent::Exit = _event {
            desktop::shutdown_backend(_handle);
        }
    });
}
