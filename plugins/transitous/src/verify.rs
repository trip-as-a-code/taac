//! Pure route verification logic comparing a declared trip leg against Transitous results.

use taac_plugin_api::{
    IssueSeverity, RouteMode, RouteOption, VerifyIssue, VerifyRouteRequest, VerifyRouteResponse,
    VerifyStatus,
};

use crate::motis::{MotisPlanResponse, attribution, convert_itinerary};

/// Threshold beyond which an empty transit response is treated as outside GTFS horizon (90 days).
const COVERAGE_HORIZON_SECS: i64 = 90 * 24 * 3600;

/// Minimum absolute duration discrepancy in seconds before warning (avoids noisy short-leg alerts).
const MIN_DURATION_DIFF_SECS: u64 = 10 * 60;

/// Parse an RFC 3339 timestamp (`YYYY-MM-DDTHH:MM:SS(.frac)?(Z|[+-]HH:MM)`) into Unix seconds.
pub fn parse_rfc3339_unix(input: &str) -> Option<i64> {
    let s = input.trim();
    if s.len() < 20 {
        return None;
    }
    let year: i64 = s.get(0..4)?.parse().ok()?;
    if s.as_bytes().get(4) != Some(&b'-') {
        return None;
    }
    let month: i64 = s.get(5..7)?.parse().ok()?;
    if s.as_bytes().get(7) != Some(&b'-') {
        return None;
    }
    let day: i64 = s.get(8..10)?.parse().ok()?;
    let sep = *s.as_bytes().get(10)?;
    if sep != b'T' && sep != b't' && sep != b' ' {
        return None;
    }
    let hour: i64 = s.get(11..13)?.parse().ok()?;
    if s.as_bytes().get(13) != Some(&b':') {
        return None;
    }
    let minute: i64 = s.get(14..16)?.parse().ok()?;
    if s.as_bytes().get(16) != Some(&b':') {
        return None;
    }
    let second: i64 = s.get(17..19)?.parse().ok()?;

    let mut rest = s.get(19..)?;
    if let Some(after_dot) = rest.strip_prefix('.') {
        let digits = after_dot.bytes().take_while(u8::is_ascii_digit).count();
        rest = after_dot.get(digits..)?;
    }

    let offset_secs: i64 = if rest == "Z" || rest == "z" {
        0
    } else if rest.len() == 6 {
        let sign: i64 = match rest.as_bytes()[0] {
            b'+' => 1,
            b'-' => -1,
            _ => return None,
        };
        let oh: i64 = rest.get(1..3)?.parse().ok()?;
        if rest.as_bytes()[3] != b':' {
            return None;
        }
        let om: i64 = rest.get(4..6)?.parse().ok()?;
        sign * (oh * 3600 + om * 60)
    } else {
        return None;
    };

    let days = days_from_civil(year, month, day)?;
    let local_secs = days * 86_400 + hour * 3600 + minute * 60 + second;
    Some(local_secs - offset_secs)
}

/// Howard Hinnant's civil-from-days inverse: days since 1970-01-01.
fn days_from_civil(year: i64, month: i64, day: i64) -> Option<i64> {
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let y = year - i64::from(month <= 2);
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let m_adj = if month > 2 { month - 3 } else { month + 9 };
    let doy = (153 * m_adj + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some(era * 146_097 + doe - 719_468)
}

fn normalize_token(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn carrier_matches(declared: &str, option: &RouteOption) -> bool {
    let want = normalize_token(declared);
    if want.is_empty() {
        return true;
    }
    option.legs.iter().any(|leg| {
        leg.carrier.as_deref().is_some_and(|c| {
            let got = normalize_token(c);
            !got.is_empty() && (got.contains(&want) || want.contains(&got))
        })
    })
}

fn number_matches(declared: &str, option: &RouteOption) -> bool {
    let want = normalize_token(declared);
    if want.is_empty() {
        return true;
    }
    option.legs.iter().any(|leg| {
        leg.number.as_deref().is_some_and(|n| {
            let got = normalize_token(n);
            !got.is_empty() && (got == want || got.contains(&want) || want.contains(&got))
        })
    })
}

fn mode_matches(declared: RouteMode, option: &RouteOption) -> bool {
    option.legs.iter().any(|l| l.kind == declared)
}

fn is_direct_mode(mode: RouteMode) -> bool {
    matches!(
        mode,
        RouteMode::Walk | RouteMode::Ride | RouteMode::Transfer
    )
}

/// Evaluate a MOTIS `/plan` response against a declared [`VerifyRouteRequest`].
pub fn verify_against_response(
    raw: &MotisPlanResponse,
    req: &VerifyRouteRequest,
    now_unix: Option<i64>,
) -> VerifyRouteResponse {
    let declared_start = parse_rfc3339_unix(&req.start);
    let declared_end = parse_rfc3339_unix(&req.end);
    let declared_duration_secs = match (declared_start, declared_end) {
        (Some(s), Some(e)) if e >= s => u64::try_from(e - s).unwrap_or(0),
        _ => 0,
    };

    let prefer_direct = is_direct_mode(req.kind);
    let candidates: Vec<RouteOption> = if prefer_direct {
        raw.direct
            .iter()
            .chain(raw.itineraries.iter())
            .map(|it| convert_itinerary(it, req.from.name.as_deref(), req.to.name.as_deref()))
            .collect()
    } else {
        raw.itineraries
            .iter()
            .map(|it| convert_itinerary(it, req.from.name.as_deref(), req.to.name.as_deref()))
            .collect()
    };

    if candidates.is_empty() {
        let far_future = match (declared_start, now_unix) {
            (Some(s), Some(now)) => s - now > COVERAGE_HORIZON_SECS,
            _ => false,
        };
        if far_future && !prefer_direct {
            return VerifyRouteResponse {
                status: VerifyStatus::OutOfCoverage,
                issues: vec![VerifyIssue {
                    code: "route.out_of_coverage".to_owned(),
                    severity: IssueSeverity::Info,
                    message: format!(
                        "no Transitous timetable data found for {} (date is more than 90 days ahead and likely outside current GTFS feeds)",
                        req.start
                    ),
                }],
                alternatives: Vec::new(),
                attribution: Some(attribution()),
            };
        }
        return VerifyRouteResponse {
            status: VerifyStatus::NotFound,
            issues: vec![VerifyIssue {
                code: "route.not_found".to_owned(),
                severity: IssueSeverity::Warning,
                message: format!(
                    "Transitous found no {} route between {} and {} around {}",
                    req.kind.as_str(),
                    req.from.name.as_deref().unwrap_or("origin"),
                    req.to.name.as_deref().unwrap_or("destination"),
                    req.start
                ),
            }],
            alternatives: Vec::new(),
            attribution: Some(attribution()),
        };
    }

    // Score candidates: lower score is a closer match.
    let best_idx = candidates
        .iter()
        .enumerate()
        .min_by_key(|(_, opt)| score_option(opt, req, declared_start, declared_duration_secs))
        .map_or(0, |(idx, _)| idx);

    let best = &candidates[best_idx];
    let mut issues = Vec::new();
    let mut schedule_mismatch = false;
    let mut service_mismatch = false;

    // 1. Duration comparison.
    if declared_duration_secs > 0 && best.duration_secs > 0 {
        let diff = declared_duration_secs.abs_diff(best.duration_secs);
        let pct_diff = diff.saturating_mul(100) / best.duration_secs.max(1);
        let threshold = u64::from(req.duration_tolerance_pct.max(1));
        if diff >= MIN_DURATION_DIFF_SECS && pct_diff > threshold {
            let declared_mins = declared_duration_secs / 60;
            let actual_mins = best.duration_secs / 60;
            issues.push(VerifyIssue {
                code: "route.duration_mismatch".to_owned(),
                severity: IssueSeverity::Warning,
                message: format!(
                    "declared duration is {declared_mins} min, but Transitous estimates {actual_mins} min"
                ),
            });
        }
    }

    // 2. Schedule alignment (for scheduled transit modes).
    if !prefer_direct
        && let (Some(decl_s), Some(best_s)) = (declared_start, parse_rfc3339_unix(&best.start))
    {
        let shift_mins = decl_s.abs_diff(best_s) / 60;
        if shift_mins > u64::from(req.time_tolerance_mins) {
            schedule_mismatch = true;
            issues.push(VerifyIssue {
                code: "route.schedule_mismatch".to_owned(),
                severity: IssueSeverity::Warning,
                message: format!(
                    "closest Transitous departure is at {} ({shift_mins} min from declared {})",
                    best.start, req.start
                ),
            });
        }
    }

    // 3. Carrier matching.
    if let Some(carrier) = req.carrier.as_deref().filter(|s| !s.trim().is_empty())
        && !carrier_matches(carrier, best)
    {
        service_mismatch = true;
        let found: Vec<&str> = best
            .legs
            .iter()
            .filter_map(|l| l.carrier.as_deref())
            .collect();
        let detail = if found.is_empty() {
            "none reported".to_owned()
        } else {
            found.join(", ")
        };
        issues.push(VerifyIssue {
            code: "route.carrier_mismatch".to_owned(),
            severity: IssueSeverity::Warning,
            message: format!(
                "declared carrier `{carrier}` does not match Transitous result ({detail})"
            ),
        });
    }

    // 4. Route/train/bus number matching.
    if let Some(number) = req.number.as_deref().filter(|s| !s.trim().is_empty())
        && !number_matches(number, best)
    {
        service_mismatch = true;
        let found: Vec<&str> = best
            .legs
            .iter()
            .filter_map(|l| l.number.as_deref())
            .collect();
        let detail = if found.is_empty() {
            "none reported".to_owned()
        } else {
            found.join(", ")
        };
        issues.push(VerifyIssue {
            code: "route.number_mismatch".to_owned(),
            severity: IssueSeverity::Warning,
            message: format!(
                "declared service number `{number}` does not match Transitous result ({detail})"
            ),
        });
    }

    let status = if issues.is_empty() {
        VerifyStatus::Verified
    } else if schedule_mismatch && service_mismatch {
        VerifyStatus::Mismatch
    } else {
        VerifyStatus::Warning
    };

    let alternatives = if status == VerifyStatus::Verified {
        Vec::new()
    } else {
        candidates.into_iter().take(3).collect()
    };

    VerifyRouteResponse {
        status,
        issues,
        alternatives,
        attribution: Some(attribution()),
    }
}

fn score_option(
    opt: &RouteOption,
    req: &VerifyRouteRequest,
    declared_start: Option<i64>,
    declared_duration_secs: u64,
) -> (u8, u8, u8, u64, u64) {
    let number_penalty = u8::from(
        req.number
            .as_deref()
            .is_some_and(|n| !n.trim().is_empty() && !number_matches(n, opt)),
    );
    let carrier_penalty = u8::from(
        req.carrier
            .as_deref()
            .is_some_and(|c| !c.trim().is_empty() && !carrier_matches(c, opt)),
    );
    let mode_penalty = u8::from(!mode_matches(req.kind, opt));
    let start_diff = match (declared_start, parse_rfc3339_unix(&opt.start)) {
        (Some(d), Some(o)) => d.abs_diff(o),
        _ => u64::MAX / 2,
    };
    let duration_diff = declared_duration_secs.abs_diff(opt.duration_secs);
    (
        mode_penalty,
        number_penalty,
        carrier_penalty,
        start_diff,
        duration_diff,
    )
}

#[cfg(test)]
mod tests {
    use taac_plugin_api::GeoPoint;

    use super::*;
    use crate::motis::{MotisItinerary, MotisLeg, MotisPlace};

    fn sample_req() -> VerifyRouteRequest {
        VerifyRouteRequest {
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
            start: "2026-11-30T09:05:00Z".into(),
            end: "2026-11-30T09:15:00Z".into(),
            kind: RouteMode::Train,
            carrier: Some("CP".into()),
            number: Some("U 19001".into()),
            time_tolerance_mins: 15,
            duration_tolerance_pct: 50,
        }
    }

    fn sample_response(
        start: &str,
        end: &str,
        duration: u64,
        carrier: &str,
        number: &str,
    ) -> MotisPlanResponse {
        MotisPlanResponse {
            itineraries: vec![MotisItinerary {
                duration: Some(duration),
                start_time: start.into(),
                end_time: end.into(),
                transfers: Some(0),
                legs: vec![MotisLeg {
                    mode: "REGIONAL_RAIL".into(),
                    from: MotisPlace {
                        name: Some("Cais do Sodré".into()),
                        lat: 38.7058,
                        lon: -9.1445,
                    },
                    to: MotisPlace {
                        name: Some("Belém".into()),
                        lat: 38.6975,
                        lon: -9.2032,
                    },
                    start_time: start.into(),
                    end_time: end.into(),
                    duration: Some(duration),
                    agency_name: Some(carrier.into()),
                    route_short_name: Some("U".into()),
                    trip_short_name: None,
                    display_name: Some(number.into()),
                    headsign: Some("Cascais".into()),
                }],
            }],
            direct: vec![],
        }
    }

    #[test]
    fn parses_rfc3339_timestamps_with_offsets() {
        let z = parse_rfc3339_unix("2026-11-30T09:00:00Z").unwrap();
        let plus_one = parse_rfc3339_unix("2026-11-30T10:00:00+01:00").unwrap();
        assert_eq!(z, plus_one);
    }

    #[test]
    fn verifies_exact_match() {
        let req = sample_req();
        let resp = sample_response(
            "2026-11-30T09:05:00Z",
            "2026-11-30T09:15:00Z",
            600,
            "CP - Comboios de Portugal",
            "U19001",
        );
        let result = verify_against_response(&resp, &req, None);
        assert_eq!(result.status, VerifyStatus::Verified);
        assert_eq!(result.issues.len(), 0);
        assert_eq!(result.alternatives.len(), 0);
    }

    #[test]
    fn detects_schedule_and_number_mismatch_with_alternatives() {
        let req = sample_req();
        let resp = sample_response(
            "2026-11-30T10:30:00Z",
            "2026-11-30T10:40:00Z",
            600,
            "Carris",
            "728",
        );
        let result = verify_against_response(&resp, &req, None);
        assert_eq!(result.status, VerifyStatus::Mismatch);
        assert!(
            result
                .issues
                .iter()
                .any(|i| i.code == "route.schedule_mismatch")
        );
        assert!(
            result
                .issues
                .iter()
                .any(|i| i.code == "route.carrier_mismatch")
        );
        assert!(
            result
                .issues
                .iter()
                .any(|i| i.code == "route.number_mismatch")
        );
        assert_eq!(result.alternatives.len(), 1);
    }

    #[test]
    fn detects_duration_mismatch() {
        let mut req = sample_req();
        req.end = "2026-11-30T10:35:00Z".into(); // 90 min declared vs 10 min actual
        let resp = sample_response(
            "2026-11-30T09:05:00Z",
            "2026-11-30T09:15:00Z",
            600,
            "CP - Comboios de Portugal",
            "U 19001",
        );
        let result = verify_against_response(&resp, &req, None);
        assert_eq!(result.status, VerifyStatus::Warning);
        assert!(
            result
                .issues
                .iter()
                .any(|i| i.code == "route.duration_mismatch")
        );
    }

    #[test]
    fn handles_far_future_dates_as_out_of_coverage() {
        let mut req = sample_req();
        req.start = "2027-06-15T09:05:00Z".into();
        req.end = "2027-06-15T09:15:00Z".into();
        let empty = MotisPlanResponse {
            itineraries: vec![],
            direct: vec![],
        };
        let now = parse_rfc3339_unix("2026-11-28T12:00:00Z").unwrap();
        let result = verify_against_response(&empty, &req, Some(now));
        assert_eq!(result.status, VerifyStatus::OutOfCoverage);
        assert_eq!(result.issues[0].code, "route.out_of_coverage");
    }
}
