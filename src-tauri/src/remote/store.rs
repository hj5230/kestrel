//! The paired Macs on disk and each one's device token in the Keychain, and the connection to the active one.

use super::*;

pub(super) fn store_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("remote.json"))
}

pub(super) fn keychain_get(account: &str) -> Option<String> {
    let bytes = security_framework::passwords::get_generic_password(KEYCHAIN_SERVICE, account).ok()?;
    String::from_utf8(bytes).ok()
}

pub(super) fn keychain_set(account: &str, token: &str) -> Result<(), String> {
    security_framework::passwords::set_generic_password(KEYCHAIN_SERVICE, account, token.as_bytes())
        .map_err(|e| format!("keychain: {e}"))
}

pub(super) fn keychain_delete(account: &str) {
    let _ = security_framework::passwords::delete_generic_password(KEYCHAIN_SERVICE, account);
}

pub(super) fn http_client(tls: &Arc<ClientConfig>) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .use_preconfigured_tls((**tls).clone())
        .connect_timeout(Duration::from_secs(5))
        .pool_idle_timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())
}

pub(super) fn build_conn(profile: Profile, token: String) -> Result<Conn, String> {
    let tls = pinned_tls::client_config(&profile.fingerprint)?;
    let client = http_client(&tls)?;
    Ok(Conn { profile, token: token.into(), tls, client })
}

pub(super) fn read_store<R: Runtime>(app: &AppHandle<R>) -> Result<Store, String> {
    let Ok(text) = std::fs::read_to_string(store_path(app)?) else { return Ok(Store::default()) };
    let mut store = Store::parse(&text)?;
    // A profile without its secret (e.g. restored from a backup to a new phone) is unusable.
    store.retain_with_secret(|id| keychain_get(id).is_some());
    Ok(store)
}

pub(super) fn write_store<R: Runtime>(app: &AppHandle<R>, store: &Store) -> Result<(), String> {
    let json = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    std::fs::write(store_path(app)?, json).map_err(|e| e.to_string())
}

pub(super) fn snapshot<R: Runtime>(app: &AppHandle<R>, state: &Remote) -> Result<Store, String> {
    let mut slot = state.store.lock().unwrap();
    if slot.is_none() {
        *slot = Some(read_store(app)?);
    }
    Ok(slot.clone().unwrap())
}

/// Changes the store and persists it, under one lock so concurrent updates cannot interleave.
pub(super) fn update_store<R: Runtime, T>(app: &AppHandle<R>, state: &Remote, change: impl FnOnce(&mut Store) -> T) -> Result<T, String> {
    let mut slot = state.store.lock().unwrap();
    if slot.is_none() {
        *slot = Some(read_store(app)?);
    }
    let store = slot.as_mut().unwrap();
    let out = change(store);
    write_store(app, store)?;
    Ok(out)
}

pub(super) fn load_active<R: Runtime>(app: &AppHandle<R>, state: &Remote) -> Result<Option<Conn>, String> {
    let store = snapshot(app, state)?;
    let Some(profile) = store.active_profile().cloned() else { return Ok(None) };
    let Some(token) = keychain_get(&profile.device_id) else { return Ok(None) };
    build_conn(profile, token).map(Some)
}

pub(super) fn current<R: Runtime>(app: &AppHandle<R>, state: &Remote) -> Result<Conn, String> {
    let mut slot = state.conn.lock().unwrap();
    if slot.is_none() {
        *slot = load_active(app, state)?;
    }
    slot.clone().ok_or_else(|| "not_paired".to_string())
}
