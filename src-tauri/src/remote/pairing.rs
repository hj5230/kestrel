//! Pairing with a Mac from its QR link, and choosing or forgetting paired Macs.

use super::*;

#[tauri::command]
pub async fn remote_profile<R: Runtime>(app: AppHandle<R>, state: State<'_, Remote>) -> Result<Option<Profile>, String> {
    match current(&app, &state) {
        Ok(c) => Ok(Some(c.profile)),
        Err(e) if e == "not_paired" => Ok(None),
        Err(e) => Err(e),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PairResponse {
    device_id: String,
    token: String,
    server_name: String,
}

pub(super) struct PairLink {
    name: String,
    hosts: Vec<String>,
    port: u16,
    fingerprint: String,
    code: String,
}

pub(super) fn parse_link(link: &str) -> Result<PairLink, String> {
    let url = url::Url::parse(link.trim()).map_err(|_| "invalid_link".to_string())?;
    if url.scheme() != "kestrel" || url.host_str() != Some("pair") {
        return Err("invalid_link".into());
    }
    let q: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
    let get = |k: &str| q.get(k).cloned().filter(|v| !v.is_empty()).ok_or_else(|| "invalid_link".to_string());
    Ok(PairLink {
        name: q.get("n").cloned().unwrap_or_default(),
        hosts: get("h")?.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect(),
        port: get("p")?.parse().map_err(|_| "invalid_link".to_string())?,
        fingerprint: get("fp")?,
        code: get("c")?,
    })
}

#[tauri::command]
pub async fn remote_pair<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, Remote>,
    link: String,
    device_name: String,
) -> Result<Profile, String> {
    let link = parse_link(&link).map_err(|e| {
        crate::log::warn("pairing", "the pairing link is not valid", json!({ "error": e }));
        e
    })?;
    crate::log::info("pairing", "pairing started", json!({ "hosts": link.hosts.len(), "port": link.port }));
    let tls = pinned_tls::client_config(&link.fingerprint)?;
    let client = http_client(&tls)?;
    let found = probe(&client, &link.hosts, link.port).await?;
    let res = client
        .post(format!("{}/pair", base(&found, link.port)))
        .json(&json!({ "code": link.code, "name": device_name }))
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("unreachable: {e}"))?;
    match res.status().as_u16() {
        200 => {}
        410 => {
            crate::log::warn("pairing", "the pairing code expired", Value::Null);
            return Err("pairing_expired".into());
        }
        403 => {
            crate::log::warn("pairing", "the Mac refused the pairing code", Value::Null);
            return Err("pairing_invalid".into());
        }
        s => {
            crate::log::warn("pairing", "pairing failed", json!({ "status": s }));
            return Err(format!("pairing failed (HTTP {s})"));
        }
    }
    let paired: PairResponse = res.json().await.map_err(|e| e.to_string())?;

    disconnect_events(&state);
    let profile = Profile {
        server_name: if paired.server_name.is_empty() { link.name } else { paired.server_name },
        hosts: link.hosts,
        port: link.port,
        fingerprint: link.fingerprint.to_lowercase(),
        device_id: paired.device_id,
        paired_at: SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0),
    };
    keychain_set(&profile.device_id, &paired.token)?;
    // Other Macs stay paired. Only an entry for this same Mac (same certificate) is replaced.
    let replaced = update_store(&app, &state, |s| s.upsert(profile.clone()))?;
    let replaced_before = replaced.is_some();
    if let Some(old) = replaced {
        // Pairing the same Mac again would leave this phone listed twice there, so drop the old pairing on both ends.
        if let Some(old_token) = keychain_get(&old.device_id) {
            unpair_on_mac(&client, &found, old.port, &old_token).await;
        }
        keychain_delete(&old.device_id);
    }
    *state.conn.lock().unwrap() = Some(Conn { profile: profile.clone(), token: paired.token.into(), tls, client });
    *state.host.lock().unwrap() = Some(found);
    crate::log::info("pairing", "paired", json!({ "replacedExisting": replaced_before, "server": profile.server_name }));
    Ok(profile)
}

/// Asks a Mac to drop the device that owns `token` from its list. Best effort: the Mac may be off.
pub(super) async fn unpair_on_mac(client: &reqwest::Client, host: &str, port: u16, token: &str) {
    let _ = client
        .post(format!("{}/rpc", base(host, port)))
        .bearer_auth(token)
        .json(&json!({ "method": "device.unpair", "params": {} }))
        .timeout(Duration::from_secs(3))
        .send()
        .await;
}

/// Every paired Mac and which one is in use.
#[tauri::command]
pub async fn remote_macs<R: Runtime>(app: AppHandle<R>, state: State<'_, Remote>) -> Result<Store, String> {
    snapshot(&app, &state)
}

/// Makes another paired Mac the one the phone drives. No pairing code: its token is already in the Keychain.
#[tauri::command]
pub async fn remote_select<R: Runtime>(app: AppHandle<R>, state: State<'_, Remote>, device_id: String) -> Result<Profile, String> {
    let profile = snapshot(&app, &state)?.find(&device_id).cloned().ok_or_else(|| "not_paired".to_string())?;
    let token = keychain_get(&profile.device_id).ok_or_else(|| "not_paired".to_string())?;
    let conn = build_conn(profile.clone(), token)?;
    disconnect_events(&state);
    update_store(&app, &state, |s| s.select(&device_id))?;
    *state.conn.lock().unwrap() = Some(conn);
    *state.host.lock().unwrap() = None;
    Ok(profile)
}

/// Forgets one Mac (the active one by default) and returns what is left; the active Mac falls back to
/// another paired one, if any.
#[tauri::command]
pub async fn remote_forget<R: Runtime>(app: AppHandle<R>, state: State<'_, Remote>, device_id: Option<String>) -> Result<Store, String> {
    let before = snapshot(&app, &state)?;
    let Some(id) = device_id.or_else(|| before.active.clone()) else { return Ok(before) };
    let Some(profile) = before.find(&id).cloned() else { return Ok(before) };
    let token = keychain_get(&id);

    if before.active.as_deref() == Some(&id) {
        disconnect_events(&state);
        *state.conn.lock().unwrap() = None;
        *state.host.lock().unwrap() = None;
    }
    let after = update_store(&app, &state, |s| {
        s.remove(&id);
        s.clone()
    })?;
    keychain_delete(&id);

    if let Some(token) = token {
        // Best effort, off the critical path: the Mac may be asleep, and forgetting must not wait for it.
        tauri::async_runtime::spawn(async move {
            let Ok(tls) = pinned_tls::client_config(&profile.fingerprint) else { return };
            let Ok(client) = http_client(&tls) else { return };
            if let Ok(host) = probe(&client, &profile.hosts, profile.port).await {
                unpair_on_mac(&client, &host, profile.port, &token).await;
            }
        });
    }
    Ok(after)
}
