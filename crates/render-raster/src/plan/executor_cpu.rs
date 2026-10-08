//! `PassExecutor` 与 tiny-skia 的 CPU reference 执行器（设计 §6.5）。
//!
//! **折叠保证**：`FramePlan::is_folded()` 为真时，[`execute_plan`] 直接调
//! `raster::rasterize_with_media`——与「`record(t)` 之后原样光栅化」是同一个
//! 函数调用，不多一次分配、不多一次拷贝，因此逐字节相同。

use super::cache::SurfaceCache;
use super::capability::CapabilityProfile;
use super::frame_plan::FramePlan;
use super::pass::RenderPass;
use super::surface::{CompositeInput, SurfaceId, SurfacePlan};
use crate::drawop::FrameOps;
use crate::raster::{FrameMedia, rasterize_with_media};
use anyhow::{Result, anyhow, bail};
use motion::effect::{BlendMode, EffectRef, UniformMap};
use std::collections::BTreeMap;
use std::sync::Arc;
use tiny_skia::Pixmap;

/// 一个后端要能执行 FramePlan 必须提供的四件事。CPU reference 是规范实现；
/// 未来的 GPU executor 只是加速，且必须过同一套 conformance 夹具。
pub trait PassExecutor {
    fn profile(&self) -> &CapabilityProfile;

    fn draw(
        &mut self,
        surface: &SurfacePlan,
        ops: &FrameOps,
        media: &mut dyn FrameMedia,
    ) -> Result<Pixmap>;

    fn filter(
        &mut self,
        surface: &SurfacePlan,
        input: &Pixmap,
        effect: &EffectRef,
        uniforms: &UniformMap,
    ) -> Result<Pixmap>;

    fn transition(
        &mut self,
        surface: &SurfacePlan,
        from: &Pixmap,
        to: &Pixmap,
        effect: &EffectRef,
        progress: f32,
        uniforms: &UniformMap,
    ) -> Result<Pixmap>;

    fn accumulate(
        &mut self,
        surface: &SurfacePlan,
        inputs: &[(Arc<Pixmap>, f64)],
    ) -> Result<Pixmap> {
        let mut out = Pixmap::new(surface.width, surface.height)
            .ok_or_else(|| anyhow!("surface 尺寸无效"))?;
        if inputs
            .iter()
            .any(|(p, _)| p.width() != surface.width || p.height() != surface.height)
        {
            bail!("effect-input-mismatch: accumulate 尺寸不同");
        }
        let total: f64 = inputs.iter().map(|(_, w)| *w).sum();
        if !total.is_finite()
            || total <= 0.0
            || inputs.iter().any(|(_, w)| !w.is_finite() || *w < 0.0)
        {
            bail!("frameplan-weights-invalid");
        }
        for (i, pixel) in out.data_mut().chunks_exact_mut(4).enumerate() {
            let mut sum = [0.0; 4];
            for (input, weight) in inputs {
                for c in 0..4 {
                    sum[c] += input.data()[i * 4 + c] as f64 * weight;
                }
            }
            for c in 0..4 {
                pixel[c] = (sum[c] / total).round().clamp(0.0, 255.0) as u8;
            }
        }
        Ok(out)
    }

    fn transform(
        &mut self,
        surface: &SurfacePlan,
        input: &Pixmap,
        tf: &crate::drawop::Mat6,
    ) -> Result<Pixmap> {
        let mut out = Pixmap::new(surface.width, surface.height)
            .ok_or_else(|| anyhow!("surface 尺寸无效"))?;
        out.draw_pixmap(
            0,
            0,
            input.as_ref(),
            &tiny_skia::PixmapPaint {
                quality: tiny_skia::FilterQuality::Bilinear,
                ..Default::default()
            },
            tiny_skia::Transform::from_row(tf[0], tf[1], tf[2], tf[3], tf[4], tf[5]),
            None,
        );
        Ok(out)
    }

    fn mask(
        &mut self,
        input: &Pixmap,
        mask: &Pixmap,
        mode: crate::drawop::MatteMode,
    ) -> Result<Pixmap> {
        if input.width() != mask.width() || input.height() != mask.height() {
            bail!("effect-input-mismatch: mask 尺寸与 input 不同");
        }
        let mut out = input.clone();
        crate::raster::apply_matte(&mut out, mask, mode);
        Ok(out)
    }

    fn backdrop(
        &mut self,
        base: &Pixmap,
        filtered: &Pixmap,
        mask: &Pixmap,
        opacity: f32,
    ) -> Result<Pixmap> {
        if base.width() != filtered.width()
            || base.height() != filtered.height()
            || base.width() != mask.width()
            || base.height() != mask.height()
        {
            bail!("effect-input-mismatch: backdrop 尺寸不一致");
        }
        let mut out = base.clone();
        let opacity = opacity.clamp(0.0, 1.0);
        for ((pixel, filtered), mask) in out
            .data_mut()
            .chunks_exact_mut(4)
            .zip(filtered.data().chunks_exact(4))
            .zip(mask.data().chunks_exact(4))
        {
            let coverage = mask[3] as f32 / 255.0 * opacity;
            for (dst, src) in pixel.iter_mut().zip(filtered) {
                *dst = (*dst as f32 + (*src as f32 - *dst as f32) * coverage).round() as u8;
            }
        }
        Ok(out)
    }

    fn composite(
        &mut self,
        surface: &SurfacePlan,
        inputs: &[(CompositeInput, Arc<Pixmap>, Option<Arc<Pixmap>>)],
    ) -> Result<Pixmap>;
}

pub struct CpuExecutor {
    caps: CapabilityProfile,
}

impl CpuExecutor {
    pub fn new(caps: CapabilityProfile) -> Self {
        CpuExecutor { caps }
    }
}

impl Default for CpuExecutor {
    fn default() -> Self {
        CpuExecutor::new(CapabilityProfile::cpu_reference())
    }
}

impl PassExecutor for CpuExecutor {
    fn profile(&self) -> &CapabilityProfile {
        &self.caps
    }

    fn draw(
        &mut self,
        surface: &SurfacePlan,
        ops: &FrameOps,
        media: &mut dyn FrameMedia,
    ) -> Result<Pixmap> {
        let mut pixmap = rasterize_with_media(ops, surface.width, surface.height, media)?;
        if let Some(clear) = surface.clear {
            // 清屏色在 DrawOp 之前生效；`Clear` 指令会覆盖它，两者不冲突。
            let mut base = Pixmap::new(surface.width, surface.height)
                .ok_or_else(|| anyhow!("surface {:?} 尺寸非法", surface.id))?;
            base.fill(
                tiny_skia::Color::from_rgba(
                    clear[0].clamp(0.0, 1.0),
                    clear[1].clamp(0.0, 1.0),
                    clear[2].clamp(0.0, 1.0),
                    clear[3].clamp(0.0, 1.0),
                )
                .ok_or_else(|| anyhow!("surface {:?} 清屏色非法", surface.id))?,
            );
            base.draw_pixmap(
                0,
                0,
                pixmap.as_ref(),
                &tiny_skia::PixmapPaint::default(),
                tiny_skia::Transform::identity(),
                None,
            );
            pixmap = base;
        }
        Ok(pixmap)
    }

    fn filter(
        &mut self,
        surface: &SurfacePlan,
        input: &Pixmap,
        effect: &EffectRef,
        uniforms: &UniformMap,
    ) -> Result<Pixmap> {
        // 相对长度的基准是**输出 surface 的短边**：同一份配方在不同画幅下
        // 得到成比例的半径 / 羽化（设计 §5.5 的 `canvasShortEdge`）。
        let short_edge = f64::from(surface.width.min(surface.height));
        crate::effects::apply_filter(effect, uniforms, input, short_edge)
    }

    fn transition(
        &mut self,
        surface: &SurfacePlan,
        from: &Pixmap,
        to: &Pixmap,
        effect: &EffectRef,
        progress: f32,
        uniforms: &UniformMap,
    ) -> Result<Pixmap> {
        // 与 `filter` 同一口径：相对长度的基准是输出 surface 的短边。
        let short_edge = f64::from(surface.width.min(surface.height));
        crate::effects::apply_transition(effect, uniforms, from, to, progress, short_edge)
    }

    fn composite(
        &mut self,
        surface: &SurfacePlan,
        inputs: &[(CompositeInput, Arc<Pixmap>, Option<Arc<Pixmap>>)],
    ) -> Result<Pixmap> {
        if inputs.iter().any(|(input, _, _)| input.mask.is_some()) {
            bail!("effect-capability-unsupported: composite mask 需要 mask.* 效果（阶段 4B）");
        }
        let mut out = Pixmap::new(surface.width, surface.height)
            .ok_or_else(|| anyhow!("surface {:?} 尺寸非法", surface.id))?;
        let mut blank = true;
        for (input, pixmap, _) in inputs {
            if composite_layer(&mut out, pixmap, input.opacity, input.blend, blank) {
                blank = false;
            }
        }
        Ok(out)
    }
}

/// 把一张图层叠进 `out`，结果与整幅 `out.draw_pixmap(0, 0, layer, …)` 逐字节相同。
///
/// 图层大多只有一小块内容（一张贴纸、一行字），其余是预乘全零的透明像素；而
/// `draw_pixmap` 的 Pattern 着色器只有 highp 实现，整幅走一遍是逐像素的浮点管线
/// ——动画项目 release 导出的 profile 里，这里约占 BCF 渲染 CPU 的一半。九种
/// [`BlendMode`] 在 src = (0,0,0,0) 时都把 dst 原样留下，所以只在覆盖全部非零像素的
/// [`content_rect`] 里跑同一条管线；此前什么都没画（`out_blank`）且 Normal、不透明度
/// 1 时，src-over 到全零就是 src 本身，整块拷贝、不扫描。两条捷径都由
/// `tests::bounded_composite_matches_full_draw_pixmap` 与整幅 `draw_pixmap` 逐字节对拍。
///
/// 返回这一层是否可能改了 `out`。
fn composite_layer(
    out: &mut Pixmap,
    layer: &Pixmap,
    opacity: f32,
    blend: BlendMode,
    out_blank: bool,
) -> bool {
    let opacity = opacity.clamp(0.0, 1.0);
    if opacity <= 0.0 {
        return false;
    }
    if out_blank
        && blend == BlendMode::Normal
        && opacity >= 1.0
        && (layer.width(), layer.height()) == (out.width(), out.height())
    {
        out.data_mut().copy_from_slice(layer.data());
        return true;
    }
    bounded(out, layer, opacity, super::blend_to_skia(blend))
}

/// [`composite_layer`] 的收窄部分给别的调用方用：与整幅 `out.draw_pixmap(0, 0, layer, …)`（最近邻、恒等变换、
/// 不裁剪）逐字节相同，只在图层非零像素的外包矩形里跑管线。`blend` 只收 [`BlendMode`] 对得上的九种（src 全零时
/// 都不动 dst）；别的混合方式返回 `None`，调用方照整幅画。返回 `Some(这一层是否可能改了 out)`。
pub fn composite_bounded(
    out: &mut Pixmap,
    layer: &Pixmap,
    opacity: f32,
    blend: tiny_skia::BlendMode,
) -> Option<bool> {
    BlendMode::ALL
        .iter()
        .any(|&mode| super::blend_to_skia(mode) == blend)
        .then(|| bounded(out, layer, opacity.clamp(0.0, 1.0), blend))
}

/// 与 [`composite_bounded`] 相同，但内容框由调用方给（`(left, top, right, bottom)`，像素、右下开区间），
/// 不再扫描图层。框必须盖住图层全部非零像素；任何这样的超集都与整幅画逐字节相同（src 全零时九种混合
/// 都不动 dst）。超出图层的部分按图层尺寸截掉。
pub fn composite_bounded_rect(
    out: &mut Pixmap,
    layer: tiny_skia::PixmapRef<'_>,
    rect: (usize, usize, usize, usize),
    opacity: f32,
    blend: tiny_skia::BlendMode,
) -> Option<bool> {
    BlendMode::ALL
        .iter()
        .any(|&mode| super::blend_to_skia(mode) == blend)
        .then(|| {
            let (left, top, right, bottom) = rect;
            let right = right.min(layer.width() as usize);
            let bottom = bottom.min(layer.height() as usize);
            fill_content(
                out,
                layer,
                (left, top, right, bottom),
                opacity.clamp(0.0, 1.0),
                blend,
            )
        })
}

fn bounded(out: &mut Pixmap, layer: &Pixmap, opacity: f32, blend: tiny_skia::BlendMode) -> bool {
    if opacity <= 0.0 {
        return false;
    }
    let Some(rect) = content_rect(layer.data(), layer.width() as usize) else {
        return false;
    };
    fill_content(out, layer.as_ref(), rect, opacity, blend)
}

/// 只在 `(left, top, right, bottom)` 里按整幅 `draw_pixmap` 的画法叠 `layer`。
fn fill_content(
    out: &mut Pixmap,
    layer: tiny_skia::PixmapRef<'_>,
    (left, top, right, bottom): (usize, usize, usize, usize),
    opacity: f32,
    blend: tiny_skia::BlendMode,
) -> bool {
    if opacity <= 0.0 {
        return false;
    }
    let Some(rect) =
        tiny_skia::Rect::from_ltrb(left as f32, top as f32, right as f32, bottom as f32)
    else {
        return false;
    };
    // 与 `draw_pixmap` 内部拼的那支 Paint 相同（Nearest、Pad、不抗锯齿），只把
    // 填充矩形从整幅收窄到内容框。
    let paint = tiny_skia::Paint {
        shader: tiny_skia::Pattern::new(
            layer,
            tiny_skia::SpreadMode::Pad,
            tiny_skia::FilterQuality::Nearest,
            opacity,
            tiny_skia::Transform::identity(),
        ),
        blend_mode: blend,
        anti_alias: false,
        force_hq_pipeline: false,
    };
    out.fill_rect(rect, &paint, tiny_skia::Transform::identity(), None);
    true
}

/// 宽 `width` 的 RGBA 行里非零字节的外包矩形 `(left, top, right, bottom)`，像素单位、
/// 右下开区间；全零返回 `None`。行是精确的，列按 16 像素一块向外取整——调用方只要
/// 一个非零像素的超集。
///
/// 整行、整块都与全零切片比较（落到 `memcmp`），不逐字节迭代：dev profile 只优化
/// 第三方依赖，本 crate 在 debug 构建里是 O0，逐字节扫一幅 1080p 要几十毫秒，比它
/// 省下的 tiny-skia 绘制还贵（`effects::alpha_bbox` 就是那样扫的）。列只查当前边界
/// 之外的那一截，内容框定下来以后每行只剩两次整行比较。
fn content_rect(data: &[u8], width: usize) -> Option<(usize, usize, usize, usize)> {
    const COL_BLOCK: usize = 16 * 4;
    static ZEROS: [u8; 4096] = [0; 4096];
    let is_zero = |bytes: &[u8]| {
        bytes
            .chunks(ZEROS.len())
            .all(|chunk| chunk == &ZEROS[..chunk.len()])
    };
    let row_bytes = width * 4;
    if row_bytes == 0 {
        return None;
    }
    let (mut top, mut bottom) = (None, 0);
    let (mut left, mut right) = (row_bytes, 0);
    for (y, row) in data.chunks_exact(row_bytes).enumerate() {
        if is_zero(row) {
            continue;
        }
        top.get_or_insert(y);
        bottom = y + 1;
        // 块边界从行首按 64 字节切，`rchunks` 从行尾切；行长是 4 的倍数，两边的
        // 边界都落在像素边界上。
        if let Some(block) = row[..left].chunks(COL_BLOCK).position(|c| !is_zero(c)) {
            left = block * COL_BLOCK;
        }
        if let Some(block) = row[right..].rchunks(COL_BLOCK).position(|c| !is_zero(c)) {
            right = row_bytes - block * COL_BLOCK;
        }
    }
    Some((left / 4, top?, right / 4, bottom))
}

/// 执行一张 FramePlan，返回输出 surface 的像素。
///
/// `cache` 命中的是**中间** surface（键 = surface 内容指纹）；整帧缓存由调用方
/// （`video.rs`）在计划之外自己做，两层不重复计数。
pub fn execute_plan<E: PassExecutor, M: FrameMedia>(
    plan: &FramePlan,
    executor: &mut E,
    media: &mut M,
    cache: Option<&SurfaceCache>,
) -> Result<Pixmap> {
    execute(plan, executor, media, cache, &BTreeMap::new(), None)
}

/// 与 [`execute_plan`] 相同，但复用调用方**已经算好**的 surface 指纹表
/// （[`FramePlan::frame_fingerprints`]）。
///
/// 算指纹表要对每个 Draw pass 做一次全量 `drawop::encode`，而执行器本来也要
/// 同一张表当中间 surface 的缓存键；合成路径先按帧指纹查整帧缓存、未命中才
/// 执行，于是同一张表会被算两遍。传表进来就只算一遍——`surface_fingerprints`
/// 内部已经 `validate` 过，因此这条路径上也不再重复 `validate`。
///
/// **调用约束**：`fingerprints` 必须来自**这一张、且此后未被改写过**的计划。
/// `FramePlan` 的字段是 `pub`，改了计划再用旧表就会拿到过期的缓存键。
pub fn execute_plan_with_fingerprints<E: PassExecutor, M: FrameMedia>(
    plan: &FramePlan,
    executor: &mut E,
    media: &mut M,
    cache: Option<&SurfaceCache>,
    fingerprints: &BTreeMap<u32, u64>,
) -> Result<Pixmap> {
    execute(
        plan,
        executor,
        media,
        cache,
        &BTreeMap::new(),
        Some(fingerprints),
    )
}

/// 带**外部输入 surface** 的执行入口（[`super::SurfaceLifetime::External`]）。
///
/// 用于「已经有一张画好的 pixmap，要对它跑一条效果链」：直接把它当输入，
/// 而不是先 blit 进一张 surface——blit 走的是 `draw_pixmap`，有可能改字节。
///
/// **外部 surface 的内容不在计划里**，因此 surface 指纹描述不了它：这条路径
/// 上不接受 `cache`（传了就报错），也不要拿它的 `frame_fingerprint()` 当帧身份。
pub fn execute_plan_with_inputs<E: PassExecutor, M: FrameMedia>(
    plan: &FramePlan,
    executor: &mut E,
    media: &mut M,
    cache: Option<&SurfaceCache>,
    external: &BTreeMap<u32, Arc<Pixmap>>,
) -> Result<Pixmap> {
    execute(plan, executor, media, cache, external, None)
}

/// 三个公共入口的共同实现。`fingerprints` 为 `Some` 时表示调用方已经算过
/// surface 指纹表（因而 `validate` 也已经通过），此处跳过这两步。
fn execute<E: PassExecutor, M: FrameMedia>(
    plan: &FramePlan,
    executor: &mut E,
    media: &mut M,
    cache: Option<&SurfaceCache>,
    external: &BTreeMap<u32, Arc<Pixmap>>,
    fingerprints: Option<&BTreeMap<u32, u64>>,
) -> Result<Pixmap> {
    if fingerprints.is_none() {
        plan.validate()?;
    }
    let has_external = plan
        .surfaces
        .iter()
        .any(|surface| surface.lifetime == super::SurfaceLifetime::External);
    if has_external && cache.is_some() {
        bail!(
            "frameplan-external-uncacheable: 外部输入 surface 的内容不在计划里，不能进 surface 缓存"
        );
    }
    for surface in &plan.surfaces {
        if surface.lifetime == super::SurfaceLifetime::External
            && !external.contains_key(&surface.id.0)
        {
            bail!(
                "frameplan-external-missing: 计划声明 {:?} 由调用方供图，但没有提供",
                surface.id
            );
        }
    }
    if plan.capability != executor.profile().fingerprint() {
        bail!(
            "frameplan-capability-mismatch: 计划按 {:016x} 编译，执行器是 {:016x}",
            plan.capability,
            executor.profile().fingerprint()
        );
    }
    let output_surface = plan
        .output_surface()
        .ok_or_else(|| anyhow!("frameplan-output-unknown: {:?}", plan.output))?;

    // 折叠形态：与 record + rasterize 完全同一条路径。
    if plan.is_folded() {
        let RenderPass::Draw { ops, .. } = &plan.passes[0] else {
            unreachable!("is_folded 已判定为 Draw");
        };
        return executor.draw(output_surface, ops, media);
    }

    let computed;
    let fingerprints = match fingerprints {
        Some(table) => table,
        None => {
            computed = plan.surface_fingerprints()?;
            &computed
        }
    };
    let mut live: BTreeMap<u32, Arc<Pixmap>> = external.clone();
    let take = |live: &BTreeMap<u32, Arc<Pixmap>>, id: SurfaceId| -> Result<Arc<Pixmap>> {
        live.get(&id.0)
            .cloned()
            .ok_or_else(|| anyhow!("frameplan-surface-missing: {id:?} 尚未产出"))
    };

    let mut uses = BTreeMap::<u32, usize>::new();
    for pass in &plan.passes {
        for input in pass.inputs() {
            *uses.entry(input.0).or_default() += 1;
        }
    }
    for pass in &plan.passes {
        let target = pass.output();
        let surface = plan
            .surface(target)
            .ok_or_else(|| anyhow!("frameplan-pass-output-unknown: {target:?}"))?;
        // 自算的表由 `validate` 保证覆盖全部 surface；外部传入的表若与计划不
        // 匹配则在这里报错，而不是 panic。
        let key = *fingerprints
            .get(&target.0)
            .ok_or_else(|| anyhow!("frameplan-fingerprint-missing: {target:?}"))?;
        if let Some(cache) = cache
            && let Some(hit) = cache.get(key)
        {
            live.insert(target.0, hit);
            release_inputs(pass, &mut uses, &mut live, plan.output);
            continue;
        }
        let produced = match pass {
            RenderPass::Draw { ops, .. } => executor.draw(surface, ops, media)?,
            RenderPass::Filter {
                input,
                effect,
                uniforms,
                ..
            } => {
                let source = take(&live, *input)?;
                executor.filter(surface, source.as_ref(), effect, uniforms)?
            }
            RenderPass::Transition {
                from,
                to,
                effect,
                progress,
                uniforms,
                ..
            } => {
                let a = take(&live, *from)?;
                let b = take(&live, *to)?;
                executor.transition(surface, a.as_ref(), b.as_ref(), effect, *progress, uniforms)?
            }
            RenderPass::Accumulate { inputs, .. } => {
                let resolved = inputs
                    .iter()
                    .map(|(id, w)| Ok((take(&live, *id)?, *w)))
                    .collect::<Result<Vec<_>>>()?;
                executor.accumulate(surface, &resolved)?
            }
            RenderPass::Transform { input, tf, .. } => {
                executor.transform(surface, take(&live, *input)?.as_ref(), tf)?
            }
            RenderPass::Backdrop {
                base,
                filtered,
                mask,
                opacity,
                ..
            } => executor.backdrop(
                take(&live, *base)?.as_ref(),
                take(&live, *filtered)?.as_ref(),
                take(&live, *mask)?.as_ref(),
                *opacity,
            )?,
            RenderPass::Mask {
                input, mask, mode, ..
            } => executor.mask(
                take(&live, *input)?.as_ref(),
                take(&live, *mask)?.as_ref(),
                *mode,
            )?,
            RenderPass::Composite { inputs, .. } => {
                let mut resolved = Vec::with_capacity(inputs.len());
                for input in inputs {
                    let pixmap = take(&live, input.surface)?;
                    let mask = match input.mask {
                        Some(mask) => Some(take(&live, mask)?),
                        None => None,
                    };
                    resolved.push((input.clone(), pixmap, mask));
                }
                executor.composite(surface, &resolved)?
            }
        };
        let produced = Arc::new(produced);
        if let Some(cache) = cache {
            cache.put(key, produced.clone());
        }
        live.insert(target.0, produced);
        release_inputs(pass, &mut uses, &mut live, plan.output);
    }

    let output = take(&live, plan.output)?;
    Ok(Arc::try_unwrap(output).unwrap_or_else(|shared| shared.as_ref().clone()))
}

fn release_inputs(
    pass: &RenderPass,
    uses: &mut BTreeMap<u32, usize>,
    live: &mut BTreeMap<u32, Arc<Pixmap>>,
    output: SurfaceId,
) {
    for input in pass.inputs() {
        if let Some(n) = uses.get_mut(&input.0) {
            *n -= 1;
            if *n == 0 && input != output {
                live.remove(&input.0);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 固定种子的 xorshift：夹具要可复现，不引 `rand`。
    struct Rng(u64);

    impl Rng {
        fn next(&mut self) -> u64 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            self.0
        }

        fn below(&mut self, n: u64) -> u64 {
            self.next() % n
        }

        /// 合法的预乘像素：颜色通道不超过 alpha。
        fn premul(&mut self) -> [u8; 4] {
            let alpha = self.below(256) as u8;
            let channel = |rng: &mut Self| rng.below(u64::from(alpha) + 1) as u8;
            [channel(self), channel(self), channel(self), alpha]
        }
    }

    fn filled(
        width: u32,
        height: u32,
        rng: &mut Rng,
        keep: impl Fn(usize, usize) -> bool,
    ) -> Pixmap {
        let mut pixmap = Pixmap::new(width, height).unwrap();
        let data = pixmap.data_mut();
        for y in 0..height as usize {
            for x in 0..width as usize {
                if keep(x, y) {
                    let at = (y * width as usize + x) * 4;
                    data[at..at + 4].copy_from_slice(&rng.premul());
                }
            }
        }
        pixmap
    }

    /// 各种形状的图层：全透明、全满、中间一块、贴着四条边的角点、稀疏散点。
    fn layers(width: u32, height: u32, rng: &mut Rng) -> Vec<Pixmap> {
        let (w, h) = (width as usize, height as usize);
        let (left, top) = (rng.below(w as u64) as usize, rng.below(h as u64) as usize);
        let (right, bottom) = (
            left + 1 + rng.below((w - left) as u64) as usize,
            top + 1 + rng.below((h - top) as u64) as usize,
        );
        let sparse: Vec<bool> = (0..w * h).map(|_| rng.below(9) == 0).collect();
        vec![
            Pixmap::new(width, height).unwrap(),
            filled(width, height, rng, |_, _| true),
            filled(width, height, rng, |x, y| {
                (left..right).contains(&x) && (top..bottom).contains(&y)
            }),
            filled(width, height, rng, |x, y| {
                (x == 0 || x == w - 1) && (y == 0 || y == h - 1)
            }),
            filled(width, height, rng, |x, y| sparse[y * w + x]),
        ]
    }

    fn full_draw(dst: &mut Pixmap, layer: &Pixmap, opacity: f32, blend: BlendMode) {
        dst.draw_pixmap(
            0,
            0,
            layer.as_ref(),
            &tiny_skia::PixmapPaint {
                opacity: opacity.clamp(0.0, 1.0),
                blend_mode: super::super::blend_to_skia(blend),
                ..Default::default()
            },
            tiny_skia::Transform::identity(),
            None,
        );
    }

    #[test]
    fn bounded_composite_matches_full_draw_pixmap() {
        let mut rng = Rng(0x9e37_79b9_7f4a_7c15);
        // 1100 px 一行 4400 字节，跨过 4096 字节的零块；16 / 64 / 65 px 压着 16 像素
        // 列块的边界。
        for (width, height) in [
            (37, 23),
            (16, 5),
            (1, 1),
            (61, 2),
            (64, 3),
            (65, 2),
            (1100, 3),
        ] {
            for _ in 0..4 {
                let backdrops = [
                    Pixmap::new(width, height).unwrap(),
                    filled(width, height, &mut rng, |_, _| true),
                ];
                for layer in layers(width, height, &mut rng) {
                    for (index, backdrop) in backdrops.iter().enumerate() {
                        let blank = index == 0;
                        for blend in BlendMode::ALL {
                            for opacity in [1.0, 0.5, 0.0] {
                                let mut expected = backdrop.clone();
                                full_draw(&mut expected, &layer, opacity, blend);
                                let mut actual = backdrop.clone();
                                composite_layer(&mut actual, &layer, opacity, blend, blank);
                                assert!(
                                    expected.data() == actual.data(),
                                    "{width}x{height} {blend:?} opacity {opacity} blank {blank}"
                                );
                                let mut public = backdrop.clone();
                                let skia = super::super::blend_to_skia(blend);
                                assert!(
                                    composite_bounded(&mut public, &layer, opacity, skia).is_some()
                                );
                                assert!(
                                    expected.data() == public.data(),
                                    "公开入口 {width}x{height} {blend:?} opacity {opacity}"
                                );
                            }
                        }
                    }
                }
            }
        }
    }

    /// src 全零时会改 dst 的混合方式（清掉、只留交集……）不能只画外包矩形：公开入口不收，`out` 不动。
    #[test]
    fn bounded_composite_refuses_modes_that_touch_the_backdrop() {
        let mut rng = Rng(7);
        let backdrop = filled(9, 7, &mut rng, |_, _| true);
        let layer = filled(9, 7, &mut rng, |x, y| (x, y) == (4, 3));
        for blend in [
            tiny_skia::BlendMode::Clear,
            tiny_skia::BlendMode::Source,
            tiny_skia::BlendMode::DestinationIn,
            tiny_skia::BlendMode::SourceIn,
        ] {
            let mut out = backdrop.clone();
            assert_eq!(
                composite_bounded(&mut out, &layer, 1.0, blend),
                None,
                "{blend:?}"
            );
            assert!(out.data() == backdrop.data(), "{blend:?}");
        }
    }

    /// 整条 `composite`：透明层与不透明度 0 的层不算「画过」，空底整块拷贝之后
    /// 的层照常叠加。
    #[test]
    fn composite_pass_matches_sequential_full_draws() {
        let mut rng = Rng(0x2545_f491_4f6c_dd1d);
        let (width, height) = (29, 17);
        let surface = SurfacePlan::canvas(SurfaceId(0), width, height);
        for blend in BlendMode::ALL {
            let stack = layers(width, height, &mut rng);
            let order = [0, 2, 3, 1, 4, 0, 2];
            let inputs: Vec<_> = order
                .iter()
                .enumerate()
                .map(|(slot, &which)| {
                    let input = CompositeInput {
                        surface: SurfaceId(slot as u32 + 1),
                        blend: if slot % 2 == 0 {
                            BlendMode::Normal
                        } else {
                            blend
                        },
                        opacity: [1.0, 0.7, 1.0, 0.0][slot % 4],
                        mask: None,
                    };
                    (input, Arc::new(stack[which].clone()), None)
                })
                .collect();
            let mut expected = Pixmap::new(width, height).unwrap();
            for (input, layer, _) in &inputs {
                full_draw(&mut expected, layer, input.opacity, input.blend);
            }
            let actual = CpuExecutor::default().composite(&surface, &inputs).unwrap();
            assert!(expected.data() == actual.data(), "{blend:?}");
        }
    }
}
