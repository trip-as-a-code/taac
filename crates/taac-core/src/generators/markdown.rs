//! Offline Markdown itinerary (GitHub Flavored Markdown).

use std::fmt::Write;

use crate::budget;
use crate::export::date_range;
use crate::loader::Trip;
use crate::model::BookingStatus;
use crate::secrets::{self, SecretStore};

pub fn generate(trip: &Trip, reveal: Option<&SecretStore>) -> String {
    let mut out = String::new();
    let name = |id: &str| trip.member(id).map_or(id.to_owned(), |m| m.name.clone());
    let _ = writeln!(out, "# {}\n", trip.metadata.title);
    if let Some(summary) = &trip.metadata.summary {
        let _ = writeln!(out, "{summary}\n");
    }
    if let (Some(start), Some(end)) = date_range(trip) {
        let _ = writeln!(out, "**{start} → {end}** · {}\n", trip.metadata.timezone);
    }
    let members: Vec<String> = trip.members.iter().map(|m| m.name.clone()).collect();
    let _ = writeln!(out, "**Travellers:** {}\n", members.join(", "));

    let open: Vec<_> = trip
        .itinerary
        .iter()
        .filter(|i| {
            i.booking
                .as_ref()
                .is_some_and(|b| b.status == BookingStatus::Required)
        })
        .collect();
    if !open.is_empty() {
        let _ = writeln!(out, "## To book\n");
        let mut open = open;
        open.sort_by_key(|i| i.booking.as_ref().and_then(|b| b.deadline));
        for item in open {
            let deadline = item
                .booking
                .as_ref()
                .and_then(|b| b.deadline)
                .map(|d| format!(" — by {d}"))
                .unwrap_or_default();
            let _ = writeln!(out, "- [ ] {}{deadline}", item.title);
        }
        out.push('\n');
    }

    let _ = writeln!(out, "## Itinerary\n");
    let bases = trip.bases();
    let mut current = None;
    for item in &trip.itinerary {
        let date = item.day();
        if current != Some(date) {
            let _ = writeln!(out, "### {}\n", date.format("%a %-d %b %Y"));
            let here: Vec<String> = bases
                .iter()
                .filter(|b| !b.derived && b.from <= date && date <= b.to)
                .map(|b| b.title.clone())
                .collect();
            if !here.is_empty() {
                let _ = writeln!(out, "📍 {}\n", here.join(" · "));
            }
            current = Some(date);
        }
        let time = item.start.map_or_else(
            || item.part.map_or("—", |p| p.as_str()).to_owned(),
            |s| s.format("%H:%M").to_string(),
        );
        let until = item
            .end
            .map(|e| format!("–{}", e.format("%H:%M")))
            .unwrap_or_default();
        let who: Vec<String> = trip.participants(item).into_iter().map(name).collect();
        let _ = writeln!(
            out,
            "- **{time}{until}** {} _({})_",
            item.title,
            who.join(", ")
        );
        let places: Vec<String> = trip
            .item_places(item)
            .into_iter()
            .map(|(_, p)| p.name.clone())
            .collect();
        if !places.is_empty() {
            let _ = writeln!(out, "  - 📍 {}", places.join(" → "));
        }
        for (who, reference) in item.references() {
            let whose = who
                .map(|w| {
                    let names: Vec<&str> = trip
                        .who(Some(w))
                        .into_iter()
                        .map(|id| trip.member(id).map_or(id, |m| m.name.as_str()))
                        .collect();
                    format!(" ({})", names.join(", "))
                })
                .unwrap_or_default();
            let _ = writeln!(out, "  - 🎫{whose} {}", secrets::render(reference, reveal));
        }
        if let Some(notes) = &item.notes {
            let _ = writeln!(out, "  - {}", notes.replace('\n', "\n    "));
        }
    }
    out.push('\n');

    if !trip.ideas.is_empty() {
        let _ = writeln!(out, "## Ideas\n");
        for idea in &trip.ideas {
            let area = idea
                .area
                .as_ref()
                .and_then(|a| trip.places.get(a))
                .map(|p| format!(" — {}", p.name))
                .unwrap_or_default();
            let must = if idea.priority == crate::model::Priority::Must {
                " ⭐"
            } else {
                ""
            };
            let _ = writeln!(out, "- [ ] {}{must}{area}", idea.title);
        }
        out.push('\n');
    }

    let budget = budget::compute(trip);
    // Per currency the money moved in: converting would need a rate, and a
    // file has no "today".
    for (currency, totals) in &budget.by_currency {
        let _ = writeln!(out, "## Budget ({currency})\n");
        let _ = writeln!(
            out,
            "| Member | Paid | Share | Balance |\n|---|---:|---:|---:|"
        );
        for m in totals
            .members
            .iter()
            .filter(|m| !m.paid.planned.is_zero() || !m.share.planned.is_zero())
        {
            let _ = writeln!(
                out,
                "| {} | {:.2} | {:.2} | {:+.2} |",
                name(&m.member),
                m.paid.planned,
                m.share.planned,
                m.balance
            );
        }
        let _ = writeln!(
            out,
            "\n**Total:** {:.2} planned, {:.2} booked\n",
            totals.total.planned, totals.total.committed
        );
        for s in &totals.settlements {
            let _ = writeln!(
                out,
                "- {} → {}: {:.2} {currency}",
                name(&s.from),
                name(&s.to),
                s.amount
            );
        }
        out.push('\n');
    }

    if !trip.packing.is_empty() {
        let _ = writeln!(out, "## Packing\n");
        for category in &trip.packing {
            let _ = writeln!(out, "### {}\n", category.category);
            for item in &category.items {
                let _ = writeln!(out, "- [ ] {}", item.name());
            }
            out.push('\n');
        }
    }
    out
}
