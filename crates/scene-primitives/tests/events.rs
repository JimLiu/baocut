//! 顶层 `events[]`（规范 §4）：TimeExpr 求值（不对齐帧网格）、行外形与排序、
//! 相位展开，以及 `bcut lint` 的五个事件码。

use scene_primitives::events::resolve_events;
use scene_primitives::lint::{Severity, lint, lint_with_inputs};
use scene_primitives::{CoreWord, HostInputs, Resolver};
use serde_json::{Value, json};

fn doc(events: Value) -> Value {
    json!({
        "bcut": "0.2",
        "meta": {"id": "ev", "width": 640, "height": 360, "fps": 30},
        "scenes": [{"id": "moon", "dur": 4}, {"id": "storm", "dur": 6}],
        "assets": {"voice": {"type": "audio", "src": "assets/voice.wav"}},
        "tracks": [
            {"id": "main", "kind": "visual", "clips": [
                {"id": "sky", "start": "@moon", "end": "@storm.end",
                 "element": {"type": "box", "id": "bg", "style": {"width": 640, "height": 360}}}
            ]},
            {"id": "vo", "kind": "audio", "clips": [
                {"id": "vo-L1", "start": "@storm+1", "end": "@storm+3", "src": "$assets.voice"}
            ]}
        ],
        "events": events
    })
}

fn inputs() -> HostInputs {
    let mut inputs = HostInputs::default();
    inputs.insert_audio("voice", 2.0);
    inputs.insert_transcript(
        "voice",
        vec![CoreWord {
            id: "w1".into(),
            t0: 0.4213,
            t1: 0.9,
        }],
    );
    inputs
}

fn table(events: Value) -> scene_primitives::events::EventTable {
    let mut resolver = Resolver::new(doc(events), None).unwrap();
    resolver.set_host_inputs(inputs());
    let ir = resolver.resolve().unwrap();
    resolve_events(&resolver, &ir.scenes, ir.total)
}

fn rules(events: Value) -> Vec<(&'static str, Severity)> {
    lint_with_inputs(&doc(events), Some(&inputs()))
        .into_iter()
        .filter(|d| d.rule.starts_with("event-") || d.rule == "schema")
        .map(|d| (d.rule, d.severity))
        .collect()
}

#[test]
fn event_times_resolve_to_millisecond_absolute_seconds_sorted() {
    let t = table(json!([
        {"id": "splash", "t": "@moon+2.0123", "type": "plink", "gain": 0.8, "pan": 0.1},
        {"id": "bolt", "t": "#vo-L1.end-0.5", "type": "thunder", "dist": 0.3},
        {"id": "word", "t": "~voice:w1", "type": "tok"},
        {"id": "mid", "t": "@storm.50%", "type": "swell", "until": "@storm.end"},
        {"id": "abs", "t": 0.5, "type": "tick"}
    ]));
    assert!(t.issues.is_empty(), "{:?}", t.issues);
    let ids: Vec<&str> = t.rows.iter().map(|r| r["id"].as_str().unwrap()).collect();
    assert_eq!(ids, ["abs", "splash", "word", "bolt", "mid"]);
    let by = |id: &str| t.rows.iter().find(|r| r["id"] == id).unwrap().clone();
    // 不对齐 1/30 网格：2.0123 → 毫秒取整 2.012
    assert_eq!(by("splash")["t"], json!(2.012));
    assert_eq!(by("splash")["scene"], json!("moon"));
    assert_eq!(by("splash")["sceneT"], json!(2.012));
    assert_eq!(by("splash")["gain"], json!(0.8));
    assert_eq!(by("splash")["type"], json!("plink"));
    // #clip：storm 起点 4 + 3 − 0.5
    assert_eq!(by("bolt")["t"], json!(6.5));
    assert_eq!(by("bolt")["sceneT"], json!(2.5));
    // ~词锚点：clip 起点 5 + 0.4213 → 5.421
    assert_eq!(by("word")["t"], json!(5.421));
    // .50%：storm 的一半；until 求成绝对秒
    assert_eq!(by("mid")["t"], json!(7.0));
    assert_eq!(by("mid")["until"], json!(10.0));
    assert!(by("abs").get("phase").is_none());
}

#[test]
fn phase_events_expand_to_one_row_per_upward_crossing() {
    let t = table(json!([
        {"id": "flap", "t": "@storm+0", "until": "@storm+2.6", "type": "flapPhase",
         "phase": "u*2.6+0.2", "gain": 0.5}
    ]));
    assert!(t.issues.is_empty(), "{:?}", t.issues);
    // 相位 0.2 → 6.96：越过 0.25, 1.25, … 6.25 共 7 次
    assert_eq!(t.rows.len(), 7);
    for (k, row) in t.rows.iter().enumerate() {
        assert_eq!(row["id"], json!(format!("flap#{k}")));
        assert_eq!(row["phaseIndex"], json!(k));
        assert_eq!(row["event"], json!("flap"));
        assert_eq!(row["type"], json!("flapPhase"));
        assert_eq!(row["gain"], json!(0.5));
        assert!(row.get("phase").is_none() && row.get("until").is_none());
        // u = (k + 0.05) / 2.6 向上取到毫秒
        let exact = 4.0 + (k as f64 + 0.05) / 2.6;
        let t = row["t"].as_f64().unwrap();
        assert!(
            t >= exact - 1e-9 && t - exact < 0.001 + 1e-9,
            "{k}: {t} vs {exact}"
        );
    }
}

#[test]
fn lint_reports_the_event_rules() {
    assert!(rules(json!([{"id": "a", "t": "@moon+1"}])).is_empty());
    assert_eq!(
        rules(json!([{"t": "@moon"}])),
        [("event-id-missing", Severity::Error)]
    );
    assert_eq!(
        rules(json!([{"id": "a", "t": 1}, {"id": "a", "t": 2}])),
        [("event-id-duplicate", Severity::Error)]
    );
    for bad in [
        json!([{"id": "a"}]),
        json!([{"id": "a", "t": "@nowhere+1"}]),
        json!([{"id": "a", "t": "#nope.end"}]),
        json!([{"id": "a", "t": "~voice:missing"}]),
        json!([{"id": "a", "t": "@storm", "until": "@moon"}]),
    ] {
        assert_eq!(
            rules(bad.clone()),
            [("event-time-invalid", Severity::Error)],
            "{bad}"
        );
    }
    for bad in [
        json!([{"id": "a", "t": 0, "until": 1, "phase": "exp(u)"}]),
        json!([{"id": "a", "t": 0, "phase": "u"}]),
        json!([{"id": "a", "t": 0, "until": 1, "phase": 3}]),
        json!([{"id": "a", "t": 0, "until": 1, "phase": "1/(u-u)"}]),
    ] {
        assert_eq!(
            rules(bad.clone()),
            [("event-phase-invalid", Severity::Error)],
            "{bad}"
        );
    }
    assert_eq!(
        rules(json!([{"id": "late", "t": "@storm.end+2"}])),
        [("event-outside-doc", Severity::Warn)]
    );
    assert_eq!(rules(json!({"a": 1})), [("schema", Severity::Error)]);
}

#[test]
fn documents_without_events_are_untouched() {
    let mut plain = doc(Value::Null);
    plain.as_object_mut().unwrap().remove("events");
    assert!(!scene_primitives::events::declares_events(&plain));
    assert!(lint(&plain).iter().all(|d| !d.rule.starts_with("event-")));
}
