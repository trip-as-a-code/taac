//! iCalendar (RFC 5545).

use std::fmt::Write;

use chrono::Utc;

use crate::loader::Trip;
use crate::model::{BookingStatus, ItemKind};
use crate::secrets::{self, SecretStore};

/// The trip's calendar; with `member`, only what that member takes part in.
pub fn generate(trip: &Trip, reveal: Option<&SecretStore>, member: Option<&str>) -> String {
    let includes = |members: &[&str]| member.is_none_or(|m| members.contains(&m));
    let mut out = String::new();
    let mut line = |s: String| fold_into(&mut out, &s);
    line("BEGIN:VCALENDAR".into());
    line("VERSION:2.0".into());
    line("PRODID:-//taac//Trip as a Code//EN".into());
    line("CALSCALE:GREGORIAN".into());
    line("METHOD:PUBLISH".into());
    line(format!("X-WR-CALNAME:{}", escape(&trip.metadata.title)));
    line(format!("X-WR-TIMEZONE:{}", trip.metadata.timezone));

    for base in trip.bases().iter().filter(|b| {
        !b.derived && includes(&b.members.iter().map(String::as_str).collect::<Vec<_>>())
    }) {
        let who: Vec<&str> = base
            .members
            .iter()
            .map(|id| trip.member(id).map_or(id.as_str(), |m| m.name.as_str()))
            .collect();
        line("BEGIN:VEVENT".into());
        line(format!("UID:base.{}.{}@taac", base.id, trip.slug));
        line(format!("DTSTAMP:{}", base.from.format("%Y%m%dT000000Z")));
        line(format!("DTSTART;VALUE=DATE:{}", base.from.format("%Y%m%d")));
        // All-day DTEND is exclusive: the morning after the last night.
        let end = base
            .to
            .succ_opt()
            .and_then(|d| d.succ_opt())
            .unwrap_or(base.to);
        line(format!("DTEND;VALUE=DATE:{}", end.format("%Y%m%d")));
        line(format!("SUMMARY:📍 {}", escape(&base.title)));
        line(format!("LOCATION:{}", escape(&base.place.name)));
        line(format!("DESCRIPTION:{}", escape(&who.join(", "))));
        line("TRANSP:TRANSPARENT".into());
        line("END:VEVENT".into());
    }

    for blocker in &trip.blockers {
        let members = trip.who(blocker.who.as_deref());
        if !includes(&members) {
            continue;
        }
        for (n, occurrence) in crate::blockers::occurrences(trip, blocker)
            .iter()
            .enumerate()
        {
            line("BEGIN:VEVENT".into());
            line(format!("UID:blocker.{}.{n}.{}@taac", blocker.id, trip.slug));
            line(format!("DTSTAMP:{}", stamp(occurrence.start)));
            line(format!("DTSTART:{}", stamp(occurrence.start)));
            line(format!("DTEND:{}", stamp(occurrence.end)));
            line(format!("SUMMARY:⛔ {}", escape(&blocker.title)));
            line(format!("DESCRIPTION:{}", escape(&members.join(", "))));
            line("TRANSP:OPAQUE".into());
            line("END:VEVENT".into());
        }
    }

    for item in &trip.itinerary {
        if item.kind == ItemKind::Note || !includes(&trip.participants(item)) {
            continue;
        }
        let places = trip.item_places(item);
        let status = match item.booking.as_ref().map(|b| b.status) {
            Some(BookingStatus::Booked | BookingStatus::NotRequired) | None => "CONFIRMED",
            Some(BookingStatus::Required) => "TENTATIVE",
        };

        let mut description = Vec::new();
        if let Some(t) = &item.transport {
            let label: Vec<&str> = [t.carrier.as_deref(), t.number.as_deref()]
                .into_iter()
                .flatten()
                .collect();
            if !label.is_empty() {
                description.push(label.join(" "));
            }
        }
        let participants: Vec<&str> = trip
            .participants(item)
            .into_iter()
            .map(|id| trip.member(id).map_or(id, |m| m.name.as_str()))
            .collect();
        description.push(participants.join(", "));
        for (who, reference) in item.references() {
            let whose = who
                .map(|w| format!(" ({})", names(trip, w)))
                .unwrap_or_default();
            description.push(format!(
                "Ref{whose}: {}",
                secrets::render(reference, reveal)
            ));
        }
        for contact in &item.contacts {
            let mut c = contact.name.clone();
            if let Some(phone) = &contact.phone {
                let _ = write!(c, " {}", secrets::render(phone, reveal));
            }
            description.push(c);
        }
        if places.len() > 1 {
            let route: Vec<&str> = places.iter().map(|(_, p)| p.name.as_str()).collect();
            description.push(route.join(" → "));
        }
        if let Some(notes) = &item.notes {
            description.push(notes.clone());
        }

        line("BEGIN:VEVENT".into());
        line(format!("UID:{}.{}@taac", item.id, trip.slug));
        if let Some((start, end)) = item.span() {
            line(format!("DTSTAMP:{}", stamp(start.with_timezone(&Utc))));
            line(format!("DTSTART:{}", stamp(start.with_timezone(&Utc))));
            line(format!("DTEND:{}", stamp(end.with_timezone(&Utc))));
        } else {
            let day = item.day();
            line(format!("DTSTAMP:{}", day.format("%Y%m%dT000000Z")));
            line(format!("DTSTART;VALUE=DATE:{}", day.format("%Y%m%d")));
            line(format!(
                "DTEND;VALUE=DATE:{}",
                day.succ_opt().unwrap_or(day).format("%Y%m%d")
            ));
        }
        line(format!("SUMMARY:{}", escape(&item.title)));
        if let Some((_, place)) = places.first() {
            line(format!("LOCATION:{}", escape(&place.name)));
            line(format!("GEO:{:.6};{:.6}", place.geo[0], place.geo[1]));
        }
        line(format!("DESCRIPTION:{}", escape(&description.join("\n\n"))));
        line(format!("CATEGORIES:{}", item.kind.as_str().to_uppercase()));
        line(format!("STATUS:{status}"));
        // Free time doesn't make anyone busy.
        if item.kind == ItemKind::Free {
            line("TRANSP:TRANSPARENT".into());
        }
        if let Some(url) = item
            .url
            .as_ref()
            .or(item.booking.as_ref().and_then(|b| b.url.as_ref()))
        {
            line(format!("URL:{url}"));
        }
        line("END:VEVENT".into());
    }
    line("END:VCALENDAR".into());
    out
}

fn stamp(t: chrono::DateTime<Utc>) -> String {
    t.format("%Y%m%dT%H%M%SZ").to_string()
}

fn escape(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace(';', "\\;")
        .replace(',', "\\,")
        .replace("\r\n", "\\n")
        .replace('\n', "\\n")
}

/// Folds at 75 octets without splitting a UTF-8 sequence, CRLF-terminated.
fn fold_into(out: &mut String, line: &str) {
    let mut width = 0;
    for ch in line.chars() {
        let len = ch.len_utf8();
        if width + len > 75 {
            out.push_str("\r\n ");
            width = 1;
        }
        out.push(ch);
        width += len;
    }
    out.push_str("\r\n");
}

/// Member names behind a `who` list.
fn names(trip: &Trip, who: &[String]) -> String {
    trip.who(Some(who))
        .into_iter()
        .map(|id| trip.member(id).map_or(id, |m| m.name.as_str()))
        .collect::<Vec<_>>()
        .join(", ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folds_on_char_boundaries() {
        let mut out = String::new();
        fold_into(&mut out, &"ж".repeat(60));
        for physical in out.split("\r\n").filter(|l| !l.is_empty()) {
            assert!(physical.len() <= 75, "{} octets", physical.len());
        }
    }
}
