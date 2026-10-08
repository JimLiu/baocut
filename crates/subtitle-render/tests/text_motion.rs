use serde_json::{Value, json};
use subtitle_render::{OverlayIncludes, OverlayRenderPlan, text_design};

fn plan(style: Value, text: &str) -> OverlayRenderPlan {
    let mut doc = text_design::demo_document(&style, text);
    doc["style"]["displayTiming"] = json!({"leadIn":0,"tail":0});
    OverlayRenderPlan::compile_with_injected_fonts(
        &doc,
        320,
        180,
        4.0,
        30.0,
        None,
        OverlayIncludes::ALL,
        vec![
            include_bytes!("../../render-raster/assets/fonts/NotoSansSC-Variable.ttf").to_vec(),
            include_bytes!("../../render-raster/assets/fonts/Inter-Medium.ttf").to_vec(),
        ],
    )
    .unwrap()
}

#[test]
fn every_curated_motion_renders_and_random_seek_reproduces_pixels() {
    for design in text_design::designs() {
        let mut renderer = plan(design["style"].clone(), "Make every word count");
        let early = renderer.render_subtitle_frame(0.05).unwrap().rgba;
        let middle = renderer.render_subtitle_frame(1.1).unwrap().rgba;
        assert!(
            middle.chunks_exact(4).any(|p| p[3] > 0),
            "{} is blank",
            design["id"]
        );
        assert_ne!(early, middle, "{} does not move", design["id"]);
        renderer.render_subtitle_frame(3.8).unwrap();
        assert_eq!(
            early,
            renderer.render_subtitle_frame(0.05).unwrap().rgba,
            "{} seek is stateful",
            design["id"]
        );
    }
}

#[test]
fn reveal_keeps_full_layout_and_background_size() {
    let design = text_design::designs()
        .iter()
        .find(|d| d["id"] == "paper-typewriter")
        .unwrap();
    let mut renderer = plan(design["style"].clone(), "Café déjà vu — 世界 👩‍💻");
    let first = renderer.active_layouts(0.05);
    let last = renderer.active_layouts(2.5);
    assert_eq!(first[0].width, last[0].width);
    assert_eq!(first[0].height, last[0].height);
    let a = renderer.render_subtitle_frame(0.05).unwrap();
    let b = renderer.render_subtitle_frame(2.5).unwrap();
    assert_ne!(a.rgba, b.rgba);
    // The paper exists before all characters are revealed.
    assert!(a.rgba.chunks_exact(4).filter(|p| p[3] > 200).count() > 100);
}

#[test]
fn invalid_new_version_is_rejected_without_modifying_document() {
    let style = json!({"textMotion":{"version":2}});
    assert!(text_design::validate_motion_tree(&style).is_err());
    assert_eq!(style["textMotion"]["version"], 2);
}

#[test]
fn stored_motion_and_word_plates_survive_context_reconciliation() {
    let mut before = json!({"mode":"orig","fontSize":34});
    let style = &text_design::designs()[1]["style"];
    before
        .as_object_mut()
        .unwrap()
        .extend(style.as_object().unwrap().clone());
    let mut after = before.clone();
    after["fontColor"] = json!("#20CCAA");
    subtitle_render::style_sync::reconcile_replacement(&mut after, &before, Some("sub"));
    assert_eq!(after["textMotion"], before["textMotion"]);
    assert_eq!(after["wordBackground"], before["wordBackground"]);
}

#[test]
fn untimed_source_does_not_invent_speech_emphasis() {
    let mut doc =
        text_design::demo_document(&text_design::designs()[0]["style"], "No timing supplied");
    doc["cues"][0].as_object_mut().unwrap().remove("words");
    let mut renderer = OverlayRenderPlan::compile_with_injected_fonts(
        &doc,
        320,
        180,
        4.0,
        30.0,
        None,
        OverlayIncludes::ALL,
        vec![include_bytes!("../../render-raster/assets/fonts/Inter-Medium.ttf").to_vec()],
    )
    .unwrap();
    assert_eq!(
        renderer.render_subtitle_frame(0.4).unwrap().rgba,
        renderer.render_subtitle_frame(1.4).unwrap().rgba
    );
}

#[test]
fn completed_entrance_reuses_cache_but_exit_wakes_before_end() {
    let style = &text_design::designs()
        .iter()
        .find(|d| d["id"] == "rise-settle")
        .unwrap()["style"];
    let mut renderer = plan(style.clone(), "Hold this line");
    let a = renderer.render_subtitle_frame(2.5).unwrap().rgba;
    let b = renderer.render_subtitle_frame(3.0).unwrap().rgba;
    assert_eq!(a, b);
    assert_ne!(a, renderer.render_subtitle_frame(3.95).unwrap().rgba);
    let next = renderer.next_change_after(3.5, false).unwrap();
    assert!(next > 3.5 && next < 3.9, "exit wakeup {next}");
}

#[test]
fn adjacent_word_plates_have_deterministic_paint_order() {
    let mut doc = text_design::demo_document(&text_design::designs()[1]["style"], "星河闪耀");
    doc["cues"][0]["words"] = json!([
        {"id":"a","text":"星河","t0":0,"t1":1},
        {"id":"b","text":"闪耀","t0":1.2,"t1":4}
    ]);
    let render = || {
        let mut plan = OverlayRenderPlan::compile_with_injected_fonts(
            &doc,
            320,
            180,
            4.0,
            30.0,
            None,
            OverlayIncludes::ALL,
            vec![
                include_bytes!("../../render-raster/assets/fonts/NotoSansSC-Variable.ttf").to_vec(),
            ],
        )
        .unwrap();
        plan.render_subtitle_frame(1.3).unwrap().rgba
    };
    let expected = render();
    for _ in 0..3 {
        assert_eq!(expected, render());
    }
}

/// 逐帧光栅（`text_motion_raster.rs`）的像素身份门：八款设计与几条加压变体
/// （字形簇级 blur-in + 模糊阴影 / 发光、四种 loop、slide-mask 裁切、CJK）
/// 在入场、稳定、loop 中段与退出各时刻，两种画幅逐帧 sha256 与 golden 对拍。
///
/// 「只改性能」的改动必须让它保持全等；有意改变像素时 `BCUT_UPDATE_GOLDEN=1` 重写。
/// 2026-09-28：scratch 复用 / 脏区清理先对 a2d575417 的 golden 全等通过，随后
/// 亚像素落位 + 变换时 Bilinear + 裁边按覆盖率三处有意改像素，golden 在其后重写。
/// 只在 macOS 上对拍：旋转走平台 libm 的 `sin_cos`，跨平台末位可能不同。
#[cfg(target_os = "macos")]
#[test]
fn text_motion_frames_match_golden() {
    let fonts = || {
        [
            include_bytes!("../../render-raster/assets/fonts/NotoSansSC-Variable.ttf").as_slice(),
            include_bytes!("../../render-raster/assets/fonts/Anton-Regular.ttf").as_slice(),
            include_bytes!("../../render-raster/assets/fonts/Inter-Medium.ttf").as_slice(),
            include_bytes!("../../render-raster/assets/fonts/Poppins-Black.ttf").as_slice(),
            include_bytes!("../../render-raster/assets/fonts/RobotoMono-Medium.ttf").as_slice(),
            include_bytes!("../../render-raster/assets/fonts/PlayfairDisplay-Italic.ttf")
                .as_slice(),
            include_bytes!("../../render-raster/assets/fonts/Oswald-Bold.ttf").as_slice(),
        ]
        .iter()
        .map(|bytes| bytes.to_vec())
        .collect::<Vec<_>>()
    };
    let designs = text_design::designs();
    let by_id = |id: &str| designs.iter().find(|d| d["id"] == id).unwrap()["style"].clone();
    let four = "Make every word count";
    let long = "The quick brown fox jumps high";
    let mut scenarios: Vec<(String, Value, &str)> = designs
        .iter()
        .map(|d| {
            (
                d["id"].as_str().unwrap().to_string(),
                d["style"].clone(),
                four,
            )
        })
        .collect();
    let mut blur = by_id("soft-focus");
    blur["textMotion"] = json!({"version":1,
        "in":{"preset":"blur-in","unit":"grapheme","durationSeconds":0.4,"staggerSeconds":0.04,"intensity":1,"easing":"easeOutQuad"},
        "out":{"preset":"blur-out","unit":"word","durationSeconds":0.3,"staggerSeconds":0.05,"intensity":1,"easing":"easeInQuad"}});
    blur["dropShadow"]["blur"] = json!(0.3);
    scenarios.push(("grapheme-blur-shadow".into(), blur.clone(), long));
    blur["dropShadow"]["on"] = json!(false);
    blur["glow"] = json!({"on":true,"color":"#33CCFF","intensity":70,"range":40});
    scenarios.push(("grapheme-blur-glow".into(), blur, long));
    for (preset, unit) in [
        ("pulse", "word"),
        ("swing", "grapheme"),
        ("shimmer", "line"),
    ] {
        let mut style = by_id("focus");
        style["textMotion"]["loop"] = json!({"preset":preset,"unit":unit,"durationSeconds":0.8,"staggerSeconds":0.05,"intensity":1,"easing":"linear"});
        style["textMotion"]["in"] = json!({"preset":"pop","unit":unit,"durationSeconds":0.3,"staggerSeconds":0.05,"intensity":1,"easing":"easeOutQuad"});
        scenarios.push((format!("loop-{preset}-{unit}"), style, four));
    }
    let mut swipe = by_id("line-swipe");
    swipe["dropShadow"]["blur"] = json!(0.2);
    scenarios.push(("swipe-blur-shadow".into(), swipe, long));
    let mut cjk = by_id("kinetic-wave");
    cjk["glow"] = json!({"on":true,"color":"#FFFFFF","intensity":50,"range":30});
    scenarios.push(("cjk-wave-glow".into(), cjk, "星河闪耀 世界你好 Café"));

    let mut hashes = std::collections::BTreeMap::new();
    for (width, height) in [(1280_u32, 720_u32), (320, 180)] {
        for (id, style, text) in &scenarios {
            let doc = text_design::demo_document(style, text);
            let mut renderer = OverlayRenderPlan::compile_with_injected_fonts(
                &doc,
                width,
                height,
                4.0,
                30.0,
                None,
                OverlayIncludes::ALL,
                fonts(),
            )
            .unwrap();
            for time in [0.03, 0.12, 0.3, 0.9, 1.35, 3.0, 3.92] {
                let rgba = renderer.render_subtitle_frame(time).unwrap().rgba;
                hashes.insert(
                    format!("{width}x{height}/{id}/{time}"),
                    // sha2 0.11 的摘要没有 `LowerHex`：逐字节写出，与 v2 的 `{:x}` 同值。
                    <sha2::Sha256 as sha2::Digest>::digest(&*rgba)
                        .iter()
                        .map(|b| format!("{b:02x}"))
                        .collect::<String>(),
                );
            }
        }
    }
    let golden = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/golden/text-motion-frames.json");
    let actual = serde_json::to_string_pretty(&hashes).unwrap();
    if std::env::var_os("BCUT_UPDATE_GOLDEN").is_some() {
        std::fs::write(&golden, actual + "\n").unwrap();
        return;
    }
    let expected: std::collections::BTreeMap<String, String> =
        serde_json::from_str(&std::fs::read_to_string(&golden).unwrap()).unwrap();
    let differing = hashes
        .iter()
        .filter(|(key, hash)| expected.get(*key) != Some(hash))
        .map(|(key, _)| key.as_str())
        .collect::<Vec<_>>();
    assert!(
        differing.is_empty() && expected.len() == hashes.len(),
        "text motion pixels changed: {differing:?}"
    );
}
