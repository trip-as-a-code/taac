//! Render plugin route results as copy-pasteable `taac/v1alpha4` YAML snippets.

use std::fmt::Write as _;

use indexmap::IndexMap;
use taac_core::model::Place;
use taac_plugin_api::{LegPlace, RouteLeg, RouteOption};

/// Render a [`RouteOption`] as `places:` (for places not yet declared) + `itinerary:` YAML.
pub fn render_route_option_yaml(
    option: &RouteOption,
    who: &[String],
    existing_places: &IndexMap<String, Place>,
) -> String {
    let mut new_places: IndexMap<String, &LegPlace> = IndexMap::new();
    for leg in &option.legs {
        for place in [&leg.from, &leg.to] {
            let exists = existing_places
                .keys()
                .any(|k| k.eq_ignore_ascii_case(&place.name));
            if !exists {
                new_places
                    .entry(place.name.clone())
                    .and_modify(|existing| {
                        if existing.category.is_none() && place.category.is_some() {
                            *existing = place;
                        }
                    })
                    .or_insert(place);
            }
        }
    }

    let mut out = String::new();
    if !new_places.is_empty() {
        out.push_str("places:\n");
        for (name, place) in &new_places {
            let _ = write!(
                out,
                "  {}: {{ geo: [{:.6}, {:.6}]",
                yaml_scalar(name),
                place.lat,
                place.lon
            );
            if let Some(cat) = place.category.as_deref() {
                let _ = write!(out, ", category: {cat}");
            }
            out.push_str(" }\n");
        }
        out.push('\n');
    }

    out.push_str("itinerary:\n");
    for leg in &option.legs {
        write_leg_yaml(&mut out, leg, who, "  ");
    }
    out
}

/// Render a compact `itinerary:` snippet suitable for a diagnostic `fix`.
pub fn render_alternative_fix_yaml(option: &RouteOption, who: &[String]) -> String {
    let mut out = String::new();
    for leg in &option.legs {
        write_leg_yaml(&mut out, leg, who, "");
    }
    out.trim_end().to_owned()
}

fn write_leg_yaml(out: &mut String, leg: &RouteLeg, who: &[String], indent: &str) {
    let title = format!("{} → {}", leg.from.name, leg.to.name);
    let _ = writeln!(out, "{indent}- kind: {}", leg.kind.as_str());
    let _ = writeln!(out, "{indent}  title: {}", yaml_scalar(&title));
    if !who.is_empty() {
        let who_list = who
            .iter()
            .map(|w| yaml_scalar(w))
            .collect::<Vec<_>>()
            .join(", ");
        let _ = writeln!(out, "{indent}  who: [{who_list}]");
    }
    let _ = writeln!(out, "{indent}  start: {}", leg.start);
    let _ = writeln!(out, "{indent}  end: {}", leg.end);
    let _ = writeln!(
        out,
        "{indent}  places: [{}, {}]",
        yaml_scalar(&leg.from.name),
        yaml_scalar(&leg.to.name)
    );

    let mut transport_parts = Vec::new();
    if let Some(carrier) = leg.carrier.as_deref() {
        transport_parts.push(format!("carrier: {}", yaml_scalar(carrier)));
    }
    if let Some(number) = leg.number.as_deref() {
        transport_parts.push(format!("number: {}", yaml_scalar(number)));
    }
    if let Some(vehicle) = leg.vehicle.as_deref() {
        transport_parts.push(format!("vehicle: {vehicle}"));
    }
    if !transport_parts.is_empty() {
        let _ = writeln!(
            out,
            "{indent}  transport: {{ {} }}",
            transport_parts.join(", ")
        );
    }
}

fn yaml_scalar(value: &str) -> String {
    let needs_quote = value.is_empty()
        || value.starts_with([
            ' ', '-', '?', ':', '#', '&', '*', '!', '|', '>', '\'', '"', '%', '@', '`', '[', ']',
            '{', '}',
        ])
        || value.ends_with(' ')
        || value.contains(": ")
        || value.contains(" #")
        || value.contains(['\n', '\r', ',', '[', ']', '{', '}']);
    if !needs_quote {
        return value.to_owned();
    }
    let escaped = value.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"{escaped}\"")
}

#[cfg(test)]
mod tests {
    use taac_plugin_api::RouteMode;

    use super::*;

    #[test]
    fn renders_valid_taac_yaml_snippet() {
        let opt = RouteOption {
            start: "2026-11-30T09:05:00Z".into(),
            end: "2026-11-30T09:12:00Z".into(),
            duration_secs: 420,
            transfers: 0,
            legs: vec![RouteLeg {
                kind: RouteMode::Train,
                from: LegPlace {
                    name: "Cais do Sodré".into(),
                    lat: 38.7058,
                    lon: -9.1445,
                    category: Some("station".into()),
                },
                to: LegPlace {
                    name: "Belém".into(),
                    lat: 38.6975,
                    lon: -9.2032,
                    category: Some("station".into()),
                },
                start: "2026-11-30T09:05:00Z".into(),
                end: "2026-11-30T09:12:00Z".into(),
                duration_secs: 420,
                carrier: Some("CP".into()),
                number: Some("U 19001".into()),
                headsign: Some("Cascais".into()),
                vehicle: None,
            }],
        };
        let yaml = render_route_option_yaml(&opt, &["everyone".into()], &IndexMap::new());
        assert!(yaml.contains("places:"));
        assert!(yaml.contains("Cais do Sodré: { geo: [38.705800, -9.144500], category: station }"));
        assert!(yaml.contains("- kind: train"));
        assert!(yaml.contains("transport: { carrier: CP, number: U 19001 }"));
    }
}
