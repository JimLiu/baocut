//! 一帧怎么合起来：背景、层的顺序、摆放、裁剪、镜像与不透明度、输出缩放，各种转场（两侧与单侧），以及画不出来的
//! 东西怎样拒绝或跳过（从不画成空白）。

mod common;

use common::*;
use frame_render::{Documents, FrameRenderer, RenderOptions};
use serde_json::{Value, json};

/// 两个铺满画布的图片素材 `a_a`、`a_b`。
fn two_images() -> Vec<(String, Value)> {
    vec![image_asset("a_a", W, H), image_asset("a_b", W, H)]
}

#[test]
fn background_is_the_sequence_colour() {
    let red = video(
        vec![],
        vec![],
        json!({ "canvas": { "width": W, "height": H, "workingSpace": "srgb", "background": "#FF0000" } }),
    );
    near(px(&render(&red, 0.0, &mut Media::default()), 3, 3), RED, 0);
    // 读不懂的背景色按黑色。
    let odd = video(
        vec![],
        vec![],
        json!({ "canvas": { "width": W, "height": H, "workingSpace": "srgb", "background": "nope" } }),
    );
    near(px(&render(&odd, 0.0, &mut Media::default()), 3, 3), BLACK, 0);
}

#[test]
fn layers_follow_place_opacity_crop_order_and_mirror() {
    let assets = || vec![image_asset("a_a", 16, 9), image_asset("a_b", 16, 9)];
    let media = || Media::default().with("a", solid(16, 9, RED)).with("b", halves(16, 9, RED, BLUE));
    // 居中、宽一半的画中画。
    let pip = video(vec![image("a", 0, 0, 30, json!({ "place": { "w": 50 } }))], assets(), json!({}));
    let frame = render(&pip, 0.0, &mut media());
    near(px(&frame, 80, 45), RED, 2);
    near(px(&frame, 30, 45), BLACK, 0);
    near(px(&frame, 130, 45), BLACK, 0);
    // 不透明度 0.5 叠在黑底上。
    let half = video(
        vec![image("a", 0, 0, 30, json!({ "mode": "fullscreen", "place": { "opacity": 0.5 } }))],
        assets(),
        json!({}),
    );
    near(px(&render(&half, 0.0, &mut media()), 10, 10), [128, 0, 0, 255], 2);
    // 只留源的右半：铺满后整个画面是蓝的。
    let cropped = video(
        vec![image(
            "b",
            0,
            0,
            30,
            json!({ "mode": "fullscreen", "crop": { "left": 0.5, "top": 0, "right": 0, "bottom": 0 } }),
        )],
        assets(),
        json!({}),
    );
    let frame = render(&cropped, 0.0, &mut media());
    near(px(&frame, 20, 10), BLUE, 2);
    near(px(&frame, 140, 80), BLUE, 2);
    // 后画的层盖在先画的层上（同一轨道按 paintOrder）。
    let stacked = video(
        vec![
            image("b", 0, 0, 30, json!({ "mode": "fullscreen" })),
            image("a", 1, 0, 30, json!({ "place": { "x": 25, "y": 50, "w": 50 } })),
        ],
        assets(),
        json!({}),
    );
    let frame = render(&stacked, 0.0, &mut media());
    near(px(&frame, 40, 45), RED, 2);
    near(px(&frame, 140, 45), BLUE, 2);
    // 水平镜像。
    let mirrored = video(
        vec![image("b", 0, 0, 30, json!({ "mode": "fullscreen", "place": { "flipX": true } }))],
        assets(),
        json!({}),
    );
    let frame = render(&mirrored, 0.0, &mut media());
    near(px(&frame, 10, 45), BLUE, 2);
    near(px(&frame, 150, 45), RED, 2);
}

#[test]
fn output_scales_from_the_sequence_canvas() {
    // 序列画布 160×90，输出 320×180：同一个画中画落在放大一倍的位置。
    let pip = video(
        vec![image("a", 0, 0, 30, json!({ "place": { "x": 75, "y": 75, "w": 50 } }))],
        vec![image_asset("a_a", 16, 9)],
        json!({}),
    );
    let mut big = FrameRenderer::new(
        RenderOptions {
            width: 2 * W,
            height: 2 * H,
            skip_unsupported: false,
            captions: true,
        },
        Documents::default(),
        fonts(),
    )
    .unwrap();
    let plan = plan(&pip, 0.0);
    let mut media = Media::default().with("a", solid(16, 9, RED));
    let frame = big
        .render(render_graph::VideoView::from(&pip), &plan, 0.0, &mut media)
        .unwrap()
        .to_vec();
    let at = |x: u32, y: u32| -> [u8; 4] { frame[((y * 2 * W + x) * 4) as usize..][..4].try_into().unwrap() };
    near(at(240, 135), RED, 2);
    near(at(80, 45), BLACK, 0);
}

/// A [0, 30) 接 B [30, 60)，中间一个 20 帧的两侧转场（窗口 [20, 40)），画第 `frame` 帧。
fn two_sided(kind: &str, params: Value, frame: f64, a: tiny_skia::Pixmap, b: tiny_skia::Pixmap, b_body: Value) -> Vec<u8> {
    let mut b_item = full_image("b", 0, 30, 30);
    if let (Some(item), Value::Object(extra)) = (b_item.as_object_mut(), b_body) {
        item.extend(extra);
    }
    let video = video(
        vec![full_image("a", 0, 0, 30), b_item],
        two_images(),
        json!({ "transitions": [transition("tr", Some("a"), Some("b"), kind, params, 20)] }),
    );
    let mut media = Media::default().with("a", a).with("b", b);
    render(&video, at(frame), &mut media)
}

fn red() -> tiny_skia::Pixmap {
    solid(W, H, RED)
}

fn blue() -> tiny_skia::Pixmap {
    solid(W, H, BLUE)
}

#[test]
fn dissolve_and_dip_to_colour() {
    // 进度 0.25：A 满画，B 以 0.25 盖上去。
    near(
        px(&two_sided("dissolve", json!({}), 25.0, red(), blue(), json!({})), 80, 45),
        [191, 0, 64, 255],
        2,
    );
    let green = json!({ "color": "#00FF00" });
    let dip = |frame: f64| px(&two_sided("dip-to-color", green.clone(), frame, red(), blue(), json!({})), 5, 5);
    near(dip(25.0), [128, 128, 0, 255], 2);
    near(dip(30.0), [0, 255, 0, 255], 2);
    near(dip(35.0), [0, 128, 128, 255], 2);
}

#[test]
fn push_moves_both_sides() {
    // A 左红右黄，B 蓝。向左推到一半：A 左移半个画布，左半是 A 的右半（黄），右半是 B。
    let frame = two_sided(
        "push",
        json!({ "direction": "left" }),
        30.0,
        halves(W, H, RED, YELLOW),
        blue(),
        json!({}),
    );
    near(px(&frame, 20, 45), YELLOW, 2);
    near(px(&frame, 140, 45), BLUE, 2);
}

#[test]
fn wipe_slide_zoom_and_iris_follow_the_incoming_box() {
    // 进度 0.5，B 铺满画布：
    // wipe 从框的左边揭开一半；
    let frame = two_sided("wipe", json!({}), 30.0, red(), blue(), json!({}));
    near(px(&frame, 20, 45), BLUE, 2);
    near(px(&frame, 140, 45), RED, 2);
    // B 水平镜像时从右边揭开（框自己的局部左边）；
    let frame = two_sided("wipe", json!({}), 30.0, red(), blue(), json!({ "place": { "flipX": true } }));
    near(px(&frame, 20, 45), RED, 2);
    near(px(&frame, 140, 45), BLUE, 2);
    // slide 沿框的 x 轴从左边移进来一半，同时淡入 0.5；
    let frame = two_sided("slide", json!({}), 30.0, red(), blue(), json!({}));
    near(px(&frame, 20, 45), [128, 0, 128, 255], 2);
    near(px(&frame, 140, 45), RED, 2);
    // zoom 绕框中心缩到 0.875，同时淡入 0.5；
    let frame = two_sided("zoom", json!({}), 30.0, red(), blue(), json!({}));
    near(px(&frame, 80, 45), [128, 0, 128, 255], 2);
    near(px(&frame, 2, 2), RED, 2);
    // iris 是半径为半对角线一半的圆。
    let frame = two_sided("iris", json!({}), 30.0, red(), blue(), json!({}));
    near(px(&frame, 80, 45), BLUE, 2);
    near(px(&frame, 2, 2), RED, 2);
    near(px(&frame, 158, 88), RED, 2);
}

#[test]
fn wipe_on_a_rotated_pip_reveals_along_its_own_axis() {
    // B 是转了 90° 的画中画：框的局部左边在上方，揭开一半时上半露出来、下半还没有。
    let video = video(
        vec![
            full_image("a", 0, 0, 30),
            image("b", 0, 30, 30, json!({ "place": { "x": 50, "y": 50, "w": 40, "rot": 90 } })),
        ],
        vec![image_asset("a_a", W, H), image_asset("a_b", 100, 100)],
        json!({ "transitions": [transition("tr", Some("a"), Some("b"), "wipe", json!({}), 20)] }),
    );
    let mut media = Media::default().with("a", red()).with("b", solid(100, 100, BLUE));
    let frame = render(&video, at(30.0), &mut media);
    // 框 64×64 居中：上半（局部左半）是蓝的，下半仍是 A。
    near(px(&frame, 80, 25), BLUE, 2);
    near(px(&frame, 80, 65), RED, 2);
}

#[test]
fn single_sided_transitions_reveal_lower_layers() {
    let video = |role: &str| {
        let (left, right) = if role == "in" { (None, Some("top")) } else { (Some("top"), None) };
        video(
            vec![full_image("under", 0, 0, 90), full_image("top", 1, 0, 60)],
            vec![image_asset("a_under", W, H), image_asset("a_top", W, H)],
            json!({ "transitions": [transition("tr", left, right, "dissolve", json!({}), 20)] }),
        )
    };
    let media = || Media::default().with("under", blue()).with("top", red());
    // 入场（窗口 [0, 20)）到一半：上层半透明盖在下面的层上。
    near(px(&render(&video("in"), at(10.0), &mut media()), 9, 9), [128, 0, 128, 255], 2);
    // 出场（窗口 [40, 60)）进度 0.25 时按逆过程还剩 3/4。
    near(px(&render(&video("out"), at(45.0), &mut media()), 9, 9), [191, 0, 64, 255], 2);
    // 单侧的 wipe：入场揭开一半，没揭开的地方露出下面的层。
    let wipe = video_with_kind("wipe");
    let frame = render(&wipe, at(10.0), &mut media());
    near(px(&frame, 20, 45), RED, 2);
    near(px(&frame, 140, 45), BLUE, 2);
}

fn video_with_kind(kind: &str) -> video_model::VideoSnapshot {
    video(
        vec![full_image("under", 0, 0, 90), full_image("top", 1, 0, 60)],
        vec![image_asset("a_under", W, H), image_asset("a_top", W, H)],
        json!({ "transitions": [transition("tr", None, Some("top"), kind, json!({}), 20)] }),
    )
}

#[test]
fn unknown_transitions_are_refused_or_cut() {
    let video = video(
        vec![full_image("a", 0, 0, 30), full_image("b", 0, 30, 30)],
        two_images(),
        json!({ "transitions": [transition("tr", Some("a"), Some("b"), "vendor.spin", json!({ "turns": 2 }), 20)] }),
    );
    let media = || Media::default().with("a", red()).with("b", blue());
    let error = try_render(&mut renderer(false, Documents::default()), &video, at(25.0), &mut media()).unwrap_err();
    assert_eq!(error.code, "EXPORT_UNSUPPORTED_CONTENT");
    assert_eq!(
        (error.items[0].scope, error.items[0].reason.as_str(), error.items[0].kind.as_deref()),
        ("transition", "transition-unknown-kind", Some("vendor.spin"))
    );
    // 跳过时按硬切：剪切点前只画 A，之后只画 B；两侧报的是同一项。
    let mut skipping = renderer(true, Documents::default());
    near(px(&render_with(&mut skipping, &video, at(25.0), &mut media()), 80, 45), RED, 2);
    near(px(&render_with(&mut skipping, &video, at(35.0), &mut media()), 80, 45), BLUE, 2);
    assert_eq!(skipping.skipped().len(), 1);
}

#[test]
fn layers_the_plan_cannot_draw_are_refused_or_skipped_never_blank() {
    // 没有预渲染替身的代码包合成：整层不画，报出原因与说明。
    let video = video(
        vec![
            full_image("a", 0, 0, 30),
            item(
                "bundle",
                1,
                30,
                json!({
                    "type": "composition", "source": { "kind": "bundle", "assetRef": { "id": "a_a", "revision": "rev_1" } },
                    "parameterValues": {},
                    "timeMap": { "kind": "linear", "sourceIn": { "ticks": "0", "timescale": 1 }, "rate": { "num": 1, "den": 1 } },
                    "place": { "w": 50 }
                }),
            ),
        ],
        vec![image_asset("a_a", W, H)],
        json!({}),
    );
    let media = || Media::default().with("a", red());
    let error = try_render(&mut renderer(false, Documents::default()), &video, 0.0, &mut media()).unwrap_err();
    assert_eq!(error.code, "EXPORT_UNSUPPORTED_CONTENT");
    assert_eq!(
        (
            error.items[0].item_id.as_str(),
            error.items[0].scope,
            error.items[0].reason.as_str()
        ),
        ("bundle", "layer", "bundle-without-prerender")
    );
    assert!(!error.items[0].message.is_empty());
    let mut skipping = renderer(true, Documents::default());
    let frame = render_with(&mut skipping, &video, 0.0, &mut media());
    near(px(&frame, 80, 45), RED, 2);
    assert_eq!(skipping.skipped()[0].reason, "bundle-without-prerender");
}

#[test]
fn layers_whose_source_was_skipped_are_left_out() {
    // 取画面的一方说「这层没有画面」（它已把解不开的素材记进跳过清单）时整层不画，不画成占位的空框。
    let video = video(vec![full_image("a", 0, 0, 30)], vec![image_asset("a_a", W, H)], json!({}));
    let frame = render(&video, 0.0, &mut Media::default());
    assert_eq!(painted(&frame), 0);
}
