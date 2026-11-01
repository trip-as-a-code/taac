//! Semantic checks the schema cannot express: references, time, money.

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, FixedOffset, NaiveDate};
use rust_decimal::Decimal;

use crate::diagnostics::Diagnostic;
use crate::loader::{EVERYONE, Site, Trip, within};
use crate::model::{BookingStatus, Item, ItemKind, PlaceRef, Split};

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
        // Signing in with GitHub is how a member gets to their own trip.
        if site.access == crate::model::SiteAccess::Github {
            for member in trip.members.iter().filter(|m| m.github.is_none()) {
                out.push(
                    Diagnostic::warning(
                        "member.github",
                        format!(
                            "{} has no GitHub username, so they can't sign in: add `github:` (or a github.com link)",
                            member.name
                        ),
                    )
                    .in_trip(&trip.slug),
                );
            }
        }
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
    v.tasks();
    v.passes();
    v.overlaps();
    v.nights();
    v.routes();
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

/// How someone is left stranded.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Leg {
    /// From the plan (or night) before to this one.
    Next,
    /// From this plan back to the night's lodging.
    Return,
    /// Between the places of one plan that isn't a journey.
    Inside,
}

/// `(leg, other, item, from, to)`: `other` is the plan before (`Next`) or
/// the night's lodging (`Return`).
type Jump<'a> = (Leg, Option<&'a str>, &'a str, String, String);

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

    /// Adds the specifics and a pasteable fix to the diagnostic just pushed.
    fn detail(&mut self, params: &[(&'static str, String)], fix: Option<String>) {
        if let Some(last) = self.out.last_mut() {
            last.params.extend(params.iter().cloned());
            last.fix = fix;
        }
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
            if member.id == EVERYONE {
                self.error(
                    "member.id",
                    None,
                    "`everyone` is reserved for every member".into(),
                );
            }
            if !seen.insert(member.id.as_str()) {
                self.error(
                    "member.duplicate",
                    None,
                    format!("two members are called `{}`", member.name),
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
                    format!(
                        "two groups are called `{}`",
                        group.name.as_deref().unwrap_or(&group.id)
                    ),
                );
            }
            if group.id == EVERYONE {
                self.error(
                    "group.id",
                    None,
                    "`everyone` is reserved for every member".into(),
                );
            }
            if seen.contains(group.id.as_str()) {
                self.error(
                    "group.id",
                    None,
                    format!(
                        "group `{}` has the same name as a member",
                        group.name.as_deref().unwrap_or(&group.id)
                    ),
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
        let homes = self.trip.metadata.home.iter().map(|h| ("trip", h)).chain(
            self.trip
                .members
                .iter()
                .filter_map(|m| m.home.as_ref().map(|h| (m.id.as_str(), h))),
        );
        let unknown: Vec<_> = homes
            .filter(|(_, home)| !self.trip.places.contains_key(home.as_str()))
            .map(|(who, home)| format!("{who}: `{home}`"))
            .collect();
        for home in unknown {
            self.error(
                "home.place",
                None,
                format!("home is an unknown place: {home}"),
            );
        }
        for (key, place) in &self.trip.places {
            self.geo(key, place.geo, None);
            if let Some(photo) = &place.photo
                && (!photo.starts_with("https://") || photo.contains(char::is_whitespace))
            {
                self.error(
                    "place.photo",
                    None,
                    format!("`{key}` has a photo that isn't an https:// URL: {photo}"),
                );
            }
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
        for item in &trip.itinerary {
            let id = Some(item.id.as_str());
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
            if item.kind.is_journey() && item.places.len() < 2 {
                self.warn(
                    "item.route",
                    id,
                    "transport items should list origin and destination".into(),
                );
            }
            // A vehicle boards and leaves at a station, stop, port or
            // airport; getting there from a hotel or a temple is its own leg.
            if item.kind.is_transport() && item.kind != ItemKind::Transfer {
                let places = trip.item_places(item);
                for (end, place) in [("from", places.first()), ("to", places.last())] {
                    let Some((_, place)) = place else { continue };
                    // A whole area (`radius`) is a coarse plan, not a door.
                    if place.radius.is_none()
                        && !matches!(
                            place.category.as_deref(),
                            Some("station" | "stop" | "port" | "airport")
                        )
                    {
                        self.warn(
                            "route.station",
                            id,
                            format!(
                                "`{}` runs {end} {}, which isn't a station, stop, port or airport — walk (or ride, or take a taxi) between them as a leg of its own",
                                item.title, place.name
                            ),
                        );
                        self.detail(
                            &[("end", end.to_owned()), ("place", place.name.clone())],
                            None,
                        );
                    }
                }
            }
            self.who(&item.id, item.who.as_deref());
            self.title_names(&item.id, &item.title);
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
            let everyone = trip.participants(item);
            for part in item.parts() {
                if let Some(who) = part.who {
                    self.who(&item.id, Some(who));
                    let outside: Vec<&str> = trip
                        .who(Some(who))
                        .into_iter()
                        .filter(|m| !everyone.contains(m))
                        .collect();
                    if !outside.is_empty() {
                        self.warn(
                            "booking.who",
                            id,
                            format!(
                                "a reservation covers {}, who are not on the plan",
                                outside.join(", ")
                            ),
                        );
                    }
                }
                let people = part
                    .who
                    .map_or_else(|| everyone.clone(), |w| trip.who(Some(w)));
                let booked = part
                    .booking
                    .as_ref()
                    .is_some_and(|b| b.status == BookingStatus::Booked);
                self.costs(&item.id, part.costs, &people, &everyone, booked);
            }
        }
    }

    /// A member's name in a title repeats `who`, which every card already shows.
    fn title_names(&mut self, id: &str, title: &str) {
        let words: Vec<String> = title
            .split(|c: char| !c.is_alphanumeric())
            .filter(|w| !w.is_empty())
            .map(str::to_lowercase)
            .collect();
        let named: Vec<&str> = self
            .trip
            .members
            .iter()
            .filter(|m| words.contains(&m.name.to_lowercase()))
            .map(|m| m.name.as_str())
            .collect();
        if !named.is_empty() {
            self.warn(
                "title.who",
                Some(id),
                format!(
                    "the title names {}: `who` already shows who it's for, so drop it from the title",
                    named.join(", ")
                ),
            );
            self.detail(&[("who", named.join(", "))], None);
        }
    }

    fn who(&mut self, id: &str, who: Option<&[String]>) {
        let trip = self.trip;
        let Some(who) = who else { return };
        if who.is_empty() {
            self.error(
                "who.empty",
                Some(id),
                "`who` lists nobody; use `everyone` for everyone".into(),
            );
        }
        for entry in who.iter().filter(|w| *w != EVERYONE) {
            if trip.member(entry).is_none() && trip.group(entry).is_none() {
                self.error(
                    "who.unknown",
                    Some(id),
                    format!("`{entry}` is neither a member nor a group"),
                );
            }
        }
        if who.len() > 1 && who.iter().any(|w| w == EVERYONE) {
            self.warn(
                "who.redundant",
                Some(id),
                "`everyone` already includes the rest".into(),
            );
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
        for base in &trip.declared_bases {
            let id = Some(base.id.as_str());
            match trip.places.get(&base.place) {
                None => self.error("base.place", id, format!("unknown place `{}`", base.place)),
                Some(place) => self.area(id, place),
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
        for idea in &trip.ideas {
            let id = Some(idea.id.as_str());
            if let Some(area) = idea.area.as_deref() {
                match trip.places.get(area) {
                    None => self.error("idea.area", id, format!("unknown place `{area}`")),
                    Some(place) => self.area(id, place),
                }
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
            // A proposal's timing is optional, but must make sense if given.
            match (idea.start, idea.date) {
                (Some(_), Some(_)) => {
                    self.error("idea.when", id, "set `start` or `date`, not both".into());
                }
                (None, _) if idea.end.is_some() => {
                    self.error("idea.when", id, "`end` needs a `start`".into());
                }
                _ => {}
            }
            if idea.part.is_some() && idea.date.is_none() {
                self.error("idea.when", id, "`part` is for a `date`".into());
            }
            if let (Some(start), Some(end)) = (idea.start, idea.end)
                && end < start
            {
                self.error("idea.when", id, "ends before it starts".into());
            }
            if idea
                .booking
                .as_ref()
                .is_some_and(|b| b.status == BookingStatus::Booked)
            {
                self.error(
                    "idea.booked",
                    id,
                    "a booked idea is a plan: move it to the itinerary".into(),
                );
            }
            if idea.costs.iter().any(crate::model::Cost::is_paid) {
                self.error(
                    "idea.paid",
                    id,
                    "an idea is only possible spend: once paid for, move it to the itinerary"
                        .into(),
                );
            }
            // Like a plan: say who it's for.
            if idea.who.is_none() && trip.members.len() > 1 {
                self.warn(
                    "item.unassigned",
                    id,
                    "no `who`, so it counts as everyone: list members or groups, or `everyone`"
                        .into(),
                );
                self.detail(&[], Some("who: [everyone]".into()));
            }
            self.who(&idea.id, idea.who.as_deref());
            self.title_names(&idea.id, &idea.title);
            let participants = trip.who(idea.who.as_deref());
            self.costs(&idea.id, &idea.costs, &participants, &participants, false);
        }
    }

    fn blockers(&mut self) {
        let trip = self.trip;
        let mut ids = HashSet::new();
        let mut titles = HashSet::new();
        for blocker in &trip.blockers {
            let id = Some(blocker.id.as_str());
            ids.insert(blocker.id.as_str());
            if !titles.insert(blocker.title.to_lowercase()) {
                self.error(
                    "blocker.duplicate",
                    id,
                    format!(
                        "two blockers are called `{}`; plans name them in `overrides`",
                        blocker.title
                    ),
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
            let names: Vec<&str> = conflict
                .members
                .iter()
                .map(|m| trip.member(m).map_or(m.as_str(), |m| m.name.as_str()))
                .collect();
            self.detail(
                &[
                    ("blocker", conflict.blocker.title.clone()),
                    ("who", names.join(", ")),
                ],
                Some(format!("overrides: [{}]", conflict.blocker.title)),
            );
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
        // References of reservations that carry a cost: a plan booked under
        // the same reference is paid for there.
        let referenced: HashSet<String> = trip
            .itinerary
            .iter()
            .flat_map(Item::parts)
            .filter(|p| !p.costs.is_empty())
            .filter_map(|p| Some(p.booking?.reference?.secret))
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
            let verb = if absent.len() == 1 { "is" } else { "are" };
            if item.who.is_none() && trip.members.len() > 1 {
                // Everyone by default is easy to miss: say who goes. When the
                // default is also wrong, say why.
                let mut apart: Vec<&str> = bases
                    .iter()
                    .filter(|b| b.from <= day && day <= b.to)
                    .map(|b| b.place_id.as_str())
                    .collect();
                apart.sort_unstable();
                apart.dedup();
                let why = if !absent.is_empty() {
                    format!(
                        ", but {} {verb} not on the trip on {day}",
                        absent.join(", ")
                    )
                } else if apart.len() > 1 {
                    let names: Vec<&str> = apart
                        .iter()
                        .map(|p| trip.places.get(*p).map_or(*p, |place| place.name.as_str()))
                        .collect();
                    format!(
                        ", but the group is split between {} on {day}",
                        names.join(" and ")
                    )
                } else {
                    String::new()
                };
                self.warn(
                    "item.unassigned",
                    id,
                    format!("no `who`, so it counts as everyone{why}: list members or groups, or `everyone`"),
                );
                self.detail(&[], Some("who: [everyone]".into()));
            } else if !absent.is_empty() {
                self.warn(
                    "item.absent",
                    id,
                    format!(
                        "{} {verb} not on the trip on {day}: fix `who` or the dates",
                        absent.join(", ")
                    ),
                );
                self.detail(
                    &[("who", absent.join(", ")), ("day", day.to_string())],
                    None,
                );
            }
            if item.kind == ItemKind::Lodging && item.places.is_empty() {
                self.warn(
                    "item.unlocated",
                    id,
                    "a stay without a place: it is off the map and bases cannot follow it".into(),
                );
            }
            let several = item.bookings.len() > 1;
            for part in item.parts() {
                let Some(booking) = part.booking.filter(|b| b.status == BookingStatus::Booked)
                else {
                    continue;
                };
                // With several reservations, say which one.
                let whose_names = match part.who {
                    Some(who) if several => trip
                        .who(Some(who))
                        .into_iter()
                        .map(|m| trip.member(m).map_or(m, |m| m.name.as_str()))
                        .collect::<Vec<_>>()
                        .join(", "),
                    _ => String::new(),
                };
                let whose = if whose_names.is_empty() {
                    String::new()
                } else {
                    format!(" ({whose_names})")
                };
                let confirmed = item.kind.is_transport() || item.kind == ItemKind::Lodging;
                if confirmed && booking.reference.is_none() {
                    self.warn(
                        "booking.reference",
                        id,
                        format!("booked{whose} without a confirmation number (`reference`)"),
                    );
                    self.detail(&[("whose", whose_names.clone())], None);
                }
                let shared = booking
                    .reference
                    .as_ref()
                    .is_some_and(|r| referenced.contains(&r.secret));
                if part.costs.is_empty() && !shared && item.kind != ItemKind::Note {
                    self.warn(
                        "booking.cost",
                        id,
                        format!("booked{whose} without a cost: add `costs`, or share a `reference` with a reservation that has them"),
                    );
                    self.detail(
                        &[("whose", whose_names.clone())],
                        Some(format!(
                            "costs:\n  - {{ amount: 0, currency: {} }} # the price",
                            trip.base_currency()
                        )),
                    );
                }
                if part.costs.iter().any(|c| c.estimate) {
                    self.warn(
                        "cost.estimate",
                        id,
                        format!("booked{whose}, but a cost is still marked `estimate`"),
                    );
                    self.detail(&[("whose", whose_names.clone())], None);
                }
            }
        }
    }

    /// Moving from one base to the next takes a journey: some plan whose
    /// places lead from the old area to the new one, by the day of arrival.
    /// Without it the route has a hole (and the map draws none).
    fn routes(&mut self) {
        let covered = self.base_gaps();
        self.jumps(&covered);
    }

    /// Moves between bases nothing takes people on; returns, per member id,
    /// the days each one spans so plan-level jumps there aren't said twice.
    fn base_gaps(&mut self) -> Vec<(String, NaiveDate, NaiveDate)> {
        let trip = self.trip;
        let mut covered = Vec::new();
        if trip.declared_bases.is_empty() {
            return covered;
        }
        let bases = trip.bases();
        // (from, to, arrival day) → who makes that move with nothing taking them there.
        let mut gaps: Vec<((usize, usize), Vec<&str>)> = Vec::new();
        for member in &trip.members {
            let mut mine: Vec<(usize, &crate::loader::ResolvedBase)> = bases
                .iter()
                .enumerate()
                .filter(|(_, b)| b.members.contains(&member.id))
                .collect();
            mine.sort_by_key(|(_, b)| b.from);
            for pair in mine.windows(2) {
                let ((ai, a), (bi, b)) = (pair[0], pair[1]);
                if a.place_id == b.place_id
                    || within(&a.place, &b.place)
                    || within(&b.place, &a.place)
                {
                    continue;
                }
                let connected = trip
                    .itinerary
                    .iter()
                    .filter(|i| trip.participants(i).contains(&member.id.as_str()))
                    .filter(|i| (a.to..=b.from).contains(&i.day()))
                    // Only a journey moves anyone: an activity naming both
                    // places doesn't say how they got there.
                    .filter(|i| i.kind.is_journey())
                    .any(|i| {
                        let places = trip.item_places(i);
                        let start = places.iter().position(|(_, p)| within(p, &a.place));
                        let end = places.iter().rposition(|(_, p)| within(p, &b.place));
                        matches!((start, end), (Some(s), Some(e)) if s < e)
                    });
                if !connected {
                    covered.push((member.id.clone(), a.to, b.from));
                    match gaps.iter_mut().find(|(k, _)| *k == (ai, bi)) {
                        Some((_, who)) => who.push(member.name.as_str()),
                        None => gaps.push(((ai, bi), vec![member.name.as_str()])),
                    }
                }
            }
        }
        for ((ai, bi), who) in gaps {
            let (a, b) = (&bases[ai], &bases[bi]);
            // The trip's UTC offset that day, so the snippet pastes as valid times.
            let offset = trip
                .metadata
                .timezone
                .parse::<chrono_tz::Tz>()
                .ok()
                .and_then(|tz| b.from.and_hms_opt(8, 0, 0)?.and_local_timezone(tz).single())
                .map_or_else(|| "+00:00".to_owned(), |t| t.format("%:z").to_string());
            self.warn(
                "route.gap",
                None,
                format!(
                    "{}: {} → {} on {}, but no plan takes them there — add the journey, its places from one to the other",
                    who.join(", "),
                    a.place.name,
                    b.place.name,
                    b.from
                ),
            );
            self.detail(
                &[
                    ("who", who.join(", ")),
                    ("from", a.place.name.clone()),
                    ("to", b.place.name.clone()),
                    ("day", b.from.to_string()),
                ],
                Some(format!(
                    "- kind: train\n  title: {} -> {}\n  start: {}T08:00:00{offset} # the real times\n  end: {}T10:00:00{offset}\n  who: [{}]\n  places: [{}, {}]",
                    a.place.name,
                    b.place.name,
                    b.from,
                    b.from,
                    who.join(", "),
                    a.place.name,
                    b.place.name
                )),
            );
        }
        covered
    }

    /// Each person's plans in order, with the night's lodging between days:
    /// one ending outside the area where the next starts, with no journey
    /// between, leaves them stranded; so does a plan that isn't a journey
    /// crossing from one area into another.
    fn jumps(&mut self, covered: &[(String, NaiveDate, NaiveDate)]) {
        let trip = self.trip;
        let mut jumps: Vec<(Jump, Vec<&str>)> = Vec::new();
        let bases = trip.bases();
        // Declared areas (places with a `radius`): inside one, getting
        // around is local. Anywhere else, a plan has to take people there.
        let areas: Vec<&crate::model::Place> = trip
            .places
            .values()
            .filter(|p| p.radius.is_some())
            .collect();
        let areas_of = |p: &crate::model::Place| -> Vec<&str> {
            areas
                .iter()
                .filter(|a| within(p, a))
                .map(|a| a.name.as_str())
                .collect()
        };
        // Somewhere else needs a way there: a journey, a walk or a ride. A
        // pass only pays for the transit legs; it doesn't stand in for them.
        let apart = |a: &crate::model::Place, b: &crate::model::Place| a.name != b.name;
        // One plan crossing from one area into another is a journey.
        let crosses = |a: &crate::model::Place, b: &crate::model::Place| {
            let (x, y) = (areas_of(a), areas_of(b));
            !x.is_empty() && !y.is_empty() && !x.iter().any(|n| y.contains(n))
        };
        for member in &trip.members {
            let mut mine: Vec<&Item> = trip
                .itinerary
                .iter()
                .filter(|i| trip.participants(i).contains(&member.id.as_str()))
                // Without `who` it's everyone's only by default: no proof of
                // where anyone is (`item.unassigned` asks).
                .filter(|i| i.who.is_some() || trip.members.len() == 1)
                .filter(|i| !trip.item_places(i).is_empty())
                .collect();
            mine.sort_by_key(|i| i.sort_key());
            let lodgings: Vec<&Item> = mine
                .iter()
                .copied()
                .filter(|i| i.kind == ItemKind::Lodging)
                .collect();
            let said = |day: NaiveDate| {
                covered
                    .iter()
                    .any(|(m, from, to)| *m == member.id && (*from..=*to).contains(&day))
            };
            let mut push = |key| match jumps.iter_mut().find(|(k, _)| *k == key) {
                Some((_, who)) => who.push(member.name.as_str()),
                None => jumps.push((key, vec![member.name.as_str()])),
            };
            let mut last: Option<(&Item, &crate::model::Place)> = None;
            for item in mine {
                let places = trip.item_places(item);
                let (first, end) = (places[0].1, places[places.len() - 1].1);
                // A new day starts from wherever the night was spent.
                if let Some((prev, at)) = last
                    && item.day() > prev.day()
                    && let Some(eve) = item.day().pred_opt()
                    && let Some(night) = lodgings.iter().find(|l| {
                        l.id != prev.id
                            && l.id != item.id
                            && trip.sleeps_at(&bases, l, &member.id, eve)
                    })
                {
                    let bed = trip.item_places(night)[0].1;
                    if apart(at, bed) && !said(prev.day()) {
                        push((
                            Leg::Return,
                            Some(night.id.as_str()),
                            prev.id.as_str(),
                            at.name.clone(),
                            bed.name.clone(),
                        ));
                    }
                    last = Some((night, bed));
                }
                if let Some((prev, at)) = last
                    && apart(at, first)
                    && !said(item.day())
                {
                    push((
                        Leg::Next,
                        Some(prev.id.as_str()),
                        item.id.as_str(),
                        at.name.clone(),
                        first.name.clone(),
                    ));
                }
                if !item.kind.is_journey() && !said(item.day()) {
                    for pair in places.windows(2) {
                        if crosses(pair[0].1, pair[1].1) {
                            push((
                                Leg::Inside,
                                None,
                                item.id.as_str(),
                                pair[0].1.name.clone(),
                                pair[1].1.name.clone(),
                            ));
                        }
                    }
                }
                last = Some((item, end));
            }
        }
        let find = |id: &str| trip.itinerary.iter().find(|i| i.id == id);
        let title = |id: &str| find(id).map_or("", |i| i.title.as_str());
        // A train between two plans, its times the gap between them.
        let snippet = |from: &str, to: &str, start: Option<&str>, end: Option<&str>, who: &str| {
            let times = match (
                start.and_then(find).and_then(Item::span),
                end.and_then(find).and_then(Item::span),
            ) {
                (Some((_, s)), Some((e, _))) => format!(
                    "\n  start: {} # the real times\n  end: {}",
                    s.to_rfc3339(),
                    e.to_rfc3339()
                ),
                (Some((_, s)), None) => format!("\n  start: {} # the real times", s.to_rfc3339()),
                _ => String::new(),
            };
            format!(
                "- kind: train\n  title: {from} -> {to}{times}\n  who: [{who}]\n  places: [{from}, {to}]"
            )
        };
        for ((leg, other, item, from, to), who) in jumps {
            let who = who.join(", ");
            match leg {
                Leg::Next => {
                    let after = other.unwrap_or_default();
                    self.warn(
                        "route.jump",
                        Some(item),
                        format!(
                            "{who}: `{}` ends at {from}, then `{}` starts at {to}, but nothing takes them there — add the way: a walk, a ride, metro, bus or train (a pass only pays for it)",
                            title(after),
                            title(item)
                        ),
                    );
                    let fix = snippet(&from, &to, Some(after), Some(item), &who);
                    self.detail(
                        &[
                            ("who", who),
                            ("from", from),
                            ("to", to),
                            ("after", title(after).to_owned()),
                        ],
                        Some(fix),
                    );
                }
                Leg::Return => {
                    let night = other.unwrap_or_default();
                    self.warn(
                        "route.return",
                        Some(item),
                        format!(
                            "{who}: `{}` ends at {from}, but the night is at {to} (`{}`), and nothing takes them back — add the way: a walk, a ride, metro, bus or train",
                            title(item),
                            title(night)
                        ),
                    );
                    let fix = snippet(&from, &to, Some(item), None, &who);
                    self.detail(
                        &[
                            ("who", who),
                            ("from", from),
                            ("to", to),
                            ("night", title(night).to_owned()),
                        ],
                        Some(fix),
                    );
                }
                Leg::Inside => {
                    self.warn(
                        "route.cross",
                        Some(item),
                        format!(
                            "{who}: `{}` goes from {from} to {to}, from one area into another — make it a journey (`kind: train`, …) or add one",
                            title(item)
                        ),
                    );
                    self.detail(&[("who", who), ("from", from), ("to", to)], None);
                }
            }
        }
    }

    fn nights(&mut self) {
        let trip = self.trip;
        if trip.declared_bases.is_empty() {
            return;
        }
        let bases = trip.bases();
        let mut homeless = Vec::new();
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
            // Days before the first stay or after the last are spent at home: it needs naming.
            let stays = bases.iter().filter(|b| b.members.contains(&member.id));
            let first_stay = stays.clone().map(|b| b.from).min();
            let last_night = stays.map(|b| b.to).max();
            let outside = first_stay.is_some_and(|f| first < f)
                || last_night.is_some_and(|l| l.succ_opt() < Some(last));
            if outside && member.home.is_none() && trip.metadata.home.is_none() {
                homeless.push(member.id.clone());
            }
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
        if !homeless.is_empty() {
            self.warn(
                "trip.home",
                None,
                format!(
                    "where the trip starts and ends isn't set for {}: add `home` to `metadata` (or to a member) so the first and last days have a place",
                    homeless.join(", ")
                ),
            );
        }
    }

    /// `participants`: who the costs are for (a reservation's people);
    /// `plan`: everyone on the plan they belong to.
    fn costs(
        &mut self,
        owner: &str,
        costs: &[crate::model::Cost],
        participants: &[&str],
        plan: &[&str],
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
            let payers = cost.payers();
            if cost.paid_by.is_some() && !cost.is_each() {
                self.who(owner, Some(&payers));
            }
            if !cost.settled && !cost.owed_once_paid() {
                self.warn(
                    "cost.settled",
                    id,
                    if cost.is_paid() {
                        "`settled: false` with `paidBy: each`: everyone paid for themselves".into()
                    } else {
                        "`settled: false`, but nobody has paid yet (no `paidBy`)".into()
                    },
                );
            }
            self.who(owner, cost.who.as_deref());
            if let Some(debtor) = &cost.owed_by {
                self.who(owner, Some(std::slice::from_ref(debtor)));
                if !cost.owed_once_paid() {
                    self.warn(
                        "cost.owedBy",
                        id,
                        "`owedBy` only matters while someone still owes the payer: add `settled: false` (and `paidBy`)"
                            .into(),
                    );
                }
            }
            // A booking is a fact: record what it actually cost the payer.
            let payer_currency = match payers.as_slice() {
                [one] => trip.member(one).and_then(|m| m.currency.clone()),
                _ => None,
            }
            .unwrap_or_else(|| trip.base_currency().to_owned());
            // Until then the site converts at today's rate: worth a warning, not a failed build.
            if booked
                && cost.is_paid()
                && !cost.estimate
                && cost.due.is_none()
                && cost.charged.is_none()
                && cost.currency != payer_currency
            {
                self.warn(
                    "cost.charged",
                    id,
                    format!(
                        "booked, priced in {} — add `charged:` with what was actually paid in {payer_currency}",
                        cost.currency
                    ),
                );
                self.detail(
                    &[
                        ("amount", format!("{} {}", cost.amount, cost.currency)),
                        ("currency", payer_currency.clone()),
                    ],
                    Some(format!("charged: {{ amount: 0, currency: {payer_currency} }} # what left the account")),
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
            // A payer from outside the plan is likely a slip. One on the plan
            // (say, under the other reservation of one booking), or one who is
            // still owed for it, is paying for the others on purpose.
            if let [payer] = payers.as_slice()
                && cost.split == Split::Equal
                && !cost.owed_once_paid()
                && !beneficiaries.contains(&payer.as_str())
                && !plan.contains(&payer.as_str())
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

    /// A place used as an area has to say how big it is.
    fn area(&mut self, id: Option<&str>, place: &crate::model::Place) {
        if place.radius.is_none() {
            self.warn(
                "area.radius",
                id,
                format!(
                    "`{}` is used as an area but has no `radius`: only that very spot counts as in it",
                    place.name
                ),
            );
            self.detail(
                &[("place", place.name.clone())],
                Some("radius: 10000 # metres".into()),
            );
        }
    }

    fn passes(&mut self) {
        let trip = self.trip;
        for pass in &trip.passes {
            let id = Some(pass.id.as_str());
            self.who(&pass.id, pass.who.as_deref());
            match trip.places.get(&pass.area) {
                None => self.error("pass.area", id, format!("unknown place `{}`", pass.area)),
                Some(place) => self.area(id, place),
            }
            if !pass.bookings.is_empty() && (pass.booking.is_some() || !pass.costs.is_empty()) {
                self.error(
                    "pass.bookings",
                    id,
                    "with `bookings`, each holds its own booking and costs: not on the pass".into(),
                );
            }
            for share in &pass.bookings {
                self.who(&pass.id, share.who.as_deref());
            }
            for share in pass.shares() {
                if share.periods.is_empty() {
                    self.error("pass.periods", id, "needs at least one period".into());
                }
                for period in share.periods.iter().filter(|p| p.to < p.from) {
                    self.error(
                        "pass.periods",
                        id,
                        format!(
                            "period {} – {}: `to` is before `from`",
                            period.from, period.to
                        ),
                    );
                }
                let people = trip.who(share.who);
                let booked = share.status == BookingStatus::Booked;
                self.costs(&pass.id, share.costs, &people, &people, booked);
            }
        }
    }

    fn tasks(&mut self) {
        let trip = self.trip;
        let start = crate::export::date_range(trip).0;
        let mut titles = HashSet::new();
        for task in &trip.tasks {
            let id = Some(task.id.as_str());
            self.who(&task.id, task.who.as_deref());
            if !titles.insert(task.title.to_lowercase()) {
                self.error(
                    "task.duplicate",
                    id,
                    format!("two tasks are called `{}`", task.title),
                );
            }
            if let (true, Some(due), Some(start)) = (task.required, task.due, start)
                && due > start
            {
                self.warn(
                    "task.due",
                    id,
                    format!("the trip needs it, but it is due {due}, after it starts on {start}"),
                );
                self.detail(
                    &[("due", due.to_string()), ("start", start.to_string())],
                    Some(format!("due: {start}")),
                );
            }
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
                self.costs(item.name(), item.costs(), &packers, &packers, item.bought());
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
apiVersion: taac/v1alpha4
kind: Trip
metadata: {{ title: T, timezone: Asia/Tokyo }}
currency: {{ base: EUR }}
members: [{{ name: A }}, {{ name: B }}]
groups: [{{ name: Duo, members: [a, b] }}]
places:
  tokyo: {{ geo: [35.68, 139.76], radius: 25000 }}
  kyoto: {{ geo: [35.01, 135.77], radius: 12000 }}
  flat: {{ geo: [35.70, 139.80] }}
  ryokan: {{ geo: [35.00, 135.76] }}
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
            "  - { kind: activity, title: x, start: 2027-01-01T10:00:00+09:00, end: 2027-01-01T11:00:00+09:00, who: [duo],
        costs: [{ amount: 1000, currency: JPY, paidBy: a }] }",
        );
        assert!(d.is_empty(), "{d:?}");
    }

    #[test]
    fn flags_references_time_and_money() {
        let d = check(
            "  - { kind: activity, title: x, start: 2027-01-01T10:00:00+09:00, end: 2027-01-01T09:00:00+09:00, places: [nowhere], who: [zed],
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
            "  - { kind: activity, title: x, start: 2027-01-01T10:00:00+09:00, end: 2027-01-01T12:00:00+09:00, who: [a] }
  - { kind: activity, title: y, start: 2027-01-01T11:00:00+09:00, end: 2027-01-01T13:00:00+09:00, who: [b] }
  - { kind: activity, title: z, start: 2027-01-01T11:30:00+09:00, end: 2027-01-01T12:30:00+09:00, who: [a] }",
        );
        assert_eq!(codes(&d), ["item.overlap"]);
        assert_eq!(d[0].item.as_deref(), Some("z"));
    }

    #[test]
    fn loose_items_need_a_day_and_no_fixed_kinds() {
        let d = check(
            "  - { kind: activity, title: x, date: 2027-01-01, part: afternoon }
  - { kind: lodging, title: y, date: 2027-01-01 }
  - { kind: activity, title: z, date: 2027-01-01, start: 2027-01-01T10:00:00+09:00 }
  - { kind: activity, title: w}",
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
  - { title: t, place: tokyo, from: 2027-01-01, to: 2027-01-03 }
  - { title: k, place: kyoto, from: 2027-01-03, to: 2027-01-04, who: [a] }
ideas:
  - { title: i, area: osaka }",
            "  - { kind: activity, title: x, date: 2027-01-01 }",
        );
        let codes = codes(&d);
        assert!(codes.contains(&"base.overlap"), "{codes:?}");
        assert!(codes.contains(&"idea.area"), "{codes:?}");
    }

    #[test]
    fn a_flat_kept_while_travelling_is_not_an_overlap() {
        let d = check_with(
            "bases:
  - { title: t1, place: tokyo, from: 2027-01-01, to: 2027-01-02 }
  - { title: k, place: kyoto, from: 2027-01-03, to: 2027-01-03 }
  - { title: t2, place: tokyo, from: 2027-01-04, to: 2027-01-05 }",
            "  - { kind: lodging, title: flat, start: 2027-01-01T15:00:00+09:00, end: 2027-01-06T10:00:00+09:00, places: [flat], who: [everyone] }
  - { kind: lodging, title: ryokan, start: 2027-01-03T15:00:00+09:00, end: 2027-01-04T10:00:00+09:00, places: [ryokan], who: [everyone] }",
        );
        // No journeys are given here: only the overlap matters.
        assert!(d.iter().all(|x| x.code == "route.gap"), "{d:?}");
    }

    #[test]
    fn nights_without_a_base_are_flagged() {
        let d = check_with(
            "bases:
  - { title: t, place: tokyo, from: 2027-01-01, to: 2027-01-01 }",
            "  - { kind: activity, title: x, date: 2027-01-03 }",
        );
        let missing: Vec<_> = d.iter().filter(|d| d.code == "base.missing").collect();
        assert_eq!(missing.len(), 2, "{d:?}");
        assert!(missing[0].message.contains("2027-01-02"));
    }

    #[test]
    fn plans_for_people_who_are_not_there() {
        let d = check_with(
            "bases:
  - { title: t, place: tokyo, from: 2027-01-01, to: 2027-01-03, who: [a] }
  - { title: k, place: kyoto, from: 2027-01-02, to: 2027-01-03, who: [b] }",
            "  - { kind: note, title: early, date: 2027-01-01 }
  - { kind: activity, title: split, date: 2027-01-02, places: [tokyo] }
  - { kind: activity, title: late, date: 2027-01-09, who: [a], places: [tokyo] }
  - { kind: activity, title: fine, date: 2027-01-02, who: [b], places: [kyoto] }",
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
    fn moving_between_bases_takes_a_journey() {
        let bases = "bases:
  - { title: t, place: tokyo, from: 2027-01-01, to: 2027-01-01 }
  - { title: k, place: kyoto, from: 2027-01-02, to: 2027-01-02 }";
        let gap = check_with(
            bases,
            "  - { kind: note, title: x, date: 2027-01-01, who: [everyone] }",
        );
        assert!(gap.iter().any(|d| d.code == "route.gap"), "{gap:?}");
        let fine = check_with(
            bases,
            "  - { kind: train, title: shinkansen, start: 2027-01-02T09:00:00+09:00, end: 2027-01-02T11:15:00+09:00, who: [everyone], places: [tokyo, kyoto] }",
        );
        assert!(!fine.iter().any(|d| d.code == "route.gap"), "{fine:?}");
        // An activity naming both places doesn't say how anyone got there.
        let activity = check_with(
            bases,
            "  - { kind: activity, title: tour, date: 2027-01-02, who: [everyone], places: [tokyo, kyoto] }",
        );
        assert!(
            activity.iter().any(|d| d.code == "route.gap"),
            "{activity:?}"
        );
    }

    #[test]
    fn a_day_out_starts_and_ends_at_the_nights_lodging() {
        let d = check(
            "  - { kind: lodging, title: hotel, start: 2027-01-01T15:00:00+09:00, end: 2027-01-03T10:00:00+09:00, who: [everyone], places: [flat] }
  - { kind: activity, title: temple, start: 2027-01-02T10:00:00+09:00, end: 2027-01-02T12:00:00+09:00, who: [everyone], places: [kyoto] }
  - { kind: activity, title: walk, start: 2027-01-03T09:00:00+09:00, end: 2027-01-03T10:00:00+09:00, who: [everyone], places: [tokyo] }",
        );
        let at = |code: &str| {
            d.iter()
                .filter(|x| x.code == code)
                .map(|x| x.item.as_deref().unwrap_or(""))
                .collect::<Vec<_>>()
        };
        // Out from the hotel each morning, and back to it at night.
        assert_eq!(at("route.jump"), ["temple", "walk"], "{d:?}");
        assert_eq!(at("route.return"), ["temple"], "{d:?}");
    }

    #[test]
    fn every_move_needs_a_way_there() {
        let plans = "  - { kind: activity, title: museum, start: 2027-01-01T10:00:00+09:00, end: 2027-01-01T12:00:00+09:00, who: [everyone], places: [tokyo] }
  - { kind: activity, title: park, start: 2027-01-01T13:00:00+09:00, end: 2027-01-01T14:00:00+09:00, who: [everyone], places: [flat] }
  - { kind: activity, title: temple, start: 2027-01-02T10:00:00+09:00, end: 2027-01-02T12:00:00+09:00, who: [everyone], places: [kyoto] }
  - { kind: activity, title: day tour, start: 2027-01-03T10:00:00+09:00, end: 2027-01-03T18:00:00+09:00, who: [a], places: [ryokan, tokyo] }";
        let jumps = |d: &[Diagnostic]| {
            d.iter()
                .filter(|d| d.code == "route.jump")
                .map(|d| d.item.clone().unwrap_or_default())
                .collect::<Vec<_>>()
        };
        // Even inside one area, a move between two places needs a way.
        let d = check(plans);
        assert_eq!(jumps(&d), ["park", "temple", "day-tour"], "{d:?}");
        // One plan crossing areas is a journey in disguise.
        assert!(
            d.iter()
                .any(|d| d.code == "route.cross" && d.item.as_deref() == Some("day-tour")),
            "{d:?}"
        );
        // A pass only pays for the legs: it stands in for none. A walk does.
        let passed = check_with(
            "passes: [{ title: metro, area: tokyo, periods: [{ from: 2027-01-01, to: 2027-01-01 }] }]",
            plans,
        );
        assert_eq!(jumps(&passed), ["park", "temple", "day-tour"], "{passed:?}");
        let walked = check(&format!(
            "{plans}
  - {{ kind: walk, title: stroll, start: 2027-01-01T12:00:00+09:00, end: 2027-01-01T12:30:00+09:00, who: [everyone], places: [tokyo, flat] }}"
        ));
        assert_eq!(jumps(&walked), ["temple", "day-tour"], "{walked:?}");
        let fine = check(
            "  - { kind: activity, title: museum, date: 2027-01-01, who: [everyone], places: [tokyo] }
  - { kind: train, title: shinkansen, start: 2027-01-02T09:00:00+09:00, end: 2027-01-02T11:15:00+09:00, who: [everyone], places: [tokyo, kyoto] }
  - { kind: ride, title: bike, start: 2027-01-02T11:30:00+09:00, end: 2027-01-02T11:45:00+09:00, who: [everyone], places: [kyoto, ryokan],
      transport: { vehicle: bicycle, carrier: Kyoto Bike }, costs: [{ amount: 500, currency: JPY, estimate: true }] }
  - { kind: activity, title: temple, start: 2027-01-02T13:00:00+09:00, end: 2027-01-02T15:00:00+09:00, who: [everyone], places: [ryokan] }",
        );
        assert!(
            !fine.iter().any(|d| d.code.starts_with("route.")),
            "{fine:?}"
        );
    }

    #[test]
    fn vehicles_board_at_stations() {
        let d = check(
            "  - { kind: train, title: metro, start: 2027-01-01T09:00:00+09:00, end: 2027-01-01T09:30:00+09:00, who: [everyone],
      places: [flat, { name: Station, geo: [35.68, 139.77], category: station }] }
  - { kind: transfer, title: taxi, start: 2027-01-01T10:00:00+09:00, end: 2027-01-01T10:30:00+09:00, who: [everyone], places: [{ name: Station, geo: [35.68, 139.77], category: station }, flat] }",
        );
        let stations: Vec<_> = d
            .iter()
            .filter(|d| d.code == "route.station")
            .map(|d| {
                (
                    d.item.as_deref().unwrap_or(""),
                    d.params.get("end").map(String::as_str),
                )
            })
            .collect();
        // The metro starts at a flat; a taxi may go door to door.
        assert_eq!(stations, [("metro", Some("from"))], "{d:?}");
    }

    #[test]
    fn a_pass_held_per_party_needs_days_for_each() {
        let d = check_with(
            "passes:
  - title: metro
    area: tokyo
    bookings:
      - { who: [a], periods: [{ from: 2027-01-01, to: 2027-01-01 }] }
      - { who: [b] }",
            "  - { kind: note, title: x, date: 2027-01-01, who: [everyone] }",
        );
        let periods = d.iter().filter(|d| d.code == "pass.periods").count();
        assert_eq!(periods, 1, "{d:?}");
    }

    #[test]
    fn areas_say_how_big_they_are() {
        let d = check_with(
            "passes: [{ title: pass, area: flat, periods: [{ from: 2027-01-01, to: 2027-01-01 }] }]",
            "  - { kind: note, title: x, date: 2027-01-01, who: [everyone] }",
        );
        assert!(
            d.iter()
                .any(|d| d.code == "area.radius" && d.item.as_deref() == Some("pass")),
            "{d:?}"
        );
    }

    #[test]
    fn paying_for_the_other_reservation_of_a_plan_is_fine() {
        let d = check(
            "  - { kind: activity, title: room, date: 2027-01-01, who: [everyone],
      bookings: [{ who: [a], status: required, costs: [{ amount: 10, currency: EUR }] },
                 { who: [b], status: required, costs: [{ amount: 10, currency: EUR, paidBy: a }] }] }",
        );
        assert!(!d.iter().any(|x| x.code == "cost.payer"), "{d:?}");
    }

    #[test]
    fn foreign_prices_ask_for_what_was_charged() {
        let d = check(
            "  - { kind: activity, title: paid, date: 2027-01-01, who: [a], booking: { status: booked, reference: { secret: R } },
      costs: [{ amount: 1000, currency: JPY, paidBy: a }] }
  - { kind: activity, title: guessed, date: 2027-01-01, who: [a], booking: { status: booked, reference: { secret: S } },
      costs: [{ amount: 1000, currency: JPY, paidBy: a, estimate: true }] }
  - { kind: activity, title: known, date: 2027-01-01, who: [a], booking: { status: booked, reference: { secret: T } },
      costs: [{ amount: 1000, currency: JPY, paidBy: a, charged: { amount: 6.1, currency: EUR } }] }
  - { kind: activity, title: later, date: 2027-01-01, who: [a], booking: { status: booked, reference: { secret: U } },
      costs: [{ amount: 1000, currency: JPY, paidBy: a, due: 2026-12-05 }] }",
        );
        let charged: Vec<_> = d.iter().filter(|x| x.code == "cost.charged").collect();
        assert_eq!(charged.len(), 1, "{d:?}");
        assert_eq!(charged[0].item.as_deref(), Some("paid"));
        assert!(!charged[0].is_error());
        assert!(
            charged[0]
                .fix
                .as_deref()
                .is_some_and(|f| f.starts_with("charged:"))
        );
    }

    #[test]
    fn titles_leave_people_to_who() {
        let d = check(
            "  - { kind: activity, title: Hotel (b), date: 2027-01-01, who: [b] }
  - { kind: activity, title: Board games, date: 2027-01-01, who: [b] }",
        );
        let codes: Vec<_> = d.iter().map(|x| (x.item.as_deref(), x.code)).collect();
        assert_eq!(codes, [(Some("hotel-b"), "title.who")], "{d:?}");
    }

    #[test]
    fn who_must_be_said_and_everyone_says_it() {
        let d = check(
            "  - { kind: activity, title: quiet, date: 2027-01-01 }
  - { kind: activity, title: said, date: 2027-01-01, who: [everyone] }
  - { kind: activity, title: both, date: 2027-01-01, who: [everyone, a] }",
        );
        let at = |item: &str| {
            d.iter()
                .filter(|x| x.item.as_deref() == Some(item))
                .map(|x| x.code)
                .collect::<Vec<_>>()
        };
        assert_eq!(at("quiet"), ["item.unassigned"], "{d:?}");
        assert!(at("said").is_empty(), "{d:?}");
        assert_eq!(at("both"), ["who.redundant"], "{d:?}");
    }

    #[test]
    fn one_plan_several_reservations() {
        let d = check(
            "  - kind: flight
    title: shared
    who: [everyone]
    start: 2027-01-01T08:00:00+09:00
    end: 2027-01-01T09:00:00+09:00
    places: [tokyo, kyoto]
    bookings:
      - { who: [a], status: booked, reference: { secret: A_PNR }, costs: [{ amount: 9, currency: EUR, paidBy: a }] }
      - { who: [b], status: booked, reference: { secret: B_PNR } }",
        );
        let shared: Vec<_> = d
            .iter()
            .filter(|x| x.item.as_deref() == Some("shared"))
            .collect();
        assert_eq!(shared.len(), 1, "{d:?}");
        assert_eq!(shared[0].code, "booking.cost");
        assert!(shared[0].message.contains("(B)"), "{}", shared[0].message);
    }

    #[test]
    fn bookings_with_loose_ends() {
        let d = check(
            "  - { kind: lodging, title: hotel, start: 2027-01-01T15:00:00+09:00, end: 2027-01-02T10:00:00+09:00, booking: { status: booked } }
  - { kind: flight, title: out, start: 2027-01-01T08:00:00+09:00, end: 2027-01-01T09:00:00+09:00, places: [tokyo, kyoto],
      booking: { status: booked, reference: { secret: PNR } }, costs: [{ amount: 9, currency: EUR, paidBy: a, estimate: true }] }
  - { kind: flight, title: back, start: 2027-01-02T08:00:00+09:00, end: 2027-01-02T09:00:00+09:00, places: [kyoto, tokyo],
      who: [everyone], booking: { status: booked, reference: { secret: PNR } } }",
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
    fn ideas_are_proposals_of_any_kind() {
        let d = check_with(
            "ideas:
  - { title: stay, kind: lodging, who: [everyone], start: 2027-01-01T15:00:00+09:00, end: 2027-01-02T10:00:00+09:00, option: Stay,
      booking: { status: required, deadline: 2026-12-01 }, costs: [{ amount: 90, currency: EUR, estimate: true }] }
  - { title: flight, kind: flight, who: [a] }
  - { title: booked, who: [a], booking: { status: booked } }
  - { title: prepaid, who: [a], costs: [{ amount: 5, currency: EUR, paidBy: a }] }
  - { title: both, who: [a], date: 2027-01-01, start: 2027-01-01T10:00:00+09:00 }
  - { title: loose, who: [a], part: evening }
  - { title: anyone }",
            "  - { title: x, kind: note, date: 2027-01-01, who: [everyone] }",
        );
        let at = |item: &str| {
            d.iter()
                .filter(|x| x.item.as_deref() == Some(item))
                .map(|x| x.code)
                .collect::<Vec<_>>()
        };
        assert!(at("stay").is_empty(), "{d:?}");
        assert!(at("flight").is_empty(), "{d:?}");
        assert_eq!(at("booked"), ["idea.booked"], "{d:?}");
        assert_eq!(at("prepaid"), ["idea.paid"], "{d:?}");
        assert_eq!(at("both"), ["idea.when"], "{d:?}");
        assert_eq!(at("loose"), ["idea.when"], "{d:?}");
        assert_eq!(at("anyone"), ["item.unassigned"], "{d:?}");
    }

    #[test]
    fn who_mixes_members_and_groups() {
        let d = check(
            "  - { kind: activity, title: x, date: 2027-01-01, who: [duo, a] }
  - { kind: activity, title: y, date: 2027-01-01, who: [nobody] }
  - { kind: activity, title: z, date: 2027-01-01, who: [] }",
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
  - title: work
    who: [a]
    periods: [{ from: 2027-01-04, to: 2027-01-08 }]
    days: [mon, tue, wed, thu, fri]
    time: { start: '09:00', end: '17:00', timezone: Europe/Helsinki }",
            "  - { kind: meal, title: dinner, start: 2027-01-05T18:00:00+09:00, end: 2027-01-05T20:00:00+09:00 }
  - { kind: meal, title: lunch, start: 2027-01-05T12:00:00+09:00, end: 2027-01-05T13:00:00+09:00 }
  - { kind: train, title: train, start: 2027-01-06T17:00:00+09:00, end: 2027-01-06T19:00:00+09:00, places: [tokyo, kyoto], overrides: [work] }
  - { kind: meal, title: weekend, start: 2027-01-09T18:00:00+09:00, end: 2027-01-09T20:00:00+09:00 }
  - { kind: meal, title: other, start: 2027-01-05T18:00:00+09:00, end: 2027-01-05T19:00:00+09:00, who: [b] }",
        );
        let conflicts: Vec<_> = d
            .iter()
            .filter(|d| d.code == "blocker.conflict")
            .filter_map(|d| d.item.as_deref())
            .collect();
        assert_eq!(conflicts, ["dinner"], "{d:?}");
        let fix = d
            .iter()
            .find(|d| d.code == "blocker.conflict")
            .and_then(|d| d.fix.clone());
        assert!(fix.is_some_and(|f| f.starts_with("overrides: [")), "{d:?}");
    }

    #[test]
    fn required_tasks_are_due_by_the_start() {
        let d = check_with(
            "tasks:
  - { title: visa, who: [a], required: true, done: 2026-10-19 }
  - { title: late visa, who: [b], required: true, due: 2027-01-02 }
  - { title: souvenirs, due: 2027-01-02 }
  - { title: pass, who: [c] }",
            "  - { kind: activity, title: x, start: 2027-01-01T10:00:00+09:00, end: 2027-01-01T11:00:00+09:00 }",
        );
        let due: Vec<_> = d
            .iter()
            .filter(|d| d.code == "task.due")
            .filter_map(|d| d.item.as_deref())
            .collect();
        assert_eq!(due, ["late-visa"], "{d:?}");
        assert!(
            d.iter()
                .any(|d| d.code == "who.unknown" && d.item.as_deref() == Some("pass")),
            "{d:?}"
        );
    }

    #[test]
    fn photos_are_https_urls() {
        let d = check_with(
            "  shrine: { geo: [35.67, 139.70], photo: 'https://example.org/meiji.jpg' }
  tower: { geo: [35.66, 139.75], photo: 'http://example.org/tower.jpg' }",
            "  - { kind: activity, title: x, start: 2027-01-01T10:00:00+09:00, end: 2027-01-01T11:00:00+09:00 }",
        );
        let photos: Vec<_> = d
            .iter()
            .filter(|d| d.code == "place.photo")
            .map(|d| d.message.as_str())
            .collect();
        assert_eq!(photos.len(), 1, "{d:?}");
        assert!(photos[0].contains("`tower`"), "{d:?}");
    }

    #[test]
    fn the_first_and_last_days_need_a_home() {
        let trip = |home: &str| {
            format!(
                r"
apiVersion: taac/v1alpha4
kind: Trip
metadata: {{ title: T, timezone: Asia/Tokyo{home} }}
members: [{{ name: A }}]
places:
  home city: {{ geo: [60.17, 24.94], radius: 30000 }}
  tokyo: {{ geo: [35.68, 139.76], radius: 25000 }}
  hel: {{ geo: [60.31, 24.96], category: airport }}
  hnd: {{ geo: [35.55, 139.78], category: airport }}
bases:
  - {{ title: Tokyo, place: tokyo, from: 2027-01-02, to: 2027-01-03 }}
itinerary:
  - {{ kind: flight, title: out, places: [hel, hnd], start: 2027-01-01T18:00:00+02:00, end: 2027-01-02T14:00:00+09:00 }}
  - {{ kind: flight, title: back, places: [hnd, hel], start: 2027-01-04T10:00:00+09:00, end: 2027-01-04T15:00:00+02:00 }}
"
            )
        };
        let check = |yaml: String| {
            let files: Files = [("trip.yaml".to_owned(), yaml)].into();
            let (site, diagnostics) = load_standalone_trip(&files, "trip.yaml");
            assert!(diagnostics.is_empty(), "{diagnostics:?}");
            validate_site(&site.unwrap())
        };
        assert!(codes(&check(trip(""))).contains(&"trip.home"));
        let set = check(trip(", home: home city"));
        assert!(!codes(&set).contains(&"trip.home"), "{set:?}");
        assert!(codes(&check(trip(", home: nowhere"))).contains(&"home.place"));
    }
}
