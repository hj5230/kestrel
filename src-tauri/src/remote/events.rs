//! The Mac's event stream over a pinned WebSocket, forwarded to the page as `remote://event`.

use super::*;

pub(super) fn disconnect_events(state: &Remote) {
    state.stream_id.lock().unwrap().clear();
    if let Some(task) = state.events.lock().unwrap().take() {
        task.abort();
    }
}

/// Opens the event stream and returns once it is live; the stream then runs until it drops,
/// reported through `remote://status`. Reconnection policy stays in the frontend, shared with desktop.
#[tauri::command]
pub async fn remote_events_connect<R: Runtime>(app: AppHandle<R>, state: State<'_, Remote>, stream_id: String) -> Result<(), String> {
    disconnect_events(&state);
    *state.stream_id.lock().unwrap() = stream_id.clone();
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

    if *state.stream_id.lock().unwrap() != stream_id { return Err("Connection changed".into()); }
    let _ = app.emit(STATUS, ConnStatus { stream_id: stream_id.clone(), connected: true, code: None });
    tauri::async_runtime::spawn(refresh_hosts(app.clone(), conn.clone(), h.clone()));
    let handle = app.clone();
    let event_stream_id = stream_id.clone();
    let task = tauri::async_runtime::spawn(async move {
        let stream_id = event_stream_id;
        let (mut tx, mut rx) = ws.split();
        let mut ping = tokio::time::interval(PING_EVERY);
        let mut last_seen = Instant::now();
        let mut code = None;
        loop {
            tokio::select! {
                msg = rx.next() => match msg {
                    Some(Ok(Message::Text(text))) => {
                        last_seen = Instant::now();
                        let _ = handle.emit(EVENT, json!({ "streamId": stream_id, "event": text.to_string() }));
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
        let _ = handle.emit(STATUS, ConnStatus { stream_id: stream_id.clone(), connected: false, code: code.filter(|c| *c != u16::from(CloseCode::Normal)) });
    });
    let current = state.stream_id.lock().unwrap();
    if *current != stream_id { task.abort(); return Err("Connection changed".into()); }
    *state.events.lock().unwrap() = Some(task);
    Ok(())
}

#[tauri::command]
pub fn remote_events_disconnect(state: State<'_, Remote>, stream_id: String) {
    let matches = *state.stream_id.lock().unwrap() == stream_id;
    if matches { disconnect_events(&state); }
}
