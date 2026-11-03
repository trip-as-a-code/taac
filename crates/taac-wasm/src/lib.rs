//! `@taac/core`: the Rust core for JavaScript. Files go in as a JSON object of
//! relative path → contents; results come back as JSON strings.

use taac_core::loader::Files;
use wasm_bindgen::prelude::*;

fn files(json: &str) -> Result<Files, JsError> {
    serde_json::from_str(json).map_err(|e| JsError::new(&format!("invalid files map: {e}")))
}

/// `{ ok: true, export }` or `{ ok: false, diagnostics }`.
#[wasm_bindgen(js_name = exportSite)]
pub fn export_site(files_json: &str, path: &str) -> Result<String, JsError> {
    let files = files(files_json)?;
    let value = match taac_core::export(&files, path) {
        Ok(export) => serde_json::json!({ "ok": true, "export": export }),
        Err(diagnostics) => serde_json::json!({ "ok": false, "diagnostics": diagnostics }),
    };
    serde_json::to_string(&value).map_err(|e| JsError::new(&e.to_string()))
}

/// Like `exportSite`, but whatever loads exports, errors and all: for past
/// versions, which today's rules may not accept.
#[wasm_bindgen(js_name = exportSiteLenient)]
pub fn export_site_lenient(files_json: &str, path: &str) -> Result<String, JsError> {
    let files = files(files_json)?;
    let value = match taac_core::export_lenient(&files, path) {
        Ok(export) => serde_json::json!({ "ok": true, "export": export }),
        Err(diagnostics) => serde_json::json!({ "ok": false, "diagnostics": diagnostics }),
    };
    serde_json::to_string(&value).map_err(|e| JsError::new(&e.to_string()))
}

/// Diagnostics only.
#[wasm_bindgen]
pub fn validate(files_json: &str, path: &str) -> Result<String, JsError> {
    let files = files(files_json)?;
    let (_, diagnostics) = taac_core::load(&files, path);
    serde_json::to_string(&diagnostics).map_err(|e| JsError::new(&e.to_string()))
}

/// Trip paths listed by a site file, relative to it.
#[wasm_bindgen(js_name = siteTripPaths)]
pub fn site_trip_paths(site_content: &str) -> Result<Vec<String>, JsError> {
    taac_core::loader::site_trip_paths(site_content).map_err(|e| JsError::new(&e))
}

/// Overlay files a trip file references, relative to its directory.
#[wasm_bindgen(js_name = overlayPaths)]
pub fn overlay_paths(trip_content: &str) -> Vec<String> {
    taac_core::loader::overlay_paths(trip_content)
}

#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_owned()
}
