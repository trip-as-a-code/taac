//! Verify trip journey legs against a loaded [`RoutePlugin`].

use anyhow::Result;
use taac_core::diagnostics::Diagnostic;
use taac_core::loader::Site;
use taac_core::model::ItemKind;
use taac_plugin_api::{
    Attribution, GeoPoint, IssueSeverity, RouteMode, VerifyRouteRequest, VerifyStatus,
};

use crate::host::RoutePlugin;
use crate::yaml::render_alternative_fix_yaml;

/// Summary of an online route verification run.
#[derive(Debug, Default)]
pub struct CheckSummary {
    pub diagnostics: Vec<Diagnostic>,
    pub checked: usize,
    pub verified: usize,
    pub warnings: usize,
    pub mismatches: usize,
    pub out_of_coverage: usize,
    pub live_requests: usize,
    pub cache_hits: usize,
    pub attribution: Option<Attribution>,
}

/// Convert a `taac-core` [`ItemKind`] into a plugin [`RouteMode`], skipping
/// non-journey items and flights (which Transitous public transit feeds do not cover).
pub fn item_kind_to_route_mode(kind: ItemKind) -> Option<RouteMode> {
    match kind {
        ItemKind::Train => Some(RouteMode::Train),
        ItemKind::Bus => Some(RouteMode::Bus),
        ItemKind::Ferry => Some(RouteMode::Ferry),
        ItemKind::Transfer => Some(RouteMode::Transfer),
        ItemKind::Walk => Some(RouteMode::Walk),
        ItemKind::Ride => Some(RouteMode::Ride),
        ItemKind::Flight
        | ItemKind::Lodging
        | ItemKind::Activity
        | ItemKind::Meal
        | ItemKind::Note
        | ItemKind::Free => None,
    }
}

/// Verify all eligible journey legs in `site` (optionally filtered to one trip slug and/or day).
pub fn check_site(
    site: &Site,
    plugin: &mut RoutePlugin,
    trip_filter: Option<&str>,
    day_filter: Option<jiff::civil::Date>,
) -> Result<CheckSummary> {
    let mut summary = CheckSummary {
        attribution: plugin.info().attribution.clone(),
        ..CheckSummary::default()
    };

    for trip in &site.trips {
        if let Some(slug) = trip_filter
            && trip.slug != slug
        {
            continue;
        }

        for item in &trip.itinerary {
            if let Some(day) = day_filter
                && item.day() != day
            {
                continue;
            }
            let Some(kind) = item_kind_to_route_mode(item.kind) else {
                continue;
            };
            let (Some(start), Some(end)) = (item.start, item.end) else {
                continue;
            };
            let places = trip.item_places(item);
            if places.len() < 2 {
                continue;
            }
            let (_, from_place) = &places[0];
            let (_, to_place) = &places[places.len() - 1];

            let req = VerifyRouteRequest {
                from: GeoPoint {
                    lat: from_place.geo[0],
                    lon: from_place.geo[1],
                    name: Some(from_place.name.clone()),
                },
                to: GeoPoint {
                    lat: to_place.geo[0],
                    lon: to_place.geo[1],
                    name: Some(to_place.name.clone()),
                },
                start: start.to_string(),
                end: end.to_string(),
                kind,
                carrier: item.transport.as_ref().and_then(|t| t.carrier.clone()),
                number: item.transport.as_ref().and_then(|t| t.number.clone()),
                time_tolerance_mins: 15,
                duration_tolerance_pct: 50,
            };

            let resp = plugin.verify_route(&req)?;
            summary.checked += 1;
            if let Some(attr) = resp.attribution {
                summary.attribution = Some(attr);
            }

            match resp.status {
                VerifyStatus::Verified => summary.verified += 1,
                VerifyStatus::Warning | VerifyStatus::NotFound => summary.warnings += 1,
                VerifyStatus::Mismatch => summary.mismatches += 1,
                VerifyStatus::OutOfCoverage => summary.out_of_coverage += 1,
            }

            let who = item
                .who
                .clone()
                .unwrap_or_else(|| vec!["everyone".to_owned()]);
            let fix_snippet = resp
                .alternatives
                .first()
                .map(|alt| render_alternative_fix_yaml(alt, &who));

            for (idx, issue) in resp.issues.iter().enumerate() {
                let code = static_issue_code(&issue.code);
                let mut diag = match issue.severity {
                    IssueSeverity::Error => Diagnostic::error(code, issue.message.clone()),
                    IssueSeverity::Warning | IssueSeverity::Info => {
                        Diagnostic::warning(code, issue.message.clone())
                    }
                }
                .in_trip(&trip.slug)
                .at_item(&item.title);
                if let Some(src) = &item.source {
                    diag = diag.in_file(format!("{}:{}", src.file, src.line));
                }
                if idx == 0 {
                    diag.fix.clone_from(&fix_snippet);
                }
                summary.diagnostics.push(diag);
            }
        }
    }

    summary.live_requests = plugin.live_requests();
    summary.cache_hits = plugin.cache_hits();
    Ok(summary)
}

fn static_issue_code(code: &str) -> &'static str {
    match code {
        "route.not_found" => "route.not_found",
        "route.duration_mismatch" => "route.duration_mismatch",
        "route.schedule_mismatch" => "route.schedule_mismatch",
        "route.carrier_mismatch" => "route.carrier_mismatch",
        "route.number_mismatch" => "route.number_mismatch",
        "route.out_of_coverage" => "route.out_of_coverage",
        _ => "route.verify",
    }
}
