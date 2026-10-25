//! JSON Schemas for editors and CI, generated from the model.

use schemars::generate::SchemaSettings;

use crate::model::{SiteFile, TripFile};

pub fn trip() -> serde_json::Value {
    generate::<TripFile>()
}

pub fn site() -> serde_json::Value {
    generate::<SiteFile>()
}

fn generate<T: schemars::JsonSchema>() -> serde_json::Value {
    let generator = SchemaSettings::draft2020_12().into_generator();
    serde_json::to_value(generator.into_root_schema_for::<T>()).expect("schema serializes")
}
