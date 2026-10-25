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
    /// Every combination of people that does something together, everyone
    /// and the declared groups first.
    pub parties: Vec<PartyExport>,
    pub places: IndexMap<String, Place>,
    pub bases: Vec<BaseExport>,
    /// Bases were derived from lodging rather than declared.
    pub bases_derived: bool,
    pub items: Vec<ItemExport>,
    pub ideas: Vec<IdeaExport>,
    pub blockers: Vec<BlockerExport>,
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
    /// Id into [`TripExport::parties`].
    pub party: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockerExport {
    pub id: String,
    pub title: String,
    pub members: Vec<String>,
    pub party: String,
    pub strict: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    /// The window as written (`09:00–17:00`) and its zone, if not whole days.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time: Option<crate::model::TimeWindow>,
}

/// A blocker on a given day, in the trip's local time.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayBlocker {
    pub id: String,
    pub members: Vec<String>,
    pub party: String,
    pub whole_day: bool,
    /// `HH:MM` in the trip's zone; `24:00` when it runs to midnight.
    pub start: String,
    pub end: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictExport {
    pub blocker: String,
    pub members: Vec<String>,
    pub overridden: bool,
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
    /// Id into [`TripExport::parties`].
    pub party: String,
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
    /// Id into [`TripExport::parties`].
    pub party: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transport: Option<Transport>,
    /// The plan's overall booking state (a summary when it has several).
    pub booking: BookingExport,
    /// Its reservations when there are several; empty otherwise.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub bookings: Vec<ReservationExport>,
    /// Every cost of the plan, its reservations' included.
    pub costs: Vec<CostExport>,
    pub contacts: Vec<ContactExport>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    pub tags: Vec<String>,
    pub overrides: Vec<String>,
    /// Blockers this plan runs into, for whom, and whether it may.
    pub conflicts: Vec<ConflictExport>,
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

/// One of several reservations behind a plan.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReservationExport {
    /// Member ids it covers.
    pub members: Vec<String>,
    #[serde(flatten)]
    pub booking: BookingExport,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[expect(
    clippy::struct_excessive_bools,
    reason = "flags in the JSON the site reads"
)]
pub struct CostExport {
    #[serde(with = "rust_decimal::serde::float")]
    pub amount: Decimal,
    pub currency: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub charged: Option<budget::MoneyExport>,
    /// Member ids who paid; empty when each paid their own share, or when
    /// nobody has paid yet (`unpaid`).
    pub paid_by: Vec<String>,
    /// Not paid yet: an estimate or a price to pay later.
    pub unpaid: bool,
    /// Paid by `each`.
    pub each: bool,
    /// Member ids the cost is for.
    pub who: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub estimate: bool,
    /// Nobody owes anybody for it (unpaid, `each`, or paid back).
    pub settled: bool,
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
    /// When people are unavailable this day.
    pub blockers: Vec<DayBlocker>,
}

/// A base or lodging item and the members it applies to on a given day.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Presence {
    pub id: String,
    pub members: Vec<String>,
    pub party: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PartyExport {
    /// `everyone`, a group id, or members joined with `+`.
    pub id: String,
    pub members: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
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
    /// Member ids who pack it.
    pub members: Vec<String>,
    /// Its costs are budget lines with `item` = this id.
    pub bought: bool,
}

#[derive(Debug, Serialize)]
pub struct OverlayExport {
    pub name: String,
    pub data: serde_json::Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Artifacts {
    pub ics: String,
    /// One calendar per member, with only their plans.
    pub ics_by_member: IndexMap<String, String>,
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
    let conflicts = crate::blockers::conflicts(trip);
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
                party: trip.party(&trip.participants(item)).id,
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
                costs: item
                    .parts()
                    .iter()
                    .flat_map(|part| {
                        let who = part
                            .who
                            .map_or_else(|| trip.participants(item), |w| trip.who(Some(w)));
                        cost_exports(trip, part.costs, &who)
                    })
                    .collect(),
                bookings: if item.bookings.is_empty() {
                    Vec::new()
                } else {
                    item.bookings
                        .iter()
                        .map(|r| ReservationExport {
                            members: r
                                .who
                                .as_deref()
                                .map_or_else(|| trip.participants(item), |w| trip.who(Some(w)))
                                .into_iter()
                                .map(str::to_owned)
                                .collect(),
                            booking: booking_export(&r.booking()),
                        })
                        .collect()
                },
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
                overrides: item.overrides.clone(),
                conflicts: conflicts
                    .iter()
                    .filter(|c| c.item.id == item.id)
                    .map(|c| ConflictExport {
                        blocker: c.blocker.id.clone(),
                        members: c.members.clone(),
                        overridden: c.overridden,
                    })
                    .collect(),
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
                    .who(idea.who.as_deref())
                    .into_iter()
                    .map(str::to_owned)
                    .collect(),
                party: trip.party(&trip.who(idea.who.as_deref())).id,
                priority: idea.priority,
                duration: idea.duration,
                booking: idea.booking.as_ref().map(booking_export),
                costs: cost_exports(trip, &idea.costs, &trip.who(idea.who.as_deref())),
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
        }),
        members: trip.members.clone(),
        groups: trip.groups.clone(),
        parties: parties(trip, &bases),
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
                party: party_of(trip, &b.members),
                notes: b.notes.clone(),
            })
            .collect(),
        bases_derived: trip.declared_bases.is_empty(),
        items,
        ideas,
        blockers: trip
            .blockers
            .iter()
            .map(|b| {
                let members: Vec<String> = trip
                    .who(b.who.as_deref())
                    .into_iter()
                    .map(str::to_owned)
                    .collect();
                BlockerExport {
                    id: b.id.clone(),
                    title: b.title.clone(),
                    party: party_of(trip, &members),
                    members,
                    strict: b.strict,
                    notes: b.notes.clone(),
                    time: b.time.clone(),
                }
            })
            .collect(),
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
                        id: packing_id(&category.category, item.name()),
                        name: item.name().to_owned(),
                        members: trip
                            .who(item.who().or(category.who.as_deref()))
                            .into_iter()
                            .map(str::to_owned)
                            .collect(),
                        bought: item.bought(),
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
            ics: generators::ics::generate(trip, None, None),
            ics_by_member: trip
                .members
                .iter()
                .map(|m| {
                    (
                        m.id.clone(),
                        generators::ics::generate(trip, None, Some(&m.id)),
                    )
                })
                .collect(),
            geojson: generators::geojson::generate(trip),
            beancount: generators::beancount::generate(trip),
            markdown: generators::markdown::generate(trip, None),
        },
        diagnostics,
    }
}

/// Blocker occurrences that start on `date` in the trip's zone.
fn day_blockers(trip: &Trip, date: NaiveDate) -> Vec<DayBlocker> {
    let Ok(tz) = trip.metadata.timezone.parse::<chrono_tz::Tz>() else {
        return Vec::new();
    };
    trip.blockers
        .iter()
        .flat_map(|b| crate::blockers::occurrences(trip, b))
        .filter(|o| o.start.with_timezone(&tz).date_naive() == date)
        .map(|o| {
            let members: Vec<String> = trip
                .who(o.blocker.who.as_deref())
                .into_iter()
                .map(str::to_owned)
                .collect();
            let start = o.start.with_timezone(&tz);
            let end = o.end.with_timezone(&tz);
            DayBlocker {
                id: o.blocker.id.clone(),
                party: party_of(trip, &members),
                members,
                whole_day: o.whole_day,
                start: start.format("%H:%M").to_string(),
                end: if end.date_naive() > date && end.format("%H:%M").to_string() == "00:00" {
                    "24:00".to_owned()
                } else {
                    end.format("%H:%M").to_string()
                },
            }
        })
        .collect()
}

fn party_of(trip: &Trip, members: &[String]) -> String {
    let refs: Vec<&str> = members.iter().map(String::as_str).collect();
    trip.party(&refs).id
}

/// Everyone, then declared groups, then ad-hoc combinations in order of appearance.
fn parties(trip: &Trip, bases: &[crate::loader::ResolvedBase]) -> Vec<PartyExport> {
    let everyone: Vec<&str> = trip.members.iter().map(|m| m.id.as_str()).collect();
    let mut sets: Vec<Vec<&str>> = vec![everyone];
    sets.extend(
        trip.groups
            .iter()
            .map(|g| trip.who(Some(std::slice::from_ref(&g.id)))),
    );
    sets.extend(trip.itinerary.iter().map(|i| trip.participants(i)));
    sets.extend(trip.ideas.iter().map(|i| trip.who(i.who.as_deref())));
    sets.extend(
        bases
            .iter()
            .map(|b| b.members.iter().map(String::as_str).collect()),
    );
    let mut out: Vec<PartyExport> = Vec::new();
    for set in sets {
        let party = trip.party(&set);
        if !out.iter().any(|p| p.id == party.id) {
            out.push(PartyExport {
                id: party.id,
                members: party.members,
                group: party.group,
            });
        }
    }
    out
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

fn cost_exports(trip: &Trip, costs: &[Cost], participants: &[&str]) -> Vec<CostExport> {
    costs
        .iter()
        .map(|c| CostExport {
            amount: c.amount,
            currency: c.currency.clone(),
            charged: c.charged.as_ref().map(|m| budget::MoneyExport {
                amount: m.amount,
                currency: m.currency.clone(),
            }),
            paid_by: trip
                .who(Some(&c.payers()))
                .into_iter()
                .map(str::to_owned)
                .collect(),
            unpaid: !c.is_paid(),
            each: c.is_each(),
            who: c
                .who
                .as_deref()
                .map_or_else(|| participants.to_vec(), |w| trip.who(Some(w)))
                .into_iter()
                .map(str::to_owned)
                .collect(),
            label: c.label.clone(),
            estimate: c.estimate,
            settled: !c.owed(),
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
                        party: party_of(trip, &members),
                        members,
                    })
                })
                .collect(),
            blockers: day_blockers(trip, date),
            bases: bases
                .iter()
                .filter(|b| b.from <= date && date <= b.to)
                .map(|b| Presence {
                    id: b.id.clone(),
                    members: b.members.clone(),
                    party: party_of(trip, &b.members),
                })
                .collect(),
        });
        date += Duration::days(1);
    }
    out
}

/// FNV-1a, hex. Only needs to be stable, not secure.
/// A packing item's id: stable across reorderings.
pub(crate) fn packing_id(category: &str, name: &str) -> String {
    stable_id(&format!("{category}\u{0}{name}"))
}

fn stable_id(input: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in input.bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{hash:016x}")
}
