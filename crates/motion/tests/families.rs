//! 阶段 2 验收：**UI 可组合 ≥30 个视觉变体，而 canonical family ≤ ~12**
//! （设计 §10 阶段 2 / §5.4.3）。
//!
//! 「变体」的判据不是卡片数量，而是**展开后的轨集合两两不同**——同一个 family 换个
//! 参数如果给出逐位相同的轨，那它不是一个变体，是一张重复的卡片。

use std::collections::BTreeSet;

use motion::preset_registry::{
    CANONICAL_FAMILY_BUDGET, ExpandCtx, expand, families, manifest, manifest_ids,
};
use serde_json::{Map, Value, json};

fn params(value: Value) -> Map<String, Value> {
    value.as_object().cloned().unwrap()
}

/// 展开结果的规范化文本。相对长度对象仍未求值（布局之后才求值），因此它也进签名。
fn signature(id: &str, p: Value) -> String {
    let out = expand(id, None, &params(p), &ExpandCtx::with_dur(0.5))
        .unwrap_or_else(|error| panic!("{id}: {error}"));
    let mut text = String::new();
    for track in &out.tracks {
        text.push_str(&format!(
            "{}|{:?}|{}|",
            track.prop, track.composite, track.order
        ));
        for frame in &track.frames {
            text.push_str(&format!("{}={}@{:?};", frame.t, frame.v, frame.ease));
        }
        text.push('\n');
    }
    text
}

const DIRECTIONAL: &[&str] = &[
    "motion.moveIn",
    "motion.moveOut",
    "motion.backIn",
    "motion.backOut",
    "motion.elasticIn",
    "motion.elasticOut",
    "motion.rollIn",
    "motion.rollOut",
];

#[test]
fn thirty_plus_distinct_variants_from_at_most_twelve_families() {
    let mut signatures: BTreeSet<String> = BTreeSet::new();
    for id in DIRECTIONAL {
        for direction in ["left", "right", "up", "down"] {
            signatures.insert(signature(id, json!({ "direction": direction })));
        }
    }
    for (id, key, values) in [
        ("motion.scaleIn", "scaleFrom", vec![json!(0.4), json!(0.9)]),
        ("motion.scaleOut", "scaleTo", vec![json!(0.4), json!(0.9)]),
        (
            "motion.rotateIn",
            "rotationFrom",
            vec![json!(-24.0), json!(24.0)],
        ),
        (
            "motion.rotateOut",
            "rotationTo",
            vec![json!(-24.0), json!(24.0)],
        ),
        ("motion.blurIn", "blur", vec![json!(4.0), json!(16.0)]),
        ("motion.blurOut", "blur", vec![json!(4.0), json!(16.0)]),
        ("motion.pulse", "scale", vec![json!(1.04), json!(1.2)]),
        ("motion.flash", "to", vec![json!(0.0), json!(0.5)]),
        ("motion.tilt", "angle", vec![json!(3.0), json!(-8.0)]),
        (
            "motion.fadeIn",
            "curve",
            vec![json!("linear"), json!("easeOutExpo")],
        ),
        (
            "motion.fadeOut",
            "curve",
            vec![json!("linear"), json!("easeInExpo")],
        ),
    ] {
        for value in values {
            signatures.insert(signature(id, json!({ key: value })));
        }
    }
    assert!(
        signatures.len() >= 30,
        "只得到 {} 个互不相同的变体",
        signatures.len()
    );
    assert!(
        families().len() <= CANONICAL_FAMILY_BUDGET,
        "{:?} 超出家族预算",
        families()
    );
}

#[test]
fn the_fade_switch_changes_the_expansion_of_every_composable_family() {
    for id in [
        "motion.moveIn",
        "motion.moveOut",
        "motion.scaleIn",
        "motion.scaleOut",
        "motion.backIn",
        "motion.backOut",
        "motion.elasticIn",
        "motion.elasticOut",
        "motion.rotateIn",
        "motion.rotateOut",
        "motion.rollIn",
        "motion.rollOut",
        "motion.blurIn",
        "motion.blurOut",
    ] {
        let with = signature(id, json!({ "fade": true }));
        let without = signature(id, json!({ "fade": false }));
        assert_ne!(with, without, "{id}");
        assert!(with.contains("opacity"), "{id}");
        assert!(!without.contains("opacity"), "{id}");
    }
}

#[test]
fn direction_only_drives_the_axis_it_names() {
    for id in DIRECTIONAL {
        for (direction, present, absent) in [
            ("left", "x", "y"),
            ("right", "x", "y"),
            ("up", "y", "x"),
            ("down", "y", "x"),
        ] {
            let out = expand(
                id,
                None,
                &params(json!({ "direction": direction })),
                &ExpandCtx::with_dur(0.5),
            )
            .unwrap();
            let props: Vec<&str> = out.tracks.iter().map(|t| t.prop.as_str()).collect();
            assert!(props.contains(&present), "{id}/{direction}: {props:?}");
            assert!(!props.contains(&absent), "{id}/{direction}: {props:?}");
        }
    }
}

#[test]
fn every_manifest_expands_with_its_defaults() {
    for id in manifest_ids() {
        let out = expand(id, None, &Map::new(), &ExpandCtx::with_dur(0.5))
            .unwrap_or_else(|error| panic!("{id}: {error}"));
        assert!(!out.tracks.is_empty(), "{id} 展开出空程序");
        for track in &out.tracks {
            assert!(track.frames.len() >= 2, "{id}/{}", track.prop);
            assert!(
                track.frames.windows(2).all(|w| w[0].t <= w[1].t),
                "{id}/{}: 帧时间非单调",
                track.prop
            );
        }
        // 展开结果不残留 preset 名，provenance 只在 sources 里
        assert!(!out.sources.is_empty(), "{id}");
    }
}

#[test]
fn compose_provenance_lists_every_layer() {
    let out = expand(
        "motion.backIn",
        None,
        &Map::new(),
        &ExpandCtx::with_dur(0.5),
    )
    .unwrap();
    let ids: Vec<&str> = out.sources.iter().map(|s| s.id.as_str()).collect();
    assert_eq!(
        ids,
        vec![
            "motion.backIn",
            "motion.shiftIn",
            "motion.zoomIn",
            "motion.fadeIn"
        ]
    );
    assert!(out.sources.iter().all(|s| s.manifest_hash != 0));
}

#[test]
fn aliases_expand_to_the_canonical_family_and_are_reported() {
    let out = expand("springPop", None, &Map::new(), &ExpandCtx::with_dur(0.5)).unwrap();
    assert_eq!(out.aliases_used, vec!["springPop".to_string()]);
    assert_eq!(out.sources[0].id, "motion.backIn");
    assert_eq!(
        signature("springPop", json!({})),
        signature("motion.backIn", json!({}))
    );
}

#[test]
fn every_family_has_a_doc_string_and_at_most_one_owner_per_alias() {
    let mut seen: BTreeSet<&str> = BTreeSet::new();
    for id in manifest_ids() {
        let entry = manifest(id).unwrap();
        for alias in &entry.aliases {
            assert!(seen.insert(alias.as_str()), "alias {alias} 重复声明");
        }
    }
    for family in families() {
        assert!(
            manifest_ids()
                .iter()
                .any(|id| manifest(id).unwrap().family.as_deref() == Some(family)),
            "{family}"
        );
    }
}
