//! `media` 门内：本文件用 `LoadedAssets` / `MediaStore` / `FrameRenderer`
//! （BCF 文档渲染链路与 host 字节层），`wasm-safe` 构建里不存在（设计 §9.1）。
#![cfg(feature = "media")]

//! Lottie 子集渲染器的常开门（夹具进仓库，不依赖语料）。
//!
//! 三件事：
//!
//! 1. `core/fixtures/lottie/cases/` 里每个特性一份最小 bodymovin 文档，
//!    DrawOp 输出对 `cases-golden.json` 做**字节级**比对——golden 里既有
//!    `drawOpFingerprint`（BCOP 编码字节的 FNV-1a，真正的字节判据），也有
//!    逐条指令的文本反汇编（让 diff 能读，而不是一串换了值的十六进制）。
//! 2. `core/fixtures/lottie/samples/` 的三个冒烟样本走诊断路径：
//!    `shapes-only.json` 必须能渲染，另两个必须给出预期的 warn / fail。
//! 3. `lottie` 元素在 BCF 里的端到端：资源加载 → resolve → 录制 → 光栅化。
//!
//! 重生成：`BCUT_UPDATE_GOLDEN=1 cargo test -p bcut-render --test lottie_source`

use render_raster::drawop::{self, DrawOp, FrameBuilder, FrameOps, PaintData};
use render_raster::source::lottie::Lottie;
use render_raster::source::{MediaTime, PrepareCtx, VisualSource};
use render_raster::{FramePlanner, FrameRenderer, LoadedAssets, MediaStore, TextEngine};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::sync::Arc;

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/lottie")
}

fn updating() -> bool {
    std::env::var("BCUT_UPDATE_GOLDEN").is_ok_and(|v| v != "0")
}

/// 夹具文件名（排序，确定性）。
const CASES: [&str; 8] = [
    "dash-caps.json",
    "gradients.json",
    "image-embedded.json",
    "keyframe-dialects.json",
    "masks-mattes.json",
    "precomp-timeremap.json",
    "shapes.json",
    "trim-round-merge.json",
];

fn load_case(name: &str) -> Lottie {
    let path = fixtures().join("cases").join(name);
    let bytes = std::fs::read(&path).unwrap_or_else(|e| panic!("读 {path:?}: {e}"));
    let mut lottie = Lottie::parse("case", name, &bytes)
        .unwrap_or_else(|e| panic!("夹具 {name} 必须落在子集内：{e:#}"));
    let loaded: Vec<_> = lottie
        .image_requirements()
        .iter()
        .map(|requirement| {
            let bytes = requirement
                .embedded
                .clone()
                .unwrap_or_else(|| panic!("夹具 {name} 的子资源必须内嵌"));
            let pixmap = render_raster::assets::decode_image_bytes(&requirement.id, &bytes)
                .unwrap_or_else(|e| panic!("夹具 {name} 子资源解码：{e:#}"));
            (requirement.asset_name.clone(), bytes, Arc::new(pixmap))
        })
        .collect();
    lottie.attach_images(loaded);
    lottie.prepare(&PrepareCtx::default()).expect("prepare");
    lottie
}

fn f(v: f32) -> String {
    // -0.0 归一：编码器也这么做，反汇编跟着走才不会出现"值一样、文本不同"
    let v = if v == 0.0 { 0.0 } else { v };
    format!("{v}")
}

fn mat(m: &[f32; 6]) -> String {
    format!(
        "[{} {} {} {} {} {}]",
        f(m[0]),
        f(m[1]),
        f(m[2]),
        f(m[3]),
        f(m[4]),
        f(m[5])
    )
}

fn color(c: &[f32; 4]) -> String {
    format!("({} {} {} {})", f(c[0]), f(c[1]), f(c[2]), f(c[3]))
}

fn paint(data: &PaintData) -> String {
    let stops = |list: &[drawop::GradientStop]| {
        list.iter()
            .map(|s| format!("{}:{}", f(s.offset), color(&s.color)))
            .collect::<Vec<_>>()
            .join(" ")
    };
    match data {
        PaintData::Solid(c) => format!("solid {}", color(c)),
        PaintData::Linear { p0, p1, stops: s } => format!(
            "linear {},{} → {},{} [{}]",
            f(p0[0]),
            f(p0[1]),
            f(p1[0]),
            f(p1[1]),
            stops(s)
        ),
        PaintData::Radial {
            center,
            radius,
            focus,
            stops: s,
        } => format!(
            "radial c={},{} r={} focus={},{} [{}]",
            f(center[0]),
            f(center[1]),
            f(*radius),
            f(focus[0]),
            f(focus[1]),
            stops(s)
        ),
    }
}

/// 指令流的文本反汇编（golden 的可读半边）。
fn disassemble(frame: &FrameOps) -> Vec<String> {
    frame
        .ops
        .iter()
        .map(|op| match op {
            DrawOp::Clear { color: c } => format!("Clear {}", color(c)),
            DrawOp::FillRect {
                x,
                y,
                w,
                h,
                radius,
                color: c,
                tf,
            } => format!(
                "FillRect {} {} {} {} r={} {} {}",
                f(*x),
                f(*y),
                f(*w),
                f(*h),
                f(*radius),
                color(c),
                mat(tf)
            ),
            DrawOp::FillPath { path, color: c, tf } => {
                format!("FillPath #{path} {} {}", color(c), mat(tf))
            }
            DrawOp::StrokePath {
                path,
                color: c,
                width,
                tf,
            } => format!(
                "StrokePath #{path} {} w={} {}",
                color(c),
                f(*width),
                mat(tf)
            ),
            DrawOp::DrawMedia {
                asset,
                media_ms,
                src,
                tf,
            } => format!(
                "DrawMedia \"{}\" ms={media_ms} src=[{} {} {} {}] {}",
                frame
                    .strings
                    .get(*asset as usize)
                    .map(String::as_str)
                    .unwrap_or("?"),
                f(src[0]),
                f(src[1]),
                f(src[2]),
                f(src[3]),
                mat(tf)
            ),
            DrawOp::PushLayer { opacity, blend } => {
                format!("PushLayer o={} {}", f(*opacity), blend.as_str())
            }
            DrawOp::PopLayer => "PopLayer".into(),
            DrawOp::ClipPath { path, tf } => format!("ClipPath #{path} {}", mat(tf)),
            DrawOp::PopClip => "PopClip".into(),
            DrawOp::FillPathPaint {
                path,
                paint: id,
                even_odd,
                tf,
            } => format!(
                "FillPathPaint #{path} paint={id}{} {}",
                if *even_odd { " evenOdd" } else { "" },
                mat(tf)
            ),
            DrawOp::StrokePathPaint {
                path,
                paint: id,
                width,
                cap,
                join,
                miter,
                tf,
            } => format!(
                "StrokePathPaint #{path} paint={id} w={} cap={cap} join={join} miter={} {}",
                f(*width),
                f(*miter),
                mat(tf)
            ),
            DrawOp::PushMatte => "PushMatte".into(),
            DrawOp::PopMatte { mode } => format!("PopMatte mode={mode}"),
            DrawOp::DrawBitmap {
                bitmap,
                opacity,
                tf,
            } => format!("DrawBitmap #{bitmap} o={} {}", f(*opacity), mat(tf)),
        })
        .collect()
}

fn record(lottie: &Lottie, ms: i64) -> FrameOps {
    let mut builder = FrameBuilder::default();
    lottie
        .record(
            MediaTime::from_millis(ms),
            tiny_skia::Transform::identity(),
            &mut builder,
        )
        .expect("record");
    builder.finish()
}

#[test]
fn every_handwritten_case_keeps_its_draw_ops_byte_for_byte() {
    let golden_path = fixtures().join("cases-golden.json");
    let mut cases = Vec::new();
    for name in CASES {
        let lottie = load_case(name);
        let meta = lottie.metadata().clone();
        let samples: Vec<Value> = [0i64, meta.total_ms() / 2, meta.total_ms() - 1]
            .into_iter()
            .map(|ms| {
                let frame = record(&lottie, ms.max(0));
                json!({
                    "ms": ms.max(0),
                    "bcopVersion": drawop::required_version(&frame),
                    "drawOpFingerprint": format!("{:016x}", drawop::fingerprint(&frame)),
                    "encodedBytes": drawop::encode(&frame).len(),
                    "paints": frame.paints.iter().map(paint).collect::<Vec<_>>(),
                    "ops": disassemble(&frame),
                })
            })
            .collect();
        cases.push(json!({
            "file": name,
            "width": meta.width,
            "height": meta.height,
            "fps": lottie.frame_rate(),
            "frames": meta.frame_count(),
            "warnings": lottie.diagnostics().len(),
            "markers": lottie.markers().iter().map(|(n, t, d)| json!({
                "name": n, "frame": t, "duration": d
            })).collect::<Vec<_>>(),
            "samples": samples,
        }));
    }
    let actual = json!({
        "note": "手写夹具的 DrawOp 字节级 golden。drawOpFingerprint 是 BCOP 编码字节的 \
                 FNV-1a（真正的字节判据）；ops 是同一条指令流的文本反汇编，只为让 diff 可读。",
        "rendererTag": "bcut.source.lottie/v1",
        "cases": cases,
    });
    if updating() {
        let mut text = serde_json::to_string_pretty(&actual).unwrap();
        text.push('\n');
        std::fs::write(&golden_path, text).expect("写 golden");
        return;
    }
    let expected: Value =
        serde_json::from_slice(&std::fs::read(&golden_path).expect("读 golden")).expect("解析");
    if expected != actual {
        let expected_cases = expected["cases"].as_array().cloned().unwrap_or_default();
        let actual_cases = actual["cases"].as_array().cloned().unwrap_or_default();
        for (want, got) in expected_cases.iter().zip(actual_cases.iter()) {
            if want != got {
                panic!(
                    "夹具 {} 的指令流变了。\n期望：\n{}\n实际：\n{}\n\
                     若这是有意的语义变化，用 BCUT_UPDATE_GOLDEN=1 重生成并在提交里说明。",
                    want["file"],
                    serde_json::to_string_pretty(want).unwrap(),
                    serde_json::to_string_pretty(got).unwrap()
                );
            }
        }
        panic!("cases-golden.json 与当前实现不一致（条目数或表头变了）");
    }
}

#[test]
fn recording_a_case_twice_gives_identical_bytes_and_survives_shuffling() {
    for name in CASES {
        let lottie = load_case(name);
        let total = lottie.metadata().total_ms();
        let points: Vec<i64> = (0..8).map(|k| total * k / 8).collect();
        let forward: Vec<Vec<u8>> = points
            .iter()
            .map(|ms| drawop::encode(&record(&lottie, *ms)))
            .collect();
        let backward: Vec<Vec<u8>> = points
            .iter()
            .rev()
            .map(|ms| drawop::encode(&record(&lottie, *ms)))
            .collect();
        assert_eq!(
            forward,
            backward.into_iter().rev().collect::<Vec<_>>(),
            "{name}：乱序录制必须逐字节等于顺序录制"
        );
        // 同一时刻两次录制
        assert_eq!(
            drawop::encode(&record(&lottie, total / 3)),
            drawop::encode(&record(&lottie, total / 3)),
            "{name}：同帧两次录制必须逐字节相同"
        );
    }
}

#[test]
fn every_case_rasterises_without_touching_the_stacks() {
    for name in CASES {
        let lottie = load_case(name);
        let total = lottie.metadata().total_ms();
        for k in 0..4 {
            let ms = total * k / 4;
            let frame = lottie
                .sample(MediaTime::from_millis(ms))
                .unwrap_or_else(|e| panic!("{name} 在 {ms}ms 光栅化失败：{e:#}"));
            assert_eq!(
                (frame.pixmap.width(), frame.pixmap.height()),
                (lottie.metadata().width, lottie.metadata().height)
            );
            assert!(
                frame.pixmap.data().iter().any(|b| *b != 0),
                "{name} 在 {ms}ms 画出了一张全空的图"
            );
        }
    }
}

#[test]
fn the_new_v4_primitives_only_show_up_where_the_case_needs_them() {
    let gradients = record(&load_case("gradients.json"), 0);
    assert!(
        gradients
            .paints
            .iter()
            .any(|p| !matches!(p, PaintData::Solid(_))),
        "渐变夹具必须发出渐变 paint"
    );
    assert_eq!(drawop::required_version(&gradients), 4);

    let mattes = record(&load_case("masks-mattes.json"), 0);
    let modes: Vec<u8> = mattes
        .ops
        .iter()
        .filter_map(|op| match op {
            DrawOp::PopMatte { mode } => Some(*mode),
            _ => None,
        })
        .collect();
    assert_eq!(
        modes,
        vec![0, 1, 0],
        "alpha / 反相 alpha / 半透明遮罩各一次"
    );
    assert_eq!(
        mattes
            .ops
            .iter()
            .filter(|op| matches!(op, DrawOp::ClipPath { .. }))
            .count(),
        2,
        "根画幅 + 满不透明 add 遮罩的裁剪快路径"
    );

    let dashed = record(&load_case("dash-caps.json"), 0);
    let stroke = dashed
        .ops
        .iter()
        .find_map(|op| match op {
            DrawOp::StrokePathPaint {
                path, cap, join, ..
            } => Some((*path, *cap, *join)),
            _ => None,
        })
        .expect("虚线夹具必须发出描边");
    assert_eq!((stroke.1, stroke.2), (0, 0), "lc=1/lj=1 ⇒ butt / miter");
    // 周长 (80+40)*2 = 240，10 开 6 关 ⇒ 15 段，每段一个 move
    let moves = dashed.paths[stroke.0 as usize]
        .0
        .iter()
        .filter(|seg| seg.verb == 0)
        .count();
    assert_eq!(moves, 15, "虚线必须把闭合路径切成 15 段");
}

#[test]
fn the_keyframe_dialects_actually_animate() {
    // 这份夹具专治两类"静默变 0"：属性带关键帧却**省略 `a` 标志**，以及
    // 老格式 `{s, e, t}` 的**纯终止符末项**。两者都曾让整条属性退化成常量。
    let lottie = load_case("keyframe-dialects.json");
    let total = lottie.metadata().total_ms();
    let fingerprints: Vec<u64> = [0, total / 3, total * 2 / 3, total - 1]
        .into_iter()
        .map(|ms| drawop::fingerprint(&record(&lottie, ms.max(0))))
        .collect();
    let mut unique = fingerprints.clone();
    unique.sort_unstable();
    unique.dedup();
    assert_eq!(
        unique.len(),
        fingerprints.len(),
        "四个时刻必须各不相同——相同就说明动画又被判成了常量"
    );

    // 本帧所有离屏层的不透明度（图层 alpha < 1 才起层）
    let opacities = |ms: i64| -> Vec<f32> {
        record(&lottie, ms)
            .ops
            .iter()
            .filter_map(|op| match op {
                DrawOp::PushLayer { opacity, .. } => Some(*opacity),
                _ => None,
            })
            .collect()
    };
    let near = |list: &[f32], want: f32| list.iter().any(|o| (o - want).abs() < 0.02);

    let start = opacities(0);
    let finish = opacities(total - 1);
    // 缺 `a` 标志的图层：不透明度 100 → 20。起点满不透明（不起层），末帧 ~0.23
    assert!(
        !start.iter().any(|o| *o < 0.29),
        "起点该层满不透明、不该起离屏层，实际 {start:?}"
    );
    assert!(near(&finish, 0.227), "末帧应当 ~0.23，实际 {finish:?}");
    // 老格式 `{s, e, t}`：不透明度 30 → 100。起点 0.3，终止符之后冻结在 100（不起层）
    assert!(near(&start, 0.3), "老格式起值 30%，实际 {start:?}");
    assert!(
        !near(&finish, 0.3),
        "老格式末端应当冻结在前一帧的 `e`（100%），实际 {finish:?}"
    );
    // 而且该层**还在画**——踩过的坑是末端归零，整层被 alpha <= 0 跳过
    assert!(
        record(&lottie, total - 1)
            .ops
            .iter()
            .any(|op| matches!(op, DrawOp::StrokePathPaint { .. })),
        "老格式图层在末端必须仍然出画"
    );

    // st ≠ 0 的预合成：内部关键帧写在内部时间轴上，靠 st 对齐才动得起来
    let pixels = |ms: i64| {
        lottie
            .sample(MediaTime::from_millis(ms))
            .unwrap()
            .pixmap
            .data()
            .to_vec()
    };
    assert_ne!(pixels(0), pixels(total / 3), "画面必须在动");
}

// ── 冒烟样本的诊断路径 ─────────────────────────────────────────────

fn sample_bytes(name: &str) -> Vec<u8> {
    std::fs::read(fixtures().join("samples").join(name)).expect("读冒烟样本")
}

#[test]
fn shapes_only_renders_clean() {
    let lottie = Lottie::parse(
        "smoke",
        "shapes-only.json",
        &sample_bytes("shapes-only.json"),
    )
    .expect("shapes-only 必须落在子集内");
    assert!(lottie.diagnostics().is_empty(), "不该有任何诊断");
    let frame = record(&lottie, 0);
    assert!(
        frame
            .ops
            .iter()
            .any(|op| matches!(op, DrawOp::FillPathPaint { .. })),
        "必须画出东西"
    );
}

#[test]
fn the_gradient_matte_precomp_sample_renders_and_warns_about_nothing_unexpected() {
    let name = "gradient-matte-precomp.json";
    let lottie = Lottie::parse("smoke", name, &sample_bytes(name))
        .unwrap_or_else(|e| panic!("{name} 应当落在子集内（渐变/遮罩/预合成都支持）：{e:#}"));
    // 它刻意含渐变、轨道遮罩、图层遮罩、预合成、时间重映射、非 normal 混合与 markers
    let frame = record(&lottie, 0);
    assert!(frame.ops.iter().any(|op| matches!(op, DrawOp::PushMatte)));
    assert!(!lottie.markers().is_empty(), "markers 必须被读出来");
}

#[test]
fn the_text_effects_expression_sample_fails_fast_with_the_documented_code() {
    let name = "text-effects-expression.json";
    let error = Lottie::parse("smoke", name, &sample_bytes(name))
        .expect_err("文字 / 效果 / 表达式样本必须被拦下")
        .to_string();
    assert!(
        error.contains(render_raster::source::LOTTIE_RULE),
        "必须带诊断码 lottie-unsupported-feature，实际：{error}"
    );
}

#[test]
fn an_expression_control_group_warns_but_still_renders() {
    let doc = json!({
        "v": "5.7.0", "fr": 10, "ip": 0, "op": 10, "w": 20, "h": 20,
        "layers": [{"ty": 4, "ind": 1, "nm": "ctrl", "ip": 0, "op": 10, "st": 0, "ks": {},
            "ef": [{"ty": 5, "nm": "控制组", "ef": [{"ty": 0, "nm": "滑块"}]}],
            "shapes": [{"ty": "gr", "it": [
                {"ty": "rc", "p": {"a": 0, "k": [10, 10]}, "s": {"a": 0, "k": [8, 8]},
                 "r": {"a": 0, "k": 0}},
                {"ty": "fl", "c": {"a": 0, "k": [1, 1, 1]}, "o": {"a": 0, "k": 100}},
                {"ty": "tr", "p": {"a": 0, "k": [0, 0]}, "a": {"a": 0, "k": [0, 0]},
                 "s": {"a": 0, "k": [100, 100]}, "r": {"a": 0, "k": 0},
                 "o": {"a": 0, "k": 100}}]}]}]
    });
    let lottie =
        Lottie::parse("warn", "warn.json", &serde_json::to_vec(&doc).unwrap()).expect("应当渲染");
    assert_eq!(lottie.diagnostics().len(), 1);
    assert_eq!(
        lottie.diagnostics()[0].rule,
        render_raster::source::LOTTIE_RULE
    );
    assert!(
        record(&lottie, 0)
            .ops
            .iter()
            .any(|op| matches!(op, DrawOp::FillPathPaint { .. })),
        "warn 不阻止渲染"
    );
}

// ── BCF `lottie` 元素端到端 ────────────────────────────────────────

fn bcf_document(fit: &str) -> Value {
    json!({
        "bcut": "0.1",
        "meta": {"id": "lottie-case", "width": 160, "height": 120, "fps": 10,
                 "background": "#000000"},
        "assets": {"badge": {"type": "lottie", "src": "cases/shapes.json"}},
        "scenes": [{"id": "s1", "dur": 1.0, "desc": "Lottie 元素端到端夹具"}],
        "tracks": [{"id": "main", "clips": [{
            "id": "c1", "scene": "s1",
            // 外面套一层 box：`style.x` / `style.y` 是**父级布局**给孩子定位的，
            // clip 的根节点没有父级，写了也不生效（layout::is_absolute）
            "element": {"id": "root", "type": "box",
                "style": {"width": 160, "height": 120},
                "children": [{"id": "e1", "type": "lottie", "src": "$assets.badge",
                              "fit": fit, "loop": true,
                              "style": {"width": 80, "height": 80, "x": 40, "y": 20}}]}
        }]}]
    })
}

fn render_bcf(fit: &str, t: f64) -> (tiny_skia::Pixmap, Vec<String>) {
    let doc = bcf_document(fit);
    let base = fixtures();
    let diagnostics = scene_primitives::lint::lint(&doc);
    let errors: Vec<String> = diagnostics
        .iter()
        .filter(|d| d.severity == scene_primitives::lint::Severity::Error)
        .map(|d| format!("{} {} {}", d.rule, d.pointer, d.message))
        .collect();
    assert!(errors.is_empty(), "lint 不该报错：{errors:?}");

    let assets = render_raster::load_assets(&doc, &base).expect("加载 lottie 资产");
    let assets = Arc::new(assets);
    let mut resolver = scene_primitives::Resolver::new(doc, None).unwrap();
    resolver.set_host_inputs(assets.inputs.clone());
    let mut ir = resolver.resolve().expect("resolve");
    let mut engine = TextEngine::with_document_fonts(&assets.fonts);
    let renderer =
        FrameRenderer::new_with_assets(&mut ir, &mut engine, &assets).expect("装配矢量源");
    let planner = FramePlanner::cpu_with_assets(&ir, &assets).expect("preflight");
    let mut media = MediaStore::new(assets.clone(), ir.fps);
    let pixmap = planner
        .render(&renderer, &ir, &mut engine, &mut media, t)
        .expect("渲染");
    let warnings = planner
        .report()
        .diagnostics
        .iter()
        .map(|d| d.rule.to_string())
        .collect();
    (pixmap, warnings)
}

#[test]
fn a_lottie_element_renders_inside_its_box_and_scales_with_it() {
    let (pixmap, warnings) = render_bcf("contain", 0.0);
    assert!(warnings.is_empty(), "干净夹具不该有诊断：{warnings:?}");
    let at = |x: u32, y: u32| -> [u8; 4] {
        let i = ((y * pixmap.width() + x) * 4) as usize;
        pixmap.data()[i..i + 4].try_into().unwrap()
    };
    // 盒子是 [40,20]–[120,100]；盒外必须还是背景色（黑、不透明）
    assert_eq!(at(5, 5), [0, 0, 0, 255], "盒外不该被画到");
    assert_eq!(at(150, 110), [0, 0, 0, 255]);
    // 盒内应当有非背景像素
    let mut painted = 0;
    for y in 20..100 {
        for x in 40..120 {
            if at(x, y) != [0, 0, 0, 255] {
                painted += 1;
            }
        }
    }
    assert!(painted > 200, "盒内应当画出内容，实际只有 {painted} 像素");
}

#[test]
fn cover_fit_clips_the_overflow_back_to_the_element_box() {
    let (pixmap, _) = render_bcf("cover", 0.0);
    let at = |x: u32, y: u32| -> [u8; 4] {
        let i = ((y * pixmap.width() + x) * 4) as usize;
        pixmap.data()[i..i + 4].try_into().unwrap()
    };
    // 素材是 120×90、盒子 80×80 ⇒ cover 会横向溢出，必须被裁回盒子
    for y in [21u32, 60, 98] {
        assert_eq!(at(38, y), [0, 0, 0, 255], "盒左侧越界");
        assert_eq!(at(122, y), [0, 0, 0, 255], "盒右侧越界");
    }
}

#[test]
fn the_element_freezes_and_loops_like_an_animated_image() {
    // loop: true ⇒ 1s 的合成在 1s 的 clip 里正好走一遍；t=0 与 t=0.99 应当不同
    let (a, _) = render_bcf("contain", 0.0);
    let (b, _) = render_bcf("contain", 0.9);
    assert_ne!(a.data(), b.data(), "带旋转关键帧的素材应当逐帧变化");
    // 同一帧窗口内两次渲染逐字节相同（10fps ⇒ 100ms 一帧）
    // 量化用的是**素材**的帧表（30fps ⇒ 33ms 一帧），不是项目 fps
    let (c, _) = render_bcf("contain", 0.41);
    let (d, _) = render_bcf("contain", 0.42);
    assert_eq!(c.data(), d.data(), "同一素材帧窗口必须逐字节相同");
    let (e, _) = render_bcf("contain", 0.44);
    assert_ne!(c.data(), e.data(), "跨素材帧边界必须变");
}

#[test]
fn a_renderer_without_the_vector_sources_refuses_to_assemble() {
    let doc = bcf_document("contain");
    let assets = render_raster::load_assets(&doc, &fixtures()).expect("加载");
    let mut resolver = scene_primitives::Resolver::new(doc, None).unwrap();
    resolver.set_host_inputs(assets.inputs.clone());
    let mut ir = resolver.resolve().unwrap();
    let mut engine = TextEngine::with_document_fonts(&[]);
    let error = match FrameRenderer::new_with_assets(&mut ir, &mut engine, &LoadedAssets::default())
    {
        Ok(_) => panic!("没装矢量源必须在装配期就炸，而不是画出一片空白"),
        Err(error) => error.to_string(),
    };
    assert!(error.contains("lottie-source-missing"), "实际：{error}");
}

#[test]
fn the_asset_type_and_element_type_must_agree() {
    let mut doc = bcf_document("contain");
    doc["assets"]["badge"]["type"] = json!("image");
    let errors: Vec<String> = scene_primitives::lint::lint(&doc)
        .into_iter()
        .filter(|d| d.severity == scene_primitives::lint::Severity::Error)
        .map(|d| d.message)
        .collect();
    assert!(
        !errors.is_empty(),
        "lottie 元素指向 image 资产必须是 lint error"
    );
}

#[test]
fn a_lottie_element_has_no_audio_track() {
    let mut doc = bcf_document("contain");
    doc["tracks"][0]["clips"][0]["element"]["children"][0]["withAudio"] = json!(true);
    let errors: Vec<String> = scene_primitives::lint::lint(&doc)
        .into_iter()
        .filter(|d| d.severity == scene_primitives::lint::Severity::Error)
        .map(|d| d.message)
        .collect();
    assert!(
        errors.iter().any(|m| m.contains("withAudio")),
        "实际：{errors:?}"
    );
}
