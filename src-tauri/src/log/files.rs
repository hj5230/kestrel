//! Log files: names, daily and size-based rollover, and the retention sweep.
//!
//! Files are `<tier>-<source>-<YYYY-MM-DD>[.<n>].log`. Routine files (everything the verbosity allows) go after
//! `ROUTINE_DAYS`; important ones (warnings and errors) after `IMPORTANT_DAYS`. Each tier also has a size budget, and
//! the oldest files go first when it is exceeded. The files being written are never removed.

use std::collections::{HashMap, HashSet};
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub const ROUTINE_DAYS: u64 = 7;
pub const IMPORTANT_DAYS: u64 = 90;
pub const ROUTINE_BYTES: u64 = 128 * 1024 * 1024;
pub const IMPORTANT_BYTES: u64 = 64 * 1024 * 1024;
pub const FILE_BYTES: u64 = 8 * 1024 * 1024;
/// The unstructured file from before this log existed.
const LEGACY: &str = "agent.log";

pub fn tier_days(tier: &str) -> u64 {
    if tier == "important" { IMPORTANT_DAYS } else { ROUTINE_DAYS }
}
fn tier_bytes(tier: &str) -> u64 {
    if tier == "important" { IMPORTANT_BYTES } else { ROUTINE_BYTES }
}

/// Days since 1970-01-01 to (year, month, day), proleptic Gregorian (Hinnant's algorithm).
fn civil(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + if m <= 2 { 1 } else { 0 }, m, d)
}

pub fn iso_at(t: SystemTime) -> String {
    let d = t.duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = d.as_secs() as i64;
    let (y, mo, da) = civil(secs.div_euclid(86_400));
    let rem = secs.rem_euclid(86_400);
    format!("{y:04}-{mo:02}-{da:02}T{:02}:{:02}:{:02}.{:03}Z", rem / 3600, rem % 3600 / 60, rem % 60, d.subsec_millis())
}

pub fn now_iso() -> String {
    iso_at(SystemTime::now())
}

/// Whether a client-supplied time looks like the format above, so a bad clock can't misfile a record.
pub fn valid_iso(t: &str) -> bool {
    let b = t.as_bytes();
    b.len() >= 20 && b[4] == b'-' && b[7] == b'-' && b[10] == b'T' && b[..4].iter().all(u8::is_ascii_digit) && b[5..7].iter().all(u8::is_ascii_digit) && b[8..10].iter().all(u8::is_ascii_digit)
}

pub fn file_name(tier: &str, src: &str, day: &str, index: u32) -> String {
    if index == 0 { format!("{tier}-{src}-{day}.log") } else { format!("{tier}-{src}-{day}.{index}.log") }
}

/// `(tier, source, day)` of a log file name; `None` for anything else in the folder.
pub fn parse_name(name: &str) -> Option<(&str, &str, &str)> {
    let stem = name.strip_suffix(".log")?;
    let (tier, rest) = stem.split_once('-')?;
    if tier != "routine" && tier != "important" {
        return None;
    }
    let head = match rest.rsplit_once('.') {
        Some((h, n)) if !n.is_empty() && n.bytes().all(|c| c.is_ascii_digit()) => h,
        _ => rest,
    };
    let at = head.len().checked_sub(11)?;
    let (src, day) = (head.get(..at)?, head.get(at + 1..)?);
    let d = day.as_bytes();
    let ok = head.as_bytes()[at] == b'-' && !src.is_empty() && d[4] == b'-' && d[7] == b'-' && d.iter().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit());
    ok.then_some((tier, src, day))
}

struct Open {
    day: String,
    index: u32,
    size: u64,
    file: File,
}

pub struct Files {
    dir: PathBuf,
    open: HashMap<String, Open>,
    max: u64,
}

impl Files {
    pub fn new(dir: PathBuf) -> Self {
        Files { dir, open: HashMap::new(), max: FILE_BYTES }
    }

    #[cfg(test)]
    pub fn with_max(dir: PathBuf, max: u64) -> Self {
        Files { dir, open: HashMap::new(), max }
    }

    fn open_file(&self, tier: &str, src: &str, day: &str, mut index: u32, add: u64) -> Option<Open> {
        loop {
            let path = self.dir.join(file_name(tier, src, day, index));
            let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            if size > 0 && size + add > self.max {
                index += 1;
                continue;
            }
            let file = OpenOptions::new().create(true).append(true).open(path).ok()?;
            return Some(Open { day: day.to_string(), index, size, file });
        }
    }

    /// Appends one line, unbuffered so a crash right after still leaves it on disk.
    pub fn write(&mut self, tier: &str, src: &str, day: &str, line: &str) {
        let key = format!("{tier}/{src}");
        let add = line.len() as u64 + 1;
        let stale = match self.open.get(&key) {
            Some(o) => o.day != day || (o.size > 0 && o.size + add > self.max),
            None => true,
        };
        if stale {
            let from = self.open.get(&key).filter(|o| o.day == day).map(|o| o.index + 1).unwrap_or(0);
            match self.open_file(tier, src, day, from, add) {
                Some(o) => {
                    self.open.insert(key.clone(), o);
                }
                None => return,
            }
        }
        if let Some(o) = self.open.get_mut(&key) {
            if writeln!(o.file, "{line}").is_ok() {
                o.size += add;
            }
        }
    }

    pub fn current_names(&self) -> HashSet<String> {
        self.open.iter().filter_map(|(k, o)| k.split_once('/').map(|(t, s)| file_name(t, s, &o.day, o.index))).collect()
    }
}

/// Removes files past their tier's age, then the oldest of any tier still over its size budget.
pub fn prune(dir: &Path, now: SystemTime, keep: &HashSet<String>) -> Vec<String> {
    let mut removed = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else { return removed };
    let mut tiers: HashMap<&str, Vec<(String, SystemTime, u64)>> = HashMap::new();
    let drop = |name: &str, removed: &mut Vec<String>| {
        if std::fs::remove_file(dir.join(name)).is_ok() {
            removed.push(name.to_string());
        }
    };
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if name == LEGACY {
            drop(&name, &mut removed);
            continue;
        }
        let Some((tier, _, _)) = parse_name(&name) else { continue };
        let Ok(meta) = e.metadata() else { continue };
        let modified = meta.modified().unwrap_or(now);
        let age = now.duration_since(modified).unwrap_or_default();
        if !keep.contains(&name) && age > Duration::from_secs(tier_days(tier) * 86_400) {
            drop(&name, &mut removed);
        } else {
            tiers.entry(if tier == "important" { "important" } else { "routine" }).or_default().push((name, modified, meta.len()));
        }
    }
    for (tier, mut list) in tiers {
        list.sort_by_key(|f| f.1);
        let mut total: u64 = list.iter().map(|f| f.2).sum();
        for (name, _, size) in list {
            if total <= tier_bytes(tier) {
                break;
            }
            if keep.contains(&name) {
                continue;
            }
            drop(&name, &mut removed);
            total = total.saturating_sub(size);
        }
    }
    removed
}
