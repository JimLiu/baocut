//! Render Graph（设计 §6 / ADR-M04）：`FramePlan { surfaces, passes, output }`
//! 表达滤镜、遮罩、混合与双画面转场，DrawOp 退回「单 surface 原语」的本职。
//!
//! `FramePlan = f(resolvedDocument, data, registryVersions, capabilityProfile, t)`
//! ——不依赖上一帧、播放顺序、运行时随机或网络。**无 effect 的文档折叠成
//! 单个 Draw pass**，执行器对它直接调 `raster::rasterize_with_media`，与既有
//! `record(t)` 路径逐字节相同（[`FramePlan::is_folded`]）。

pub mod cache;
pub mod capability;
pub mod executor_cpu;
/// wgpu 后端（元素方案 ADR-E06）。默认关闭，见 `Cargo.toml` 的 `gpu` feature。
#[cfg(feature = "gpu-runtime")]
pub mod executor_gpu;
pub mod frame_plan;
pub mod gpu_fallback;
pub mod pass;
pub mod shader_quad;
pub mod shader_source;
pub mod surface;

pub use cache::{DEFAULT_SURFACE_CACHE_BYTES, SurfaceCache};
pub use capability::{
    CPU_BACKEND, CPU_BACKEND_VERSION, CapabilityProfile, FallbackRecord, PreflightDiagnostic,
    PreflightReport, preflight, preflight_effects,
};
pub use executor_cpu::{
    CpuExecutor, PassExecutor, composite_bounded, execute_plan, execute_plan_with_fingerprints,
    execute_plan_with_inputs,
};
#[cfg(feature = "gpu-runtime")]
pub use executor_gpu::GpuExecutor;
#[cfg(feature = "wgsl-validate")]
pub use executor_gpu::validate_wgsl;
pub use frame_plan::{FRAME_PLAN_VERSION, FramePlan, encode_plan};
pub use gpu_fallback::{GpuBackendReport, GpuFallbackReason, GpuFallbackRecord};
pub use pass::RenderPass;
pub use shader_quad::{
    AudioTexture, ProgressUniforms, QuadTarget, QuadUniforms, RecipeUniform, ShaderQuad,
    TransformUniforms, UniformBinding, VisualizerUniforms,
};
pub use shader_source::{
    FRAGMENT_ENTRY, SHADER_SOURCES, ShaderDomain, ShaderSource, VERTEX_ENTRY, shader_for,
};
pub use surface::{CompositeInput, SurfaceId, SurfaceLifetime, SurfacePlan};

use crate::fonts::TextEngine;
use crate::renderer::FrameRenderer;
use anyhow::Result;
pub use motion::effect::{BlendMode, EffectRef};
use scene_primitives::resolve::Ir;

/// `BlendMode` → tiny-skia。实现在 [`crate::effects::composite::blend`]，
/// 这里只保留 `plan::` 下的历史入口。
pub use crate::effects::blend_to_skia;

/// 文档的效果拓扑。编译期算一次：为空 ⇒ 每一帧都折叠成单 Draw pass。
///
/// 「需要离屏 surface」= 元素有非空 `effects[]`（规范 §6.6），或者有一条
/// `blur` 通道（等价于效果栈末尾的隐式 `filter.blur`）。`blendMode` 与
/// `clipPath` **不**在其列：它们是单 surface 语义，DrawOp v3 直接表达。
#[derive(Debug, Clone, Default, PartialEq)]
pub struct EffectTopology {
    /// 需要独立离屏 surface 的节点数（0 且没有 Surface Transition ⇒ 折叠）。
    pub surface_nodes: usize,
    /// 全部被引用的效果（去重、有序）。preflight 与 `fallbacks[]` 用它。
    pub effects: Vec<EffectRef>,
    /// 声明为 Surface Transition 的剪辑点数（规范 §9）。它们要两张离屏
    /// surface 加一个 `Transition` pass，因此同样破坏折叠。
    pub surface_transitions: usize,
}

impl EffectTopology {
    pub fn is_empty(&self) -> bool {
        self.surface_nodes == 0 && self.surface_transitions == 0
    }

    /// 扫描 IR 决定哪些节点需要离屏 surface。
    pub fn of(ir: &Ir) -> Self {
        let mut out = EffectTopology::default();
        for clip in &ir.visual_clips {
            out.scan(&clip.tree);
        }
        out.surface_transitions = ir.surface_transitions.len();
        out
    }

    fn scan(&mut self, node: &scene_primitives::resolve::RNode) {
        // 元素级 `blur` 通道与文字 part 的 `blur` 通道（§6.4 分词模糊）都落成
        // 隐式 `filter.blur` 的离屏层。
        let blur = node.channels.iter().any(|channel| channel.prop == "blur")
            || node.part_motion.as_ref().is_some_and(|parts| {
                parts
                    .channels
                    .iter()
                    .flatten()
                    .any(|channel| channel.prop == "blur")
            });
        if node.composition.is_some()
            || node.echo.is_some()
            || !node.effects.is_empty()
            || !node.backdrop_effects.is_empty()
            || blur
        {
            self.surface_nodes += 1;
            for effect in node.effects.iter().chain(&node.backdrop_effects) {
                if !self.effects.contains(&effect.effect) {
                    self.effects.push(effect.effect.clone());
                }
            }
            if blur {
                let implicit = EffectRef::new("filter.blur", 1);
                if !self.effects.contains(&implicit) {
                    self.effects.push(implicit);
                }
            }
        }
        for child in &node.children {
            self.scan(child);
        }
    }

    /// 组合限制由 core 的依赖检查及执行后端的能力检查负责。
    pub fn conflicts(_ir: &Ir) -> Vec<String> {
        Vec::new()
    }
}

/// 每帧计划的编译器。创建期跑一次 preflight 与拓扑扫描，逐帧只发计划。
pub struct FramePlanner {
    caps: CapabilityProfile,
    capability_fingerprint: u64,
    topology: EffectTopology,
    report: PreflightReport,
    /// 跑不动、要退回 Motion 通道的 Surface Transition（按 `from_clip` 的 id）。
    /// CPU reference 上恒为空——四条内置转场都是 strict 且有实现。
    transition_fallbacks: std::collections::BTreeSet<String>,
}

impl FramePlanner {
    /// 创建期完成 preflight（设计 §6.5：正式逐帧前必须做完）。
    pub fn compile(ir: &Ir, caps: CapabilityProfile) -> Result<Self> {
        let report = preflight(ir, &caps)?;
        // `preflight` 已经把降级记进了报告，这里只要同一份名单（同一个纯函数、
        // 同一份输入 ⇒ 同一个结果）。
        let mut probe = PreflightReport::default();
        let transition_fallbacks = capability::preflight_transitions(ir, &caps, &mut probe);
        let capability_fingerprint = caps.fingerprint();
        Ok(FramePlanner {
            caps,
            capability_fingerprint,
            topology: EffectTopology::of(ir),
            report,
            transition_fallbacks,
        })
    }

    /// CPU reference 后端的便捷入口。
    pub fn cpu(ir: &Ir) -> Result<Self> {
        FramePlanner::compile(ir, CapabilityProfile::cpu_reference())
    }

    /// CPU reference + **host 侧资源诊断**。
    ///
    /// preflight 本身只看 `Ir`（纯函数，没有字节），可 Lottie 的
    /// `lottie-unsupported-feature` warn 是解析素材时才知道的事——被忽略的
    /// 表达式控制器组在 `load_assets` 里记账，在这里并进同一份报告，于是
    /// `bcut render --json` / `bcut ops` 的 `diagnostics` 一处就能看全。
    /// fail 级不走这条路：那种素材在 `load_assets` 就是 `Err`。
    #[cfg(feature = "media")]
    pub fn cpu_with_assets(ir: &Ir, assets: &crate::assets::LoadedAssets) -> Result<Self> {
        let mut planner = FramePlanner::cpu(ir)?;
        planner
            .report
            .diagnostics
            .extend(assets.source_diagnostics.iter().cloned());
        Ok(planner)
    }

    pub fn capabilities(&self) -> &CapabilityProfile {
        &self.caps
    }

    pub fn capability_fingerprint(&self) -> u64 {
        self.capability_fingerprint
    }

    pub fn report(&self) -> &PreflightReport {
        &self.report
    }

    pub fn topology(&self) -> &EffectTopology {
        &self.topology
    }

    /// 本次编译里降级成 Motion Transition 的剪辑点（按 `from_clip` 的 id）。
    pub fn transition_fallbacks(&self) -> &std::collections::BTreeSet<String> {
        &self.transition_fallbacks
    }

    /// 编排 `t` 时刻的计划。录制走的是同一个 `FrameRenderer::record`——
    /// 折叠路径上不存在「第二个录制器」。
    pub fn plan(
        &self,
        renderer: &FrameRenderer,
        ir: &Ir,
        engine: &mut TextEngine,
        t: f64,
    ) -> FramePlan {
        if self.topology.is_empty() {
            let ops = renderer.record(ir, engine, t);
            return self.plan_from_ops(renderer.width, renderer.height, ops);
        }
        let frame = renderer.record_layered_with(ir, engine, t, &self.transition_fallbacks);
        FramePlan::from_layers(
            renderer.width,
            renderer.height,
            frame.layers,
            self.capability_fingerprint,
        )
    }

    /// 计划 + 执行的单帧便捷入口。
    ///
    /// **单帧渲染必须走这里**，不能直接调 [`FrameRenderer::draw`]：后者是
    /// 平坦路径，效果栈是 `Filter` pass、不在指令流里，绕过计划就等于把
    /// `effects[]` / `blur` 静默丢掉。无效果的文档在这条路上折叠成单个
    /// Draw pass，执行器直接调 `rasterize_with_media`——与 `draw` 逐字节相同。
    #[cfg(feature = "media")]
    pub fn render(
        &self,
        renderer: &FrameRenderer,
        ir: &Ir,
        engine: &mut TextEngine,
        media: &mut crate::media::MediaStore,
        t: f64,
    ) -> Result<tiny_skia::Pixmap> {
        let plan = self.plan(renderer, ir, engine, t);
        let mut executor = CpuExecutor::new(self.caps.clone());
        execute_plan(&plan, &mut executor, media, None)
    }

    /// 已有指令流时的入口（overlay 路径与测试用）。
    pub fn plan_from_ops(
        &self,
        width: u32,
        height: u32,
        ops: crate::drawop::FrameOps,
    ) -> FramePlan {
        debug_assert!(
            self.topology.is_empty(),
            "非空效果拓扑必须走 4B 的分支，而不是折叠"
        );
        FramePlan::single_draw(width, height, ops, self.capability_fingerprint)
    }
}
