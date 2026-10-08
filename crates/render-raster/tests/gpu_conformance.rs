//! GPU ↔ CPU conformance（元素方案 §8.7 / §10 P5 的验收点）。
//!
//! 同一组参数 + `progress ∈ {0, 0.25, 0.5, 0.75, 1}` 五个取值，GPU 输出与 CPU
//! reference 逐像素比对，**且各取值乱序执行一遍**。CPU 永远是 strict reference
//! （ADR-M05），GPU 只是加速器。
//!
//! **对拍面只有 progress 的 14 款。** visualizer 自 2026-09 重设计起 10 款全部是
//! CPU 矢量配方（`source/visualizer/recipes/`），没有 WGSL 实现，`shader_for`
//! 对它恒返回 `None`、host 记一条 `ShaderMissing` 回退——这条通路由文末的
//! 回退测试钉住，不再有逐像素对拍。
//!
//! ```bash
//! cd core
//! cargo test -p bcut-render --features gpu --test gpu_conformance -- --nocapture
//! ```
//!
//! ## strict 判据（§8.7 的**一次性修正**，P5b 落地后冻结）
//!
//! §12 的风险表允许"在 P5 实施记录里按测量结果修正一次"。P5a 测出的事实是：
//! CPU 参照是**矢量**路径，边是硬边；GPU 画的是连续的 `factor`（软边）。两条
//! **不同的抗锯齿函数**在过渡带上必然差出上百个灰阶，而色块中心与背景逐位相同。
//! 全分辨率 SSIM 衡量的正是"两侧抗锯齿函数是否相同"，而那本来就不相同——它因此
//! 不是一条有意义的硬门。
//!
//! 修正后的 strict 判据是三条**结构性**指标：
//!
//! 1. **平坦区逐通道 ≤ 2/255**（[`FLAT_CHANNEL_BUDGET`]，就是 §8.7 原文那个 2）：
//!    只看两幅图 3×3 邻域都恒定的像素，即"不在任何一条边上"的像素；
//! 2. **过渡带像素占比 ≤ 20%**（[`EDGE_PIXEL_SHARE`]）：挡住"整幅画都偏了"这种
//!    真回归，而不是挡住"边缘两像素不同"这种设计使然；
//! 3. **4× 降采样后 SSIM ≥ 0.98**（[`SSIM_FLOOR_STRICT`]）：降采样正是"把过渡带
//!    按面积摊平"的操作，它衡量的是"这两幅图在观感上是不是同一幅"。
//!
//! 全分辨率 SSIM **仍然逐条打印**，作为诊断而不是硬门。
//!
//! ## visual 判据（§8.7 原值，未修订）
//!
//! `visual` 档的 CPU 参照按定义就是降采样 / 查表近似，判据是 **SSIM ≥ 0.96**
//! （[`SSIM_FLOOR_VISUAL`]），比法与 strict 的第 3 条一样落在 4× 降采样上——
//! 理由同上，而且 §8.7 那句"不追求逐像素"说的就是这件事。
//!
//! ## 这条判据不放过什么
//!
//! `progress.normal` 的颜色分界是竖直硬边、`progress × 宽度` 落在像素边界上，
//! 两边**逐字节相同**；这一条用 `assert_eq!(max_deviation, 0)` 单独钉住，是
//! "GPU 路径本身是对的"（单 quad、y-flip、uniform 顺序、premultiplied 输出、
//! `DiscardClip`、回读换算全链路）最硬的证据。
#![cfg(feature = "gpu")]

use std::sync::Arc;

use anyhow::{Result, bail};
use motion::preset_registry::timeline_progress;
use render_raster::drawop::{FrameBuilder, Mat6};
use render_raster::imgcmp::{self, Comparison};
use render_raster::plan::shader_quad::ShaderQuad;
use render_raster::raster::{FrameMedia, rasterize_with_media};
use render_raster::source::kernel::DrawBox;
use render_raster::source::{ProgressParams, progress_frame};
use render_raster::{GpuExecutor, plan::gpu_fallback::GpuBackendReport};
use tiny_skia::Pixmap;

// ── 输入侧，与 `core/fixtures/progress/cases.json` 逐字相同。

/// `cases.json` 的 `progress` 与 `times` 两列。
const PROGRESS_VALUES: [f64; 5] = [0.0, 0.25, 0.5, 0.75, 1.0];
const PROGRESS_TIMES: [f64; 5] = [0.0, 0.75, 1.5, 2.25, 3.0];

/// `#3CADFF` / `#C4E6FF`（夹具的 `mainColor` / `secondaryColor`）。
const MAIN: [f32; 4] = [0.235_294_12, 0.678_431_4, 1.0, 1.0];
const SECONDARY: [f32; 4] = [0.768_627_5, 0.901_960_8, 1.0, 1.0];
const TF: Mat6 = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];

// ── §8.7 的判据（见文件头）。

/// strict 档的 **4× 降采样 SSIM** 下界（§8.7 修正后的第 3 条）。
const SSIM_FLOOR_STRICT: f64 = 0.98;

/// `visual` 档的 SSIM 下界（§8.7 **原值**，未修订）。
const SSIM_FLOOR_VISUAL: f64 = 0.96;

/// §8.7 的 "逐通道 ≤ 2/255" 在**平坦区**上的形式。这个 2 就是原文那个 2。
///
/// 算法收敛进 [`imgcmp`]（WP5b）：这里直接复用 [`imgcmp::FLAT_CHANNEL_BUDGET`]，
/// 不留第二份可能漂移的定义。
const FLAT_CHANNEL_BUDGET: u8 = imgcmp::FLAT_CHANNEL_BUDGET;

/// 过渡带占比上界（§8.7 修正后的第 2 条）。
const EDGE_PIXEL_SHARE: f64 = 0.20;

/// 超采样倍率。1× 是"参考实现原样"，4× 是"给 GPU 侧补一条与光栅器可比的
/// 抗锯齿"——两者都测，实测数字一起打出来。
const SUPERSAMPLE: u32 = 4;

/// `aspect: "bar"` 的盒子：与夹具的几何默认表同尺寸，落点归零。
///
/// `progress` 夹具的 `bar` 盒是 1080p 上的 `80% × 5%` = **1536 × 54**——宽高都
/// 恰好是整数像素，`progress × 1536` 也全落在像素边界上。GPU 的渲染目标只能是
/// 整数尺寸，因此这里只把落点挪到原点（quad 自己那块画面的合成是调用方的事），
/// **尺寸与夹具一致**。
const PROGRESS_BOX: DrawBox = DrawBox {
    x: 0.0,
    y: 0.0,
    w: 1536.0,
    h: 54.0,
};

/// `aspect: "square"` 的盒子：几何默认表的 `30% × 30%`（1080p 上 576 × 324）
/// 收成内切正方形 **324 × 324**。
///
/// 不能拿横条盒的内切正方形（54）凑合：那只只有 54 px 见方，4× 降采样后是
/// 13 × 13、连两个 SSIM 窗口都排不下，一圈抗锯齿就能把分数拉到 0.91——那衡量的
/// 是夹具太小，不是实现有问题。
const SQUARE_BOX: DrawBox = DrawBox {
    x: 0.0,
    y: 0.0,
    w: 324.0,
    h: 324.0,
};

/// `aspect: "frame"` 的盒子：几何默认表的整幅。conformance 用 4 分之一分辨率
/// （480 × 270），边框粗细是**相对量**（`borderSize · max(w, h)`），换算不受影响。
const FRAME_BOX: DrawBox = DrawBox {
    x: 0.0,
    y: 0.0,
    w: 480.0,
    h: 270.0,
};

/// 指令流里没有 `DrawMedia`：真被调到就是这条测试的前提坏了。
struct NoMedia;

impl FrameMedia for NoMedia {
    fn frame(&mut self, id: &str, _media_ms: i64) -> Result<Arc<Pixmap>> {
        bail!("conformance 的指令流不该引用媒体 {id}")
    }
}

fn progress_params() -> ProgressParams {
    ProgressParams {
        main_color: MAIN,
        secondary_color: SECONDARY,
        pixel_scale: 1.0,
    }
}

/// `aspect: "square"` 的样式在盒内取内切正方形再画（CPU 与 GPU 同一条规则）。
///
/// GPU 的渲染目标只有 quad 自己那块画面（`QuadTarget::from_box` 取的就是内切
/// 正方形），因此 CPU 参照必须光栅化到**同一只盒子**，否则比的是两幅不同尺寸的
/// 图。落点一律归零：合成是调用方的事。
fn progress_box(style: &str) -> DrawBox {
    let recipe = timeline_progress(style).expect("样式已登记");
    match recipe.progress().expect("progress 配方").aspect {
        motion::preset_registry::ProgressAspect::Square => SQUARE_BOX,
        motion::preset_registry::ProgressAspect::Frame => FRAME_BOX,
        motion::preset_registry::ProgressAspect::Bar => PROGRESS_BOX,
    }
}

fn cpu_progress(style: &str, progress: f64, time: f64) -> Pixmap {
    let recipe = timeline_progress(style).expect("样式已登记");
    let bbox = progress_box(style);
    let mut builder = FrameBuilder::default();
    progress_frame(
        &mut builder,
        recipe,
        &progress_params(),
        progress,
        time,
        bbox,
        TF,
    );
    rasterize_with_media(
        &builder.finish(),
        bbox.w as u32,
        bbox.h as u32,
        &mut NoMedia,
    )
    .expect("CPU 参照光栅化")
}

fn progress_quad(style: &str, progress: f64, time: f64) -> ShaderQuad {
    let recipe = timeline_progress(style).expect("样式已登记");
    ShaderQuad::progress(
        recipe,
        &progress_params(),
        progress,
        time,
        progress_box(style),
        (PROGRESS_BOX.w, PROGRESS_BOX.h),
    )
    .unwrap_or_else(|error| panic!("{style} 建 quad 失败：{error}"))
}

// ── 比较：算法收敛进 `render_raster::imgcmp`（WP5b），本文件只留判定阈值
// 与三条断言逻辑——那是 GPU 抗锯齿这个特定问题的判据，不是共享算法契约。

/// 薄包装：这里的两侧图像永远同尺寸（CPU 参照与 GPU 渲染画的是同一只盒子），
/// `imgcmp::compare` 的尺寸错误因此退化成 `expect`——真触发就是这条测试的
/// 前提坏了，值得直接崩而不是悄悄跳过。
fn compare(cpu: &Pixmap, gpu: &Pixmap) -> Comparison {
    imgcmp::compare(cpu, gpu).expect("两侧尺寸必须一致")
}

fn executor() -> Option<GpuExecutor> {
    match GpuExecutor::new() {
        Ok(executor) => {
            println!(
                "GPU: backend={} adapter={}",
                executor.backend(),
                executor.adapter_name()
            );
            Some(executor)
        }
        Err(error) => {
            // 没有 GPU 的机器上这条测试**跳过而不是失败**（§8.7：CI 只在固定
            // runner 上跑 GPU conformance，失败不阻塞 CPU 路径）。
            let report = GpuBackendReport::default();
            println!("跳过 GPU conformance：{error}；报告 {:?}", report.records);
            None
        }
    }
}

fn assert_within_budget(label: &str, measured: Comparison, ssim_floor: f64) {
    println!(
        "  {label:26} ssim={:.4} ssim@4x={:.4} max={:>3} flat={:>3} edge={:>6.3}%",
        measured.ssim,
        measured.ssim_downsampled,
        measured.max_deviation,
        measured.flat_max_deviation,
        measured.edge_share * 100.0
    );
    // 判据落在**降采样**的 SSIM 上；全分辨率那个数只打印，见文件头。
    assert!(
        measured.ssim_downsampled >= ssim_floor,
        "{label}: 4× 降采样 SSIM {:.6} < {ssim_floor}",
        measured.ssim_downsampled
    );
    assert!(
        measured.flat_max_deviation <= FLAT_CHANNEL_BUDGET,
        "{label}: 平坦区逐通道偏差 {}/255 > {FLAT_CHANNEL_BUDGET}/255",
        measured.flat_max_deviation
    );
    assert!(
        measured.edge_share <= EDGE_PIXEL_SHARE,
        "{label}: 过渡带占比 {:.3}% > {:.1}%（疑似整幅画偏了，不是边缘）",
        measured.edge_share * 100.0,
        EDGE_PIXEL_SHARE * 100.0
    );
}

/// `visual` 档只吃 SSIM 一条（§8.7：CPU 参照是降采样近似，平坦区与过渡带那两条
/// 结构性判据对它没有意义——它的"平坦区"本来就与 GPU 的连续场不是同一件事）。
fn assert_visual(label: &str, measured: Comparison) {
    println!(
        "  {label:26} ssim={:.4} ssim@4x={:.4} max={:>3} flat={:>3} edge={:>6.3}%",
        measured.ssim,
        measured.ssim_downsampled,
        measured.max_deviation,
        measured.flat_max_deviation,
        measured.edge_share * 100.0
    );
    assert!(
        measured.ssim_downsampled >= SSIM_FLOOR_VISUAL,
        "{label}: 4× 降采样 SSIM {:.6} < {SSIM_FLOOR_VISUAL}",
        measured.ssim_downsampled
    );
}

/// 一个样式的 determinism 档。目录型配方复用注册表那个枚举（§7.3）。
fn is_strict(determinism: motion::preset_registry::Determinism) -> bool {
    determinism == motion::preset_registry::Determinism::Strict
}

// ── 全量对拍：14 种 progress。

/// `progress.normal` 的颜色分界是**竖直硬边**，`progress × 1536` 恰好落在像素
/// 边界上，两边因此都没有抗锯齿——这一条能做到**逐字节相同**，是"GPU 路径本身
/// 是对的"最硬的证据（见文件头）。
#[test]
fn the_pixel_aligned_progress_bar_matches_byte_for_byte() {
    let Some(mut gpu) = executor() else { return };
    println!("progress.normal（bar-v1，像素边界对齐）：");
    for (progress, time) in PROGRESS_VALUES.into_iter().zip(PROGRESS_TIMES) {
        let quad = progress_quad("normal", progress, time);
        let rendered = gpu.render_quad(&quad).expect("GPU 渲染");
        let reference = cpu_progress("normal", progress, time);
        let measured = compare(&reference, &rendered);
        assert_within_budget(&format!("progress={progress}"), measured, SSIM_FLOOR_STRICT);
        assert_eq!(
            measured.max_deviation, 0,
            "progress={progress}: 像素边界对齐时应当逐字节相同"
        );
    }
}

/// **14 种 progress 全量**：strict 走三条结构性判据，visual 走 SSIM ≥ 0.96。
#[test]
fn every_progress_style_matches_the_cpu_reference() {
    let Some(mut gpu) = executor() else { return };
    for recipe in motion::preset_registry::timeline_progresses() {
        let body = recipe.progress().expect("progress 配方");
        println!(
            "progress.{}（{}，{}）：",
            recipe.id,
            body.recipe.algorithm.name(),
            body.determinism.name()
        );
        for (progress, time) in PROGRESS_VALUES.into_iter().zip(PROGRESS_TIMES) {
            let quad = progress_quad(&recipe.id, progress, time);
            let rendered = gpu.render_quad(&quad).expect("GPU 渲染");
            let reference = cpu_progress(&recipe.id, progress, time);
            let measured = compare(&reference, &rendered);
            let label = format!("progress={progress}");
            if is_strict(body.determinism) {
                assert_within_budget(&label, measured, SSIM_FLOOR_STRICT);
            } else {
                assert_visual(&label, measured);
            }
        }
    }
}

/// 超采样版：给 GPU 侧补一条与光栅器可比的抗锯齿，数字进 §13 的实施记录。
///
/// 结论（P5a 已测、P5b 复核）：**超采样帮不上忙**——边的羽化来自 shader 自己的
/// alpha 斜坡，不是锯齿，4× 的数字与 1× 基本重合。留着它是为了让"这条差异不是
/// 采样不足"这一点可复现。`rounded` 的圆角端是这一族里唯一有斜边的地方。
#[test]
fn the_supersampled_rounded_bar_reports_its_own_distribution() {
    let Some(mut gpu) = executor() else { return };
    println!("progress.rounded（bar-v1）{SUPERSAMPLE}× 超采样：");
    for (progress, time) in PROGRESS_VALUES.into_iter().zip(PROGRESS_TIMES) {
        let quad = progress_quad("rounded", progress, time);
        let rendered = gpu
            .render_quad_at(&quad, SUPERSAMPLE)
            .expect("GPU 超采样渲染");
        let reference = cpu_progress("rounded", progress, time);
        assert_within_budget(
            &format!("progress={progress}"),
            compare(&reference, &rendered),
            SSIM_FLOOR_STRICT,
        );
    }
}

// ── §8.7 的"乱序执行一遍"。

/// 五个取值**乱序**跑一遍，逐帧字节必须与顺序跑的结果相同。
///
/// 这是 ADR-E04 那条"乱序采样 = 顺序采样"契约在 **GPU 执行器**上的形式：
/// 管线缓存、uniform 写入都不得让上一帧影响下一帧。
#[test]
fn shuffled_instants_render_the_same_bytes_as_sorted_ones() {
    let Some(mut gpu) = executor() else { return };
    let render = |gpu: &mut GpuExecutor, index: usize| -> Vec<u8> {
        let quad = progress_quad("normal", PROGRESS_VALUES[index], PROGRESS_TIMES[index]);
        gpu.render_quad(&quad).expect("GPU 渲染").data().to_vec()
    };
    let sorted: Vec<Vec<u8>> = (0..PROGRESS_VALUES.len())
        .map(|index| render(&mut gpu, index))
        .collect();
    // `cases.json` 的置换是 40 项的，这里只需要五个取值的一个真置换。
    const SHUFFLE: [usize; 5] = [3, 0, 4, 1, 2];
    let mut shuffled = vec![Vec::new(); PROGRESS_VALUES.len()];
    for index in SHUFFLE {
        shuffled[index] = render(&mut gpu, index);
    }
    for (index, progress) in PROGRESS_VALUES.iter().enumerate() {
        assert_eq!(
            sorted[index], shuffled[index],
            "progress={progress} 的乱序结果不同"
        );
    }
    // 置换是**真置换**（不是恒等），否则这条测试什么都没测。
    let mut seen = SHUFFLE;
    seen.sort_unstable();
    assert_eq!(seen, [0, 1, 2, 3, 4]);
    assert_ne!(SHUFFLE, [0, 1, 2, 3, 4]);
}

// ── 回退骨架。

/// 拿不到 WGSL 的样式：`shader_for` 是 `None`，host 据此记一条回退并走 CPU。
///
/// 回退面现在有两块：注册表里没有的样式，以及 **visualizer 的全部 10 款**
/// （CPU 矢量配方，没有源码）。两种都走同一条 `ShaderMissing` 通路，画面都不
/// 受影响；progress 的 14 款则一个不漏都能查到源码。
#[test]
fn a_missing_shader_falls_back_instead_of_rendering_nothing() {
    use render_raster::plan::gpu_fallback::GpuFallbackReason;
    use render_raster::plan::shader_source::{ShaderDomain, shader_for};

    let mut report = GpuBackendReport {
        backend: Some("metal".to_owned()),
        records: Vec::new(),
    };
    assert!(report.is_fully_accelerated());
    for style in ["zz_not_a_style", "bars"] {
        assert!(
            shader_for(ShaderDomain::Visualizer, style).is_none(),
            "{style} 不该有源码"
        );
        report.push(
            Some((ShaderDomain::Visualizer, style.to_owned())),
            GpuFallbackReason::ShaderMissing,
            format!("visualizer 样式 \"{style}\" 没有 WGSL 实现"),
        );
    }
    assert_eq!(report.records.len(), 2);
    assert!(!report.is_fully_accelerated());
    assert!(report.lines()[0].contains("回退 CPU"));

    for recipe in motion::preset_registry::timeline_visualizers() {
        assert!(
            shader_for(ShaderDomain::Visualizer, &recipe.id).is_none(),
            "visualizer.{} 是 CPU 矢量配方，不该有源码",
            recipe.id
        );
    }
    for recipe in motion::preset_registry::timeline_progresses() {
        assert!(shader_for(ShaderDomain::Progress, &recipe.id).is_some());
    }
    assert!(shader_for(ShaderDomain::Progress, "zz_not_a_style").is_none());
}

// ── 诊断（`--ignored`）：把一条扫描线的两侧剖面打出来。
//
// 调 shader 时用它看"差在哪里"，而不是只看一个 SSIM 数字。

/// ```bash
/// cargo test -p bcut-render --features gpu --test gpu_conformance -- --ignored --nocapture profile
/// ```
#[test]
#[ignore = "诊断用，不进常规验收"]
fn print_a_scanline_profile() {
    let Some(mut gpu) = executor() else { return };
    let (progress, time) = (PROGRESS_VALUES[2], PROGRESS_TIMES[2]);
    let quad = progress_quad("rounded", progress, time);
    let rendered = gpu.render_quad(&quad).unwrap();
    let reference = cpu_progress("rounded", progress, time);
    {
        use render_raster::drawop::DrawOp;
        let recipe = timeline_progress("rounded").unwrap();
        let mut builder = FrameBuilder::default();
        progress_frame(
            &mut builder,
            recipe,
            &progress_params(),
            progress,
            time,
            PROGRESS_BOX,
            TF,
        );
        for op in builder.frame.ops.iter().take(3) {
            if let DrawOp::FillRect { x, y, w, h, .. } = op {
                println!("CPU FillRect x={x} y={y} w={w} h={h}");
            }
        }
    }
    let w = reference.width() as usize;
    let row = (reference.height() / 2) as usize;
    println!("x  cpu.a gpu.a   （盒宽 {w}，中线 y={row}）");
    for x in 0..60 {
        let base = (row * w + x) * 4;
        println!(
            "{x:>3} {:>5} {:>5}",
            reference.data()[base + 3],
            rendered.data()[base + 3]
        );
    }
}

/// 诊断：把某个样式的 CPU / GPU 差异画成 ASCII 图，外加中线上的一条 R 通道剖面。
///
/// 调 shader 时用它看"差在哪里"，而不是只看一个 SSIM 数字——结构性偏移
/// （错位、翻转、接缝）都会先在这张图上露出来。
///
/// ```bash
/// BCUT_DIFF_STYLE=circle cargo test -p bcut-render --features gpu \
///     --test gpu_conformance -- --ignored --nocapture diff_map
/// ```
#[test]
#[ignore = "诊断用，不进常规验收"]
fn print_a_diff_map() {
    let Some(mut gpu) = executor() else { return };
    let style = std::env::var("BCUT_DIFF_STYLE").unwrap_or_else(|_| "normal".to_owned());
    let (progress, time) = (PROGRESS_VALUES[2], PROGRESS_TIMES[2]);
    let quad = progress_quad(&style, progress, time);
    let rendered = gpu.render_quad(&quad).expect("GPU 渲染");
    let reference = cpu_progress(&style, progress, time);
    let (w, h) = (reference.width() as usize, reference.height() as usize);
    let cell = (w / 60).max(1);
    println!("{style}: {w}x{h}, cell={cell}");
    // `#` 两边都有、`.` 两边都没有、`C` 只有 CPU、`G` 只有 GPU（按 R 通道过半）。
    for row in (0..h).step_by(cell) {
        let mut line = String::new();
        for col in (0..w).step_by(cell) {
            let base = (row * w + col) * 4;
            let (a, b) = (reference.data()[base], rendered.data()[base]);
            line.push(match (a > 128, b > 128) {
                (true, true) => '#',
                (false, false) => '.',
                (true, false) => 'C',
                (false, true) => 'G',
            });
        }
        println!("{line}");
    }
    // 中线上的一条剖面：结构性偏移在这里表现为"整条曲线错开一两格"。
    let mid = h / 2;
    let window = (w / 4)..(w / 4 + 60).min(w);
    for (label, pixmap) in [("cpu", &reference), ("gpu", &rendered)] {
        print!("profile {label}:");
        for x in window.clone() {
            print!("{:>4}", pixmap.data()[(mid * w + x) * 4]);
        }
        println!();
    }
}
