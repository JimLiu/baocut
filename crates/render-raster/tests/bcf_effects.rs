//! `media` 门内：本文件用 `LoadedAssets` / `MediaStore` / `FrameRenderer`
//! （BCF 文档渲染链路与 host 字节层），`wasm-safe` 构建里不存在（设计 §9.1）。
#![cfg(feature = "media")]

//! BCF 的 `effects[]` / `style.blendMode` / `blur` / `clipPath` 四条通道
//! （规范 §6.6 / §6.3，设计 §15 阶段 4B）。
//!
//! 四条的分工是**可执行的**：`blendMode` 与 `clipPath` 是单 surface 语义，
//! 走 DrawOp v3 的 `PushLayer{blend}` / `ClipPath`，计划仍然折叠成单 Draw
//! pass；`effects[]` 与 `blur` 要离屏 surface，计划因此长出 `Filter` 与
//! `Composite`。没有这四条的文档一个 pass 都不多。

use render_raster::plan::{CapabilityProfile, CpuExecutor, FramePlanner, RenderPass, execute_plan};
use render_raster::{FrameRenderer, LoadedAssets, MediaStore, TextEngine};
use scene_primitives::resolve::{Ir, Resolver};
use serde_json::{Value, json};
use std::sync::Arc;

fn doc_with_element(element: Value) -> Value {
    json!({
        "bcut": "0.1",
        "meta": {"id": "fx", "width": 240, "height": 160, "fps": 30, "background": "#101014"},
        "scenes": [{"id": "s", "dur": 2}],
        "tracks": [{"id": "main", "kind": "visual", "clips": [
            {"id": "c", "start": 0, "end": "@s.end", "element": element}
        ]}]
    })
}

/// 左上角起的 100×100 实心方块——像素断言最好读的形状。
fn square(extra: Value) -> Value {
    let mut node = json!({
        "type": "box",
        "id": "sq",
        "style": {"width": 100, "height": 100, "background": "#ff3366"}
    });
    let object = node.as_object_mut().unwrap();
    for (key, value) in extra.as_object().unwrap() {
        if key == "style" {
            let style = object.get_mut("style").unwrap().as_object_mut().unwrap();
            for (k, v) in value.as_object().unwrap() {
                style.insert(k.clone(), v.clone());
            }
        } else {
            object.insert(key.clone(), value.clone());
        }
    }
    node
}

fn ir_of(doc: Value) -> Ir {
    Resolver::new(doc, None).unwrap().resolve().unwrap()
}

fn render(mut ir: Ir, t: f64) -> (Vec<u8>, usize, usize) {
    let mut engine = TextEngine::new();
    let renderer = FrameRenderer::new(&mut ir, &mut engine).unwrap();
    let planner = FramePlanner::cpu(&ir).unwrap();
    let plan = planner.plan(&renderer, &ir, &mut engine, t);
    plan.validate().unwrap();
    let filters = plan
        .passes
        .iter()
        .filter(|pass| matches!(pass, RenderPass::Filter { .. }))
        .count();
    let mut executor = CpuExecutor::new(CapabilityProfile::cpu_reference());
    let mut media = MediaStore::new(Arc::new(LoadedAssets::default()), ir.fps);
    let pixmap = execute_plan(&plan, &mut executor, &mut media, None).unwrap();
    (pixmap.data().to_vec(), plan.passes.len(), filters)
}

/// 像素取样：`data` 是预乘 RGBA。
fn px(data: &[u8], x: u32, y: u32) -> [u8; 4] {
    let i = ((y * 240 + x) * 4) as usize;
    [data[i], data[i + 1], data[i + 2], data[i + 3]]
}

// ── 单 surface 的两条：blendMode / clipPath ─────────────────────────

#[test]
fn blend_mode_and_clip_path_stay_in_one_draw_pass() {
    for extra in [
        json!({"style": {"blendMode": "screen"}}),
        json!({"style": {"clipPath": {"shape": "circle", "cx": 0.5, "cy": 0.5, "r": 0.5}}}),
    ] {
        let mut ir = ir_of(doc_with_element(square(extra.clone())));
        let mut engine = TextEngine::new();
        let renderer = FrameRenderer::new(&mut ir, &mut engine).unwrap();
        let planner = FramePlanner::cpu(&ir).unwrap();
        assert!(
            planner.topology().is_empty(),
            "{extra}: 单 surface 语义不该产生离屏拓扑"
        );
        let plan = planner.plan(&renderer, &ir, &mut engine, 1.0);
        assert!(plan.is_folded(), "{extra}: 应当折叠成单 Draw pass");
    }
}

/// 圆形 `clipPath` 真的切掉了方块的四角。
#[test]
fn a_circle_clip_path_removes_the_corners() {
    let plain = render(ir_of(doc_with_element(square(json!({})))), 1.0).0;
    let clipped = render(
        ir_of(doc_with_element(square(
            json!({"style": {"clipPath": {"shape": "circle", "cx": 0.5, "cy": 0.5, "r": 0.5}}}),
        ))),
        1.0,
    )
    .0;
    // 盒是 0..99 见方。角落 (3, 3) 在圆外，中心 (50, 50) 在圆内。
    assert_eq!(px(&plain, 3, 3)[0], px(&plain, 50, 50)[0]);
    assert_eq!(
        px(&clipped, 3, 3),
        [0x10, 0x10, 0x14, 0xff],
        "圆外的角必须只剩底色"
    );
    assert_eq!(
        px(&clipped, 50, 50),
        px(&plain, 50, 50),
        "圆内的中心必须与未裁剪时逐字节相同"
    );
}

/// `inset` 的四边与圆角。
#[test]
fn an_inset_clip_path_trims_each_edge() {
    let clipped = render(
        ir_of(doc_with_element(square(json!({"style": {"clipPath": {
            "shape": "inset", "top": 0.25, "right": 0.0, "bottom": 0.0, "left": 0.25
        }}})))),
        1.0,
    )
    .0;
    // 左上四分之一被切掉，右下保留。
    assert_eq!(px(&clipped, 10, 10), [0x10, 0x10, 0x14, 0xff]);
    assert_eq!(px(&clipped, 60, 60)[0], 0xff);
}

/// `blendMode: screen` 把方块提亮到底色之上——与 normal 不同。
#[test]
fn blend_mode_changes_the_composited_pixels() {
    let normal = render(ir_of(doc_with_element(square(json!({})))), 1.0).0;
    let screen = render(
        ir_of(doc_with_element(square(
            json!({"style": {"blendMode": "screen"}}),
        ))),
        1.0,
    )
    .0;
    assert_ne!(
        px(&normal, 50, 50),
        px(&screen, 50, 50),
        "screen 必须与 normal 得到不同的合成结果"
    );
    // screen 只会变亮，不会变暗。
    for channel in 0..3 {
        assert!(
            px(&screen, 50, 50)[channel] >= px(&normal, 50, 50)[channel],
            "screen 不该让通道 {channel} 变暗"
        );
    }
}

// ── 离屏 surface 的两条：effects[] / blur ───────────────────────────

#[test]
fn an_effect_stack_grows_filter_and_composite_passes() {
    let ir = ir_of(doc_with_element(square(json!({
        "effects": [{"preset": "filter.grayscale", "presetVersion": 1, "params": {"amount": 1}}]
    }))));
    let (data, passes, filters) = render(ir, 1.0);
    assert_eq!(filters, 1, "一条效果 ⇒ 一个 Filter pass");
    assert!(passes >= 3, "至少 Draw + Filter + Composite，实得 {passes}");
    let [r, g, b, _] = px(&data, 50, 50);
    assert_eq!(r, g, "灰度后三通道必须相等");
    assert_eq!(g, b);
}

/// `blur` 通道终于出画：动画到非零半径时长出 `Filter` pass 并真的糊边。
#[test]
fn the_blur_channel_finally_renders() {
    let ir = ir_of(doc_with_element(square(json!({
        "animate": {"keyframes": [{"prop": "blur", "frames": [
            {"t": "0%", "v": 0}, {"t": "100%", "v": 12}
        ]}]}
    }))));
    let sharp = render(ir_of(doc_with_element(square(json!({})))), 1.0).0;
    let (blurred, _, filters) = render(ir, 2.0);
    assert_eq!(filters, 1, "非零 blur ⇒ 一个隐式 filter.blur");
    // 方块右边界外一点：清晰时是纯底色，模糊后必然被染上一些红。
    assert_eq!(px(&sharp, 104, 50), [0x10, 0x10, 0x14, 0xff]);
    assert_ne!(
        px(&blurred, 104, 50),
        [0x10, 0x10, 0x14, 0xff],
        "blur 必须把颜色扩散到盒外"
    );
}

/// `blur` 采样为 0 的时刻不该白付一次离屏合成——计划仍然折叠。
#[test]
fn a_zero_blur_frame_still_folds() {
    let mut ir = ir_of(doc_with_element(square(json!({
        "animate": {"keyframes": [{"prop": "blur", "frames": [
            {"t": "0%", "v": 0}, {"t": "100%", "v": 12}
        ]}]}
    }))));
    let mut engine = TextEngine::new();
    let renderer = FrameRenderer::new(&mut ir, &mut engine).unwrap();
    let planner = FramePlanner::cpu(&ir).unwrap();
    assert!(!planner.topology().is_empty(), "有 blur 通道 ⇒ 拓扑非空");
    assert!(
        planner.plan(&renderer, &ir, &mut engine, 0.0).is_folded(),
        "blur 采样为 0 的那一刻应当折叠回单 Draw pass"
    );
}

/// 显式 `filter.blur` 与 `blur` 通道同时存在 ⇒ 半径相加（§6.6）。
#[test]
fn the_blur_channel_adds_to_an_explicit_filter_blur() {
    let ir = ir_of(doc_with_element(square(json!({
        "effects": [{"preset": "filter.blur", "params": {"radius": 0.02}}],
        "animate": {"keyframes": [{"prop": "blur", "frames": [
            {"t": "0%", "v": 8}, {"t": "100%", "v": 8}
        ]}]}
    }))));
    let mut ir = ir;
    let mut engine = TextEngine::new();
    let renderer = FrameRenderer::new(&mut ir, &mut engine).unwrap();
    let planner = FramePlanner::cpu(&ir).unwrap();
    let plan = planner.plan(&renderer, &ir, &mut engine, 1.0);
    let filters: Vec<&RenderPass> = plan
        .passes
        .iter()
        .filter(|pass| matches!(pass, RenderPass::Filter { .. }))
        .collect();
    assert_eq!(filters.len(), 1, "两者合并成一条 filter.blur");
    let RenderPass::Filter { uniforms, .. } = filters[0] else {
        unreachable!()
    };
    // 短边 160：0.02 + 8/160 = 0.07 ⇒ 11.2 px（round-to-int 在执行期做）。
    let radius = uniforms.scalar("radius").unwrap();
    assert!((radius - 0.07).abs() < 1e-9, "实得 {radius}");
}

// ── 结构性约束（preflight 拒绝而不是画错） ─────────────────────────

#[test]
fn nested_effect_stacks_apply_inside_out() {
    let ir = ir_of(doc_with_element(json!({
        "type": "box", "id": "outer",
        "style": {"width": 200, "height": 120},
        "effects": [{"preset": "filter.grayscale", "params": {"amount": 1}}],
        "children": [square(json!({
            "effects": [{"preset": "filter.blur", "params": {"radius": 0.02}}]
        }))]
    })));
    let (data, _, filters) = render(ir, 1.0);
    assert_eq!(filters, 2);
    let [r, g, b, _] = px(&data, 50, 50);
    assert_eq!((r, g), (g, b));
    assert_ne!(px(&data, 101, 50), [0x10, 0x10, 0x14, 0xff]);
}

#[test]
fn an_effect_under_a_non_normal_blend_ancestor_is_composited() {
    let ir = ir_of(doc_with_element(json!({
        "type": "box", "id": "outer",
        "style": {"width": 200, "height": 120, "blendMode": "multiply"},
        "children": [square(json!({
            "effects": [{"preset": "filter.blur", "params": {"radius": 0.02}}]
        }))]
    })));
    let (data, _, filters) = render(ir, 1.0);
    assert_eq!(filters, 1);
    assert!(px(&data, 50, 50)[1] < 0x10);
}

/// 效果路径也必须是 `(ir, t)` 的纯函数：两次计划逐字节相同。
#[test]
fn the_effect_path_is_bitwise_repeatable() {
    let make = || {
        ir_of(doc_with_element(square(json!({
            "effects": [
                {"preset": "filter.blur", "params": {"radius": 0.03}},
                {"preset": "filter.brightness", "params": {"amount": 0.1}}
            ],
            "style": {"blendMode": "screen"}
        }))))
    };
    let a = render(make(), 1.0);
    let b = render(make(), 1.0);
    assert_eq!(a.0, b.0);
    assert_eq!((a.1, a.2), (b.1, b.2));
    assert_eq!(a.2, 2, "两条效果 ⇒ 两个 Filter pass");
}

#[test]
fn group_opacity_applies_once_after_overlapping_children() {
    let make = |with_fx: bool| {
        let mut first = square(json!({}));
        if with_fx {
            first["effects"] = json!([{"preset":"filter.grayscale","params":{"amount":0}}]);
        }
        doc_with_element(json!({"type":"box","id":"group",
            "style":{"width":160,"height":140,"opacity":0.5},
            "children":[first, {"type":"box","id":"second",
                "style":{"x":50,"y":0,"width":100,"height":100,"background":"#ff3366"}}]}))
    };
    let plain = render(ir_of(make(false)), 1.0).0;
    let filtered = render(ir_of(make(true)), 1.0).0;
    assert_eq!(
        plain, filtered,
        "identity child filter must preserve isolated group alpha"
    );
    assert_eq!(px(&filtered, 25, 50), px(&filtered, 75, 50));
}

#[test]
fn ancestor_clip_contains_child_blur() {
    let document = doc_with_element(json!({"type":"box","id":"crop",
        "style":{"width":100,"height":100,"clipPath":{"shape":"inset","right":0.1}},
        "children":[square(json!({"effects":[{"preset":"filter.blur","params":{"radius":0.05}}]}))]}));
    let data = render(ir_of(document), 1.0).0;
    assert_ne!(px(&data, 85, 50), [0x10, 0x10, 0x14, 0xff]);
    assert_eq!(px(&data, 94, 50), [0x10, 0x10, 0x14, 0xff]);
}

#[test]
fn effect_mask_uses_same_premultiplied_luma_as_flat_matte() {
    for mode in ["alpha", "luma"] {
        for invert in [false, true] {
            let make = |fx| {
                let mut mask = json!({"type":"box","id":"mask",
                    "style":{"x":0,"width":100,"height":100,"background":"#ffffff","opacity":0.5}});
                if fx {
                    mask["effects"] = json!([{"preset":"filter.grayscale","params":{"amount":0}}]);
                }
                doc_with_element(
                    json!({"type":"box","id":"root","style":{"width":240,"height":160},
                    "children":[square(json!({"style":{"mask":{"source":"#mask","mode":mode,"invert":invert}}})), mask]}),
                )
            };
            let flat = render(ir_of(make(false)), 1.0).0;
            let graph = render(ir_of(make(true)), 1.0).0;
            assert_eq!(flat, graph, "{mode} invert={invert}");
        }
    }
}

#[test]
fn backdrop_only_changes_lower_content_inside_its_box() {
    let document = doc_with_element(
        json!({"type":"box","id":"root","style":{"width":240,"height":160},
        "children":[square(json!({})),
            {"type":"box","id":"glass","style":{"x":50,"y":0,"width":80,"height":100},
             "backdropEffects":[{"preset":"filter.grayscale","params":{"amount":1}}]},
            {"type":"box","id":"front","style":{"x":80,"y":0,"width":10,"height":20,"background":"#00ff00"}}
        ]}),
    );
    let data = render(ir_of(document.clone()), 1.0).0;
    assert_eq!(px(&data, 25, 50), [0xff, 0x33, 0x66, 0xff]);
    let [r, g, b, _] = px(&data, 70, 50);
    assert_eq!((r, g), (g, b));
    assert_eq!(px(&data, 85, 10), [0, 255, 0, 255]);
    assert_eq!(px(&data, 140, 50), [0x10, 0x10, 0x14, 0xff]);
    for t in [1.8, 0.2, 1.0, 0.0] {
        assert_eq!(render(ir_of(document.clone()), t).0, data);
    }
}

#[test]
fn mask_chain_renders_and_cycles_fail_during_resolve() {
    let mut document = doc_with_element(
        json!({"type":"box","id":"root","style":{"width":240,"height":160},
        "children":[square(json!({"style":{"mask":{"source":"#m1"}}})),
            {"type":"box","id":"m1","style":{"x":0,"width":100,"height":100,"background":"#fff","mask":{"source":"#m2"}},
             "effects":[{"preset":"filter.grayscale","params":{"amount":0}}]},
            {"type":"box","id":"m2","style":{"x":0,"width":50,"height":100,"background":"#fff"}}
        ]}),
    );
    let data = render(ir_of(document.clone()), 1.0).0;
    assert_eq!(px(&data, 25, 50), [255, 51, 102, 255]);
    assert_eq!(px(&data, 75, 50), [16, 16, 20, 255]);
    document["tracks"][0]["clips"][0]["element"]["children"][2]["style"]["mask"] =
        json!({"source":"#m1"});
    let result = Resolver::new(document, None).unwrap().resolve();
    assert!(result.err().unwrap().to_string().contains("成环"));
}

// ── 效果参数通道 `effects[N].<param>`（§6.6）─────────────────────────

fn fingerprint_at(doc: Value, t: f64) -> u64 {
    let mut ir = ir_of(doc);
    let mut engine = TextEngine::new();
    let renderer = FrameRenderer::new(&mut ir, &mut engine).unwrap();
    let planner = FramePlanner::cpu(&ir).unwrap();
    planner
        .plan(&renderer, &ir, &mut engine, t)
        .frame_fingerprint()
        .unwrap()
}

fn graded_square(animate: Option<Value>) -> Value {
    let mut extra = json!({
        "effects": [
            {"preset": "filter.grade", "presetVersion": 1, "params": {"gain": 1.0, "tint": 0.0}},
            {"preset": "filter.bloom", "presetVersion": 1, "params": {"threshold": 0.4, "intensity": 0.5}}
        ]
    });
    if let Some(animate) = animate {
        extra
            .as_object_mut()
            .unwrap()
            .insert("animate".into(), animate);
    }
    square(extra)
}

#[test]
fn keyframed_effect_params_change_pixels_and_fingerprints() {
    let animate = json!({"keyframes": [
        {"prop": "effects[0].tint", "frames": [{"t": 0, "v": -1.0}, {"t": 1, "v": 1.0}]},
        {"prop": "effects[1].intensity", "frames": [{"t": 0, "v": 0.0}, {"t": 1, "v": 3.0}]}
    ]});
    let doc = doc_with_element(graded_square(Some(animate)));
    let at0 = fingerprint_at(doc.clone(), 0.0);
    let at1 = fingerprint_at(doc.clone(), 1.0);
    let at2 = fingerprint_at(doc.clone(), 1.5);
    assert_ne!(at0, at1, "动画的效果参数必须进帧指纹");
    assert_eq!(at1, at2, "关键帧结束后保持末值 ⇒ 同一帧");

    // 光晕在强度 3 时溢出方块边界，强度 0 时没有。
    let (dark, _, _) = render(ir_of(doc.clone()), 0.0);
    let (glow, _, _) = render(ir_of(doc), 1.0);
    assert!(px(&glow, 104, 50)[0] > px(&dark, 104, 50)[0]);

    // 只动 tint：冷调蓝升红降，暖调红升蓝降。
    let tint_only = doc_with_element(graded_square(Some(json!({"keyframes": [
        {"prop": "effects[0].tint", "frames": [{"t": 0, "v": -1.0}, {"t": 1, "v": 1.0}]}
    ]}))));
    let (cold, _, _) = render(ir_of(tint_only.clone()), 0.0);
    let (warm, _, _) = render(ir_of(tint_only), 1.0);
    let c = px(&cold, 50, 50);
    let w = px(&warm, 50, 50);
    assert!(w[0] >= c[0] && w[2] < c[2], "cold {c:?} warm {w:?}");
}

#[test]
fn a_static_effect_stack_keeps_its_fingerprint_over_time() {
    let doc = doc_with_element(graded_square(None));
    assert_eq!(fingerprint_at(doc.clone(), 0.0), fingerprint_at(doc, 1.5));
}

#[test]
fn effect_channel_values_are_clamped_to_the_manifest_range() {
    let pinned = |v: f64| {
        let animate = json!({"keyframes": [
            {"prop": "effects[1].intensity", "frames": [{"t": 0, "v": v}, {"t": 1, "v": v}]}
        ]});
        fingerprint_at(doc_with_element(graded_square(Some(animate))), 0.5)
    };
    // manifest 上限 8：超出的值与 8 同帧。
    assert_eq!(pinned(8.0), pinned(50.0));
    assert_ne!(pinned(2.0), pinned(8.0));
}

// ── 径向模糊与光柱（§6.6）──────────────────────────────────────────

#[test]
fn radial_blur_strength_animates_through_the_effect_channel() {
    // 方块中心在 (50, 50)，径向中心放在画布正中 (120, 80)：方块右下角外侧
    // 被朝中心方向拖出的内容不存在，而方块左上角外侧（背离中心）会有拖影。
    let blurred = |animate: Value| {
        doc_with_element(square(json!({
            "effects": [{"preset": "filter.radialBlur", "presetVersion": 1,
                         "params": {"cx": 0.5, "cy": 0.5, "strength": 0.0}}],
            "animate": animate
        })))
    };
    let doc = blurred(json!({"keyframes": [
        {"prop": "effects[0].strength", "frames": [{"t": 0, "v": 0.0}, {"t": 1, "v": 0.5}]}
    ]}));
    assert_ne!(
        fingerprint_at(doc.clone(), 0.0),
        fingerprint_at(doc.clone(), 1.0)
    );
    let (still, _, _) = render(ir_of(doc.clone()), 0.0);
    let (zoomed, _, filters) = render(ir_of(doc), 1.0);
    assert_eq!(filters, 1);
    // strength 0 与无效果逐像素相同。
    let (plain, _, _) = render(ir_of(doc_with_element(square(json!({})))), 0.0);
    assert_eq!(still, plain, "strength = 0 必须恒等");
    // 每个像素朝中心取样：方块右缘（朝向中心的一侧）取到方块外的透明，被拖淡；
    // 左上角离中心最远、取样全落在方块内，基本不变。
    assert!(zoomed != still);
    let edge = px(&zoomed, 98, 50);
    assert!(
        edge[0] < px(&still, 98, 50)[0],
        "朝中心的边缘应被拖淡：{edge:?}"
    );
    let corner = px(&zoomed, 2, 2);
    assert!(corner[0] >= 250, "远端角落应保持实心：{corner:?}");
    // 可重放：同一时刻两次渲染逐字节相同。
    let doc = blurred(json!({"keyframes": [
        {"prop": "effects[0].strength", "frames": [{"t": 0, "v": 0.3}, {"t": 1, "v": 0.3}]}
    ]}));
    let (a, _, _) = render(ir_of(doc.clone()), 0.5);
    let (b, _, _) = render(ir_of(doc), 0.5);
    assert_eq!(a, b);
}

#[test]
fn god_rays_cast_a_shaft_away_from_an_offscreen_light() {
    // 暗场上一块金色亮条，光源在画面正上方画外：亮条下方长出光柱，上方不亮。
    let bar = json!({
        "type": "box", "id": "root",
        "style": {"width": 240, "height": 160},
        "effects": [{"preset": "filter.godRays", "presetVersion": 1,
                     "params": {"cx": 0.5, "cy": -0.2, "threshold": 0.3, "length": 0.7,
                                "intensity": 2.0, "decay": 0.3, "tint": "#ffd98a"}}],
        "children": [{"type": "box", "id": "bar",
                      "style": {"x": 100, "y": 40, "width": 40, "height": 8,
                                "background": "#ffcc55"}}]
    });
    let (lit, _, filters) = render(ir_of(doc_with_element(bar.clone())), 0.0);
    assert_eq!(filters, 1);
    let mut dark = bar;
    dark["effects"][0]["params"]["intensity"] = json!(0.0);
    let (plain, _, _) = render(ir_of(doc_with_element(dark)), 0.0);
    // 亮条下方 40 px 处被照亮，亮条上方与左右远处不变。
    assert!(
        px(&lit, 120, 90)[0] > px(&plain, 120, 90)[0] + 8,
        "{:?}",
        px(&lit, 120, 90)
    );
    assert_eq!(px(&lit, 120, 20), px(&plain, 120, 20));
    assert_eq!(px(&lit, 20, 120), px(&plain, 20, 120));
}

// ── 分词模糊（§6.4）：`animate.parts` 里的 `blur` 通道 ─────────────────

/// 两个词、逐词 0.5 s 的 `motion.blurIn`（不淡入，只看模糊）。
fn blurred_title(animated: bool, opacity: f64) -> Value {
    let mut node = json!({
        "type": "text", "id": "title", "text": "AB CD",
        "style": {"x": 20, "y": 50, "fontSize": 48, "color": "#ffffff", "opacity": opacity},
        "split": {"by": "word"}
    });
    if animated {
        node["animate"] = json!({"parts": {"op": "stagger", "gap": 0.5, "parts": true,
            "item": {"op": "preset", "preset": "motion.blurIn", "dur": 0.5,
                     "params": {"blur": 8, "fade": false}}}});
    }
    node
}

/// 预乘 alpha 落在 (0, 255) 的像素数：模糊把实心字形的边缘摊成半透明。
fn soft_pixels(data: &[u8]) -> usize {
    data.chunks_exact(4)
        .filter(|px| px[0] > 0x10 && px[0] < 0xf0)
        .count()
}

#[test]
fn part_blur_softens_each_word_on_its_own_schedule() {
    let doc = |animated: bool| doc_with_element(blurred_title(animated, 1.0));
    let (reference, _, filters) = render(ir_of(doc(false)), 1.5);
    assert_eq!(filters, 0);
    // t = 0.25：第一个词正在变清，第二个词还没开始（停在起始半径）⇒ 两个半径桶。
    let (mid, _, filters) = render(ir_of(doc(true)), 0.25);
    assert_eq!(filters, 2, "每个不同的模糊半径各一层 filter.blur");
    assert_ne!(mid, reference);
    assert!(
        soft_pixels(&mid) > soft_pixels(&reference) * 2,
        "模糊中的词应当把边缘摊开：{} vs {}",
        soft_pixels(&mid),
        soft_pixels(&reference)
    );
    // t = 0.75：第一个词已清晰，只剩第二个词在模糊。
    let (_, _, filters) = render(ir_of(doc(true)), 0.75);
    assert_eq!(filters, 1);
    // 全部落定：没有滤镜，与不动画的文字逐像素相同。
    let (settled, _, filters) = render(ir_of(doc(true)), 1.5);
    assert_eq!(filters, 0);
    assert_eq!(settled, reference);
    // 纯函数：同一时刻重复渲染逐字节相同。
    assert_eq!(render(ir_of(doc(true)), 0.25).0, mid);
}

#[test]
fn part_blur_under_group_opacity_still_blurs() {
    // 元素自己带 opacity < 1 时整元素改走离屏组，part 的模糊层在组内生成，
    // 组透明度仍然只施加一次。
    let (faded, _, filters) = render(ir_of(doc_with_element(blurred_title(true, 0.5))), 0.25);
    assert_eq!(filters, 2);
    let (sharp, _, _) = render(ir_of(doc_with_element(blurred_title(false, 0.5))), 0.25);
    assert_ne!(faded, sharp);
}

#[test]
fn flat_recording_draws_blurred_parts_inline() {
    // `record()` 的平坦指令流没有 Filter pass：模糊中的 part 照常内联，字形一个不少。
    let fills = |t: f64| {
        let mut ir = ir_of(doc_with_element(blurred_title(true, 1.0)));
        let mut engine = TextEngine::new();
        let renderer = FrameRenderer::new(&mut ir, &mut engine).unwrap();
        renderer
            .record(&ir, &mut engine, t)
            .ops
            .iter()
            .filter(|op| matches!(op, render_raster::drawop::DrawOp::FillPath { .. }))
            .count()
    };
    assert!(fills(0.25) > 0);
    assert_eq!(fills(0.25), fills(1.5));
}

#[test]
fn unsupported_part_channels_are_rejected() {
    let mut node = blurred_title(false, 1.0);
    node["animate"] = json!({"parts": {"op": "stagger", "gap": 0.1, "parts": true,
        "item": {"op": "tween", "prop": "rotation", "from": -20, "to": 0, "dur": 0.4}}});
    let error = Resolver::new(doc_with_element(node), None)
        .unwrap()
        .resolve()
        .err()
        .expect("part 上的 rotation 应被拒绝")
        .to_string();
    assert!(error.contains("motion-unsupported"), "{error}");
    assert!(error.contains("rotation"), "{error}");
}
