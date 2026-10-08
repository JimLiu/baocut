use std::collections::HashSet;
use std::path::{Path, PathBuf};

// v2 的路径（`apps/baocut/assets/stickers`）。v3 还没有贴纸库，用到它的测试标了 ignore。
fn anim_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../apps/baocut/assets/stickers/anim")
}

/// 一张 640×360 的宽画幅贴纸：16 个方块铺满 4×4 网格，每块带各自的 SMIL 位移，
/// 用来验证 `fullscreen` + `cover` 在三种画幅下都把贴纸铺到画布边缘。第 231 轮之前
/// 这里用的是 Confetti 动图；Confetti 改为算法元素后由这张内联测试图接替。
fn fullscreen_grid_svg() -> String {
    let mut body = String::new();
    for row in 0..4 {
        for col in 0..4 {
            let dx = if (row + col) % 2 == 0 { 6 } else { -6 };
            body.push_str(&format!(
                "<rect x=\"{}\" y=\"{}\" width=\"160\" height=\"90\" fill=\"#FF476F\">\
                 <animateTransform attributeName=\"transform\" type=\"translate\" \
                 values=\"0 0;{dx} 0;0 0\" dur=\"3s\" repeatCount=\"indefinite\"/></rect>",
                col * 160,
                row * 90
            ));
        }
    }
    format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"640\" height=\"360\" viewBox=\"0 0 640 360\">{body}</svg>"
    )
}

/// 一张 128×128 的 SMIL 贴纸：一个方块 3 s 内从左滑到右再回来，用来验证共享源
/// 的独立时钟。内置目录自第 238 轮起只剩 Lottie，SVG 动画走用户上传，所以这里
/// 内联一张而不是借内置素材。
fn sliding_square_svg() -> String {
    "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"128\" height=\"128\" viewBox=\"0 0 128 128\">\
     <rect x=\"8\" y=\"40\" width=\"48\" height=\"48\" fill=\"#2170E6\">\
     <animateTransform attributeName=\"transform\" type=\"translate\" \
     values=\"0 0;64 0;0 0\" dur=\"3s\" repeatCount=\"indefinite\"/></rect></svg>"
        .to_owned()
}

#[test]
fn fullscreen_cover_reaches_the_edges_in_landscape_portrait_and_square() {
    use serde_json::json;
    use subtitle_render::OverlayRenderPlan;
    let root = tempfile::tempdir().unwrap();
    std::fs::write(root.path().join("rain.svg"), fullscreen_grid_svg()).unwrap();
    let timeline = json!({"bcutTimeline":"0.5","sources":{"rain":{"kind":"image","path":"rain.svg","naturalW":640,"naturalH":360}},
        "tracks":[{"id":"overlay","kind":"overlay","elements":[{"id":"confetti","kind":"sticker","srcId":"rain","start":0,"end":3,
        "mode":"fullscreen","fit":"cover","place":{"x":50,"y":50,"w":100},"sticker":{"source":"asset","path":"rain.svg","loop":"loop"}}]}]});
    std::fs::write(
        root.path().join("timeline.json"),
        serde_json::to_vec(&timeline).unwrap(),
    )
    .unwrap();
    let doc = json!({"meta":{"duration":3},"style":{"mode":"orig","fontFamily":"Montserrat","fontSize":30},"cues":[],"sentences":[],"transCues":[],"timeline":timeline});
    for (w, h) in [(320, 180), (180, 320), (240, 240)] {
        let mut plan = OverlayRenderPlan::compile(&doc, w, h, 3.0, 30.0, None).unwrap();
        plan.load_timeline_elements(root.path(), &doc).unwrap();
        let mut cells = HashSet::new();
        for t in [0.0, 0.5, 1.0, 1.5, 2.0, 2.5] {
            for (i, p) in plan.render_rgba(t).unwrap().chunks_exact(4).enumerate() {
                if p[3] > 100 {
                    cells.insert((
                        (i % w as usize) * 4 / w as usize,
                        (i / w as usize) * 4 / h as usize,
                    ));
                }
            }
        }
        assert_eq!(
            cells.len(),
            16,
            "{w}x{h}: a fullscreen cover sticker must reach all 4x4 canvas regions, not sit as a small center sticker"
        );
    }
}

/// 两个贴纸共用一个源、错开 0.5 s 上场：`loop` 下各走各的时钟，`hold` 定格首帧、
/// `once` 播完停末帧时两者才相同。SVG 动画（用户上传）与 Lottie（内置 / 上传）
/// 两种动态源都要守这条。
#[test]
#[ignore = "读 v2 的贴纸库 apps/baocut/assets/stickers：元素素材未随本批带来，待元素素材批次"]
fn shared_sources_keep_independent_clocks_and_honor_hold_and_once() {
    use serde_json::json;
    use subtitle_render::OverlayRenderPlan;
    let root = tempfile::tempdir().unwrap();
    std::fs::create_dir(root.path().join("media")).unwrap();
    std::fs::write(root.path().join("media/a.svg"), sliding_square_svg()).unwrap();
    // Noto ghost：144 帧 @ 60 fps = 2.4 s，主体在 1.0 s 后上下浮动。
    std::fs::copy(
        anim_root().join("dyn-emoji-01.json"),
        root.path().join("media/a.json"),
    )
    .unwrap();
    let sources = [
        (
            "svg",
            json!({"kind":"image","path":"media/a.svg","naturalW":128,"naturalH":128}),
        ),
        (
            "lottie",
            json!({"kind":"lottie","path":"media/a.json","naturalW":1024,"naturalH":1024,"duration":2.4,"hasAudio":false}),
        ),
    ];
    for (label, source) in sources {
        let path = source["path"].as_str().unwrap().to_owned();
        for (mode, time, same) in [
            ("loop", 1.5, false),
            ("hold", 1.5, true),
            ("once", 4.0, true),
        ] {
            let element = |id: &str, start: f64, x: f64| {
                json!({"id":id,"kind":"sticker","srcId":"src","start":start,"end":8,
                "place":{"x":x,"y":50,"w":25},"sticker":{"source":"asset","path":path,"loop":mode}})
            };
            let timeline = json!({"bcutTimeline":"0.7","sources":{"src":source},
                "tracks":[{"id":"track","kind":"overlay","elements":[element("a",0.0,25.0),element("b",0.5,75.0)]}]});
            std::fs::write(
                root.path().join("timeline.json"),
                serde_json::to_vec(&timeline).unwrap(),
            )
            .unwrap();
            let doc = json!({"meta":{"duration":8},"style":{"mode":"orig","fontFamily":"Montserrat","fontSize":30},"cues":[],"sentences":[],"transCues":[],"timeline":timeline});
            let mut plan = OverlayRenderPlan::compile(&doc, 320, 180, 8.0, 30.0, None).unwrap();
            plan.load_timeline_elements(root.path(), &doc).unwrap();
            let pixels = plan.render_rgba(time).unwrap();
            let crop = |x: usize| {
                (50..130)
                    .flat_map(|y| {
                        pixels[(y * 320 + x) * 4..(y * 320 + x + 80) * 4]
                            .iter()
                            .copied()
                    })
                    .collect::<Vec<_>>()
            };
            assert!(
                crop(40).chunks_exact(4).any(|p| p[3] > 0),
                "{label}/{mode}: the first instance must be visible"
            );
            assert_eq!(
                crop(40) == crop(200),
                same,
                "{label}/{mode}: the two instances must follow their own source clock"
            );
        }
    }
}

/// 内置动态目录（81 款 Noto Lottie）每一款都要靠自己的帧动起来——不依赖元素级
/// `animate`——并且换色后仍然动。渲染走 `OverlayRenderPlan`，与导出同一条取帧路径。
#[test]
#[ignore = "读 v2 的贴纸库 apps/baocut/assets/stickers：元素素材未随本批带来，待元素素材批次"]
fn all_81_dynamic_sources_animate_their_own_pixels_without_element_animation() {
    use render_raster::drawop::{DrawOp, FrameBuilder};
    use render_raster::source::MediaTime;
    use render_raster::source::lottie::Lottie;
    let mut count = 0;
    let mut recoloured = 0;
    let mut entries: Vec<_> = std::fs::read_dir(anim_root())
        .unwrap()
        .flatten()
        .map(|entry| entry.path())
        .filter(|p| {
            p.extension().is_some_and(|e| e == "json")
                && p.file_name().is_none_or(|name| name != "provenance.json")
        })
        .collect();
    entries.sort();
    // 逐款走元素路径的正式入口 `Lottie::record`，比对指令流而不是整帧像素：
    // 指令流就是 `bcut render` / 导出实际重放的东西，且 81 款 × 5 采样点 × 2
    // 只要不到一秒。像素级的证明由上面的 ghost 用例承担。
    for p in entries {
        let bytes = std::fs::read(&p).unwrap();
        let mut lottie = Lottie::parse("test", "sticker", &bytes)
            .unwrap_or_else(|error| panic!("{}: {error:#}", p.display()));
        let total_ms = lottie
            .metadata()
            .frame_starts_ms
            .last()
            .copied()
            .unwrap_or(0);
        assert!(total_ms > 0, "{}", p.display());
        let distinct_frames = |lottie: &Lottie| {
            // 有些款从空画面淡入（首帧全透明），所以只要求「有过画笔」，
            // 不要求每一采样点都有。
            let mut frames = HashSet::new();
            let mut visible = false;
            for fraction in [0.0, 0.2, 0.45, 0.7, 0.9] {
                let mut builder = FrameBuilder::default();
                lottie
                    .record(
                        MediaTime::from_millis((total_ms as f64 * fraction) as i64),
                        tiny_skia::Transform::identity(),
                        &mut builder,
                    )
                    .unwrap();
                let frame = builder.finish();
                visible |= frame.ops.iter().any(|op| {
                    matches!(
                        op,
                        DrawOp::FillPath { .. }
                            | DrawOp::FillPathPaint { .. }
                            | DrawOp::StrokePathPaint { .. }
                    )
                });
                frames.insert(format!(
                    "{:?}|{:?}|{:?}",
                    frame.ops, frame.paths, frame.paints
                ));
            }
            assert!(visible, "{} never draws a pixel", p.display());
            frames.len()
        };
        assert!(
            distinct_frames(&lottie) >= 2,
            "{} has no intrinsic pixel motion",
            p.display()
        );
        // 换色（把每一种静态纯色填充都换成同一个绿）后仍然要动。全靠渐变或
        // 动画色的款没有可换的静态填充，跳过换色一步。
        let value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let mut colours = std::collections::BTreeMap::new();
        collect_fill_colours(&value, &mut colours);
        if !colours.is_empty() {
            let overrides: std::collections::BTreeMap<String, String> = colours
                .keys()
                .map(|hex| (hex.clone(), "#10FE72".to_string()))
                .collect();
            let touched = lottie.apply_fill_overrides(&overrides);
            assert!(touched > 0, "{} 的静态填充一个都没换到", p.display());
            assert!(
                distinct_frames(&lottie) >= 2,
                "{} stopped after recolor",
                p.display()
            );
            recoloured += 1;
        }
        count += 1;
    }
    assert_eq!(count, 81);
    assert!(recoloured >= 40, "只有 {recoloured} 款带静态纯色填充");
}

/// 收集 bodymovin 里所有 `ty:"fl"` 静态纯色填充的 `#RRGGBB`（0..1 方言）。
fn collect_fill_colours(
    value: &serde_json::Value,
    out: &mut std::collections::BTreeMap<String, ()>,
) {
    match value {
        serde_json::Value::Object(map) => {
            if map.get("ty").and_then(|v| v.as_str()) == Some("fl")
                && let Some(k) = map
                    .get("c")
                    .and_then(|c| c.get("k"))
                    .and_then(|k| k.as_array())
                && k.len() >= 3
                && let (Some(r), Some(g), Some(b)) = (k[0].as_f64(), k[1].as_f64(), k[2].as_f64())
            {
                let channel = |v: f64| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
                out.insert(
                    format!("#{:02X}{:02X}{:02X}", channel(r), channel(g), channel(b)),
                    (),
                );
            }
            for child in map.values() {
                collect_fill_colours(child, out);
            }
        }
        serde_json::Value::Array(items) => {
            for child in items {
                collect_fill_colours(child, out);
            }
        }
        _ => {}
    }
}
