//! Disk response cache and fair-use request budget for online plugins.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};

/// Default cache TTL: 24 hours.
pub const DEFAULT_TTL_SECS: u64 = 24 * 3600;

/// Rolling 24h warning threshold for public Transitous endpoints.
pub const TRANSITOUS_WARN_24H: usize = 500;

/// Rolling 24h hard cap for public Transitous endpoints (Transitous asks for
/// coordination above 720 `/plan` requests per 24h).
pub const TRANSITOUS_MAX_24H: usize = 700;

/// Resolve the default cache directory (`$XDG_CACHE_HOME/taac/plugins` or `~/.cache/taac/plugins`).
pub fn default_cache_dir() -> PathBuf {
    if let Ok(xdg) = std::env::var("XDG_CACHE_HOME")
        && !xdg.trim().is_empty()
    {
        return PathBuf::from(xdg).join("taac").join("plugins");
    }
    if let Ok(home) = std::env::var("HOME")
        && !home.trim().is_empty()
    {
        return PathBuf::from(home)
            .join(".cache")
            .join("taac")
            .join("plugins");
    }
    std::env::temp_dir().join("taac-plugins-cache")
}

pub fn now_unix_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| i64::try_from(d.as_secs()).unwrap_or(0))
}

/// Deterministic 128-bit FNV-1a-derived hex hash for cache keys (no external crate needed).
pub fn cache_key(plugin: &str, op: &str, payload: &str) -> String {
    let h1 = fnv1a_64(0xcbf2_9ce4_8422_2325, plugin, op, payload);
    let h2 = fnv1a_64(0xaf63_dc4c_8601_ec8c, payload, plugin, op);
    format!("{plugin}-{op}-{h1:016x}{h2:016x}")
}

fn fnv1a_64(seed: u64, a: &str, b: &str, c: &str) -> u64 {
    const PRIME: u64 = 0x0100_0000_01b3;
    let mut hash = seed;
    for part in [a.as_bytes(), b"\0", b.as_bytes(), b"\0", c.as_bytes()] {
        for &byte in part {
            hash ^= u64::from(byte);
            hash = hash.wrapping_mul(PRIME);
        }
    }
    hash
}

#[derive(Debug, Serialize, Deserialize)]
struct CacheEntry<T> {
    stored_at_unix: i64,
    value: T,
}

/// Simple JSON-file response cache with TTL.
#[derive(Debug, Clone)]
pub struct ResponseCache {
    dir: PathBuf,
    ttl_secs: u64,
    enabled: bool,
}

impl ResponseCache {
    pub fn new(dir: PathBuf, ttl_secs: u64, enabled: bool) -> Self {
        Self {
            dir,
            ttl_secs,
            enabled,
        }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    pub fn get<T: for<'de> Deserialize<'de>>(&self, key: &str) -> Option<T> {
        if !self.enabled {
            return None;
        }
        let path = self.dir.join(format!("{key}.json"));
        let content = fs::read_to_string(path).ok()?;
        let entry: CacheEntry<T> = serde_json::from_str(&content).ok()?;
        let age = now_unix_secs().saturating_sub(entry.stored_at_unix);
        if age < 0 || u64::try_from(age).unwrap_or(u64::MAX) > self.ttl_secs {
            return None;
        }
        Some(entry.value)
    }

    pub fn put<T: Serialize>(&self, key: &str, value: &T) {
        if !self.enabled {
            return;
        }
        if fs::create_dir_all(&self.dir).is_err() {
            return;
        }
        let entry = CacheEntry {
            stored_at_unix: now_unix_secs(),
            value,
        };
        if let Ok(json) = serde_json::to_string(&entry) {
            let path = self.dir.join(format!("{key}.json"));
            let _ = fs::write(path, json);
        }
    }
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct RateState {
    /// Hostname -> list of Unix timestamps of live requests within the last 24h.
    hosts: BTreeMap<String, Vec<i64>>,
}

/// Enforces per-run request caps, inter-request pacing, and rolling 24h fair-use limits.
#[derive(Debug)]
pub struct RequestBudget {
    state_path: PathBuf,
    max_per_run: usize,
    min_delay: Duration,
    run_count: usize,
    last_request: Option<Instant>,
    warned_24h: bool,
}

impl RequestBudget {
    pub fn new(cache_dir: &Path, max_per_run: usize, min_delay_ms: u64) -> Self {
        Self {
            state_path: cache_dir.join("rate_limit.json"),
            max_per_run,
            min_delay: Duration::from_millis(min_delay_ms),
            run_count: 0,
            last_request: None,
            warned_24h: false,
        }
    }

    pub fn live_requests(&self) -> usize {
        self.run_count
    }

    /// Check limits, apply inter-request pacing, and record a live request for `host`.
    pub fn acquire(&mut self, host: &str) -> Result<Option<String>> {
        if self.run_count >= self.max_per_run {
            bail!(
                "reached per-run live request limit ({}) for plugin calls; pass --max-requests to raise it or rely on cached responses",
                self.max_per_run
            );
        }

        let mut warning = None;
        let is_public_transitous = host.eq_ignore_ascii_case("api.transitous.org")
            || host.eq_ignore_ascii_case("staging.api.transitous.org");

        let now = now_unix_secs();
        let cutoff = now - 24 * 3600;
        let mut state = self.load_state();
        let timestamps = state.hosts.entry(host.to_ascii_lowercase()).or_default();
        timestamps.retain(|&ts| ts >= cutoff);

        if is_public_transitous {
            if timestamps.len() >= TRANSITOUS_MAX_24H {
                bail!(
                    "24h fair-use safeguard reached for {host} ({} requests in the last 24h; Transitous requires prior coordination above 720/24h). Wait for the window to clear or configure a self-hosted MOTIS instance via `baseUrl`.",
                    timestamps.len()
                );
            }
            if !self.warned_24h && timestamps.len() >= TRANSITOUS_WARN_24H {
                self.warned_24h = true;
                warning = Some(format!(
                    "warning: {} live requests made to {host} in the last 24h (Transitous fair-use threshold is 720/24h)",
                    timestamps.len()
                ));
            }
        }

        if let Some(last) = self.last_request
            && let Some(remaining) = self.min_delay.checked_sub(last.elapsed())
        {
            thread::sleep(remaining);
        }

        timestamps.push(now);
        self.save_state(&state)?;
        self.run_count += 1;
        self.last_request = Some(Instant::now());
        Ok(warning)
    }

    fn load_state(&self) -> RateState {
        fs::read_to_string(&self.state_path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    fn save_state(&self, state: &RateState) -> Result<()> {
        if let Some(parent) = self.state_path.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("creating cache directory {}", parent.display()))?;
        }
        let json = serde_json::to_string(state)?;
        fs::write(&self.state_path, json)
            .with_context(|| format!("writing {}", self.state_path.display()))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_round_trips_values() {
        let dir =
            std::env::temp_dir().join(format!("taac-cache-test-{}", now_unix_secs() ^ 0x55aa));
        let _ = fs::remove_dir_all(&dir);
        let cache = ResponseCache::new(dir.clone(), 3600, true);
        let key = cache_key("transitous", "plan", "{\"a\":1}");
        assert_eq!(cache.get::<String>(&key), None);
        cache.put(&key, &"hello".to_owned());
        assert_eq!(cache.get::<String>(&key).as_deref(), Some("hello"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn budget_enforces_per_run_limit() {
        let dir =
            std::env::temp_dir().join(format!("taac-budget-test-{}", now_unix_secs() ^ 0x1234));
        let _ = fs::remove_dir_all(&dir);
        let mut budget = RequestBudget::new(&dir, 2, 0);
        assert!(budget.acquire("127.0.0.1").is_ok());
        assert!(budget.acquire("127.0.0.1").is_ok());
        assert!(budget.acquire("127.0.0.1").is_err());
        let _ = fs::remove_dir_all(&dir);
    }
}
