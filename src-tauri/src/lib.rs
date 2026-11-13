// Desktop runs the agent as a local sidecar; mobile is a remote control for the agent on a paired
// Mac. Each platform module installs its own plugins, state and commands.
mod log;
#[cfg(desktop)]
mod desktop;
#[cfg(desktop)]
mod update;
#[cfg(mobile)]
mod keyboard;
#[cfg(mobile)]
mod pinned_tls;
#[cfg(any(mobile, test))]
mod profiles;
#[cfg(mobile)]
mod remote;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init());

    #[cfg(desktop)]
    let builder = desktop::setup(builder);
    #[cfg(mobile)]
    let builder = remote::setup(builder);

    let app = builder.build(tauri::generate_context!()).unwrap_or_else(|e| {
        log::error("shell", "the app could not be built", serde_json::json!({ "error": e.to_string() }));
        panic!("error while building Kestrel: {e}");
    });

    app.run(|_handle, _event| {
        #[cfg(desktop)]
        desktop::on_event(_handle, &_event);
    });
}
