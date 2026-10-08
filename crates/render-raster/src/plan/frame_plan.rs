//! `FramePlan` 与它的分层指纹（设计 §6.1 / §6.6）。
//!
//! 三层指纹，各管各的：
//! * **DrawOp 指纹**（`drawop::fingerprint`）——单个指令流的原语身份，
//!   `bcut ops` 与 overlay 响应头继续用它。
//! * **FramePlan 指纹**（[`FramePlan::plan_fingerprint`]）——整张计划的结构身份，
//!   含 surface 尺寸、pass 顺序、effect id/version、uniforms 与 capability。
//! * **Surface 指纹**（[`FramePlan::surface_fingerprint`]）——某张 surface 的
//!   **内容**身份：它的描述、写它的那些 pass、以及各输入 surface 的指纹。
//!   **帧指纹 := 输出 surface 的指纹**（[`FramePlan::frame_fingerprint`]），
//!   这是静止帧缓存的键与渲染清单里那一列。
//!
//! 编码规则与 DrawOp 同源：小端、`-0.0 → +0.0`、侧表按声明序、`UniformMap`
//! 是 `BTreeMap` ⇒ 键序天然确定，不需要在编码期再排序。

use super::pass::RenderPass;
// `CompositeInput` / `BlendMode` 只有 `from_layers`（BCF 分层录制）用得上。
use super::surface::CompositeInput;
use super::surface::{SurfaceId, SurfacePlan};
use crate::drawop::{self, Color4, FrameOps};
use anyhow::{Result, bail};
use motion::effect::BlendMode;
use motion::effect::{EffectRef, UniformMap, UniformValue};
use std::collections::BTreeMap;

pub const FRAME_PLAN_VERSION: u32 = 4;

const PLAN_MAGIC: u32 = 0x42_46_50_4C; // "BFPL"
const SURFACE_MAGIC: u32 = 0x42_53_46_50; // "BSFP"

#[derive(Debug)]
pub struct FramePlan {
    pub version: u32,
    /// 按 `id` 升序（`validate` 守）。
    pub surfaces: Vec<SurfacePlan>,
    /// 拓扑序：每个 pass 的输入必须由更早的 pass 产出，或是未被写过的清屏 surface。
    pub passes: Vec<RenderPass>,
    pub output: SurfaceId,
    /// 执行后端能力档案的指纹（[`super::CapabilityProfile::fingerprint`]）。
    pub capability: u64,
}

/// Recursive recording is flattened into an acyclic, single-writer surface graph.
struct PlanBuilder {
    width: u32,
    height: u32,
    surfaces: Vec<SurfacePlan>,
    passes: Vec<RenderPass>,
}

impl PlanBuilder {
    fn alloc(&mut self, lifetime: super::SurfaceLifetime) -> SurfaceId {
        let id = SurfaceId(self.surfaces.len() as u32);
        self.surfaces.push(SurfacePlan {
            lifetime,
            ..SurfacePlan::canvas(id, self.width, self.height)
        });
        id
    }

    fn filters(
        &mut self,
        mut target: SurfaceId,
        effects: Vec<scene_primitives::resolve::ResolvedEffect>,
        lifetime: super::SurfaceLifetime,
    ) -> SurfaceId {
        for effect in effects {
            let output = self.alloc(lifetime);
            self.passes.push(RenderPass::Filter {
                input: target,
                output,
                effect: effect.effect,
                uniforms: effect.uniforms,
            });
            target = output;
        }
        target
    }

    fn layers(
        &mut self,
        layers: Vec<crate::renderer::FrameLayer>,
        lifetime: super::SurfaceLifetime,
    ) -> SurfaceId {
        use crate::renderer::FrameLayer;
        let mut acc = None;
        for layer in layers {
            let (target, blend, opacity) = match layer {
                FrameLayer::Ops(ops) => {
                    let target = self.alloc(lifetime);
                    self.passes.push(RenderPass::Draw { target, ops });
                    (target, BlendMode::Normal, 1.0)
                }
                FrameLayer::Effect {
                    ops,
                    effects,
                    blend,
                    opacity,
                } => {
                    let target = self.alloc(lifetime);
                    self.passes.push(RenderPass::Draw { target, ops });
                    (self.filters(target, effects, lifetime), blend, opacity)
                }
                FrameLayer::Group {
                    layers,
                    masks,
                    effects,
                    blend,
                    opacity,
                } => {
                    let mut target = self.layers(layers, lifetime);
                    for (layers, mode) in masks {
                        let mask = self.layers(layers, lifetime);
                        let output = self.alloc(lifetime);
                        self.passes.push(RenderPass::Mask {
                            input: target,
                            mask,
                            output,
                            mode,
                        });
                        target = output;
                    }
                    (self.filters(target, effects, lifetime), blend, opacity)
                }
                FrameLayer::Temporal { samples, mode } => {
                    let inputs: Vec<_> = samples
                        .into_iter()
                        .map(|(layers, weight)| (self.layers(layers, lifetime), weight))
                        .collect();
                    let output = self.alloc(lifetime);
                    if mode == scene_primitives::temporal::EchoMode::Average {
                        self.passes.push(RenderPass::Accumulate { inputs, output });
                    } else {
                        self.passes.push(RenderPass::Composite {
                            inputs: inputs
                                .into_iter()
                                .map(|(surface, weight)| CompositeInput {
                                    surface,
                                    blend: BlendMode::Normal,
                                    opacity: weight as f32,
                                    mask: None,
                                })
                                .collect(),
                            output,
                        });
                    }
                    (output, BlendMode::Normal, 1.0)
                }
                FrameLayer::LocalCanvas {
                    layers,
                    width,
                    height,
                    tf,
                } => {
                    let (parent_w, parent_h) = (self.width, self.height);
                    self.width = width;
                    self.height = height;
                    let input = self.layers(layers, lifetime);
                    self.width = parent_w;
                    self.height = parent_h;
                    let output = self.alloc(lifetime);
                    self.passes
                        .push(RenderPass::Transform { input, output, tf });
                    (output, BlendMode::Normal, 1.0)
                }
                FrameLayer::Backdrop {
                    masks,
                    effects,
                    opacity,
                } => {
                    let base = acc.unwrap_or_else(|| self.layers(Vec::new(), lifetime));
                    let filtered = self.filters(base, effects, lifetime);
                    let mut coverage = None;
                    for (layers, mode) in masks {
                        let mask = self.layers(layers, lifetime);
                        coverage = Some(match coverage {
                            None => mask,
                            Some(input) => {
                                let output = self.alloc(lifetime);
                                self.passes.push(RenderPass::Mask {
                                    input,
                                    mask,
                                    output,
                                    mode,
                                });
                                output
                            }
                        });
                    }
                    let mask = coverage.unwrap_or_else(|| self.layers(Vec::new(), lifetime));
                    let output = self.alloc(lifetime);
                    self.passes.push(RenderPass::Backdrop {
                        base,
                        filtered,
                        mask,
                        output,
                        opacity,
                    });
                    acc = Some(output);
                    continue;
                }
                FrameLayer::Transition {
                    from,
                    to,
                    effect,
                    progress,
                    uniforms,
                    from_static,
                    to_static,
                } => {
                    let side_lifetime = |fixed| {
                        if fixed {
                            super::SurfaceLifetime::Static
                        } else {
                            lifetime
                        }
                    };
                    let from = self.layers(from, side_lifetime(from_static));
                    let to = self.layers(to, side_lifetime(to_static));
                    let output = self.alloc(lifetime);
                    self.passes.push(RenderPass::Transition {
                        from,
                        to,
                        output,
                        effect,
                        progress,
                        uniforms,
                    });
                    (output, BlendMode::Normal, 1.0)
                }
            };
            let input = CompositeInput {
                surface: target,
                blend,
                opacity,
                mask: None,
            };
            acc = Some(match acc {
                None if blend == BlendMode::Normal && opacity >= 1.0 => target,
                previous => {
                    let mut inputs: Vec<_> =
                        previous.into_iter().map(CompositeInput::opaque).collect();
                    inputs.push(input);
                    let output = self.alloc(lifetime);
                    self.passes.push(RenderPass::Composite { inputs, output });
                    output
                }
            });
        }
        acc.unwrap_or_else(|| {
            let target = self.alloc(lifetime);
            self.passes.push(RenderPass::Draw {
                target,
                ops: FrameOps::default(),
            });
            target
        })
    }
}

impl FramePlan {
    /// 无 effect 文档的**折叠形态**：一张画布 surface + 一个 Draw pass。
    /// 执行器对这个形状直接调 `raster::rasterize_with_media`——与 `record(t)`
    /// 之后原样光栅化是同一条代码路径，逐字节相同（设计 §6.1）。
    pub fn single_draw(width: u32, height: u32, ops: FrameOps, capability: u64) -> Self {
        FramePlan {
            version: FRAME_PLAN_VERSION,
            surfaces: vec![SurfacePlan::canvas(SurfaceId::OUTPUT, width, height)],
            passes: vec![RenderPass::Draw {
                target: SurfaceId::OUTPUT,
                ops,
            }],
            output: SurfaceId::OUTPUT,
            capability,
        }
    }

    /// 分层录制结果 → 计划（设计 §6.3）。
    ///
    /// 每一层先画进自己的 surface，效果层再串一条 `Filter` pass 链，最后按
    /// 声明序逐层 `Composite` 回累积画面。只有一层普通指令流时**折叠**成
    /// [`FramePlan::single_draw`]——无效果文档因此仍走单 Draw pass。
    ///
    /// 入参来自无 I/O 的 BCF 录制器；native 与 WASM 共用同一份计划。
    pub fn from_layers(
        width: u32,
        height: u32,
        layers: Vec<crate::renderer::FrameLayer>,
        capability: u64,
    ) -> Self {
        use crate::renderer::FrameLayer;
        if let [FrameLayer::Ops(_)] = layers.as_slice() {
            let Some(FrameLayer::Ops(ops)) = layers.into_iter().next() else {
                unreachable!("上一行已经判定为单层普通指令流");
            };
            return FramePlan::single_draw(width, height, ops, capability);
        }
        let mut builder = PlanBuilder {
            width,
            height,
            surfaces: Vec::new(),
            passes: Vec::new(),
        };
        let output = builder.layers(layers, super::SurfaceLifetime::PerFrame);
        FramePlan {
            version: FRAME_PLAN_VERSION,
            surfaces: builder.surfaces,
            passes: builder.passes,
            output,
            capability,
        }
    }

    /// 恰好一个 Draw pass 且直接写输出 surface ⇒ 执行器走 fast path。
    pub fn is_folded(&self) -> bool {
        self.surfaces.len() == 1
            && self.passes.len() == 1
            && matches!(&self.passes[0], RenderPass::Draw { target, .. } if *target == self.output)
    }

    pub fn surface(&self, id: SurfaceId) -> Option<&SurfacePlan> {
        self.surfaces.iter().find(|surface| surface.id == id)
    }

    pub fn output_surface(&self) -> Option<&SurfacePlan> {
        self.surface(self.output)
    }

    /// 结构合法性：surface id 升序去重、输出存在、每个 pass 的 output/input
    /// 都已声明、输入必须在使用前被写过或是清屏 surface（拓扑序）。
    pub fn validate(&self) -> Result<()> {
        if self.version != FRAME_PLAN_VERSION {
            bail!("frameplan-version-unsupported: {}", self.version);
        }
        for pair in self.surfaces.windows(2) {
            if pair[0].id >= pair[1].id {
                bail!(
                    "frameplan-surface-order: surface id 必须升序且唯一（{:?} 之后是 {:?}）",
                    pair[0].id,
                    pair[1].id
                );
            }
        }
        if self.surface(self.output).is_none() {
            bail!("frameplan-output-unknown: {:?}", self.output);
        }
        // `External` surface 的内容由调用方提供，视为「一开始就写好了」。
        let mut written: Vec<SurfaceId> = self
            .surfaces
            .iter()
            .filter(|surface| surface.lifetime == super::surface::SurfaceLifetime::External)
            .map(|surface| surface.id)
            .collect();
        for (index, pass) in self.passes.iter().enumerate() {
            if let RenderPass::Accumulate { inputs, .. } = pass {
                let total: f64 = inputs.iter().map(|(_, w)| *w).sum();
                if inputs.is_empty()
                    || inputs.iter().any(|(_, w)| !w.is_finite() || *w < 0.0)
                    || !total.is_finite()
                    || total <= 0.0
                {
                    bail!("frameplan-weights-invalid: pass {index}");
                }
            }
            let output = pass.output();
            if self.surface(output).is_none() {
                bail!(
                    "frameplan-pass-output-unknown: pass {index} ({}) 写入未声明的 {output:?}",
                    pass.kind()
                );
            }
            for input in pass.inputs() {
                if self.surface(input).is_none() {
                    bail!(
                        "frameplan-pass-input-unknown: pass {index} ({}) 读取未声明的 {input:?}",
                        pass.kind()
                    );
                }
                if input == output {
                    bail!(
                        "frameplan-pass-self-read: pass {index} ({}) 的输入与输出同为 {input:?}",
                        pass.kind()
                    );
                }
                if !written.contains(&input) {
                    bail!(
                        "frameplan-pass-order: pass {index} ({}) 读取尚未写入的 {input:?}",
                        pass.kind()
                    );
                }
            }
            if !written.contains(&output) {
                written.push(output);
            }
        }
        Ok(())
    }

    /// 整张计划的结构指纹。
    pub fn plan_fingerprint(&self) -> u64 {
        drawop::fnv1a64(&encode_plan(self))
    }

    /// 某张 surface 的内容指纹。递归蕴含全部上游输入。
    pub fn surface_fingerprint(&self, id: SurfaceId) -> Result<u64> {
        let table = self.surface_fingerprints()?;
        table
            .get(&id.0)
            .copied()
            .ok_or_else(|| anyhow::anyhow!("frameplan-surface-unknown: {id:?}"))
    }

    /// **帧指纹**：输出 surface 的内容指纹。
    pub fn frame_fingerprint(&self) -> Result<u64> {
        self.frame_fingerprints().map(|(frame, _)| frame)
    }

    /// 帧指纹 **加上**算它时顺手得到的整张 surface 指纹表。
    ///
    /// 指纹表的代价是对每个 Draw pass 做一次全量 `drawop::encode`，而执行器
    /// 内部也要同一张表来当中间 surface 的缓存键。调用方先算指纹、再按缓存
    /// 未命中执行时，用这个入口取表并交给
    /// [`super::execute_plan_with_fingerprints`]，可以省掉第二次编码。
    ///
    /// **表与计划绑定**：取表之后不得再改写 `plan` 的任何字段，否则表就过期了。
    pub fn frame_fingerprints(&self) -> Result<(u64, BTreeMap<u32, u64>)> {
        let table = self.surface_fingerprints()?;
        let frame = table
            .get(&self.output.0)
            .copied()
            .ok_or_else(|| anyhow::anyhow!("frameplan-surface-unknown: {:?}", self.output))?;
        Ok((frame, table))
    }

    /// 全部 surface 的内容指纹。计划已是拓扑序（`validate`），因此一趟前向
    /// 传播即可，无需递归也不可能成环。
    pub fn surface_fingerprints(&self) -> Result<BTreeMap<u32, u64>> {
        self.validate()?;
        let mut table: BTreeMap<u32, u64> = self
            .surfaces
            .iter()
            .map(|surface| {
                let mut bytes = Vec::with_capacity(48);
                put_u32(&mut bytes, SURFACE_MAGIC);
                put_u32(&mut bytes, self.version);
                put_u64(&mut bytes, self.capability);
                encode_surface(surface, &mut bytes);
                (surface.id.0, drawop::fnv1a64(&bytes))
            })
            .collect();
        for pass in &self.passes {
            let output = pass.output();
            let mut bytes = Vec::with_capacity(256);
            put_u64(
                &mut bytes,
                *table.get(&output.0).expect("validate 已保证 output 存在"),
            );
            encode_pass_body(pass, &mut bytes);
            for input in pass.inputs() {
                put_u64(
                    &mut bytes,
                    *table.get(&input.0).expect("validate 已保证 input 存在"),
                );
            }
            table.insert(output.0, drawop::fnv1a64(&bytes));
        }
        Ok(table)
    }
}

// ── 二进制编码（LE；节顺序 header → surfaces → passes → output）─────────

fn put_u32(out: &mut Vec<u8>, v: u32) {
    out.extend_from_slice(&v.to_le_bytes());
}

fn put_u64(out: &mut Vec<u8>, v: u64) {
    out.extend_from_slice(&v.to_le_bytes());
}

fn put_f32(out: &mut Vec<u8>, v: f32) {
    // 与 DrawOp 同规则：-0.0 归一到 +0.0
    let v = if v == 0.0 { 0.0f32 } else { v };
    out.extend_from_slice(&v.to_le_bytes());
}

fn put_f64(out: &mut Vec<u8>, v: f64) {
    let v = if v == 0.0 { 0.0f64 } else { v };
    out.extend_from_slice(&v.to_le_bytes());
}

fn put_str(out: &mut Vec<u8>, s: &str) {
    put_u32(out, s.len() as u32);
    out.extend_from_slice(s.as_bytes());
}

fn put_color(out: &mut Vec<u8>, c: &Color4) {
    for v in c {
        put_f32(out, *v);
    }
}

fn encode_surface(surface: &SurfacePlan, out: &mut Vec<u8>) {
    put_u32(out, surface.id.0);
    put_u32(out, surface.width);
    put_u32(out, surface.height);
    out.push(surface.color.space.code());
    out.push(surface.color.precision.code());
    out.push(surface.lifetime.code());
    match &surface.clear {
        Some(color) => {
            out.push(1);
            put_color(out, color);
        }
        None => out.push(0),
    }
}

fn encode_effect(effect: &EffectRef, out: &mut Vec<u8>) {
    put_str(out, &effect.id);
    put_u32(out, effect.version);
    match effect.pkg_hash {
        Some(hash) => {
            out.push(1);
            put_u64(out, hash);
        }
        None => out.push(0),
    }
}

/// `UniformMap` 是 `BTreeMap` ⇒ 迭代序 = 键的字典序，编码天然确定。
fn encode_uniforms(uniforms: &UniformMap, out: &mut Vec<u8>) {
    put_u32(out, uniforms.len() as u32);
    for (key, value) in uniforms.iter() {
        put_str(out, key);
        out.push(value.tag());
        match value {
            UniformValue::Scalar(v) => put_f64(out, *v),
            UniformValue::Int(v) => out.extend_from_slice(&v.to_le_bytes()),
            UniformValue::Bool(v) => out.push(u8::from(*v)),
            UniformValue::Vec2(v) => v.iter().for_each(|v| put_f64(out, *v)),
            UniformValue::Vec4(v) | UniformValue::Color(v) => {
                v.iter().for_each(|v| put_f64(out, *v))
            }
            UniformValue::Text(v) => put_str(out, v),
        }
    }
}

/// pass 的**本体**：不含输入 surface 的 id（surface 指纹改用输入的指纹值，
/// 这样「同一条 pass 作用在不同内容上」才会得到不同的 surface 指纹）。
fn encode_pass_body(pass: &RenderPass, out: &mut Vec<u8>) {
    out.push(pass.tag());
    match pass {
        RenderPass::Draw { ops, .. } => {
            let bytes = drawop::encode(ops);
            put_u32(out, bytes.len() as u32);
            out.extend_from_slice(&bytes);
        }
        RenderPass::Filter {
            effect, uniforms, ..
        } => {
            encode_effect(effect, out);
            encode_uniforms(uniforms, out);
        }
        RenderPass::Transition {
            effect,
            progress,
            uniforms,
            ..
        } => {
            encode_effect(effect, out);
            put_f32(out, *progress);
            encode_uniforms(uniforms, out);
        }
        RenderPass::Accumulate { inputs, .. } => {
            put_u32(out, inputs.len() as u32);
            for (_, weight) in inputs {
                put_f64(out, *weight);
            }
        }
        RenderPass::Transform { tf, .. } => tf.iter().for_each(|v| put_f32(out, *v)),
        RenderPass::Mask { mode, .. } => out.push(mode.code()),
        RenderPass::Backdrop { opacity, .. } => put_f32(out, *opacity),
        RenderPass::Composite { inputs, .. } => {
            put_u32(out, inputs.len() as u32);
            for input in inputs {
                out.push(input.blend.code());
                put_f32(out, input.opacity);
                out.push(u8::from(input.mask.is_some()));
            }
        }
    }
}

/// 计划的完整编码（结构指纹的输入）。与 surface 指纹不同，这里**带上**
/// 输入 surface 的 id：计划身份关心接线，内容身份关心上游取值。
pub fn encode_plan(plan: &FramePlan) -> Vec<u8> {
    let mut out = Vec::with_capacity(4096);
    put_u32(&mut out, PLAN_MAGIC);
    put_u32(&mut out, plan.version);
    put_u64(&mut out, plan.capability);
    put_u32(&mut out, plan.surfaces.len() as u32);
    for surface in &plan.surfaces {
        encode_surface(surface, &mut out);
    }
    put_u32(&mut out, plan.passes.len() as u32);
    for pass in &plan.passes {
        encode_pass_body(pass, &mut out);
        put_u32(&mut out, pass.output().0);
        let inputs = pass.inputs();
        put_u32(&mut out, inputs.len() as u32);
        for input in inputs {
            put_u32(&mut out, input.0);
        }
    }
    put_u32(&mut out, plan.output.0);
    out
}
