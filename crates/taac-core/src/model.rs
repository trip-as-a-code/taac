//! The `taac/v1alpha4` document model. Every type here is both the serde
//! representation of the YAML and the source of the published JSON Schema.

use chrono::{DateTime, FixedOffset, NaiveDate};
use indexmap::IndexMap;
use rust_decimal::Decimal;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

pub const API_VERSION: &str = "taac/v1alpha4";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, JsonSchema)]
pub enum ApiVersion {
    #[serde(rename = "taac/v1alpha4")]
    V1Alpha4,
}

/// One YAML file of a trip. Nothing in it needs an id: people, groups and
/// blockers are referred to by name or title, places by their key (which is
/// their name). A trip is a single `kind: Trip` file, or a
/// directory holding one `kind: Trip` file plus any number of `kind: TripPart`
/// files whose bases, places, itinerary, ideas, packing and overlays are
/// merged into it.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schemars(title = "taac Trip")]
pub struct TripFile {
    pub api_version: ApiVersion,
    pub kind: TripKind,
    /// Required on `kind: Trip`, forbidden on `kind: TripPart`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<TripMetadata>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub currency: Option<CurrencyConfig>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub members: Vec<Member>,
    /// Named subsets of members travelling together (tracks).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub groups: Vec<Group>,
    /// Where people are, day by day, whether or not anything is planned.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub bases: Vec<Base>,
    /// Reusable places by name; plans, bases and ideas refer to them by it.
    #[serde(default, skip_serializing_if = "IndexMap::is_empty")]
    pub places: IndexMap<String, Place>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub itinerary: Vec<Item>,
    /// Unscheduled things to pick from on the spot.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub ideas: Vec<Idea>,
    /// Time someone is unavailable (work, a call): whole days or a window.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub blockers: Vec<Blocker>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub packing: Vec<PackingCategory>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub map: Option<MapConfig>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, JsonSchema)]
pub enum TripKind {
    Trip,
    TripPart,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TripMetadata {
    /// URL slug; defaults to the trip's file or directory name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(regex(pattern = r"^[a-z0-9][a-z0-9-]*$"))]
    pub slug: Option<String>,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    /// BCP 47 language of the trip's own text (titles, notes), e.g. `en`, `ru`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub locale: Option<String>,
    /// IANA time zone of the destination, e.g. `Asia/Tokyo`.
    pub timezone: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cover: Option<Cover>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Cover {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub emoji: Option<String>,
    /// Hue (0–360) of the generated cover gradient.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(range(min = 0, max = 360))]
    pub hue: Option<u16>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CurrencyConfig {
    /// ISO 4217 code totals and settlements default to. Viewers can switch
    /// the website to another currency; conversion uses live ECB rates.
    #[schemars(regex(pattern = r"^[A-Z]{3}$"))]
    pub base: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Member {
    /// Derived from the name; used in URLs and feeds.
    #[serde(skip_deserializing)]
    #[schemars(skip)]
    pub id: String,
    /// How everyone else refers to this person (`who`, `paidBy`, groups).
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub emoji: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub links: Vec<String>,
    /// ISO 4217 code of the money this person pays with; defaults to the
    /// trip's base currency.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(regex(pattern = r"^[A-Z]{3}$"))]
    pub currency: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Group {
    #[serde(skip_deserializing)]
    #[schemars(skip)]
    pub id: String,
    /// Usable in `who` and `paidBy` like a person's name.
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub emoji: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Member names.
    pub members: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Place {
    /// Only for places written inline in a plan; under `places:` the key is
    /// the name.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub name: String,
    /// `[latitude, longitude]`, WGS 84.
    pub geo: [f64; 2],
    /// Free-form; well-known values get dedicated icons: airport, station,
    /// hotel, ryokan, temple, shrine, garden, nature, museum, shopping,
    /// food, historic, attraction, viewpoint, onsen.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub address: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// Makes the place an area (a city, a valley) of this many metres around
    /// `geo`; bases and ideas use areas.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(range(min = 1))]
    pub radius: Option<u32>,
}

/// A stretch of days spent in one area, by everyone or some of the members.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Base {
    #[serde(skip_deserializing)]
    #[schemars(skip)]
    pub id: String,
    pub title: String,
    /// Name of an area in `places`.
    pub place: String,
    /// First night here.
    #[schemars(with = "String", extend("format" = "date"))]
    pub from: NaiveDate,
    /// Last night here (inclusive).
    #[schemars(with = "String", extend("format" = "date"))]
    pub to: NaiveDate,
    /// Names of members and/or groups, or `everyone`; omitted means everyone.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub who: Option<Vec<String>>,
    /// Markdown.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

/// Something worth doing, without a date: decided on the spot.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Idea {
    #[serde(skip_deserializing)]
    #[schemars(skip)]
    pub id: String,
    pub title: String,
    #[serde(default = "default_idea_kind")]
    pub kind: ItemKind,
    /// Name of the area (in `places`) the idea belongs to; days spent in a base
    /// on that area surface it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub area: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub places: Vec<PlaceRef>,
    /// Names of members and/or groups, or `everyone`; omitted means everyone.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub who: Option<Vec<String>>,
    #[serde(default)]
    pub priority: Priority,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration: Option<IdeaDuration>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub booking: Option<Booking>,
    /// Usually `estimate: true`; counted as possible spend only.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub costs: Vec<Cost>,
    /// Markdown.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
}

fn default_idea_kind() -> ItemKind {
    ItemKind::Activity
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum Priority {
    Must,
    #[default]
    Maybe,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum IdeaDuration {
    Hour,
    HalfDay,
    Day,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum DayPart {
    Morning,
    Afternoon,
    Evening,
}

impl DayPart {
    /// Representative wall-clock minute, for ordering within a day.
    pub fn minute(self) -> u32 {
        match self {
            Self::Morning => 9 * 60,
            Self::Afternoon => 14 * 60,
            Self::Evening => 19 * 60,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Morning => "morning",
            Self::Afternoon => "afternoon",
            Self::Evening => "evening",
        }
    }
}

/// Unavailable time, repeating over one or more date periods.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Blocker {
    #[serde(skip_deserializing)]
    #[schemars(skip)]
    pub id: String,
    /// Plans name it in `overrides`.
    pub title: String,
    /// Names of members and/or groups, or `everyone`; omitted means everyone.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub who: Option<Vec<String>>,
    /// Inclusive date ranges, in the blocker's time zone.
    pub periods: Vec<Period>,
    /// Weekdays it applies on; omitted means every day.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub days: Vec<Weekday>,
    /// A daily window; omitted blocks whole days.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time: Option<TimeWindow>,
    /// Conflicts are errors rather than warnings.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub strict: bool,
    /// Markdown.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Period {
    #[schemars(with = "String", extend("format" = "date"))]
    pub from: NaiveDate,
    #[schemars(with = "String", extend("format" = "date"))]
    pub to: NaiveDate,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TimeWindow {
    /// `HH:MM`.
    #[schemars(regex(pattern = r"^([01][0-9]|2[0-3]):[0-5][0-9]$"))]
    pub start: String,
    /// `HH:MM`; at or before `start` means the next day (`24:00` allowed).
    #[schemars(regex(pattern = r"^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$"))]
    pub end: String,
    /// IANA zone the times are in; defaults to the trip's.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timezone: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum Weekday {
    Mon,
    Tue,
    Wed,
    Thu,
    Fri,
    Sat,
    Sun,
}

impl Weekday {
    pub fn matches(self, day: chrono::Weekday) -> bool {
        use chrono::Weekday as W;
        matches!(
            (self, day),
            (Self::Mon, W::Mon)
                | (Self::Tue, W::Tue)
                | (Self::Wed, W::Wed)
                | (Self::Thu, W::Thu)
                | (Self::Fri, W::Fri)
                | (Self::Sat, W::Sat)
                | (Self::Sun, W::Sun)
        )
    }
}

/// A place's name from `places`, or a place declared inline.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, JsonSchema)]
#[serde(untagged)]
pub enum PlaceRef {
    Key(String),
    Inline(Place),
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Item {
    #[serde(skip_deserializing)]
    #[schemars(skip)]
    pub id: String,
    pub kind: ItemKind,
    pub title: String,
    /// RFC 3339 with the local offset of where it happens. Set this, or
    /// `date` for plans without a fixed time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(with = "Option<String>", extend("format" = "date-time"))]
    pub start: Option<DateTime<FixedOffset>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(with = "Option<String>", extend("format" = "date-time"))]
    pub end: Option<DateTime<FixedOffset>>,
    /// A day without a time; not for lodging or transport.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(with = "Option<String>", extend("format" = "date"))]
    pub date: Option<NaiveDate>,
    /// Rough time of day for a `date`-only item.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub part: Option<DayPart>,
    /// Ordered stops: origin → destination for transport, venues otherwise.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub places: Vec<PlaceRef>,
    /// Names of members and/or groups, or `everyone`; omitted means everyone.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub who: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transport: Option<Transport>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub booking: Option<Booking>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub costs: Vec<Cost>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub contacts: Vec<Contact>,
    /// Markdown.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    /// Titles of blockers this plan may run through, e.g. a train with good
    /// Wi-Fi during work hours.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub overrides: Vec<String>,
}

impl Item {
    /// The wall-clock day it happens on (in its own offset).
    pub fn day(&self) -> NaiveDate {
        self.start
            .map(|s| s.date_naive())
            .or(self.date)
            .unwrap_or_default()
    }

    /// Orders items within and across days: day, then wall-clock minute.
    pub fn sort_key(&self) -> (NaiveDate, u32) {
        use chrono::Timelike;
        let minute = match (self.start, self.part) {
            (Some(start), _) => start.hour() * 60 + start.minute(),
            (None, Some(part)) => part.minute(),
            (None, None) => 12 * 60,
        };
        (self.day(), minute)
    }

    /// Both ends when the item has real times.
    pub fn span(&self) -> Option<(DateTime<FixedOffset>, DateTime<FixedOffset>)> {
        self.start.map(|start| (start, self.end.unwrap_or(start)))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum ItemKind {
    Flight,
    Train,
    Bus,
    Ferry,
    Transfer,
    Lodging,
    Activity,
    Meal,
    Note,
}

impl ItemKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Flight => "flight",
            Self::Train => "train",
            Self::Bus => "bus",
            Self::Ferry => "ferry",
            Self::Transfer => "transfer",
            Self::Lodging => "lodging",
            Self::Activity => "activity",
            Self::Meal => "meal",
            Self::Note => "note",
        }
    }

    pub fn is_transport(self) -> bool {
        matches!(
            self,
            Self::Flight | Self::Train | Self::Bus | Self::Ferry | Self::Transfer
        )
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Transport {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub carrier: Option<String>,
    /// Flight or train number, e.g. `AY61`, `Hikari 645`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub number: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Booking {
    pub status: BookingStatus,
    /// Book by this date.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(with = "Option<String>", extend("format" = "date"))]
    pub deadline: Option<NaiveDate>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// Confirmation number / PNR. Never published.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reference: Option<Secret>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum BookingStatus {
    /// Needs a reservation that has not been made yet.
    Required,
    Booked,
    NotRequired,
    Cancelled,
}

impl BookingStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Required => "required",
            Self::Booked => "booked",
            Self::NotRequired => "notRequired",
            Self::Cancelled => "cancelled",
        }
    }
}

/// A confidential value, resolved by name from `.env`, `secrets.yaml` or the
/// environment. Only local builds run with `--reveal` ever see it.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Secret {
    #[schemars(regex(pattern = r"^[A-Z][A-Z0-9_]*$"))]
    pub secret: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Contact {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phone: Option<Secret>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<Secret>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Cost {
    /// The price, in the currency it is quoted in.
    #[schemars(with = "f64")]
    pub amount: Decimal,
    #[schemars(regex(pattern = r"^[A-Z]{3}$"))]
    pub currency: String,
    /// What actually left the payer's account once booked, in their own
    /// currency. Required for booked costs in a foreign currency; until then
    /// the website estimates with the current rate.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub charged: Option<Money>,
    /// Who paid: a member, a list of members and/or groups sharing the
    /// payment equally, or `each` — everyone paid their own share. Omitted
    /// means nobody has paid yet: it counts as planned spend and nobody
    /// owes anybody for it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub paid_by: Option<PaidBy>,
    /// Who the cost is for; defaults to the item's participants.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub who: Option<Vec<String>>,
    /// How it divides among `who`.
    #[serde(default)]
    pub split: Split,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// A guess rather than a quote.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub estimate: bool,
    /// Whether the others have paid the payer back. Travellers usually
    /// square up on the spot, so a paid cost is settled unless this says
    /// `false`: only then does someone owe someone for it.
    #[serde(default = "yes", skip_serializing_if = "is_yes")]
    pub settled: bool,
}

fn yes() -> bool {
    true
}

#[expect(
    clippy::trivially_copy_pass_by_ref,
    reason = "serde's skip_serializing_if signature"
)]
fn is_yes(value: &bool) -> bool {
    *value
}

impl Cost {
    /// Somebody paid already (or everybody, for themselves).
    pub fn is_paid(&self) -> bool {
        self.paid_by.is_some()
    }

    /// Everyone paid their own share.
    pub fn is_each(&self) -> bool {
        self.paid_by.as_ref().is_some_and(PaidBy::is_each)
    }

    /// Names (ids once loaded) of whoever paid; empty for `each` or unpaid.
    pub fn payers(&self) -> Vec<String> {
        self.paid_by.as_ref().map(PaidBy::ids).unwrap_or_default()
    }

    /// Someone still owes someone for it.
    pub fn owed(&self) -> bool {
        self.is_paid() && !self.is_each() && !self.settled
    }
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Money {
    #[schemars(with = "f64")]
    pub amount: Decimal,
    #[schemars(regex(pattern = r"^[A-Z]{3}$"))]
    pub currency: String,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, JsonSchema)]
#[serde(untagged)]
pub enum PaidBy {
    /// One member's (or group's) name, or `each`.
    One(String),
    /// Members' and/or groups' names; they split the payment equally.
    Many(Vec<String>),
}

impl PaidBy {
    /// Every beneficiary paid their own share.
    pub fn is_each(&self) -> bool {
        matches!(self, Self::One(id) if id == "each")
    }

    pub fn ids(&self) -> Vec<String> {
        match self {
            Self::One(id) if id == "each" => Vec::new(),
            Self::One(id) => vec![id.clone()],
            Self::Many(ids) => ids.clone(),
        }
    }
}

/// How a cost is shared among the item's participants.
#[derive(Debug, Clone, PartialEq, Default, Deserialize, Serialize, JsonSchema)]
#[serde(from = "SplitRepr", into = "SplitRepr")]
#[schemars(with = "SplitRepr")]
pub enum Split {
    #[default]
    Equal,
    Personal,
    Shares(IndexMap<String, Decimal>),
    Exact(IndexMap<String, Decimal>),
}

/// YAML has no externally tagged enums without `!tags`, so a split is a
/// keyword or a single-key map.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(untagged)]
enum SplitRepr {
    Keyword(SplitKeyword),
    Shares {
        /// Proportional weights by member name.
        #[schemars(with = "IndexMap<String, f64>")]
        shares: IndexMap<String, Decimal>,
    },
    Exact {
        /// Exact amounts by member name, in the cost's currency; must sum to it.
        #[schemars(with = "IndexMap<String, f64>")]
        exact: IndexMap<String, Decimal>,
    },
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
enum SplitKeyword {
    /// Evenly among participants.
    Equal,
    /// Borne by the payer alone.
    Personal,
}

impl From<SplitRepr> for Split {
    fn from(repr: SplitRepr) -> Self {
        match repr {
            SplitRepr::Keyword(SplitKeyword::Equal) => Self::Equal,
            SplitRepr::Keyword(SplitKeyword::Personal) => Self::Personal,
            SplitRepr::Shares { shares } => Self::Shares(shares),
            SplitRepr::Exact { exact } => Self::Exact(exact),
        }
    }
}

impl From<Split> for SplitRepr {
    fn from(split: Split) -> Self {
        match split {
            Split::Equal => Self::Keyword(SplitKeyword::Equal),
            Split::Personal => Self::Keyword(SplitKeyword::Personal),
            Split::Shares(shares) => Self::Shares { shares },
            Split::Exact(exact) => Self::Exact { exact },
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackingCategory {
    pub category: String,
    /// Default for the category's items: names of members and/or groups;
    /// omitted means everyone packs it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub who: Option<Vec<String>>,
    pub items: Vec<PackingItem>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(untagged)]
pub enum PackingItem {
    Name(String),
    Detailed {
        name: String,
        /// Names of members and/or groups who pack it; defaults to the category's.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        who: Option<Vec<String>>,
        /// What it costs to get before packing; counts in the budget. `who`
        /// defaults to the item's packers.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        costs: Vec<Cost>,
        /// Already bought: its costs count as committed.
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        bought: bool,
    },
}

impl PackingItem {
    pub fn name(&self) -> &str {
        match self {
            Self::Name(name) | Self::Detailed { name, .. } => name,
        }
    }

    pub fn who(&self) -> Option<&[String]> {
        match self {
            Self::Name(_) => None,
            Self::Detailed { who, .. } => who.as_deref(),
        }
    }

    pub fn costs(&self) -> &[Cost] {
        match self {
            Self::Name(_) => &[],
            Self::Detailed { costs, .. } => costs,
        }
    }

    pub fn bought(&self) -> bool {
        matches!(self, Self::Detailed { bought: true, .. })
    }
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MapConfig {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub overlays: Vec<Overlay>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Overlay {
    pub name: String,
    /// `GeoJSON` file, relative to the trip directory.
    pub file: String,
}

/// The deployment: which trips it serves and who may see them.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schemars(title = "taac Site")]
pub struct SiteFile {
    pub api_version: ApiVersion,
    pub kind: SiteKind,
    pub metadata: SiteMetadata,
    pub trips: Vec<SiteTrip>,
    /// Password-protects the whole site.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub access: Option<Access>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, JsonSchema)]
pub enum SiteKind {
    Site,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SiteMetadata {
    pub title: Text,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<Text>,
}

/// Text shown in the interface: one string for every language, or one per
/// language (`{ en: …, ru: … }`), falling back to English, then the first.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize, JsonSchema)]
#[serde(untagged)]
pub enum Text {
    Plain(String),
    Localized(IndexMap<String, String>),
}

impl Text {
    pub fn get(&self, lang: &str) -> &str {
        match self {
            Self::Plain(text) => text,
            Self::Localized(map) => map
                .get(lang)
                .or_else(|| map.get("en"))
                .or_else(|| map.values().next())
                .map_or("", String::as_str),
        }
    }
}

impl From<String> for Text {
    fn from(text: String) -> Self {
        Self::Plain(text)
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SiteTrip {
    /// Trip file or directory, relative to the site file.
    pub path: String,
    /// Password-protects this trip only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub access: Option<Access>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Access {
    /// Worker secret holding the password.
    pub password: Secret,
}
