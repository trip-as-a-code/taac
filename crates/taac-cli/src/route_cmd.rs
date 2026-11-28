//! `taac route`: plan and verify trip routes through Extism plugins.

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use anyhow::{Context, Result, bail};
use clap::{Args, Subcommand, ValueEnum};
use indexmap::IndexMap;
use taac_core::diagnostics::Diagnostic;
use taac_core::loader::Site;
use taac_core::model::Place;
use taac_plugin_api::{Attribution, GeoPoint, PlanRouteRequest, RouteMode};
use taac_plugins::yaml::render_route_option_yaml;
use taac_plugins::{PluginLoadOptions, RoutePlugin, check_site};

use crate::files;

const DEFAULT_PLUGIN_PATH: &str = "plugins/dist/transitous.wasm";

#[derive(Subcommand)]
pub enum RouteCommand {
    /// Plan a route between two places or coordinates and print `taac` YAML snippets.
    Plan {
        /// Origin: a place name from `--trip`, or `lat,lon` coordinates.
        #[arg(long)]
        from: String,
        /// Destination: a place name from `--trip`, or `lat,lon` coordinates.
        #[arg(long)]
        to: String,
        /// RFC 3339 timestamp with offset, e.g. `2026-11-30T09:00:00+00:00`.
        #[arg(long)]
        time: String,
        /// Interpret `--time` as desired arrival time instead of departure time.
        #[arg(long)]
        arrive_by: bool,
        /// Optional `site.yaml` or trip file/directory to resolve place names and `places:`.
        #[arg(long)]
        trip: Option<PathBuf>,
        /// Comma-separated `who` list for generated itinerary items.
        #[arg(long, default_value = "everyone")]
        who: String,
        /// Optional comma-separated modes (`train,bus,ferry,walk,ride,transfer,flight`).
        #[arg(long)]
        modes: Option<String>,
        /// Maximum number of route alternatives to return.
        #[arg(long, default_value_t = 3)]
        alternatives: u32,
        /// Output format.
        #[arg(long, value_enum, default_value_t = OutputFormat::Yaml)]
        format: OutputFormat,
        #[command(flatten)]
        plugin_args: PluginArgs,
    },
    /// Verify scheduled journey legs in a site or trip against a route plugin.
    Check {
        /// `site.yaml`, a trip directory or a trip file.
        #[arg(default_value = "site.yaml")]
        path: PathBuf,
        /// Only check a single trip (by slug).
        #[arg(long)]
        trip: Option<String>,
        /// Only check legs on a specific day (`YYYY-MM-DD`).
        #[arg(long)]
        day: Option<String>,
        /// Fail on warnings too.
        #[arg(long)]
        strict: bool,
        #[command(flatten)]
        plugin_args: PluginArgs,
    },
}

/// Shared plugin options for `route plan`, `route check`, and `validate --online`.
#[derive(Args, Debug, Clone, Default)]
pub struct PluginArgs {
    /// Path to the compiled `.wasm` plugin (overrides `site.yaml` and default path).
    #[arg(long)]
    pub plugin: Option<PathBuf>,
    /// Permitted hostnames for the Extism sandbox (repeatable).
    #[arg(long = "allow-host")]
    pub allow_hosts: Vec<String>,
    /// Override the provider base URL (e.g. a self-hosted MOTIS instance).
    #[arg(long)]
    pub base_url: Option<String>,
    /// Optional contact email or URL appended to the `User-Agent` header.
    #[arg(long)]
    pub contact: Option<String>,
    /// Bypass the local 24h response cache.
    #[arg(long)]
    pub no_cache: bool,
    /// Maximum number of live network requests allowed in this run.
    #[arg(long, default_value_t = 50)]
    pub max_requests: usize,
}

#[derive(ValueEnum, Clone, Copy, Debug)]
pub enum OutputFormat {
    Yaml,
    Json,
}

pub fn run(action: RouteCommand) -> Result<ExitCode> {
    match action {
        RouteCommand::Plan {
            from,
            to,
            time,
            arrive_by,
            trip,
            who,
            modes,
            alternatives,
            format,
            plugin_args,
        } => {
            let (site, base_dir, existing_places) = if let Some(ref trip_path) = trip {
                let (files, key) = files::collect(trip_path)?;
                let (site, _diags) = taac_core::load(&files, &key);
                let places = site.as_ref().map_or_default(collect_site_places);
                let dir = if trip_path.is_dir() {
                    trip_path.clone()
                } else {
                    trip_path.parent().unwrap_or(Path::new(".")).to_path_buf()
                };
                (site, dir, places)
            } else {
                (None, PathBuf::from("."), IndexMap::new())
            };

            let from_pt = resolve_point(&from, &existing_places)?;
            let to_pt = resolve_point(&to, &existing_places)?;
            let parsed_modes = parse_modes(modes.as_deref())?;
            let who_list: Vec<String> = who
                .split(',')
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
                .collect();

            let opts = resolve_plugin_options(site.as_ref(), &base_dir, &plugin_args)?;
            let mut plugin = RoutePlugin::load(&opts)?;
            let req = PlanRouteRequest {
                from: from_pt,
                to: to_pt,
                time,
                arrive_by,
                modes: parsed_modes,
                num_itineraries: alternatives.max(1),
            };
            let resp = plugin.plan_route(&req)?;

            match format {
                OutputFormat::Json => {
                    println!("{}", serde_json::to_string_pretty(&resp)?);
                }
                OutputFormat::Yaml => {
                    if resp.itineraries.is_empty() {
                        eprintln!("no routes found");
                    } else {
                        for (idx, option) in resp.itineraries.iter().enumerate() {
                            if idx > 0 {
                                println!("\n# --- Option {} ---", idx + 1);
                            } else {
                                println!(
                                    "# Option 1 ({} min, {} transfer(s))",
                                    option.duration_secs / 60,
                                    option.transfers
                                );
                            }
                            print!(
                                "{}",
                                render_route_option_yaml(option, &who_list, &existing_places)
                            );
                        }
                    }
                }
            }

            if let Some(attr) = resp
                .attribution
                .or_else(|| plugin.info().attribution.clone())
            {
                print_attribution(&attr);
            }
            Ok(ExitCode::SUCCESS)
        }
        RouteCommand::Check {
            path,
            trip,
            day,
            strict,
            plugin_args,
        } => {
            let day_filter = day
                .as_deref()
                .map(str::parse::<jiff::civil::Date>)
                .transpose()
                .context("parsing --day (expected YYYY-MM-DD)")?;
            let (files, key) = files::collect(&path)?;
            let (site, offline_diags) = taac_core::load(&files, &key);
            let Some(site) = site else {
                for d in &offline_diags {
                    eprintln!("{d}");
                }
                bail!("could not load site/trip at {}", path.display());
            };

            let base_dir = if path.is_dir() {
                path.clone()
            } else {
                path.parent().unwrap_or(Path::new(".")).to_path_buf()
            };

            let diagnostics =
                run_online_check(&site, &base_dir, trip.as_deref(), day_filter, &plugin_args)?;
            let errors = diagnostics.iter().filter(|d| d.is_error()).count();
            let warnings = diagnostics.len() - errors;
            Ok(if errors > 0 || (strict && warnings > 0) {
                ExitCode::FAILURE
            } else {
                ExitCode::SUCCESS
            })
        }
    }
}

/// Run online route verification for a loaded [`Site`], print findings and attribution,
/// and return the produced diagnostics.
pub fn run_online_check(
    site: &Site,
    base_dir: &Path,
    trip_filter: Option<&str>,
    day_filter: Option<jiff::civil::Date>,
    plugin_args: &PluginArgs,
) -> Result<Vec<Diagnostic>> {
    let opts = resolve_plugin_options(Some(site), base_dir, plugin_args)?;
    let mut plugin = RoutePlugin::load(&opts)?;
    let summary = check_site(site, &mut plugin, trip_filter, day_filter)?;

    for d in &summary.diagnostics {
        eprintln!("{d}");
        if let Some(fix) = &d.fix {
            eprintln!("  suggested alternative:\n{}", indent_block(fix, "    "));
        }
    }

    eprintln!(
        "online route check ({}): {} checked, {} verified, {} warning(s), {} mismatch(es), {} out-of-coverage ({} live request(s), {} cached)",
        plugin.info().name,
        summary.checked,
        summary.verified,
        summary.warnings,
        summary.mismatches,
        summary.out_of_coverage,
        summary.live_requests,
        summary.cache_hits
    );
    if let Some(attr) = &summary.attribution {
        print_attribution(attr);
    }

    Ok(summary.diagnostics)
}

fn resolve_plugin_options(
    site: Option<&Site>,
    base_dir: &Path,
    args: &PluginArgs,
) -> Result<PluginLoadOptions> {
    let mut opts = if let Some(path) = &args.plugin {
        PluginLoadOptions::from_wasm(path.clone())
    } else if let Some((_, cfg)) = site.and_then(|s| s.plugins.iter().find(|(_, p)| p.enabled)) {
        let mut o = PluginLoadOptions::from_wasm(base_dir.join(&cfg.path));
        o.allowed_hosts.clone_from(&cfg.allowed_hosts);
        o.config.clone_from(&cfg.config);
        o
    } else {
        let candidate = PathBuf::from(DEFAULT_PLUGIN_PATH);
        if candidate.is_file() {
            PluginLoadOptions::from_wasm(candidate)
        } else {
            bail!(
                "no route plugin configured: pass `--plugin <path/to/plugin.wasm>`, declare `plugins:` in `site.yaml`, or build the default plugin with `task plugins`"
            );
        }
    };

    if !args.allow_hosts.is_empty() {
        opts.allowed_hosts.clone_from(&args.allow_hosts);
    }
    if let Some(base_url) = &args.base_url {
        opts.config.insert("baseUrl".to_owned(), base_url.clone());
    }
    if let Some(contact) = &args.contact {
        opts.config.insert("contact".to_owned(), contact.clone());
    }
    opts.use_cache = !args.no_cache;
    opts.max_requests = args.max_requests;
    Ok(opts)
}

fn collect_site_places(site: &Site) -> IndexMap<String, Place> {
    let mut places = IndexMap::new();
    for trip in &site.trips {
        for (k, v) in &trip.places {
            places.entry(k.clone()).or_insert_with(|| v.clone());
        }
    }
    places
}

fn resolve_point(input: &str, places: &IndexMap<String, Place>) -> Result<GeoPoint> {
    if let Some((lat_s, lon_s)) = input.split_once(',')
        && let (Ok(lat), Ok(lon)) = (lat_s.trim().parse::<f64>(), lon_s.trim().parse::<f64>())
    {
        return Ok(GeoPoint {
            lat,
            lon,
            name: None,
        });
    }

    if let Some((name, place)) = places
        .iter()
        .find(|(k, p)| k.eq_ignore_ascii_case(input) || p.name.eq_ignore_ascii_case(input))
    {
        return Ok(GeoPoint {
            lat: place.geo[0],
            lon: place.geo[1],
            name: Some(name.clone()),
        });
    }

    bail!(
        "could not resolve `{input}` as `lat,lon` coordinates or a named place (pass `--trip <path>` to look up trip places)"
    )
}

fn parse_modes(raw: Option<&str>) -> Result<Vec<RouteMode>> {
    let Some(raw) = raw else {
        return Ok(Vec::new());
    };
    let mut out = Vec::new();
    for part in raw.split(',').map(str::trim).filter(|s| !s.is_empty()) {
        let mode = match part.to_ascii_lowercase().as_str() {
            "train" => RouteMode::Train,
            "bus" => RouteMode::Bus,
            "ferry" => RouteMode::Ferry,
            "flight" => RouteMode::Flight,
            "walk" => RouteMode::Walk,
            "ride" => RouteMode::Ride,
            "transfer" => RouteMode::Transfer,
            other => {
                return Err(anyhow::anyhow!(
                    "unknown route mode `{other}` (expected train, bus, ferry, flight, walk, ride, or transfer)"
                ))
                .context("parsing --modes");
            }
        };
        out.push(mode);
    }
    Ok(out)
}

fn print_attribution(attr: &Attribution) {
    if let Some(notice) = &attr.notice {
        eprintln!("{notice}");
    } else {
        eprintln!("Attribution: {} ({})", attr.name, attr.url);
    }
}

fn indent_block(text: &str, prefix: &str) -> String {
    text.lines()
        .map(|line| format!("{prefix}{line}"))
        .collect::<Vec<_>>()
        .join("\n")
}
