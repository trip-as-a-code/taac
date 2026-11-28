//! `KeePass` 4 (`.kdbx`) vault read/write helpers for `taac secret` and `taac build --reveal`.

use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::Path;

use keepass::config::{DatabaseConfig, KdfConfig};
use keepass::db::{EntryId, GroupRef, Value};
use keepass::{Database, DatabaseKey};

use crate::secrets::SecretStore;

/// Prefix for chaining entries in a personal vault that unlock a trip's shared vault.
pub const VAULT_LINK_PREFIX: &str = "taac:vault:";

/// Browser-friendly KDBX4 configuration (Argon2id: 16 MiB, 2 iterations, 1 lane, AES-256).
/// Fast enough for mobile WebAssembly decryption (~150–300 ms) while remaining strong.
pub fn browser_friendly_config() -> DatabaseConfig {
    let mut config = DatabaseConfig::default();
    if let KdfConfig::Argon2 { version, .. } | KdfConfig::Argon2id { version, .. } =
        config.kdf_config
    {
        config.kdf_config = KdfConfig::Argon2id {
            iterations: 2,
            memory: 16 * 1024 * 1024,
            parallelism: 1,
            version,
        };
    }
    config
}

/// Creates a new empty KDBX4 database in memory.
pub fn new_database() -> Database {
    let mut db = Database::new();
    db.config = browser_friendly_config();
    db
}

/// Opens a `.kdbx` database from disk using a master password.
pub fn open_file(path: &Path, password: &str) -> Result<Database, String> {
    let mut file = File::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
    open_reader(&mut file, password)
}

/// Opens a `.kdbx` database from any reader using a master password.
pub fn open_reader<R: Read>(reader: &mut R, password: &str) -> Result<Database, String> {
    let key = DatabaseKey::new().with_password(password);
    Database::open(reader, key).map_err(|e| format!("failed to open kdbx vault: {e}"))
}

/// Saves a `.kdbx` database to disk (creating parent directories if needed).
pub fn save_file(db: &Database, path: &Path, password: &str) -> Result<(), String> {
    if let Some(parent) = path.parent()
        && !parent.as_os_str().is_empty()
    {
        fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
    }
    let mut buf = Vec::new();
    save_writer(db, &mut buf, password)?;
    let mut file = File::create(path).map_err(|e| format!("{}: {e}", path.display()))?;
    file.write_all(&buf)
        .map_err(|e| format!("{}: {e}", path.display()))
}

/// Saves a `.kdbx` database to any writer using a master password.
pub fn save_writer<W: Write>(db: &Database, writer: &mut W, password: &str) -> Result<(), String> {
    let key = DatabaseKey::new().with_password(password);
    db.save(writer, key)
        .map_err(|e| format!("failed to save kdbx vault: {e}"))
}

fn find_entry_id_in_group(group: &GroupRef<'_>, title: &str) -> Option<EntryId> {
    if let Some(entry) = group.entries().find(|e| e.get_title() == Some(title)) {
        return Some(entry.id());
    }
    for sub in group.groups() {
        if let Some(found) = find_entry_id_in_group(&sub, title) {
            return Some(found);
        }
    }
    None
}

fn collect_entry_ids(group: &GroupRef<'_>, out: &mut Vec<EntryId>) {
    out.extend(group.entries().map(|e| e.id()));
    for sub in group.groups() {
        collect_entry_ids(&sub, out);
    }
}

/// Finds an entry id anywhere in the database by its exact `Title`.
pub fn find_entry_id(db: &Database, title: &str) -> Option<EntryId> {
    find_entry_id_in_group(&db.root(), title)
}

fn find_or_create_entry_id(db: &mut Database, title: &str) -> EntryId {
    if let Some(id) = find_entry_id(db, title) {
        return id;
    }
    let mut root = db.root_mut();
    let mut entry = root.add_entry();
    entry.set_unprotected("Title", title);
    entry.id()
}

/// Returns the entry's primary value (`Password`, falling back to custom `Value`)
/// or a named field if `field` is `Some`.
pub fn get_field(db: &Database, title: &str, field: Option<&str>) -> Option<String> {
    let id = find_entry_id(db, title)?;
    let entry = db.entry(id)?;
    if let Some(name) = field {
        return entry.get(name).map(str::to_owned);
    }
    entry
        .get_password()
        .filter(|v| !v.is_empty())
        .or_else(|| entry.get("Value").filter(|v| !v.is_empty()))
        .map(str::to_owned)
}

/// Sets (or creates) an entry's primary value (`Password`) or a named custom field.
pub fn set_field(db: &mut Database, title: &str, field: Option<&str>, value: &str) {
    let id = find_or_create_entry_id(db, title);
    let mut entry = db.entry_mut(id).expect("entry exists");
    let key = field.unwrap_or("Password");
    entry.set_protected(key, value);
}

/// Attaches (or replaces) a binary file on an entry (creating the entry if needed).
pub fn attach_file(db: &mut Database, title: &str, filename: &str, bytes: Vec<u8>) {
    let id = find_or_create_entry_id(db, title);
    let mut entry = db.entry_mut(id).expect("entry exists");
    entry.remove_attachment_by_name(filename);
    entry.add_attachment(filename, Value::protected(bytes));
}

/// Returns a binary attachment by filename on an entry, if present.
pub fn get_attachment(db: &Database, title: &str, filename: &str) -> Option<Vec<u8>> {
    let id = find_entry_id(db, title)?;
    let entry = db.entry(id)?;
    let att = entry.attachment_by_name(filename)?;
    Some(att.data.get().clone())
}

/// Stores a trip's shared vault password inside a personal vault for single-password unlock.
pub fn set_vault_link(personal_db: &mut Database, trip_slug: &str, shared_password: &str) {
    let title = format!("{VAULT_LINK_PREFIX}{trip_slug}");
    set_field(personal_db, &title, None, shared_password);
}

/// Summary of an entry in a vault, for `taac secret list` and `taac secret verify`.
#[derive(Debug, Clone)]
pub struct EntrySummary {
    pub title: String,
    pub has_value: bool,
    pub value: Option<String>,
    pub fields: Vec<(String, String)>,
    pub attachments: Vec<(String, usize)>,
}

/// Lists all entries in a database.
pub fn list_entries(db: &Database) -> Vec<EntrySummary> {
    let mut ids = Vec::new();
    collect_entry_ids(&db.root(), &mut ids);
    let mut out = Vec::new();
    for id in ids {
        let Some(entry) = db.entry(id) else {
            continue;
        };
        let Some(title) = entry.get_title() else {
            continue;
        };
        let primary = entry
            .get_password()
            .filter(|v| !v.is_empty())
            .or_else(|| entry.get("Value").filter(|v| !v.is_empty()))
            .map(str::to_owned);
        let mut fields = Vec::new();
        for (k, v) in &entry.fields {
            if matches!(
                k.as_str(),
                "Title" | "Password" | "Value" | "UserName" | "URL" | "Notes"
            ) {
                continue;
            }
            let text = v.get();
            if !text.is_empty() {
                fields.push((k.clone(), text.clone()));
            }
        }
        fields.sort_by(|a, b| a.0.cmp(&b.0));
        let mut attachments: Vec<(String, usize)> = entry
            .attachments_named()
            .map(|(name, att)| (name.to_owned(), att.data.get().len()))
            .collect();
        attachments.sort_by(|a, b| a.0.cmp(&b.0));
        out.push(EntrySummary {
            title: title.to_owned(),
            has_value: primary.is_some(),
            value: primary,
            fields,
            attachments,
        });
    }
    out.sort_by(|a, b| a.title.cmp(&b.title));
    out
}

/// Populates a [`SecretStore`] from an unlocked `KeePass` database.
pub fn extend_secret_store(store: &mut SecretStore, db: &Database) {
    let mut ids = Vec::new();
    collect_entry_ids(&db.root(), &mut ids);
    for id in ids {
        let Some(entry) = db.entry(id) else {
            continue;
        };
        let Some(title) = entry.get_title() else {
            continue;
        };
        if title.starts_with(VAULT_LINK_PREFIX) {
            continue;
        }
        if let Some(primary) = entry
            .get_password()
            .filter(|v| !v.is_empty())
            .or_else(|| entry.get("Value").filter(|v| !v.is_empty()))
        {
            store.insert(title, primary);
        }
        for (k, v) in &entry.fields {
            if k == "Title" {
                continue;
            }
            let text = v.get();
            if !text.is_empty() {
                store.insert_field(title, k, text);
            }
        }
    }
}

/// Encodes UTF-8 bytes as unpadded URL-safe Base64 (RFC 4648 §5) for `#k=` share fragments.
pub fn base64url_encode(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b0 = u32::from(chunk[0]);
        let b1 = u32::from(chunk.get(1).copied().unwrap_or(0));
        let b2 = u32::from(chunk.get(2).copied().unwrap_or(0));
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((n >> 18) & 0x3f) as usize] as char);
        out.push(TABLE[((n >> 12) & 0x3f) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[((n >> 6) & 0x3f) as usize] as char);
        }
        if chunk.len() > 2 {
            out.push(TABLE[(n & 0x3f) as usize] as char);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use super::*;
    use crate::model::Secret;

    #[test]
    fn roundtrip_kdbx4_entries_fields_and_attachments() {
        let mut db = new_database();
        set_field(&mut db, "TAP_LISBON", None, "ABC123");
        set_field(&mut db, "TAP_LISBON", Some("Phone"), "+351 21 000 0000");
        // Include non-UTF-8 bytes to prove real binary PDF attachment support.
        let pdf_bytes = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\ntest".to_vec();
        attach_file(&mut db, "TAP_LISBON", "boarding.pdf", pdf_bytes.clone());
        set_vault_link(&mut db, "lisbon", "trip-shared-pass");

        let mut bytes = Vec::new();
        save_writer(&db, &mut bytes, "master-pass").expect("save kdbx4");

        let mut cursor = Cursor::new(bytes);
        let reopened = open_reader(&mut cursor, "master-pass").expect("open kdbx4");

        assert_eq!(
            get_field(&reopened, "TAP_LISBON", None).as_deref(),
            Some("ABC123")
        );
        assert_eq!(
            get_field(&reopened, "TAP_LISBON", Some("Phone")).as_deref(),
            Some("+351 21 000 0000")
        );
        assert_eq!(
            get_field(&reopened, "taac:vault:lisbon", None).as_deref(),
            Some("trip-shared-pass")
        );
        assert_eq!(
            get_attachment(&reopened, "TAP_LISBON", "boarding.pdf"),
            Some(pdf_bytes)
        );

        let entries = list_entries(&reopened);
        let tap = entries
            .iter()
            .find(|e| e.title == "TAP_LISBON")
            .expect("TAP_LISBON listed");
        assert_eq!(tap.attachments, vec![("boarding.pdf".to_owned(), 19)]);

        let mut store = SecretStore::default();
        extend_secret_store(&mut store, &reopened);
        assert_eq!(
            store.get(&Secret {
                secret: "TAP_LISBON".to_owned(),
                field: None,
                vault: None,
            }),
            Some("ABC123")
        );
        assert_eq!(
            store.get(&Secret {
                secret: "TAP_LISBON".to_owned(),
                field: Some("Phone".to_owned()),
                vault: None,
            }),
            Some("+351 21 000 0000")
        );
    }

    #[test]
    fn base64url_matches_rfc4648() {
        assert_eq!(base64url_encode(b""), "");
        assert_eq!(base64url_encode(b"f"), "Zg");
        assert_eq!(base64url_encode(b"fo"), "Zm8");
        assert_eq!(base64url_encode(b"foo"), "Zm9v");
        assert_eq!(base64url_encode(b"foobar"), "Zm9vYmFy");
    }
}
