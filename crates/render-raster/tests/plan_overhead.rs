//! `media` 门内：本文件用 `LoadedAssets` / `MediaStore` / `FrameRenderer`
//! （BCF 文档渲染链路与 host 字节层），`wasm-safe` 构建里不存在（设计 §9.1）。
#![cfg(feature = "media")]

//! FramePlan 的编排开销微基准（设计 §12：无 effect 项目不得因 Render Graph
//! 回退性能）。默认 `#[ignore]`——它测的是墙钟，进 CI 会因为机器负载假红。
//!
//! ```bash
//! cd core && cargo test -p bcut-render --release --test plan_overhead -- --ignored --nocapture
//! ```
//!
//! **先让机器闲下来再跑**：阈值按空载校准。实测在并行 `cargo build`（load ≈ 8）
//! 下比值会飘到 0.80–1.26——那是调度噪声，不是回退。

use anyhow::anyhow;
use render_raster::plan::{CpuExecutor, FramePlanner, execute_plan};
use render_raster::{FrameMedia, FrameRenderer, TextEngine};
use scene_primitives::HostInputs;
use scene_primitives::resolve::{Ir, Resolver};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tiny_skia::{Pixmap, PremultipliedColorU8};

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
    resolver.resolve().unwrap()
}

/// 程序生成的确定性位图媒体源，供 `media-demo` 的三个视觉资源使用。
///
/// 为什么不是 `MediaStore`：`MediaStore` 的视频通道要 `ffmpeg` + 真实 mp4，
/// 微基准不该依赖外部进程；而只填 `LoadedAssets::images` 的话，`clip` 那 4 秒
/// （全片 210 帧里的 120 帧）仍然会在 `DrawMedia` 处提前返回 Err。`FrameMedia`
/// 是公开 trait，两条被比较的路径拿的是**同一个实例**，因此媒体供给的代价在
/// 分子分母上完全对消，比较仍然公平。
struct DemoMedia {
    frames: HashMap<&'static str, Arc<Pixmap>>,
    /// 被真正取过多少次图。用来钉住「这次跑确实在光栅化媒体」。
    hits: usize,
}

impl DemoMedia {
    /// 尺寸取 `media_demo_ir()` 声明的固有尺寸：缩放到 960×540 画布的重采样
    /// 工作量与真实素材一致。
    fn new() -> Self {
        DemoMedia {
            frames: HashMap::from([
                ("card", gradient(640, 360, 0)),
                ("logo", gradient(128, 128, 1)),
                ("clip", gradient(1280, 720, 2)),
            ]),
            hits: 0,
        }
    }
}

impl FrameMedia for DemoMedia {
    fn frame(&mut self, id: &str, _media_ms: i64) -> anyhow::Result<Arc<Pixmap>> {
        self.hits += 1;
        self.frames
            .get(id)
            .cloned()
            .ok_or_else(|| anyhow!("测试媒体源没有资源 \"{id}\""))
    }
}

/// 纯函数梯度位图：只依赖 `(width, height, seed)`——无随机、无时间、无 I/O，
/// 满足 BCF 的确定性要求，同一次构建的每一轮迭代看到逐字节相同的像素。
///
/// 全部不透明（alpha=255）⇒ 预乘与直通同值，构造本身不引入额外颜色语义。
fn gradient(width: u32, height: u32, seed: u32) -> Arc<Pixmap> {
    let mut pixmap = Pixmap::new(width, height).expect("尺寸非零");
    for (index, pixel) in pixmap.pixels_mut().iter_mut().enumerate() {
        let x = index as u32 % width;
        let y = index as u32 / width;
        let r = (x * 255 / width) as u8;
        let g = (y * 255 / height) as u8;
        let b = (seed.wrapping_mul(83) as u8) ^ ((x ^ y) as u8);
        *pixel = PremultipliedColorU8::from_rgba(r, g, b, 255).expect("alpha=255 恒合法");
    }
    Arc::new(pixmap)
}

/// `plan(t) + execute_plan` 的墙钟不得明显超过 `record(t) + rasterize`。
///
/// 两侧做完全相同的工作量（同一份 [`DemoMedia`]、同一条指令流），差的只有
/// 「构计划 + 折叠判定 + surface 指纹」这一段。守卫量两条比值：
///
/// 1. **编排段**（`plan + frame_fingerprint` vs `record + drawop::fingerprint`，
///    都不执行）。灵敏度全在这条上：编排本身只占整帧的百分之几，掺进光栅化
///    再比就被稀释到测不出来了。
/// 2. **端到端**（各自再加上执行/光栅化）。它保证的是另一件事：计划路径没有
///    多做像素工作。分母含整幅重采样，所以它对编排段的回归天然迟钝——两条
///    都要，缺一条守卫就有盲区。
///
/// **覆盖范围**：比较的是通用 API 对（`rasterize_with_media` vs `execute_plan`）。
/// 模板导出的生产路径（`video.rs`）自 56232949 起改用 `frame_fingerprints` +
/// `execute_plan_with_fingerprints`，它**更便宜**（少一次指纹编码、少一次
/// `validate`），所以这里量到的是生产路径开销的上界。`media-demo` 无 effect ⇒
/// 计划是折叠形态，两个执行入口在折叠分支上本就同一条代码路径，差别只有
/// `execute_plan` 多跑的那次 `plan.validate()`；非折叠计划的指纹表复用不在本
/// 守卫的覆盖范围内。
///
/// **阈值校准**（Apple Silicon M 系，`--release`，空载，交替先后 + 取最小值，
/// 连跑 9 次进程的实测区间）：
///
/// - 编排段单帧 ≈ 0.017ms，比值 **1.016–1.025**。这 2% 是**系统性**的，不是噪声：
///   计划路径要多构 `FramePlan`（surfaces/passes 两个 Vec）、多跑一次
///   `is_folded` 与 `validate`，指纹还多经一层 `BTreeMap`。阈值取 1.05 ⇒ 在
///   系统性基线之上还留一倍多余量吃 CI 噪声。灵敏度实测：往计划腿注入一次多余
///   的 `frame_fingerprint()`（即「每帧多编码一遍指令流」）⇒ 比值 **1.327**，
///   远在阈值之上。
/// - 端到端单帧 ≈ 3.6ms（媒体真正参与重采样；此前空 `MediaStore` 提前返回时
///   只有 0.017ms，两侧根本没光栅化），比值 **0.997–1.005** ⇒ 阈值 1.03。
///   同一次注入实验里这条腿只动到 1.005 —— 它测不出编排段的回归，这正是必须
///   保留上面那条腿的理由。
#[test]
#[ignore = "墙钟微基准；手动跑 --release"]
fn folded_plan_orchestration_and_execution_stay_within_budget() {
    let mut ir = media_demo_ir();
    let mut engine = TextEngine::new();
    let renderer = FrameRenderer::new(&mut ir, &mut engine).unwrap();
    let planner = FramePlanner::cpu(&ir).unwrap();
    let mut executor = CpuExecutor::new(planner.capabilities().clone());
    let mut media = DemoMedia::new();

    let total_frames = (ir.total * ir.fps).round() as usize;
    let times: Vec<f64> = (0..total_frames).map(|f| f as f64 / ir.fps).collect();

    // 预热（字形/布局缓存）**兼**正确性前置：两条路径都必须跑完光栅化并画出
    // 同一帧。空 MediaStore 的旧形态就是败在这里——两侧都在第一条 `DrawMedia`
    // 处 `Err` 返回，守卫只在比较「录制指令流」的开销，执行期回归照样能过。
    for t in &times {
        let ops = renderer.record(&ir, &mut engine, *t);
        let direct =
            render_raster::rasterize_with_media(&ops, renderer.width, renderer.height, &mut media)
                .expect("baseline 路径必须完成光栅化");
        let plan = planner.plan(&renderer, &ir, &mut engine, *t);
        let planned =
            execute_plan(&plan, &mut executor, &mut media, None).expect("计划路径必须完成光栅化");
        assert_eq!(
            direct.data(),
            planned.data(),
            "t={t:.4}s：折叠计划与直接光栅化必须逐字节相同"
        );
    }
    assert!(
        media.hits > 0,
        "整片一次 DrawMedia 都没有 ⇒ 分母里没有媒体光栅化，守卫是空转的"
    );

    // 两条腿在每轮里**交替先后**：机器的频率/热漂移在一次测量内是单调的，
    // 固定「总是后跑」的那条腿会被系统性惩罚（实测能把端到端比值抬到 1.11）。
    //
    // 编排段一轮只有几毫秒，轮数拉到 24 让 min 收敛（总代价不足 0.2s）；端到端
    // 一轮要 0.8s（整幅重采样），6 轮就够。
    let mut record_only = f64::INFINITY;
    let mut plan_only = f64::INFINITY;
    for round in 0..24 {
        for leg in 0..2 {
            let is_record = (leg == 0) == (round % 2 == 0);
            let start = Instant::now();
            if is_record {
                for t in &times {
                    let ops = renderer.record(&ir, &mut engine, *t);
                    std::hint::black_box(render_raster::drawop::fingerprint(&ops));
                }
            } else {
                for t in &times {
                    let plan = planner.plan(&renderer, &ir, &mut engine, *t);
                    std::hint::black_box(plan.frame_fingerprint().unwrap());
                }
            }
            let elapsed = start.elapsed().as_secs_f64();
            if is_record {
                record_only = record_only.min(elapsed);
            } else {
                plan_only = plan_only.min(elapsed);
            }
        }
    }

    let mut record_full = f64::INFINITY;
    let mut plan_full = f64::INFINITY;
    for round in 0..6 {
        for leg in 0..2 {
            let is_record = (leg == 0) == (round % 2 == 0);
            let start = Instant::now();
            if is_record {
                for t in &times {
                    let ops = renderer.record(&ir, &mut engine, *t);
                    let fingerprint = render_raster::drawop::fingerprint(&ops);
                    let frame = render_raster::rasterize_with_media(
                        &ops,
                        renderer.width,
                        renderer.height,
                        &mut media,
                    );
                    std::hint::black_box((fingerprint, frame.is_ok()));
                }
            } else {
                for t in &times {
                    let plan = planner.plan(&renderer, &ir, &mut engine, *t);
                    let fingerprint = plan.frame_fingerprint().unwrap();
                    let frame = execute_plan(&plan, &mut executor, &mut media, None);
                    std::hint::black_box((fingerprint, frame.is_ok()));
                }
            }
            let elapsed = start.elapsed().as_secs_f64();
            if is_record {
                record_full = record_full.min(elapsed);
            } else {
                plan_full = plan_full.min(elapsed);
            }
        }
    }

    let orchestration = plan_only / record_only;
    let end_to_end = plan_full / record_full;
    println!(
        "{total_frames} 帧 · 编排段 record {record_only:.4}s vs plan {plan_only:.4}s（{orchestration:.4}×）\
         · 端到端 {record_full:.4}s vs {plan_full:.4}s（{end_to_end:.4}×）"
    );
    assert!(
        orchestration <= 1.05,
        "编排段开销超过 5%：record+fingerprint {record_only:.4}s vs plan+fingerprint {plan_only:.4}s（{orchestration:.4}×）"
    );
    assert!(
        end_to_end <= 1.03,
        "端到端开销超过 3%：record+rasterize {record_full:.4}s vs plan+execute {plan_full:.4}s（{end_to_end:.4}×）"
    );
}
