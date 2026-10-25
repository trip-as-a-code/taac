//! End-to-end over the bundled demo site.

use std::fs;
use std::path::Path;

use taac_core::loader::Files;
use taac_core::secrets::SecretStore;

fn demo() -> Files {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/demo");
    let mut files = Files::new();
    for path in ["site.yaml", "trips/lisbon.yaml"] {
        files.insert(
            path.to_owned(),
            fs::read_to_string(root.join(path)).unwrap(),
        );
    }
    files
}

#[test]
fn demo_exports_without_diagnostics() {
    let export = taac_core::export(&demo(), "site.yaml").expect("no errors");
    assert!(export.diagnostics.is_empty());
    let trip = &export.trips[0];
    assert_eq!(trip.slug, "lisbon");
    assert!(trip.diagnostics.is_empty(), "{:?}", trip.diagnostics);
    assert_eq!(trip.days.len(), 4);

    let budget = &trip.budget;
    let shares: f64 = budget
        .lines
        .iter()
        .flat_map(|l| l.shares.values())
        .map(|d| d.to_string().parse::<f64>().unwrap())
        .sum();
    let total: f64 = budget.total.planned.to_string().parse().unwrap();
    assert!(
        (shares - total).abs() < 0.005,
        "shares {shares} != total {total}"
    );
}

#[test]
fn web_export_never_contains_confidential_values() {
    let export = taac_core::export(&demo(), "site.yaml").unwrap();
    let json = serde_json::to_string(&export).unwrap();
    for name in ["DEMO_PNR", "DEMO_HOTEL_PHONE"] {
        assert!(!json.contains(name), "{name} leaked into the web export");
    }
    assert!(json.contains("\"hasReference\":true"));
}

#[test]
fn reveal_only_with_a_store() {
    let (site, _) = taac_core::load(&demo(), "site.yaml");
    let trip = &site.unwrap().trips[0];
    let mut store = SecretStore::default();
    store.insert("DEMO_PNR", "ABC123");
    assert!(!taac_core::generators::ics::generate(trip, None, None).contains("ABC123"));
    assert!(taac_core::generators::ics::generate(trip, Some(&store), None).contains("ABC123"));
}
