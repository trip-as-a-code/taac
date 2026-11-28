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
                .map_or_default(|d| format!(" — by {d}"));
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
            let _ = writeln!(out, "### {}\n", date.strftime("%a %-d %b %Y"));
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
            crate::datetime::OffsetDateTime::format_hm,
        );
        let until = item.end.map_or_default(|e| format!("–{}", e.format_hm()));
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
            let whose = who.map_or_default(|w| {
                let names: Vec<&str> = trip
                    .who(Some(w))
                    .into_iter()
                    .map(|id| trip.member(id).map_or(id, |m| m.name.as_str()))
                    .collect();
                format!(" ({})", names.join(", "))
            });
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
                .map_or_default(|p| format!(" — {}", p.name));
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

    if !trip.passes.is_empty() {
        let _ = writeln!(out, "## Passes\n");
        for pass in &trip.passes {
            let area = trip
                .places
                .get(&pass.area)
                .map_or(pass.area.as_str(), |p| p.name.as_str());
            let days: Vec<String> = pass
                .shares()
                .iter()
                .flat_map(|share| share.periods)
                .map(|p| format!("{} – {}", p.from, p.to))
                .collect();
            let mut line = format!("- {} — {area}, {}", pass.title, days.join(", "));
            if let Some(provider) = &pass.provider {
                let _ = write!(line, " · {provider}");
            }
            let _ = writeln!(out, "{line}");
        }
        out.push('\n');
    }

    if !trip.tasks.is_empty() {
        let _ = writeln!(out, "## Tasks\n");
        for task in &trip.tasks {
            let check = if task.done.is_some() { 'x' } else { ' ' };
            let mut line = format!("- [{check}] {}", task.title);
            if task.required {
                line.push_str(" (required)");
            }
            let who = trip.who(task.who.as_deref());
            if who.len() < trip.members.len() {
                let names: Vec<&str> = who
                    .iter()
                    .map(|id| trip.member(id).map_or(*id, |m| m.name.as_str()))
                    .collect();
                let _ = write!(line, " — {}", names.join(", "));
            }
            match (task.done, task.due) {
                (Some(done), _) => {
                    let _ = write!(line, " · done {done}");
                }
                (None, Some(due)) => {
                    let _ = write!(line, " · due {due}");
                }
                _ => {}
            }
            let _ = writeln!(out, "{line}");
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
