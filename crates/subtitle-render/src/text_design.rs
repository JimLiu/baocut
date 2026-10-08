//! Curated behavior families. Font, color and motion values remain ordinary
//! editable style properties; visually similar designs share one family.
use serde_json::Value;
use std::sync::OnceLock;

pub fn designs() -> &'static [Value] {
    static DESIGNS: OnceLock<Vec<Value>> = OnceLock::new();
    DESIGNS.get_or_init(|| {
        serde_json::from_str(include_str!("../assets/subtitle-designs.json"))
            .expect("subtitle design data")
    })
}

/// A preview fixture, not project content or transcription. Callers supply the
/// sample copy; real documents keep their original words and timing.
pub fn demo_document(style: &Value, sample: &str) -> Value {
    let words = sample.split_whitespace().collect::<Vec<_>>();
    let mut style = style.clone();
    style["mode"] = serde_json::json!("orig");
    style["tracks"] = serde_json::json!([{"role":"source"}]);
    for (key, value) in [
        ("x", 50.0),
        ("y", 50.0),
        ("width", 88.0),
        ("fontSize", 58.0),
        ("leadIn", 0.0),
        ("tail", 0.0),
    ] {
        style[key] = serde_json::json!(value);
    }
    style["fontSizeBasis"] = serde_json::json!("height");
    style["displayTiming"] = serde_json::json!({"leadIn":0.0,"tail":0.0});
    style["verticalAlign"] = serde_json::json!("center");
    style["wordAnimation"] = serde_json::json!({"animationName":"None"});
    serde_json::json!({"meta":{"duration":4.0},"style":style,
        "cues":[{"id":"preview","start":0.0,"end":4.0,"text":sample,
            "words":words.iter().enumerate().map(|(i,word)| serde_json::json!({"id":format!("preview-{i}"),"text":word,"t0":i as f64*0.6,"t1":i as f64*0.6+0.4})).collect::<Vec<_>>() }],
        "sentences":[],"transCues":[]})
}

/// Called by render preparation and style writers before accepting a new spec.
/// Null clears motion; unknown versions are reported, never rewritten.
pub fn validate_motion_tree(value: &Value) -> Result<(), String> {
    match value {
        Value::Object(map) => {
            if let Some(motion) = map.get("textMotion").filter(|v| !v.is_null()) {
                serde_json::from_value::<motion::text_motion::TextMotion>(motion.clone())
                    .map_err(|e| format!("invalid textMotion: {e}"))?
                    .validate()?;
            }
            if let Some(background) = map.get("wordBackground").filter(|v| !v.is_null()) {
                let b: crate::WordBackground = serde_json::from_value(background.clone())
                    .map_err(|e| format!("invalid wordBackground: {e}"))?;
                if [b.padding_x_em, b.padding_y_em, b.radius_em]
                    .iter()
                    .any(|v| !v.is_finite() || !(0.0..=2.0).contains(v))
                    || crate::parse_css_color(&b.color).is_none()
                    || crate::parse_css_color(&b.active_color).is_none()
                {
                    return Err("invalid wordBackground dimensions or colors".into());
                }
            }
            for (key, child) in map {
                if key != "textMotion" && key != "wordBackground" {
                    validate_motion_tree(child)?;
                }
            }
        }
        Value::Array(array) => {
            for child in array {
                validate_motion_tree(child)?;
            }
        }
        _ => {}
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn all_behavior_families_are_distinct_and_valid() {
        assert_eq!(designs().len(), 9);
        let mut ids = std::collections::HashSet::new();
        for design in designs() {
            assert!(ids.insert(design["id"].as_str().unwrap()));
            validate_motion_tree(design).unwrap();
        }
    }
}
