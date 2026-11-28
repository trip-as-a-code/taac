//! Extism WebAssembly plugin loader and typed RPC wrapper.

use std::fs;
use std::path::PathBuf;
use std::time::Duration;

use anyhow::{Context, Result, bail};
use extism::{Manifest, Plugin, Wasm};
use indexmap::IndexMap;
use taac_plugin_api::{
    FN_PLUGIN_INFO, FN_ROUTE_PLAN, FN_ROUTE_VERIFY, PLUGIN_API_VERSION, PlanRouteRequest,
    PlanRouteResponse, PluginInfo, VerifyRouteRequest, VerifyRouteResponse,
};

use crate::cache::{
    DEFAULT_TTL_SECS, RequestBudget, ResponseCache, cache_key, default_cache_dir, now_unix_secs,
};

const TAAC_REPO_URL: &str = "https://github.com/trip-as-a-code/taac";

/// Options for loading an Extism route plugin.
#[derive(Debug, Clone)]
pub struct PluginLoadOptions {
    pub wasm_path: PathBuf,
    /// Hostnames permitted in the Extism sandbox. Empty means use the plugin's
    /// declared `default_hosts` (never `*`).
    pub allowed_hosts: Vec<String>,
    /// Key-value configuration passed into the plugin manifest.
    pub config: IndexMap<String, String>,
    /// Directory for cached responses and 24h rate-limit state.
    pub cache_dir: Option<PathBuf>,
    pub use_cache: bool,
    pub max_requests: usize,
    pub min_delay_ms: u64,
    pub timeout_secs: u64,
}

impl PluginLoadOptions {
    pub fn from_wasm(wasm_path: PathBuf) -> Self {
        Self {
            wasm_path,
            allowed_hosts: Vec::new(),
            config: IndexMap::new(),
            cache_dir: None,
            use_cache: true,
            max_requests: 50,
            min_delay_ms: 250,
            timeout_secs: 30,
        }
    }
}

/// Loaded and sandboxed Extism route-provider plugin.
pub struct RoutePlugin {
    info: PluginInfo,
    plugin: Plugin,
    primary_host: String,
    cache: ResponseCache,
    budget: RequestBudget,
    cache_hits: usize,
}

impl RoutePlugin {
    /// Load a `.wasm` plugin from disk, verify its `taac_plugin_info` metadata
    /// with zero network access first, and then initialize the sandboxed runtime.
    pub fn load(opts: &PluginLoadOptions) -> Result<Self> {
        let bytes = fs::read(&opts.wasm_path)
            .with_context(|| format!("reading plugin {}", opts.wasm_path.display()))?;

        // Step 1: Discovery with NO allowed hosts (pure metadata call).
        let probe_manifest =
            Manifest::new([Wasm::data(bytes.clone())]).with_timeout(Duration::from_secs(5));
        let mut probe = Plugin::new(&probe_manifest, [], false)
            .with_context(|| format!("instantiating plugin {}", opts.wasm_path.display()))?;
        let raw_info: String = probe
            .call(FN_PLUGIN_INFO, "")
            .with_context(|| format!("calling {FN_PLUGIN_INFO} on {}", opts.wasm_path.display()))?;
        let info: PluginInfo = serde_json::from_str(&raw_info)
            .with_context(|| format!("parsing {FN_PLUGIN_INFO} response"))?;

        if info.api_version != PLUGIN_API_VERSION {
            bail!(
                "plugin `{}` uses unsupported API version `{}` (expected `{PLUGIN_API_VERSION}`)",
                info.name,
                info.api_version
            );
        }

        // Step 2: Determine sandbox host allowlist (never permit wildcards).
        let allowed_hosts = if opts.allowed_hosts.is_empty() {
            info.default_hosts.clone()
        } else {
            opts.allowed_hosts.clone()
        };
        for host in &allowed_hosts {
            if host.trim() == "*" {
                bail!("wildcard `*` is not permitted in plugin `allowedHosts`");
            }
        }
        let primary_host = extract_base_url_host(&opts.config)
            .or_else(|| allowed_hosts.first().cloned())
            .unwrap_or_else(|| "unknown".to_owned());

        // Step 3: Build runtime manifest with ToS-compliant User-Agent and config.
        let mut runtime_config = opts.config.clone();
        let user_agent = build_user_agent(opts.config.get("contact").map(String::as_str));
        runtime_config
            .entry("user_agent".to_owned())
            .or_insert(user_agent);
        runtime_config
            .entry("taac_version".to_owned())
            .or_insert_with(|| env!("CARGO_PKG_VERSION").to_owned());
        runtime_config
            .entry("now_unix".to_owned())
            .or_insert_with(|| now_unix_secs().to_string());

        let mut manifest = Manifest::new([Wasm::data(bytes)])
            .with_timeout(Duration::from_secs(opts.timeout_secs.max(1)))
            .with_config(runtime_config.into_iter());
        for host in &allowed_hosts {
            manifest = manifest.with_allowed_host(host);
        }

        let plugin = Plugin::new(&manifest, [], false)
            .with_context(|| format!("initializing sandbox for plugin `{}`", info.name))?;

        let cache_dir = opts.cache_dir.clone().unwrap_or_else(default_cache_dir);
        let cache = ResponseCache::new(cache_dir.clone(), DEFAULT_TTL_SECS, opts.use_cache);
        let budget = RequestBudget::new(&cache_dir, opts.max_requests, opts.min_delay_ms);

        Ok(Self {
            info,
            plugin,
            primary_host,
            cache,
            budget,
            cache_hits: 0,
        })
    }

    pub fn info(&self) -> &PluginInfo {
        &self.info
    }

    pub fn live_requests(&self) -> usize {
        self.budget.live_requests()
    }

    pub fn cache_hits(&self) -> usize {
        self.cache_hits
    }

    pub fn plan_route(&mut self, req: &PlanRouteRequest) -> Result<PlanRouteResponse> {
        let payload = serde_json::to_string(req)?;
        let key = cache_key(&self.info.name, "plan", &payload);
        if let Some(cached) = self.cache.get::<PlanRouteResponse>(&key) {
            self.cache_hits += 1;
            return Ok(cached);
        }

        if let Some(warning) = self.budget.acquire(&self.primary_host)? {
            eprintln!("{warning}");
        }

        let raw: String = self
            .plugin
            .call(FN_ROUTE_PLAN, &payload)
            .with_context(|| format!("calling {FN_ROUTE_PLAN} on plugin `{}`", self.info.name))?;
        let resp: PlanRouteResponse = serde_json::from_str(&raw)
            .with_context(|| format!("parsing {FN_ROUTE_PLAN} response"))?;
        self.cache.put(&key, &resp);
        Ok(resp)
    }

    pub fn verify_route(&mut self, req: &VerifyRouteRequest) -> Result<VerifyRouteResponse> {
        let payload = serde_json::to_string(req)?;
        let key = cache_key(&self.info.name, "verify", &payload);
        if let Some(cached) = self.cache.get::<VerifyRouteResponse>(&key) {
            self.cache_hits += 1;
            return Ok(cached);
        }

        if let Some(warning) = self.budget.acquire(&self.primary_host)? {
            eprintln!("{warning}");
        }

        let raw: String = self
            .plugin
            .call(FN_ROUTE_VERIFY, &payload)
            .with_context(|| format!("calling {FN_ROUTE_VERIFY} on plugin `{}`", self.info.name))?;
        let resp: VerifyRouteResponse = serde_json::from_str(&raw)
            .with_context(|| format!("parsing {FN_ROUTE_VERIFY} response"))?;
        self.cache.put(&key, &resp);
        Ok(resp)
    }
}

/// Build a Transitous-compliant `User-Agent` header containing app name, version, and contact.
pub fn build_user_agent(contact: Option<&str>) -> String {
    let version = env!("CARGO_PKG_VERSION");
    match contact.map(str::trim).filter(|c| !c.is_empty()) {
        Some(extra) => format!("taac/{version} (+{TAAC_REPO_URL}; {extra})"),
        None => format!("taac/{version} (+{TAAC_REPO_URL})"),
    }
}

fn extract_base_url_host(config: &IndexMap<String, String>) -> Option<String> {
    let url = config
        .get("baseUrl")
        .or_else(|| config.get("base_url"))?
        .trim();
    let without_scheme = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))?;
    let host_port = without_scheme.split('/').next()?;
    let host = host_port.split(':').next()?;
    (!host.is_empty()).then(|| host.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_compliant_user_agent() {
        let ua = build_user_agent(None);
        assert!(ua.starts_with("taac/"));
        assert!(ua.contains(TAAC_REPO_URL));

        let with_contact = build_user_agent(Some("alice@example.org"));
        assert!(with_contact.contains("alice@example.org"));
    }

    #[test]
    fn extracts_host_from_base_url() {
        let mut cfg = IndexMap::new();
        cfg.insert("baseUrl".into(), "http://127.0.0.1:8080/api".into());
        assert_eq!(extract_base_url_host(&cfg).as_deref(), Some("127.0.0.1"));
    }
}
