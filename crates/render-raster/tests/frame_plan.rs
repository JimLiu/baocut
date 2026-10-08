//! `media` 门内：本文件用 `LoadedAssets` / `MediaStore` / `FrameRenderer`
//! （BCF 文档渲染链路与 host 字节层），`wasm-safe` 构建里不存在（设计 §9.1）。
#![cfg(feature = "media")]

//! `FramePlan` 的结构、折叠保证与分层指纹（设计 §6.1 / §6.6）。

use motion::effect::{BlendMode, EffectRef, UniformMap, UniformValue};
use render_raster::drawop::{self, DrawOp, FrameOps, PathData, PathSeg};
use render_raster::plan::{
    CapabilityProfile, CompositeInput, CpuExecutor, FRAME_PLAN_VERSION, FramePlan, FramePlanner,
    RenderPass, SurfaceCache, SurfaceId, SurfacePlan, encode_plan, execute_plan,
};
use render_raster::{FrameRenderer, LoadedAssets, MediaStore, TextEngine};
use scene_primitives::HostInputs;
use scene_primitives::resolve::{Ir, Resolver};
use serde_json::{Value, json};
use std::sync::Arc;

const IDENTITY: [f32; 6] = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];

fn empty_media() -> MediaStore {
    MediaStore::new(Arc::new(LoadedAssets::default()), 30.0)
}

fn caps() -> CapabilityProfile {
    CapabilityProfile::cpu_reference()
}

fn sample_ops() -> FrameOps {
    FrameOps {
        static_prefix: None,
        strings: vec![],
        bitmaps: Vec::new(),
        paints: Vec::new(),
        paths: vec![PathData(vec![
            PathSeg {
                verb: 0,
                pts: [2.0, 2.0, 0.0, 0.0, 0.0, 0.0],
            },
            PathSeg {
                verb: 1,
                pts: [10.0, 2.0, 0.0, 0.0, 0.0, 0.0],
            },
            PathSeg {
                verb: 1,
                pts: [10.0, 10.0, 0.0, 0.0, 0.0, 0.0],
            },
            PathSeg {
                verb: 4,
                pts: [0.0; 6],
            },
        ])],
        ops: vec![
            DrawOp::Clear {
                color: [0.0, 0.0, 0.0, 0.0],
            },
            DrawOp::FillPath {
                path: 0,
                color: [1.0, 0.25, 0.5, 1.0],
                tf: IDENTITY,
            },
        ],
    }
}

// ── 折叠保证 ─────────────────────────────────────────────────────────

#[test]
fn single_draw_plan_is_folded_and_validates() {
    let plan = FramePlan::single_draw(16, 16, sample_ops(), caps().fingerprint());
    assert_eq!(plan.version, FRAME_PLAN_VERSION);
    assert!(plan.is_folded());
    plan.validate().unwrap();
    assert_eq!(plan.surfaces.len(), 1);
    assert_eq!(plan.passes.len(), 1);
    assert_eq!(plan.passes[0].output(), plan.output);
}

/// 折叠计划的执行结果必须与「直接光栅化同一条指令流」逐字节相同——
/// 这是「引入 Render Graph 不改任何像素」的构造性证据。
#[test]
fn folded_plan_execution_matches_direct_rasterization() {
    let direct = render_raster::rasterize_with_media(&sample_ops(), 32, 24, &mut empty_media())
        .unwrap()
        .take();
    let plan = FramePlan::single_draw(32, 24, sample_ops(), caps().fingerprint());
    let mut executor = CpuExecutor::new(caps());
    let planned = execute_plan(&plan, &mut executor, &mut empty_media(), None)
        .unwrap()
        .take();
    assert_eq!(direct, planned);
}

#[test]
fn executor_rejects_a_plan_compiled_for_another_backend() {
    let plan = FramePlan::single_draw(8, 8, sample_ops(), 0xdead_beef);
    let mut executor = CpuExecutor::new(caps());
    let error = execute_plan(&plan, &mut executor, &mut empty_media(), None).unwrap_err();
    assert!(
        error.to_string().contains("frameplan-capability-mismatch"),
        "{error}"
    );
}

// ── 结构断言：真实文档每个采样时刻都折叠成单个 Draw pass ──────────────

struct FixedMeasure;

impl scene_primitives::layout::TextMeasure for FixedMeasure {
    fn measure(
        &mut self,
        text: &str,
        _family: &str,
        size: f64,
        _w: u16,
    ) -> scene_primitives::layout::TextMetricsLine {
        scene_primitives::layout::TextMetricsLine {
            width: text.chars().count() as f64 * size * 0.6,
            ascent: size * 0.8,
            descent: size * 0.2,
        }
    }
}

fn media_demo_ir() -> Ir {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/media-demo.bcut.json"
    );
    let doc: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let mut inputs = HostInputs::default();
    inputs.insert_image("card", 640.0, 360.0);
    inputs.insert_image("logo", 128.0, 128.0);
    inputs.insert_video("clip", 1280.0, 720.0, 12.0, 24.0);
    inputs.insert_audio("tone", 30.0);
    let mut resolver = Resolver::new(doc, None).unwrap();
    resolver.set_host_inputs(inputs);
    // 布局由 `FrameRenderer::new` 用真实字体引擎做，`FixedMeasure` 只在
    // 需要脱离系统字体时用得上（这里不需要）。
    let _ = std::marker::PhantomData::<FixedMeasure>;
    resolver.resolve().unwrap()
}

fn launch_ir() -> Ir {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/launch-golden/launch.bcut.json"
    );
    let text = std::fs::read_to_string(path).expect("读取 golden JSON");
    let doc: Value = serde_json::from_str(&text).unwrap();
    Resolver::new(doc, None).unwrap().resolve().unwrap()
}

fn assert_every_frame_folds(ir: &mut Ir, times: &[f64], label: &str) {
    let mut engine = TextEngine::new();
    let renderer = FrameRenderer::new(ir, &mut engine).unwrap();
    let planner = FramePlanner::cpu(ir).unwrap();
    assert!(
        planner.topology().is_empty(),
        "{label}: 没有 effect 的文档不该产生离屏 surface 拓扑"
    );
    let mut fingerprints = Vec::new();
    for t in times {
        let plan = planner.plan(&renderer, ir, &mut engine, *t);
        assert_eq!(plan.passes.len(), 1, "{label} @ {t}: 应当只有一个 pass");
        assert!(
            matches!(&plan.passes[0], RenderPass::Draw { target, .. } if *target == plan.output),
            "{label} @ {t}: 唯一的 pass 必须是写输出 surface 的 Draw"
        );
        assert!(plan.is_folded(), "{label} @ {t}");
        plan.validate().unwrap();
        fingerprints.push(plan.frame_fingerprint().unwrap());
    }
    assert!(
        fingerprints.iter().any(|fp| *fp != fingerprints[0]),
        "{label}: 采样时刻里应当至少有两帧不同"
    );
}

#[test]
fn media_demo_folds_to_a_single_draw_pass_at_every_sampled_time() {
    let mut ir = media_demo_ir();
    let times = [0.0, 0.4, 1.0, 1.7, 2.5, 3.4, 4.2, 5.0];
    assert_every_frame_folds(&mut ir, &times, "media-demo");
}

#[test]
fn launch_folds_to_a_single_draw_pass_at_every_sampled_time() {
    let mut ir = launch_ir();
    let times = [0.7, 2.9, 4.0, 7.8, 9.5, 13.6, 16.1, 19.8];
    assert_every_frame_folds(&mut ir, &times, "launch");
}

/// 帧指纹（输出 surface 内容指纹）与 DrawOp 原语指纹必须**一一对应**：
/// 同一张画布上，指令流相同 ⇔ 帧指纹相同。
#[test]
fn frame_fingerprint_is_in_bijection_with_the_drawop_fingerprint() {
    let mut ir = media_demo_ir();
    let mut engine = TextEngine::new();
    let renderer = FrameRenderer::new(&mut ir, &mut engine).unwrap();
    let planner = FramePlanner::cpu(&ir).unwrap();
    let mut pairs = Vec::new();
    for step in 0..40 {
        let t = f64::from(step) * 0.15;
        let ops = renderer.record(&ir, &mut engine, t);
        let primitive = drawop::fingerprint(&ops);
        let plan = planner.plan_from_ops(renderer.width, renderer.height, ops);
        pairs.push((primitive, plan.frame_fingerprint().unwrap()));
    }
    for (left_primitive, left_frame) in &pairs {
        for (right_primitive, right_frame) in &pairs {
            assert_eq!(
                left_primitive == right_primitive,
                left_frame == right_frame,
                "DrawOp 指纹与帧指纹的相等关系必须一致"
            );
        }
    }
}

// ── 指纹与编码 ───────────────────────────────────────────────────────

#[test]
fn plan_encoding_is_deterministic_and_normalizes_negative_zero() {
    let make = |zero: f32| {
        let mut plan = FramePlan::single_draw(8, 8, sample_ops(), 7);
        plan.surfaces[0].clear = Some([zero, 0.0, 0.0, 1.0]);
        plan.passes.push(RenderPass::Composite {
            inputs: vec![CompositeInput {
                surface: SurfaceId::OUTPUT,
                blend: BlendMode::Screen,
                opacity: zero,
                mask: None,
            }],
            output: SurfaceId(1),
        });
        plan.surfaces.push(SurfacePlan::canvas(SurfaceId(1), 8, 8));
        plan.output = SurfaceId(1);
        plan
    };
    assert_eq!(encode_plan(&make(-0.0)), encode_plan(&make(0.0)));
    assert_eq!(encode_plan(&make(0.0)), encode_plan(&make(0.0)));
}

#[test]
fn uniform_map_encodes_in_key_order_regardless_of_insertion_order() {
    let forward = UniformMap::new()
        .with("alpha", UniformValue::Scalar(0.5))
        .with("radius", UniformValue::Scalar(4.0));
    let backward = UniformMap::new()
        .with("radius", UniformValue::Scalar(4.0))
        .with("alpha", UniformValue::Scalar(0.5));
    let plan_of = |uniforms: UniformMap| {
        let mut plan = FramePlan::single_draw(8, 8, sample_ops(), 7);
        plan.surfaces.push(SurfacePlan::canvas(SurfaceId(1), 8, 8));
        plan.passes.push(RenderPass::Filter {
            input: SurfaceId::OUTPUT,
            output: SurfaceId(1),
            effect: EffectRef::new("filter.blur", 1),
            uniforms,
        });
        plan.output = SurfaceId(1);
        plan
    };
    assert_eq!(
        encode_plan(&plan_of(forward)),
        encode_plan(&plan_of(backward))
    );
}

#[test]
fn capability_profile_enters_the_frame_fingerprint() {
    let a = FramePlan::single_draw(8, 8, sample_ops(), 1);
    let b = FramePlan::single_draw(8, 8, sample_ops(), 2);
    assert_ne!(
        a.frame_fingerprint().unwrap(),
        b.frame_fingerprint().unwrap()
    );
    assert_ne!(a.plan_fingerprint(), b.plan_fingerprint());
}

#[test]
fn surface_fingerprint_depends_on_the_whole_upstream_chain() {
    let build = |color: [f32; 4]| {
        let mut ops = sample_ops();
        ops.ops[1] = DrawOp::FillPath {
            path: 0,
            color,
            tf: IDENTITY,
        };
        let mut plan = FramePlan::single_draw(8, 8, ops, 7);
        plan.surfaces.push(SurfacePlan::canvas(SurfaceId(1), 8, 8));
        plan.passes.push(RenderPass::Filter {
            input: SurfaceId::OUTPUT,
            output: SurfaceId(1),
            effect: EffectRef::new("filter.blur", 1),
            uniforms: UniformMap::new().with("radius", UniformValue::Scalar(3.0)),
        });
        plan.output = SurfaceId(1);
        plan
    };
    let a = build([1.0, 0.0, 0.0, 1.0]);
    let b = build([0.0, 1.0, 0.0, 1.0]);
    // 上游 Draw 换了颜色 ⇒ 下游 Filter 的 surface 指纹必须跟着变。
    assert_ne!(
        a.surface_fingerprint(SurfaceId::OUTPUT).unwrap(),
        b.surface_fingerprint(SurfaceId::OUTPUT).unwrap()
    );
    assert_ne!(
        a.frame_fingerprint().unwrap(),
        b.frame_fingerprint().unwrap()
    );
    // 同一张计划两次求值必须逐位相同。
    assert_eq!(
        a.frame_fingerprint().unwrap(),
        a.frame_fingerprint().unwrap()
    );
}

#[test]
fn effect_version_changes_the_surface_fingerprint() {
    let build = |version: u32| {
        let mut plan = FramePlan::single_draw(8, 8, sample_ops(), 7);
        plan.surfaces.push(SurfacePlan::canvas(SurfaceId(1), 8, 8));
        plan.passes.push(RenderPass::Filter {
            input: SurfaceId::OUTPUT,
            output: SurfaceId(1),
            effect: EffectRef::new("filter.blur", version),
            uniforms: UniformMap::new(),
        });
        plan.output = SurfaceId(1);
        plan
    };
    assert_ne!(
        build(1).frame_fingerprint().unwrap(),
        build(2).frame_fingerprint().unwrap()
    );
}

// ── validate ────────────────────────────────────────────────────────

#[test]
fn validate_rejects_unordered_surfaces_unknown_ids_and_forward_reads() {
    let mut plan = FramePlan::single_draw(8, 8, sample_ops(), 7);
    plan.surfaces
        .push(SurfacePlan::canvas(SurfaceId::OUTPUT, 8, 8));
    assert!(
        plan.validate()
            .unwrap_err()
            .to_string()
            .contains("frameplan-surface-order")
    );

    let mut plan = FramePlan::single_draw(8, 8, sample_ops(), 7);
    plan.output = SurfaceId(9);
    assert!(
        plan.validate()
            .unwrap_err()
            .to_string()
            .contains("frameplan-output-unknown")
    );

    let mut plan = FramePlan::single_draw(8, 8, sample_ops(), 7);
    plan.surfaces.push(SurfacePlan::canvas(SurfaceId(1), 8, 8));
    plan.passes.insert(
        0,
        RenderPass::Filter {
            input: SurfaceId::OUTPUT,
            output: SurfaceId(1),
            effect: EffectRef::new("filter.blur", 1),
            uniforms: UniformMap::new(),
        },
    );
    assert!(
        plan.validate()
            .unwrap_err()
            .to_string()
            .contains("frameplan-pass-order")
    );
}

// ── Composite / SurfaceCache ────────────────────────────────────────

#[test]
fn composite_pass_blends_two_surfaces_and_reuses_cached_inputs() {
    let mut plan = FramePlan::single_draw(4, 4, sample_ops(), caps().fingerprint());
    plan.surfaces.push(SurfacePlan::canvas(SurfaceId(1), 4, 4));
    plan.surfaces.push(SurfacePlan::canvas(SurfaceId(2), 4, 4));
    plan.passes.push(RenderPass::Draw {
        target: SurfaceId(1),
        ops: FrameOps {
            static_prefix: None,
            strings: vec![],
            bitmaps: Vec::new(),
            paints: Vec::new(),
            paths: vec![],
            ops: vec![DrawOp::Clear {
                color: [0.0, 0.0, 1.0, 1.0],
            }],
        },
    });
    plan.passes.push(RenderPass::Composite {
        inputs: vec![
            CompositeInput::opaque(SurfaceId::OUTPUT),
            CompositeInput {
                surface: SurfaceId(1),
                blend: BlendMode::Normal,
                opacity: 1.0,
                mask: None,
            },
        ],
        output: SurfaceId(2),
    });
    plan.output = SurfaceId(2);
    plan.validate().unwrap();

    let cache = SurfaceCache::with_frame_cap(8);
    let mut executor = CpuExecutor::new(caps());
    let first = execute_plan(&plan, &mut executor, &mut empty_media(), Some(&cache))
        .unwrap()
        .take();
    assert_eq!(cache.hits(), 0);
    let second = execute_plan(&plan, &mut executor, &mut empty_media(), Some(&cache))
        .unwrap()
        .take();
    assert_eq!(first, second, "缓存命中与否输出必须相同");
    assert!(
        cache.hits() >= 3,
        "第二次执行应当全部命中：{}",
        cache.hits()
    );
    // 蓝色不透明层盖在最上面
    assert_eq!(&first[0..4], &[0, 0, 255, 255]);
}

#[test]
fn preflight_rejects_a_canvas_larger_than_the_backend_can_hold() {
    let doc = json!({
        "meta": {"id": "huge", "width": 40000, "height": 100, "fps": 30},
        "scenes": [{"id": "only", "dur": 1}],
        "tracks": []
    });
    let ir = Resolver::new(doc, None).unwrap().resolve().unwrap();
    let error = match FramePlanner::cpu(&ir) {
        Ok(_) => panic!("超大画布必须在 preflight 被拒"),
        Err(error) => error,
    };
    assert!(
        error.to_string().contains("effect-capability-unsupported"),
        "{error}"
    );
}

// ── 外部输入 surface ─────────────────────────────────────────────────

/// `External` surface 让「已经画好的一张 pixmap」直接进效果链，不经 blit——
/// 这是 `studio_export` 的姿态模糊能位精确地表达成 Filter pass 的前提。
#[test]
fn an_external_surface_feeds_a_filter_pass_without_a_blit() {
    let mut source = tiny_skia::Pixmap::new(8, 8).unwrap();
    source.fill(tiny_skia::Color::from_rgba8(200, 100, 50, 255));
    let source = Arc::new(source);

    let mut plan = FramePlan::single_draw(8, 8, sample_ops(), caps().fingerprint());
    plan.surfaces = vec![
        SurfacePlan::external(SurfaceId(0), 8, 8),
        SurfacePlan::canvas(SurfaceId(1), 8, 8),
    ];
    plan.passes = vec![RenderPass::Filter {
        input: SurfaceId(0),
        output: SurfaceId(1),
        effect: EffectRef::new("filter.blur", 1),
        uniforms: UniformMap::new().with("radius", UniformValue::Scalar(0.0)),
    }];
    plan.output = SurfaceId(1);
    plan.validate().unwrap();

    let mut executor = CpuExecutor::new(caps());
    let external = std::collections::BTreeMap::from([(0u32, source.clone())]);
    let out = render_raster::plan::execute_plan_with_inputs(
        &plan,
        &mut executor,
        &mut empty_media(),
        None,
        &external,
    )
    .unwrap();
    // radius = 0 是恒等变换 ⇒ 输入原样出来，证明中间没有 blit
    assert_eq!(out.data(), source.data());
}

#[test]
fn an_external_surface_must_be_provided_and_cannot_be_cached() {
    let mut plan = FramePlan::single_draw(4, 4, sample_ops(), caps().fingerprint());
    plan.surfaces = vec![
        SurfacePlan::external(SurfaceId(0), 4, 4),
        SurfacePlan::canvas(SurfaceId(1), 4, 4),
    ];
    plan.passes = vec![RenderPass::Filter {
        input: SurfaceId(0),
        output: SurfaceId(1),
        effect: EffectRef::new("filter.blur", 1),
        uniforms: UniformMap::new(),
    }];
    plan.output = SurfaceId(1);

    let mut executor = CpuExecutor::new(caps());
    let missing = render_raster::plan::execute_plan_with_inputs(
        &plan,
        &mut executor,
        &mut empty_media(),
        None,
        &std::collections::BTreeMap::new(),
    )
    .unwrap_err()
    .to_string();
    assert!(missing.contains("frameplan-external-missing"), "{missing}");

    let cache = SurfaceCache::with_frame_cap(4);
    let external =
        std::collections::BTreeMap::from([(0u32, Arc::new(tiny_skia::Pixmap::new(4, 4).unwrap()))]);
    let cached = render_raster::plan::execute_plan_with_inputs(
        &plan,
        &mut executor,
        &mut empty_media(),
        Some(&cache),
        &external,
    )
    .unwrap_err()
    .to_string();
    assert!(
        cached.contains("frameplan-external-uncacheable"),
        "{cached}"
    );
}

/// Filter pass 现在真的会跑效果（commit 4 之前它是 `unsupported`）。
#[test]
fn a_filter_pass_runs_the_registered_cpu_reference() {
    let mut source = tiny_skia::Pixmap::new(16, 16).unwrap();
    source.fill(tiny_skia::Color::from_rgba8(255, 0, 0, 255));
    let source = Arc::new(source);
    let mut plan = FramePlan::single_draw(16, 16, sample_ops(), caps().fingerprint());
    plan.surfaces = vec![
        SurfacePlan::external(SurfaceId(0), 16, 16),
        SurfacePlan::canvas(SurfaceId(1), 16, 16),
    ];
    plan.passes = vec![RenderPass::Filter {
        input: SurfaceId(0),
        output: SurfaceId(1),
        effect: EffectRef::new("filter.grayscale", 1),
        uniforms: UniformMap::new().with("amount", UniformValue::Scalar(1.0)),
    }];
    plan.output = SurfaceId(1);
    let mut executor = CpuExecutor::new(caps());
    let out = render_raster::plan::execute_plan_with_inputs(
        &plan,
        &mut executor,
        &mut empty_media(),
        None,
        &std::collections::BTreeMap::from([(0u32, source)]),
    )
    .unwrap();
    // Rec.709 的红 ⇒ 0.2126 × 255 ≈ 54，三通道相等
    assert_eq!(&out.data()[..4], &[54, 54, 54, 255]);
}

/// `Transition` pass 走的是 `CpuExecutor::transition`，与 `Filter` 同一条
/// 「按 manifest 的具名内核找 CPU reference」的路。这里用两张纯色外部 surface
/// 验证整条计划链路（阶段 5）。
#[test]
fn a_transition_pass_runs_the_registered_cpu_reference() {
    let solid = |r, g, b| {
        let mut pixmap = tiny_skia::Pixmap::new(16, 16).unwrap();
        pixmap.fill(tiny_skia::Color::from_rgba8(r, g, b, 255));
        Arc::new(pixmap)
    };
    let (from, to) = (solid(255, 0, 0), solid(0, 0, 255));

    let run = |progress: f32| {
        let mut plan = FramePlan::single_draw(16, 16, sample_ops(), caps().fingerprint());
        plan.surfaces = vec![
            SurfacePlan::external(SurfaceId(0), 16, 16),
            SurfacePlan::external(SurfaceId(1), 16, 16),
            SurfacePlan::canvas(SurfaceId(2), 16, 16),
        ];
        plan.passes = vec![RenderPass::Transition {
            from: SurfaceId(0),
            to: SurfaceId(1),
            output: SurfaceId(2),
            effect: EffectRef::new("transition.crossfade", 1),
            progress,
            uniforms: UniformMap::new(),
        }];
        plan.output = SurfaceId(2);
        plan.validate().unwrap();
        let mut executor = CpuExecutor::new(caps());
        render_raster::plan::execute_plan_with_inputs(
            &plan,
            &mut executor,
            &mut empty_media(),
            None,
            &std::collections::BTreeMap::from([(0u32, from.clone()), (1u32, to.clone())]),
        )
        .unwrap()
    };

    // 端点逐字节等于输入；中点是整数混合式的结果：a = round(0.5×255) = 128，
    // r = (255×127 + 127)/255 = 127、b = (255×128 + 127)/255 = 128（截断除法，
    // 因此不对称——浮点插值再取整会给出 [128, 0, 128]）。
    assert_eq!(run(0.0).data(), from.data());
    assert_eq!(run(1.0).data(), to.data());
    assert_eq!(&run(0.5).data()[..4], &[127, 0, 128, 255]);
}

/// `Transition` pass 的两张输入都进 surface 指纹：换掉任意一侧、换 progress、
/// 换效果版本，输出 surface 的身份都必须变。
#[test]
fn both_transition_inputs_enter_the_surface_fingerprint() {
    let build = |progress: f32, swap: bool, version: u32| {
        let mut plan = FramePlan::single_draw(8, 8, sample_ops(), caps().fingerprint());
        plan.surfaces = vec![
            SurfacePlan::canvas(SurfaceId(0), 8, 8),
            SurfacePlan::canvas(SurfaceId(1), 8, 8),
            SurfacePlan::canvas(SurfaceId(2), 8, 8),
        ];
        let mut other = sample_ops();
        other.ops.push(DrawOp::PopClip);
        plan.passes = vec![
            RenderPass::Draw {
                target: SurfaceId(0),
                ops: sample_ops(),
            },
            RenderPass::Draw {
                target: SurfaceId(1),
                ops: other,
            },
            RenderPass::Transition {
                from: if swap { SurfaceId(1) } else { SurfaceId(0) },
                to: if swap { SurfaceId(0) } else { SurfaceId(1) },
                output: SurfaceId(2),
                effect: EffectRef::new("transition.crossfade", version),
                progress,
                uniforms: UniformMap::new(),
            },
        ];
        plan.output = SurfaceId(2);
        plan.frame_fingerprint().unwrap()
    };
    let base = build(0.5, false, 1);
    assert_ne!(base, build(0.75, false, 1), "progress 必须进指纹");
    assert_ne!(base, build(0.5, true, 1), "两侧互换必须换指纹");
    assert_ne!(base, build(0.5, false, 2), "效果版本必须进指纹");
}
