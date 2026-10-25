//! iCalendar (RFC 5545).

use std::fmt::Write;

use chrono::Utc;

use crate::loader::Trip;
use crate::model::{BookingStatus, ItemKind};
use crate::secrets::{self, SecretStore};

pub fn generate(trip: &Trip, reveal: Option<&SecretStore>) -> String {
    let mut out = String::new();
    let mut line = |s: String| fold_into(&mut out, &s);
    line("BEGIN:VCALENDAR".into());
    line("VERSION:2.0".into());
    line("PRODID:-//taac//Trip as a Code//EN".into());
    line("CALSCALE:GREGORIAN".into());
    line("METHOD:PUBLISH".into());
    line(format!("X-WR-CALNAME:{}", escape(&trip.metadata.title)));
    line(format!("X-WR-TIMEZONE:{}", trip.metadata.timezone));

    for item in &trip.itinerary {
        if item.kind == ItemKind::Note {
            continue;
        }
        let places = trip.item_places(item);
        let end = item.end.unwrap_or(item.start);
        let status = match item.booking.as_ref().map(|b| b.status) {
            Some(BookingStatus::Booked | BookingStatus::NotRequired) | None => "CONFIRMED",
            Some(BookingStatus::Required) => "TENTATIVE",
            Some(BookingStatus::Cancelled) => "CANCELLED",
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
        if let Some(reference) = item.booking.as_ref().and_then(|b| b.reference.as_ref()) {
            description.push(format!("Ref: {}", secrets::render(reference, reveal)));
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
        line(format!("DTSTAMP:{}", stamp(item.start.with_timezone(&Utc))));
        line(format!("DTSTART:{}", stamp(item.start.with_timezone(&Utc))));
        line(format!("DTEND:{}", stamp(end.with_timezone(&Utc))));
        line(format!("SUMMARY:{}", escape(&item.title)));
        if let Some((_, place)) = places.first() {
            line(format!("LOCATION:{}", escape(&place.name)));
            line(format!("GEO:{:.6};{:.6}", place.geo[0], place.geo[1]));
        }
        line(format!("DESCRIPTION:{}", escape(&description.join("\n\n"))));
        line(format!("CATEGORIES:{}", item.kind.as_str().to_uppercase()));
        line(format!("STATUS:{status}"));
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
