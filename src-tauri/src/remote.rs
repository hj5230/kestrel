//! Mobile transport: the phone drives the agent running on a paired Mac.
//!
//! All traffic goes through Rust rather than the WebView because WKWebView cannot pin a
//! self-signed certificate. The frontend sees the same RPC + event-stream contract it uses on
//! desktop; only the carrier differs.

use crate::pinned_tls;
use futures_util::{future::select_ok, FutureExt, SinkExt, StreamExt};
use rustls::ClientConfig;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tokio_tungstenite::tungstenite::{client::IntoClientRequest, protocol::frame::coding::CloseCode, Message};
use tokio_tungstenite::Connector;

const KEYCHAIN_SERVICE: &str = "com.zhaoshangqi.kestrel.remote";
const EVENT: &str = "remote://event";
const STATUS: &str = "remote://status";
const PROFILE: &str = "remote://profile";
const MAX_HOSTS: usize = 8;
const PROBE_TIMEOUT: Duration = Duration::from_secs(4);
const PING_EVERY: Duration = Duration::from_secs(20);
const DEAD_AFTER: Duration = Duration::from_secs(50);

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    server_name: String,
    hosts: Vec<String>,
    port: u16,
    fingerprint: String,
    device_id: String,
    paired_at: u64,
}

#[derive(Clone)]
struct Conn {
    profile: Profile,
    token: Arc<str>,
    tls: Arc<ClientConfig>,
    client: reqwest::Client,
}

#[derive(Default)]
pub struct Remote {
    conn: Mutex<Option<Conn>>,
    /// Last address that answered; re-probed when it stops working.
    host: Mutex<Option<String>>,
    events: Mutex<Option<JoinHandle<()>>>,
}

#[derive(Clone, Serialize)]
struct ConnStatus {
    connected: bool,
    /// WebSocket close code when the server ended the stream (4401 = this device was revoked).
    code: Option<u16>,
}

// ---------- storage ----------

fn profile_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("remote.json"))
}

fn keychain_get(account: &str) -> Option<String> {
    let bytes = security_framework::passwords::get_generic_password(KEYCHAIN_SERVICE, account).ok()?;
    String::from_utf8(bytes).ok()
}

fn keychain_set(account: &str, token: &str) -> Result<(), String> {
    security_framework::passwords::set_generic_password(KEYCHAIN_SERVICE, account, token.as_bytes())
        .map_err(|e| format!("keychain: {e}"))
}

fn keychain_delete(account: &str) {
    let _ = security_framework::passwords::delete_generic_password(KEYCHAIN_SERVICE, account);
}

fn http_client(tls: &Arc<ClientConfig>) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .use_preconfigured_tls((**tls).clone())
        .connect_timeout(Duration::from_secs(5))
        .pool_idle_timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())
}

fn build_conn(profile: Profile, token: String) -> Result<Conn, String> {
    let tls = pinned_tls::client_config(&profile.fingerprint)?;
    let client = http_client(&tls)?;
    Ok(Conn { profile, token: token.into(), tls, client })
}

fn load_conn<R: Runtime>(app: &AppHandle<R>) -> Result<Option<Conn>, String> {
    let path = profile_path(app)?;
    let Ok(text) = std::fs::read_to_string(&path) else { return Ok(None) };
    let profile: Profile = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    match keychain_get(&profile.device_id) {
        Some(token) => build_conn(profile, token).map(Some),
        // Profile without its secret (e.g. restored from a backup to a new phone): unusable.
        None => {
            let _ = std::fs::remove_file(path);
            Ok(None)
        }
    }
}

fn save_profile<R: Runtime>(app: &AppHandle<R>, profile: &Profile) -> Result<(), String> {
    let json = serde_json::to_string_pretty(profile).map_err(|e| e.to_string())?;
    std::fs::write(profile_path(app)?, json).map_err(|e| e.to_string())
}

fn current<R: Runtime>(app: &AppHandle<R>, state: &Remote) -> Result<Conn, String> {
    let mut slot = state.conn.lock().unwrap();
    if slot.is_none() {
        *slot = load_conn(app)?;
    }
    slot.clone().ok_or_else(|| "not_paired".to_string())
}

// ---------- addressing ----------

fn base(host: &str, port: u16) -> String {
    if host.contains(':') {
        format!("https://[{host}]:{port}")
    } else {
        format!("https://{host}:{port}")
    }
}

/// Flattens an error and its causes; reqwest's own message rarely says what actually failed.
fn describe(e: &(dyn std::error::Error + 'static)) -> String {
    let mut out = e.to_string();
    let mut cur = e.source();
    while let Some(s) = cur {
        out.push_str(": ");
        out.push_str(&s.to_string());
        cur = s.source();
    }
    out
}

/// First address that completes a pinned TLS handshake and answers HTTP. Any status counts:
/// /health needs auth, so a 401 still proves this is our Mac. On failure, says why per address.
async fn probe(client: &reqwest::Client, hosts: &[String], port: u16) -> Result<String, String> {
    if hosts.is_empty() {
        return Err("unreachable: no addresses".into());
    }
    let attempts = hosts.iter().map(|h| {
        let url = format!("{}/health", base(h, port));
        let host = h.clone();
        let req = client.get(url).timeout(PROBE_TIMEOUT).send();
        async move { req.await.map(|_| host.clone()).map_err(|e| format!("{host}: {}", describe(&e))) }.boxed()
    });
    select_ok(attempts).await.map(|(host, _)| host).map_err(|last| format!("unreachable: {last}"))
}

async fn host(state: &Remote, conn: &Conn, refresh: bool) -> Result<String, String> {
    if !refresh {
        if let Some(h) = state.host.lock().unwrap().clone() {
            return Ok(h);
        }
    }
    let found = probe(&conn.client, &conn.profile.hosts, conn.profile.port).await;
    *state.host.lock().unwrap() = found.clone().ok();
    found
}

// ---------- commands ----------

#[tauri::command]
async fn remote_profile<R: Runtime>(app: AppHandle<R>, state: State<'_, Remote>) -> Result<Option<Profile>, String> {
    match current(&app, &state) {
        Ok(c) => Ok(Some(c.profile)),
        Err(e) if e == "not_paired" => Ok(None),
        Err(e) => Err(e),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairResponse {
    device_id: String,
    token: String,
    server_name: String,
}

struct PairLink {
    name: String,
    hosts: Vec<String>,
    port: u16,
    fingerprint: String,
    code: String,
}

fn parse_link(link: &str) -> Result<PairLink, String> {
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
async fn remote_pair<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, Remote>,
    link: String,
    device_name: String,
) -> Result<Profile, String> {
    let link = parse_link(&link)?;
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
        410 => return Err("pairing_expired".into()),
        403 => return Err("pairing_invalid".into()),
        s => return Err(format!("pairing failed (HTTP {s})")),
    }
    let paired: PairResponse = res.json().await.map_err(|e| e.to_string())?;

    disconnect_events(&state);
    if let Some(old) = state.conn.lock().unwrap().take() {
        keychain_delete(&old.profile.device_id);
    }
    let profile = Profile {
        server_name: if paired.server_name.is_empty() { link.name } else { paired.server_name },
        hosts: link.hosts,
        port: link.port,
        fingerprint: link.fingerprint.to_lowercase(),
        device_id: paired.device_id,
        paired_at: SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0),
    };
    keychain_set(&profile.device_id, &paired.token)?;
    save_profile(&app, &profile)?;
    *state.conn.lock().unwrap() = Some(Conn { profile: profile.clone(), token: paired.token.into(), tls, client });
    *state.host.lock().unwrap() = Some(found);
    Ok(profile)
}

#[tauri::command]
async fn remote_forget<R: Runtime>(app: AppHandle<R>, state: State<'_, Remote>) -> Result<(), String> {
    disconnect_events(&state);
    if let Ok(conn) = current(&app, &state) {
        // Best effort: let the Mac drop this device from its list too.
        let last_host = state.host.lock().unwrap().clone();
        if let Some(h) = last_host {
            let _ = conn
                .client
                .post(format!("{}/rpc", base(&h, conn.profile.port)))
                .bearer_auth(&*conn.token)
                .json(&json!({ "method": "device.unpair", "params": {} }))
                .timeout(Duration::from_secs(3))
                .send()
                .await;
        }
        keychain_delete(&conn.profile.device_id);
    }
    *state.conn.lock().unwrap() = None;
    *state.host.lock().unwrap() = None;
    let _ = std::fs::remove_file(profile_path(&app)?);
    Ok(())
}

enum RpcFailure {
    /// Nothing reached the server; safe to retry on another address.
    Connect(String),
    Other(String),
}

async fn post_rpc(conn: &Conn, host: &str, method: &str, params: &Value) -> Result<Value, RpcFailure> {
    let res = conn
        .client
        .post(format!("{}/rpc", base(host, conn.profile.port)))
        .bearer_auth(&*conn.token)
        .json(&json!({ "method": method, "params": params }))
        .send()
        .await
        .map_err(|e| if e.is_connect() { RpcFailure::Connect(e.to_string()) } else { RpcFailure::Other(format!("network: {e}")) })?;
    if res.status().as_u16() == 401 {
        return Err(RpcFailure::Other("unauthorized".into()));
    }
    let status = res.status();
    let body: Value = res.json().await.map_err(|_| RpcFailure::Other(format!("HTTP {status}")))?;
    match body.get("error").and_then(|e| e.as_str()) {
        Some(err) => Err(RpcFailure::Other(err.to_string())),
        None => Ok(body.get("result").cloned().unwrap_or(Value::Null)),
    }
}

#[tauri::command]
async fn remote_rpc<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, Remote>,
    method: String,
    params: Value,
) -> Result<Value, String> {
    let conn = current(&app, &state)?;
    let h = host(&state, &conn, false).await?;
    match post_rpc(&conn, &h, &method, &params).await {
        Ok(v) => Ok(v),
        Err(RpcFailure::Connect(_)) => {
            let h = host(&state, &conn, true).await?;
            post_rpc(&conn, &h, &method, &params).await.map_err(|e| match e {
                RpcFailure::Connect(m) | RpcFailure::Other(m) => m,
            })
        }
        Err(RpcFailure::Other(m)) => Err(m),
    }
}

/// The addresses in the QR code are a snapshot from pairing time. Once connected, ask the Mac where
/// else it can be reached (Tailscale set up later, a new LAN address) and remember it. The Mac's
/// list goes first; earlier addresses stay behind it so a Mac that is briefly off its tailnet does
/// not make the phone forget how to reach it from outside.
async fn refresh_hosts<R: Runtime>(app: AppHandle<R>, conn: Conn, host: String) {
    let Ok(v) = post_rpc(&conn, &host, "device.hosts", &json!({})).await else { return };
    let fresh: Vec<String> = v.get("hosts").and_then(|h| h.as_array()).map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
    if fresh.is_empty() {
        return;
    }
    let mut hosts: Vec<String> = Vec::new();
    for h in fresh.iter().chain(conn.profile.hosts.iter()) {
        if !hosts.contains(h) {
            hosts.push(h.clone());
        }
    }
    hosts.truncate(MAX_HOSTS);
    if hosts == conn.profile.hosts {
        return;
    }
    let state = app.state::<Remote>();
    let profile = {
        let mut slot = state.conn.lock().unwrap();
        let Some(c) = slot.as_mut() else { return };
        if c.profile.device_id != conn.profile.device_id {
            return; // re-paired meanwhile
        }
        c.profile.hosts = hosts;
        c.profile.clone()
    };
    if save_profile(&app, &profile).is_ok() {
        let _ = app.emit(PROFILE, profile);
    }
}

fn disconnect_events(state: &Remote) {
    if let Some(task) = state.events.lock().unwrap().take() {
        task.abort();
    }
}

/// Opens the event stream and returns once it is live; the stream then runs until it drops,
/// reported through `remote://status`. Reconnection policy stays in the frontend, shared with desktop.
#[tauri::command]
async fn remote_events_connect<R: Runtime>(app: AppHandle<R>, state: State<'_, Remote>) -> Result<(), String> {
    disconnect_events(&state);
    let conn = current(&app, &state)?;
    let mut h = host(&state, &conn, false).await?;
    let open = |h: String| {
        let conn = conn.clone();
        async move {
            let url = format!("{}/events?token={}", base(&h, conn.profile.port).replacen("https", "wss", 1), conn.token);
            let req = url.into_client_request().map_err(|e| e.to_string())?;
            tokio_tungstenite::connect_async_tls_with_config(req, None, false, Some(Connector::Rustls(conn.tls.clone())))
                .await
                .map(|(ws, _)| ws)
                .map_err(|e| e.to_string())
        }
    };
    let ws = match open(h.clone()).await {
        Ok(ws) => ws,
        Err(_) => {
            h = host(&state, &conn, true).await?;
            open(h.clone()).await?
        }
    };

    let _ = app.emit(STATUS, ConnStatus { connected: true, code: None });
    tauri::async_runtime::spawn(refresh_hosts(app.clone(), conn.clone(), h.clone()));
    let handle = app.clone();
    let task = tauri::async_runtime::spawn(async move {
        let (mut tx, mut rx) = ws.split();
        let mut ping = tokio::time::interval(PING_EVERY);
        let mut last_seen = Instant::now();
        let mut code = None;
        loop {
            tokio::select! {
                msg = rx.next() => match msg {
                    Some(Ok(Message::Text(text))) => {
                        last_seen = Instant::now();
                        let _ = handle.emit(EVENT, text.to_string());
                    }
                    Some(Ok(Message::Close(frame))) => {
                        code = frame.map(|f| u16::from(f.code));
                        break;
                    }
                    Some(Ok(_)) => last_seen = Instant::now(),
                    Some(Err(_)) | None => break,
                },
                _ = ping.tick() => {
                    // iOS silently kills sockets of suspended apps; a missing pong is how we notice.
                    if last_seen.elapsed() > DEAD_AFTER || tx.send(Message::Ping(Vec::new().into())).await.is_err() {
                        break;
                    }
                }
            }
        }
        let _ = tx.send(Message::Close(None)).await;
        let _ = handle.emit(STATUS, ConnStatus { connected: false, code: code.filter(|c| *c != u16::from(CloseCode::Normal)) });
    });
    *state.events.lock().unwrap() = Some(task);
    Ok(())
}

#[tauri::command]
fn remote_events_disconnect(state: State<'_, Remote>) {
    disconnect_events(&state);
}

/// Let the page draw edge to edge. By default the WKWebView's scroll view insets its content by
/// the safe areas, which shrinks the layout viewport (fixed elements stop short of the bottom);
/// the frontend already pads for the notch and home indicator with `env(safe-area-inset-*)`.
fn edge_to_edge<R: Runtime>(app: &tauri::App<R>) {
    let Some(window) = app.get_webview_window("main") else { return };
    let _ = window.with_webview(|webview| unsafe {
        use objc2::msg_send;
        use objc2::runtime::AnyObject;
        const UI_SCROLL_VIEW_CONTENT_INSET_ADJUSTMENT_NEVER: isize = 2;
        let wk = webview.inner() as *mut AnyObject;
        let scroll: *mut AnyObject = msg_send![wk, scrollView];
        let _: () = msg_send![scroll, setContentInsetAdjustmentBehavior: UI_SCROLL_VIEW_CONTENT_INSET_ADJUSTMENT_NEVER];
    });
}

pub fn setup<R: Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder
        .setup(|app| {
            edge_to_edge(app);
            Ok(())
        })
        .plugin(tauri_plugin_barcode_scanner::init())
        .plugin(
            tauri::plugin::Builder::<R>::new("kestrel-platform")
                .js_init_script("window.__KESTREL_PLATFORM__ = 'mobile';".to_string())
                .build(),
        )
        .manage(Remote::default())
        .invoke_handler(tauri::generate_handler![
            remote_profile,
            remote_pair,
            remote_forget,
            remote_rpc,
            remote_events_connect,
            remote_events_disconnect
        ])
}
