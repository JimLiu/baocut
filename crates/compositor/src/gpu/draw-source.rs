//! Ordered DrawOp source painting, with real isolation before group opacity.
use super::associated_quad::{AssociatedQuadRenderer, QuadBlend};
use super::linear_paint::{LinearPaint, LinearPaintRenderer};
use super::material_support::MaterialSupportCache;
use super::stroke_replay::StrokeReplayRenderer;
use super::*;
use crate::stroke_coverage::{StrokeCoverage, StrokeCoverageCache, StrokeFrameResources};
use anyhow::{Result, bail, ensure};
use render_raster::{
    FrameOps,
    drawop::{DrawOp, PaintData},
    effects::{
        component_filters::{Size, Support},
        material_plan::MaterialSource,
    },
};
use std::sync::Arc;

const MAX_DEPTH: usize = 32;
const MAX_COMPOSITES: usize = 128;

enum Command {
    Draw(SceneFrame),
    Linear {
        coverage: SceneFrame,
        paint: LinearPaint,
        support: Option<Support>,
    },
    Group {
        opacity: f32,
        commands: Vec<Command>,
    },
    Stroke {
        coverage: Arc<StrokeCoverage>,
        paint: LinearPaint,
    },
}
pub(super) struct DrawSourcePlan {
    commands: Vec<Command>,
    pub(super) support_frame: SceneFrame,
    pub(super) depth: usize,
    pub(super) paint_count: usize,
    pub(super) group_count: usize,
    pub(super) draw_count: usize,
    pub(super) stroke_count: usize,
    pub(super) stroke_bytes: u64,
    primitive_work: u64,
}
impl DrawSourcePlan {
    pub(super) fn surfaces(&self) -> usize {
        self.depth + usize::from(self.paint_count != 0)
    }
    /// Only conservative GPU work is charged; clear and composite cover the full
    /// canvas. No source operations are omitted to make a budget fit.
    pub(super) fn work(&self, pixels: u64) -> u64 {
        self.primitive_work
            .saturating_add(pixels.saturating_mul((1 + self.group_count * 2 + self.paint_count) as u64))
    }
    pub(super) fn prepare(
        frame: &FrameOps,
        cache: &mut crate::RetainedDrawCache,
        strokes: &mut StrokeCoverageCache,
        stroke_resources: &mut StrokeFrameResources,
        support: &mut MaterialSupportCache,
        size: Size,
    ) -> Result<Self> {
        ensure!(frame.ops.len() <= 65536, "gpu-draw-operation-limit");
        let mut plan = Self {
            commands: Vec::new(),
            support_frame: SceneFrame::default(),
            depth: 0,
            paint_count: 0,
            group_count: 0,
            draw_count: 0,
            stroke_count: 0,
            stroke_bytes: 0,
            primitive_work: 0,
        };
        let mut index = 0;
        plan.commands = parse(
            frame,
            &mut index,
            0,
            true,
            cache,
            strokes,
            stroke_resources,
            support,
            size,
            &mut plan,
        )?;
        ensure!(index == frame.ops.len(), "gpu-draw-layer-stack-invalid");
        ensure!(
            plan.paint_count <= MAX_COMPOSITES && plan.group_count <= MAX_COMPOSITES,
            "gpu-draw-source-composite-limit"
        );
        ensure!(plan.support_frame.nodes.len() <= 4096, "gpu-draw-node-limit");
        Ok(plan)
    }
}
fn batch(
    frame: &FrameOps,
    ops: &mut Vec<DrawOp>,
    cache: &mut crate::RetainedDrawCache,
    commands: &mut Vec<Command>,
    plan: &mut DrawSourcePlan,
    size: Size,
) -> Result<()> {
    if ops.is_empty() {
        return Ok(());
    }
    let source = subset(frame, std::mem::take(ops));
    let scene = cache.prepare_for_canvas(&source, size.width, size.height)?;
    plan.primitive_work = plan.primitive_work.saturating_add(primitive_work(&scene, size));
    ensure!(
        plan.support_frame.nodes.len().saturating_add(scene.nodes.len()) <= 4096,
        "gpu-draw-node-limit"
    );
    plan.support_frame.nodes.extend(scene.nodes.iter().cloned());
    plan.draw_count += 1;
    commands.push(Command::Draw(scene));
    Ok(())
}
#[allow(clippy::too_many_arguments)]
fn parse(
    frame: &FrameOps,
    index: &mut usize,
    depth: usize,
    visible: bool,
    cache: &mut crate::RetainedDrawCache,
    strokes: &mut StrokeCoverageCache,
    stroke_resources: &mut StrokeFrameResources,
    support_cache: &mut MaterialSupportCache,
    size: Size,
    plan: &mut DrawSourcePlan,
) -> Result<Vec<Command>> {
    ensure!(depth <= MAX_DEPTH, "gpu-draw-layer-depth-limit");
    let mut commands = Vec::new();
    let mut ops = Vec::new();
    while let Some(op) = frame.ops.get(*index) {
        *index += 1;
        if visible && crate::device_hairline::is_hairline(op)? {
            batch(frame, &mut ops, cache, &mut commands, plan, size)?;
            let paint = stroke_paint(frame, op)?;
            if let Some(coverage) = strokes.prepare(frame, op, [size.width, size.height])? {
                plan.stroke_count += 1;
                ensure!(plan.stroke_count <= 128, "gpu-stroke-program-slot-limit");
                // Admit before retaining another program in this plan. This
                // ledger spans every source and group, and counts repeats once.
                stroke_resources.admit(&coverage)?;
                plan.stroke_bytes = plan
                    .stroke_bytes
                    .saturating_add(u64::from(coverage.region[2]) * u64::from(coverage.region[3]) * 4);
                plan.primitive_work = plan.primitive_work.saturating_add(coverage.work());
                plan.support_frame.nodes.extend(coverage.support.nodes.iter().cloned());
                commands.push(Command::Stroke { coverage, paint });
            }
            continue;
        }
        match op {
            DrawOp::PushLayer { opacity, blend } => {
                ensure!(*blend == motion::effect::BlendMode::Normal, "gpu-draw-layer-blend-unsupported");
                ensure!(
                    opacity.is_finite() && (0.0..=1.0).contains(opacity),
                    "gpu-draw-group-opacity-invalid"
                );
                batch(frame, &mut ops, cache, &mut commands, plan, size)?;
                let child_visible = visible && *opacity > 0.0;
                if child_visible {
                    plan.group_count += 1;
                    ensure!(plan.group_count <= MAX_COMPOSITES, "gpu-draw-source-composite-limit");
                }
                let children = parse(
                    frame,
                    index,
                    depth + 1,
                    child_visible,
                    cache,
                    strokes,
                    stroke_resources,
                    support_cache,
                    size,
                    plan,
                )?;
                if child_visible {
                    plan.depth = plan.depth.max(depth + 1);
                    commands.push(Command::Group {
                        opacity: *opacity,
                        commands: children,
                    });
                }
            }
            DrawOp::PopLayer => {
                ensure!(depth > 0, "gpu-draw-layer-stack-invalid");
                batch(frame, &mut ops, cache, &mut commands, plan, size)?;
                return Ok(commands);
            }
            _ if !visible => {}
            DrawOp::FillPathPaint { paint, tf, .. } | DrawOp::StrokePathPaint { paint, tf, .. } => {
                let paint_index = *paint as usize;
                match frame.paints.get(paint_index) {
                    Some(PaintData::Solid(_)) => ops.push(op.clone()),
                    Some(PaintData::Linear { p0, p1, stops }) => {
                        let paint = LinearPaint::new(*p0, *p1, stops, *tf)?;
                        batch(frame, &mut ops, cache, &mut commands, plan, size)?;
                        plan.paint_count += 1;
                        ensure!(plan.paint_count <= MAX_COMPOSITES, "gpu-draw-source-composite-limit");
                        let mut masked = subset(frame, vec![op.clone()]);
                        masked.paints[paint_index] = PaintData::Solid([1.0; 4]);
                        let coverage = cache.prepare_for_canvas(&masked, size.width, size.height)?;
                        plan.primitive_work = plan.primitive_work.saturating_add(primitive_work(&coverage, size));
                        ensure!(
                            plan.support_frame.nodes.len().saturating_add(coverage.nodes.len()) <= 4096,
                            "gpu-draw-node-limit"
                        );
                        let support = support_cache.source_support(&MaterialSource::Draw(Arc::new(masked)), Some(&coverage), size);
                        plan.support_frame.nodes.extend(coverage.nodes.iter().cloned());
                        commands.push(Command::Linear { coverage, paint, support });
                    }
                    _ => bail!("gpu-draw-paint-unsupported"),
                }
            }
            _ => ops.push(op.clone()),
        }
    }
    ensure!(depth == 0, "gpu-draw-layer-stack-invalid");
    batch(frame, &mut ops, cache, &mut commands, plan, size)?;
    Ok(commands)
}

fn subset(frame: &FrameOps, ops: Vec<DrawOp>) -> FrameOps {
    FrameOps {
        ops,
        static_prefix: None,
        paths: frame.paths.clone(),
        strings: frame.strings.clone(),
        paints: frame.paints.clone(),
        bitmaps: frame.bitmaps.clone(),
    }
}

fn stroke_paint(frame: &FrameOps, op: &DrawOp) -> Result<LinearPaint> {
    let (paint, width, tf) = match op {
        DrawOp::StrokePath { color, width, tf, .. } => (PaintData::Solid(*color), *width, *tf),
        DrawOp::StrokePathPaint { paint, width, tf, .. } => (
            frame
                .paints
                .get(*paint as usize)
                .ok_or_else(|| anyhow::anyhow!("gpu-draw-paint-index"))?
                .clone(),
            *width,
            *tf,
        ),
        _ => unreachable!(),
    };
    let coverage = crate::device_hairline::coverage(width, tf)?.unwrap();
    let factor = if coverage == 1. {
        1.
    } else {
        ((255 * ((coverage * 256.) as u32)) >> 8) as f32 / 255.
    };
    match paint {
        PaintData::Solid(mut color) => {
            ensure!(color.iter().all(|v| v.is_finite()), "gpu-draw-paint-invalid");
            color = color.map(|v| v.clamp(0., 1.));
            color[3] *= factor;
            Ok(LinearPaint::solid(color))
        }
        PaintData::Linear { p0, p1, mut stops } => {
            for s in &mut stops {
                s.color[3] = s.color[3].clamp(0., 1.) * factor;
            }
            LinearPaint::new(p0, p1, &stops, tf)
        }
        _ => bail!("gpu-draw-paint-unsupported"),
    }
}

fn primitive_work(scene: &SceneFrame, size: Size) -> u64 {
    fn area(node: SceneNode, size: Size) -> u64 {
        let probe = SceneFrame {
            nodes: vec![node],
            ..Default::default()
        };
        super::material_support::scene_support(&probe, size).map_or(0, |s| u64::from(s.right - s.left) * u64::from(s.bottom - s.top))
    }
    scene.nodes.iter().fold(0_u64, |sum, node| {
        // Up to 8x8 area taps plus the ordinary sample, four bilinear texels
        // each. Charge each transformed glyph box, including any overlap.
        let reads = match node {
            SceneNode::Glyphs(run) => run.glyphs.iter().fold(0_u64, |cost, glyph| {
                let mut single = (**run).clone();
                single.glyphs = Arc::from([glyph.clone()]);
                cost.saturating_add(area(SceneNode::Glyphs(Arc::new(single)), size).saturating_mul(260))
            }),
            _ => area(node.clone(), size),
        };
        sum.saturating_add(reads)
    })
}

struct Surface {
    _texture: wgpu::Texture,
    view: wgpu::TextureView,
}
pub(super) struct DrawSourceRenderer {
    device: wgpu::Device,
    linear: LinearPaintRenderer,
    quad: AssociatedQuadRenderer,
    surfaces: Vec<Surface>,
    stroke: StrokeReplayRenderer,
    size: Size,
}
impl DrawSourceRenderer {
    pub(super) fn new(device: wgpu::Device, queue: wgpu::Queue) -> Self {
        Self {
            linear: LinearPaintRenderer::new(device.clone(), queue.clone()),
            quad: AssociatedQuadRenderer::new(device.clone(), queue.clone()),
            stroke: StrokeReplayRenderer::new(device.clone(), queue),
            device,
            surfaces: Vec::new(),
            size: Size { width: 0, height: 0 },
        }
    }
    pub(super) fn allocate(&mut self, size: Size, count: usize) {
        if self.size != size {
            self.surfaces.clear();
            self.size = size;
        }
        self.surfaces.truncate(count);
        while self.surfaces.len() < count {
            let texture = self.device.create_texture(&wgpu::TextureDescriptor {
                label: Some("baocut.draw-source.isolation"),
                size: wgpu::Extent3d {
                    width: size.width,
                    height: size.height,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8Unorm,
                usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::RENDER_ATTACHMENT,
                view_formats: &[],
            });
            let view = texture.create_view(&Default::default());
            self.surfaces.push(Surface { _texture: texture, view });
        }
    }
    #[allow(clippy::too_many_arguments)]
    pub(super) fn encode(
        &mut self,
        plan: &DrawSourcePlan,
        target: &wgpu::TextureView,
        compositor: &mut Compositor,
        slots: &mut EncodeSlots,
        textures: &mut HashMap<PreparedTextureKey, PreparedTexture>,
        paint_slot: &mut usize,
        group_slot: &mut usize,
        stroke_slot: &mut usize,
        encoder: &mut wgpu::CommandEncoder,
    ) -> Result<()> {
        encode_clear(encoder, target);
        compositor.glyph.set_source_coverage_sampling(true);
        let result = self.commands(
            &plan.commands,
            0,
            plan.depth,
            target,
            compositor,
            slots,
            textures,
            paint_slot,
            group_slot,
            stroke_slot,
            encoder,
        );
        compositor.glyph.set_source_coverage_sampling(false);
        result
    }
    #[allow(clippy::too_many_arguments)]
    fn commands(
        &mut self,
        commands: &[Command],
        depth: usize,
        coverage_index: usize,
        target: &wgpu::TextureView,
        compositor: &mut Compositor,
        slots: &mut EncodeSlots,
        textures: &mut HashMap<PreparedTextureKey, PreparedTexture>,
        paint_slot: &mut usize,
        group_slot: &mut usize,
        stroke_slot: &mut usize,
        encoder: &mut wgpu::CommandEncoder,
    ) -> Result<()> {
        for command in commands {
            match command {
                Command::Stroke { coverage, paint } => {
                    self.stroke.encode(*stroke_slot, coverage, paint, target, encoder)?;
                    *stroke_slot += 1;
                }
                Command::Draw(scene) => {
                    compositor.encode_nodes(
                        &scene.nodes,
                        target,
                        self.size.width,
                        self.size.height,
                        wgpu::TextureFormat::Rgba8Unorm,
                        None,
                        false,
                        None,
                        slots,
                        textures,
                        encoder,
                    )?;
                }
                Command::Linear { coverage, paint, support } => {
                    let mask = self.surfaces[coverage_index].view.clone();
                    compositor.encode_nodes(
                        &coverage.nodes,
                        &mask,
                        self.size.width,
                        self.size.height,
                        wgpu::TextureFormat::Rgba8Unorm,
                        None,
                        true,
                        None,
                        slots,
                        textures,
                        encoder,
                    )?;
                    self.linear
                        .encode(*paint_slot, &mask, target, paint, *support, self.size, encoder)?;
                    *paint_slot += 1;
                }
                Command::Group { opacity, commands } => {
                    let group = self.surfaces[depth].view.clone();
                    encode_clear(encoder, &group);
                    self.commands(
                        commands,
                        depth + 1,
                        coverage_index,
                        &group,
                        compositor,
                        slots,
                        textures,
                        paint_slot,
                        group_slot,
                        stroke_slot,
                        encoder,
                    )?;
                    self.quad.encode(
                        *group_slot,
                        &group,
                        [0.0, 0.0, self.size.width as f64, self.size.height as f64],
                        [1.0, 1.0],
                        [0.0, 0.0],
                        &RenderTarget {
                            view: target,
                            width: self.size.width,
                            height: self.size.height,
                            format: wgpu::TextureFormat::Rgba8Unorm,
                        },
                        QuadBlend::SourceGroupOver,
                        *opacity,
                        false,
                        encoder,
                    )?;
                    *group_slot += 1;
                }
            }
        }
        Ok(())
    }
    pub(super) fn finish_frame(&mut self, paint_slots: usize, group_slots: usize, stroke_slots: usize) {
        self.linear.finish_frame(paint_slots);
        self.quad.finish_frame(group_slots);
        self.stroke.finish_frame(stroke_slots);
    }
    pub(super) fn resident_bytes(&self) -> u64 {
        self.surfaces.len() as u64 * u64::from(self.size.width) * u64::from(self.size.height) * 4 + self.stroke.resident_bytes()
    }
}
