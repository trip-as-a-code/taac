//! Turns a set of files into a [`Site`]. Input is an in-memory map of
//! `/`-separated relative paths to contents, so the same code runs in the CLI
//! and in WebAssembly.

use std::collections::BTreeMap;

use indexmap::IndexMap;
use serde::de::DeserializeOwned;

use crate::diagnostics::Diagnostic;
use chrono::NaiveDate;

use crate::model::{
    Access, Base, Blocker, CurrencyConfig, Group, Idea, Item, ItemKind, Member, PackingCategory,
    Pass, Place, PlaceRef, SiteFile, SiteKind, SiteMetadata, Source, SourceRepo, Task, TripFile,
    TripKind, TripMetadata,
};

pub type Files = BTreeMap<String, String>;

#[derive(Debug, Clone)]
pub struct Site {
    pub metadata: SiteMetadata,
    pub access: Option<Access>,
    pub source: Option<SourceRepo>,
    pub trips: Vec<Trip>,
}

#[derive(Debug, Clone)]
pub struct Trip {
    pub slug: String,
    /// Directory the trip's relative paths resolve against.
    pub dir: String,
    pub files: Vec<String>,
    pub metadata: TripMetadata,
    pub currency: Option<CurrencyConfig>,
    pub members: Vec<Member>,
    pub groups: Vec<Group>,
    pub places: IndexMap<String, Place>,
    /// As declared; see [`Trip::bases`] for the resolved list.
    pub declared_bases: Vec<Base>,
    pub itinerary: Vec<Item>,
    pub ideas: Vec<Idea>,
    pub blockers: Vec<Blocker>,
    pub tasks: Vec<Task>,
    pub passes: Vec<Pass>,
    pub packing: Vec<PackingCategory>,
    pub overlays: Vec<LoadedOverlay>,
    pub access: Option<Access>,
}

/// A set of people doing something together: everyone, a declared group, or
/// an ad-hoc combination (id `a+b`).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Party {
    pub id: String,
    pub group: Option<String>,
    pub members: Vec<String>,
}

/// A base with its place and participants resolved. Trips without declared
/// bases get one per lodging (`derived`).
#[derive(Debug, Clone)]
pub struct ResolvedBase {
    pub id: String,
    pub title: String,
    pub place_id: String,
    pub place: Place,
    pub from: NaiveDate,
    pub to: NaiveDate,
    pub members: Vec<String>,
    pub notes: Option<String>,
    pub derived: bool,
}

/// In a `who` list: every member, said out loud.
pub const EVERYONE: &str = "everyone";

#[derive(Debug, Clone)]
pub struct LoadedOverlay {
    pub name: String,
    pub data: serde_json::Value,
}

impl Trip {
    pub fn member(&self, id: &str) -> Option<&Member> {
        self.members.iter().find(|m| m.id == id)
    }

    pub fn group(&self, id: &str) -> Option<&Group> {
        self.groups.iter().find(|g| g.id == id)
    }

    /// Effective participants of an item; see [`Trip::who`].
    /// The trip as some of the people see it: the plans, ideas, bases,
    /// blockers, tasks, passes and packing any of them take part in — or, `together`, only
    /// what all of them do. Members, groups and places stay, so names and
    /// shares still resolve.
    #[must_use]
    pub fn for_people(&self, people: &[&str], together: bool) -> Self {
        let mine = |members: Vec<&str>| {
            if together {
                people.iter().all(|p| members.contains(p))
            } else {
                members.iter().any(|m| people.contains(m))
            }
        };
        let mut trip = self.clone();
        trip.itinerary.retain(|i| mine(self.participants(i)));
        trip.ideas.retain(|i| mine(self.who(i.who.as_deref())));
        trip.declared_bases
            .retain(|b| mine(self.who(b.who.as_deref())));
        trip.blockers.retain(|b| mine(self.who(b.who.as_deref())));
        trip.tasks.retain(|t| mine(self.who(t.who.as_deref())));
        trip.passes.retain(|p| mine(self.who(p.who.as_deref())));
        for category in &mut trip.packing {
            let default = category.who.clone();
            category
                .items
                .retain(|i| mine(self.who(i.who().or(default.as_deref()))));
        }
        trip.packing.retain(|c| !c.items.is_empty());
        trip
    }

    pub fn participants(&self, item: &Item) -> Vec<&str> {
        self.who(item.who.as_deref())
    }

    /// Resolves a `who` list (members, groups, `everyone`) to member ids, in
    /// the trip's member order, without duplicates. `None` is everyone.
    pub fn who(&self, who: Option<&[String]>) -> Vec<&str> {
        let Some(who) = who.filter(|w| !w.iter().any(|x| x == EVERYONE)) else {
            return self.members.iter().map(|m| m.id.as_str()).collect();
        };
        let wanted = |id: &str| {
            who.iter().any(|w| {
                w == id
                    || self
                        .group(w)
                        .is_some_and(|g| g.members.iter().any(|m| m == id))
            })
        };
        self.members
            .iter()
            .map(|m| m.id.as_str())
            .filter(|id| wanted(id))
            .collect()
    }

    /// The named or implied party behind a set of members.
    pub fn party(&self, members: &[&str]) -> Party {
        let owned = || members.iter().map(|m| (*m).to_owned()).collect();
        if members.len() == self.members.len() {
            return Party {
                id: "everyone".into(),
                group: None,
                members: owned(),
            };
        }
        let same = |list: &[String]| {
            list.len() == members.len() && list.iter().all(|m| members.contains(&m.as_str()))
        };
        if let Some(group) = self.groups.iter().find(|g| same(&g.members)) {
            return Party {
                id: group.id.clone(),
                group: Some(group.id.clone()),
                members: owned(),
            };
        }
        Party {
            id: members.join("+"),
            group: None,
            members: owned(),
        }
    }

    /// Places of an item with stable ids; inline places get `<item>~<n>`.
    pub fn item_places<'a>(&'a self, item: &'a Item) -> Vec<(String, &'a Place)> {
        self.resolve_places(&item.id, &item.places)
    }

    pub fn idea_places<'a>(&'a self, idea: &'a Idea) -> Vec<(String, &'a Place)> {
        self.resolve_places(&idea.id, &idea.places)
    }

    fn resolve_places<'a>(
        &'a self,
        owner: &str,
        places: &'a [PlaceRef],
    ) -> Vec<(String, &'a Place)> {
        places
            .iter()
            .enumerate()
            .filter_map(|(index, place)| match place {
                PlaceRef::Key(key) => self.places.get(key).map(|p| (key.clone(), p)),
                PlaceRef::Inline(p) => Some((format!("{owner}~{index}"), p)),
            })
            .collect()
    }

    /// Declared bases, or one per lodging when none are declared.
    pub fn bases(&self) -> Vec<ResolvedBase> {
        if !self.declared_bases.is_empty() {
            return self
                .declared_bases
                .iter()
                .filter_map(|b| {
                    let place = self.places.get(&b.place)?;
                    Some(ResolvedBase {
                        id: b.id.clone(),
                        title: b.title.clone(),
                        place_id: b.place.clone(),
                        place: place.clone(),
                        from: b.from,
                        to: b.to,
                        members: self
                            .who(b.who.as_deref())
                            .into_iter()
                            .map(str::to_owned)
                            .collect(),
                        notes: b.notes.clone(),
                        derived: false,
                    })
                })
                .collect();
        }
        self.itinerary
            .iter()
            .filter(|i| i.kind == ItemKind::Lodging)
            .filter_map(|item| {
                let (start, end) = item.span()?;
                let (place_id, place) = self.item_places(item).into_iter().next()?;
                let to = end.date_naive().pred_opt()?;
                Some(ResolvedBase {
                    id: item.id.clone(),
                    title: place.name.clone(),
                    place_id,
                    place: place.clone(),
                    from: start.date_naive(),
                    to: to.max(start.date_naive()),
                    members: self
                        .participants(item)
                        .into_iter()
                        .map(str::to_owned)
                        .collect(),
                    notes: None,
                    derived: true,
                })
            })
            .collect()
    }

    /// Whether `member` sleeps at this lodging on the night of `date`: inside
    /// its dates, and — when bases are declared — inside that night's base area.
    /// A flat kept on while travelling elsewhere doesn't count.
    pub fn sleeps_at(
        &self,
        bases: &[ResolvedBase],
        item: &Item,
        member: &str,
        date: NaiveDate,
    ) -> bool {
        let Some((start, end)) = item.span() else {
            return false;
        };
        if !(start.date_naive() <= date && date < end.date_naive()) {
            return false;
        }
        if self.declared_bases.is_empty() {
            return true;
        }
        let Some(base) = bases
            .iter()
            .find(|b| b.from <= date && date <= b.to && b.members.iter().any(|m| m == member))
        else {
            return true;
        };
        self.item_places(item)
            .first()
            .is_none_or(|(_, place)| within(place, &base.place))
    }
}

/// `place` lies inside `area`: within its radius, or, for a place without
/// one, at that very spot.
pub fn within(place: &Place, area: &Place) -> bool {
    area.radius.map_or(place.name == area.name, |radius| {
        distance_m(place.geo, area.geo) <= f64::from(radius)
    })
}

pub fn distance_m([lat1, lon1]: [f64; 2], [lat2, lon2]: [f64; 2]) -> f64 {
    let rad = std::f64::consts::PI / 180.0;
    let a = ((lat2 - lat1) * rad / 2.0).sin().powi(2)
        + (lat1 * rad).cos() * (lat2 * rad).cos() * ((lon2 - lon1) * rad / 2.0).sin().powi(2);
    12_742_000.0 * a.sqrt().asin()
}

impl Trip {
    pub fn base_currency(&self) -> &str {
        self.currency.as_ref().map_or("EUR", |c| c.base.as_str())
    }
}

/// Loads a site file and every trip it lists.
pub fn load_site(files: &Files, site_path: &str) -> (Option<Site>, Vec<Diagnostic>) {
    let mut diagnostics = Vec::new();
    let Some(content) = files.get(site_path) else {
        diagnostics.push(Diagnostic::error("io", format!("{site_path} not found")));
        return (None, diagnostics);
    };
    let site_file: SiteFile = match parse(content) {
        Ok(site) => site,
        Err(message) => {
            diagnostics.push(Diagnostic::error("parse", message).in_file(site_path));
            return (None, diagnostics);
        }
    };
    debug_assert_eq!(site_file.kind, SiteKind::Site);
    let site_dir = parent(site_path);

    let mut trips = Vec::new();
    for entry in &site_file.trips {
        let path = join(site_dir, &entry.path);
        if let Some(mut trip) = load_trip(files, &path, &mut diagnostics) {
            trip.access.clone_from(&entry.access);
            trips.push(trip);
        }
    }

    let site = Site {
        metadata: site_file.metadata,
        access: site_file.access,
        source: site_file.source,
        trips,
    };
    (Some(site), diagnostics)
}

/// Loads a lone trip (file or directory) as a single-trip site.
pub fn load_standalone_trip(files: &Files, path: &str) -> (Option<Site>, Vec<Diagnostic>) {
    let mut diagnostics = Vec::new();
    let site = load_trip(files, path, &mut diagnostics).map(|trip| Site {
        metadata: SiteMetadata {
            title: trip.metadata.title.clone().into(),
            description: trip.metadata.summary.clone().map(Into::into),
        },
        access: None,
        source: None,
        trips: vec![trip],
    });
    (site, diagnostics)
}

fn load_trip(files: &Files, path: &str, diagnostics: &mut Vec<Diagnostic>) -> Option<Trip> {
    let path = path.trim_end_matches('/');
    let (dir, paths): (String, Vec<&String>) = if is_yaml(path) && files.contains_key(path) {
        (
            parent(path).to_owned(),
            files.keys().filter(|k| *k == path).collect(),
        )
    } else {
        let prefix = if path.is_empty() {
            String::new()
        } else {
            format!("{path}/")
        };
        let paths = files
            .keys()
            .filter(|k| k.starts_with(&prefix) && is_yaml(k))
            .collect();
        (path.to_owned(), paths)
    };
    if paths.is_empty() {
        diagnostics.push(Diagnostic::error("io", format!("no trip files at {path}")));
        return None;
    }

    let mut main: Option<(String, TripFile)> = None;
    let mut parts = Vec::new();
    let mut ok = true;
    for file in paths {
        match parse::<TripFile>(&files[file]) {
            Ok(doc) if doc.kind == TripKind::Trip => {
                if let Some((first, _)) = &main {
                    diagnostics.push(
                        Diagnostic::error(
                            "trip.duplicate",
                            format!("second `kind: Trip` file; {first} is already the trip root"),
                        )
                        .in_file(file.clone()),
                    );
                    ok = false;
                } else {
                    main = Some((file.clone(), doc));
                }
            }
            Ok(doc) => parts.push((file.clone(), doc)),
            Err(message) => {
                diagnostics.push(Diagnostic::error("parse", message).in_file(file.clone()));
                ok = false;
            }
        }
    }
    let Some((main_path, root)) = main else {
        if ok {
            diagnostics.push(Diagnostic::error(
                "trip.root",
                format!("{path} has no `kind: Trip` file"),
            ));
        }
        return None;
    };
    let Some(metadata) = root.metadata.clone() else {
        diagnostics.push(
            Diagnostic::error("trip.metadata", "`kind: Trip` requires `metadata`")
                .in_file(main_path),
        );
        return None;
    };

    let slug = metadata.slug.clone().unwrap_or_else(|| default_slug(path));
    let mut trip = Trip {
        slug: slug.clone(),
        dir: dir.clone(),
        files: std::iter::once(main_path.clone())
            .chain(parts.iter().map(|(p, _)| p.clone()))
            .collect(),
        metadata,
        currency: root.currency.clone(),
        members: Vec::new(),
        groups: Vec::new(),
        places: IndexMap::new(),
        declared_bases: Vec::new(),
        itinerary: Vec::new(),
        ideas: Vec::new(),
        blockers: Vec::new(),
        tasks: Vec::new(),
        passes: Vec::new(),
        packing: Vec::new(),
        overlays: Vec::new(),
        access: None,
    };

    for (file, mut doc) in std::iter::once((main_path, root)).chain(parts) {
        let lines = Lines::of(&files[&file]);
        let at = |list: &[u64], i: usize| {
            list.get(i).map(|&line| Source {
                file: file.clone(),
                line,
            })
        };
        for (i, item) in doc.itinerary.iter_mut().enumerate() {
            item.source = at(&lines.itinerary, i);
        }
        for (i, idea) in doc.ideas.iter_mut().enumerate() {
            idea.source = at(&lines.ideas, i);
        }
        for (i, base) in doc.bases.iter_mut().enumerate() {
            base.source = at(&lines.bases, i);
        }
        if doc.kind == TripKind::TripPart && (doc.metadata.is_some() || doc.currency.is_some()) {
            diagnostics.push(
                Diagnostic::error(
                    "trip.part",
                    "`kind: TripPart` cannot set `metadata` or `currency`",
                )
                .in_file(file.clone())
                .in_trip(&slug),
            );
        }
        trip.members.extend(doc.members);
        trip.groups.extend(doc.groups);
        for (key, mut place) in doc.places {
            if !place.name.is_empty() && place.name != key {
                diagnostics.push(
                    Diagnostic::error(
                        "place.name",
                        format!(
                            "`{key}` sets `name: {}`; under `places:` the key is the name",
                            place.name
                        ),
                    )
                    .in_file(file.clone())
                    .in_trip(&slug),
                );
            }
            place.name.clone_from(&key);
            if trip.places.contains_key(&key) {
                diagnostics.push(
                    Diagnostic::error("place.duplicate", format!("place `{key}` declared twice"))
                        .in_file(file.clone())
                        .in_trip(&slug),
                );
            }
            trip.places.insert(key, place);
        }
        trip.declared_bases.extend(doc.bases);
        for item in &doc.itinerary {
            if !item.bookings.is_empty() && !item.costs.is_empty() {
                diagnostics.push(
                    Diagnostic::error(
                        "item.costs",
                        format!(
                            "`{}` has `bookings`: each cost goes in its reservation, not on the plan",
                            item.title
                        ),
                    )
                    .in_file(file.clone())
                    .in_trip(&slug),
                );
            }
            if item.booking.is_some() && !item.bookings.is_empty() {
                diagnostics.push(
                    Diagnostic::error(
                        "item.bookings",
                        format!(
                            "`{}` has both `booking` and `bookings`; keep one",
                            item.title
                        ),
                    )
                    .in_file(file.clone())
                    .in_trip(&slug),
                );
            }
        }
        trip.itinerary.extend(doc.itinerary);
        trip.ideas.extend(doc.ideas);
        trip.blockers.extend(doc.blockers);
        trip.tasks.extend(doc.tasks);
        trip.passes.extend(doc.passes);
        trip.packing.extend(doc.packing);
        for overlay in doc.map.unwrap_or_default().overlays {
            let overlay_path = join(&dir, &overlay.file);
            match files.get(&overlay_path).map(|s| serde_json::from_str(s)) {
                Some(Ok(data)) => trip.overlays.push(LoadedOverlay {
                    name: overlay.name,
                    data,
                }),
                Some(Err(err)) => diagnostics.push(
                    Diagnostic::error("overlay.parse", format!("{overlay_path}: {err}"))
                        .in_file(file.clone())
                        .in_trip(&slug),
                ),
                None => diagnostics.push(
                    Diagnostic::error("overlay.missing", format!("{overlay_path} not found"))
                        .in_file(file.clone())
                        .in_trip(&slug),
                ),
            }
        }
    }

    resolve_names(&mut trip);
    trip.itinerary.sort_by_key(Item::sort_key);
    trip.declared_bases.sort_by_key(|b| b.from);
    Some(trip)
}

/// A URL- and anchor-safe id from a name or title: lowercase letters and
/// digits (any script) joined by dashes.
pub fn slug(text: &str) -> String {
    let mut out = String::new();
    for c in text.chars().flat_map(char::to_lowercase) {
        if c.is_alphanumeric() {
            out.push(c);
        } else if !out.is_empty() && !out.ends_with('-') {
            out.push('-');
        }
        if out.chars().count() >= 60 {
            break;
        }
    }
    let out = out.trim_end_matches('-');
    if out.is_empty() {
        "x".into()
    } else {
        out.to_owned()
    }
}

/// The first of `candidates` (then `-2`, `-3`, … of the first) not taken yet.
fn unique(candidates: &[String], taken: &mut std::collections::HashSet<String>) -> String {
    let id = candidates
        .iter()
        .find(|c| !taken.contains(*c))
        .cloned()
        .unwrap_or_else(|| {
            let mut n = 2;
            while taken.contains(&format!("{}-{n}", candidates[0])) {
                n += 1;
            }
            format!("{}-{n}", candidates[0])
        });
    taken.insert(id.clone());
    id
}

/// YAML names people, groups, places and blockers the way humans do; the
/// rest of the crate works on ids. This derives every id and rewrites each
/// reference to one. A name that matches nothing stays as written, for
/// validation to report.
fn resolve_names(trip: &mut Trip) {
    use std::collections::{HashMap, HashSet};

    for member in &mut trip.members {
        member.id = slug(&member.name);
    }
    for group in &mut trip.groups {
        group.id = group.name.as_deref().map(slug).unwrap_or_default();
    }
    let mut people: HashMap<String, String> = HashMap::new();
    for (name, id) in trip
        .groups
        .iter()
        .filter_map(|g| Some((g.name.as_ref()?, &g.id)))
        .chain(trip.members.iter().map(|m| (&m.name, &m.id)))
    {
        people.insert(name.to_lowercase(), id.clone());
        people.insert(id.clone(), id.clone());
    }
    let person = |name: &String| -> String {
        if name == EVERYONE || name == "each" {
            return name.clone();
        }
        people
            .get(&name.to_lowercase())
            .cloned()
            .unwrap_or_else(|| name.clone())
    };
    let who = |list: &mut Option<Vec<String>>| {
        for name in list.iter_mut().flatten() {
            *name = person(name);
        }
    };
    let costs = |costs: &mut Vec<crate::model::Cost>| {
        for cost in costs {
            match &mut cost.paid_by {
                Some(crate::model::PaidBy::One(name)) => *name = person(name),
                Some(crate::model::PaidBy::Many(names)) => {
                    for name in names {
                        *name = person(name);
                    }
                }
                None => {}
            }
            who(&mut cost.who);
            if let Some(name) = &mut cost.owed_by {
                *name = person(name);
            }
            if let crate::model::Split::Shares(map) | crate::model::Split::Exact(map) =
                &mut cost.split
            {
                *map = map.drain(..).map(|(name, v)| (person(&name), v)).collect();
            }
        }
    };

    let places: HashMap<String, String> = trip
        .places
        .keys()
        .map(|k| (k.to_lowercase(), k.clone()))
        .collect();
    let place = |name: &mut String| {
        if let Some(key) = places.get(&name.to_lowercase()) {
            name.clone_from(key);
        }
    };
    let place_refs = |refs: &mut Vec<PlaceRef>| {
        for r in refs {
            if let PlaceRef::Key(name) = r {
                place(name);
            }
        }
    };

    for group in &mut trip.groups {
        for name in &mut group.members {
            *name = person(name);
        }
        // Unnamed: known by its members, like any party of them.
        if group.name.is_none() {
            group.id = group.members.join("+");
        }
    }

    let mut taken = HashSet::new();
    for blocker in &mut trip.blockers {
        blocker.id = unique(&[slug(&blocker.title)], &mut taken);
        who(&mut blocker.who);
    }
    let mut taken = HashSet::new();
    for task in &mut trip.tasks {
        task.id = unique(&[slug(&task.title)], &mut taken);
        who(&mut task.who);
    }
    let blockers: HashMap<String, String> = trip
        .blockers
        .iter()
        .flat_map(|b| {
            [
                (b.title.to_lowercase(), b.id.clone()),
                (b.id.clone(), b.id.clone()),
            ]
        })
        .collect();

    let mut taken = HashSet::new();
    for base in &mut trip.declared_bases {
        let title = slug(&base.title);
        base.id = unique(
            &[title.clone(), format!("{title}-{}", base.from)],
            &mut taken,
        );
        place(&mut base.place);
        who(&mut base.who);
    }

    // Plans and ideas share one namespace: both are anchors on the site.
    let mut taken = HashSet::new();
    for item in &mut trip.itinerary {
        let title = slug(&item.title);
        item.id = unique(
            &[title.clone(), format!("{title}-{}", item.day())],
            &mut taken,
        );
        place_refs(&mut item.places);
        who(&mut item.who);
        costs(&mut item.costs);
        for reservation in &mut item.bookings {
            who(&mut reservation.who);
            costs(&mut reservation.costs);
        }
        if !item.bookings.is_empty() {
            item.booking = crate::model::summarize(&item.bookings);
        }
        for name in &mut item.overrides {
            if let Some(id) = blockers.get(&name.to_lowercase()) {
                name.clone_from(id);
            }
        }
    }
    for idea in &mut trip.ideas {
        idea.id = unique(&[slug(&idea.title)], &mut taken);
        if let Some(area) = &mut idea.area {
            place(area);
        }
        place_refs(&mut idea.places);
        who(&mut idea.who);
        costs(&mut idea.costs);
    }

    let mut taken = HashSet::new();
    for pass in &mut trip.passes {
        pass.id = unique(&[slug(&pass.title)], &mut taken);
        place(&mut pass.area);
        who(&mut pass.who);
        costs(&mut pass.costs);
    }

    for category in &mut trip.packing {
        who(&mut category.who);
        for item in &mut category.items {
            if let crate::model::PackingItem::Detailed {
                who: list,
                costs: list_costs,
                ..
            } = item
            {
                who(list);
                costs(list_costs);
            }
        }
    }
}

/// Trip paths a site file lists, relative to the site file's directory.
pub fn site_trip_paths(site_content: &str) -> Result<Vec<String>, String> {
    let site: SiteFile = parse(site_content)?;
    Ok(site.trips.into_iter().map(|t| t.path).collect())
}

/// Overlay files a trip file references, relative to the trip directory.
pub fn overlay_paths(trip_content: &str) -> Vec<String> {
    parse::<TripFile>(trip_content)
        .map(|t| {
            t.map
                .unwrap_or_default()
                .overlays
                .into_iter()
                .map(|o| o.file)
                .collect()
        })
        .unwrap_or_default()
}

/// The line each list entry starts on, read in a second, lenient pass.
#[derive(Default)]
struct Lines {
    itinerary: Vec<u64>,
    ideas: Vec<u64>,
    bases: Vec<u64>,
}

impl Lines {
    fn of(content: &str) -> Self {
        use serde_saphyr::Spanned;
        #[derive(serde::Deserialize)]
        struct Doc {
            #[serde(default)]
            itinerary: Vec<Spanned<serde::de::IgnoredAny>>,
            #[serde(default)]
            ideas: Vec<Spanned<serde::de::IgnoredAny>>,
            #[serde(default)]
            bases: Vec<Spanned<serde::de::IgnoredAny>>,
        }
        let lines = |list: Vec<Spanned<serde::de::IgnoredAny>>| {
            list.iter().map(|e| e.defined.line()).collect()
        };
        parse::<Doc>(content).map_or_else(
            |_| Self::default(),
            |doc| Self {
                itinerary: lines(doc.itinerary),
                ideas: lines(doc.ideas),
                bases: lines(doc.bases),
            },
        )
    }
}

fn parse<T: DeserializeOwned>(content: &str) -> Result<T, String> {
    serde_saphyr::from_str(content).map_err(|err| err.to_string())
}

fn is_yaml(path: &str) -> bool {
    std::path::Path::new(path)
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("yaml") || ext.eq_ignore_ascii_case("yml"))
}

fn default_slug(path: &str) -> String {
    let name = path.rsplit('/').next().unwrap_or(path);
    let name = name
        .strip_suffix(".yaml")
        .or_else(|| name.strip_suffix(".yml"))
        .unwrap_or(name);
    let name = if name == "trip" {
        path.rsplit('/').nth(1).unwrap_or("trip")
    } else {
        name
    };
    name.to_ascii_lowercase()
}

pub fn parent(path: &str) -> &str {
    path.rfind('/').map_or("", |i| &path[..i])
}

/// Joins a relative path onto a directory, resolving `.` and `..`.
pub fn join(dir: &str, relative: &str) -> String {
    let mut parts: Vec<&str> = dir.split('/').filter(|p| !p.is_empty()).collect();
    for segment in relative.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            other => parts.push(other),
        }
    }
    parts.join("/")
}

#[cfg(test)]
mod tests {
    use super::*;

    const TRIP: &str = r"
apiVersion: taac/v1alpha4
kind: Trip
metadata:
  title: Test
  timezone: Europe/Lisbon
members:
  - { name: Ana }
places:
  Home: { geo: [38.7, -9.1] }
itinerary:
  - kind: activity
    title: Second
    start: 2027-05-02T10:00:00+01:00
  - kind: activity
    title: First
    start: 2027-05-01T10:00:00+01:00
    places: [home, { name: Cafe, geo: [38.71, -9.14] }]
";

    const PART: &str = r"
apiVersion: taac/v1alpha4
kind: TripPart
places:
  Park: { geo: [38.72, -9.15] }
";

    fn files(entries: &[(&str, &str)]) -> Files {
        entries
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect()
    }

    #[test]
    fn merges_directory_parts_and_sorts_itinerary() {
        let fs = files(&[
            ("trips/lisbon/trip.yaml", TRIP),
            ("trips/lisbon/places.yaml", PART),
        ]);
        let (site, diagnostics) = load_standalone_trip(&fs, "trips/lisbon");
        assert!(diagnostics.is_empty(), "{diagnostics:?}");
        let trip = &site.unwrap().trips[0];
        assert_eq!(trip.slug, "lisbon");
        assert_eq!(trip.places.len(), 2);
        assert_eq!(trip.itinerary[0].id, "first");
        let places = trip.item_places(&trip.itinerary[0]);
        assert_eq!(places[0].0, "Home");
        assert_eq!(places[0].1.name, "Home");
        assert_eq!(places[1].0, "first~1");
        // Sorted, but still pointing at where each is written.
        let at = |i: usize| trip.itinerary[i].source.clone().map(|s| (s.file, s.line));
        assert_eq!(at(0), Some(("trips/lisbon/trip.yaml".into(), 15)));
        assert_eq!(at(1), Some(("trips/lisbon/trip.yaml".into(), 12)));
    }

    #[test]
    fn rejects_metadata_in_parts() {
        let part = format!("{PART}metadata: {{ title: X, timezone: UTC }}\n");
        let fs = files(&[("t/trip.yaml", TRIP), ("t/extra.yaml", &part)]);
        let (_, diagnostics) = load_standalone_trip(&fs, "t");
        assert!(diagnostics.iter().any(|d| d.code == "trip.part"));
    }

    #[test]
    fn joins_paths() {
        assert_eq!(join("a/b", "../c/./d.yaml"), "a/c/d.yaml");
        assert_eq!(join("", "trips/x"), "trips/x");
    }

    #[test]
    fn slugs_any_script() {
        assert_eq!(slug("Zen & nature"), "zen-nature");
        assert_eq!(slug("Прогулка у пруда!"), "прогулка-у-пруда");
        assert_eq!(slug("…"), "x");
    }

    #[test]
    fn resolves_who_and_names_parties() {
        let trip_yaml = r"
apiVersion: taac/v1alpha4
kind: Trip
metadata: { title: T, timezone: UTC }
members: [{ name: A }, { name: B }, { name: C }]
groups: [{ name: Duo, members: [a, B] }]
";
        let fs = files(&[("trip.yaml", trip_yaml)]);
        let (site, _) = load_standalone_trip(&fs, "trip.yaml");
        let trip = &site.unwrap().trips[0];
        let who = |w: &[&str]| {
            let owned: Vec<String> = w.iter().map(|s| (*s).to_owned()).collect();
            trip.who(Some(&owned))
                .into_iter()
                .map(str::to_owned)
                .collect::<Vec<_>>()
        };
        assert_eq!(trip.groups[0].members, ["a", "b"]);
        assert_eq!(who(&["c", "duo"]), ["a", "b", "c"]);
        assert_eq!(trip.party(&["a", "b"]).id, "duo");
        assert_eq!(trip.party(&["a", "b", "c"]).id, "everyone");
        assert_eq!(trip.party(&["a", "c"]).id, "a+c");
    }

    #[test]
    fn groups_need_no_name() {
        let trip_yaml = r"
apiVersion: taac/v1alpha4
kind: Trip
metadata: { title: T, timezone: UTC }
members: [{ name: A }, { name: B }, { name: C }]
groups: [{ description: The two of them, members: [A, B] }]
";
        let fs = files(&[("trip.yaml", trip_yaml)]);
        let (site, diagnostics) = load_standalone_trip(&fs, "trip.yaml");
        assert!(diagnostics.is_empty(), "{diagnostics:?}");
        let trip = &site.unwrap().trips[0];
        // Known by its members: the party of exactly them is the group.
        assert_eq!(trip.groups[0].id, "a+b");
        let party = trip.party(&["a", "b"]);
        assert_eq!(
            (party.id.as_str(), party.group.as_deref()),
            ("a+b", Some("a+b"))
        );
    }

    #[test]
    fn names_resolve_to_derived_ids() {
        let trip_yaml = r"
apiVersion: taac/v1alpha4
kind: Trip
metadata: { title: T, timezone: UTC }
members: [{ name: Ana Lu }, { name: Bo }]
groups: [{ name: Early birds, members: [Ana Lu, bo] }]
places:
  Old Town: { geo: [1, 2], radius: 1000 }
bases:
  - { title: Stay, place: old town, from: 2027-01-01, to: 2027-01-02 }
blockers:
  - { title: Day job, who: [Bo], periods: [{ from: 2027-01-01, to: 2027-01-02 }] }
itinerary:
  - { kind: activity, title: Walk, date: 2027-01-01, who: [early birds], places: [OLD TOWN], overrides: [day job],
      costs: [{ amount: 4, currency: EUR, paidBy: ana lu, split: { shares: { Ana Lu: 1, Bo: 3 } } }] }
  - { kind: activity, title: Walk, date: 2027-01-02, who: [Bo] }
  - { kind: activity, title: Walk, date: 2027-01-02, who: [Bo] }
";
        let fs = files(&[("trip.yaml", trip_yaml)]);
        let (site, diagnostics) = load_standalone_trip(&fs, "trip.yaml");
        assert!(diagnostics.is_empty(), "{diagnostics:?}");
        let trip = &site.unwrap().trips[0];
        let walk = &trip.itinerary[0];
        assert_eq!(trip.members[0].id, "ana-lu");
        assert_eq!(walk.who.as_deref(), Some(&["early-birds".to_owned()][..]));
        assert_eq!(walk.places, [PlaceRef::Key("Old Town".into())]);
        assert_eq!(walk.overrides, ["day-job"]);
        assert_eq!(trip.declared_bases[0].place, "Old Town");
        let ids: Vec<&str> = trip.itinerary.iter().map(|i| i.id.as_str()).collect();
        assert_eq!(ids, ["walk", "walk-2027-01-02", "walk-2"]);
        match &walk.costs[0].split {
            crate::model::Split::Shares(map) => {
                assert_eq!(map.keys().collect::<Vec<_>>(), ["ana-lu", "bo"]);
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn place_keys_are_names() {
        let trip_yaml = r"
apiVersion: taac/v1alpha4
kind: Trip
metadata: { title: T, timezone: UTC }
places:
  Home: { name: House, geo: [1, 2] }
";
        let fs = files(&[("trip.yaml", trip_yaml)]);
        let (_, diagnostics) = load_standalone_trip(&fs, "trip.yaml");
        assert!(
            diagnostics.iter().any(|d| d.code == "place.name"),
            "{diagnostics:?}"
        );
    }

    #[test]
    fn booking_or_bookings_not_both() {
        let trip_yaml = r"
apiVersion: taac/v1alpha4
kind: Trip
metadata: { title: T, timezone: UTC }
members: [{ name: A }]
itinerary:
  - { kind: activity, title: X, date: 2027-01-01, booking: { status: required }, bookings: [{ status: required }] }
  - { kind: activity, title: Y, date: 2027-01-01, bookings: [{ status: required }], costs: [{ amount: 1, currency: EUR }] }
";
        let fs = files(&[("trip.yaml", trip_yaml)]);
        let (_, diagnostics) = load_standalone_trip(&fs, "trip.yaml");
        assert!(
            diagnostics.iter().any(|d| d.code == "item.bookings"),
            "{diagnostics:?}"
        );
        assert!(
            diagnostics.iter().any(|d| d.code == "item.costs"),
            "{diagnostics:?}"
        );
    }
}
