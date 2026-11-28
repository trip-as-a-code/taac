//! End-to-end tests loading the compiled `transitous.wasm` plugin through the
//! real Extism host against a local mock HTTP server (`127.0.0.1`).

use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
use std::thread;

use indexmap::IndexMap;
use taac_plugin_api::{
    Capability, GeoPoint, PlanRouteRequest, RouteMode, VerifyRouteRequest, VerifyStatus,
};
use taac_plugins::{PluginLoadOptions, RoutePlugin};

const MOCK_PLAN_JSON: &str = r#"{
  "itineraries": [
    {
      "duration": 600,
      "startTime": "2026-11-30T09:05:00Z",
      "endTime": "2026-11-30T09:15:00Z",
      "transfers": 0,
      "legs": [
        {
          "mode": "REGIONAL_RAIL",
          "from": { "name": "Cais do Sodré", "lat": 38.7058, "lon": -9.1445 },
          "to": { "name": "Belém", "lat": 38.6975, "lon": -9.2032 },
          "startTime": "2026-11-30T09:05:00Z",
          "endTime": "2026-11-30T09:15:00Z",
          "duration": 600,
          "agencyName": "CP - Comboios de Portugal",
          "routeShortName": "U",
          "displayName": "U 19001",
          "headsign": "Cascais"
        }
      ]
    }
  ],
  "direct": []
}"#;

fn wasm_path() -> PathBuf {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let workspace_root = manifest_dir
        .parent()
        .and_then(|p| p.parent())
        .expect("workspace root");
    let dist = workspace_root.join("plugins/dist/transitous.wasm");
    if dist.is_file() {
        return dist;
    }
    workspace_root.join(
        "plugins/transitous/target/wasm32-unknown-unknown/release/taac_plugin_transitous.wasm",
    )
}

struct MockServer {
    base_url: String,
    hits: Arc<AtomicUsize>,
    last_user_agent: Arc<std::sync::Mutex<Option<String>>>,
}

fn spawn_mock_server(max_requests: usize) -> MockServer {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock server");
    let addr = listener.local_addr().expect("local addr");
    let hits = Arc::new(AtomicUsize::new(0));
    let last_ua = Arc::new(std::sync::Mutex::new(None));

    let hits_bg = Arc::clone(&hits);
    let ua_bg = Arc::clone(&last_ua);
    thread::spawn(move || {
        for stream in listener.incoming().take(max_requests) {
            let Ok(mut stream) = stream else { break };
            let mut buf = [0u8; 4096];
            let n = stream.read(&mut buf).unwrap_or(0);
            let req_text = String::from_utf8_lossy(&buf[..n]);
            for line in req_text.lines() {
                if let Some((k, v)) = line.split_once(':')
                    && k.trim().eq_ignore_ascii_case("user-agent")
                {
                    *ua_bg.lock().unwrap() = Some(v.trim().to_owned());
                }
            }
            hits_bg.fetch_add(1, Ordering::SeqCst);
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                MOCK_PLAN_JSON.len(),
                MOCK_PLAN_JSON
            );
            let _ = stream.write_all(response.as_bytes());
        }
    });

    MockServer {
        base_url: format!("http://{addr}/api"),
        hits,
        last_user_agent: last_ua,
    }
}

#[test]
fn transitous_wasm_plan_verify_cache_and_sandbox() {
    let path = wasm_path();
    assert!(
        path.is_file(),
        "compiled plugin not found at {} — run `task plugins` first",
        path.display()
    );

    let server = spawn_mock_server(4);
    let cache_dir =
        std::env::temp_dir().join(format!("taac-transitous-e2e-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&cache_dir);

    let mut config = IndexMap::new();
    config.insert("baseUrl".into(), server.base_url.clone());
    config.insert("contact".into(), "test@example.org".into());

    let mut opts = PluginLoadOptions::from_wasm(path.clone());
    opts.allowed_hosts = vec!["127.0.0.1".into()];
    opts.config = config.clone();
    opts.cache_dir = Some(cache_dir.clone());
    opts.min_delay_ms = 0;

    let mut plugin = RoutePlugin::load(&opts).expect("load transitous plugin");
    assert_eq!(plugin.info().name, "transitous");
    assert!(plugin.info().capabilities.contains(&Capability::RoutePlan));
    assert!(
        plugin
            .info()
            .capabilities
            .contains(&Capability::RouteVerify)
    );
    assert!(
        plugin
            .info()
            .attribution
            .as_ref()
            .is_some_and(|a| a.url.contains("transitous.org/sources"))
    );

    // 1. Plan route (live HTTP call).
    let plan_req = PlanRouteRequest {
        from: GeoPoint {
            lat: 38.7058,
            lon: -9.1445,
            name: Some("Cais do Sodré".into()),
        },
        to: GeoPoint {
            lat: 38.6975,
            lon: -9.2032,
            name: Some("Belém".into()),
        },
        time: "2026-11-30T09:00:00Z".into(),
        arrive_by: false,
        modes: vec![RouteMode::Train],
        num_itineraries: 3,
    };
    let plan_resp = plugin.plan_route(&plan_req).expect("plan_route");
    assert_eq!(plan_resp.itineraries.len(), 1);
    assert_eq!(plan_resp.itineraries[0].legs[0].kind, RouteMode::Train);
    assert_eq!(
        plan_resp.itineraries[0].legs[0].number.as_deref(),
        Some("U 19001")
    );
    assert_eq!(server.hits.load(Ordering::SeqCst), 1);

    // Verify mandatory User-Agent header was sent.
    let ua = server
        .last_user_agent
        .lock()
        .unwrap()
        .clone()
        .expect("User-Agent header present");
    assert!(ua.starts_with("taac/"));
    assert!(ua.contains("github.com/trip-as-a-code/taac"));
    assert!(ua.contains("test@example.org"));

    // 2. Identical plan_route call hits local cache (zero extra HTTP requests).
    let cached_resp = plugin.plan_route(&plan_req).expect("cached plan_route");
    assert_eq!(cached_resp, plan_resp);
    assert_eq!(server.hits.load(Ordering::SeqCst), 1);
    assert_eq!(plugin.cache_hits(), 1);

    // 3. Verify route (matching timetable).
    let verify_ok = VerifyRouteRequest {
        from: plan_req.from.clone(),
        to: plan_req.to.clone(),
        start: "2026-11-30T09:05:00Z".into(),
        end: "2026-11-30T09:15:00Z".into(),
        kind: RouteMode::Train,
        carrier: Some("CP".into()),
        number: Some("U 19001".into()),
        time_tolerance_mins: 15,
        duration_tolerance_pct: 50,
    };
    let ok_resp = plugin.verify_route(&verify_ok).expect("verify_route ok");
    assert_eq!(ok_resp.status, VerifyStatus::Verified);
    assert_eq!(ok_resp.issues.len(), 0);
    assert_eq!(server.hits.load(Ordering::SeqCst), 2);

    // 4. Verify route (mismatched schedule + service number -> returns alternatives).
    let verify_bad = VerifyRouteRequest {
        start: "2026-11-30T11:30:00Z".into(),
        end: "2026-11-30T11:40:00Z".into(),
        number: Some("IC 999".into()),
        ..verify_ok
    };
    let bad_resp = plugin.verify_route(&verify_bad).expect("verify_route bad");
    assert_eq!(bad_resp.status, VerifyStatus::Mismatch);
    assert_ne!(bad_resp.issues.len(), 0);
    assert_eq!(bad_resp.alternatives.len(), 1);
    assert_eq!(server.hits.load(Ordering::SeqCst), 3);

    // 5. Sandbox enforcement: disallowing 127.0.0.1 must block the HTTP call.
    let mut blocked_opts = PluginLoadOptions::from_wasm(path);
    blocked_opts.allowed_hosts = vec!["api.transitous.org".into()];
    blocked_opts.config = config;
    blocked_opts.use_cache = false;
    blocked_opts.cache_dir = Some(cache_dir.clone());
    blocked_opts.min_delay_ms = 0;
    let mut blocked = RoutePlugin::load(&blocked_opts).expect("load blocked plugin");
    let err = blocked.plan_route(&plan_req).unwrap_err();
    assert!(
        format!("{err:#}").to_lowercase().contains("not allowed")
            || format!("{err:#}").to_lowercase().contains("host"),
        "expected sandbox host rejection error, got: {err:#}"
    );

    let _ = std::fs::remove_dir_all(&cache_dir);
}
