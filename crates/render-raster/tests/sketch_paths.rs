#![cfg(feature = "media")]

//! 手绘能力的渲染契约（规范 §6.2.1 / §6.3 / §7.10，设计稿
//! `bcut-hand-drawn-animation-design.md`）：
//!
//! - path：填充 → 纹理 → 描边的固定绘制顺序；`fillRule`、`lineCap/lineJoin`、`dash`；
//! - 纹理：无时间依赖、与采样顺序无关、跟随刚性变换；
//! - `clipPath {shape:"path"}` 与 `anchor: [x, y]`；
//! - `cadence` 采样域：绝对项目时间网格、逐级覆盖、媒体与字幕不量化。

use render_raster::drawop::{DrawOp, encode};
use render_raster::plan::{CapabilityProfile, CpuExecutor, FramePlanner, execute_plan};
use render_raster::{FrameRenderer, LoadedAssets, MediaStore, TextEngine};
use scene_primitives::resolve::{Ir, Resolver};
use serde_json::{Value, json};
use std::sync::Arc;

const W: u32 = 240;

fn doc(meta_extra: Value, element: Value) -> Value {
    let mut meta =
        json!({"id": "sk", "width": 240, "height": 160, "fps": 60, "background": "#ffffff"});
    for (k, v) in meta_extra.as_object().unwrap() {
        meta[k] = v.clone();
    }
    json!({
        "bcut": "0.1",
        "meta": meta,
        "scenes": [{"id": "s", "dur": 4}],
        "tracks": [{"id": "main", "kind": "visual", "clips": [
            {"id": "c", "start": 0, "end": "@s.end", "element": element}
        ]}]
    })
}

/// 240×160 的 svg，viewBox 同尺寸 ⇒ 路径坐标就是像素。
fn svg(paths: Vec<Value>) -> Value {
    json!({
        "type": "svg", "id": "art", "viewBox": "0 0 240 160",
        "style": {"width": 240, "height": 160},
        "children": paths
    })
}

fn ir_of(doc: Value) -> Ir {
    Resolver::new(doc, None).unwrap().resolve().unwrap()
}

struct Stage {
    ir: Ir,
    engine: TextEngine,
    renderer: FrameRenderer,
}

impl Stage {
    fn new(doc: Value) -> Stage {
        let mut ir = ir_of(doc);
        let mut engine = TextEngine::new();
        let renderer = FrameRenderer::new(&mut ir, &mut engine).unwrap();
        Stage {
            ir,
            engine,
            renderer,
        }
    }

    fn bytes(&mut self, t: f64) -> Vec<u8> {
        encode(&self.renderer.record(&self.ir, &mut self.engine, t))
    }

    fn ops(&mut self, t: f64) -> Vec<DrawOp> {
        self.renderer.record(&self.ir, &mut self.engine, t).ops
    }

    fn pixels(&mut self, t: f64) -> Vec<u8> {
        let planner = FramePlanner::cpu(&self.ir).unwrap();
        let plan = planner.plan(&self.renderer, &self.ir, &mut self.engine, t);
        plan.validate().unwrap();
        let mut executor = CpuExecutor::new(CapabilityProfile::cpu_reference());
        let mut media = MediaStore::new(Arc::new(LoadedAssets::default()), self.ir.fps);
        execute_plan(&plan, &mut executor, &mut media, None)
            .unwrap()
            .data()
            .to_vec()
    }
}

fn px(data: &[u8], x: u32, y: u32) -> [u8; 4] {
    let i = ((y * W + x) * 4) as usize;
    [data[i], data[i + 1], data[i + 2], data[i + 3]]
}

fn kind(op: &DrawOp) -> &'static str {
    match op {
        DrawOp::Clear { .. } => "clear",
        DrawOp::FillPath { .. } => "fill",
        DrawOp::FillPathPaint { .. } => "fillPaint",
        DrawOp::StrokePath { .. } => "stroke",
        DrawOp::StrokePathPaint { .. } => "strokePaint",
        DrawOp::ClipPath { .. } => "clip",
        DrawOp::PopClip => "popClip",
        _ => "other",
    }
}

fn kinds(ops: &[DrawOp]) -> Vec<&'static str> {
    ops.iter()
        .map(kind)
        .filter(|k| *k != "other" && *k != "clear")
        .collect()
}

const SQUARE: &str = "M40 30 L140 30 L140 130 L40 130 Z";

// ── 填充 / 描边 ───────────────────────────────────────────────────────

#[test]
fn stroke_only_path_still_records_the_v3_stroke_op() {
    let mut stage = Stage::new(doc(
        json!({}),
        svg(vec![
            json!({"type": "path", "d": "M20 20 L200 20", "stroke": "#000000", "strokeWidth": 4}),
        ]),
    ));
    assert_eq!(kinds(&stage.ops(0.0)), ["stroke"]);
}

#[test]
fn fill_only_fill_and_stroke_and_draw_order() {
    let mut fill_only = Stage::new(doc(
        json!({}),
        svg(vec![
            json!({"type": "path", "d": SQUARE, "fill": "#ff0000"}),
        ]),
    ));
    assert_eq!(kinds(&fill_only.ops(0.0)), ["fill"]);
    let data = fill_only.pixels(0.0);
    assert_eq!(px(&data, 90, 80), [255, 0, 0, 255]);
    assert_eq!(px(&data, 10, 10), [255, 255, 255, 255]);

    let mut both = Stage::new(doc(
        json!({}),
        svg(vec![json!({
            "type": "path", "d": SQUARE, "fill": "#ff0000",
            "texture": {"finish": "ink", "color": "#0000ff", "seed": 3},
            "stroke": "#000000", "strokeWidth": 6
        })]),
    ));
    // 填充 → 纹理（裁剪在形状内）→ 描边
    assert_eq!(
        kinds(&both.ops(0.0)),
        ["fill", "clip", "stroke", "popClip", "stroke"]
    );
    let data = both.pixels(0.0);
    assert_eq!(px(&data, 40, 80), [0, 0, 0, 255], "描边压在填充之上");
}

#[test]
fn path_draw_only_gates_the_stroke_not_the_fill() {
    let mut stage = Stage::new(doc(
        json!({}),
        svg(vec![json!({
            "type": "path", "d": SQUARE, "fill": "#00ff00", "stroke": "#000000", "strokeWidth": 4,
            "animate": {"keyframes": [{"prop": "pathDraw", "frames": [{"t": 0, "v": 0}, {"t": 2, "v": 1}]}]}
        })]),
    ));
    assert_eq!(kinds(&stage.ops(0.0)), ["fill"], "进度 0：只有填充");
    assert_eq!(kinds(&stage.ops(1.0)), ["fill", "stroke"]);
}

#[test]
fn z_closes_the_outline() {
    let mut stage = Stage::new(doc(
        json!({}),
        svg(vec![
            json!({"type": "path", "d": SQUARE, "stroke": "#000000", "strokeWidth": 6}),
        ]),
    ));
    let data = stage.pixels(0.0);
    // 左边（x=40）只有 Z 补回的那一段会经过
    assert_eq!(px(&data, 40, 80), [0, 0, 0, 255]);
}

#[test]
fn even_odd_punches_the_inner_ring() {
    let ring = "M20 20 L220 20 L220 140 L20 140 Z M80 50 L160 50 L160 110 L80 110 Z";
    let mut nonzero = Stage::new(doc(
        json!({}),
        svg(vec![json!({"type": "path", "d": ring, "fill": "#0000ff"})]),
    ));
    assert_eq!(px(&nonzero.pixels(0.0), 120, 80), [0, 0, 255, 255]);

    let mut even_odd = Stage::new(doc(
        json!({}),
        svg(vec![
            json!({"type": "path", "d": ring, "fill": "#0000ff", "fillRule": "evenodd"}),
        ]),
    ));
    assert_eq!(kinds(&even_odd.ops(0.0)), ["fillPaint"]);
    let data = even_odd.pixels(0.0);
    assert_eq!(px(&data, 120, 80), [255, 255, 255, 255], "内环被镂空");
    assert_eq!(px(&data, 40, 80), [0, 0, 255, 255]);
}

#[test]
fn dash_cuts_the_stroke_and_butt_caps_leave_clean_gaps() {
    let mut stage = Stage::new(doc(
        json!({}),
        svg(vec![json!({
            "type": "path", "d": "M20 80 L220 80", "stroke": "#000000", "strokeWidth": 8,
            "dash": [20, 20], "lineCap": "butt"
        })]),
    ));
    assert_eq!(kinds(&stage.ops(0.0)), ["strokePaint"]);
    let data = stage.pixels(0.0);
    assert_eq!(px(&data, 30, 80), [0, 0, 0, 255], "第一段实线 20..40");
    assert_eq!(px(&data, 50, 80), [255, 255, 255, 255], "第一段空白 40..60");
    assert_eq!(px(&data, 70, 80), [0, 0, 0, 255]);
}

#[test]
fn unknown_path_style_values_are_schema_errors() {
    for bad in [
        json!({"type": "path", "d": SQUARE, "fill": "#000", "fillRule": "winding"}),
        json!({"type": "path", "d": SQUARE, "stroke": "#000", "lineCap": "flat"}),
        json!({"type": "path", "d": SQUARE, "stroke": "#000", "dash": [4, -1]}),
        json!({"type": "path", "d": SQUARE, "fill": "#000", "texture": {"finish": "oil"}}),
        json!({"type": "path", "d": SQUARE, "fill": "#000", "texture": {"finish": "ink", "gapp": 3}}),
    ] {
        let error = Resolver::new(doc(json!({}), svg(vec![bad.clone()])), None)
            .and_then(|mut r| r.resolve())
            .err()
            .unwrap_or_else(|| panic!("应当报错：{bad}"));
        assert!(error.to_string().starts_with("schema:"), "{error}");
    }
}

// ── 纹理 ──────────────────────────────────────────────────────────────

fn textured(finish: &str) -> Value {
    doc(
        json!({"cadence": {"fps": 12}}),
        svg(vec![json!({
            "type": "path", "d": SQUARE, "fill": "#f4e9d0",
            "texture": {"finish": finish, "color": "#20304a", "seed": 11},
            "stroke": "#111111", "strokeWidth": 3
        })]),
    )
}

#[test]
fn static_textures_are_byte_identical_across_time_and_sampling_order() {
    for finish in ["ink", "pencil", "grain", "screen", "riso"] {
        let mut forward = Stage::new(textured(finish));
        let reference = forward.bytes(0.0);
        assert!(reference.len() > 64);
        for t in [0.01, 0.5, 1.37, 3.99] {
            assert_eq!(forward.bytes(t), reference, "{finish} @ {t}");
        }
        // 乱序、换一个渲染器实例（没有缓存可用）也一样
        let mut shuffled = Stage::new(textured(finish));
        for t in [3.2, 0.0, 2.5, 0.01] {
            assert_eq!(shuffled.bytes(t), reference, "{finish} 乱序 @ {t}");
        }
    }
}

#[test]
fn flat_finish_adds_nothing() {
    let mut stage = Stage::new(doc(
        json!({}),
        svg(vec![json!({
            "type": "path", "d": SQUARE, "fill": "#f4e9d0", "texture": {"finish": "flat"}
        })]),
    ));
    assert_eq!(kinds(&stage.ops(0.0)), ["fill"]);
}

#[test]
fn texture_geometry_rides_the_rigid_transform() {
    // 纹理在路径局部坐标里生成：节点平移 / 旋转只改 tf，侧表里的几何逐字节不变。
    let moving = |animate: Value| {
        doc(
            json!({}),
            json!({
                "type": "svg", "id": "art", "viewBox": "0 0 240 160",
                "style": {"width": 240, "height": 160},
                "animate": animate,
                "children": [{
                    "type": "path", "d": SQUARE, "fill": "#f4e9d0",
                    "texture": {"finish": "ink", "color": "#20304a", "seed": 5}
                }]
            }),
        )
    };
    let mut stage = Stage::new(moving(json!({"keyframes": [
        {"prop": "x", "frames": [{"t": 0, "v": 0}, {"t": 2, "v": 60}]},
        {"prop": "rotation", "frames": [{"t": 0, "v": 0}, {"t": 2, "v": 30}]}
    ]})));
    let a = stage.renderer.record(&stage.ir, &mut stage.engine, 0.0);
    let b = stage.renderer.record(&stage.ir, &mut stage.engine, 1.5);
    assert_eq!(a.paths, b.paths, "路径侧表（含纹理几何）不随变换变化");
    assert!(encode(&a) != encode(&b), "变换确实在动");
}

#[test]
fn background_texture_covers_the_canvas() {
    let plain = doc(json!({"background": "#fbf3e2"}), svg(vec![]));
    let mut plain = Stage::new(plain);
    assert!(kinds(&plain.ops(0.0)).is_empty());

    let mut paper = Stage::new(doc(
        json!({"background": {"color": "#fbf3e2", "texture": {"finish": "grain", "color": "#7a6a4f", "seed": 2}}}),
        svg(vec![]),
    ));
    assert_eq!(kinds(&paper.ops(0.0)), ["clip", "fill", "popClip"]);
    assert_eq!(paper.bytes(0.0), paper.bytes(2.75));
    let data = paper.pixels(0.0);
    let speckled = (0..160)
        .flat_map(|y| (0..W).map(move |x| (x, y)))
        .filter(|&(x, y)| px(&data, x, y) != [0xfb, 0xf3, 0xe2, 255])
        .count();
    assert!(speckled > 50, "纸面应当有颗粒（{speckled}）");
}

/// 背景纸的光栅缓存（`FrameOps::static_prefix`）：录制器只给有纹理的文档设提示；
/// 设了提示的帧无论首次（未命中、画完存一张）还是之后（命中、拷贝缓存）都与
/// 不设提示从头重放逐像素相同，纸面上的运动元素照常逐帧变化；分层计划同样一致。
#[test]
fn background_texture_raster_cache_is_pixel_exact() {
    let mover = json!({
        "type": "box", "id": "m",
        "style": {"width": 40, "height": 40, "background": "#c0392b"},
        "animate": {"keyframes": [{"prop": "x", "frames": [{"t": 0, "v": 0}, {"t": 4, "v": 190}]}]}
    });
    let mut plain = Stage::new(doc(json!({"background": "#fbf3e2"}), mover.clone()));
    assert!(
        plain
            .renderer
            .record(&plain.ir, &mut plain.engine, 0.0)
            .static_prefix
            .is_none()
    );

    // 种子取本测试独有的值：进程级缓存里不会有别的测试先放进同一张纸。
    let mut paper = Stage::new(doc(
        json!({"background": {"color": "#fbf3e2", "texture": {"finish": "grain", "color": "#7a6a4f", "seed": 4242}}}),
        mover,
    ));
    let mut reference = paper.renderer.record(&paper.ir, &mut paper.engine, 0.0);
    let hint = reference.static_prefix.expect("有纹理的文档应带前缀提示");
    assert!(
        matches!(reference.ops[0], DrawOp::Clear { .. }),
        "前缀从 Clear 开始"
    );
    assert!(
        matches!(reference.ops[hint.ops - 1], DrawOp::PopClip),
        "前缀止于纹理的 PopClip"
    );
    reference.static_prefix = None;
    let mut media = MediaStore::new(Arc::new(LoadedAssets::default()), paper.ir.fps);
    let expected = render_raster::raster::rasterize(&reference, W, 160, &mut media).unwrap();

    let mut frames = Vec::new();
    for t in [0.0, 0.0, 1.5, 3.0] {
        let frame = paper.renderer.record(&paper.ir, &mut paper.engine, t);
        assert_eq!(frame.static_prefix, Some(hint), "提示与时间无关");
        let cached = render_raster::raster::rasterize(&frame, W, 160, &mut media).unwrap();
        let mut uncached = frame;
        uncached.static_prefix = None;
        let replay = render_raster::raster::rasterize(&uncached, W, 160, &mut media).unwrap();
        assert!(
            cached.data() == replay.data(),
            "t={t}：缓存与重放逐像素相同"
        );
        assert!(
            paper.pixels(t) == cached.data(),
            "t={t}：分层计划与平坦光栅一致"
        );
        frames.push(cached);
    }
    assert!(frames[0].data() == expected.data() && frames[1].data() == expected.data());
    assert!(
        frames[2].data() != frames[3].data(),
        "纸面上的元素仍逐帧移动"
    );
}

// ── clipPath path 形状 / anchor 数组 ──────────────────────────────────

#[test]
fn clip_path_shape_path_clips_to_the_polygon() {
    let mut stage = Stage::new(doc(
        json!({}),
        json!({
            "type": "box", "id": "b",
            "style": {
                "width": 200, "height": 100, "background": "#ff0000",
                // 左上三角
                "clipPath": {"shape": "path", "d": "M0 0 L1 0 L0 1 Z"}
            }
        }),
    ));
    let data = stage.pixels(0.0);
    assert_eq!(px(&data, 20, 10), [255, 0, 0, 255]);
    assert_eq!(px(&data, 190, 90), [255, 255, 255, 255], "右下角被裁掉");
}

#[test]
fn clip_path_shape_path_is_static_only() {
    // 通道取值在 lint 拦（录制期没有 `Result`）
    let diagnostics = scene_primitives::lint::lint(&doc(
        json!({}),
        json!({
            "type": "box", "id": "b", "style": {"width": 100, "height": 100},
            "animate": {"keyframes": [{"prop": "clipPath", "frames": [
                {"t": 0, "v": {"shape": "path", "d": "M0 0 L1 0 L0 1 Z"}},
                {"t": 1, "v": {"shape": "path", "d": "M0 0 L1 1 L0 1 Z"}}
            ]}]}
        }),
    ));
    assert!(
        diagnostics.iter().any(|d| d.message.contains("静态")),
        "{:?}",
        diagnostics.iter().map(|d| &d.message).collect::<Vec<_>>()
    );
}

#[test]
fn numeric_anchor_is_a_box_fraction_and_matches_the_named_anchors() {
    let bar = |anchor: Value| {
        doc(
            json!({}),
            json!({
                "type": "box", "id": "bar",
                "style": {
                    "width": 100, "height": 20, "background": "#000000",
                    "anchor": anchor, "rotation": 90
                }
            }),
        )
    };
    let bytes = |anchor: Value| Stage::new(bar(anchor)).bytes(0.0);
    assert_eq!(bytes(json!([0.5, 1.0])), bytes(json!("bottom")));
    assert_eq!(bytes(json!([0.5, 0.0])), bytes(json!("top")));
    assert_eq!(bytes(json!([0.5, 0.5])), bytes(json!("center")));
    assert!(
        bytes(json!([0.0, 0.5])) != bytes(json!("center")),
        "关节在左端"
    );

    let error = Resolver::new(bar(json!([0.5])), None)
        .and_then(|mut r| r.resolve())
        .err()
        .expect("anchor 数组必须是两项");
    assert!(error.to_string().starts_with("schema:"), "{error}");
}

// ── cadence ───────────────────────────────────────────────────────────

fn slider(meta: Value, clip_extra: Value, node_extra: Value) -> Value {
    let mut node = json!({
        "type": "box", "id": "dot",
        "style": {"position": "absolute", "left": 0, "top": 0, "width": 10, "height": 10, "background": "#000000"},
        "animate": {"keyframes": [{"prop": "x", "frames": [{"t": 0, "v": 0}, {"t": 4, "v": 200}]}]}
    });
    for (k, v) in node_extra.as_object().unwrap() {
        node[k] = v.clone();
    }
    let mut document = doc(
        meta,
        json!({"type": "box", "id": "root", "style": {"width": 240, "height": 160}, "children": [node]}),
    );
    for (k, v) in clip_extra.as_object().unwrap() {
        document["tracks"][0]["clips"][0][k] = v.clone();
    }
    document
}

#[test]
fn cadence_holds_frames_on_the_absolute_project_grid() {
    let mut stage = Stage::new(slider(
        json!({"cadence": {"fps": 12}}),
        json!({}),
        json!({}),
    ));
    let hold = stage.bytes(1.0);
    // 1.0 与 1.0 + 1/12 之间的所有 60fps 输出帧都等于格点帧
    for k in 1..5 {
        assert_eq!(stage.bytes(1.0 + f64::from(k) / 60.0), hold, "k={k}");
    }
    assert!(stage.bytes(1.0 + 5.0 / 60.0) != hold, "下一个绘制帧");

    // 与输出帧率无关：24 / 30 / 60fps 的时间戳落在同一格 ⇒ 同一帧
    for fps in [24.0, 30.0, 60.0] {
        for n in 0..(4.0 * fps) as u32 {
            let t = f64::from(n) / fps;
            let grid = ((t * 12.0) + 1e-9).floor() / 12.0;
            assert_eq!(stage.bytes(t), stage.bytes(grid), "fps={fps} n={n}");
        }
    }

    // 乱序采样：新实例、倒着取，结果一样
    let mut other = Stage::new(slider(
        json!({"cadence": {"fps": 12}}),
        json!({}),
        json!({}),
    ));
    for t in [3.3, 0.2, 2.71, 1.0] {
        assert_eq!(other.bytes(t), stage.bytes(t));
    }
}

#[test]
fn cadence_overrides_cascade_meta_clip_node() {
    let smooth = |stage: &mut Stage| stage.bytes(1.0) != stage.bytes(1.0 + 1.0 / 60.0);

    let mut none = Stage::new(slider(json!({}), json!({}), json!({})));
    assert!(smooth(&mut none), "没有 cadence：逐帧都在动");

    let mut meta = Stage::new(slider(
        json!({"cadence": {"fps": 12}}),
        json!({}),
        json!({}),
    ));
    assert!(!smooth(&mut meta));

    let mut clip_off = Stage::new(slider(
        json!({"cadence": {"fps": 12}}),
        json!({"cadence": "none"}),
        json!({}),
    ));
    assert!(smooth(&mut clip_off), "clip 级 none 退出域");

    let mut node_on = Stage::new(slider(json!({}), json!({}), json!({"cadence": {"fps": 8}})));
    assert!(!smooth(&mut node_on), "节点级进入域");
    assert!(node_on.bytes(1.0) != node_on.bytes(1.0 + 1.0 / 8.0));

    let mut node_off = Stage::new(slider(
        json!({"cadence": {"fps": 12}}),
        json!({}),
        json!({"cadence": "none"}),
    ));
    assert!(smooth(&mut node_off), "节点级 none 退出域");
}

#[test]
fn cadence_never_samples_before_the_clip_starts() {
    // clip 起点 0.30 不在 12fps 格上（格点 0.25 / 0.333）：首帧按 clip 起点采样，
    // 而不是回到 0.25——那时 clip 还不存在。
    let mut document = slider(
        json!({"cadence": {"fps": 12}}),
        json!({"start": 0.30}),
        json!({}),
    );
    document["tracks"][0]["clips"][0]["element"]["children"][0]["animate"] = json!({
        "keyframes": [{"prop": "x", "frames": [{"t": 0, "v": 100}, {"t": 3.7, "v": 200}]}]
    });
    let mut stage = Stage::new(document);
    assert_eq!(stage.bytes(0.30), stage.bytes(0.32));
    assert!(stage.bytes(0.32) != stage.bytes(0.34), "0.333 起进入下一格");
}

#[test]
fn boil_reseeds_on_draw_frames_and_static_wobble_does_not() {
    let wobbly = |every: u32| {
        doc(
            json!({"cadence": {"fps": 12}}),
            svg(vec![json!({
                "type": "path", "d": SQUARE, "stroke": "#000000", "strokeWidth": 3,
                "wobble": {"amp": 3, "seed": 9, "every": every}
            })]),
        )
    };
    let mut still = Stage::new(wobbly(0));
    assert_eq!(still.bytes(0.0), still.bytes(3.0));

    let mut boil = Stage::new(wobbly(2));
    // every=2 ⇒ 每 2 个绘制帧（1/6s）换一次
    assert_eq!(boil.bytes(1.0), boil.bytes(1.0 + 1.0 / 12.0 + 0.01));
    assert!(boil.bytes(1.0) != boil.bytes(1.0 + 2.0 / 12.0 + 0.01));
    // 纯函数：回到同一时刻得到同一帧
    let again = boil.bytes(1.0);
    boil.bytes(2.5);
    assert_eq!(boil.bytes(1.0), again);
}
