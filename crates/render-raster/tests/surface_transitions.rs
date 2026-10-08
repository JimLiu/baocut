//! `media` 门内：本文件用 `LoadedAssets` / `MediaStore` / `FrameRenderer`
//! （BCF 文档渲染链路与 host 字节层），`wasm-safe` 构建里不存在（设计 §9.1）。
#![cfg(feature = "media")]

//! Surface Transition（规范 §9 第二类，设计 §6.4 / 阶段 5）。
//!
//! 与 `transitions.rs` 的 Motion 版分工清楚：这里的每个剪辑点都长出
//! `Draw(from) → Draw(to) → Transition → Composite`，两侧画面**不动**，
//! 由 `progress` 驱动的双输入效果合成。没有 Surface Transition 的文档一个
//! pass 都不多——那条不变量由 `transitions.rs` 与 `frame_plan.rs` 守。

use render_raster::plan::{
    CapabilityProfile, CpuExecutor, FramePlanner, RenderPass, SurfaceLifetime, execute_plan,
};
use render_raster::{FrameRenderer, LoadedAssets, MediaStore, TextEngine};
use scene_primitives::resolve::{Ir, Resolver};
use serde_json::{Value, json};
use std::sync::Arc;

const W: u32 = 240;
const H: u32 = 160;
const T0: f64 = 1.0;
const DUR: f64 = 0.4;

const RED: [u8; 4] = [0xff, 0x33, 0x66, 0xff];
const BLUE: [u8; 4] = [0x22, 0x66, 0xff, 0xff];

fn plate(id: &str, color: &str) -> Value {
    json!({"type": "box", "id": id,
           "style": {"width": W, "height": H, "background": color}})
}

fn doc(transition: Value) -> Value {
    json!({
        "bcut": "0.2",
        "meta": {"id": "st", "width": W, "height": H, "fps": 30, "background": "#000000"},
        "scenes": [{"id": "a", "dur": 1}, {"id": "b", "dur": 1}],
        "tracks": [{"id": "main", "kind": "visual", "clips": [
            {"id": "a", "start": 0, "end": "@a.end",
             "transitionOut": transition,
             "element": plate("pa", "#ff3366")},
            {"id": "b", "start": "@b", "end": "@b.end",
             "element": plate("pb", "#2266ff")}
        ]}]
    })
}

fn circle_crop() -> Value {
    json!({"preset": "transition.circleCrop", "presetVersion": 1, "dur": DUR})
}

fn ir_of(document: Value) -> Ir {
    Resolver::new(document, None).unwrap().resolve().unwrap()
}

/// `Ir` 没有 `Debug`，`unwrap_err()` 用不了。
fn resolve_error(document: Value) -> String {
    match Resolver::new(document, None).unwrap().resolve() {
        Ok(_) => panic!("应当报错"),
        Err(error) => error.to_string(),
    }
}

struct Frame {
    data: Vec<u8>,
    kinds: Vec<&'static str>,
    lifetimes: Vec<SurfaceLifetime>,
}

fn render(document: Value, t: f64) -> Frame {
    let mut ir = ir_of(document);
    let mut engine = TextEngine::new();
    let renderer = FrameRenderer::new(&mut ir, &mut engine).unwrap();
    let planner = FramePlanner::cpu(&ir).unwrap();
    let plan = planner.plan(&renderer, &ir, &mut engine, t);
    plan.validate().unwrap();
    let kinds = plan.passes.iter().map(RenderPass::kind).collect();
    let lifetimes = plan.surfaces.iter().map(|s| s.lifetime).collect();
    let mut executor = CpuExecutor::new(CapabilityProfile::cpu_reference());
    let mut media = MediaStore::new(Arc::new(LoadedAssets::default()), ir.fps);
    let pixmap = execute_plan(&plan, &mut executor, &mut media, None).unwrap();
    Frame {
        data: pixmap.data().to_vec(),
        kinds,
        lifetimes,
    }
}

fn px(data: &[u8], x: u32, y: u32) -> [u8; 4] {
    let i = ((y * W + x) * 4) as usize;
    [data[i], data[i + 1], data[i + 2], data[i + 3]]
}

// ── 计划形状 ─────────────────────────────────────────────────────────

/// 一个 Surface Transition 剪辑点 = 两张离屏 surface + 一个 `Transition` pass，
/// 结果合成回累积画面。`bcut ops` 看到的就是这张图。
#[test]
fn a_surface_transition_grows_a_transition_pass() {
    let frame = render(doc(circle_crop()), T0);
    assert_eq!(
        frame.kinds,
        ["draw", "draw", "draw", "transition", "composite"],
        "计划形状：背景层 + 两侧 + 转场 + 合成"
    );
}

/// 窗口之外没有第二张画面，计划照旧**折叠成单个 Draw pass**——声明一条
/// Surface Transition 不该让整片都付离屏的钱。
#[test]
fn outside_the_window_the_plan_still_folds() {
    for t in [0.3, 0.5, 1.5, 1.8] {
        let frame = render(doc(circle_crop()), t);
        assert_eq!(frame.kinds, ["draw"], "t={t}");
    }
}

/// 两侧画面跨帧不变时声明成 `Static`（设计 §6.6：静态 surface 可跨帧留存）。
/// 判据保守——挂了动画的一侧退回 `PerFrame`。
#[test]
fn static_sides_are_declared_static() {
    let frame = render(doc(circle_crop()), T0);
    // 背景层 / 两侧 / 转场输出 / 合成输出。两侧是纯色板 ⇒ Static。
    assert_eq!(
        frame.lifetimes,
        [
            SurfaceLifetime::PerFrame,
            SurfaceLifetime::Static,
            SurfaceLifetime::Static,
            SurfaceLifetime::PerFrame,
            SurfaceLifetime::PerFrame,
        ]
    );

    // 给离场那块板挂一条动画，它那侧就不再是静态的。
    let mut animated = doc(circle_crop());
    animated["tracks"][0]["clips"][0]["element"]["animate"] =
        json!({"enter": {"preset": "fadeIn", "dur": 0.3}});
    let frame = render(animated, T0);
    assert_eq!(frame.lifetimes[1], SurfaceLifetime::PerFrame);
    assert_eq!(frame.lifetimes[2], SurfaceLifetime::Static);
}

// ── 像素语义 ─────────────────────────────────────────────────────────

/// 端点：窗口起点整幅是离场画面，终点整幅是入场画面。
/// 这是 `progress = 0 ⇒ from` / `= 1 ⇒ to` 在**整条链路**上的形态。
#[test]
fn the_window_endpoints_are_the_two_shots() {
    let start = render(doc(circle_crop()), T0 - DUR / 2.0);
    let end = render(doc(circle_crop()), T0 + DUR / 2.0);
    for x in (0..W).step_by(7) {
        for y in (0..H).step_by(11) {
            assert_eq!(px(&start.data, x, y), RED, "起点 ({x},{y})");
            assert_eq!(px(&end.data, x, y), BLUE, "终点 ({x},{y})");
        }
    }
}

/// 中点：圆心附近已经是入场画面，四角还是离场画面——圆**在张开**。
#[test]
fn the_circle_opens_from_the_centre() {
    let mid = render(doc(circle_crop()), T0);
    assert_eq!(px(&mid.data, W / 2, H / 2), BLUE, "圆心");
    assert_eq!(px(&mid.data, 1, 1), RED, "左上角");
    assert_eq!(px(&mid.data, W - 2, H - 2), RED, "右下角");
}

/// 整帧正好落在窗口终点时仍是转场的最后一帧（`progress = 1`），出镜画面不再露出。
/// 用实片里回闪的那组数：剪辑点 `2493/30` s、`dur` 0.8 s，终点是第 2505 帧；
/// 窗口终点曾按 `(t0 − half) + 2·half` 算成 `83.49999999999999`，比这一帧早一个 ulp，
/// 而出镜 clip 的渲染窗口到 `t0 + half = 83.5`，于是这一帧照常画出了出镜画面。
/// 入场画面只占左上一小块，别处透明，出镜画面多画一帧就会从右下角露出来。
#[test]
fn the_last_frame_of_the_window_does_not_flash_back() {
    let cut = 2493.0 / 30.0;
    let document = json!({
        "bcut": "0.2",
        "meta": {"id": "st", "width": W, "height": H, "fps": 30, "background": "#000000"},
        "scenes": [{"id": "a", "dur": cut}, {"id": "b", "dur": 1}],
        "tracks": [{"id": "main", "kind": "visual", "clips": [
            {"id": "a", "start": 0, "end": "@a.end",
             "transitionOut": {"preset": "transition.inkBlot", "presetVersion": 1, "dur": 0.8,
                               "params": {"seed": 5}},
             "element": plate("pa", "#ff3366")},
            {"id": "b", "start": "@b", "end": "@b.end",
             "element": {"type": "box", "id": "pb",
                         "style": {"width": 24, "height": 24, "background": "#2266ff"}}}
        ]}]
    });
    let end = render(document, 2505.0 / 30.0);
    assert_eq!(px(&end.data, 4, 4), BLUE, "入场画面");
    assert_eq!(
        px(&end.data, W - 2, H - 2),
        [0, 0, 0, 0xff],
        "终点帧露出了出镜画面"
    );
}

/// `params` 真的进了 uniform：把圆心挪到左上角，右下角最后才被吃掉。
#[test]
fn params_reach_the_effect_uniforms() {
    let mut spec = circle_crop();
    spec["params"] = json!({"cx": 0.0, "cy": 0.0});
    let mid = render(doc(spec), T0);
    assert_eq!(px(&mid.data, 1, 1), BLUE, "圆心已经在左上角");
    assert_eq!(px(&mid.data, W - 2, H - 2), RED, "对角最后才换");
}

/// 平坦路径（`FrameRenderer::record`，`bcut ops` 打印的那条流）画不出双输入
/// 合成，因此**降级**成剪辑点的 Motion fallback 而不是静默丢掉转场。
/// 缺省 fallback 是 `crossfade`：窗口起点仍然只剩离场画面。
#[test]
fn the_flat_path_degrades_to_the_motion_fallback() {
    let mut ir = ir_of(doc(circle_crop()));
    let mut engine = TextEngine::new();
    let renderer = FrameRenderer::new(&mut ir, &mut engine).unwrap();
    let mut media = MediaStore::new(Arc::new(LoadedAssets::default()), ir.fps);
    // 起点：crossfade 的 in 通道 opacity = 0 ⇒ 入场画面整块不出画。
    let start = renderer
        .draw(&ir, &mut engine, &mut media, T0 - DUR / 2.0)
        .unwrap();
    assert_eq!(px(start.data(), W / 2, H / 2), RED);
    // 中点：两张板叠着，颜色既不是纯红也不是纯蓝。
    let mid = renderer.draw(&ir, &mut engine, &mut media, T0).unwrap();
    let centre = px(mid.data(), W / 2, H / 2);
    assert_ne!(centre, RED);
    assert_ne!(centre, BLUE);
}

/// 声明的 `fallback` 必须是一条 Motion 配方——降级的落点是属性轨道，不可能是
/// 另一条同样跑不动的 Surface 效果。
#[test]
fn an_unknown_fallback_is_refused() {
    let mut spec = circle_crop();
    spec["fallback"] = json!("transition.wipe");
    let error = resolve_error(doc(spec));
    assert!(error.contains("transition-unknown"), "{error}");
}

/// 未知的 `transition.*` 名字与未知版本必须给出**不同**的诊断。
#[test]
fn unknown_names_and_unknown_versions_are_different_diagnostics() {
    let mut nope = circle_crop();
    nope["preset"] = json!("transition.nope");
    let error = resolve_error(doc(nope));
    assert!(error.contains("transition-unknown"), "{error}");

    let mut future = circle_crop();
    future["presetVersion"] = json!(9);
    let error = resolve_error(doc(future));
    assert!(error.contains("preset-version-unknown"), "{error}");
}

/// 参数校验走的是与 `effects[]` 同一条 manifest 路径。
#[test]
fn unknown_params_are_refused() {
    let mut spec = circle_crop();
    spec["params"] = json!({"radiuz": 1.0});
    let error = resolve_error(doc(spec));
    assert!(error.contains("preset-param-unknown"), "{error}");
}

/// 转场两侧是**单层**离屏画面：那两个 clip 的子树里不许再有效果栈，
/// preflight 直接拒绝而不是静默丢掉 `effects[]`。
#[test]
fn an_effect_stack_inside_a_transition_side_is_rendered() {
    let mut document = doc(circle_crop());
    document["tracks"][0]["clips"][1]["element"]["effects"] =
        json!([{"preset": "filter.blur", "params": {"radius": 0.02}}]);
    let frame = render(document, T0);
    assert!(frame.kinds.contains(&"filter"));
    assert!(frame.kinds.contains(&"transition"));
    assert_eq!(px(&frame.data, W / 2, H / 2), BLUE);
}

/// CPU reference 上四条内置转场都能跑：降级名单为空，`fallbacks[]` 里没有
/// 转场记录。
#[test]
fn the_cpu_reference_never_falls_back() {
    let ir = ir_of(doc(circle_crop()));
    let planner = FramePlanner::cpu(&ir).unwrap();
    assert!(planner.transition_fallbacks().is_empty());
    assert!(planner.report().is_ok());
    assert!(
        planner
            .report()
            .fallbacks
            .iter()
            .all(|record| !record.reason.starts_with("transition-fallback-applied"))
    );
}

/// 后端跑不动这条转场时**退回 Motion 通道**，而不是报错或画不出东西。
///
/// 内置的四条都是 strict 且有 CPU reference，因此这条路在 CPU 后端上永远不
/// 触发——测试把 IR 里的效果引用换成一个未注册的版本来走同一条判定。
#[test]
fn a_backend_that_cannot_run_the_effect_falls_back_to_motion() {
    let mut ir = ir_of(doc(circle_crop()));
    ir.surface_transitions[0].effect = motion::effect::EffectRef::new("transition.circleCrop", 9);

    let mut engine = TextEngine::new();
    let renderer = FrameRenderer::new(&mut ir, &mut engine).unwrap();
    let planner = FramePlanner::cpu(&ir).unwrap();

    // 降级名单按 `from_clip` 记；`fallbacks[]` 带出落点是哪条 Motion 配方。
    assert_eq!(
        planner.transition_fallbacks().iter().collect::<Vec<_>>(),
        ["a"]
    );
    let record = planner
        .report()
        .fallbacks
        .iter()
        .find(|record| record.reason.starts_with("transition-fallback-applied"))
        .expect("应当记一条转场降级");
    assert_eq!(record.applied_preset.as_deref(), Some("crossfade"));
    assert!(record.applied.is_none(), "转场的落点不是另一条效果");
    // 「有降级可用」不算硬错误：整片照常出片。
    assert!(planner.report().is_ok());

    // 计划里没有 Transition pass 了——它退成了两侧的属性轨道，因此折叠。
    let plan = planner.plan(&renderer, &ir, &mut engine, T0);
    assert_eq!(
        plan.passes.iter().map(RenderPass::kind).collect::<Vec<_>>(),
        ["draw"]
    );

    // crossfade 的窗口起点：入场画面 opacity = 0，整幅仍是离场画面。
    let mut media = MediaStore::new(Arc::new(LoadedAssets::default()), ir.fps);
    let mut executor = CpuExecutor::new(CapabilityProfile::cpu_reference());
    let start = planner.plan(&renderer, &ir, &mut engine, T0 - DUR / 2.0);
    let pixmap = execute_plan(&start, &mut executor, &mut media, None).unwrap();
    assert_eq!(px(pixmap.data(), W / 2, H / 2), RED);
}

// ── shatter / glitch（§9 实现状态）───────────────────────────────────

fn shatter(dur: f64, params: Value) -> Value {
    json!({"preset": "transition.shatter", "presetVersion": 1, "dur": dur, "params": params})
}

fn glitch(dur: f64, params: Value) -> Value {
    json!({"preset": "transition.glitch", "presetVersion": 1, "dur": dur, "params": params})
}

/// 两条新转场在整条链路上都守端点：窗口起点整幅离场、终点整幅入场，
/// 中间两种颜色都在，而且同一时刻重渲逐字节相同（可 seek）。
#[test]
fn shatter_and_glitch_keep_the_endpoints_and_are_seekable() {
    let dur = 0.8;
    for spec in [
        shatter(dur, json!({"seed": 7})),
        glitch(dur, json!({"seed": 3, "amount": 0.2})),
        glitch(dur, json!({"direction": "horizontal", "slices": 12})),
    ] {
        let name = spec["preset"].as_str().unwrap().to_string();
        let start = render(doc(spec.clone()), T0 - dur / 2.0);
        let end = render(doc(spec.clone()), T0 + dur / 2.0);
        for x in (0..W).step_by(9) {
            for y in (0..H).step_by(13) {
                assert_eq!(px(&start.data, x, y), RED, "{name} 起点 ({x},{y})");
                assert_eq!(px(&end.data, x, y), BLUE, "{name} 终点 ({x},{y})");
            }
        }
        let mid = render(doc(spec.clone()), T0 + 0.05);
        assert!(mid.kinds.contains(&"transition"), "{name}");
        let colors: std::collections::BTreeSet<[u8; 4]> = mid
            .data
            .chunks_exact(4)
            .map(|c| [c[0], c[1], c[2], c[3]])
            .collect();
        assert!(colors.contains(&BLUE), "{name} 中段应露出入场画面");
        assert!(colors.contains(&RED), "{name} 中段应还有离场画面");
        // 倒着 seek 回来：与第一次逐字节相同。
        let _ = render(doc(spec.clone()), T0 + dur / 2.0 - 0.01);
        assert_eq!(
            render(doc(spec), T0 + 0.05).data,
            mid.data,
            "{name} 可 seek"
        );
    }
}

/// shatter 的碎片由 seed 定形：换 seed 画面不同，同 seed 相同；
/// 爆心附近先碎，四角最后才起飞。
#[test]
fn shatter_is_shaped_by_its_seed_and_breaks_from_the_impact() {
    let dur = 1.0;
    let early = T0 - dur / 2.0 + 0.12 * dur;
    let a = render(doc(shatter(dur, json!({"seed": 1}))), early).data;
    let b = render(doc(shatter(dur, json!({"seed": 2}))), early).data;
    let a2 = render(doc(shatter(dur, json!({"seed": 1}))), early).data;
    assert_eq!(a, a2);
    assert_ne!(a, b);
    // p = 0.12：离爆心最远的角还没起飞（delay ≥ 0.3 × 近 1），仍是离场画面。
    assert_eq!(px(&a, 0, 0), RED);
    assert_eq!(px(&a, W - 1, H - 1), RED);
}

/// glitch 的外观由 seed 与方向决定：换 seed、换方向画面都不同，同参数相同。
#[test]
fn glitch_is_shaped_by_seed_and_direction() {
    let dur = 0.4;
    let mid = T0 + 0.02;
    let frame = |params: Value| render(doc(glitch(dur, params)), mid).data;
    let a = frame(json!({"seed": 1}));
    assert_eq!(a, frame(json!({"seed": 1})));
    assert_ne!(a, frame(json!({"seed": 2})));
    assert_ne!(a, frame(json!({"seed": 1, "direction": "horizontal"})));
}
