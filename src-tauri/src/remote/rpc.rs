//! RPC calls and file uploads to the active Mac, re-probing its address when the last one stops answering.

use super::*;

pub(super) enum RpcFailure {
    /// Nothing reached the server; safe to retry on another address.
    Connect(String),
    Other(String),
}

pub(super) const MAX_UPLOAD: u64 = 100 * 1024 * 1024;

/// The phone picked a file in its own sandbox. Send those bytes to the Mac's /upload, which is the same
/// endpoint the desktop uses; the Mac stores it under the session and returns the attachment record.
pub(super) async fn post_upload(conn: &Conn, host: &str, session_id: &str, file_name: &str, bytes: Vec<u8>) -> Result<Value, RpcFailure> {
    let part = reqwest::multipart::Part::bytes(bytes).file_name(file_name.to_string());
    let form = reqwest::multipart::Form::new().text("sessionId", session_id.to_string()).part("file", part);
    let res = conn
        .client
        .post(format!("{}/upload", base(host, conn.profile.port)))
        .bearer_auth(&*conn.token)
        .multipart(form)
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
        None => Ok(body),
    }
}

#[tauri::command]
pub async fn remote_upload<R: Runtime>(app: AppHandle<R>, state: State<'_, Remote>, session_id: String, path: String) -> Result<Value, String> {
    let path = PathBuf::from(&path);
    let meta = tokio::fs::metadata(&path).await.map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("Selected path is not a file".into());
    }
    if meta.len() > MAX_UPLOAD {
        return Err("File is too large (max 100 MB)".into());
    }
    let bytes = tokio::fs::read(&path).await.map_err(|e| e.to_string())?;
    let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("file").to_string();
    let conn = current(&app, &state)?;
    let send = |host: String| {
        let conn = conn.clone();
        let session_id = session_id.clone();
        let name = name.clone();
        let bytes = bytes.clone();
        async move { post_upload(&conn, &host, &session_id, &name, bytes).await }
    };
    let h = host(&state, &conn, false).await?;
    match send(h).await {
        Ok(v) => Ok(v),
        Err(RpcFailure::Connect(_)) => {
            let h = host(&state, &conn, true).await?;
            send(h).await.map_err(|e| match e {
                RpcFailure::Connect(m) | RpcFailure::Other(m) => m,
            })
        }
        Err(RpcFailure::Other(m)) => Err(m),
    }
}

pub(super) async fn post_rpc(conn: &Conn, host: &str, method: &str, params: &Value) -> Result<Value, RpcFailure> {
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
pub async fn remote_rpc<R: Runtime>(
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
