//! The `taac/v1alpha1` document model. Every type here is both the serde
//! representation of the YAML and the source of the published JSON Schema.

use chrono::{DateTime, FixedOffset, NaiveDate};
use indexmap::IndexMap;
use rust_decimal::Decimal;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

pub const API_VERSION: &str = "taac/v1alpha1";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, JsonSchema)]
pub enum ApiVersion {
    #[serde(rename = "taac/v1alpha1")]
    V1Alpha1,
}

/// One YAML file of a trip. A trip is a single `kind: Trip` file, or a
/// directory holding one `kind: Trip` file plus any number of `kind: TripPart`
/// files whose places, itinerary, packing and overlays are merged into it.
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
    /// Reusable places, referenced from items by key.
    #[serde(default, skip_serializing_if = "IndexMap::is_empty")]
    pub places: IndexMap<String, Place>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub itinerary: Vec<Item>,
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
    /// ISO 4217 code every amount is converted to for totals and settlements.
    #[schemars(regex(pattern = r"^[A-Z]{3}$"))]
    pub base: String,
    /// Value of one unit of each foreign currency in `base`, e.g. `JPY: 0.0061`.
    #[serde(default, skip_serializing_if = "IndexMap::is_empty")]
    #[schemars(with = "IndexMap<String, f64>")]
    pub rates: IndexMap<String, Decimal>,
}

impl CurrencyConfig {
    pub fn to_base(&self, amount: Decimal, currency: &str) -> Option<Decimal> {
        if currency == self.base {
            return Some(amount);
        }
        self.rates.get(currency).map(|rate| amount * rate)
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Member {
    #[schemars(regex(pattern = r"^[a-z0-9][a-z0-9_-]*$"))]
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub emoji: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub links: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Group {
    #[schemars(regex(pattern = r"^[a-z0-9][a-z0-9_-]*$"))]
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub emoji: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub members: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Place {
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
}

/// A key into `places`, or a place declared inline.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, JsonSchema)]
#[serde(untagged)]
pub enum PlaceRef {
    Key(String),
    Inline(Place),
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Item {
    #[schemars(regex(pattern = r"^[a-z0-9][a-z0-9_-]*$"))]
    pub id: String,
    pub kind: ItemKind,
    pub title: String,
    /// RFC 3339 with the local offset of where it happens.
    #[schemars(with = "String", extend("format" = "date-time"))]
    pub start: DateTime<FixedOffset>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(with = "Option<String>", extend("format" = "date-time"))]
    pub end: Option<DateTime<FixedOffset>>,
    /// Ordered stops: origin → destination for transport, venues otherwise.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub places: Vec<PlaceRef>,
    /// Participants; defaults to `group`'s members, else everyone.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub members: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
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
    #[schemars(with = "f64")]
    pub amount: Decimal,
    #[schemars(regex(pattern = r"^[A-Z]{3}$"))]
    pub currency: String,
    pub paid_by: String,
    #[serde(default)]
    pub split: Split,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
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
        /// Proportional weights per member.
        #[schemars(with = "IndexMap<String, f64>")]
        shares: IndexMap<String, Decimal>,
    },
    Exact {
        /// Exact amounts per member, in the cost's currency; must sum to it.
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
    pub items: Vec<PackingItem>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(untagged)]
pub enum PackingItem {
    Name(String),
    Detailed {
        name: String,
        /// Who packs it; defaults to everyone.
        #[serde(default, rename = "for", skip_serializing_if = "Vec::is_empty")]
        for_members: Vec<String>,
    },
}

impl PackingItem {
    pub fn name(&self) -> &str {
        match self {
            Self::Name(name) | Self::Detailed { name, .. } => name,
        }
    }

    pub fn for_members(&self) -> &[String] {
        match self {
            Self::Name(_) => &[],
            Self::Detailed { for_members, .. } => for_members,
        }
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
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
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
