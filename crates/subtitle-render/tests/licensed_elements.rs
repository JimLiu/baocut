//! End-to-end asset checks: the shipped bytes, shared fill parser and native
//! renderer must agree. No copies of the old vendor artwork are used as fixtures.
//!
//! The catalogue has two halves since round 238: 301 static SVG stickers (MIT /
//! CC0, recolourable through `svg_fill`; includes the 32 CTA composites added in
//! f4c0e6ffe) and 81 Lottie animations (Google Noto Animated Emoji, CC BY 4.0,
//! recolourable through the Lottie fill table).
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use timeline::svg_fill;

// v2 的路径（`apps/baocut/assets/stickers`）。v3 还没有贴纸库，本文件的测试都标了 ignore。
fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../apps/baocut/assets/stickers")
}

#[test]
#[ignore = "读 v2 的贴纸库 apps/baocut/assets/stickers：元素素材未随本批带来，待元素素材批次"]
fn a_reopened_colored_lottie_keeps_its_animation_and_export_pixels() {
    use serde_json::json;
    use subtitle_render::OverlayRenderPlan;
    let project = tempfile::tempdir().unwrap();
    std::fs::create_dir(project.path().join("media")).unwrap();
    // Noto ghost: 144 frames @ 60 fps, body fill `#E0E0E0` / `#FFFFFF`.
    let bytes = std::fs::read(root().join("anim/dyn-emoji-01.json")).unwrap();
    std::fs::write(project.path().join("media/ghost.json"), &bytes).unwrap();
    let timeline = json!({
        "bcutTimeline":"0.7",
        "sources":{"src-ghost":{"path":"media/ghost.json","kind":"lottie","naturalW":1024,"naturalH":1024,"duration":2.4,"hasAudio":false}},
        "tracks":[{"id":"stickers","kind":"overlay","elements":[{
            "id":"ghost","kind":"sticker","srcId":"src-ghost","start":0,"end":3,
            "place":{"x":50,"y":50,"w":60},
            "sticker":{"source":"asset","path":"media/ghost.json","fillOverrides":{"#E0E0E0":"#10FE72","#FFFFFF":"#10FE72"}},
            "animate":null
        }]}]
    });
    std::fs::write(
        project.path().join("timeline.json"),
        serde_json::to_vec(&timeline).unwrap(),
    )
    .unwrap();
    let reopened: serde_json::Value =
        serde_json::from_slice(&std::fs::read(project.path().join("timeline.json")).unwrap())
            .unwrap();
    let document = json!({"meta":{"duration":3},"style":{"mode":"orig","fontFamily":"Montserrat","fontSize":30},"cues":[],"sentences":[],"transCues":[],"timeline":reopened});
    let mut plan = OverlayRenderPlan::compile(&document, 320, 180, 3.0, 30.0, None).unwrap();
    plan.load_timeline_elements(project.path(), &document)
        .unwrap();
    let first = plan.render_rgba(0.4).unwrap();
    let second = plan.render_rgba(1.6).unwrap();
    assert_ne!(first, second, "lottie animation must survive reopen");
    assert!(
        first.chunks_exact(4).any(|p| p[3] > 200
            && p[1] > p[0].saturating_add(60)
            && p[1] > p[2].saturating_add(30)),
        "edited color must reach exported pixels"
    );
    plan.compositor_scene_support().unwrap();
    let frame = plan.compositor_scene_frame(0.4).unwrap();
    assert!(
        frame
            .next_change
            .is_some_and(|t| t > 0.4 && t <= 0.4 + 1.0 / 30.0 + 1e-9),
        "intrinsic media must keep preview scheduling awake"
    );
    assert_eq!(
        std::fs::read(project.path().join("media/ghost.json")).unwrap(),
        bytes
    );
}

#[test]
#[ignore = "读 v2 的贴纸库 apps/baocut/assets/stickers：元素素材未随本批带来，待元素素材批次"]
fn every_shipped_static_sticker_has_editable_regions_and_renders_after_partial_recolor() {
    let base = root();
    let mut count = 0;
    for entry in std::fs::read_dir(&base).unwrap().flatten() {
        let path = entry.path();
        if path.extension().is_none_or(|v| v != "svg") {
            continue;
        }
        let svg = std::fs::read_to_string(&path).unwrap();
        assert!(
            svg.contains("MIT License") || svg.contains("CC0"),
            "{}",
            path.display()
        );
        let cards = svg_fill::fills_of(&svg);
        // 单色线性图标只有一张色卡；多色贴纸最多五张。
        assert!(
            (1..=5).contains(&cards.len()),
            "{}: {cards:?}",
            path.display()
        );
        let original = render_raster::assets::decode_image("sticker.svg", svg.as_bytes()).unwrap();
        assert!(
            original.data().chunks_exact(4).any(|p| p[3] > 0),
            "{}",
            path.display()
        );
        // Every advertised region must affect visible pixels, including small
        // highlights; unused definitions must not create phantom color cards.
        let replacement = "#10FE72".to_owned();
        assert!(!cards.iter().any(|c| c.hex == replacement));
        for selected in 0..cards.len() {
            let overrides = BTreeMap::from([(cards[selected].hex.clone(), replacement.clone())]);
            let json = serde_json::to_string(&overrides).unwrap();
            let restored = serde_json::from_str(&json).unwrap();
            let modified = svg_fill::apply_overrides(&svg, &restored);
            let after = svg_fill::fills_of(&modified);
            assert_eq!(after.len(), cards.len(), "{}", path.display());
            for (i, card) in cards.iter().enumerate() {
                assert_eq!(
                    after[i].hex.as_str(),
                    if i == selected {
                        replacement.as_str()
                    } else {
                        card.hex.as_str()
                    }
                );
                assert_eq!(after[i].count, card.count);
            }
            let image =
                render_raster::assets::decode_image("sticker.svg", modified.as_bytes()).unwrap();
            assert_eq!(
                (image.width(), image.height()),
                (original.width(), original.height())
            );
            assert_ne!(
                image.data(),
                original.data(),
                "recolor must reach pixels: {} group {}",
                path.display(),
                selected
            );
        }
        assert_eq!(std::fs::read_to_string(&path).unwrap(), svg);
        count += 1;
    }
    assert_eq!(count, 301);
    // `anim/` no longer ships SVG: the dynamic catalogue is Lottie only.
    let anim_svgs = std::fs::read_dir(base.join("anim"))
        .unwrap()
        .flatten()
        .filter(|entry| entry.path().extension().is_some_and(|v| v == "svg"))
        .count();
    assert_eq!(anim_svgs, 0);
}

#[test]
#[ignore = "读 v2 的贴纸库 apps/baocut/assets/stickers：元素素材未随本批带来，待元素素材批次"]
fn every_shipped_lottie_sticker_carries_its_attribution_and_parses() {
    let mut count = 0;
    for entry in std::fs::read_dir(root().join("anim")).unwrap().flatten() {
        let path = entry.path();
        if path.extension().is_none_or(|v| v != "json")
            || path
                .file_name()
                .is_some_and(|name| name == "provenance.json")
        {
            continue;
        }
        let bytes = std::fs::read(&path).unwrap();
        let value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let meta = &value["meta"];
        assert_eq!(meta["a"], "Google LLC", "{}", path.display());
        assert!(
            meta["k"]
                .as_str()
                .is_some_and(|k| k.starts_with("CC BY 4.0")),
            "{}: {meta}",
            path.display()
        );
        let lottie = render_raster::source::lottie::Lottie::parse("test", "sticker", &bytes)
            .unwrap_or_else(|error| panic!("{}: {error:#}", path.display()));
        assert!(lottie.frame_rate() > 0.0, "{}", path.display());
        let metadata = lottie.metadata();
        assert!(metadata.frame_count() >= 2, "{}", path.display());
        assert!(
            metadata.frame_starts_ms.last().is_some_and(|&ms| ms > 0),
            "{}",
            path.display()
        );
        count += 1;
    }
    assert_eq!(count, 81);
}
