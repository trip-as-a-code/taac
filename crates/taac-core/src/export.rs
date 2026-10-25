//! The JSON the web frontend renders. Confidential values never reach it:
//! secrets are reduced to "has one" flags.

use chrono::{DateTime, Duration, FixedOffset, NaiveDate};
use indexmap::IndexMap;
use rust_decimal::Decimal;
use serde::Serialize;

use crate::budget::{self, Budget};
use crate::diagnostics::Diagnostic;
use crate::generators;
use crate::loader::{Site, Trip};
use crate::model::{
    Booking, BookingStatus, Cost, Cover, DayPart, Group, IdeaDuration, ItemKind, Member, Place,
    Priority, Text, Transport,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteExport {
    pub api_version: &'static str,
    pub site: SiteInfo,
    pub trips: Vec<TripExport>,
    pub diagnostics: Vec<Diagnostic>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteInfo {
    pub title: Text,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<Text>,
    /// Worker secret name guarding the whole site, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password_secret: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TripExport {
    pub slug: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locale: Option<String>,
    pub timezone: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover: Option<Cover>,
    pub tags: Vec<String>,
    /// Worker secret name guarding this trip, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password_secret: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_date: Option<NaiveDate>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_date: Option<NaiveDate>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub currency: Option<CurrencyExport>,
    pub members: Vec<Member>,
    pub groups: Vec<Group>,
    pub places: IndexMap<String, Place>,
    pub bases: Vec<BaseExport>,
    /// Bases were derived from lodging rather than declared.
    pub bases_derived: bool,
    pub items: Vec<ItemExport>,
    pub ideas: Vec<IdeaExport>,
    pub days: Vec<DayExport>,
    pub budget: Budget,
    pub packing: Vec<PackingCategoryExport>,
    pub overlays: Vec<OverlayExport>,
    pub artifacts: Artifacts,
    pub diagnostics: Vec<Diagnostic>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrencyExport {
    pub base: String,
    pub rates: IndexMap<String, f64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BaseExport {
    pub id: String,
    pub title: String,
    pub place: String,
    pub from: NaiveDate,
    pub to: NaiveDate,
    pub nights: i64,
    pub members: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeaExport {
    pub id: String,
    pub title: String,
    pub kind: ItemKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub area: Option<String>,
    pub places: Vec<String>,
    pub members: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    pub priority: Priority,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<IdeaDuration>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub booking: Option<BookingExport>,
    pub costs: Vec<CostExport>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    pub tags: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemExport {
    pub id: String,
    pub kind: ItemKind,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start: Option<DateTime<FixedOffset>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end: Option<DateTime<FixedOffset>>,
    /// Wall-clock fields in the item's own offset, for display without a
    /// time-zone database in the browser.
    pub local: LocalTimes,
    pub places: Vec<String>,
    pub members: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transport: Option<Transport>,
    pub booking: BookingExport,
    pub costs: Vec<CostExport>,
    pub contacts: Vec<ContactExport>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    pub tags: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalTimes {
    pub date: NaiveDate,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<String>,
    /// Rough time of day for items without a time.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub part: Option<DayPart>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_date: Option<NaiveDate>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_offset: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookingExport {
    pub status: BookingStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deadline: Option<NaiveDate>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    pub has_reference: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CostExport {
    #[serde(with = "rust_decimal::serde::float")]
    pub amount: Decimal,
    pub currency: String,
    #[serde(with = "rust_decimal::serde::float_option")]
    pub base_amount: Option<Decimal>,
    pub paid_by: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub estimate: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactExport {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    pub has_phone: bool,
    pub has_email: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayExport {
    pub date: NaiveDate,
    /// Items starting this day, in order.
    pub items: Vec<String>,
    /// Who sleeps where tonight.
    pub stays: Vec<Presence>,
    /// Which base each person is in tonight.
    pub bases: Vec<Presence>,
}

/// A base or lodging item and the members it applies to on a given day.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Presence {
    pub id: String,
    pub members: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackingCategoryExport {
    pub category: String,
    pub items: Vec<PackingItemExport>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackingItemExport {
    /// Stable across reorderings: a hash of category and name.
    pub id: String,
    pub name: String,
    #[serde(rename = "for")]
    pub for_members: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct OverlayExport {
    pub name: String,
    pub data: serde_json::Value,
}

#[derive(Debug, Serialize)]
pub struct Artifacts {
    pub ics: String,
    pub geojson: String,
    pub beancount: String,
    pub markdown: String,
}

pub fn export_site(site: &Site, diagnostics: Vec<Diagnostic>) -> SiteExport {
    let trips = site
        .trips
        .iter()
        .map(|trip| {
            let trip_diagnostics = diagnostics
                .iter()
                .filter(|d| d.trip.as_deref() == Some(trip.slug.as_str()))
                .cloned()
                .collect();
            export_trip(trip, trip_diagnostics)
        })
        .collect();
    SiteExport {
        api_version: crate::model::API_VERSION,
        site: SiteInfo {
            title: site.metadata.title.clone(),
            description: site.metadata.description.clone(),
            password_secret: site.access.as_ref().map(|a| a.password.secret.clone()),
        },
        trips,
        diagnostics: diagnostics
            .into_iter()
            .filter(|d| d.trip.is_none())
            .collect(),
    }
}

pub fn export_trip(trip: &Trip, diagnostics: Vec<Diagnostic>) -> TripExport {
    let mut places = trip.places.clone();
    let items: Vec<ItemExport> = trip
        .itinerary
        .iter()
        .map(|item| {
            let item_places = trip.item_places(item);
            for (id, place) in &item_places {
                places.entry(id.clone()).or_insert_with(|| (*place).clone());
            }
            ItemExport {
                id: item.id.clone(),
                kind: item.kind,
                title: item.title.clone(),
                start: item.start,
                end: item.end,
                local: LocalTimes {
                    date: item.day(),
                    time: item.start.map(|s| s.format("%H:%M").to_string()),
                    offset: item.start.map(|s| s.format("%:z").to_string()),
                    part: item.part,
                    end_date: item.end.map(|e| e.date_naive()),
                    end_time: item.end.map(|e| e.format("%H:%M").to_string()),
                    end_offset: item.end.map(|e| e.format("%:z").to_string()),
                },
                places: item_places.into_iter().map(|(id, _)| id).collect(),
                members: trip
                    .participants(item)
                    .into_iter()
                    .map(str::to_owned)
                    .collect(),
                group: item.group.clone(),
                transport: item.transport.clone(),
                booking: item.booking.as_ref().map_or(
                    BookingExport {
                        status: BookingStatus::NotRequired,
                        deadline: None,
                        provider: None,
                        url: None,
                        has_reference: false,
                    },
                    booking_export,
                ),
                costs: cost_exports(trip, &item.costs),
                contacts: item
                    .contacts
                    .iter()
                    .map(|c| ContactExport {
                        name: c.name.clone(),
                        role: c.role.clone(),
                        has_phone: c.phone.is_some(),
                        has_email: c.email.is_some(),
                    })
                    .collect(),
                notes: item.notes.clone(),
                url: item.url.clone(),
                tags: item.tags.clone(),
            }
        })
        .collect();

    let ideas = trip
        .ideas
        .iter()
        .map(|idea| {
            let idea_places = trip.idea_places(idea);
            for (id, place) in &idea_places {
                places.entry(id.clone()).or_insert_with(|| (*place).clone());
            }
            IdeaExport {
                id: idea.id.clone(),
                title: idea.title.clone(),
                kind: idea.kind,
                area: idea.area.clone(),
                places: idea_places.into_iter().map(|(id, _)| id).collect(),
                members: trip
                    .who(idea.members.as_deref(), idea.group.as_deref())
                    .into_iter()
                    .map(str::to_owned)
                    .collect(),
                group: idea.group.clone(),
                priority: idea.priority,
                duration: idea.duration,
                booking: idea.booking.as_ref().map(booking_export),
                costs: cost_exports(trip, &idea.costs),
                notes: idea.notes.clone(),
                url: idea.url.clone(),
                tags: idea.tags.clone(),
            }
        })
        .collect();

    let bases = trip.bases();
    for base in &bases {
        places
            .entry(base.place_id.clone())
            .or_insert_with(|| base.place.clone());
    }
    let (start_date, end_date) = date_range(trip);
    let days = days(trip, &bases, start_date, end_date);

    TripExport {
        slug: trip.slug.clone(),
        title: trip.metadata.title.clone(),
        summary: trip.metadata.summary.clone(),
        locale: trip.metadata.locale.clone(),
        timezone: trip.metadata.timezone.clone(),
        cover: trip.metadata.cover.clone(),
        tags: trip.metadata.tags.clone(),
        password_secret: trip.access.as_ref().map(|a| a.password.secret.clone()),
        start_date,
        end_date,
        currency: trip.currency.as_ref().map(|c| CurrencyExport {
            base: c.base.clone(),
            rates: c
                .rates
                .iter()
                .map(|(k, v)| {
                    use rust_decimal::prelude::ToPrimitive;
                    (k.clone(), v.to_f64().unwrap_or_default())
                })
                .collect(),
        }),
        members: trip.members.clone(),
        groups: trip.groups.clone(),
        places,
        bases: bases
            .iter()
            .map(|b| BaseExport {
                id: b.id.clone(),
                title: b.title.clone(),
                place: b.place_id.clone(),
                from: b.from,
                to: b.to,
                nights: (b.to - b.from).num_days() + 1,
                members: b.members.clone(),
                group: b.group.clone(),
                notes: b.notes.clone(),
            })
            .collect(),
        bases_derived: trip.declared_bases.is_empty(),
        items,
        ideas,
        days,
        budget: budget::compute(trip),
        packing: trip
            .packing
            .iter()
            .map(|category| PackingCategoryExport {
                category: category.category.clone(),
                items: category
                    .items
                    .iter()
                    .map(|item| PackingItemExport {
                        id: stable_id(&format!("{}\u{0}{}", category.category, item.name())),
                        name: item.name().to_owned(),
                        for_members: item.for_members().to_vec(),
                    })
                    .collect(),
            })
            .collect(),
        overlays: trip
            .overlays
            .iter()
            .map(|o| OverlayExport {
                name: o.name.clone(),
                data: o.data.clone(),
            })
            .collect(),
        artifacts: Artifacts {
            ics: generators::ics::generate(trip, None),
            geojson: generators::geojson::generate(trip),
            beancount: generators::beancount::generate(trip),
            markdown: generators::markdown::generate(trip, None),
        },
        diagnostics,
    }
}

fn booking_export(b: &Booking) -> BookingExport {
    BookingExport {
        status: b.status,
        deadline: b.deadline,
        provider: b.provider.clone(),
        url: b.url.clone(),
        has_reference: b.reference.is_some(),
    }
}

fn cost_exports(trip: &Trip, costs: &[Cost]) -> Vec<CostExport> {
    costs
        .iter()
        .map(|c| CostExport {
            amount: c.amount,
            currency: c.currency.clone(),
            base_amount: trip
                .currency
                .as_ref()
                .and_then(|cur| cur.to_base(c.amount, &c.currency))
                .map(budget::round),
            paid_by: c.paid_by.clone(),
            label: c.label.clone(),
            estimate: c.estimate,
        })
        .collect()
}

/// First and last wall-clock date touched by any item or base.
pub fn date_range(trip: &Trip) -> (Option<NaiveDate>, Option<NaiveDate>) {
    let bases = trip.bases();
    let start = trip
        .itinerary
        .iter()
        .map(crate::model::Item::day)
        .chain(bases.iter().map(|b| b.from))
        .min();
    let end = trip
        .itinerary
        .iter()
        .map(|i| i.span().map_or(i.day(), |(_, end)| end.date_naive()))
        .chain(bases.iter().map(|b| b.to))
        .max();
    (start, end)
}

fn days(
    trip: &Trip,
    bases: &[crate::loader::ResolvedBase],
    start: Option<NaiveDate>,
    end: Option<NaiveDate>,
) -> Vec<DayExport> {
    let (Some(start), Some(end)) = (start, end) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    let mut date = start;
    while date <= end {
        out.push(DayExport {
            date,
            items: trip
                .itinerary
                .iter()
                .filter(|i| i.day() == date)
                .map(|i| i.id.clone())
                .collect(),
            stays: trip
                .itinerary
                .iter()
                .filter(|i| i.kind == ItemKind::Lodging)
                .filter_map(|i| {
                    let members: Vec<String> = trip
                        .participants(i)
                        .into_iter()
                        .filter(|m| trip.sleeps_at(bases, i, m, date))
                        .map(str::to_owned)
                        .collect();
                    (!members.is_empty()).then(|| Presence {
                        id: i.id.clone(),
                        members,
                    })
                })
                .collect(),
            bases: bases
                .iter()
                .filter(|b| b.from <= date && date <= b.to)
                .map(|b| Presence {
                    id: b.id.clone(),
                    members: b.members.clone(),
                })
                .collect(),
        });
        date += Duration::days(1);
    }
    out
}

/// FNV-1a, hex. Only needs to be stable, not secure.
fn stable_id(input: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in input.bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{hash:016x}")
}
