//! MOTIS 2 / Transitous `/plan` API query builder and response parser.

use serde::Deserialize;
use taac_plugin_api::{
    Attribution, Capability, GeoPoint, LegPlace, PLUGIN_API_VERSION, PlanRouteRequest,
    PlanRouteResponse, PluginInfo, RouteLeg, RouteMode, RouteOption,
};

pub const DEFAULT_BASE_URL: &str = "https://api.transitous.org/api";
pub const DEFAULT_PLAN_PATH: &str = "/v1/plan";
pub const DEFAULT_HOST: &str = "api.transitous.org";
pub const DEFAULT_USER_AGENT: &str =
    "taac-transitous/0.1.0 (+https://github.com/trip-as-a-code/taac)";
pub const TRANSITOUS_SOURCES_URL: &str = "https://transitous.org/sources/";

pub fn attribution() -> Attribution {
    Attribution {
        name: "Transitous".to_owned(),
        url: TRANSITOUS_SOURCES_URL.to_owned(),
        notice: Some(
            "Routing powered by Transitous (MOTIS) using open transit feeds and OpenStreetMap data. Sources: https://transitous.org/sources/"
                .to_owned(),
        ),
    }
}

pub fn plugin_info() -> PluginInfo {
    PluginInfo {
        api_version: PLUGIN_API_VERSION.to_owned(),
        name: "transitous".to_owned(),
        version: env!("CARGO_PKG_VERSION").to_owned(),
        description:
            "Public transport and multimodal route provider backed by Transitous (MOTIS 2)"
                .to_owned(),
        capabilities: vec![Capability::RoutePlan, Capability::RouteVerify],
        default_hosts: vec![DEFAULT_HOST.to_owned()],
        attribution: Some(attribution()),
    }
}

/// Percent-encode a query parameter value according to RFC 3986 unreserved characters.
pub fn encode_query_component(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for byte in input.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b',' => {
                out.push(char::from(byte));
            }
            _ => {
                use std::fmt::Write as _;
                let _ = write!(out, "%{byte:02X}");
            }
        }
    }
    out
}

fn format_place(point: &GeoPoint) -> String {
    format!("{:.6},{:.6}", point.lat, point.lon)
}

/// Build the full MOTIS 2 `/plan` GET URL for a [`PlanRouteRequest`].
pub fn build_plan_url(base_url: &str, plan_path: &str, req: &PlanRouteRequest) -> String {
    let base = base_url.trim_end_matches('/');
    let path = if plan_path.starts_with('/') {
        plan_path.to_owned()
    } else {
        format!("/{plan_path}")
    };

    let mut params = vec![
        ("fromPlace".to_owned(), format_place(&req.from)),
        ("toPlace".to_owned(), format_place(&req.to)),
        ("time".to_owned(), req.time.clone()),
        ("arriveBy".to_owned(), req.arrive_by.to_string()),
        (
            "numItineraries".to_owned(),
            req.num_itineraries.clamp(1, 10).to_string(),
        ),
    ];

    if !req.modes.is_empty() {
        let mut transit_modes: Vec<&'static str> = Vec::new();
        let mut direct_modes: Vec<&'static str> = Vec::new();
        for mode in &req.modes {
            match mode {
                RouteMode::Train => transit_modes.extend([
                    "RAIL",
                    "HIGHSPEED_RAIL",
                    "LONG_DISTANCE",
                    "NIGHT_RAIL",
                    "REGIONAL_FAST_RAIL",
                    "REGIONAL_RAIL",
                    "SUBURBAN",
                    "SUBWAY",
                    "TRAM",
                ]),
                RouteMode::Bus => transit_modes.extend(["BUS", "COACH"]),
                RouteMode::Ferry => transit_modes.push("FERRY"),
                RouteMode::Flight => transit_modes.push("AIRPLANE"),
                RouteMode::Walk => direct_modes.push("WALK"),
                RouteMode::Ride => direct_modes.push("BIKE"),
                RouteMode::Transfer => direct_modes.push("CAR"),
            }
        }
        if !transit_modes.is_empty() {
            params.push(("transitModes".to_owned(), transit_modes.join(",")));
        }
        if !direct_modes.is_empty() {
            params.push(("directModes".to_owned(), direct_modes.join(",")));
        }
    }

    let query = params
        .into_iter()
        .map(|(k, v)| format!("{k}={}", encode_query_component(&v)))
        .collect::<Vec<_>>()
        .join("&");

    format!("{base}{path}?{query}")
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MotisPlanResponse {
    #[serde(default)]
    pub itineraries: Vec<MotisItinerary>,
    #[serde(default)]
    pub direct: Vec<MotisItinerary>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MotisItinerary {
    #[serde(default)]
    pub duration: Option<u64>,
    pub start_time: String,
    pub end_time: String,
    #[serde(default)]
    pub transfers: Option<u32>,
    #[serde(default)]
    pub legs: Vec<MotisLeg>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MotisLeg {
    pub mode: String,
    pub from: MotisPlace,
    pub to: MotisPlace,
    pub start_time: String,
    pub end_time: String,
    #[serde(default)]
    pub duration: Option<u64>,
    #[serde(default)]
    pub agency_name: Option<String>,
    #[serde(default)]
    pub route_short_name: Option<String>,
    #[serde(default)]
    pub trip_short_name: Option<String>,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub headsign: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MotisPlace {
    #[serde(default)]
    pub name: Option<String>,
    pub lat: f64,
    pub lon: f64,
}

/// Map a MOTIS leg mode string to a `(RouteMode, place_category, vehicle)`.
pub fn map_mode(mode: &str) -> (RouteMode, Option<&'static str>, Option<&'static str>) {
    match mode.to_ascii_uppercase().as_str() {
        "RAIL" | "HIGHSPEED_RAIL" | "LONG_DISTANCE" | "NIGHT_RAIL" | "REGIONAL_FAST_RAIL"
        | "REGIONAL_RAIL" | "SUBURBAN" | "SUBWAY" | "METRO" | "TRAM" | "MONORAIL" | "FUNICULAR"
        | "CABLE_CAR" | "GONDOLA" => (RouteMode::Train, Some("station"), None),
        "BUS" | "COACH" | "TROLLEYBUS" | "AREAL_LIFT" => (RouteMode::Bus, Some("stop"), None),
        "FERRY" => (RouteMode::Ferry, Some("port"), None),
        "AIRPLANE" => (RouteMode::Flight, Some("airport"), None),
        "WALK" | "FOOT" => (RouteMode::Walk, None, None),
        "BIKE" | "BICYCLE" | "RENTAL" => (RouteMode::Ride, None, Some("bicycle")),
        "SCOOTER" => (RouteMode::Ride, None, Some("scooter")),
        _ => (RouteMode::Transfer, None, None),
    }
}

fn non_empty(s: Option<String>) -> Option<String> {
    s.map(|v| v.trim().to_owned()).filter(|v| !v.is_empty())
}

fn convert_place(place: &MotisPlace, fallback_name: &str, category: Option<&str>) -> LegPlace {
    let name = place
        .name
        .as_deref()
        .map(str::trim)
        .filter(|s| {
            !s.is_empty() && !s.eq_ignore_ascii_case("START") && !s.eq_ignore_ascii_case("END")
        })
        .unwrap_or(fallback_name)
        .to_owned();
    LegPlace {
        name,
        lat: place.lat,
        lon: place.lon,
        category: category.map(str::to_owned),
    }
}

pub fn convert_itinerary(
    it: &MotisItinerary,
    origin_name: Option<&str>,
    dest_name: Option<&str>,
) -> RouteOption {
    let leg_count = it.legs.len();
    let legs = it
        .legs
        .iter()
        .enumerate()
        .map(|(idx, leg)| {
            let (kind, category, vehicle) = map_mode(&leg.mode);
            let from_fallback = if idx == 0 {
                origin_name.unwrap_or("Origin")
            } else {
                "Stop"
            };
            let to_fallback = if idx + 1 == leg_count {
                dest_name.unwrap_or("Destination")
            } else {
                "Stop"
            };
            let number = non_empty(leg.display_name.clone())
                .or_else(|| non_empty(leg.route_short_name.clone()))
                .or_else(|| non_empty(leg.trip_short_name.clone()));
            RouteLeg {
                kind,
                from: convert_place(&leg.from, from_fallback, category),
                to: convert_place(&leg.to, to_fallback, category),
                start: leg.start_time.clone(),
                end: leg.end_time.clone(),
                duration_secs: leg.duration.unwrap_or(0),
                carrier: non_empty(leg.agency_name.clone()),
                number,
                headsign: non_empty(leg.headsign.clone()),
                vehicle: vehicle.map(str::to_owned),
            }
        })
        .collect::<Vec<_>>();

    let duration_secs = it
        .duration
        .unwrap_or_else(|| legs.iter().map(|l| l.duration_secs).sum());
    let transfers = it.transfers.unwrap_or_else(|| {
        let transit_legs = legs
            .iter()
            .filter(|l| !matches!(l.kind, RouteMode::Walk | RouteMode::Ride))
            .count();
        u32::try_from(transit_legs.saturating_sub(1)).unwrap_or(0)
    });

    RouteOption {
        start: it.start_time.clone(),
        end: it.end_time.clone(),
        duration_secs,
        transfers,
        legs,
    }
}

pub fn parse_plan_response(
    body: &str,
    req: &PlanRouteRequest,
) -> Result<PlanRouteResponse, serde_json::Error> {
    let raw: MotisPlanResponse = serde_json::from_str(body)?;
    let prefer_direct = !req.modes.is_empty()
        && req
            .modes
            .iter()
            .all(|m| matches!(m, RouteMode::Walk | RouteMode::Ride | RouteMode::Transfer));

    let source = if prefer_direct && !raw.direct.is_empty() {
        &raw.direct
    } else if !raw.itineraries.is_empty() {
        &raw.itineraries
    } else {
        &raw.direct
    };

    let itineraries = source
        .iter()
        .take(usize::try_from(req.num_itineraries.max(1)).unwrap_or(3))
        .map(|it| convert_itinerary(it, req.from.name.as_deref(), req.to.name.as_deref()))
        .collect();

    Ok(PlanRouteResponse {
        itineraries,
        attribution: Some(attribution()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_encoded_plan_url() {
        let req = PlanRouteRequest {
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
            time: "2026-11-30T09:00:00+01:00".into(),
            arrive_by: false,
            modes: vec![RouteMode::Train, RouteMode::Walk],
            num_itineraries: 3,
        };
        let url = build_plan_url(DEFAULT_BASE_URL, DEFAULT_PLAN_PATH, &req);
        assert!(url.starts_with("https://api.transitous.org/api/v1/plan?"));
        assert!(url.contains("fromPlace=38.705800,-9.144500"));
        assert!(url.contains("toPlace=38.697500,-9.203200"));
        assert!(url.contains("time=2026-11-30T09%3A00%3A00%2B01%3A00"));
        assert!(url.contains("transitModes=RAIL"));
        assert!(url.contains("directModes=WALK"));
    }

    #[test]
    fn parses_motis_itinerary_into_route_option() {
        let json = r#"{
            "itineraries": [
                {
                    "duration": 900,
                    "startTime": "2026-11-30T09:05:00Z",
                    "endTime": "2026-11-30T09:20:00Z",
                    "transfers": 0,
                    "legs": [
                        {
                            "mode": "REGIONAL_RAIL",
                            "from": { "name": "Cais do Sodré", "lat": 38.7058, "lon": -9.1445 },
                            "to": { "name": "Belém", "lat": 38.6975, "lon": -9.2032 },
                            "startTime": "2026-11-30T09:05:00Z",
                            "endTime": "2026-11-30T09:12:00Z",
                            "duration": 420,
                            "agencyName": "CP - Comboios de Portugal",
                            "routeShortName": "U",
                            "displayName": "U 19001",
                            "headsign": "Cascais"
                        },
                        {
                            "mode": "WALK",
                            "from": { "name": "Belém", "lat": 38.6975, "lon": -9.2032 },
                            "to": { "name": "END", "lat": 38.6979, "lon": -9.2067 },
                            "startTime": "2026-11-30T09:12:00Z",
                            "endTime": "2026-11-30T09:20:00Z",
                            "duration": 480
                        }
                    ]
                }
            ],
            "direct": []
        }"#;
        let req = PlanRouteRequest {
            from: GeoPoint {
                lat: 38.7058,
                lon: -9.1445,
                name: Some("Cais do Sodré".into()),
            },
            to: GeoPoint {
                lat: 38.6979,
                lon: -9.2067,
                name: Some("Pastéis de Belém".into()),
            },
            time: "2026-11-30T09:00:00Z".into(),
            arrive_by: false,
            modes: vec![],
            num_itineraries: 3,
        };
        let resp = parse_plan_response(json, &req).unwrap();
        assert_eq!(resp.itineraries.len(), 1);
        let opt = &resp.itineraries[0];
        assert_eq!(opt.duration_secs, 900);
        assert_eq!(opt.legs.len(), 2);
        assert_eq!(opt.legs[0].kind, RouteMode::Train);
        assert_eq!(opt.legs[0].from.category.as_deref(), Some("station"));
        assert_eq!(
            opt.legs[0].carrier.as_deref(),
            Some("CP - Comboios de Portugal")
        );
        assert_eq!(opt.legs[0].number.as_deref(), Some("U 19001"));
        assert_eq!(opt.legs[1].kind, RouteMode::Walk);
        assert_eq!(opt.legs[1].to.name, "Pastéis de Belém");
    }
}
