//! `taac secret`: manage `KeePass` 4 (`.kdbx`) vaults without manual entry/field naming.

use std::collections::HashSet;
use std::fs;
use std::io::{self, IsTerminal, Read, Write};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use anyhow::{Context, Result, anyhow, bail};
use clap::Subcommand;
use taac_core::diagnostics::has_errors;
use taac_core::kdbx;
use taac_core::loader::{Site, Trip};
use taac_core::secrets::{SecretUsageKind, collect_secret_refs};

use crate::files;

const LARGE_ATTACHMENT_BYTES: usize = 5 * 1024 * 1024;

#[derive(Subcommand)]
pub enum SecretCommand {
    /// Create a new KDBX4 vault with browser-friendly Argon2id settings.
    Init {
        /// `site.yaml`, a trip directory, or a trip file.
        #[arg(default_value = "site.yaml")]
        path: PathBuf,
        /// Personal vault id from `site.yaml` (omit to initialize the trip's shared vault).
        #[arg(long)]
        vault: Option<String>,
        /// Trip slug when `path` is a multi-trip `site.yaml`.
        #[arg(long)]
        trip: Option<String>,
        /// Environment variable containing the vault master password (non-interactive).
        #[arg(long)]
        password_env: Option<String>,
        /// Overwrite an existing `.kdbx` file.
        #[arg(long)]
        force: bool,
    },
    /// Interactively prompt for every secret, field, and attachment referenced in YAML that is missing from the vault.
    Fill {
        #[arg(default_value = "site.yaml")]
        path: PathBuf,
        /// Target personal vault id from `site.yaml` (omit for the trip's shared vault).
        #[arg(long)]
        vault: Option<String>,
        #[arg(long)]
        trip: Option<String>,
        #[arg(long)]
        password_env: Option<String>,
    },
    /// Set or update a single secret value or custom field in a vault.
    Set {
        /// Entry title (the `secret:` name in YAML, e.g. `TAP_LISBON`).
        name: String,
        /// `site.yaml`, a trip directory, or a trip file.
        #[arg(default_value = "site.yaml")]
        path: PathBuf,
        /// Optional `KeePass` field name inside the entry (defaults to primary value).
        #[arg(long)]
        field: Option<String>,
        /// Target personal vault id from `site.yaml` (omit for the trip's shared vault).
        #[arg(long)]
        vault: Option<String>,
        #[arg(long)]
        trip: Option<String>,
        /// Read the secret value from stdin instead of prompting.
        #[arg(long)]
        stdin: bool,
        #[arg(long)]
        password_env: Option<String>,
    },
    /// Attach a binary file (e.g. PDF boarding pass or voucher) to a vault entry.
    Attach {
        /// Entry title (the `secret:` name in YAML, e.g. `TAP_LISBON`).
        name: String,
        /// Local path to the file to attach.
        file: PathBuf,
        /// `site.yaml`, a trip directory, or a trip file.
        #[arg(default_value = "site.yaml")]
        path: PathBuf,
        /// Override the attachment filename inside the entry (defaults to the file's basename).
        #[arg(long)]
        filename: Option<String>,
        #[arg(long)]
        vault: Option<String>,
        #[arg(long)]
        trip: Option<String>,
        #[arg(long)]
        password_env: Option<String>,
    },
    /// Store a trip's shared vault password inside a personal vault for single-password browser unlock.
    Link {
        #[arg(default_value = "site.yaml")]
        path: PathBuf,
        /// Personal vault id from `site.yaml` that will store the link entry.
        #[arg(long)]
        vault: String,
        #[arg(long)]
        trip: Option<String>,
        /// Environment variable with the personal vault's master password.
        #[arg(long)]
        password_env: Option<String>,
        /// Environment variable with the trip's shared vault password.
        #[arg(long)]
        shared_password_env: Option<String>,
    },
    /// Verify that every secret, field, and attachment referenced in YAML exists in the vault.
    Verify {
        #[arg(default_value = "site.yaml")]
        path: PathBuf,
        #[arg(long)]
        vault: Option<String>,
        #[arg(long)]
        trip: Option<String>,
        #[arg(long)]
        password_env: Option<String>,
    },
    /// List entries, fields, and attachments in a vault.
    List {
        #[arg(default_value = "site.yaml")]
        path: PathBuf,
        #[arg(long)]
        vault: Option<String>,
        #[arg(long)]
        trip: Option<String>,
        /// Print plaintext values (never share output).
        #[arg(long)]
        reveal: bool,
        #[arg(long)]
        password_env: Option<String>,
    },
    /// Print the `#k=<base64url>` URL fragment for unlocking a trip's shared vault on a static site.
    ShareKey {
        #[arg(default_value = "site.yaml")]
        path: PathBuf,
        #[arg(long)]
        trip: Option<String>,
        #[arg(long)]
        password_env: Option<String>,
    },
}

pub fn run(action: SecretCommand) -> Result<ExitCode> {
    match action {
        SecretCommand::Init {
            path,
            vault,
            trip,
            password_env,
            force,
        } => cmd_init(
            &path,
            vault.as_deref(),
            trip.as_deref(),
            password_env.as_deref(),
            force,
        ),
        SecretCommand::Fill {
            path,
            vault,
            trip,
            password_env,
        } => cmd_fill(
            &path,
            vault.as_deref(),
            trip.as_deref(),
            password_env.as_deref(),
        ),
        SecretCommand::Set {
            path,
            name,
            field,
            vault,
            trip,
            stdin,
            password_env,
        } => cmd_set(
            &path,
            &name,
            field.as_deref(),
            vault.as_deref(),
            trip.as_deref(),
            stdin,
            password_env.as_deref(),
        ),
        SecretCommand::Attach {
            path,
            name,
            file,
            filename,
            vault,
            trip,
            password_env,
        } => cmd_attach(
            &path,
            &name,
            &file,
            filename.as_deref(),
            vault.as_deref(),
            trip.as_deref(),
            password_env.as_deref(),
        ),
        SecretCommand::Link {
            path,
            vault,
            trip,
            password_env,
            shared_password_env,
        } => cmd_link(
            &path,
            &vault,
            trip.as_deref(),
            password_env.as_deref(),
            shared_password_env.as_deref(),
        ),
        SecretCommand::Verify {
            path,
            vault,
            trip,
            password_env,
        } => cmd_verify(
            &path,
            vault.as_deref(),
            trip.as_deref(),
            password_env.as_deref(),
        ),
        SecretCommand::List {
            path,
            vault,
            trip,
            reveal,
            password_env,
        } => cmd_list(
            &path,
            vault.as_deref(),
            trip.as_deref(),
            reveal,
            password_env.as_deref(),
        ),
        SecretCommand::ShareKey {
            path,
            trip,
            password_env,
        } => cmd_share_key(&path, trip.as_deref(), password_env.as_deref()),
    }
}

fn input_root(path: &Path) -> PathBuf {
    let root = path
        .parent()
        .map_or_else(|| PathBuf::from("."), Path::to_path_buf);
    if root.as_os_str().is_empty() {
        PathBuf::from(".")
    } else {
        root
    }
}

fn load_site(path: &Path) -> Result<(Site, PathBuf)> {
    let (collected, key) = files::collect(path)?;
    let (site, diagnostics) = taac_core::load(&collected, &key);
    for d in &diagnostics {
        if d.is_error() {
            eprintln!("{d}");
        }
    }
    let Some(site) = site.filter(|_| !has_errors(&diagnostics)) else {
        bail!("fix the errors above first");
    };
    Ok((site, input_root(path)))
}

fn pick_trip<'a>(site: &'a Site, slug: Option<&str>) -> Result<&'a Trip> {
    if let Some(slug) = slug {
        site.trips
            .iter()
            .find(|t| t.slug == slug)
            .ok_or_else(|| anyhow!("trip `{slug}` not found"))
    } else if site.trips.len() == 1 {
        Ok(&site.trips[0])
    } else {
        let slugs: Vec<&str> = site.trips.iter().map(|t| t.slug.as_str()).collect();
        bail!(
            "multiple trips in site ({}); pass `--trip <slug>`",
            slugs.join(", ")
        )
    }
}

fn resolve_vault_path(
    site: &Site,
    root: &Path,
    vault_id: Option<&str>,
    trip_slug: Option<&str>,
) -> Result<(PathBuf, String)> {
    if let Some(id) = vault_id
        && id != "shared"
    {
        let personal = site
            .vaults
            .get(id)
            .ok_or_else(|| anyhow!("personal vault `{id}` is not declared in site.yaml"))?;
        return Ok((root.join(&personal.path), format!("personal vault `{id}`")));
    }
    let trip = pick_trip(site, trip_slug)?;
    let vault = trip.vault.as_ref().ok_or_else(|| {
        anyhow!(
            "trip `{}` has no `vault:` configured in its YAML (add `vault: {{ path: secrets/shared.kdbx }}`)",
            trip.slug
        )
    })?;
    Ok((
        root.join(&vault.path),
        format!("shared vault for `{}`", trip.slug),
    ))
}

fn prompt_masked(prompt: &str) -> Result<String> {
    if !io::stdin().is_terminal() {
        eprint!("{prompt}");
        io::stderr().flush()?;
        let mut line = String::new();
        io::stdin().read_line(&mut line)?;
        return Ok(line.trim_end_matches(&['\r', '\n'][..]).to_owned());
    }
    inquire::Password::new(prompt.trim_end_matches(&[':', ' '][..]))
        .with_display_mode(inquire::PasswordDisplayMode::Masked)
        .without_confirmation()
        .prompt()
        .map_err(Into::into)
}

fn read_password(prompt: &str, env_var: Option<&str>, confirm: bool) -> Result<String> {
    if let Some(var) = env_var {
        let val = std::env::var(var)
            .with_context(|| format!("environment variable `{var}` is not set"))?;
        if val.is_empty() {
            bail!("environment variable `{var}` is empty");
        }
        return Ok(val);
    }
    let pass = prompt_masked(prompt).context("reading password")?;
    if pass.is_empty() {
        bail!("password cannot be empty");
    }
    if confirm {
        let second = prompt_masked("Confirm password: ").context("confirming password")?;
        if pass != second {
            bail!("passwords do not match");
        }
    }
    Ok(pass)
}

fn cmd_init(
    path: &Path,
    vault_id: Option<&str>,
    trip_slug: Option<&str>,
    password_env: Option<&str>,
    force: bool,
) -> Result<ExitCode> {
    let (site, root) = load_site(path)?;
    let (vault_path, label) = resolve_vault_path(&site, &root, vault_id, trip_slug)?;
    if vault_path.exists() && !force {
        bail!(
            "{} already exists (pass `--force` to overwrite)",
            vault_path.display()
        );
    }
    let password = read_password(
        &format!("Master password for {label}: "),
        password_env,
        true,
    )?;
    let db = kdbx::new_database();
    kdbx::save_file(&db, &vault_path, &password).map_err(|e| anyhow!(e))?;
    eprintln!("created {label} at {}", vault_path.display());
    Ok(ExitCode::SUCCESS)
}

fn cmd_set(
    path: &Path,
    name: &str,
    field: Option<&str>,
    vault_id: Option<&str>,
    trip_slug: Option<&str>,
    from_stdin: bool,
    password_env: Option<&str>,
) -> Result<ExitCode> {
    let (site, root) = load_site(path)?;
    let (vault_path, label) = resolve_vault_path(&site, &root, vault_id, trip_slug)?;
    let password = read_password(&format!("Password for {label}: "), password_env, false)?;
    let mut db = kdbx::open_file(&vault_path, &password).map_err(|e| anyhow!(e))?;

    let value = if from_stdin {
        let mut buf = String::new();
        io::stdin().read_to_string(&mut buf)?;
        buf.trim_end_matches(&['\r', '\n'][..]).to_owned()
    } else {
        let field_label = field.map_or_else(String::new, |f| format!(" / {f}"));
        prompt_masked(&format!("Value for {name}{field_label}: "))
            .context("reading secret value")?
    };

    kdbx::set_field(&mut db, name, field, &value);
    kdbx::save_file(&db, &vault_path, &password).map_err(|e| anyhow!(e))?;
    let field_label = field.map_or_else(String::new, |f| format!(" / {f}"));
    eprintln!("saved {name}{field_label} in {}", vault_path.display());
    Ok(ExitCode::SUCCESS)
}

fn cmd_attach(
    path: &Path,
    name: &str,
    file: &Path,
    filename: Option<&str>,
    vault_id: Option<&str>,
    trip_slug: Option<&str>,
    password_env: Option<&str>,
) -> Result<ExitCode> {
    let (site, root) = load_site(path)?;
    let (vault_path, label) = resolve_vault_path(&site, &root, vault_id, trip_slug)?;
    let bytes = fs::read(file).with_context(|| format!("reading {}", file.display()))?;
    if bytes.len() > LARGE_ATTACHMENT_BYTES {
        let mib = bytes.len() / (1024 * 1024);
        eprintln!(
            "warning: {} is ~{mib} MiB — large attachments increase offline cache size",
            file.display(),
        );
    }
    let att_name = match filename {
        Some(f) => f.to_owned(),
        None => file
            .file_name()
            .with_context(|| format!("{} has no filename", file.display()))?
            .to_string_lossy()
            .into_owned(),
    };
    let password = read_password(&format!("Password for {label}: "), password_env, false)?;
    let mut db = kdbx::open_file(&vault_path, &password).map_err(|e| anyhow!(e))?;
    kdbx::attach_file(&mut db, name, &att_name, bytes);
    kdbx::save_file(&db, &vault_path, &password).map_err(|e| anyhow!(e))?;
    eprintln!("attached {att_name} to {name} in {}", vault_path.display());
    Ok(ExitCode::SUCCESS)
}

fn cmd_link(
    path: &Path,
    personal_vault_id: &str,
    trip_slug: Option<&str>,
    password_env: Option<&str>,
    shared_password_env: Option<&str>,
) -> Result<ExitCode> {
    let (site, root) = load_site(path)?;
    let trip = pick_trip(&site, trip_slug)?;
    let (personal_path, personal_label) =
        resolve_vault_path(&site, &root, Some(personal_vault_id), Some(&trip.slug))?;
    let (shared_path, shared_label) = resolve_vault_path(&site, &root, None, Some(&trip.slug))?;

    let personal_pw = read_password(
        &format!("Password for {personal_label}: "),
        password_env,
        false,
    )?;
    let shared_pw = read_password(
        &format!("Password for {shared_label}: "),
        shared_password_env,
        false,
    )?;

    // Verify shared password actually opens the shared vault before linking.
    kdbx::open_file(&shared_path, &shared_pw).map_err(|e| anyhow!(e))?;

    let mut personal_db = kdbx::open_file(&personal_path, &personal_pw).map_err(|e| anyhow!(e))?;
    kdbx::set_vault_link(&mut personal_db, &trip.slug, &shared_pw);
    kdbx::save_file(&personal_db, &personal_path, &personal_pw).map_err(|e| anyhow!(e))?;
    eprintln!(
        "linked {shared_label} into {personal_label} (entry `{}{}`)",
        kdbx::VAULT_LINK_PREFIX,
        trip.slug
    );
    Ok(ExitCode::SUCCESS)
}

fn matches_target_vault(ref_vault: Option<&str>, target_vault: Option<&str>) -> bool {
    match (ref_vault, target_vault) {
        (None | Some("shared"), None | Some("shared")) => true,
        (Some(a), Some(b)) => a == b,
        _ => false,
    }
}

fn cmd_fill(
    path: &Path,
    vault_id: Option<&str>,
    trip_slug: Option<&str>,
    password_env: Option<&str>,
) -> Result<ExitCode> {
    let (site, root) = load_site(path)?;
    let trip = pick_trip(&site, trip_slug)?;
    let (vault_path, label) = resolve_vault_path(&site, &root, vault_id, Some(&trip.slug))?;
    let password = read_password(&format!("Password for {label}: "), password_env, false)?;
    let mut db = kdbx::open_file(&vault_path, &password).map_err(|e| anyhow!(e))?;

    let refs = collect_secret_refs(trip);
    let mut seen = HashSet::new();
    let mut updated = 0usize;

    for usage in refs {
        if !matches_target_vault(usage.vault.as_deref(), vault_id) {
            continue;
        }
        match &usage.kind {
            SecretUsageKind::Field(field) => {
                let key = (usage.secret.clone(), field.clone().unwrap_or_default());
                if !seen.insert(key) {
                    continue;
                }
                if kdbx::get_field(&db, &usage.secret, field.as_deref()).is_some() {
                    continue;
                }
                let field_label = field
                    .as_deref()
                    .map_or_else(String::new, |f| format!(" / {f}"));
                let prompt = format!(
                    "{}{field_label} ({} · {}, empty to skip): ",
                    usage.secret, usage.item_title, usage.context
                );
                let val = prompt_masked(&prompt).context("reading secret value")?;
                if !val.is_empty() {
                    kdbx::set_field(&mut db, &usage.secret, field.as_deref(), &val);
                    updated += 1;
                }
            }
            SecretUsageKind::Attachment(filename) => {
                let key = (usage.secret.clone(), format!("att:{filename}"));
                if !seen.insert(key) {
                    continue;
                }
                if kdbx::get_attachment(&db, &usage.secret, filename).is_some() {
                    continue;
                }
                eprint!(
                    "{} / {filename} ({} · {}, file path or empty to skip): ",
                    usage.secret, usage.item_title, usage.context
                );
                io::stderr().flush()?;
                let mut line = String::new();
                io::stdin().read_line(&mut line)?;
                let trimmed = line.trim();
                if !trimmed.is_empty() {
                    let bytes = fs::read(trimmed).with_context(|| format!("reading {trimmed}"))?;
                    kdbx::attach_file(&mut db, &usage.secret, filename, bytes);
                    updated += 1;
                }
            }
            SecretUsageKind::AllAttachments => {}
        }
    }

    if updated > 0 {
        kdbx::save_file(&db, &vault_path, &password).map_err(|e| anyhow!(e))?;
        eprintln!("saved {updated} item(s) to {}", vault_path.display());
    } else {
        eprintln!("nothing to fill — all referenced secrets are present");
    }
    Ok(ExitCode::SUCCESS)
}

fn cmd_verify(
    path: &Path,
    vault_id: Option<&str>,
    trip_slug: Option<&str>,
    password_env: Option<&str>,
) -> Result<ExitCode> {
    let (site, root) = load_site(path)?;
    let trip = pick_trip(&site, trip_slug)?;
    let (vault_path, label) = resolve_vault_path(&site, &root, vault_id, Some(&trip.slug))?;
    let password = read_password(&format!("Password for {label}: "), password_env, false)?;
    let db = kdbx::open_file(&vault_path, &password).map_err(|e| anyhow!(e))?;

    let refs = collect_secret_refs(trip);
    let mut missing = 0usize;
    let mut referenced_entries = HashSet::new();

    for usage in &refs {
        if !matches_target_vault(usage.vault.as_deref(), vault_id) {
            continue;
        }
        referenced_entries.insert(usage.secret.as_str());
        match &usage.kind {
            SecretUsageKind::Field(field) => {
                if kdbx::get_field(&db, &usage.secret, field.as_deref()).is_none() {
                    let suffix = field
                        .as_deref()
                        .map_or_else(String::new, |f| format!(" / {f}"));
                    eprintln!(
                        "missing: {}{suffix} (needed by {} · {})",
                        usage.secret, usage.item_title, usage.context
                    );
                    missing += 1;
                }
            }
            SecretUsageKind::Attachment(filename) => {
                if kdbx::get_attachment(&db, &usage.secret, filename).is_none() {
                    eprintln!(
                        "missing attachment: {} / {filename} (needed by {} · {})",
                        usage.secret, usage.item_title, usage.context
                    );
                    missing += 1;
                }
            }
            SecretUsageKind::AllAttachments => {
                let has_any = kdbx::find_entry_id(&db, &usage.secret)
                    .and_then(|id| db.entry(id))
                    .is_some_and(|e| e.attachments().next().is_some());
                if !has_any {
                    eprintln!(
                        "missing attachments: {} has no attachments (needed by {} · {})",
                        usage.secret, usage.item_title, usage.context
                    );
                    missing += 1;
                }
            }
        }
    }

    for entry in kdbx::list_entries(&db) {
        if !entry.title.starts_with(kdbx::VAULT_LINK_PREFIX)
            && !referenced_entries.contains(entry.title.as_str())
        {
            eprintln!("unused: {} (not referenced in {})", entry.title, trip.slug);
        }
    }

    if missing > 0 {
        eprintln!("{missing} missing secret(s)");
        Ok(ExitCode::FAILURE)
    } else {
        eprintln!(
            "ok — all referenced secrets present in {}",
            vault_path.display()
        );
        Ok(ExitCode::SUCCESS)
    }
}

fn cmd_list(
    path: &Path,
    vault_id: Option<&str>,
    trip_slug: Option<&str>,
    reveal: bool,
    password_env: Option<&str>,
) -> Result<ExitCode> {
    let (site, root) = load_site(path)?;
    let (vault_path, label) = resolve_vault_path(&site, &root, vault_id, trip_slug)?;
    let password = read_password(&format!("Password for {label}: "), password_env, false)?;
    let db = kdbx::open_file(&vault_path, &password).map_err(|e| anyhow!(e))?;

    let entries = kdbx::list_entries(&db);
    if entries.is_empty() {
        eprintln!("(empty vault)");
        return Ok(ExitCode::SUCCESS);
    }
    for entry in entries {
        let val = match (&entry.value, reveal) {
            (Some(v), true) => format!(" = {v}"),
            (Some(_), false) => " = ••••••".to_owned(),
            (None, _) => String::new(),
        };
        println!("{}{val}", entry.title);
        for (k, v) in &entry.fields {
            if reveal {
                println!("  field {k} = {v}");
            } else {
                println!("  field {k} = ••••••");
            }
        }
        for (name, size) in &entry.attachments {
            println!("  attachment {name} ({size} bytes)");
        }
    }
    Ok(ExitCode::SUCCESS)
}

fn cmd_share_key(
    path: &Path,
    trip_slug: Option<&str>,
    password_env: Option<&str>,
) -> Result<ExitCode> {
    let (site, root) = load_site(path)?;
    let trip = pick_trip(&site, trip_slug)?;
    let (vault_path, label) = resolve_vault_path(&site, &root, None, Some(&trip.slug))?;
    let password = read_password(&format!("Password for {label}: "), password_env, false)?;
    // Verify the password actually unlocks the shared vault.
    kdbx::open_file(&vault_path, &password).map_err(|e| anyhow!(e))?;
    println!("#k={}", kdbx::base64url_encode(password.as_bytes()));
    Ok(ExitCode::SUCCESS)
}

/// Loads any configured `.kdbx` vaults into `store` for `taac build --reveal`.
pub fn load_kdbx_secrets(
    site: &Site,
    path: &Path,
    password_env: Option<&str>,
    store: &mut taac_core::secrets::SecretStore,
) {
    let root = input_root(path);
    let interactive = io::stdin().is_terminal();
    for trip in &site.trips {
        let Some(vault) = &trip.vault else {
            continue;
        };
        let vault_path = root.join(&vault.path);
        if !vault_path.is_file() {
            continue;
        }
        let pw = if let Some(var) = password_env {
            std::env::var(var).ok()
        } else if interactive {
            prompt_masked(&format!(
                "Password for {} vault ({}, empty to skip): ",
                trip.slug,
                vault_path.display()
            ))
            .ok()
            .filter(|s| !s.is_empty())
        } else {
            None
        };
        if let Some(pw) = pw {
            match kdbx::open_file(&vault_path, &pw) {
                Ok(db) => kdbx::extend_secret_store(store, &db),
                Err(err) => eprintln!("warning: {}: {err}", vault_path.display()),
            }
        }
    }
}
