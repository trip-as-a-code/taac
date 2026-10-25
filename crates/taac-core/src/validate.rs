//! Semantic checks the schema cannot express: references, time, money.

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, FixedOffset};
use rust_decimal::Decimal;

use crate::diagnostics::Diagnostic;
use crate::loader::{Site, Trip};
use crate::model::{ItemKind, PlaceRef, Split};

pub fn validate_site(site: &Site) -> Vec<Diagnostic> {
    let mut out = Vec::new();
    let mut slugs = HashSet::new();
    for trip in &site.trips {
        if !slugs.insert(trip.slug.as_str()) {
            out.push(Diagnostic::error(
                "trip.slug",
                format!("two trips share the slug `{}`", trip.slug),
            ));
        }
        out.extend(validate_trip(trip));
    }
    out
}

pub fn validate_trip(trip: &Trip) -> Vec<Diagnostic> {
    let mut v = Validator {
        trip,
        out: Vec::new(),
    };
    v.metadata();
    v.people();
    v.places();
    v.items();
    v.overlaps();
    v.packing();
    v.out
}

/// `(item, is_lodging, start, end)`
type Span<'a> = (&'a str, bool, DateTime<FixedOffset>, DateTime<FixedOffset>);

struct Validator<'a> {
    trip: &'a Trip,
    out: Vec<Diagnostic>,
}

impl Validator<'_> {
    fn error(&mut self, code: &'static str, item: Option<&str>, message: String) {
        self.push(Diagnostic::error(code, message), item);
    }

    fn warn(&mut self, code: &'static str, item: Option<&str>, message: String) {
        self.push(Diagnostic::warning(code, message), item);
    }

    fn push(&mut self, diagnostic: Diagnostic, item: Option<&str>) {
        let mut diagnostic = diagnostic.in_trip(&self.trip.slug);
        if let Some(item) = item {
            diagnostic = diagnostic.at_item(item);
        }
        self.out.push(diagnostic);
    }

    fn metadata(&mut self) {
        let tz = &self.trip.metadata.timezone;
        if tz.parse::<chrono_tz::Tz>().is_err() {
            self.error("timezone", None, format!("unknown IANA time zone `{tz}`"));
        }
        if let Some(currency) = &self.trip.currency {
            for (code, rate) in &currency.rates {
                if *rate <= Decimal::ZERO {
                    self.error(
                        "currency.rate",
                        None,
                        format!("rate for {code} must be > 0"),
                    );
                }
            }
        }
    }

    fn people(&mut self) {
        let mut seen = HashSet::new();
        for member in &self.trip.members {
            if !seen.insert(member.id.as_str()) {
                self.error(
                    "member.duplicate",
                    None,
                    format!("member `{}` declared twice", member.id),
                );
            }
        }
        if self.trip.members.is_empty() {
            self.error(
                "member.none",
                None,
                "a trip needs at least one member".into(),
            );
        }
        let mut groups = HashSet::new();
        for group in &self.trip.groups {
            if !groups.insert(group.id.as_str()) {
                self.error(
                    "group.duplicate",
                    None,
                    format!("group `{}` declared twice", group.id),
                );
            }
            if seen.contains(group.id.as_str()) {
                self.error(
                    "group.id",
                    None,
                    format!("group `{}` clashes with a member id", group.id),
                );
            }
            for member in &group.members {
                if self.trip.member(member).is_none() {
                    self.error(
                        "group.member",
                        None,
                        format!("group `{}` lists unknown member `{member}`", group.id),
                    );
                }
            }
        }
    }

    fn places(&mut self) {
        for (key, place) in &self.trip.places {
            self.geo(key, place.geo, None);
        }
    }

    fn geo(&mut self, name: &str, [lat, lon]: [f64; 2], item: Option<&str>) {
        if !(-90.0..=90.0).contains(&lat) || !(-180.0..=180.0).contains(&lon) {
            self.error(
                "place.geo",
                item,
                format!("`{name}` has coordinates out of range: [{lat}, {lon}]"),
            );
        }
    }

    fn items(&mut self) {
        let trip = self.trip;
        let mut ids = HashSet::new();
        for item in &trip.itinerary {
            let id = Some(item.id.as_str());
            if !ids.insert(item.id.as_str()) {
                self.error(
                    "item.duplicate",
                    id,
                    format!("item id `{}` used twice", item.id),
                );
            }
            if let Some(end) = item.end {
                if end < item.start {
                    self.error("item.time", id, "ends before it starts".into());
                }
            } else if matches!(item.kind, ItemKind::Lodging) || item.kind.is_transport() {
                self.error(
                    "item.end",
                    id,
                    format!("{} items need an `end`", item.kind.as_str()),
                );
            }
            for place in &item.places {
                match place {
                    PlaceRef::Key(key) if !trip.places.contains_key(key) => {
                        self.error("item.place", id, format!("unknown place `{key}`"));
                    }
                    PlaceRef::Inline(p) => self.geo(&p.name, p.geo, id),
                    PlaceRef::Key(_) => {}
                }
            }
            if item.kind.is_transport() && item.places.len() < 2 {
                self.warn(
                    "item.route",
                    id,
                    "transport items should list origin and destination".into(),
                );
            }
            if item.members.is_some() && item.group.is_some() {
                self.error(
                    "item.participants",
                    id,
                    "set `members` or `group`, not both".into(),
                );
            }
            for member in item.members.iter().flatten() {
                if trip.member(member).is_none() {
                    self.error("item.member", id, format!("unknown member `{member}`"));
                }
            }
            if let Some(group) = item.group.as_deref().filter(|g| trip.group(g).is_none()) {
                self.error("item.group", id, format!("unknown group `{group}`"));
            }
            if item
                .booking
                .as_ref()
                .and_then(|b| b.deadline)
                .is_some_and(|deadline| deadline > item.start.date_naive())
            {
                self.warn(
                    "booking.deadline",
                    id,
                    "booking deadline is after the item starts".into(),
                );
            }
            if item.notes.as_deref().is_some_and(|n| n.contains("${")) {
                self.error(
                    "secret.inline",
                    id,
                    "`${...}` in notes is published as-is; move confidential values to `booking.reference` or `contacts`".into(),
                );
            }
            self.costs(item);
        }
    }

    fn costs(&mut self, item: &crate::model::Item) {
        let trip = self.trip;
        let id = Some(item.id.as_str());
        let participants = trip.participants(item);
        for cost in &item.costs {
            if cost.amount < Decimal::ZERO {
                self.error("cost.amount", id, "negative amount".into());
            }
            match &trip.currency {
                None => self.error(
                    "cost.currency",
                    id,
                    "costs need a trip-level `currency`".into(),
                ),
                Some(c) if c.to_base(Decimal::ONE, &cost.currency).is_none() => self.error(
                    "cost.currency",
                    id,
                    format!("no rate from {} to {}", cost.currency, c.base),
                ),
                Some(_) => {}
            }
            if trip.member(&cost.paid_by).is_none() {
                self.error(
                    "cost.paidBy",
                    id,
                    format!("unknown payer `{}`", cost.paid_by),
                );
            }
            match &cost.split {
                Split::Equal if !participants.contains(&cost.paid_by.as_str()) => self.warn(
                    "cost.payer",
                    id,
                    format!("`{}` pays but does not take part", cost.paid_by),
                ),
                Split::Shares(map) | Split::Exact(map) => {
                    for member in map.keys() {
                        if trip.member(member).is_none() {
                            self.error(
                                "cost.split",
                                id,
                                format!("split names unknown member `{member}`"),
                            );
                        }
                    }
                    if let Split::Exact(map) = &cost.split {
                        let sum: Decimal = map.values().sum();
                        if sum != cost.amount {
                            self.error(
                                "cost.split",
                                id,
                                format!("exact split sums to {sum}, cost is {}", cost.amount),
                            );
                        }
                    }
                    if matches!(&cost.split, Split::Shares(map) if map.values().sum::<Decimal>() <= Decimal::ZERO)
                    {
                        self.error("cost.split", id, "shares must sum to more than zero".into());
                    }
                }
                Split::Equal | Split::Personal => {}
            }
        }
    }

    /// Two timed commitments for the same person at once. Lodging only
    /// clashes with lodging; notes never clash.
    fn overlaps(&mut self) {
        let trip = self.trip;
        let mut by_member: HashMap<&str, Vec<Span<'_>>> = HashMap::new();
        for item in &trip.itinerary {
            let Some(end) = item.end else { continue };
            if item.kind == ItemKind::Note {
                continue;
            }
            for member in trip.participants(item) {
                by_member.entry(member).or_default().push((
                    item.id.as_str(),
                    item.kind == ItemKind::Lodging,
                    item.start,
                    end,
                ));
            }
        }
        let mut overlaps: indexmap::IndexMap<(&str, &str), Vec<&str>> = indexmap::IndexMap::new();
        let mut members: Vec<_> = by_member.into_iter().collect();
        members.sort_by_key(|(m, _)| *m);
        for (member, mut spans) in members {
            spans.sort_by_key(|s| s.2);
            for (i, a) in spans.iter().enumerate() {
                for b in &spans[i + 1..] {
                    if b.2 >= a.3 {
                        break;
                    }
                    if a.1 == b.1 {
                        overlaps.entry((a.0, b.0)).or_default().push(member);
                    }
                }
            }
        }
        for ((a, b), who) in overlaps {
            self.warn(
                "item.overlap",
                Some(b),
                format!("overlaps `{a}` for {}", who.join(", ")),
            );
        }
    }

    fn packing(&mut self) {
        for category in &self.trip.packing {
            for item in &category.items {
                for member in item.for_members() {
                    if self.trip.member(member).is_none() {
                        self.error(
                            "packing.member",
                            None,
                            format!("`{}` is for unknown member `{member}`", item.name()),
                        );
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::loader::{Files, load_standalone_trip};

    use super::*;

    fn check(itinerary: &str) -> Vec<Diagnostic> {
        let trip = format!(
            r"
apiVersion: taac/v1alpha1
kind: Trip
metadata: {{ title: T, timezone: Asia/Tokyo }}
currency: {{ base: EUR, rates: {{ JPY: 0.006 }} }}
members: [{{ id: a, name: A }}, {{ id: b, name: B }}]
groups: [{{ id: duo, name: Duo, members: [a, b] }}]
itinerary:
{itinerary}"
        );
        let files: Files = [("trip.yaml".to_owned(), trip)].into();
        let (site, diagnostics) = load_standalone_trip(&files, "trip.yaml");
        assert!(diagnostics.is_empty(), "{diagnostics:?}");
        validate_site(&site.unwrap())
    }

    fn codes(d: &[Diagnostic]) -> Vec<&str> {
        d.iter().map(|d| d.code).collect()
    }

    #[test]
    fn clean_trip_has_no_diagnostics() {
        let d = check(
            "  - { id: x, kind: activity, title: X, start: 2027-01-01T10:00:00+09:00, end: 2027-01-01T11:00:00+09:00, group: duo,
        costs: [{ amount: 1000, currency: JPY, paidBy: a }] }",
        );
        assert!(d.is_empty(), "{d:?}");
    }

    #[test]
    fn flags_references_time_and_money() {
        let d = check(
            "  - { id: x, kind: activity, title: X, start: 2027-01-01T10:00:00+09:00, end: 2027-01-01T09:00:00+09:00, places: [nowhere], members: [zed],
        costs: [{ amount: 5, currency: USD, paidBy: a, split: { exact: { a: 1 } } }] }",
        );
        let codes = codes(&d);
        for code in [
            "item.time",
            "item.place",
            "item.member",
            "cost.currency",
            "cost.split",
        ] {
            assert!(codes.contains(&code), "{code} missing in {codes:?}");
        }
    }

    #[test]
    fn overlaps_respect_participants() {
        let d = check(
            "  - { id: x, kind: activity, title: X, start: 2027-01-01T10:00:00+09:00, end: 2027-01-01T12:00:00+09:00, members: [a] }
  - { id: y, kind: activity, title: Y, start: 2027-01-01T11:00:00+09:00, end: 2027-01-01T13:00:00+09:00, members: [b] }
  - { id: z, kind: activity, title: Z, start: 2027-01-01T11:30:00+09:00, end: 2027-01-01T12:30:00+09:00, members: [a] }",
        );
        assert_eq!(codes(&d), ["item.overlap"]);
        assert_eq!(d[0].item.as_deref(), Some("z"));
    }
}
