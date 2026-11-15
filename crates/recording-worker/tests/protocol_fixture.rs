//! 协议样例（`tests/fixtures/protocol.json`）在 Rust 一侧能读进来、写回去不变；Runtime 一侧用 zod 读同一份
//! （`packages/runtime-core/src/recordings/worker-protocol.test.ts`）。

use recording_worker::protocol::{
    HelloResult, JournalLine, Ns, SegmentResult, Sources, StartParams, StartResult, StopResult, WorkerEvent,
};
use recording_worker::sink;
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;

fn fixture() -> Value {
    let text = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/protocol.json")).unwrap();
    serde_json::from_str(&text).unwrap()
}

/// 数字都换成 f64 再比：Rust 写出的 `2.0` 与样例里的 `2` 是同一个值。
fn normalize(value: &Value) -> Value {
    match value {
        Value::Number(number) => serde_json::json!(number.as_f64().unwrap()),
        Value::Array(items) => Value::Array(items.iter().map(normalize).collect()),
        Value::Object(map) => Value::Object(map.iter().map(|(key, value)| (key.clone(), normalize(value))).collect()),
        other => other.clone(),
    }
}

fn round_trip<T: DeserializeOwned + Serialize>(name: &str) {
    let fixture = fixture();
    let items = fixture[name].as_array().unwrap_or_else(|| panic!("missing {name}"));
    assert!(!items.is_empty(), "{name} is empty");
    for item in items {
        let parsed: T = serde_json::from_value(item.clone()).unwrap_or_else(|error| panic!("{name}: {error}: {item}"));
        let written = serde_json::to_value(&parsed).unwrap();
        assert_eq!(normalize(&written), normalize(item), "{name} changed on the way back");
    }
}

#[test]
fn fixture_protocol_version_matches() {
    assert_eq!(fixture()["protocol"], serde_json::json!(recording_worker::protocol::PROTOCOL_VERSION));
}

#[test]
fn fixture_messages_round_trip() {
    round_trip::<HelloResult>("hello");
    round_trip::<Sources>("sources");
    round_trip::<StartParams>("start");
    round_trip::<StartResult>("startResult");
    round_trip::<SegmentResult>("segmentResult");
    round_trip::<StopResult>("stopResult");
    round_trip::<WorkerEvent>("events");
    round_trip::<JournalLine>("journal");
}

#[test]
fn fixture_event_rows_match_the_writers() {
    let fixture = fixture();
    let at = Ns(196_951_569_671_916);
    let pointer = [sink::pointer_move(at, 0.5, 0.25), sink::pointer_button(at, 0, true), sink::pointer_cursor(at, "fcb3b73749ac68ac")];
    assert_eq!(normalize(&Value::Array(pointer.to_vec())), normalize(&fixture["pointerEvents"]));
    let keys = [
        sink::key_event(Ns(196_951_600_000_000), "KeyS", true, ""),
        sink::key_event(Ns(196_951_700_000_000), "KeyS", false, "s"),
    ];
    assert_eq!(normalize(&Value::Array(keys.to_vec())), normalize(&fixture["keyEvents"]));
}

#[test]
fn nanoseconds_must_be_decimal_strings() {
    for bad in [serde_json::json!(5), serde_json::json!(""), serde_json::json!("-1"), serde_json::json!("1e9")] {
        assert!(serde_json::from_value::<Ns>(bad.clone()).is_err(), "{bad} should be refused");
    }
}
