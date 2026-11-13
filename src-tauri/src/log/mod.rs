//! The app's log, and the only code that writes it.
//!
//! Everything that has something to say goes through here: this shell (desktop and phone), the Bun sidecar (it prints
//! `KESTREL_LOG <json>` lines that the shell reads), and the front end (through the `log_write` command). One writer
//! means one place for rotation, retention and the verbosity setting, and it can record what no other part can: the
//! sidecar's crashes, kills and raw stderr, and the shell's own panics.
//!
//! Records are one JSON object per line. Two tiers share the folder: *routine* files take everything the verbosity
//! lets through and are kept for days; *important* files take warnings and errors only and are kept for months.
//! See docs/logging.md.

mod files;
mod read;
pub mod commands;
mod scrub;
#[cfg(test)]
mod tests;

use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub enum Level {
    Debug,
    Info,
    Warn,
    Error,
}

impl Level {
    pub fn as_str(self) -> &'static str {
        match self {
            Level::Debug => "debug",
            Level::Info => "info",
            Level::Warn => "warn",
            Level::Error => "error",
        }
    }
    pub fn parse(s: &str) -> Option<Level> {
        Some(match s {
            "debug" => Level::Debug,
            "info" => Level::Info,
            "warn" => Level::Warn,
            "error" => Level::Error,
            _ => return None,
        })
    }
}

/// Who a record is attributed to when this shell writes it itself.
pub const SELF_SRC: &str = if cfg!(mobile) { "phone-native" } else { "shell" };

struct State {
    dir: PathBuf,
    verbose: AtomicBool,
    files: Mutex<files::Files>,
}

static LOG: OnceLock<State> = OnceLock::new();

const LEVEL_FILE: &str = "level";

/// Opens the log in `dir`, installs the panic hook and starts the daily clean-up. Safe to call once; later calls do nothing.
pub fn init(dir: PathBuf) {
    if LOG.get().is_some() {
        return;
    }
    let _ = std::fs::create_dir_all(&dir);
    let verbose = std::fs::read_to_string(dir.join(LEVEL_FILE)).map(|s| s.trim() == "verbose").unwrap_or(false);
    let state = State { files: Mutex::new(files::Files::new(dir.clone())), dir, verbose: AtomicBool::new(verbose) };
    if LOG.set(state).is_err() {
        return;
    }
    install_panic_hook();
    cleanup();
    std::thread::spawn(|| loop {
        std::thread::sleep(std::time::Duration::from_secs(6 * 3600));
        cleanup();
    });
    info(
        "shell",
        "started",
        json!({ "version": env!("CARGO_PKG_VERSION"), "platform": std::env::consts::OS, "arch": std::env::consts::ARCH, "verbose": verbose }),
    );
}

fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let place = info.location().map(|l| format!("{}:{}", l.file(), l.line())).unwrap_or_default();
        let what = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "panic".into());
        error("panic", &what, json!({ "at": place, "thread": std::thread::current().name().unwrap_or("?") }));
        previous(info);
    }));
}

pub fn dir() -> Option<&'static Path> {
    LOG.get().map(|s| s.dir.as_path())
}

pub fn verbose() -> bool {
    LOG.get().map(|s| s.verbose.load(Ordering::Relaxed)).unwrap_or(false)
}

/// Normal keeps info and above; verbose adds debug. Warnings and errors are never dropped.
pub fn set_verbose(on: bool) {
    let Some(s) = LOG.get() else { return };
    if s.verbose.swap(on, Ordering::Relaxed) == on {
        return;
    }
    let _ = std::fs::write(s.dir.join(LEVEL_FILE), if on { "verbose" } else { "normal" });
    info("log", "verbosity changed", json!({ "verbose": on }));
}

fn cleanup() {
    let Some(s) = LOG.get() else { return };
    let keep = s.files.lock().map(|f| f.current_names()).unwrap_or_default();
    let removed = files::prune(&s.dir, std::time::SystemTime::now(), &keep);
    if !removed.is_empty() {
        info("log", "old log files removed", json!({ "count": removed.len() }));
    }
}

/// Writes one record. `src` names who it is about; `fields` is any JSON object (or null).
pub fn write(level: Level, src: &str, module: &str, msg: &str, fields: Value, time: Option<String>) {
    let Some(s) = LOG.get() else { return };
    if level == Level::Debug && !s.verbose.load(Ordering::Relaxed) {
        return;
    }
    let time = time.unwrap_or_else(files::now_iso);
    let mut rec = Map::new();
    rec.insert("time".into(), time.clone().into());
    rec.insert("level".into(), level.as_str().into());
    rec.insert("src".into(), src.into());
    rec.insert("mod".into(), scrub::clip(module, 40).into());
    rec.insert("msg".into(), scrub::text(msg).into());
    if fields.as_object().map(|o| !o.is_empty()).unwrap_or(false) {
        rec.insert("fields".into(), scrub::value(&fields, 0));
    }
    let line = Value::Object(rec).to_string();
    let day = time.get(..10).unwrap_or("0000-00-00").to_string();
    if let Ok(mut f) = s.files.lock() {
        f.write("routine", src, &day, &line);
        if level >= Level::Warn {
            f.write("important", src, &day, &line);
        }
    }
}

#[allow(dead_code)] // used by the phone build
pub fn debug(module: &str, msg: &str, fields: Value) {
    write(Level::Debug, SELF_SRC, module, msg, fields, None);
}
pub fn info(module: &str, msg: &str, fields: Value) {
    write(Level::Info, SELF_SRC, module, msg, fields, None);
}
pub fn warn(module: &str, msg: &str, fields: Value) {
    write(Level::Warn, SELF_SRC, module, msg, fields, None);
}
pub fn error(module: &str, msg: &str, fields: Value) {
    write(Level::Error, SELF_SRC, module, msg, fields, None);
}

/// A record another part made: the sidecar's `KESTREL_LOG` line, or one the front end sent. Anything malformed is
/// kept as a plain message rather than lost. `src` is who the caller is; it can't claim to be someone else.
pub fn ingest(rec: &Value, src: &str) {
    let level = rec.get("level").and_then(Value::as_str).and_then(Level::parse).unwrap_or(Level::Info);
    let msg = rec.get("msg").and_then(Value::as_str).unwrap_or("");
    let module = rec.get("mod").and_then(Value::as_str).unwrap_or("?");
    let time = rec.get("time").and_then(Value::as_str).filter(|t| files::valid_iso(t)).map(str::to_string);
    // A phone's native layer reports through the same command as its UI, so it may name itself.
    let src = if src == "phone" && rec.get("src").and_then(Value::as_str) == Some("phone-native") { "phone-native" } else { src };
    write(level, src, module, msg, rec.get("fields").cloned().unwrap_or(Value::Null), time);
}

/// One line of the sidecar's output. Returns true when it was a log line (and so is not raw output).
#[allow(dead_code)] // the phone has no sidecar
pub fn ingest_sidecar_line(line: &str) -> bool {
    if let Some(json) = line.strip_prefix("KESTREL_LOG ") {
        match serde_json::from_str::<Value>(json) {
            Ok(rec) => ingest(&rec, "sidecar"),
            Err(_) => warn("sidecar", "unreadable log line", json!({ "line": scrub::clip(line, 300) })),
        }
        return true;
    }
    if let Some(level) = line.strip_prefix("KESTREL_LOG_LEVEL ") {
        set_verbose(level.trim() == "verbose");
        return true;
    }
    false
}
