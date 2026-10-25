//! Confidential values. Trips only ever name a secret; the value comes from a
//! [`SecretStore`] that local builds fill and published builds never get.

use std::collections::HashMap;

use crate::model::Secret;

#[derive(Debug, Clone, Default)]
pub struct SecretStore(HashMap<String, String>);

impl SecretStore {
    pub fn get(&self, secret: &Secret) -> Option<&str> {
        self.0.get(&secret.secret).map(String::as_str)
    }

    pub fn insert(&mut self, name: impl Into<String>, value: impl Into<String>) {
        self.0.insert(name.into(), value.into());
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
        self.0.extend(map);
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
                })
                .map(str::to_owned)
        };
        assert_eq!(get("A").as_deref(), Some("x y"));
        assert_eq!(get("B").as_deref(), Some("z"));
        assert_eq!(get("C").as_deref(), Some("plain"));
    }

    #[test]
    fn masks_without_store() {
        let secret = Secret {
            secret: "PNR".to_owned(),
        };
        assert_eq!(render(&secret, None), "••••••");
    }
}
