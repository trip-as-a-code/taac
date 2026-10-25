//! Trip as a Code: declare trips in YAML, validate them, and compile them
//! into calendars, maps, ledgers and a web-ready export.

pub mod budget;
pub mod diagnostics;
pub mod export;
pub mod generators;
pub mod loader;
pub mod model;
pub mod schema;
pub mod secrets;
pub mod validate;

pub mod yaml {
    /// YAML → `T`, with the parser's message as the error.
    pub fn from_str<T: serde::de::DeserializeOwned>(content: &str) -> Result<T, String> {
        serde_saphyr::from_str(content).map_err(|err| err.to_string())
    }
}

use diagnostics::Diagnostic;
use export::SiteExport;
use loader::{Files, Site};

/// Loads and validates a site file or a standalone trip path.
pub fn load(files: &Files, path: &str) -> (Option<Site>, Vec<Diagnostic>) {
    let is_site = files
        .get(path)
        .is_some_and(|content| content.lines().any(|line| line.trim() == "kind: Site"));
    let (site, mut diagnostics) = if is_site {
        loader::load_site(files, path)
    } else {
        loader::load_standalone_trip(files, path)
    };
    if let Some(site) = &site {
        diagnostics.extend(validate::validate_site(site));
    }
    (site, diagnostics)
}

/// Loads, validates and exports for the web in one go.
pub fn export(files: &Files, path: &str) -> Result<SiteExport, Vec<Diagnostic>> {
    let (site, diagnostics) = load(files, path);
    match site {
        Some(site) if !diagnostics::has_errors(&diagnostics) => {
            Ok(export::export_site(&site, diagnostics))
        }
        _ => Err(diagnostics),
    }
}
