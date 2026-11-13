//! Keeps secrets and bulk out of records this shell writes. The sidecar and the front end scrub before they send
//! (shared/log-redact.ts); this is the same policy for records made here and a second pass over what arrives.

use serde_json::Value;

const MAX_STRING: usize = 4000;
const MAX_KEYS: usize = 40;
const MAX_ITEMS: usize = 20;
const MAX_DEPTH: usize = 4;
const KEY_PREFIXES: [&str; 8] = ["sk-", "tvly-", "ghp_", "gho_", "ghu_", "ghs_", "xoxb-", "AKIA"];
const SECRET_KEYS: [&str; 9] = ["password", "passwd", "secret", "token", "apikey", "api_key", "api-key", "authorization", "cookie"];

pub fn clip(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let head: String = s.chars().take(max).collect();
    format!("{head}…(+{} chars)", s.chars().count() - max)
}

fn secret_key(k: &str) -> bool {
    let k = k.trim_matches(|c: char| !c.is_alphanumeric() && c != '_' && c != '-').to_ascii_lowercase();
    SECRET_KEYS.iter().any(|s| k.ends_with(s)) || k.ends_with("credentials") || k.ends_with("private_key")
}

/// One whitespace-free piece of text: key shapes, `key=value`, URL userinfo and secret query parameters.
fn word(w: &str, after_scheme: bool) -> String {
    if after_scheme || (w.len() >= 16 && KEY_PREFIXES.iter().any(|p| w.starts_with(p))) {
        return "[redacted]".into();
    }
    if let Some((k, v)) = w.split_once(['=', ':']) {
        if secret_key(k) && !v.is_empty() && !v.starts_with("//") {
            return format!("{k}{}[redacted]", &w[k.len()..k.len() + 1]);
        }
    }
    if let Some((scheme, rest)) = w.split_once("://") {
        let (auth, tail) = rest.split_once('/').map(|(a, t)| (a, format!("/{t}"))).unwrap_or((rest, String::new()));
        let host = auth.rsplit_once('@').map(|(_, h)| format!("[redacted]@{h}")).unwrap_or_else(|| auth.to_string());
        return format!("{scheme}://{host}{}", query(&tail));
    }
    w.to_string()
}

fn query(s: &str) -> String {
    let Some((path, q)) = s.split_once('?') else { return s.to_string() };
    let q: Vec<String> = q
        .split('&')
        .map(|p| match p.split_once('=') {
            Some((k, _)) if secret_key(k) || matches!(k, "code" | "key" | "sig" | "signature") => format!("{k}=[redacted]"),
            _ => p.to_string(),
        })
        .collect();
    format!("{path}?{}", q.join("&"))
}

pub fn text(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut prev_scheme = false;
    for (i, part) in s.split(' ').enumerate() {
        if i > 0 {
            out.push(' ');
        }
        out.push_str(&word(part, prev_scheme));
        prev_scheme = matches!(part, "Bearer" | "Basic");
    }
    clip(&out, MAX_STRING)
}

/// Any JSON as bounded, secret-free JSON.
pub fn value(v: &Value, depth: usize) -> Value {
    match v {
        Value::String(s) => Value::String(text(s)),
        Value::Array(a) if depth >= MAX_DEPTH => Value::String(format!("[deep: {} items]", a.len())),
        Value::Array(a) => {
            let mut items: Vec<Value> = a.iter().take(MAX_ITEMS).map(|x| value(x, depth + 1)).collect();
            if a.len() > MAX_ITEMS {
                items.push(Value::String(format!("…(+{} items)", a.len() - MAX_ITEMS)));
            }
            Value::Array(items)
        }
        Value::Object(_) if depth >= MAX_DEPTH => Value::String("[deep]".into()),
        Value::Object(o) => {
            let mut out = serde_json::Map::new();
            for (k, x) in o.iter().take(MAX_KEYS) {
                let hide = secret_key(k) && !matches!(x, Value::Bool(_) | Value::Number(_));
                out.insert(k.clone(), if hide { Value::String("[redacted]".into()) } else { value(x, depth + 1) });
            }
            if o.len() > MAX_KEYS {
                out.insert("…".into(), Value::String(format!("+{} keys", o.len() - MAX_KEYS)));
            }
            Value::Object(out)
        }
        other => other.clone(),
    }
}
