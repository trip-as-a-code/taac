//! Native Extism WebAssembly plugin host for `taac-cli`.
//!
//! Keeps `taac-core` and `taac-wasm` completely offline while letting the CLI
//! load sandboxed route-provider plugins with caching, rate limiting, and
//! upstream attribution support.

pub mod cache;
pub mod host;
pub mod verify;
pub mod yaml;

pub use host::{PluginLoadOptions, RoutePlugin};
pub use verify::{CheckSummary, check_site};
