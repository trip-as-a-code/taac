//! Reads exactly the files a site or trip needs into the core's in-memory map.

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use taac_core::loader::{Files, join, parent};
use taac_core::model::{SiteFile, TripFile};

/// Returns the files keyed relative to the input's parent, plus the input's key.
pub fn collect(path: &Path) -> Result<(Files, String)> {
    let path = if path.as_os_str().is_empty() {
        Path::new(".")
    } else {
        path
    };
    let root = path
        .parent()
        .map_or_else(|| PathBuf::from("."), Path::to_path_buf);
    let root = if root.as_os_str().is_empty() {
        PathBuf::from(".")
    } else {
        root
    };
    let key = path
        .file_name()
        .with_context(|| format!("{} has no file name", path.display()))?
        .to_string_lossy()
        .into_owned();

    let mut files = Files::new();
    if path.is_dir() {
        walk(&root, &key, &mut files)?;
        return Ok((files, key));
    }
    let content =
        fs::read_to_string(path).with_context(|| format!("reading {}", path.display()))?;
    if let Ok(site) = taac_core::yaml::from_str::<SiteFile>(&content) {
        for trip in &site.trips {
            let trip_key = join(parent(&key), &trip.path);
            let trip_path = root.join(&trip_key);
            if trip_path.is_dir() {
                walk(&root, &trip_key, &mut files)?;
            } else {
                read_into(&root, &trip_key, &mut files)?;
                let trip_content = files[&trip_key].clone();
                read_overlays(&root, &trip_key, &trip_content, &mut files)?;
            }
        }
    } else {
        read_overlays(&root, &key, &content, &mut files)?;
    }
    files.insert(key.clone(), content);
    Ok((files, key))
}

/// A single-file trip only pulls in the overlays it names.
fn read_overlays(root: &Path, key: &str, content: &str, files: &mut Files) -> Result<()> {
    if let Ok(trip) = taac_core::yaml::from_str::<TripFile>(content) {
        for overlay in trip.map.unwrap_or_default().overlays {
            let overlay_key = join(parent(key), &overlay.file);
            if root.join(&overlay_key).is_file() {
                read_into(root, &overlay_key, files)?;
            }
        }
    }
    Ok(())
}

/// Trip sources: YAML plus the `GeoJSON` overlays they reference.
fn wanted(name: &str) -> bool {
    [".yaml", ".yml", ".json", ".geojson"]
        .iter()
        .any(|ext| name.ends_with(ext))
}

fn walk(root: &Path, key: &str, files: &mut Files) -> Result<()> {
    let dir = if key.is_empty() {
        root.to_path_buf()
    } else {
        root.join(key)
    };
    let mut entries: Vec<_> = fs::read_dir(&dir)
        .with_context(|| format!("reading {}", dir.display()))?
        .collect::<Result<_, _>>()?;
    entries.sort_by_key(fs::DirEntry::file_name);
    for entry in entries {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || name == "node_modules" || name == "target" {
            continue;
        }
        let child = if key.is_empty() {
            name.clone()
        } else {
            format!("{key}/{name}")
        };
        if entry.file_type()?.is_dir() {
            walk(root, &child, files)?;
        } else if wanted(&name) {
            read_into(root, &child, files)?;
        }
    }
    Ok(())
}

fn read_into(root: &Path, key: &str, files: &mut Files) -> Result<()> {
    let path = root.join(key);
    let content =
        fs::read_to_string(&path).with_context(|| format!("reading {}", path.display()))?;
    files.insert(key.to_owned(), content);
    Ok(())
}
