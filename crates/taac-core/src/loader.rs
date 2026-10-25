//! Turns a set of files into a [`Site`]. Input is an in-memory map of
//! `/`-separated relative paths to contents, so the same code runs in the CLI
//! and in WebAssembly.

use std::collections::BTreeMap;

use indexmap::IndexMap;
use serde::de::DeserializeOwned;

use crate::diagnostics::Diagnostic;
use crate::model::{
    Access, CurrencyConfig, Group, Item, Member, PackingCategory, Place, PlaceRef, SiteFile,
    SiteKind, SiteMetadata, TripFile, TripKind, TripMetadata,
};

pub type Files = BTreeMap<String, String>;

#[derive(Debug, Clone)]
pub struct Site {
    pub metadata: SiteMetadata,
    pub access: Option<Access>,
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
    pub itinerary: Vec<Item>,
    pub packing: Vec<PackingCategory>,
    pub overlays: Vec<LoadedOverlay>,
    pub access: Option<Access>,
}

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

    /// Effective participants: explicit `members`, else the group's, else everyone.
    pub fn participants<'a>(&'a self, item: &'a Item) -> Vec<&'a str> {
        if let Some(members) = &item.members {
            return members.iter().map(String::as_str).collect();
        }
        if let Some(group) = item.group.as_deref().and_then(|g| self.group(g)) {
            return group.members.iter().map(String::as_str).collect();
        }
        self.members.iter().map(|m| m.id.as_str()).collect()
    }

    /// Places of an item with stable ids; inline places get `<item>~<n>`.
    pub fn item_places<'a>(&'a self, item: &'a Item) -> Vec<(String, &'a Place)> {
        item.places
            .iter()
            .enumerate()
            .filter_map(|(index, place)| match place {
                PlaceRef::Key(key) => self.places.get(key).map(|p| (key.clone(), p)),
                PlaceRef::Inline(p) => Some((format!("{}~{index}", item.id), p)),
            })
            .collect()
    }

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
        trips,
    };
    (Some(site), diagnostics)
}

/// Loads a lone trip (file or directory) as a single-trip site.
pub fn load_standalone_trip(files: &Files, path: &str) -> (Option<Site>, Vec<Diagnostic>) {
    let mut diagnostics = Vec::new();
    let site = load_trip(files, path, &mut diagnostics).map(|trip| Site {
        metadata: SiteMetadata {
            title: trip.metadata.title.clone(),
            description: trip.metadata.summary.clone(),
        },
        access: None,
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
        itinerary: Vec::new(),
        packing: Vec::new(),
        overlays: Vec::new(),
        access: None,
    };

    for (file, doc) in std::iter::once((main_path, root)).chain(parts) {
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
        for (key, place) in doc.places {
            if trip.places.contains_key(&key) {
                diagnostics.push(
                    Diagnostic::error("place.duplicate", format!("place `{key}` declared twice"))
                        .in_file(file.clone())
                        .in_trip(&slug),
                );
            }
            trip.places.insert(key, place);
        }
        trip.itinerary.extend(doc.itinerary);
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

    trip.itinerary.sort_by_key(|item| item.start);
    Some(trip)
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
apiVersion: taac/v1alpha1
kind: Trip
metadata:
  title: Test
  timezone: Europe/Lisbon
members:
  - { id: ana, name: Ana }
places:
  home: { name: Home, geo: [38.7, -9.1] }
itinerary:
  - id: b
    kind: activity
    title: Second
    start: 2027-05-02T10:00:00+01:00
  - id: a
    kind: activity
    title: First
    start: 2027-05-01T10:00:00+01:00
    places: [home, { name: Cafe, geo: [38.71, -9.14] }]
";

    const PART: &str = r"
apiVersion: taac/v1alpha1
kind: TripPart
places:
  park: { name: Park, geo: [38.72, -9.15] }
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
        assert_eq!(trip.itinerary[0].id, "a");
        let places = trip.item_places(&trip.itinerary[0]);
        assert_eq!(places[0].0, "home");
        assert_eq!(places[1].0, "a~1");
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
}
