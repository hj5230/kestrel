//! Mobile transport: the phone drives the agent running on a paired Mac.
//!
//! All traffic goes through Rust rather than the WebView because WKWebView cannot pin a
//! self-signed certificate. The frontend sees the same RPC + event-stream contract it uses on
//! desktop; only the carrier differs.
//!
//! A phone can be paired with several Macs (`profiles::Store`); one is active and every RPC and
//! the event stream go to it. Each Mac keeps its own device token in the Keychain, so switching
//! between them never needs a new pairing code.

use crate::pinned_tls;
use crate::profiles::{Profile, Store};
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

mod address;
mod events;
mod native;
mod pairing;
mod rpc;
mod store;
use address::*;
use events::*;
use native::*;
use pairing::*;
use rpc::*;
use store::*;

const KEYCHAIN_SERVICE: &str = "com.zhaoshangqi.kestrel.remote";
const EVENT: &str = "remote://event";
const STATUS: &str = "remote://status";
const PROFILE: &str = "remote://profile";
const MAX_HOSTS: usize = 8;
const PROBE_TIMEOUT: Duration = Duration::from_secs(4);
/// Opening the event stream: TCP, TLS and the WebSocket upgrade, about four round trips even over a relay.
const OPEN_TIMEOUT: Duration = Duration::from_secs(8);
const PING_EVERY: Duration = Duration::from_secs(20);
const DEAD_AFTER: Duration = Duration::from_secs(50);

#[derive(Clone)]
struct Conn {
    profile: Profile,
    token: Arc<str>,
    tls: Arc<ClientConfig>,
    client: reqwest::Client,
}

#[derive(Default)]
pub struct Remote {
    /// Every paired Mac. `None` until first read from disk. Never held while taking `conn`.
    store: Mutex<Option<Store>>,
    /// Connection to the active Mac, built lazily.
    conn: Mutex<Option<Conn>>,
    /// Last address that answered; re-probed when it stops working.
    host: Mutex<Option<String>>,
    events: Mutex<Option<JoinHandle<()>>>,
    stream_id: Mutex<String>,
}

#[derive(Clone, Serialize)]
struct ConnStatus {
    stream_id: String,
    connected: bool,
    /// WebSocket close code when the server ended the stream (4401 = this device was revoked).
    code: Option<u16>,
}

// ---------- storage ----------

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
            remote_macs,
            remote_select,
            remote_pair,
            remote_forget,
            remote_rpc,
            remote_upload,
            remote_events_connect,
            remote_events_disconnect,
            haptic
        ])
}
