//! The Macs this phone is paired with, and which one it is driving.
//!
//! Kept free of Keychain and network code so the bookkeeping can be unit-tested on the host:
//! the tokens live in the Keychain (keyed by `device_id`) and `remote.rs` handles those.

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub server_name: String,
    pub hosts: Vec<String>,
    pub port: u16,
    pub fingerprint: String,
    pub device_id: String,
    pub paired_at: u64,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Store {
    /// `device_id` of the Mac in use. Always one of `macs` unless `macs` is empty.
    pub active: Option<String>,
    pub macs: Vec<Profile>,
}

impl Store {
    /// Reads `remote.json`. Earlier builds could pair one Mac and stored its bare profile; that
    /// becomes a store with a single, active Mac.
    pub fn parse(text: &str) -> Result<Store, String> {
        let mut store = match serde_json::from_str::<Store>(text) {
            Ok(s) => s,
            Err(_) => {
                let p: Profile = serde_json::from_str(text).map_err(|e| e.to_string())?;
                Store { active: Some(p.device_id.clone()), macs: vec![p] }
            }
        };
        store.normalize();
        Ok(store)
    }

    pub fn find(&self, device_id: &str) -> Option<&Profile> {
        self.macs.iter().find(|m| m.device_id == device_id)
    }

    pub fn active_profile(&self) -> Option<&Profile> {
        self.active.as_deref().and_then(|id| self.find(id))
    }

    /// Makes `active` point at a real entry again after entries came or went.
    fn normalize(&mut self) {
        if self.active.as_deref().map_or(true, |id| self.find(id).is_none()) {
            self.active = self.macs.first().map(|m| m.device_id.clone());
        }
    }

    /// Adds a freshly paired Mac and makes it the active one. A Mac pairs under the same
    /// certificate every time, so one already in the list is replaced rather than duplicated;
    /// the replaced entry is returned so its old pairing can be dropped on the Mac too.
    pub fn upsert(&mut self, profile: Profile) -> Option<Profile> {
        self.active = Some(profile.device_id.clone());
        let same = self.macs.iter().position(|m| m.fingerprint.eq_ignore_ascii_case(&profile.fingerprint));
        match same {
            Some(i) => Some(std::mem::replace(&mut self.macs[i], profile)),
            None => {
                self.macs.push(profile);
                None
            }
        }
    }

    pub fn select(&mut self, device_id: &str) -> bool {
        let known = self.find(device_id).is_some();
        if known {
            self.active = Some(device_id.to_string());
        }
        known
    }

    /// Removing the active Mac falls back to the first one left.
    pub fn remove(&mut self, device_id: &str) -> Option<Profile> {
        let i = self.macs.iter().position(|m| m.device_id == device_id)?;
        let removed = self.macs.remove(i);
        self.normalize();
        Some(removed)
    }

    /// Drops entries whose Keychain secret is gone (e.g. a backup restored onto a new phone).
    pub fn retain_with_secret(&mut self, has_secret: impl Fn(&str) -> bool) {
        self.macs.retain(|m| has_secret(&m.device_id));
        self.normalize();
    }

    pub fn update_hosts(&mut self, device_id: &str, hosts: Vec<String>) -> Option<Profile> {
        let m = self.macs.iter_mut().find(|m| m.device_id == device_id)?;
        m.hosts = hosts;
        Some(m.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mac(id: &str, fp: &str) -> Profile {
        Profile {
            server_name: format!("Mac {id}"),
            hosts: vec!["10.0.0.2".into()],
            port: 47830,
            fingerprint: fp.into(),
            device_id: id.into(),
            paired_at: 1,
        }
    }

    #[test]
    fn reads_the_single_profile_older_builds_stored() {
        let legacy = serde_json::to_string(&mac("a", "aa")).unwrap();
        let store = Store::parse(&legacy).unwrap();
        assert_eq!(store.active.as_deref(), Some("a"));
        assert_eq!(store.macs.len(), 1);
    }

    #[test]
    fn round_trips() {
        let mut s = Store::default();
        s.upsert(mac("a", "aa"));
        s.upsert(mac("b", "bb"));
        let back = Store::parse(&serde_json::to_string(&s).unwrap()).unwrap();
        assert_eq!(back, s);
    }

    #[test]
    fn pairing_a_second_mac_keeps_the_first() {
        let mut s = Store::default();
        assert!(s.upsert(mac("a", "aa")).is_none());
        assert!(s.upsert(mac("b", "bb")).is_none());
        assert_eq!(s.macs.len(), 2);
        assert_eq!(s.active.as_deref(), Some("b"));
    }

    #[test]
    fn pairing_the_same_mac_again_replaces_its_entry() {
        let mut s = Store::default();
        s.upsert(mac("a", "AABB"));
        s.upsert(mac("b", "ccdd"));
        let replaced = s.upsert(mac("a2", "aabb")).expect("same certificate");
        assert_eq!(replaced.device_id, "a");
        assert_eq!(s.macs.iter().map(|m| m.device_id.as_str()).collect::<Vec<_>>(), ["a2", "b"]);
        assert_eq!(s.active.as_deref(), Some("a2"));
    }

    #[test]
    fn select_only_accepts_known_macs() {
        let mut s = Store::default();
        s.upsert(mac("a", "aa"));
        s.upsert(mac("b", "bb"));
        assert!(s.select("a"));
        assert_eq!(s.active_profile().unwrap().device_id, "a");
        assert!(!s.select("zzz"));
        assert_eq!(s.active.as_deref(), Some("a"));
    }

    #[test]
    fn removing_the_active_mac_falls_back_to_another() {
        let mut s = Store::default();
        s.upsert(mac("a", "aa"));
        s.upsert(mac("b", "bb"));
        assert_eq!(s.remove("b").unwrap().device_id, "b");
        assert_eq!(s.active.as_deref(), Some("a"));
        assert!(s.remove("nope").is_none());
        s.remove("a");
        assert!(s.active.is_none() && s.macs.is_empty());
    }

    #[test]
    fn removing_another_mac_keeps_the_active_one() {
        let mut s = Store::default();
        s.upsert(mac("a", "aa"));
        s.upsert(mac("b", "bb"));
        s.remove("a");
        assert_eq!(s.active.as_deref(), Some("b"));
    }

    #[test]
    fn entries_without_a_secret_are_dropped() {
        let mut s = Store::default();
        s.upsert(mac("a", "aa"));
        s.upsert(mac("b", "bb"));
        s.retain_with_secret(|id| id == "a");
        assert_eq!(s.macs.len(), 1);
        assert_eq!(s.active.as_deref(), Some("a"));
    }

    #[test]
    fn host_updates_target_one_mac() {
        let mut s = Store::default();
        s.upsert(mac("a", "aa"));
        s.upsert(mac("b", "bb"));
        let p = s.update_hosts("a", vec!["h1".into(), "h2".into()]).unwrap();
        assert_eq!(p.hosts, ["h1", "h2"]);
        assert_eq!(s.find("b").unwrap().hosts, ["10.0.0.2"]);
        assert!(s.update_hosts("zzz", vec![]).is_none());
    }
}
