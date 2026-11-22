//! Blockers: when people are unavailable, and which plans run into that.
//! Everything is compared in UTC; each blocker keeps its own time zone, so
//! "09:00–17:00 Helsinki" stays right while the trip is in Tokyo.

use jiff::Timestamp;
use jiff::civil::{Date, Time};
use jiff::tz::TimeZone;

use crate::loader::Trip;
use crate::model::{Blocker, DayPart, Item, ItemKind};

/// One day's stretch of a blocker.
#[derive(Debug, Clone)]
pub struct Occurrence<'a> {
    pub blocker: &'a Blocker,
    /// The date in the blocker's own zone.
    pub date: Date,
    pub start: Timestamp,
    pub end: Timestamp,
    pub whole_day: bool,
}

#[derive(Debug, Clone)]
pub struct Conflict<'a> {
    pub item: &'a Item,
    pub blocker: &'a Blocker,
    pub members: Vec<String>,
    pub overridden: bool,
}

pub fn zone(trip: &Trip, blocker: &Blocker) -> Option<TimeZone> {
    let name = blocker
        .time
        .as_ref()
        .and_then(|t| t.timezone.as_deref())
        .unwrap_or(&trip.metadata.timezone);
    TimeZone::get(name).ok()
}

pub fn parse_time(value: &str) -> Option<Time> {
    if value == "24:00" {
        return Some(Time::MIN);
    }
    let (h, m) = value.split_once(':')?;
    if h.len() != 2 || m.len() != 2 {
        return None;
    }
    let hour: i8 = h.parse().ok()?;
    let minute: i8 = m.parse().ok()?;
    Time::new(hour, minute, 0, 0).ok()
}

fn at(tz: &TimeZone, date: Date, time: Time) -> Option<Timestamp> {
    // A gap (DST spring-forward) takes the earliest valid instant.
    tz.to_ambiguous_zoned(date.to_datetime(time))
        .compatible()
        .ok()
        .map(|z| z.timestamp())
}

pub fn occurrences<'a>(trip: &Trip, blocker: &'a Blocker) -> Vec<Occurrence<'a>> {
    let Some(tz) = zone(trip, blocker) else {
        return Vec::new();
    };
    let window = blocker
        .time
        .as_ref()
        .and_then(|t| Some((parse_time(&t.start)?, parse_time(&t.end)?)));
    let mut out = Vec::new();
    for period in &blocker.periods {
        let mut date = period.from;
        while date <= period.to {
            if blocker.days.is_empty() || blocker.days.iter().any(|d| d.matches(date.weekday())) {
                let (start, end, whole_day) = match window {
                    Some((start, end)) => {
                        let end_date = if end <= start {
                            date.tomorrow().unwrap_or(date)
                        } else {
                            date
                        };
                        (at(&tz, date, start), at(&tz, end_date, end), false)
                    }
                    None => (
                        at(&tz, date, Time::MIN),
                        at(&tz, date.tomorrow().unwrap_or(date), Time::MIN),
                        true,
                    ),
                };
                if let (Some(start), Some(end)) = (start, end) {
                    out.push(Occurrence {
                        blocker,
                        date,
                        start,
                        end,
                        whole_day,
                    });
                }
            }
            let Ok(next) = date.tomorrow() else {
                break;
            };
            date = next;
        }
    }
    out
}

/// When a plan happens, in UTC. `date`-only plans count from their part of
/// the day (in the trip's zone); without a part they can move, so never clash.
pub fn item_span(trip: &Trip, item: &Item) -> Option<(Timestamp, Timestamp)> {
    if let Some((start, end)) = item.span() {
        return Some((start.timestamp(), end.timestamp()));
    }
    let (from, to) = match item.part? {
        DayPart::Morning => (8, 12),
        DayPart::Afternoon => (12, 18),
        DayPart::Evening => (18, 23),
    };
    let tz = TimeZone::get(&trip.metadata.timezone).ok()?;
    let date = item.date?;
    Some((
        at(&tz, date, Time::new(from, 0, 0, 0).ok()?)?,
        at(&tz, date, Time::new(to, 0, 0, 0).ok()?)?,
    ))
}

/// Plans that overlap a blocker for someone in both. Lodging and notes are
/// where you are, not what you do, so they never clash.
pub fn conflicts(trip: &Trip) -> Vec<Conflict<'_>> {
    let occurrences: Vec<_> = trip
        .blockers
        .iter()
        .flat_map(|b| occurrences(trip, b))
        .collect();
    let mut out: Vec<Conflict<'_>> = Vec::new();
    for item in &trip.itinerary {
        if matches!(
            item.kind,
            ItemKind::Lodging | ItemKind::Note | ItemKind::Free
        ) {
            continue;
        }
        let Some((start, end)) = item_span(trip, item) else {
            continue;
        };
        let participants = trip.participants(item);
        for occurrence in occurrences
            .iter()
            .filter(|o| o.start < end && start < o.end)
        {
            let blocked = trip.who(occurrence.blocker.who.as_deref());
            let members: Vec<String> = participants
                .iter()
                .filter(|m| blocked.contains(m))
                .map(|m| (*m).to_owned())
                .collect();
            if members.is_empty()
                || out
                    .iter()
                    .any(|c| c.item.id == item.id && c.blocker.id == occurrence.blocker.id)
            {
                continue;
            }
            out.push(Conflict {
                item,
                blocker: occurrence.blocker,
                members,
                overridden: item.overrides.contains(&occurrence.blocker.id),
            });
        }
    }
    out
}
