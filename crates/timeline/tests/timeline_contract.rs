use std::collections::BTreeMap;

use serde_json::Value;
use timeline::{SeamBias, TimelineDocument, TimelineProjection};

const CONTRACT: &str = include_str!("fixtures/timeline-map-contract.json");

fn number(value: &Value, key: &str) -> f64 {
    value[key]
        .as_f64()
        .unwrap_or_else(|| panic!("{key} must be a number"))
}

fn bias(value: &Value) -> SeamBias {
    match value["bias"].as_str().expect("bias") {
        "preceding" => SeamBias::Preceding,
        "following" => SeamBias::Following,
        other => panic!("unknown bias {other}"),
    }
}

#[test]
fn rust_projection_matches_cross_surface_contract_fixture() {
    let fixture: Value = serde_json::from_str(CONTRACT).unwrap();
    assert_eq!(fixture["bcutTimelineMapContract"], "0.1");
    let document: TimelineDocument = serde_json::from_value(fixture["timeline"].clone()).unwrap();
    let source_durations: BTreeMap<String, f64> =
        serde_json::from_value(fixture["sourceDurations"].clone()).unwrap();
    let projection = TimelineProjection::build(&document, &source_durations).unwrap();
    let expected = &fixture["expect"];

    assert_eq!(projection.duration(), number(expected, "duration"));
    for (src_id, view) in expected["views"].as_object().unwrap() {
        let source = projection.source(src_id).unwrap();
        assert_eq!(source.view_duration(), number(view, "duration"));
        for (actual, expected) in source
            .kept_spans()
            .iter()
            .zip(view["keptSpans"].as_array().unwrap())
        {
            assert_eq!(actual.source_start, number(expected, "sourceStart"));
            assert_eq!(actual.source_end, number(expected, "sourceEnd"));
            assert_eq!(actual.view_start, number(expected, "viewStart"));
        }
        for row in view["sourceToView"].as_array().unwrap() {
            assert_eq!(
                source.view_time(number(row, "source")),
                row["view"].as_f64()
            );
        }
        for row in view["viewToSource"].as_array().unwrap() {
            assert_eq!(
                source.source_time(number(row, "view"), bias(row)),
                number(row, "source")
            );
        }
    }

    for (actual, expected) in projection
        .clips()
        .iter()
        .zip(expected["clips"].as_array().unwrap())
    {
        assert_eq!(actual.id, expected["id"].as_str().unwrap());
        assert_eq!(actual.timeline_start, number(expected, "timelineStart"));
        assert_eq!(actual.timeline_end, number(expected, "timelineEnd"));
    }
    for row in expected["sourceToTimeline"].as_array().unwrap() {
        let actual =
            projection.source_to_timeline(row["srcId"].as_str().unwrap(), number(row, "source"));
        let wanted = row["timeline"]
            .as_array()
            .unwrap()
            .iter()
            .map(|value| value.as_f64().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(actual, wanted);
    }
    for row in expected["timelineToSource"].as_array().unwrap() {
        let (src_id, source) = projection
            .timeline_to_source(number(row, "timeline"), bias(row))
            .unwrap();
        assert_eq!(src_id, row["srcId"].as_str().unwrap());
        assert_eq!(source, number(row, "source"));
    }
    for row in expected["events"].as_array().unwrap() {
        let actual = projection.clamp_source_event(
            row["srcId"].as_str().unwrap(),
            number(row, "start"),
            number(row, "end"),
            number(row, "minimumDuration"),
        );
        for (actual, expected) in actual.iter().zip(row["mapped"].as_array().unwrap()) {
            assert_eq!(actual.clip_id, expected["clipId"].as_str().unwrap());
            assert_eq!(actual.timeline_start, number(expected, "timelineStart"));
            assert_eq!(actual.timeline_end, number(expected, "timelineEnd"));
        }
        assert_eq!(actual.len(), row["mapped"].as_array().unwrap().len());
    }
}
