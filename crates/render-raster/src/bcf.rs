//! 已准备的 BCF 文档：native、WASM 和导出共用的布局、录制与帧计划入口。
//!
//! 调用方先加载资源并 resolve，再创建本会话。会话不读文件、不解码媒体、
//! 不拥有播放时钟。文档或资源内容改变时创建新会话，准备成功后再原子替换旧会话。

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use anyhow::{Result, bail};
use scene_primitives::resolve::Ir;

use crate::source::Lottie;
use crate::{
    CapabilityProfile, CpuExecutor, FrameMedia, FramePlan, FramePlanner, FrameRenderer,
    PreflightReport, SurfaceCache, TextEngine, execute_plan, execute_plan_with_fingerprints,
};

/// 不含宿主资源句柄的已准备文档。每个渲染 worker 持有自己的会话。
pub struct PreparedBcf {
    compiled: Arc<Compiled>,
    text: TextEngine,
    surfaces: SurfaceCache,
}

/// 准备完就只读的那部分：布局后的 IR、动画编译与帧计划器。并行 worker 共享这一份，
/// 各自只带文字引擎与执行器（与 `bcut render` 的逐核分工同一个切法）。
struct Compiled {
    ir: Ir,
    renderer: FrameRenderer,
    planner: FramePlanner,
}

impl PreparedBcf {
    /// 对已注入媒体元数据的 IR 完成布局、动画编译与能力预检。
    /// `text` 的字体和 `lotties` 均由宿主提供，不能在采样时补载。
    pub fn new(
        mut ir: Ir,
        mut text: TextEngine,
        lotties: &HashMap<String, Arc<Lottie>>,
        capabilities: CapabilityProfile,
    ) -> Result<Self> {
        let renderer = FrameRenderer::new_with_lotties(&mut ir, &mut text, lotties)?;
        let planner = FramePlanner::compile(&ir, capabilities)?;
        Ok(Self {
            compiled: Arc::new(Compiled {
                ir,
                renderer,
                planner,
            }),
            text,
            surfaces: SurfaceCache::with_frame_cap(16),
        })
    }

    /// 只读已布局的文档；音频计划、场景时间轴和媒体需求由宿主消费。
    pub fn ir(&self) -> &Ir {
        &self.compiled.ir
    }

    pub fn report(&self) -> &PreflightReport {
        self.compiled.planner.report()
    }

    /// 独立采样任意非负项目时刻，不依赖此前播放或 seek 顺序。
    /// 不隐式量化或钳制末帧；播放控制与导出使用各自显式的采样时刻。
    pub fn plan(&mut self, time: f64) -> Result<FramePlan> {
        if !time.is_finite() || time < 0.0 {
            bail!("bcf-time-invalid: 采样时刻必须是非负有限秒数");
        }
        Ok(self.compiled.plan(&mut self.text, time))
    }

    /// 并行渲染的共享句柄：布局与帧计划器只读共享，可以搬进别的线程，在那边
    /// [`SharedBcf::worker`] 起各自的渲染单元。
    pub fn shared(&self) -> SharedBcf {
        SharedBcf(self.compiled.clone())
    }

    /// CPU reference 的执行入口。媒体帧通过显式 host 边界提供；GPU 调用方消费
    /// [`Self::plan`]，不能用平坦 DrawOp 路径替代带效果的计划。
    pub fn render_cpu<M: FrameMedia>(
        &mut self,
        time: f64,
        media: &mut M,
    ) -> Result<tiny_skia::Pixmap> {
        self.render_cpu_width(time, media, self.compiled.renderer.width)
    }

    /// 只改变光栅分辨率，保持作者画布、布局与时钟：预览按舞台宽度，导出按成片里
    /// 需要的宽度（可以大于作者宽度，受 `max_surface` 限制）。
    pub fn render_cpu_width<M: FrameMedia>(
        &mut self,
        time: f64,
        media: &mut M,
        width: u32,
    ) -> Result<tiny_skia::Pixmap> {
        if self.compiled.planner.capabilities() != &CapabilityProfile::cpu_reference() {
            bail!("frameplan-capability-mismatch: CPU 执行需要按 CPU 能力准备会话");
        }
        self.compiled.check_width(width)?;
        let mut plan = self.plan(time)?;
        self.compiled.scale_to(&mut plan, width)?;
        execute_plan(
            &plan,
            &mut CpuExecutor::default(),
            media,
            Some(&self.surfaces),
        )
    }
}

impl Compiled {
    fn plan(&self, text: &mut TextEngine, time: f64) -> FramePlan {
        self.planner.plan(&self.renderer, &self.ir, text, time)
    }

    fn check_width(&self, width: u32) -> Result<()> {
        if width == 0 || width > self.planner.capabilities().max_surface {
            bail!("bcf-preview-size-invalid: {width}");
        }
        Ok(())
    }

    /// Rescale an author-width plan to `width`: every surface and draw transform
    /// scales, a Transform pass only moves (its input and output both scale).
    /// Fingerprints are taken afterwards, so they already cover the size.
    fn scale_to(&self, plan: &mut FramePlan, width: u32) -> Result<()> {
        if width == self.renderer.width {
            return Ok(());
        }
        let scale = width as f32 / self.renderer.width as f32;
        let max_surface = self.planner.capabilities().max_surface;
        for surface in &mut plan.surfaces {
            surface.width = (surface.width as f32 * scale).round().max(1.0) as u32;
            surface.height = (surface.height as f32 * scale).round().max(1.0) as u32;
            if surface.width > max_surface || surface.height > max_surface {
                bail!("bcf-preview-size-invalid: surface 边长超出上限");
            }
        }
        for pass in &mut plan.passes {
            if let crate::RenderPass::Transform { tf, .. } = pass {
                tf[4] *= scale;
                tf[5] *= scale;
            }
            if let crate::RenderPass::Draw { ops, .. } = pass {
                for op in &mut ops.ops {
                    use crate::drawop::DrawOp;
                    let tf = match op {
                        DrawOp::FillRect { tf, .. }
                        | DrawOp::FillPath { tf, .. }
                        | DrawOp::StrokePath { tf, .. }
                        | DrawOp::DrawMedia { tf, .. }
                        | DrawOp::ClipPath { tf, .. }
                        | DrawOp::FillPathPaint { tf, .. }
                        | DrawOp::StrokePathPaint { tf, .. }
                        | DrawOp::DrawBitmap { tf, .. } => Some(tf),
                        DrawOp::Clear { .. }
                        | DrawOp::PushLayer { .. }
                        | DrawOp::PopLayer
                        | DrawOp::PopClip
                        | DrawOp::PushMatte
                        | DrawOp::PopMatte { .. } => None,
                    };
                    if let Some(tf) = tf {
                        for component in tf {
                            *component *= scale;
                        }
                    }
                }
            }
        }
        Ok(())
    }
}

/// [`PreparedBcf::shared`] 的句柄。克隆只加一次引用计数。
#[derive(Clone)]
pub struct SharedBcf(Arc<Compiled>);

impl SharedBcf {
    pub fn ir(&self) -> &Ir {
        &self.0.ir
    }

    /// 一个渲染单元。文字引擎由调用方按同一套字体另建（`TextEngine::for_document`），
    /// 与 `bcut render` 每个 worker 一份的做法相同。
    pub fn worker(&self, text: TextEngine) -> BcfFrameWorker {
        BcfFrameWorker {
            compiled: self.0.clone(),
            text,
            executor: CpuExecutor::new(self.0.planner.capabilities().clone()),
        }
    }
}

/// [`SharedBcf::worker`] 拿到的并行渲染单元：CPU reference，与
/// [`PreparedBcf::render_cpu_width`] 出同样的像素。先 [`Self::plan`]（原宽度）或
/// [`Self::plan_width`] 拿计划与帧指纹，调用方可以按指纹复用已有的整帧，未命中再
/// [`Self::execute`]。
pub struct BcfFrameWorker {
    compiled: Arc<Compiled>,
    text: TextEngine,
    executor: CpuExecutor,
}

impl BcfFrameWorker {
    /// `time` 的帧计划与它的 surface 指纹表（整帧指纹在表里 `plan.output` 那一格，
    /// 也作为元组第二项单独给出）。
    pub fn plan(&mut self, time: f64) -> Result<(FramePlan, u64, BTreeMap<u32, u64>)> {
        if !time.is_finite() || time < 0.0 {
            bail!("bcf-time-invalid: 采样时刻必须是非负有限秒数");
        }
        let plan = self.compiled.plan(&mut self.text, time);
        let (frame, fingerprints) = plan.frame_fingerprints()?;
        Ok((plan, frame, fingerprints))
    }

    /// [`Self::plan`] at `width` pixels, the same rescale as
    /// [`PreparedBcf::render_cpu_width`]; fingerprints cover the scaled plan.
    pub fn plan_width(
        &mut self,
        time: f64,
        width: u32,
    ) -> Result<(FramePlan, u64, BTreeMap<u32, u64>)> {
        if !time.is_finite() || time < 0.0 {
            bail!("bcf-time-invalid: 采样时刻必须是非负有限秒数");
        }
        self.compiled.check_width(width)?;
        let mut plan = self.compiled.plan(&mut self.text, time);
        self.compiled.scale_to(&mut plan, width)?;
        let (frame, fingerprints) = plan.frame_fingerprints()?;
        Ok((plan, frame, fingerprints))
    }

    /// 执行 [`Self::plan`] 给出的计划；`fingerprints` 必须是同一次 `plan` 的那张表。
    pub fn execute<M: FrameMedia>(
        &mut self,
        plan: &FramePlan,
        fingerprints: &BTreeMap<u32, u64>,
        media: &mut M,
        surfaces: Option<&SurfaceCache>,
    ) -> Result<tiny_skia::Pixmap> {
        execute_plan_with_fingerprints(plan, &mut self.executor, media, surfaces, fingerprints)
    }
}
