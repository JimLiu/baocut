//! `media` 门内：本文件用 `LoadedAssets` / `MediaStore` / `FrameRenderer`
//! （BCF 文档渲染链路与 host 字节层），`wasm-safe` 构建里不存在（设计 §9.1）。
#![cfg(feature = "media")]

//! 转场（规范 §9，设计 §6.4）。
//!
//! 本文件只管 **Motion Transition**：双方 clip 的属性轨道，不起离屏 surface。
//! 因此每一条都必须保持「计划折叠成单个 Draw pass」——转场不是效果栈。
//! Surface Transition 的 `Transition` pass 见 `surface_transitions.rs`。

use render_raster::plan::FramePlanner;
use render_raster::{FrameRenderer, LoadedAssets, MediaStore, TextEngine};
use scene_primitives::resolve::{Ir, Resolver};
use serde_json::{Value, json};
use std::sync::Arc;

const W: u32 = 240;
const H: u32 = 160;
/// 剪辑点。窗口是对称的 `[t0 - dur/2, t0 + dur/2]` = `[0.8, 1.2]`。
const T0: f64 = 1.0;
const DUR: f64 = 0.4;

const RED: [u8; 4] = [0xff, 0x33, 0x66, 0xff];
const BLUE: [u8; 4] = [0x22, 0x66, 0xff, 0xff];

fn doc(preset: &str) -> Value {
    let plate = |id: &str, color: &str| {
        json!({"type": "box", "id": id,
               "style": {"width": W, "height": H, "background": color}})
    };
    json!({
        "bcut": "0.2",
        "meta": {"id": "tr", "width": W, "height": H, "fps": 30, "background": "#000000"},
        "scenes": [{"id": "a", "dur": 1}, {"id": "b", "dur": 1}],
        "tracks": [{"id": "main", "kind": "visual", "clips": [
            {"id": "a", "start": 0, "end": "@a.end",
             "transitionOut": {"preset": preset, "dur": DUR},
             "element": plate("pa", "#ff3366")},
            {"id": "b", "start": "@b", "end": "@b.end",
             "element": plate("pb", "#2266ff")}
        ]}]
    })
}

fn ir_of(document: Value) -> Ir {
    Resolver::new(document, None).unwrap().resolve().unwrap()
}

/// 渲染一刻，同时把 pass 数带出来——Motion Transition 必须恒为 1。
fn render(preset: &str, t: f64) -> (Vec<u8>, usize) {
    let mut ir = ir_of(doc(preset));
    let mut engine = TextEngine::new();
    let renderer = FrameRenderer::new(&mut ir, &mut engine).unwrap();
    let planner = FramePlanner::cpu(&ir).unwrap();
    let plan = planner.plan(&renderer, &ir, &mut engine, t);
    plan.validate().unwrap();
    let mut executor = render_raster::plan::CpuExecutor::default();
    let mut media = MediaStore::new(Arc::new(LoadedAssets::default()), ir.fps);
    let pixmap = render_raster::plan::execute_plan(&plan, &mut executor, &mut media, None).unwrap();
    (pixmap.data().to_vec(), plan.passes.len())
}

fn px(data: &[u8], x: u32, y: u32) -> [u8; 4] {
    let i = ((y * W + x) * 4) as usize;
    [data[i], data[i + 1], data[i + 2], data[i + 3]]
}

fn uniform(data: &[u8], expected: [u8; 4]) -> bool {
    (0..W)
        .step_by(7)
        .all(|x| (0..H).step_by(11).all(|y| px(data, x, y) == expected))
}

/// 规范 §9 附录 B 的十个词。阶段 5 之前后四个在 resolve 期就报
/// `transition-unknown`。
const VOCABULARY: &[&str] = &[
    "cut",
    "crossfade",
    "slideLeft",
    "slideRight",
    "slideUp",
    "slideDown",
    "wipeLeft",
    "wipeRight",
    "zoomThrough",
    "whipPan",
];

/// 窗口两端是**干净**的单画面：`t0 - dur/2` 只剩离场画面，`t0 + dur/2` 只剩
/// 入场画面。`cut` 例外——它不产通道，交叠期两张画面直接叠着（这就是 `cut`
/// 的定义，不是缺陷）。
#[test]
fn every_motion_transition_starts_at_from_and_ends_at_to() {
    for preset in VOCABULARY {
        if *preset == "cut" {
            continue;
        }
        let (start, _) = render(preset, T0 - DUR / 2.0);
        assert!(uniform(&start, RED), "{preset}: 窗口起点应当只有离场画面");
        let (end, _) = render(preset, T0 + DUR / 2.0);
        assert!(uniform(&end, BLUE), "{preset}: 窗口终点应当只有入场画面");
    }
}

/// Motion Transition 是属性轨道，**一个 pass 都不多**。
#[test]
fn motion_transitions_stay_in_one_draw_pass() {
    for preset in VOCABULARY {
        for t in [0.5, 0.8, 0.9, 1.0, 1.1, 1.2, 1.5] {
            let (_, passes) = render(preset, t);
            assert_eq!(passes, 1, "{preset} @ {t}");
        }
    }
}

/// 窗口中点必须与两端都不同——「配方存在但什么都没动」会在这里红。
#[test]
fn every_motion_transition_actually_moves_at_the_midpoint() {
    for preset in VOCABULARY {
        if *preset == "cut" {
            continue;
        }
        let (mid, _) = render(preset, T0);
        assert!(!uniform(&mid, RED), "{preset}: 中点仍是纯离场画面");
        assert!(!uniform(&mid, BLUE), "{preset}: 中点已经是纯入场画面");
    }
}

/// `wipeLeft` 的擦除边在 `x = (1 - p)·W`，`wipeRight` 在 `x = p·W`——中点各是
/// 画布正中，两侧硬边、无羽化，且**画面本身不移动**（这正是 wipe 与 slide 的
/// 区别：slide 在同一时刻两张画面都偏了半屏）。
#[test]
fn the_wipe_edge_sweeps_the_declared_direction() {
    let (left, _) = render("wipeLeft", T0);
    for y in (0..H).step_by(11) {
        assert_eq!(px(&left, 60, y), RED, "wipeLeft: 边左侧应是离场画面");
        assert_eq!(px(&left, 180, y), BLUE, "wipeLeft: 边右侧应是入场画面");
        // 硬边：边两侧相邻像素直接换色，中间没有混色。
        assert_eq!(px(&left, 119, y), RED);
        assert_eq!(px(&left, 120, y), BLUE);
    }

    let (right, _) = render("wipeRight", T0);
    for y in (0..H).step_by(11) {
        assert_eq!(px(&right, 60, y), BLUE, "wipeRight: 边左侧应是入场画面");
        assert_eq!(px(&right, 180, y), RED, "wipeRight: 边右侧应是离场画面");
        assert_eq!(px(&right, 119, y), BLUE);
        assert_eq!(px(&right, 120, y), RED);
    }
}

/// `zoomThrough` 以**画布中心**为锚点：入场画面在中点缩到 0.9375×，因此四角
/// 露出背景（黑），而正中仍是画面。缩放锚点错成元素左上角时这条会红。
#[test]
fn zoom_through_scales_about_the_canvas_centre() {
    let (mid, _) = render("zoomThrough", T0);
    // 0.9375× 的入场板在 240×160 上留出左右各 7.5px、上下各 5px 的空隙；
    // 离场板是 1.1875×，只覆盖到画布之外，因此角上剩下的是它。
    assert_ne!(px(&mid, 0, 0), [0, 0, 0, 255], "角上不该是纯背景");
    // 正中两张板都盖得到，合成后既不是纯红也不是纯蓝。
    let centre = px(&mid, W / 2, H / 2);
    assert_ne!(centre, RED);
    assert_ne!(centre, BLUE);
}

/// `whipPan` 的两张画面**朝相反方向**走：中点时离场画面已经偏左、入场画面
/// 还在右边。同向就成了两张叠着平移的画面（发布前踩过的坑）。
#[test]
fn whip_pan_moves_the_two_shots_in_opposite_directions() {
    let (mid, _) = render("whipPan", T0);
    // 出方 x = easeInQuart(0.5) · (-1.2·W) = -18，覆盖 [-18, 222)；
    // 入方 x = +18，覆盖 [18, 258)。因此最右 18px 只有入场画面、最左 18px
    // 只有离场画面。两侧还各带 0.9375 的甩程透明度，所以比的是色相不是等值。
    let right = px(&mid, W - 4, H / 2);
    assert!(
        right[2] > right[0],
        "右缘应当是入场画面（偏蓝），实为 {right:?}"
    );
    let left = px(&mid, 4, H / 2);
    assert!(
        left[0] > left[2],
        "左缘应当是离场画面（偏红），实为 {left:?}"
    );
}
