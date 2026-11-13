//! Which of a Mac's addresses answers: probing them over pinned TLS, and learning new ones once connected.

use super::*;

pub(super) fn base(host: &str, port: u16) -> String {
    if host.contains(':') {
        format!("https://[{host}]:{port}")
    } else {
        format!("https://{host}:{port}")
    }
}

/// Flattens an error and its causes; reqwest's own message rarely says what actually failed.
pub(super) fn describe(e: &(dyn std::error::Error + 'static)) -> String {
    let mut out = e.to_string();
    let mut cur = e.source();
    while let Some(s) = cur {
        out.push_str(": ");
        out.push_str(&s.to_string());
        cur = s.source();
    }
    out
}

pub(super) fn probe_hosts(hosts: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    // The simulator uses this Mac's loopback, but it cannot resolve Bonjour names such as `grid.local`.
    #[cfg(all(target_os = "ios", target_abi = "sim"))]
    out.push("127.0.0.1".to_string());
    for h in hosts {
        if !out.iter().any(|e| e == h) {
            out.push(h.clone());
        }
    }
    out
}

/// First address that completes a pinned TLS handshake and answers HTTP. Any status counts:
/// /health needs auth, so a 401 still proves this is our Mac. On failure, says why per address.
pub(super) async fn probe(client: &reqwest::Client, hosts: &[String], port: u16) -> Result<String, String> {
    let hosts = probe_hosts(hosts);
    if hosts.is_empty() {
        return Err("unreachable: no addresses".into());
    }
    let attempts = hosts.iter().map(|h| {
        let url = format!("{}/health", base(h, port));
        let host = h.clone();
        let req = client.get(url).timeout(PROBE_TIMEOUT).send();
        async move { req.await.map(|_| host.clone()).map_err(|e| format!("{host}: {}", describe(&e))) }.boxed()
    });
    let t0 = Instant::now();
    match select_ok(attempts).await {
        Ok((host, _)) => {
            crate::log::debug("net", "address answered", json!({ "host": host, "ms": t0.elapsed().as_millis() as u64 }));
            Ok(host)
        }
        Err(last) => {
            crate::log::warn("net", "no address answered", json!({ "tried": hosts.len(), "ms": t0.elapsed().as_millis() as u64, "last": last }));
            Err(format!("unreachable: {last}"))
        }
    }
}

pub(super) async fn host(state: &Remote, conn: &Conn, refresh: bool) -> Result<String, String> {
    if !refresh {
        if let Some(h) = state.host.lock().unwrap().clone() {
            return Ok(h);
        }
    }
    crate::log::info("net", "looking for the Mac's address", json!({ "refresh": refresh, "candidates": conn.profile.hosts.len() }));
    let found = probe(&conn.client, &conn.profile.hosts, conn.profile.port).await;
    *state.host.lock().unwrap() = found.clone().ok();
    found
}


/// The addresses in the QR code are a snapshot from pairing time. Once connected, ask the Mac where
/// else it can be reached (Tailscale set up later, a new LAN address) and remember it. The Mac's
/// list goes first; earlier addresses stay behind it so a Mac that is briefly off its tailnet does
/// not make the phone forget how to reach it from outside.
pub(super) async fn refresh_hosts<R: Runtime>(app: AppHandle<R>, conn: Conn, host: String) {
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
    crate::log::info("net", "the Mac has new addresses", json!({ "before": conn.profile.hosts.len(), "after": hosts.len() }));
    let state = app.state::<Remote>();
    // The phone may have switched to another Mac while the request was in flight; the update goes to the
    // Mac that answered either way, and the active connection only picks it up if it is still that one.
    let Ok(Some(profile)) = update_store(&app, &state, |s| s.update_hosts(&conn.profile.device_id, hosts)) else { return };
    if let Some(c) = state.conn.lock().unwrap().as_mut() {
        if c.profile.device_id == profile.device_id {
            c.profile.hosts = profile.hosts.clone();
        }
    }
    let _ = app.emit(PROFILE, profile);
}
