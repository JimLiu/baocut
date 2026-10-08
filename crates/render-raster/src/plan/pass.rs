//! `RenderPass`：绘制、滤镜、双画面转场、合成、遮罩与背景滤镜。
//! DrawOp 只出现在 `Draw` 里，其余 pass 只处理 surface。

use super::surface::{CompositeInput, SurfaceId};
use crate::drawop::FrameOps;
use motion::effect::{EffectRef, UniformMap};

#[derive(Debug)]
pub enum RenderPass {
    /// DrawOp v3 指令流 → 单张 surface。
    Draw { target: SurfaceId, ops: FrameOps },
    Filter {
        input: SurfaceId,
        output: SurfaceId,
        effect: EffectRef,
        uniforms: UniformMap,
    },
    Transition {
        from: SurfaceId,
        to: SurfaceId,
        output: SurfaceId,
        effect: EffectRef,
        /// 闭区间 `[0, 1]`：0 逐字节等于 `from`，1 逐字节等于 `to`。
        progress: f32,
        uniforms: UniformMap,
    },
    /// Applies a rendered alpha/luma mask after the input subtree has completed.
    Mask {
        input: SurfaceId,
        mask: SurfaceId,
        output: SurfaceId,
        mode: crate::drawop::MatteMode,
    },
    Backdrop {
        base: SurfaceId,
        filtered: SurfaceId,
        mask: SurfaceId,
        output: SurfaceId,
        opacity: f32,
    },
    Transform {
        input: SurfaceId,
        output: SurfaceId,
        tf: crate::drawop::Mat6,
    },
    Accumulate {
        inputs: Vec<(SurfaceId, f64)>,
        output: SurfaceId,
    },
    Composite {
        inputs: Vec<CompositeInput>,
        output: SurfaceId,
    },
}

impl RenderPass {
    pub fn output(&self) -> SurfaceId {
        match self {
            RenderPass::Draw { target, .. } => *target,
            RenderPass::Filter { output, .. }
            | RenderPass::Transition { output, .. }
            | RenderPass::Accumulate { output, .. }
            | RenderPass::Transform { output, .. }
            | RenderPass::Backdrop { output, .. }
            | RenderPass::Mask { output, .. }
            | RenderPass::Composite { output, .. } => *output,
        }
    }

    /// 依赖的输入 surface（不含 output 自身）。指纹与拓扑校验都用它。
    pub fn inputs(&self) -> Vec<SurfaceId> {
        match self {
            RenderPass::Draw { .. } => Vec::new(),
            RenderPass::Filter { input, .. } | RenderPass::Transform { input, .. } => vec![*input],
            RenderPass::Transition { from, to, .. } => vec![*from, *to],
            RenderPass::Backdrop {
                base,
                filtered,
                mask,
                ..
            } => vec![*base, *filtered, *mask],
            RenderPass::Mask { input, mask, .. } => vec![*input, *mask],
            RenderPass::Accumulate { inputs, .. } => inputs.iter().map(|(id, _)| *id).collect(),
            RenderPass::Composite { inputs, .. } => inputs
                .iter()
                .flat_map(|input| std::iter::once(input.surface).chain(input.mask.into_iter()))
                .collect(),
        }
    }

    /// 编码/诊断用的稳定标签。
    pub fn tag(&self) -> u8 {
        match self {
            RenderPass::Draw { .. } => 0,
            RenderPass::Filter { .. } => 1,
            RenderPass::Transition { .. } => 2,
            RenderPass::Composite { .. } => 3,
            RenderPass::Mask { .. } => 4,
            RenderPass::Backdrop { .. } => 5,
            RenderPass::Transform { .. } => 6,
            RenderPass::Accumulate { .. } => 7,
        }
    }

    pub fn kind(&self) -> &'static str {
        match self {
            RenderPass::Draw { .. } => "draw",
            RenderPass::Filter { .. } => "filter",
            RenderPass::Transition { .. } => "transition",
            RenderPass::Composite { .. } => "composite",
            RenderPass::Mask { .. } => "mask",
            RenderPass::Backdrop { .. } => "backdrop",
            RenderPass::Transform { .. } => "transform",
            RenderPass::Accumulate { .. } => "accumulate",
        }
    }

    /// 该 pass 引用的效果（`Draw`/`Composite` 没有）。
    pub fn effect(&self) -> Option<&EffectRef> {
        match self {
            RenderPass::Filter { effect, .. } | RenderPass::Transition { effect, .. } => {
                Some(effect)
            }
            _ => None,
        }
    }
}
