//! `GeoJSON` (RFC 7946): one `Point` per place, one `LineString` per route.

use indexmap::IndexMap;
use serde_json::{Value, json};

use crate::loader::Trip;
use crate::model::Place;

pub fn generate(trip: &Trip) -> String {
    let mut points: IndexMap<String, (&Place, Vec<Value>)> = IndexMap::new();
    let mut features = Vec::new();

    for item in &trip.itinerary {
        let places = trip.item_places(item);
        let status = item
            .booking
            .as_ref()
            .map_or("notRequired", |b| b.status.as_str());
        let reference = json!({
            "id": item.id,
            "title": item.title,
            "kind": item.kind.as_str(),
            "start": item.start.to_rfc3339(),
            "status": status,
        });
        for (id, place) in &places {
            points
                .entry(id.clone())
                .or_insert_with(|| (*place, Vec::new()))
                .1
                .push(reference.clone());
        }
        if item.kind.is_transport() && places.len() > 1 {
            features.push(json!({
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": places.iter().map(|(_, p)| lon_lat(p)).collect::<Vec<_>>(),
                },
                "properties": {
                    "item": item.id,
                    "title": item.title,
                    "kind": item.kind.as_str(),
                    "status": status,
                },
            }));
        }
    }

    for (id, (place, items)) in points {
        features.push(json!({
            "type": "Feature",
            "id": id,
            "geometry": { "type": "Point", "coordinates": lon_lat(place) },
            "properties": {
                "name": place.name,
                "category": place.category,
                "address": place.address,
                "url": place.url,
                "items": items,
            },
        }));
    }

    serde_json::to_string_pretty(&json!({
        "type": "FeatureCollection",
        "features": features,
    }))
    .expect("serializable")
}

fn lon_lat(place: &Place) -> [f64; 2] {
    [place.geo[1], place.geo[0]]
}
