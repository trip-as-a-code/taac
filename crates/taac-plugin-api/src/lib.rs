//! Shared JSON protocol between the `taac` CLI host and Extism Wasm plugins.
//!
//! This crate intentionally stays lightweight and `wasm32-unknown-unknown`
//! compatible so both the native host (`taac-plugins`) and Rust plugins
//! (`plugins/*`) can share exact wire types.

use serde::{Deserialize, Serialize};

/// Current plugin protocol version.
pub const PLUGIN_API_VERSION: &str = "taac-plugin/v1";

/// Extism export name for plugin discovery.
pub const FN_PLUGIN_INFO: &str = "taac_plugin_info";
/// Extism export name for route planning.
pub const FN_ROUTE_PLAN: &str = "taac_route_plan";
/// Extism export name for route verification.
pub const FN_ROUTE_VERIFY: &str = "taac_route_verify";

/// Capabilities a plugin can advertise.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize, Serialize)]
pub enum Capability {
    #[serde(rename = "route.plan")]
    RoutePlan,
    #[serde(rename = "route.verify")]
    RouteVerify,
}

/// Attribution notice required by an upstream data or routing provider.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attribution {
    pub name: String,
    pub url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notice: Option<String>,
}

/// Metadata returned by `taac_plugin_info`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
    pub api_version: String,
    pub name: String,
    pub version: String,
    pub description: String,
    #[serde(default)]
    pub capabilities: Vec<Capability>,
    /// Default hostnames the plugin needs to contact when no custom `baseUrl` is configured.
    #[serde(default)]
    pub default_hosts: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attribution: Option<Attribution>,
}

/// A geographic point with an optional human-readable name.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeoPoint {
    pub lat: f64,
    pub lon: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

/// Journey mode aligned with `taac` `ItemKind` journey variants.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RouteMode {
    Flight,
    Train,
    Bus,
    Ferry,
    Transfer,
    Walk,
    Ride,
}

impl RouteMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Flight => "flight",
            Self::Train => "train",
            Self::Bus => "bus",
            Self::Ferry => "ferry",
            Self::Transfer => "transfer",
            Self::Walk => "walk",
            Self::Ride => "ride",
        }
    }
}

/// Request payload for `taac_route_plan`.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanRouteRequest {
    pub from: GeoPoint,
    pub to: GeoPoint,
    /// RFC 3339 timestamp with offset (departure time, or arrival time if `arrive_by` is true).
    pub time: String,
    #[serde(default)]
    pub arrive_by: bool,
    /// Optional filter of allowed modes; empty means provider default (all transit + walk).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub modes: Vec<RouteMode>,
    /// Maximum number of itinerary options to return.
    #[serde(default = "default_num_itineraries")]
    pub num_itineraries: u32,
}

fn default_num_itineraries() -> u32 {
    3
}

/// Response payload from `taac_route_plan`.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanRouteResponse {
    #[serde(default)]
    pub itineraries: Vec<RouteOption>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attribution: Option<Attribution>,
}

/// One end-to-end itinerary option made of one or more legs.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteOption {
    /// RFC 3339 start timestamp.
    pub start: String,
    /// RFC 3339 end timestamp.
    pub end: String,
    pub duration_secs: u64,
    #[serde(default)]
    pub transfers: u32,
    #[serde(default)]
    pub legs: Vec<RouteLeg>,
}

/// Endpoint of a route leg.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LegPlace {
    pub name: String,
    pub lat: f64,
    pub lon: f64,
    /// Optional `taac` place category (`station`, `stop`, `port`, `airport`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
}

/// One segment of a [`RouteOption`].
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteLeg {
    pub kind: RouteMode,
    pub from: LegPlace,
    pub to: LegPlace,
    /// RFC 3339 departure timestamp.
    pub start: String,
    /// RFC 3339 arrival timestamp.
    pub end: String,
    pub duration_secs: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub carrier: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub number: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub headsign: Option<String>,
    /// For `ride` legs: `"bicycle"` or `"scooter"`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vehicle: Option<String>,
}

/// Request payload for `taac_route_verify`.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyRouteRequest {
    pub from: GeoPoint,
    pub to: GeoPoint,
    /// Declared RFC 3339 departure timestamp.
    pub start: String,
    /// Declared RFC 3339 arrival timestamp.
    pub end: String,
    pub kind: RouteMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub carrier: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub number: Option<String>,
    /// Acceptable departure/arrival shift in minutes before emitting a warning.
    #[serde(default = "default_time_tolerance_mins")]
    pub time_tolerance_mins: u32,
    /// Acceptable duration difference percentage before emitting a warning.
    #[serde(default = "default_duration_tolerance_pct")]
    pub duration_tolerance_pct: u32,
}

fn default_time_tolerance_mins() -> u32 {
    15
}

fn default_duration_tolerance_pct() -> u32 {
    50
}

/// Overall verification outcome for a single trip leg.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum VerifyStatus {
    /// Route matches timetable/routing expectations.
    Verified,
    /// Route exists, but with minor discrepancies (timing, duration, or carrier/number).
    Warning,
    /// Declared route does not match any available service.
    Mismatch,
    /// Requested date appears to be outside the provider's timetable horizon.
    OutOfCoverage,
    /// No route was found between the origin and destination.
    NotFound,
}

/// Severity of an individual verification finding.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum IssueSeverity {
    Info,
    Warning,
    Error,
}

/// A single verification finding returned by a plugin.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyIssue {
    pub code: String,
    pub severity: IssueSeverity,
    pub message: String,
}

/// Response payload from `taac_route_verify`.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyRouteResponse {
    pub status: VerifyStatus,
    #[serde(default)]
    pub issues: Vec<VerifyIssue>,
    #[serde(default)]
    pub alternatives: Vec<RouteOption>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attribution: Option<Attribution>,
}
