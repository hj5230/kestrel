use super::files::{self, Files};
use super::*;
use std::collections::HashSet;
use std::time::{Duration, SystemTime};

fn tmp(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("kestrel-log-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

#[test]
fn names_round_trip() {
    assert_eq!(files::parse_name("important-sidecar-2026-01-02.log"), Some(("important", "sidecar", "2026-01-02")));
    assert_eq!(files::parse_name("routine-phone-native-2026-01-02.3.log"), Some(("routine", "phone-native", "2026-01-02")));
    assert_eq!(files::parse_name("agent.log"), None);
    assert_eq!(files::parse_name("routine-x-2026-1-2.log"), None);
    assert_eq!(files::file_name("routine", "shell", "2026-01-02", 2), "routine-shell-2026-01-02.2.log");
}

#[test]
fn timestamps_are_utc_iso() {
    assert_eq!(files::iso_at(SystemTime::UNIX_EPOCH + Duration::from_millis(1_767_225_600_123)), "2026-01-01T00:00:00.123Z");
    assert!(files::valid_iso("2026-01-01T00:00:00.123Z"));
    assert!(!files::valid_iso("yesterday"));
}

#[test]
fn files_roll_over_by_size_and_day() {
    let d = tmp("roll");
    let mut f = Files::with_max(d.clone(), 200);
    for _ in 0..6 {
        f.write("routine", "shell", "2026-01-01", &"x".repeat(90));
    }
    f.write("routine", "shell", "2026-01-02", "y");
    let mut names: Vec<_> = std::fs::read_dir(&d).unwrap().flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect();
    names.sort();
    assert_eq!(names, ["routine-shell-2026-01-01.1.log", "routine-shell-2026-01-01.2.log", "routine-shell-2026-01-01.log", "routine-shell-2026-01-02.log"]);
}

#[test]
fn routine_files_expire_sooner_than_important_ones() {
    let d = tmp("prune");
    let make = |name: &str, age_days: u64| {
        let p = d.join(name);
        std::fs::write(&p, "{}\n").unwrap();
        let t = SystemTime::now() - Duration::from_secs(age_days * 86_400);
        std::fs::File::options().write(true).open(&p).unwrap().set_modified(t).unwrap();
    };
    make("routine-shell-2026-01-01.log", files::ROUTINE_DAYS + 1);
    make("important-shell-2026-01-01.log", files::ROUTINE_DAYS + 1);
    make("important-shell-2025-01-01.log", files::IMPORTANT_DAYS + 1);
    make("routine-shell-2026-01-03.log", files::ROUTINE_DAYS + 5);
    make("agent.log", 0);
    std::fs::write(d.join("notes.txt"), "mine").unwrap();
    let keep: HashSet<String> = ["routine-shell-2026-01-03.log".to_string()].into();
    let mut removed = files::prune(&d, SystemTime::now(), &keep);
    removed.sort();
    assert_eq!(removed, ["agent.log", "important-shell-2025-01-01.log", "routine-shell-2026-01-01.log"]);
}

#[test]
fn secrets_never_reach_a_record() {
    let s = scrub::text("apiKey=sk-abcdefghijklmnopqrstuv Authorization: Bearer abcdefghijklmnop https://u:pw@h.io/x?token=abc123&a=1");
    for secret in ["sk-abc", "abcdefghijklmnop", "pw@", "abc123"] {
        assert!(!s.contains(secret), "{secret} leaked in {s}");
    }
    assert!(s.contains("a=1"));
    let v = scrub::value(&json!({ "apiKey": "x", "inputTokens": 12, "nested": { "password": "z", "ok": 1 } }), 0);
    assert_eq!(v, json!({ "apiKey": "[redacted]", "inputTokens": 12, "nested": { "password": "[redacted]", "ok": 1 } }));
    assert!(scrub::text(&"x".repeat(10_000)).chars().count() < 4100);
}

#[test]
fn verbosity_filters_debug_and_records_reach_both_tiers() {
    let d = tmp("write");
    init(d.clone());
    set_verbose(false);
    debug("t", "hidden", Value::Null);
    info("t", "seen", Value::Null);
    warn("t", "careful", json!({ "apiKey": "secret-value" }));
    let all: String = std::fs::read_dir(&d).unwrap().flatten().filter(|e| e.file_name().to_string_lossy().starts_with("routine")).map(|e| std::fs::read_to_string(e.path()).unwrap()).collect();
    assert!(all.contains("\"seen\"") && !all.contains("hidden") && !all.contains("secret-value"));
    let page = read::query(&d, &read::Query { tier: "important".into(), min_level: None, module: None, src: None, search: None, limit: None });
    assert_eq!(page.records.len(), 1);
    assert!(ingest_sidecar_line("KESTREL_LOG {\"time\":\"2026-01-01T00:00:00.000Z\",\"level\":\"error\",\"src\":\"liar\",\"mod\":\"agent\",\"msg\":\"boom\"}"));
    assert!(!ingest_sidecar_line("plain output"));
    let page = read::query(&d, &read::Query { tier: "important".into(), min_level: Some("error".into()), module: None, src: Some("sidecar".into()), search: Some("boom".into()), limit: None });
    assert_eq!(page.records.len(), 1, "a record keeps the source of the channel it came through");
}
