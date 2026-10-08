//! 每种画面实例画出来的像素：摆放、裁剪、不透明度、`fx` 的顺序、遮罩与平铺、元素动画与关键帧，
//! 以及文字、图形和各个生成器。

mod common;

use common::*;
use serde_json::{Value, json};

fn matrix_bounds(m: [f64; 6]) -> (f64, f64, f64, f64) {
    let [a, b, c, d, e, f] = m;
    let xs = [e, e + a, e + c, e + a + c];
    let ys = [f, f + b, f + d, f + b + d];
    let min = |v: [f64; 4]| v.iter().copied().fold(f64::INFINITY, f64::min);
    let max = |v: [f64; 4]| v.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    (min(xs), min(ys), max(xs), max(ys))
}

#[test]
fn fullscreen_image_fills_the_canvas() {
    let video = video(
        vec![item(
            "img",
            0,
            30,
            json!({ "type": "image", "assetRef": { "id": "a_img", "revision": "rev_1" }, "place": {}, "mode": "fullscreen", "fit": "cover" }),
        )],
        vec![image_asset("a_img", 160, 90)],
        json!({}),
    );
    let mut media = Media::default().with("img", halves(160, 90, RED, BLUE));
    let frame = render(&video, 0.5, &mut media);
    near(px(&frame, 10, 45), RED, 2);
    near(px(&frame, 150, 45), BLUE, 2);
}

#[test]
fn cropped_pip_image_fills_the_planned_box() {
    // 上边裁掉 40%：留下 160×54，框高按留下的宽高比（格式规范 §3.5）。
    let video = video(
        vec![item(
            "img",
            0,
            30,
            json!({
                "type": "image", "assetRef": { "id": "a_img", "revision": "rev_1" },
                "place": { "x": 50, "y": 50, "w": 50 }, "mode": "pip", "fit": "cover",
                "crop": { "left": 0, "top": 0.4, "right": 0, "bottom": 0 }
            }),
        )],
        vec![image_asset("a_img", 160, 90)],
        json!({}),
    );
    let plan = plan(&video, 0.5);
    let (x0, y0, x1, y1) = matrix_bounds(plan.layers[0].matrix);
    assert!(
        (x1 - x0 - 80.0).abs() < 1e-6 && (y1 - y0 - 27.0).abs() < 1e-6,
        "{x0} {y0} {x1} {y1}"
    );
    let mut media = Media::default().with("img", solid(160, 90, GREEN));
    let frame = render(&video, 0.5, &mut media);
    let (bx0, by0, bx1, by1) = painted_bounds(&frame).unwrap();
    assert!(
        (f64::from(bx0) - x0).abs() <= 1.0 && (f64::from(bx1 + 1) - x1).abs() <= 1.0,
        "{bx0}..{bx1} vs {x0}..{x1}"
    );
    assert!(
        (f64::from(by0) - y0).abs() <= 1.0 && (f64::from(by1 + 1) - y1).abs() <= 1.0,
        "{by0}..{by1} vs {y0}..{y1}"
    );
}

#[test]
fn text_is_drawn_with_its_opacity() {
    let video = video(
        vec![item(
            "title",
            0,
            30,
            json!({
                "type": "text", "text": "HHHH", "style": { "fontSize": 60, "color": "#FFFFFF" },
                "place": { "x": 50, "y": 50, "w": 90, "opacity": 0.5 }
            }),
        )],
        vec![],
        json!({}),
    );
    let frame = render(&video, 0.5, &mut Media::default());
    assert!(painted(&frame) > 100, "文字要画出来");
    let brightest = frame.chunks_exact(4).map(|p| p[0]).max().unwrap();
    assert!((120..=136).contains(&brightest), "半透明的白字最亮 ≈ 128，实际 {brightest}");
}

/// 画中画红图（16×9）摆在画布中间、宽 50%：框 80×45，左上角 (40, 22.5)。
fn red_pip(body: serde_json::Value) -> video_model::VideoSnapshot {
    let mut value = image("a", 0, 0, 90, json!({ "place": { "w": 50 } }));
    if let (Some(item), serde_json::Value::Object(extra)) = (value.as_object_mut(), body) {
        item.extend(extra);
    }
    video(vec![value], vec![image_asset("a_a", 16, 9)], json!({}))
}

fn red_media() -> Media {
    Media::default().with("a", solid(16, 9, RED))
}

#[test]
fn video_items_draw_the_picture_at_the_planned_source_time() {
    let video = video(
        vec![video_item(
            "v",
            "a_v",
            0,
            60,
            json!({ "timeMap": {
                "kind": "linear", "sourceIn": { "ticks": "2", "timescale": 1 }, "rate": { "num": 1, "den": 1 }
            } }),
        )],
        vec![video_asset("a_v", W, H)],
        json!({}),
    );
    let plan = plan(&video, 0.5);
    assert!((plan.layers[0].source_seconds.unwrap() - 2.5).abs() < 1e-9);
    let frame = render(&video, 0.5, &mut Media::default().with("v", solid(W, H, GREEN)));
    near(px(&frame, 80, 45), GREEN, 2);
    near(px(&frame, 2, 2), GREEN, 2);
}

#[test]
fn shapes_fill_stroke_and_round_their_corners() {
    let shape = |props: serde_json::Value| {
        video(
            vec![item("s", 0, 30, json!({ "type": "shape", "shape": props, "place": { "w": 50 } }))],
            vec![],
            json!({}),
        )
    };
    let filled = shape(json!({ "shape": "rect", "fill": "#FF0000" }));
    let (x0, y0, x1, y1) = matrix_bounds(plan(&filled, 0.0).layers[0].matrix);
    let (cx, cy) = (((x0 + x1) / 2.0) as u32, ((y0 + y1) / 2.0) as u32);
    let frame = render(&filled, 0.0, &mut Media::default());
    near(px(&frame, cx, cy), RED, 2);
    near(px(&frame, x0 as u32 + 1, y0 as u32 + 1), RED, 2);
    near(px(&frame, x0 as u32 - 3, cy), BLACK, 0);
    // 只描边：边上是白的，中间不填。
    let frame = render(
        &shape(json!({ "shape": "rect", "stroke": "#FFFFFF", "strokeWidth": 30 })),
        0.0,
        &mut Media::default(),
    );
    assert!(px(&frame, x0 as u32 + 1, cy)[0] > 200);
    near(px(&frame, cx, cy), BLACK, 0);
    // 圆角：角上空出来，边的中段照样填。
    let frame = render(
        &shape(json!({ "shape": "rect", "fill": "#FF0000", "cornerRadius": [150, 150, 150, 150] })),
        0.0,
        &mut Media::default(),
    );
    near(px(&frame, x0 as u32 + 1, y0 as u32 + 1), BLACK, 8);
    near(px(&frame, cx, y0 as u32 + 1), RED, 2);
    // 椭圆：框角空、中心满。
    let frame = render(&shape(json!({ "shape": "ellipse", "fill": "#0000FF" })), 0.0, &mut Media::default());
    near(px(&frame, cx, cy), BLUE, 2);
    near(px(&frame, x0 as u32 + 1, y0 as u32 + 1), BLACK, 8);
}

#[test]
fn colour_fx_run_in_the_fixed_order_before_opacity() {
    // 去饱和：灰。
    let frame = render(&red_pip(json!({ "fx": { "saturation": -1 } })), 0.5, &mut red_media());
    let [r, g, b, _] = px(&frame, 80, 45);
    assert!(r.abs_diff(g) <= 3 && g.abs_diff(b) <= 3 && r > 20, "{r} {g} {b}");
    // 先去饱和（第 6 步）再加暖（第 8 步）：灰被染暖，红 > 绿 > 蓝；反过来的顺序会是纯灰。
    let frame = render(
        &red_pip(json!({ "fx": { "saturation": -1, "temperature": 1 } })),
        0.5,
        &mut red_media(),
    );
    let [r, g, b, _] = px(&frame, 80, 45);
    assert!(r > g && g > b, "{r} {g} {b}");
    // 变暗之后再乘不透明度。
    let dim = px(
        &render(&red_pip(json!({ "fx": { "brightness": -0.5 } })), 0.5, &mut red_media()),
        80,
        45,
    )[0];
    let dim_half = px(
        &render(
            &red_pip(json!({ "fx": { "brightness": -0.5 }, "place": { "w": 50, "opacity": 0.5 } })),
            0.5,
            &mut red_media(),
        ),
        80,
        45,
    )[0];
    assert!(dim < 230 && dim > 20, "{dim}");
    assert!((i32::from(dim_half) - i32::from(dim) / 2).abs() <= 3, "{dim_half} vs {dim}");
}

#[test]
fn blur_softens_the_source_edges() {
    let video = video(
        vec![image("a", 0, 0, 30, json!({ "mode": "fullscreen", "fx": { "blur": 40 } }))],
        vec![image_asset("a_a", W, H)],
        json!({}),
    );
    let frame = render(&video, 0.0, &mut Media::default().with("a", halves(W, H, RED, BLUE)));
    let mid = px(&frame, 80, 45);
    assert!(mid[0] > 40 && mid[2] > 40, "{mid:?}");
    let far = px(&frame, 10, 45);
    assert!(far[0] > 200 && far[2] < 60, "{far:?}");
}

#[test]
fn stroke_and_shadow_sit_around_and_under_the_layer() {
    // 描边：框外紧贴一圈绿色，框里仍是红的。
    let frame = render(
        &red_pip(json!({ "fx": { "stroke": { "width": 20, "color": "#00FF00" } } })),
        0.5,
        &mut red_media(),
    );
    near(px(&frame, 80, 45), RED, 2);
    let ring = px(&frame, 38, 45);
    assert!(ring[1] > 150 && ring[0] < 100, "{ring:?}");
    near(px(&frame, 5, 5), BLACK, 0);
    // 投影：右下方错开的白影，盖在层下面。
    let frame = render(
        &red_pip(json!({ "fx": { "shadow": { "offsetX": 60, "offsetY": 60, "blur": 0, "color": "#FFFFFF", "opacity": 1 } } })),
        0.5,
        &mut red_media(),
    );
    near(px(&frame, 80, 45), RED, 2);
    let shadow = px(&frame, 125, 72);
    assert!(shadow[0] > 200 && shadow[1] > 200, "{shadow:?}");
    near(px(&frame, 35, 18), BLACK, 0);
}

#[test]
fn stroke_and_shadow_offsets_follow_the_canvas_not_the_rotation() {
    // 转 30 度的红框，投影 offsetX 60（540 短边）= 画布上正右方 10 像素、不模糊：没被层盖住的地方，
    // 投影的亮度正好是左边 10 像素处层的覆盖度。偏移若跟着实例转，会落在 (8.66, 5) 上，对不上。
    let rotated = |fx: Value| red_pip(json!({ "place": { "w": 50, "rot": 30 }, "fx": fx }));
    let plain = render(&rotated(json!({})), 0.5, &mut red_media());
    let shadowed = render(
        &rotated(json!({ "shadow": { "offsetX": 60, "offsetY": 0, "blur": 0, "color": "#FFFFFF", "opacity": 1 } })),
        0.5,
        &mut red_media(),
    );
    let mut solid_shadow = 0;
    for y in 0..H {
        for x in 10..W {
            if px(&plain, x, y)[0] != 0 {
                continue;
            }
            let coverage = px(&plain, x - 10, y)[0];
            let [r, g, b, _] = px(&shadowed, x, y);
            for channel in [r, g, b] {
                assert!(
                    (i32::from(channel) - i32::from(coverage)).abs() <= 2,
                    "({x}, {y}) 处 {channel} ≠ 覆盖度 {coverage}"
                );
            }
            solid_shadow += usize::from(coverage == 255);
        }
    }
    assert!(solid_shadow > 100, "只露出投影的像素太少：{solid_shadow}");
    // 描边沿转过之后的轮廓：转 90 度的框左边在 x = 57.5，紧贴它的是绿色；没转时的左边（x = 38）是黑的。
    let frame = render(
        &red_pip(json!({ "place": { "w": 50, "rot": 90 }, "fx": { "stroke": { "width": 20, "color": "#00FF00" } } })),
        0.5,
        &mut red_media(),
    );
    let ring = px(&frame, 55, 45);
    assert!(ring[1] > 150 && ring[0] < 100, "{ring:?}");
    near(px(&frame, 38, 45), BLACK, 0);
    near(px(&frame, 80, 45), RED, 2);
}

#[test]
fn ellipse_masks_cut_the_box_corners() {
    let frame = render(&red_pip(json!({ "mask": { "shape": "ellipse" } })), 0.5, &mut red_media());
    near(px(&frame, 80, 45), RED, 2);
    near(px(&frame, 41, 24), BLACK, 8);
}

#[test]
fn tiled_media_repeat_across_the_canvas() {
    // 平铺是斜向错行的网格（印章之间留缝），所以不看某一个像素，看四个象限各自有没有红：
    // 不平铺时 20% 宽的框只在画布中间，四个角落的象限都碰不到。
    let quadrants = |frame: &[u8]| {
        let mut red = [0usize; 4];
        for y in 0..90usize {
            for x in 0..160usize {
                let at = (y * 160 + x) * 4;
                if frame[at] > 200 && frame[at + 1] < 60 && (x < 40 || x >= 120 || y < 20 || y >= 70) {
                    red[usize::from(x >= 80) + 2 * usize::from(y >= 45)] += 1;
                }
            }
        }
        red
    };
    let single = render(&red_pip(json!({ "place": { "w": 20 } })), 0.5, &mut red_media());
    assert_eq!(quadrants(&single), [0; 4]);
    let tiled = render(
        &red_pip(json!({ "place": { "w": 20 }, "tile": { "on": true } })),
        0.5,
        &mut red_media(),
    );
    let red = quadrants(&tiled);
    assert!(red.iter().all(|&n| n > 100), "{red:?}");
}

#[test]
fn enter_exit_and_loop_slots_animate_the_layer() {
    let still = render(&red_pip(json!({})), 0.1, &mut red_media());
    let fading = render(
        &red_pip(json!({ "animate": { "enter": { "preset": "fade", "dur": 1.0 } } })),
        0.1,
        &mut red_media(),
    );
    assert!(px(&fading, 80, 45)[0] < px(&still, 80, 45)[0] - 30, "入场淡入还没完成");
    let settled = render(
        &red_pip(json!({ "animate": { "enter": { "preset": "fade", "dur": 1.0 } } })),
        1.5,
        &mut red_media(),
    );
    near(px(&settled, 80, 45), RED, 2);
    let leaving = render(
        &red_pip(json!({ "animate": { "exit": { "preset": "fade", "dur": 1.0 } } })),
        2.9,
        &mut red_media(),
    );
    assert!(px(&leaving, 80, 45)[0] < 200, "出场淡出");
    let looping = red_pip(json!({ "animate": { "loop": { "preset": "rotate" } } }));
    assert_ne!(
        render(&looping, 0.2, &mut red_media()),
        render(&looping, 0.7, &mut red_media()),
        "循环动画让不同时刻的画面不同"
    );
}

#[test]
fn keyframe_bindings_drive_place_fields() {
    let bound = |property: &str, from: f64, to: f64| {
        let mut video = red_pip(json!({}));
        let binding: video_model::AnimationBinding = serde_json::from_value(json!({
            "id": "kf", "targetId": "a", "propertyPath": property,
            "keyframes": [{ "localFrame": 0, "value": from }, { "localFrame": 60, "value": to }]
        }))
        .unwrap();
        video.sequences.get_mut("seq").unwrap().header.animation_bindings.push(binding);
        video
    };
    // 不透明度 0 → 1：第 30 帧大约一半。
    let frame = render(&bound("opacity", 0.0, 1.0), 1.0, &mut red_media());
    let r = px(&frame, 80, 45)[0];
    assert!((100..=160).contains(&r), "{r}");
    // x 从 25% 移到 75%：开头框在左边，末尾在右边。
    let start = render(&bound("x", 25.0, 75.0), 0.0, &mut red_media());
    let end = render(&bound("x", 25.0, 75.0), 2.0, &mut red_media());
    near(px(&start, 40, 45), RED, 2);
    near(px(&start, 120, 45), BLACK, 0);
    near(px(&end, 120, 45), RED, 2);
}

#[test]
fn text_styles_reach_the_pixels() {
    let video = video(
        vec![item(
            "title",
            0,
            30,
            json!({
                "type": "text", "text": "HHHH",
                "style": { "fontSize": 60, "fontColor": "#FF0000", "background": true, "backgroundColor": "#0000FF" },
                "place": { "x": 50, "y": 50, "w": 90 }
            }),
        )],
        vec![],
        json!({}),
    );
    let frame = render(&video, 0.5, &mut Media::default());
    let reds = frame.chunks_exact(4).filter(|p| p[0] > 200 && p[1] < 60 && p[2] < 60).count();
    let blues = frame.chunks_exact(4).filter(|p| p[2] > 200 && p[0] < 60).count();
    assert!(reds > 20, "红字 {reds}");
    assert!(blues > 20, "蓝底板 {blues}");
}

/// 一个生成类实例（`body` 是种类与字段），在 `seconds` 画出来。
fn generated(body: serde_json::Value, seconds: f64) -> (Vec<u8>, frame_render::FrameRenderer) {
    let mut value = item("g", 0, 90, json!({ "place": { "w": 60 } }));
    if let (Some(item), serde_json::Value::Object(extra)) = (value.as_object_mut(), body) {
        item.extend(extra);
    }
    let video = video(vec![value], vec![], json!({}));
    let mut renderer = renderer(false, frame_render::Documents::default());
    let frame = render_with(&mut renderer, &video, seconds, &mut Media::default());
    (frame, renderer)
}

#[test]
fn counters_count() {
    let body = json!({ "type": "text", "counter": { "mode": "countdown" }, "style": { "fontSize": 80 } });
    let (early, _) = generated(body.clone(), 0.2);
    let (late, _) = generated(body, 2.2);
    assert!(painted(&early) > 20 && painted(&late) > 20);
    assert_ne!(early, late, "3 → 1");
}

#[test]
fn progress_bars_fill_over_the_span() {
    let body = json!({ "type": "progress", "progress": { "style": "normal", "mainColor": "#FFFFFF" }, "place": { "y": 90, "w": 80 } });
    let (early, _) = generated(body.clone(), 0.3);
    let (late, _) = generated(body, 2.7);
    let white = |f: &[u8]| f.chunks_exact(4).filter(|p| p[0] > 200 && p[1] > 200 && p[2] > 200).count();
    assert!(white(&late) > white(&early) + 50, "{} → {}", white(&early), white(&late));
}

#[test]
fn visualizers_without_any_audio_draw_at_rest() {
    // 序列里没有声音：听到的是静音，按静止的样子画（每款静音时都画得出东西），不报提示。
    // 缺素材频谱时的占位与提示见 `tests/spectrum.rs`。
    let (frame, renderer) = generated(
        json!({ "type": "visualizer", "visualizer": { "style": "bars", "mainColor": "#FFFFFF" } }),
        0.5,
    );
    assert!(painted(&frame) > 0, "静音时按静止的样子画");
    assert!(renderer.warnings().is_empty(), "{:?}", renderer.warnings());
    assert!(renderer.missing_spectra().is_empty());
}

#[test]
fn visualizers_follow_the_injected_spectrum_and_its_db_window() {
    let video = |max_db: f64| {
        video(
            vec![item(
                "g",
                0,
                90,
                json!({ "type": "visualizer", "place": { "w": 60 },
                        "visualizer": { "style": "bars", "mainColor": "#FFFFFF", "minDb": -80, "maxDb": max_db } }),
            )],
            vec![],
            json!({}),
        )
    };
    let mut media = Media::default();
    let (silent, _) = generated(
        json!({ "type": "visualizer", "visualizer": { "style": "bars", "mainColor": "#FFFFFF" } }),
        0.5,
    );
    // 低频响、高频静：频谱送进去之后不再是静态的样子，也不再报提示。
    media
        .spectra
        .insert("g".into(), spectrum(30, |bin| if bin < 128 { 220 } else { 40 }));
    let mut renderer = renderer(false, frame_render::Documents::default());
    let loud = render_with(&mut renderer, &video(40.0), 0.5, &mut media);
    assert!(renderer.warnings().is_empty(), "{:?}", renderer.warnings());
    assert_ne!(loud, silent);
    // dB 窗变了，按新的窗重新推（缓存键带着参数）：同一份频谱在更宽的窗里更矮。
    renderer.clear_reports();
    let wide = render_with(&mut renderer, &video(140.0), 0.5, &mut media);
    assert!(painted(&wide) < painted(&loud), "{} {}", painted(&wide), painted(&loud));
    // 宿主换了频谱：清掉缓存之后跟着换。
    media.spectra.insert("g".into(), spectrum(30, |_| 0));
    renderer.clear_spectra();
    let quiet = render_with(&mut renderer, &video(140.0), 0.5, &mut media);
    assert!(painted(&quiet) < painted(&wide));
}

#[test]
fn confetti_falls() {
    let body = json!({ "type": "confetti", "confetti": { "style": "pastel-fall", "seed": 7 }, "place": { "w": 100 } });
    let (a, _) = generated(body.clone(), 0.5);
    let (b, _) = generated(body, 1.0);
    assert!(painted(&a) > 0 && painted(&b) > 0);
    assert_ne!(a, b);
}

#[test]
fn draw_items_paint_their_strokes() {
    // 笔画的点是画布百分比（0..=100）。
    let body = json!({ "type": "draw", "draw": {
        "brush": "round", "color": "#FFFFFF", "size": 8,
        "strokes": [{ "points": [[10, 50], [50, 20], [90, 50]] }]
    } });
    let (frame, _) = generated(body, 2.9);
    assert!(painted(&frame) > 30, "{}", painted(&frame));
}

#[test]
fn empty_placeholders_draw_their_slot() {
    let (frame, _) = generated(json!({ "type": "placeholder", "placeholder": { "variant": "camera" } }), 0.5);
    assert!(painted(&frame) > 30);
}

#[test]
fn filled_placeholders_draw_the_media() {
    let video = video(
        vec![item(
            "slot",
            0,
            30,
            json!({ "type": "placeholder", "placeholder": { "variant": "media" }, "place": { "w": 50 },
                    "assetRef": { "id": "a_img", "revision": "rev_1" } }),
        )],
        vec![image_asset("a_img", 16, 9)],
        json!({}),
    );
    let frame = render(&video, 0.5, &mut Media::default().with("slot", solid(16, 9, GREEN)));
    near(px(&frame, 80, 45), GREEN, 2);
}

#[test]
fn template_stickers_draw_their_vector() {
    let (frame, renderer) = generated(
        json!({ "type": "sticker", "sticker": { "source": "template", "templateId": "heart" } }),
        0.5,
    );
    assert!(painted(&frame) > 30, "{:?}", renderer.warnings());
}

#[test]
fn catalogue_entries_missing_from_the_core_are_refused() {
    // 内核只能跳过的目录项（不发布第三方素材）：整层报出来，不画成空白。
    for (body, id) in [
        (
            json!({ "type": "sticker", "sticker": { "source": "template", "templateId": "vendor-star" } }),
            "vendor-star",
        ),
        (json!({ "type": "progress", "progress": { "style": "vendor-bar" } }), "vendor-bar"),
        (
            json!({ "type": "visualizer", "visualizer": { "style": "vendor-wave" } }),
            "vendor-wave",
        ),
        (json!({ "type": "confetti", "confetti": { "style": "vendor-rain" } }), "vendor-rain"),
        (json!({ "type": "shape", "shape": { "shape": "vendor-blob" } }), "vendor-blob"),
    ] {
        let mut value = item("g", 0, 90, json!({ "place": { "w": 60 } }));
        if let (Some(item), serde_json::Value::Object(extra)) = (value.as_object_mut(), body) {
            item.extend(extra);
        }
        let video = video(vec![value], vec![], json!({}));
        let error = try_render(
            &mut renderer(false, frame_render::Documents::default()),
            &video,
            0.5,
            &mut Media::default(),
        )
        .unwrap_err();
        assert_eq!(
            (error.items[0].scope, error.items[0].reason.as_str(), error.items[0].kind.as_deref()),
            ("layer", "preset-unknown", Some(id))
        );
    }
    // 贴纸可以不写模板：同样画不出来，报「没有指定」。
    let video = video(
        vec![item(
            "g",
            0,
            90,
            json!({ "type": "sticker", "sticker": { "source": "template" }, "place": { "w": 60 } }),
        )],
        vec![],
        json!({}),
    );
    let error = try_render(
        &mut renderer(false, frame_render::Documents::default()),
        &video,
        0.5,
        &mut Media::default(),
    )
    .unwrap_err();
    assert_eq!(
        (error.items[0].reason.as_str(), error.items[0].kind.as_deref()),
        ("preset-missing", None)
    );
}

#[test]
fn image_stickers_draw_the_picture() {
    let video = video(
        vec![item(
            "st",
            0,
            30,
            json!({ "type": "sticker", "sticker": { "source": "asset" }, "place": { "w": 30 },
                    "assetRef": { "id": "a_img", "revision": "rev_1" } }),
        )],
        vec![image_asset("a_img", 10, 10)],
        json!({}),
    );
    let frame = render(&video, 0.5, &mut Media::default().with("st", solid(10, 10, BLUE)));
    near(px(&frame, 80, 45), BLUE, 2);
}

const LOTTIE: &[u8] = include_bytes!("../../render-raster/tests/fixtures/lottie/cases/shapes.json");

fn lottie_video() -> video_model::VideoSnapshot {
    video(
        vec![item(
            "lt",
            0,
            60,
            json!({ "type": "sticker", "sticker": { "source": "asset" }, "place": { "w": 60 },
                    "assetRef": { "id": "a_lottie", "revision": "rev_1" } }),
        )],
        vec![lottie_asset("a_lottie")],
        json!({}),
    )
}

#[test]
fn lottie_stickers_play_their_animation() {
    let mut media = Media::default();
    media.assets.insert("a_lottie".into(), LOTTIE.to_vec());
    let a = render(&lottie_video(), 0.1, &mut media);
    let b = render(&lottie_video(), 0.6, &mut media);
    assert!(painted(&a) > 30);
    assert_ne!(a, b);
}

const LOTTIE_IMAGE: &[u8] = include_bytes!("../../render-raster/tests/fixtures/lottie/cases/image-embedded.json");

fn lottie_with(fill_overrides: Value) -> video_model::VideoSnapshot {
    video(
        vec![item(
            "lt",
            0,
            60,
            json!({ "type": "sticker", "sticker": { "source": "asset", "fillOverrides": fill_overrides }, "place": { "w": 60 },
                    "assetRef": { "id": "a_lottie", "revision": "rev_1" } }),
        )],
        vec![lottie_asset("a_lottie")],
        json!({}),
    )
}

fn magenta(frame: &[u8]) -> usize {
    frame.chunks_exact(4).filter(|p| p[0] > 200 && p[1] < 60 && p[2] > 200).count()
}

#[test]
fn lottie_fill_overrides_recolour_flat_fills() {
    let mut media = Media::default();
    media.assets.insert("a_lottie".into(), LOTTIE.to_vec());
    let plain = render(&lottie_video(), 0.3, &mut media);
    assert_eq!(magenta(&plain), 0);
    // 夹具里橙色（#FF4000）的纯色填充换成品红；同一份素材不换色的实例照旧（变体按换色表另存）。
    let mut renderer = renderer(false, frame_render::Documents::default());
    let recoloured = render_with(&mut renderer, &lottie_with(json!({ "#FF4000": "#FF00FF" })), 0.3, &mut media);
    assert!(magenta(&recoloured) > 20, "换色之后要有品红，实际 {}", magenta(&recoloured));
    assert_eq!(render_with(&mut renderer, &lottie_with(json!({})), 0.3, &mut media), plain);
}

#[test]
fn lottie_embedded_images_are_drawn_and_external_ones_are_missing() {
    let mut media = Media::default();
    media.assets.insert("a_lottie".into(), LOTTIE_IMAGE.to_vec());
    let a = render(&lottie_video(), 0.1, &mut media);
    let b = render(&lottie_video(), 0.8, &mut media);
    assert!(painted(&a) > 30, "内嵌的位图要画出来");
    assert_ne!(a, b, "位图图层跟着关键帧动");
    // 只写了路径的图片：素材只是一份 JSON，读不到。
    let mut external: Value = serde_json::from_slice(LOTTIE_IMAGE).unwrap();
    external["assets"][0]["e"] = json!(0);
    external["assets"][0]["u"] = json!("images/");
    external["assets"][0]["p"] = json!("img_0.png");
    media.assets.insert("a_lottie".into(), serde_json::to_vec(&external).unwrap());
    let error = try_render(
        &mut renderer(false, frame_render::Documents::default()),
        &lottie_video(),
        0.1,
        &mut media,
    )
    .unwrap_err();
    assert_eq!(
        (error.items[0].scope, error.items[0].reason.as_str()),
        ("asset", "lottie-asset-missing")
    );
    assert_eq!(
        frame_render::lottie_problem(&serde_json::to_vec(&external).unwrap()).unwrap().0,
        "lottie-asset-missing"
    );
    assert!(frame_render::lottie_problem(LOTTIE_IMAGE).is_none());
}

/// `.lottie` 压缩包：取清单里的动画，图片从包里找；内嵌的 SVG 按声明的宽高光栅。贴纸宽 75%（120 px），
/// 120×90 的合成正好一比一落在输出的 x 20–140 上。
#[test]
fn dotlottie_archives_draw_with_images_from_the_archive_and_svg_images() {
    let video = video(
        vec![item(
            "lt",
            0,
            60,
            json!({ "type": "sticker", "sticker": { "source": "asset" }, "place": { "w": 75 },
                    "assetRef": { "id": "a_lottie", "revision": "rev_1" } }),
        )],
        vec![dotlottie_asset("a_lottie")],
        json!({}),
    );
    let mut media = Media::default();
    media.assets.insert("a_lottie".into(), dotlottie_fixture());
    let start = render(&video, 0.0, &mut media);
    let reds = |frame: &[u8]| {
        let ys: Vec<u32> = (0..H)
            .filter(|&y| (0..W).any(|x| px(frame, x, y)[0] > 200 && px(frame, x, y)[1] < 60))
            .collect();
        (ys.first().copied(), ys.last().copied())
    };
    let greens = |frame: &[u8]| {
        let xs: Vec<u32> = (0..H)
            .flat_map(|y| (0..W).map(move |x| (x, y)))
            .filter(|&(x, y)| {
                let p = px(frame, x, y);
                p[1] > 150 && p[0] < 60 && p[2] < 140
            })
            .map(|(x, _)| x)
            .collect();
        (xs.len(), xs.iter().min().copied(), xs.iter().max().copied())
    };
    let (top, bottom) = reds(&start);
    assert!(top.is_some_and(|y| y.abs_diff(10) <= 1), "包里的 PNG 画在 (10,10) 起：{top:?}");
    assert!(bottom.is_some_and(|y| y.abs_diff(41) <= 1), "放大 4 倍（32 像素）：{bottom:?}");
    // 6×6 的绿圆声明成 24×24，画在合成的 (80,30) 起：输出上 x 100–124，面积约 π·12² ≈ 452。
    let (area, left, right) = greens(&start);
    assert!((380..520).contains(&area), "SVG 按声明的 24×24 光栅：{area}");
    assert!(
        left.is_some_and(|x| x.abs_diff(100) <= 1) && right.is_some_and(|x| x.abs_diff(123) <= 1),
        "{left:?}–{right:?}"
    );
    let later = render(&video, 0.5, &mut media);
    assert!(reds(&later).0.unwrap() > top.unwrap() + 10, "PNG 跟着关键帧往下移");

    // 包里缺图：照旧是 `lottie-asset-missing`。
    let broken = stored_zip(&[(
        "animations/main.json",
        br#"{"v":"5","fr":30,"ip":0,"op":30,"w":8,"h":8,"assets":[{"id":"x","w":1,"h":1,"u":"images/","p":"x.png"}],"layers":[]}"#,
    )]);
    media.assets.insert("a_lottie".into(), broken.clone());
    let error = try_render(&mut renderer(false, frame_render::Documents::default()), &video, 0.1, &mut media).unwrap_err();
    assert_eq!(error.items[0].reason, "lottie-asset-missing");
    assert_eq!(frame_render::lottie_problem(&broken).unwrap().0, "lottie-asset-missing");
    assert!(frame_render::lottie_problem(&dotlottie_fixture()).is_none());
}

#[test]
fn unreadable_lottie_is_refused_or_skipped() {
    let mut media = Media::default();
    media.assets.insert("a_lottie".into(), b"{}".to_vec());
    let error = try_render(
        &mut renderer(false, frame_render::Documents::default()),
        &lottie_video(),
        0.1,
        &mut media,
    )
    .unwrap_err();
    assert_eq!(
        (error.items[0].scope, error.items[0].reason.as_str()),
        ("asset", "lottie-unreadable")
    );
    let mut missing = Media::default();
    let error = try_render(
        &mut renderer(false, frame_render::Documents::default()),
        &lottie_video(),
        0.1,
        &mut missing,
    )
    .unwrap_err();
    assert_eq!(error.items[0].reason, "lottie-asset-missing");
    let mut skipping = renderer(true, frame_render::Documents::default());
    assert_eq!(painted(&render_with(&mut skipping, &lottie_video(), 0.1, &mut media)), 0);
    assert_eq!(skipping.skipped()[0].reason, "lottie-unreadable");
}

#[test]
fn whiteboards_reveal_their_image() {
    let video = video(
        vec![item(
            "wb",
            0,
            90,
            json!({ "type": "whiteboard", "whiteboard": {}, "place": { "w": 60 },
                    "assetRef": { "id": "a_img", "revision": "rev_1" } }),
        )],
        vec![image_asset("a_img", 32, 18)],
        json!({}),
    );
    let mut picture = solid(32, 18, WHITE);
    for x in 4..28 {
        for y in 8..10 {
            let i = ((y * 32 + x) * 4) as usize;
            picture.data_mut()[i..i + 3].copy_from_slice(&[0, 0, 0]);
        }
    }
    let early = render(&video, 0.1, &mut Media::default().with("wb", picture.clone()));
    let late = render(&video, 2.9, &mut Media::default().with("wb", picture));
    assert!(painted(&late) > 30);
    assert_ne!(early, late, "白板按顺序画出来");
}

#[test]
fn prerendered_compositions_draw_their_stand_in() {
    let video = video(
        vec![item(
            "comp",
            0,
            30,
            json!({
                "type": "composition", "source": { "kind": "bundle", "assetRef": { "id": "a_bundle", "revision": "rev_1" } },
                "prerender": { "id": "a_v", "revision": "rev_1" }, "parameterValues": {},
                "timeMap": { "kind": "linear", "sourceIn": { "ticks": "0", "timescale": 1 }, "rate": { "num": 1, "den": 1 } },
                "place": {}
            }),
        )],
        vec![video_asset("a_v", W, H)],
        json!({}),
    );
    let frame = render(&video, 0.5, &mut Media::default().with("comp", solid(W, H, GREEN)));
    near(px(&frame, 80, 45), GREEN, 2);
}

#[test]
fn prerendered_compositions_have_no_backdrop_so_transparent_pixels_show_the_layer_below() {
    // 下层一段全屏视频（绿），上层一个铺满的合成：替身左半透明、右半红。合成没有 `bg`，
    // 全屏 + contain 不预填黑底，透明的左半露出下层的绿。
    let video = video(
        vec![
            video_item("clip", "a_clip", 0, 30, json!({})),
            item(
                "comp",
                1,
                30,
                json!({
                    "type": "composition", "source": { "kind": "bundle", "assetRef": { "id": "a_bundle", "revision": "rev_1" } },
                    "prerender": { "id": "a_v", "revision": "rev_1" }, "parameterValues": {},
                    "timeMap": { "kind": "linear", "sourceIn": { "ticks": "0", "timescale": 1 }, "rate": { "num": 1, "den": 1 } },
                    "place": {}
                }),
            ),
        ],
        vec![video_asset("a_clip", W, H), video_asset("a_v", W, H)],
        json!({}),
    );
    let mut media = Media::default()
        .with("clip", solid(W, H, GREEN))
        .with("comp", halves(W, H, [0, 0, 0, 0], RED));
    let frame = render(&video, 0.5, &mut media);
    near(px(&frame, 40, 45), GREEN, 2);
    near(px(&frame, 120, 45), RED, 2);
}

#[test]
fn template_layers_draw_from_the_sequence_template() {
    let video = video(
        vec![],
        vec![],
        json!({
            "durationPolicy": { "kind": "fixed", "frames": 90 },
            "template": { "id": "tpl", "name": "条", "layers": [
                { "id": "bar", "box": { "x": 0, "y": 90, "w": 100, "h": 10 }, "kind": "progress", "accent": "#FF0000", "track": "#0000FF" },
                { "id": "logo", "box": { "x": 2, "y": 4, "w": 20, "h": 12 }, "kind": "logo", "src": "text", "text": "T", "color": "#FFFFFF", "bg": "#00FF00" }
            ] }
        }),
    );
    let frame = render(&video, 1.5, &mut Media::default());
    // 进度条在底部：左边走过的是强调色，右边还没走到的是底色。
    let left = px(&frame, 20, 86);
    let right = px(&frame, 140, 86);
    assert!(left[0] > 150 && left[2] < 100, "{left:?}");
    assert!(right[2] > 150 && right[0] < 100, "{right:?}");
    // 文字台标的底色。
    let logo = px(&frame, 6, 6);
    assert!(logo[1] > 150, "{logo:?}");
}

#[test]
fn image_logos_in_templates_are_refused() {
    let video = video(
        vec![],
        vec![],
        json!({
            "durationPolicy": { "kind": "fixed", "frames": 90 },
            "template": { "id": "tpl", "name": "条", "layers": [
                { "id": "logo", "box": { "x": 2, "y": 4, "w": 20, "h": 12 }, "kind": "logo", "src": { "file": "logo.png" }, "color": "#FFFFFF" }
            ] }
        }),
    );
    let error = try_render(
        &mut renderer(false, frame_render::Documents::default()),
        &video,
        0.5,
        &mut Media::default(),
    )
    .unwrap_err();
    assert_eq!(error.items[0].reason, "template-logo-image-not-supported");
}

/// 纯色填充的 SVG：上半红、下半蓝。
const FLAT_SVG: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="5" fill="#FF0000"/><rect y="5" width="10" height="5" fill="#0000ff"/></svg>"##;

fn svg_sticker(fill_overrides: Value) -> video_model::VideoSnapshot {
    video(
        vec![item(
            "st",
            0,
            30,
            json!({ "type": "sticker", "sticker": { "source": "asset", "fillOverrides": fill_overrides }, "place": { "w": 30 },
                    "assetRef": { "id": "a_svg", "revision": "rev_1" } }),
        )],
        vec![svg_asset("a_svg", 10, 10)],
        json!({}),
    )
}

#[test]
fn svg_stickers_are_rasterised_from_their_bytes_and_recoloured() {
    let mut media = Media::default();
    media.assets.insert("a_svg".into(), FLAT_SVG.as_bytes().to_vec());
    // 30% 宽的方框在画面中间：48×48 px，上半红、下半蓝。
    let plain = render(&svg_sticker(json!({})), 0.5, &mut media);
    near(px(&plain, 80, 35), RED, 2);
    near(px(&plain, 80, 55), BLUE, 2);
    // `fillOverrides` 的键是源颜色（大小写按同一份规范化），只换命中的那一组。
    let mut renderer = renderer(false, frame_render::Documents::default());
    let recoloured = render_with(&mut renderer, &svg_sticker(json!({ "#ff0000": "#00FF00" })), 0.5, &mut media);
    near(px(&recoloured, 80, 35), GREEN, 2);
    near(px(&recoloured, 80, 55), BLUE, 2);
    // 同一个渲染器里不换色的实例照旧（变体按换色表另存）。
    assert_eq!(render_with(&mut renderer, &svg_sticker(json!({})), 0.5, &mut media), plain);
}

#[test]
fn svg_images_use_the_kernel_raster_and_missing_bytes_are_refused() {
    let video = video(vec![full_image("im", 0, 0, 30)], vec![svg_asset("a_im", 10, 10)], json!({}));
    let mut media = Media::default();
    // 界面给的画面不用：SVG 只从素材字节画。
    media.pictures.insert("im".into(), solid(10, 10, YELLOW));
    let error = try_render(&mut renderer(false, frame_render::Documents::default()), &video, 0.5, &mut media).unwrap_err();
    assert_eq!(
        (error.items[0].scope, error.items[0].reason.as_str()),
        ("asset", "asset-undecodable")
    );
    media.assets.insert("a_im".into(), FLAT_SVG.as_bytes().to_vec());
    let frame = render(&video, 0.5, &mut media);
    near(px(&frame, 80, 20), RED, 2);
    near(px(&frame, 80, 70), BLUE, 2);
}

fn gif_sticker(mode: &str) -> video_model::VideoSnapshot {
    video(
        vec![item(
            "st",
            0,
            90,
            json!({ "type": "sticker", "sticker": { "source": "asset", "loop": mode }, "place": { "w": 30 },
                    "assetRef": { "id": "a_gif", "revision": "rev_1" } }),
        )],
        vec![gif_asset("a_gif", 8, 8)],
        json!({}),
    )
}

/// 只装回退字体（思源黑体）的渲染器。
fn fallback_only_renderer() -> frame_render::FrameRenderer {
    frame_render::FrameRenderer::new(
        frame_render::RenderOptions {
            width: W,
            height: H,
            skip_unsupported: false,
            captions: true,
        },
        frame_render::Documents::default(),
        fonts()[..1].to_vec(),
    )
    .unwrap()
}

fn marker_title() -> video_model::VideoSnapshot {
    video(
        vec![item(
            "title",
            0,
            30,
            json!({
                "type": "text", "text": "HHHH", "style": { "fontSize": 60, "color": "#FFFFFF", "fontFamily": "Permanent Marker" },
                "place": { "x": 50, "y": 50, "w": 90 }
            }),
        )],
        vec![],
        json!({}),
    )
}

#[test]
fn gif_images_play_from_their_bytes_and_loop() {
    let video = video(vec![full_image("im", 0, 0, 90)], vec![gif_asset("a_im", 8, 8)], json!({}));
    let mut media = Media::default();
    // 界面给的画面不用：GIF 只从素材字节解。
    media.pictures.insert("im".into(), solid(8, 8, WHITE));
    media.assets.insert("a_im".into(), STRIPES_GIF.to_vec());
    let mut renderer = renderer(false, frame_render::Documents::default());
    // 帧表 [0, 100) [100, 300) [300, 600) [600, 1000)；过了 1 秒从头再来。
    for (seconds, frame) in [(0.05, 0), (0.15, 1), (0.35, 2), (0.75, 3), (1.05, 0), (1.35, 2)] {
        let pixels = render_with(&mut renderer, &video, seconds, &mut media);
        near(px(&pixels, 80, 45), STRIPES[frame], 2);
    }
}

#[test]
fn gif_stickers_follow_their_loop_mode() {
    let mut media = Media::default();
    media.assets.insert("a_gif".into(), STRIPES_GIF.to_vec());
    for (mode, seconds, frame) in [
        ("loop", 1.15, 1),
        ("once", 0.15, 1),
        // 播一次停在末帧。
        ("once", 1.5, 3),
        ("hold", 0.5, 0),
    ] {
        let pixels = render(&gif_sticker(mode), seconds, &mut media);
        near(px(&pixels, 80, 45), STRIPES[frame], 2);
    }
}

#[test]
fn gifs_that_cannot_animate_draw_their_first_frame() {
    // 每帧都不停留：按第一帧画，不提示。
    let still = frame_render::load_gif("still", &tiny_gif(3, 0)).unwrap();
    assert!(matches!(still, (frame_render::Gif::Still(_), None)));
    // 文件名里的中文不能把零时长误判为预算超限。
    let still = frame_render::load_gif("超过上限.gif", &tiny_gif(3, 0)).unwrap();
    assert!(matches!(still, (frame_render::Gif::Still(_), None)));
    // 帧数超过上限：按第一帧画，并提示。
    let (gif, note) = frame_render::load_gif("big", &tiny_gif(frame_render::GIF_BUDGET.max_frames + 1, 1)).unwrap();
    assert!(matches!(gif, frame_render::Gif::Still(_)));
    assert!(note.unwrap().contains("只画第一帧"));
    assert!(matches!(
        frame_render::load_gif("small", &tiny_gif(3, 1)).unwrap(),
        (frame_render::Gif::Animated(_), None)
    ));

    let mut media = Media::default();
    media
        .assets
        .insert("a_gif".into(), tiny_gif(frame_render::GIF_BUDGET.max_frames + 1, 1));
    let mut renderer = renderer(false, frame_render::Documents::default());
    let pixels = render_with(&mut renderer, &gif_sticker("loop"), 0.5, &mut media);
    near(px(&pixels, 80, 45), RED, 2);
    assert!(renderer.warnings().iter().any(|w| w.detail.starts_with("st：GIF 太大")));
}

#[test]
fn unreadable_gifs_are_refused() {
    let mut media = Media::default();
    let error = try_render(
        &mut renderer(false, frame_render::Documents::default()),
        &gif_sticker("loop"),
        0.5,
        &mut media,
    )
    .unwrap_err();
    assert_eq!(error.items[0].reason, "asset-undecodable");
    media.assets.insert("a_gif".into(), b"GIF89a broken".to_vec());
    let error = try_render(
        &mut renderer(false, frame_render::Documents::default()),
        &gif_sticker("loop"),
        0.5,
        &mut media,
    )
    .unwrap_err();
    assert_eq!(error.items[0].reason, "asset-undecodable");
}

#[test]
fn text_in_a_missing_family_is_reported_on_every_frame_until_its_font_arrives() {
    let video = marker_title();
    let note = "title：字体 \"Permanent Marker\" 在当前字体库中不可用，将使用 Noto Sans SC fallback";
    let mut renderer = fallback_only_renderer();
    let fallback = render_with(&mut renderer, &video, 0.5, &mut Media::default());
    assert_eq!(renderer.missing_fonts(), vec!["Permanent Marker".to_string()]);
    assert!(renderer.warnings().iter().any(|w| w.detail == note), "{:?}", renderer.warnings());
    // 预览每帧清掉报告：内核缓存了排好的字，下一帧照样报（与导出一致）。
    renderer.clear_reports();
    assert!(renderer.missing_fonts().is_empty());
    let again = render_with(&mut renderer, &video, 0.6, &mut Media::default());
    assert_eq!(again, fallback);
    assert_eq!(renderer.missing_fonts(), vec!["Permanent Marker".to_string()]);
    assert!(renderer.warnings().iter().any(|w| w.detail == note), "{:?}", renderer.warnings());
    // 宿主把字体送进来：已报的缺字体撤回（导出重画这一帧时不留提示）；按它重排，不再报，画出来与一开始就装着这份
    // 字体的一样。
    renderer.add_fonts(vec![std::sync::Arc::new(
        include_bytes!("../../render-raster/assets/fonts/PermanentMarker-Regular.ttf").to_vec(),
    )]);
    assert!(renderer.missing_fonts().is_empty(), "{:?}", renderer.missing_fonts());
    assert!(renderer.warnings().is_empty(), "{:?}", renderer.warnings());
    let loaded = render_with(&mut renderer, &video, 0.5, &mut Media::default());
    assert!(renderer.missing_fonts().is_empty(), "{:?}", renderer.missing_fonts());
    assert!(renderer.warnings().is_empty(), "{:?}", renderer.warnings());
    assert_ne!(loaded, fallback, "换了字体，字形不同");
    let mut full = common::renderer(false, frame_render::Documents::default());
    assert_eq!(loaded, render_with(&mut full, &video, 0.5, &mut Media::default()));
}

#[test]
fn bundled_families_are_not_reported_missing() {
    let mut renderer = renderer(false, frame_render::Documents::default());
    render_with(&mut renderer, &marker_title(), 0.5, &mut Media::default());
    assert!(renderer.missing_fonts().is_empty());
    assert!(renderer.warnings().is_empty(), "{:?}", renderer.warnings());
}
