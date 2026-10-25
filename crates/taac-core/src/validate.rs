//! Semantic checks the schema cannot express: references, time, money.

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, FixedOffset, NaiveDate};
use rust_decimal::Decimal;

use crate::diagnostics::Diagnostic;
use crate::loader::{Site, Trip};
use crate::model::{BookingStatus, ItemKind, PlaceRef, Split};

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
    v.bases();
    v.ideas();
    v.blockers();
    v.overlaps();
    v.nights();
    v.flaws();
    v.packing();
    v.out
}

/// A night `member` would sleep in both lodgings.
fn shared_night(
    trip: &Trip,
    bases: &[crate::loader::ResolvedBase],
    a: &crate::model::Item,
    b: &crate::model::Item,
    member: &str,
) -> bool {
    let (Some((start, end)), Some(_)) = (a.span(), b.span()) else {
        return false;
    };
    let mut night = start.date_naive();
    while night < end.date_naive() {
        if trip.sleeps_at(bases, a, member, night) && trip.sleeps_at(bases, b, member, night) {
            return true;
        }
        night = night.succ_opt().unwrap_or(end.date_naive());
    }
    false
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
            let fixed = matches!(item.kind, ItemKind::Lodging) || item.kind.is_transport();
            match (item.start, item.date) {
                (Some(_), Some(_)) => {
                    self.error("item.when", id, "set `start` or `date`, not both".into());
                }
                (None, None) => self.error("item.when", id, "needs a `start` or a `date`".into()),
                (None, Some(_)) if fixed => self.error(
                    "item.when",
                    id,
                    format!(
                        "{} items need an exact `start` and `end`",
                        item.kind.as_str()
                    ),
                ),
                (None, Some(_)) if item.end.is_some() => {
                    self.error("item.when", id, "`end` needs a `start`".into());
                }
                _ => {}
            }
            if item.part.is_some() && item.start.is_some() {
                self.error("item.when", id, "`part` is for `date`-only items".into());
            }
            if let (Some(start), Some(end)) = (item.start, item.end) {
                if end < start {
                    self.error("item.time", id, "ends before it starts".into());
                }
            } else if item.start.is_some() && fixed {
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
            self.who(&item.id, item.who.as_deref());
            if item
                .booking
                .as_ref()
                .and_then(|b| b.deadline)
                .is_some_and(|deadline| deadline > item.day())
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
            self.costs(
                &item.id,
                &item.costs,
                &trip.participants(item),
                crate::budget::is_committed(item),
            );
        }
    }

    fn who(&mut self, id: &str, who: Option<&[String]>) {
        let trip = self.trip;
        let Some(who) = who else { return };
        if who.is_empty() {
            self.error(
                "who.empty",
                Some(id),
                "`who` lists nobody; omit it for everyone".into(),
            );
        }
        for entry in who {
            if trip.member(entry).is_none() && trip.group(entry).is_none() {
                self.error(
                    "who.unknown",
                    Some(id),
                    format!("`{entry}` is neither a member nor a group"),
                );
            }
        }
        for group in who.iter().filter_map(|w| trip.group(w)) {
            for member in group.members.iter().filter(|m| who.contains(m)) {
                self.warn(
                    "who.redundant",
                    Some(id),
                    format!("`{member}` is already in group `{}`", group.id),
                );
            }
        }
    }

    fn bases(&mut self) {
        let trip = self.trip;
        let mut ids = HashSet::new();
        for base in &trip.declared_bases {
            let id = Some(base.id.as_str());
            if !ids.insert(base.id.as_str()) {
                self.error(
                    "base.duplicate",
                    id,
                    format!("base id `{}` used twice", base.id),
                );
            }
            if !trip.places.contains_key(&base.place) {
                self.error("base.place", id, format!("unknown place `{}`", base.place));
            }
            if base.to < base.from {
                self.error("base.dates", id, "`to` is before `from`".into());
            }
            self.who(&base.id, base.who.as_deref());
        }
        let bases = trip.bases();
        for (i, a) in bases.iter().enumerate() {
            for b in &bases[i + 1..] {
                if a.derived || b.from > a.to || a.from > b.to {
                    continue;
                }
                let shared: Vec<&str> = a
                    .members
                    .iter()
                    .filter(|m| b.members.contains(m))
                    .map(String::as_str)
                    .collect();
                if !shared.is_empty() {
                    self.error(
                        "base.overlap",
                        Some(&b.id),
                        format!("overlaps base `{}` for {}", a.id, shared.join(", ")),
                    );
                }
            }
        }
    }

    fn ideas(&mut self) {
        let trip = self.trip;
        let items: HashSet<&str> = trip.itinerary.iter().map(|i| i.id.as_str()).collect();
        let mut ids = HashSet::new();
        for idea in &trip.ideas {
            let id = Some(idea.id.as_str());
            if !ids.insert(idea.id.as_str()) || items.contains(idea.id.as_str()) {
                self.error("idea.duplicate", id, format!("id `{}` used twice", idea.id));
            }
            if let Some(area) = idea
                .area
                .as_deref()
                .filter(|a| !trip.places.contains_key(*a))
            {
                self.error("idea.area", id, format!("unknown place `{area}`"));
            }
            for place in &idea.places {
                match place {
                    PlaceRef::Key(key) if !trip.places.contains_key(key) => {
                        self.error("idea.place", id, format!("unknown place `{key}`"));
                    }
                    PlaceRef::Inline(p) => self.geo(&p.name, p.geo, id),
                    PlaceRef::Key(_) => {}
                }
            }
            self.who(&idea.id, idea.who.as_deref());
            let participants = trip.who(idea.who.as_deref());
            self.costs(&idea.id, &idea.costs, &participants, false);
        }
    }

    fn blockers(&mut self) {
        let trip = self.trip;
        let mut ids = HashSet::new();
        for blocker in &trip.blockers {
            let id = Some(blocker.id.as_str());
            if !ids.insert(blocker.id.as_str()) {
                self.error(
                    "blocker.duplicate",
                    id,
                    format!("blocker id `{}` used twice", blocker.id),
                );
            }
            self.who(&blocker.id, blocker.who.as_deref());
            if blocker.periods.is_empty() {
                self.error("blocker.periods", id, "needs at least one period".into());
            }
            for period in blocker.periods.iter().filter(|p| p.to < p.from) {
                self.error(
                    "blocker.periods",
                    id,
                    format!(
                        "period ends ({}) before it starts ({})",
                        period.to, period.from
                    ),
                );
            }
            if let Some(time) = &blocker.time {
                for value in [&time.start, &time.end] {
                    if crate::blockers::parse_time(value).is_none() {
                        self.error("blocker.time", id, format!("`{value}` is not HH:MM"));
                    }
                }
                if let Some(tz) = time
                    .timezone
                    .as_deref()
                    .filter(|tz| tz.parse::<chrono_tz::Tz>().is_err())
                {
                    self.error(
                        "blocker.timezone",
                        id,
                        format!("unknown IANA time zone `{tz}`"),
                    );
                }
            }
        }
        for item in &trip.itinerary {
            for name in item.overrides.iter().filter(|o| !ids.contains(o.as_str())) {
                self.error(
                    "item.overrides",
                    Some(&item.id),
                    format!("unknown blocker `{name}`"),
                );
            }
        }
        for conflict in crate::blockers::conflicts(trip)
            .into_iter()
            .filter(|c| !c.overridden)
        {
            let message = format!(
                "happens during `{}` for {} — move it, or add `overrides: [{}]` if it can coexist",
                conflict.blocker.id,
                conflict.members.join(", "),
                conflict.blocker.id
            );
            if conflict.blocker.strict {
                self.error("blocker.conflict", Some(&conflict.item.id), message);
            } else {
                self.warn("blocker.conflict", Some(&conflict.item.id), message);
            }
        }
    }

    /// With declared bases, every night of someone's trip should be accounted
    /// for: a base, a bed, or an overnight journey.
    /// Plans that are valid but probably wrong: someone who is not there,
    /// nobody chosen when the group splits up, bookings with loose ends.
    fn flaws(&mut self) {
        let trip = self.trip;
        let bases = trip.bases();
        // Each member's time on the trip, from the bases and journeys that
        // name them; a plan for everyone says nothing about who is there.
        let mut presence: HashMap<&str, (NaiveDate, NaiveDate)> = HashMap::new();
        let mut extend = |member: &str, from: NaiveDate, to: NaiveDate| {
            let Some(member) = trip.member(member) else {
                return;
            };
            let span = presence.entry(member.id.as_str()).or_insert((from, to));
            span.0 = span.0.min(from);
            span.1 = span.1.max(to);
        };
        for base in &bases {
            for member in &base.members {
                extend(member, base.from, base.to.succ_opt().unwrap_or(base.to));
            }
        }
        for item in trip.itinerary.iter().filter(|i| i.who.is_some()) {
            if item.kind.is_transport() || item.kind == ItemKind::Lodging {
                let end = item.span().map_or(item.day(), |(_, end)| end.date_naive());
                for member in trip.participants(item) {
                    extend(member, item.day(), end);
                }
            }
        }
        let referenced: HashSet<&str> = trip
            .itinerary
            .iter()
            .filter(|i| !i.costs.is_empty())
            .filter_map(|i| i.booking.as_ref()?.reference.as_ref())
            .map(|r| r.secret.as_str())
            .collect();

        for item in &trip.itinerary {
            let id = Some(item.id.as_str());
            let day = item.day();
            let end = item.span().map_or(day, |(_, end)| end.date_naive());
            let absent: Vec<&str> = trip
                .participants(item)
                .into_iter()
                .filter(|m| {
                    presence
                        .get(m)
                        .is_some_and(|(from, to)| end < *from || day > *to)
                })
                .collect();
            if !absent.is_empty() {
                let (code, hint) = if item.who.is_none() {
                    (
                        "item.unassigned",
                        "it is for everyone by default; set `who`",
                    )
                } else {
                    ("item.absent", "fix `who` or the dates")
                };
                let verb = if absent.len() == 1 { "is" } else { "are" };
                self.warn(
                    code,
                    id,
                    format!(
                        "{} {verb} not on the trip on {day}: {hint}",
                        absent.join(", ")
                    ),
                );
            } else if item.who.is_none() && item.kind != ItemKind::Note {
                let mut apart: Vec<&str> = bases
                    .iter()
                    .filter(|b| b.from <= day && day <= b.to)
                    .map(|b| b.place_id.as_str())
                    .collect();
                apart.sort_unstable();
                apart.dedup();
                if apart.len() > 1 {
                    let names: Vec<&str> = apart
                        .iter()
                        .map(|p| trip.places.get(*p).map_or(*p, |place| place.name.as_str()))
                        .collect();
                    self.warn(
                        "item.unassigned",
                        id,
                        format!(
                            "the group is split between {} on {day}, but this is for everyone: set `who`",
                            names.join(" and ")
                        ),
                    );
                }
            }
            if item.kind == ItemKind::Lodging && item.places.is_empty() {
                self.warn(
                    "item.unlocated",
                    id,
                    "a stay without a place: it is off the map and bases cannot follow it".into(),
                );
            }
            let Some(booking) = item
                .booking
                .as_ref()
                .filter(|b| b.status == BookingStatus::Booked)
            else {
                continue;
            };
            let confirmed = item.kind.is_transport() || item.kind == ItemKind::Lodging;
            if confirmed && booking.reference.is_none() {
                self.warn(
                    "booking.reference",
                    id,
                    "booked without a confirmation number (`booking.reference`)".into(),
                );
            }
            let shared = booking
                .reference
                .as_ref()
                .is_some_and(|r| referenced.contains(r.secret.as_str()));
            if item.costs.is_empty() && !shared && item.kind != ItemKind::Note {
                self.warn(
                    "booking.cost",
                    id,
                    "booked without a cost: add `costs`, or share a `booking.reference` with the item that has them".into(),
                );
            }
            if item.costs.iter().any(|c| c.estimate) {
                self.warn(
                    "cost.estimate",
                    id,
                    "booked, but a cost is still marked `estimate`".into(),
                );
            }
        }
    }

    fn nights(&mut self) {
        let trip = self.trip;
        if trip.declared_bases.is_empty() {
            return;
        }
        let bases = trip.bases();
        for member in &trip.members {
            let mine: Vec<_> = trip
                .itinerary
                .iter()
                .filter(|i| trip.participants(i).contains(&member.id.as_str()))
                .collect();
            let first = mine
                .iter()
                .map(|i| i.day())
                .chain(
                    bases
                        .iter()
                        .filter(|b| b.members.contains(&member.id))
                        .map(|b| b.from),
                )
                .min();
            let last = mine
                .iter()
                .map(|i| i.span().map_or(i.day(), |(_, end)| end.date_naive()))
                .chain(
                    bases
                        .iter()
                        .filter(|b| b.members.contains(&member.id))
                        .map(|b| b.to.succ_opt().unwrap_or(b.to)),
                )
                .max();
            let (Some(first), Some(last)) = (first, last) else {
                continue;
            };
            let mut missing = Vec::new();
            let mut night = first;
            while night < last {
                let covered = bases
                    .iter()
                    .any(|b| b.from <= night && night <= b.to && b.members.contains(&member.id))
                    || mine.iter().any(|i| {
                        i.span().is_some_and(|(start, end)| {
                            (i.kind == ItemKind::Lodging || i.kind.is_transport())
                                && start.date_naive() <= night
                                && night < end.date_naive()
                        })
                    });
                if !covered {
                    missing.push(night.to_string());
                }
                night = night.succ_opt().unwrap_or(last);
            }
            if !missing.is_empty() {
                self.warn(
                    "base.missing",
                    None,
                    format!(
                        "no base, lodging or overnight journey for {} on {}",
                        member.id,
                        missing.join(", ")
                    ),
                );
            }
        }
    }

    fn costs(
        &mut self,
        owner: &str,
        costs: &[crate::model::Cost],
        participants: &[&str],
        booked: bool,
    ) {
        let trip = self.trip;
        let id = Some(owner);
        for cost in costs {
            if cost.amount < Decimal::ZERO {
                self.error("cost.amount", id, "negative amount".into());
            }
            if trip.currency.is_none() {
                self.error(
                    "cost.currency",
                    id,
                    "costs need a trip-level `currency`".into(),
                );
            }
            let payers = cost.paid_by.ids();
            if !cost.paid_by.is_each() {
                self.who(owner, Some(&payers));
            }
            self.who(owner, cost.who.as_deref());
            // A booking is a fact: record what it actually cost the payer.
            let payer_currency = match payers.as_slice() {
                [one] => trip.member(one).and_then(|m| m.currency.clone()),
                _ => None,
            }
            .unwrap_or_else(|| trip.base_currency().to_owned());
            if booked && cost.charged.is_none() && cost.currency != payer_currency {
                self.error(
                    "cost.charged",
                    id,
                    format!(
                        "booked, priced in {} — add `charged:` with what was actually paid in {payer_currency}",
                        cost.currency
                    ),
                );
            }
            if let Some(charged) = cost.charged.as_ref().filter(|c| c.amount < Decimal::ZERO) {
                self.error(
                    "cost.charged",
                    id,
                    format!("negative charged amount {}", charged.amount),
                );
            }
            let beneficiaries = cost
                .who
                .as_deref()
                .map_or_else(|| participants.to_vec(), |w| trip.who(Some(w)));
            if let [payer] = payers.as_slice()
                && cost.split == Split::Equal
                && !beneficiaries.contains(&payer.as_str())
                && trip.member(payer).is_some()
            {
                self.warn(
                    "cost.payer",
                    id,
                    format!("`{payer}` pays but does not take part"),
                );
            }
            match &cost.split {
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
    /// clashes with lodging, and only on nights both are actually slept in.
    fn overlaps(&mut self) {
        let trip = self.trip;
        let bases = trip.bases();
        let mut by_member: HashMap<&str, Vec<(&crate::model::Item, Span<'_>)>> = HashMap::new();
        for item in &trip.itinerary {
            let Some((start, end)) = item.span() else {
                continue;
            };
            if item.kind == ItemKind::Note || item.end.is_none() {
                continue;
            }
            for member in trip.participants(item) {
                by_member.entry(member).or_default().push((
                    item,
                    (item.id.as_str(), item.kind == ItemKind::Lodging, start, end),
                ));
            }
        }
        let mut overlaps: indexmap::IndexMap<(&str, &str), Vec<&str>> = indexmap::IndexMap::new();
        let mut members: Vec<_> = by_member.into_iter().collect();
        members.sort_by_key(|(m, _)| *m);
        for (member, mut spans) in members {
            spans.sort_by_key(|(_, s)| s.2);
            for (i, (item_a, a)) in spans.iter().enumerate() {
                for (item_b, b) in &spans[i + 1..] {
                    if b.2 >= a.3 {
                        break;
                    }
                    if a.1 != b.1 {
                        continue;
                    }
                    if a.1 && !shared_night(trip, &bases, item_a, item_b, member) {
                        continue;
                    }
                    overlaps.entry((a.0, b.0)).or_default().push(member);
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
            for member in category.who.iter().flatten() {
                if self.trip.member(member).is_none() && self.trip.group(member).is_none() {
                    self.error(
                        "packing.member",
                        None,
                        format!("`{}` is for unknown `{member}`", category.category),
                    );
                }
            }
            for item in &category.items {
                let packers = self.trip.who(item.who().or(category.who.as_deref()));
                self.costs(item.name(), item.costs(), &packers, item.bought());
                for member in item.who().into_iter().flatten() {
                    if self.trip.member(member).is_none() && self.trip.group(member).is_none() {
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
        check_with("", itinerary)
    }

    fn check_with(extra: &str, itinerary: &str) -> Vec<Diagnostic> {
        let trip = format!(
            r"
apiVersion: taac/v1alpha3
kind: Trip
metadata: {{ title: T, timezone: Asia/Tokyo }}
currency: {{ base: EUR }}
members: [{{ id: a, name: A }}, {{ id: b, name: B }}]
groups: [{{ id: duo, name: Duo, members: [a, b] }}]
places:
  tokyo: {{ name: Tokyo, geo: [35.68, 139.76], radius: 25000 }}
  kyoto: {{ name: Kyoto, geo: [35.01, 135.77], radius: 12000 }}
  flat: {{ name: Flat, geo: [35.70, 139.80] }}
  ryokan: {{ name: Ryokan, geo: [35.00, 135.76] }}
{extra}
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
            "  - { id: x, kind: activity, title: X, start: 2027-01-01T10:00:00+09:00, end: 2027-01-01T11:00:00+09:00, who: [duo],
        costs: [{ amount: 1000, currency: JPY, paidBy: a }] }",
        );
        assert!(d.is_empty(), "{d:?}");
    }

    #[test]
    fn flags_references_time_and_money() {
        let d = check(
            "  - { id: x, kind: activity, title: X, start: 2027-01-01T10:00:00+09:00, end: 2027-01-01T09:00:00+09:00, places: [nowhere], who: [zed],
        booking: { status: booked }, costs: [{ amount: 5, currency: USD, paidBy: a, split: { exact: { a: 1 } } }] }",
        );
        let codes = codes(&d);
        for code in [
            "item.time",
            "item.place",
            "who.unknown",
            "cost.charged",
            "cost.split",
        ] {
            assert!(codes.contains(&code), "{code} missing in {codes:?}");
        }
    }

    #[test]
    fn overlaps_respect_participants() {
        let d = check(
            "  - { id: x, kind: activity, title: X, start: 2027-01-01T10:00:00+09:00, end: 2027-01-01T12:00:00+09:00, who: [a] }
  - { id: y, kind: activity, title: Y, start: 2027-01-01T11:00:00+09:00, end: 2027-01-01T13:00:00+09:00, who: [b] }
  - { id: z, kind: activity, title: Z, start: 2027-01-01T11:30:00+09:00, end: 2027-01-01T12:30:00+09:00, who: [a] }",
        );
        assert_eq!(codes(&d), ["item.overlap"]);
        assert_eq!(d[0].item.as_deref(), Some("z"));
    }

    #[test]
    fn loose_items_need_a_day_and_no_fixed_kinds() {
        let d = check(
            "  - { id: x, kind: activity, title: X, date: 2027-01-01, part: afternoon }
  - { id: y, kind: lodging, title: Y, date: 2027-01-01 }
  - { id: z, kind: activity, title: Z, date: 2027-01-01, start: 2027-01-01T10:00:00+09:00 }
  - { id: w, kind: activity, title: W }",
        );
        let items: Vec<_> = d
            .iter()
            .filter(|d| d.code == "item.when")
            .filter_map(|d| d.item.as_deref())
            .collect();
        let mut items = items;
        items.sort_unstable();
        assert_eq!(items, ["w", "y", "z"], "{d:?}");
    }

    #[test]
    fn bases_must_not_overlap_per_person() {
        let d = check_with(
            "bases:
  - { id: t, title: Tokyo, place: tokyo, from: 2027-01-01, to: 2027-01-03 }
  - { id: k, title: Kyoto, place: kyoto, from: 2027-01-03, to: 2027-01-04, who: [a] }
ideas:
  - { id: i, title: I, area: osaka }",
            "  - { id: x, kind: activity, title: X, date: 2027-01-01 }",
        );
        let codes = codes(&d);
        assert!(codes.contains(&"base.overlap"), "{codes:?}");
        assert!(codes.contains(&"idea.area"), "{codes:?}");
    }

    #[test]
    fn a_flat_kept_while_travelling_is_not_an_overlap() {
        let d = check_with(
            "bases:
  - { id: t1, title: Tokyo, place: tokyo, from: 2027-01-01, to: 2027-01-02 }
  - { id: k, title: Kyoto, place: kyoto, from: 2027-01-03, to: 2027-01-03 }
  - { id: t2, title: Tokyo, place: tokyo, from: 2027-01-04, to: 2027-01-05 }",
            "  - { id: flat, kind: lodging, title: Flat, start: 2027-01-01T15:00:00+09:00, end: 2027-01-06T10:00:00+09:00, places: [flat] }
  - { id: ryokan, kind: lodging, title: Ryokan, start: 2027-01-03T15:00:00+09:00, end: 2027-01-04T10:00:00+09:00, places: [ryokan] }",
        );
        assert!(d.is_empty(), "{d:?}");
    }

    #[test]
    fn nights_without_a_base_are_flagged() {
        let d = check_with(
            "bases:
  - { id: t, title: Tokyo, place: tokyo, from: 2027-01-01, to: 2027-01-01 }",
            "  - { id: x, kind: activity, title: X, date: 2027-01-03 }",
        );
        let missing: Vec<_> = d.iter().filter(|d| d.code == "base.missing").collect();
        assert_eq!(missing.len(), 2, "{d:?}");
        assert!(missing[0].message.contains("2027-01-02"));
    }

    #[test]
    fn plans_for_people_who_are_not_there() {
        let d = check_with(
            "bases:
  - { id: t, title: Tokyo, place: tokyo, from: 2027-01-01, to: 2027-01-03, who: [a] }
  - { id: k, title: Kyoto, place: kyoto, from: 2027-01-02, to: 2027-01-03, who: [b] }",
            "  - { id: early, kind: note, title: E, date: 2027-01-01 }
  - { id: split, kind: activity, title: S, date: 2027-01-02, places: [tokyo] }
  - { id: late, kind: activity, title: L, date: 2027-01-09, who: [a], places: [tokyo] }
  - { id: fine, kind: activity, title: F, date: 2027-01-02, who: [b], places: [kyoto] }",
        );
        let at = |item: &str| {
            d.iter()
                .filter(|x| x.item.as_deref() == Some(item))
                .map(|x| x.code)
                .collect::<Vec<_>>()
        };
        assert_eq!(at("early"), ["item.unassigned"], "{d:?}");
        assert!(
            d.iter()
                .any(|x| x.item.as_deref() == Some("early") && x.message.contains("b is not"))
        );
        assert_eq!(at("split"), ["item.unassigned"], "{d:?}");
        assert_eq!(at("late"), ["item.absent"], "{d:?}");
        assert!(at("fine").is_empty(), "{d:?}");
    }

    #[test]
    fn bookings_with_loose_ends() {
        let d = check(
            "  - { id: hotel, kind: lodging, title: H, start: 2027-01-01T15:00:00+09:00, end: 2027-01-02T10:00:00+09:00, booking: { status: booked } }
  - { id: out, kind: flight, title: O, start: 2027-01-01T08:00:00+09:00, end: 2027-01-01T09:00:00+09:00, places: [tokyo, kyoto],
      booking: { status: booked, reference: { secret: PNR } }, costs: [{ amount: 9, currency: EUR, paidBy: a, estimate: true }] }
  - { id: back, kind: flight, title: B, start: 2027-01-02T08:00:00+09:00, end: 2027-01-02T09:00:00+09:00, places: [kyoto, tokyo],
      booking: { status: booked, reference: { secret: PNR } } }",
        );
        let codes = codes(&d);
        for code in [
            "item.unlocated",
            "booking.reference",
            "booking.cost",
            "cost.estimate",
        ] {
            assert!(codes.contains(&code), "{code} missing in {codes:?}");
        }
        // The return shares the outbound's booking, which carries the cost.
        assert!(
            !d.iter().any(|x| x.item.as_deref() == Some("back")),
            "{d:?}"
        );
    }

    #[test]
    fn who_mixes_members_and_groups() {
        let d = check(
            "  - { id: x, kind: activity, title: X, date: 2027-01-01, who: [duo, a] }
  - { id: y, kind: activity, title: Y, date: 2027-01-01, who: [nobody] }
  - { id: z, kind: activity, title: Z, date: 2027-01-01, who: [] }",
        );
        assert_eq!(
            codes(&d),
            ["who.redundant", "who.unknown", "who.empty"],
            "{d:?}"
        );
    }

    #[test]
    fn blockers_flag_plans_in_their_window_unless_overridden() {
        // 09:00–17:00 Helsinki (+02:00) is 16:00–24:00 in Tokyo.
        let d = check_with(
            "blockers:
  - id: work
    title: Work
    who: [a]
    periods: [{ from: 2027-01-04, to: 2027-01-08 }]
    days: [mon, tue, wed, thu, fri]
    time: { start: '09:00', end: '17:00', timezone: Europe/Helsinki }",
            "  - { id: dinner, kind: meal, title: D, start: 2027-01-05T18:00:00+09:00, end: 2027-01-05T20:00:00+09:00 }
  - { id: lunch, kind: meal, title: L, start: 2027-01-05T12:00:00+09:00, end: 2027-01-05T13:00:00+09:00 }
  - { id: train, kind: train, title: T, start: 2027-01-06T17:00:00+09:00, end: 2027-01-06T19:00:00+09:00, places: [tokyo, kyoto], overrides: [work] }
  - { id: weekend, kind: meal, title: W, start: 2027-01-09T18:00:00+09:00, end: 2027-01-09T20:00:00+09:00 }
  - { id: other, kind: meal, title: O, start: 2027-01-05T18:00:00+09:00, end: 2027-01-05T19:00:00+09:00, who: [b] }",
        );
        let conflicts: Vec<_> = d
            .iter()
            .filter(|d| d.code == "blocker.conflict")
            .filter_map(|d| d.item.as_deref())
            .collect();
        assert_eq!(conflicts, ["dinner"], "{d:?}");
    }
}
