//! 引擎的取值区间经 WASM 入口：数是校验用的那几个常量本身。

use editor_wasm::ranges::engine_ranges;
use serde_json::{Value, json};

#[test]
fn ranges_are_the_validator_constants() {
    let ranges: Value = serde_json::from_str(&engine_ranges(b"{}").unwrap()).unwrap();
    assert_eq!(ranges["volume"], json!([0.0, 4.0]));
    assert_eq!(ranges["fx"]["adjust"], json!([-1.0, 1.0]));
    assert_eq!(ranges["fx"]["blur"], json!([0.0, 100.0]));
    assert_eq!(ranges["fx"]["shadowBlur"], json!([0.0, 200.0]));
    assert_eq!(ranges["fx"]["strokeWidthMax"], json!(100.0));
    assert_eq!(ranges["ducking"]["depth"], json!([0.0, 60.0]));
    assert_eq!(ranges["ducking"]["time"], json!([0.0, 5.0]));
    assert_eq!(
        ranges["ducking"]["defaults"],
        json!({ "depth": 10.0, "attack": 0.02, "release": 0.35 })
    );
    assert_eq!(ranges["keyframes"]["maxPerProp"], json!(256));
    assert_eq!(ranges["animation"]["duration"], json!([0.1, 2.0]));
}
