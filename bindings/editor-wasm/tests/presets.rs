//! 元素的样式目录经 WASM 入口：次序、默认颜色、dB 窗与彩纸的发射参数都是内置配方里的值。

use editor_wasm::presets::element_presets;
use editor_wasm::ranges::engine_ranges;
use serde_json::{Value, json};

fn presets() -> Value {
    serde_json::from_str(&element_presets(b"{}").unwrap()).unwrap()
}

fn ids(list: &Value) -> Vec<&str> {
    list.as_array()
        .unwrap()
        .iter()
        .map(|preset| preset["id"].as_str().unwrap())
        .collect()
}

#[test]
fn catalogues_follow_the_builtin_order() {
    let presets = presets();
    assert_eq!(ids(&presets["progress"]).len(), 14);
    assert_eq!(
        ids(&presets["visualizer"])[..4],
        ["bars", "bars_rounded", "bars_bottom", "ring_bars"]
    );
    assert_eq!(ids(&presets["confetti"])[0], "rainbow-paper");
    assert_eq!(presets["visualizerAliases"]["beam"], json!("oscilloscope"));
}

#[test]
fn defaults_are_the_recipe_values() {
    let presets = presets();
    let find = |kind: &str, id: &str| {
        presets[kind]
            .as_array()
            .unwrap()
            .iter()
            .find(|preset| preset["id"] == id)
            .unwrap()
            .clone()
    };
    assert_eq!(
        find("progress", "border"),
        json!({ "id": "border", "aspect": "frame", "mainColor": "#FF9FDC", "secondaryColor": "#FFFFFF00", "numColors": 2 })
    );
    let oscilloscope = find("visualizer", "oscilloscope");
    assert_eq!(oscilloscope["minDb"], json!(-120.0));
    assert_eq!(oscilloscope["maxDb"], json!(-10.0));
    assert_eq!(oscilloscope["hasControl"], json!(false));
    assert_eq!(find("visualizer", "ring_bars")["aspect"], json!("square"));
    let cannons = find("confetti", "party-cannons");
    assert_eq!(
        cannons["emit"],
        json!({ "mode": "burst", "rate": 40.0, "count": 70.0, "interval": 2.4 })
    );
    assert_eq!(cannons["emitters"][1], json!({ "x": 100.0, "y": 83.0, "angle": -115.0 }));
    assert_eq!(cannons["angle"], json!(-90.0));
}

#[test]
fn confetti_shapes_and_colors_stay_within_the_document_rules() {
    let ranges: Value = serde_json::from_str(&engine_ranges(b"{}").unwrap()).unwrap();
    let shapes = ranges["confetti"]["shapes"].as_array().unwrap();
    assert_eq!(shapes.len(), 12);
    for preset in presets()["confetti"].as_array().unwrap() {
        assert!(preset["colors"].as_array().unwrap().len() <= ranges["confetti"]["maxColors"].as_u64().unwrap() as usize);
        assert!(preset["shapes"].as_array().unwrap().iter().all(|shape| shapes.contains(shape)));
    }
}
