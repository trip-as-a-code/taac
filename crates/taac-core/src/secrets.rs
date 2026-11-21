//! Confidential values. Trips only ever name a secret; the value comes from a
//! [`SecretStore`] (populated from `KeePass` `.kdbx` vaults, `.env`, `secrets.yaml`
//! or the environment) that local builds fill and published builds never get.

use std::collections::HashMap;

use crate::loader::Trip;
use crate::model::{Secret, SecretAttachment};

#[derive(Debug, Clone, Default)]
pub struct SecretStore {
    values: HashMap<String, String>,
    fields: HashMap<(String, String), String>,
}

impl SecretStore {
    pub fn get(&self, secret: &Secret) -> Option<&str> {
        if let Some(field) = &secret.field {
            return self
                .fields
                .get(&(secret.secret.clone(), field.clone()))
                .map(String::as_str)
                .or_else(|| {
                    self.values
                        .get(&format!("{}_{}", secret.secret, field.to_ascii_uppercase()))
                        .map(String::as_str)
                });
        }
        self.values.get(&secret.secret).map(String::as_str)
    }

    pub fn insert(&mut self, name: impl Into<String>, value: impl Into<String>) {
        self.values.insert(name.into(), value.into());
    }

    pub fn insert_field(
        &mut self,
        name: impl Into<String>,
        field: impl Into<String>,
        value: impl Into<String>,
    ) {
        self.fields
            .insert((name.into(), field.into()), value.into());
    }

    /// `KEY=value` lines; `#` comments, `export ` prefixes and quotes allowed.
    pub fn extend_from_dotenv(&mut self, content: &str) {
        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let line = line.strip_prefix("export ").unwrap_or(line);
            if let Some((key, value)) = line.split_once('=') {
                let value = value.trim();
                let value = value
                    .strip_prefix('"')
                    .and_then(|v| v.strip_suffix('"'))
                    .or_else(|| value.strip_prefix('\'').and_then(|v| v.strip_suffix('\'')))
                    .unwrap_or(value);
                self.insert(key.trim(), value);
            }
        }
    }

    /// A flat `KEY: value` YAML map.
    pub fn extend_from_yaml(&mut self, content: &str) -> Result<(), String> {
        let map: HashMap<String, String> =
            serde_saphyr::from_str(content).map_err(|e| e.to_string())?;
        self.values.extend(map);
        Ok(())
    }
}

/// Renders a secret for an artifact: its value when revealing, else a mask.
pub fn render(secret: &Secret, reveal: Option<&SecretStore>) -> String {
    match reveal.and_then(|store| store.get(secret)) {
        Some(value) => value.to_owned(),
        None => "••••••".to_owned(),
    }
}

/// What kind of confidential reference an entry in a trip uses.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SecretUsageKind {
    /// Text value: `None` for the primary entry value (Password/Value), or a custom field name.
    Field(Option<String>),
    /// A specific binary attachment filename inside the entry.
    Attachment(String),
    /// All binary attachments on the entry.
    AllAttachments,
}

/// Every reference to a secret or attachment in a [`Trip`], for CLI fill/check and validation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecretUsage {
    pub secret: String,
    pub kind: SecretUsageKind,
    pub vault: Option<String>,
    pub item_title: String,
    pub context: String,
}

/// Collects every [`Secret`] and [`SecretAttachment`] referenced across a trip's itinerary.
pub fn collect_secret_refs(trip: &Trip) -> Vec<SecretUsage> {
    let mut out = Vec::new();
    let push_secret = |out: &mut Vec<SecretUsage>, s: &Secret, title: &str, context: &str| {
        out.push(SecretUsage {
            secret: s.secret.clone(),
            kind: SecretUsageKind::Field(s.field.clone()),
            vault: s.vault.clone(),
            item_title: title.to_owned(),
            context: context.to_owned(),
        });
    };
    let push_att =
        |out: &mut Vec<SecretUsage>, a: &SecretAttachment, title: &str, context: &str| {
            let kind = match &a.attachment {
                Some(name) => SecretUsageKind::Attachment(name.clone()),
                None => SecretUsageKind::AllAttachments,
            };
            out.push(SecretUsage {
                secret: a.secret.clone(),
                kind,
                vault: a.vault.clone(),
                item_title: title.to_owned(),
                context: context.to_owned(),
            });
        };

    for item in &trip.itinerary {
        if let Some(booking) = &item.booking {
            if let Some(reference) = &booking.reference {
                push_secret(&mut out, reference, &item.title, "booking.reference");
            }
            for att in &booking.attachments {
                push_att(&mut out, att, &item.title, "booking.attachments");
            }
        }
        for (idx, res) in item.bookings.iter().enumerate() {
            let prefix = format!("bookings[{idx}]");
            if let Some(reference) = &res.reference {
                push_secret(
                    &mut out,
                    reference,
                    &item.title,
                    &format!("{prefix}.reference"),
                );
            }
            for att in &res.attachments {
                push_att(&mut out, att, &item.title, &format!("{prefix}.attachments"));
            }
        }
        for contact in &item.contacts {
            if let Some(phone) = &contact.phone {
                push_secret(
                    &mut out,
                    phone,
                    &item.title,
                    &format!("contact {} (phone)", contact.name),
                );
            }
            if let Some(email) = &contact.email {
                push_secret(
                    &mut out,
                    email,
                    &item.title,
                    &format!("contact {} (email)", contact.name),
                );
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_dotenv() {
        let mut store = SecretStore::default();
        store.extend_from_dotenv("# c\nexport A=\"x y\"\nB='z'\nC=plain\n");
        let get = |n: &str| {
            store
                .get(&Secret {
                    secret: n.to_owned(),
                    field: None,
                    vault: None,
                })
                .map(str::to_owned)
        };
        assert_eq!(get("A").as_deref(), Some("x y"));
        assert_eq!(get("B").as_deref(), Some("z"));
        assert_eq!(get("C").as_deref(), Some("plain"));
    }

    #[test]
    fn resolves_custom_field() {
        let mut store = SecretStore::default();
        store.insert_field("HOTEL", "DoorCode", "4821#");
        let secret = Secret {
            secret: "HOTEL".to_owned(),
            field: Some("DoorCode".to_owned()),
            vault: None,
        };
        assert_eq!(store.get(&secret), Some("4821#"));
    }

    #[test]
    fn masks_without_store() {
        let secret = Secret {
            secret: "PNR".to_owned(),
            field: None,
            vault: None,
        };
        assert_eq!(render(&secret, None), "••••••");
    }
}
