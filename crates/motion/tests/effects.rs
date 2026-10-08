//! Effect manifest 目录一致性与解析守卫（dev-only：`bcut-motion` 本体无 I/O）。

use std::collections::BTreeSet;
use std::path::PathBuf;

use motion::effect::{
    BlendMode, ColorSpace, Determinism, EffectDomain, Precision, UniformMap, UniformValue,
    builtin_registry, lookup, parse_manifest, registered_effect_files, validate_all_effects,
};

fn presets_dir(namespace: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("presets/builtin")
        .join(namespace)
}

/// `core/presets/builtin/transition/` 里住着**两张**注册表的 manifest：
/// `bcf.*` 是 preset_registry 的双通道属性配方（`tests/manifests.rs` 管），
/// `transition.*` 是 effect registry 的双画面效果（本文件管）。按前缀切分，
/// 两边加起来必须覆盖目录里的每一个文件（`the_transition_directory_is_partitioned`）。
fn files_on_disk(namespace: &str) -> BTreeSet<String> {
    std::fs::read_dir(presets_dir(namespace))
        .expect("effect directory")
        .filter_map(|entry| {
            let path = entry.ok()?.path();
            if path.extension()?.to_str()? != "json" {
                return None;
            }
            let stem = path.file_stem()?.to_str()?.to_owned();
            if namespace == "transition" && !stem.starts_with("transition.") {
                return None;
            }
            Some(stem)
        })
        .collect()
}

/// transition 目录里不许出现第三种前缀：新文件要么进 preset 注册表、要么进
/// effect 注册表，不能两边都不认领。
#[test]
fn the_transition_directory_is_partitioned() {
    for entry in std::fs::read_dir(presets_dir("transition")).expect("transition directory") {
        let path = entry.unwrap().path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let stem = path.file_stem().unwrap().to_str().unwrap().to_owned();
        assert!(
            stem.starts_with("bcf.")
                || stem.starts_with("caption.")
                || stem.starts_with("transition."),
            "{stem}.json 不属于任何一张注册表：bcf.*（motion 配方）/ \
             caption.*（字幕入场姿态）/ transition.*（surface 效果）"
        );
    }
}

#[test]
fn every_effect_manifest_on_disk_is_registered() {
    for namespace in ["filter", "composite", "transition"] {
        let disk = files_on_disk(namespace);
        let registered: BTreeSet<String> = registered_effect_files(namespace)
            .into_iter()
            .map(str::to_owned)
            .collect();
        assert_eq!(
            disk, registered,
            "{namespace}: core/presets/builtin/{namespace} 与 effect/registry.rs 的清单不一致"
        );
    }
}

#[test]
fn all_effect_manifests_parse_and_declare_srgb_u8() {
    validate_all_effects().unwrap();
    let registry = builtin_registry();
    assert_eq!(registry.len(), 34);
    for manifest in registry.iter() {
        // 迁移配方的颜色契约是决策（设计 §15 阶段 4A）：保像素不变。
        assert_eq!(
            manifest.color.space,
            ColorSpace::SrgbPremultiplied,
            "{} 的 colorSpace",
            manifest.qualified()
        );
        assert_eq!(manifest.color.precision, Precision::U8);
        assert_eq!(manifest.determinism, Determinism::Strict);
        assert_eq!(manifest.origin, "top-left");
        assert_eq!(manifest.alpha, "premultiplied");
        assert!(!manifest.kernel.is_empty());
        assert!(manifest.capabilities.is_empty());
    }
    assert_eq!(registry.in_domain(EffectDomain::Filter).len(), 22);
    assert_eq!(registry.in_domain(EffectDomain::Mask).len(), 4);
    assert_eq!(registry.in_domain(EffectDomain::Composite).len(), 1);
    assert_eq!(registry.in_domain(EffectDomain::Transition).len(), 7);

    // 双画面转场必须声明两个输入；单输入的滤镜 / 遮罩不许混进这个域。
    for manifest in registry.in_domain(EffectDomain::Transition) {
        assert_eq!(manifest.inputs, 2, "{}", manifest.qualified());
        assert_eq!(
            manifest.resize_mode,
            "same-as-input",
            "{}",
            manifest.qualified()
        );
        // `progress` 是 pass 的字段，不是 uniform——写进 params 会让
        // `resolve_uniforms` 多要一个值，两处定义立刻分叉。
        assert!(
            !manifest.params.contains_key("progress"),
            "{}",
            manifest.qualified()
        );
    }
}

#[test]
fn the_blend_table_matches_the_closed_enum() {
    let blend = builtin_registry().get("composite.blend", 1).unwrap();
    let options = &blend.params["mode"].options;
    assert_eq!(options.len(), BlendMode::ALL.len());
    for (index, mode) in BlendMode::ALL.into_iter().enumerate() {
        assert_eq!(options[index], mode.as_str());
        assert_eq!(mode.code() as usize, index);
    }
}

#[test]
fn lookup_distinguishes_unknown_effect_from_unknown_version() {
    assert!(lookup("filter.blur", 1).is_ok());
    assert!(
        lookup("filter.blur", 7)
            .unwrap_err()
            .to_string()
            .contains("preset-version-unknown")
    );
    assert!(
        lookup("filter.nope", 1)
            .unwrap_err()
            .to_string()
            .contains("preset-unknown")
    );
}

#[test]
fn resolve_uniforms_fills_defaults_clamps_and_rejects_unknown_params() {
    let blur = builtin_registry().get("filter.blur", 1).unwrap();
    let filled = blur.resolve_uniforms(&UniformMap::new()).unwrap();
    assert_eq!(filled.scalar("radius"), Some(0.0));

    // `length` 参数是画布短边的**比例**，因此上限也是比例（0.5 = 半个短边）。
    let clamped = blur
        .resolve_uniforms(&UniformMap::new().with("radius", UniformValue::Scalar(9000.0)))
        .unwrap();
    assert_eq!(clamped.scalar("radius"), Some(0.5));

    let error = blur
        .resolve_uniforms(&UniformMap::new().with("radiuz", UniformValue::Scalar(1.0)))
        .unwrap_err()
        .to_string();
    assert!(error.contains("preset-param-unknown"), "{error}");

    let shape = builtin_registry().get("mask.shape", 1).unwrap();
    let error = shape
        .resolve_uniforms(&UniformMap::new().with("shape", UniformValue::Text("blob".into())))
        .unwrap_err()
        .to_string();
    assert!(error.contains("不在闭集"), "{error}");
}

#[test]
fn parse_rejects_unknown_keys_bad_enums_and_unbacked_non_strict() {
    let good = r#"{
        "id": "filter.x", "version": 1, "domain": "filter", "inputs": 1,
        "params": {}, "color": {"colorSpace": "srgb-premultiplied", "precision": "u8"},
        "kernel": "k", "origin": "top-left", "alpha": "premultiplied",
        "sampling": "nearest", "edge": "clamp", "resizeMode": "same-as-input",
        "determinism": "strict", "capabilities": [], "fallback": null
    }"#;
    assert!(parse_manifest(good, 0).is_ok());

    let extra_key = good.replace("\"inputs\": 1", "\"inputs\": 1, \"whoops\": 1");
    assert!(
        parse_manifest(&extra_key, 0)
            .unwrap_err()
            .to_string()
            .contains("未知键")
    );

    let bad_origin = good.replace("\"top-left\"", "\"bottom-left\"");
    assert!(parse_manifest(&bad_origin, 0).is_err());

    let visual = good.replace("\"determinism\": \"strict\"", "\"determinism\": \"visual\"");
    assert!(
        parse_manifest(&visual, 0)
            .unwrap_err()
            .to_string()
            .contains("必须声明 fallback")
    );

    let strict_with_caps = good.replace("\"capabilities\": []", "\"capabilities\": [\"gpu\"]");
    assert!(
        parse_manifest(&strict_with_caps, 0)
            .unwrap_err()
            .to_string()
            .contains("strict")
    );
}
