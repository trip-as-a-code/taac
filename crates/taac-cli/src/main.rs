//! `taac`: validate trips, compile artifacts, export for the web, emit schemas.

mod files;

use std::fs;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use anyhow::{Context, Result, bail};
use clap::{Parser, Subcommand};
use taac_core::diagnostics::{Diagnostic, has_errors};
use taac_core::generators;
use taac_core::secrets::SecretStore;

#[derive(Parser)]
#[command(
    name = "taac",
    version,
    about = "Trip as a Code: trips declared in YAML, compiled into calendars, maps, ledgers and a website"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Check a site file or trip (file or directory) for errors.
    Validate {
        /// `site.yaml`, a trip directory or a trip file.
        #[arg(default_value = "site.yaml")]
        path: PathBuf,
        /// Fail on warnings too.
        #[arg(long)]
        strict: bool,
    },
    /// Compile every trip into ICS, `GeoJSON`, Beancount and Markdown.
    Build {
        #[arg(default_value = "site.yaml")]
        path: PathBuf,
        #[arg(short, long, default_value = "dist")]
        out: PathBuf,
        /// Include confidential values from `.env`, `secrets.yaml` and the
        /// environment. Never publish the result.
        #[arg(long)]
        reveal: bool,
    },
    /// Print the web export (JSON) the frontend renders.
    Export {
        #[arg(default_value = "site.yaml")]
        path: PathBuf,
        #[arg(short, long)]
        out: Option<PathBuf>,
    },
    /// Write the JSON Schemas for trip and site files.
    Schema {
        #[arg(short, long, default_value = "schema")]
        out: PathBuf,
    },
}

fn main() -> ExitCode {
    match run(Cli::parse()) {
        Ok(code) => code,
        Err(err) => {
            eprintln!("error: {err:#}");
            ExitCode::FAILURE
        }
    }
}

fn run(cli: Cli) -> Result<ExitCode> {
    match cli.command {
        Command::Validate { path, strict } => {
            let (files, key) = files::collect(&path)?;
            let (site, diagnostics) = taac_core::load(&files, &key);
            report(&diagnostics);
            let trips = site.map_or(0, |s| s.trips.len());
            let errors = diagnostics.iter().filter(|d| d.is_error()).count();
            let warnings = diagnostics.len() - errors;
            eprintln!("{trips} trip(s), {errors} error(s), {warnings} warning(s)");
            Ok(if errors > 0 || (strict && warnings > 0) {
                ExitCode::FAILURE
            } else {
                ExitCode::SUCCESS
            })
        }
        Command::Build { path, out, reveal } => {
            let (files, key) = files::collect(&path)?;
            let (site, diagnostics) = taac_core::load(&files, &key);
            report(&diagnostics);
            let Some(site) = site.filter(|_| !has_errors(&diagnostics)) else {
                bail!("fix the errors above first");
            };
            let secrets = reveal.then(|| load_secrets(&path));
            for trip in &site.trips {
                let dir = out.join(&trip.slug);
                fs::create_dir_all(&dir).with_context(|| format!("creating {}", dir.display()))?;
                let artifacts = [
                    (
                        "trip.ics",
                        generators::ics::generate(trip, secrets.as_ref(), None),
                    ),
                    ("map.geojson", generators::geojson::generate(trip)),
                    ("budget.beancount", generators::beancount::generate(trip)),
                    (
                        "itinerary.md",
                        generators::markdown::generate(trip, secrets.as_ref()),
                    ),
                ];
                for (name, content) in artifacts {
                    fs::write(dir.join(name), content)?;
                }
                eprintln!("{} → {}", trip.slug, dir.display());
            }
            Ok(ExitCode::SUCCESS)
        }
        Command::Export { path, out } => {
            let (files, key) = files::collect(&path)?;
            let export = taac_core::export(&files, &key).map_err(|diagnostics| {
                report(&diagnostics);
                anyhow::anyhow!("fix the errors above first")
            })?;
            report(&export.diagnostics);
            let json = serde_json::to_string_pretty(&export)?;
            match out {
                Some(out) => {
                    fs::write(&out, json).with_context(|| format!("writing {}", out.display()))?;
                }
                None => println!("{json}"),
            }
            Ok(ExitCode::SUCCESS)
        }
        Command::Schema { out } => {
            fs::create_dir_all(&out)?;
            for (name, schema) in [
                ("trip.v1alpha3.json", taac_core::schema::trip()),
                ("site.v1alpha3.json", taac_core::schema::site()),
            ] {
                let mut json = serde_json::to_string_pretty(&schema)?;
                json.push('\n');
                fs::write(out.join(name), json)?;
            }
            Ok(ExitCode::SUCCESS)
        }
    }
}

fn report(diagnostics: &[Diagnostic]) {
    for d in diagnostics {
        eprintln!("{d}");
    }
}

/// `.env` and `secrets.yaml` next to the input and in the working directory,
/// then the process environment, later sources winning.
fn load_secrets(path: &Path) -> SecretStore {
    let mut store = SecretStore::default();
    let base = if path.is_dir() {
        path
    } else {
        path.parent().unwrap_or(Path::new("."))
    };
    for dir in [Path::new("."), base] {
        if let Ok(content) = fs::read_to_string(dir.join(".env")) {
            store.extend_from_dotenv(&content);
        }
        if let Some(Err(err)) = fs::read_to_string(dir.join("secrets.yaml"))
            .ok()
            .map(|content| store.extend_from_yaml(&content))
        {
            eprintln!("warning: {}: {err}", dir.join("secrets.yaml").display());
        }
    }
    for (key, value) in std::env::vars() {
        store.insert(key, value);
    }
    store
}
