//! Cue-isolated, bounded prefix evaluation. Feedback never reads a prior rendered frame.
use super::*;
use render_raster::effects::component_filters as filters;
use render_raster::effects::filters::blur::box_blur_premul_u8;
use render_raster::effects::material_plan::{MaterialCapture, MaterialCommand};

const MAX_WORK_PIXELS: u64 = 256 * 1024 * 1024;
const MAX_SURFACE_BYTES: u64 = 256 * 1024 * 1024;
struct Work {
    pixels: u64,
}
impl Work {
    fn spend(&mut self, w: u32, h: u32) -> Result<()> {
        self.pixels = self
            .pixels
            .checked_add(u64::from(w) * u64::from(h))
            .ok_or_else(|| anyhow::anyhow!("CAPTION_BUDGET_EXCEEDED: material pixels"))?;
        if self.pixels > MAX_WORK_PIXELS {
            bail!("CAPTION_BUDGET_EXCEEDED: material pixels");
        }
        Ok(())
    }
    fn samples(&mut self, count: u64) -> Result<()> {
        self.pixels = self
            .pixels
            .checked_add(count)
            .ok_or_else(|| anyhow::anyhow!("CAPTION_BUDGET_EXCEEDED: material sample work"))?;
        if self.pixels > MAX_WORK_PIXELS {
            bail!("CAPTION_BUDGET_EXCEEDED: material sample work");
        }
        Ok(())
    }
    fn components(&mut self, estimate: filters::WorkEstimate) -> Result<()> {
        for count in [
            estimate.texel_reads,
            estimate.support_scan_pixels,
            estimate.output_pixels,
        ] {
            self.pixels = self
                .pixels
                .checked_add(count)
                .ok_or_else(|| anyhow::anyhow!("CAPTION_BUDGET_EXCEEDED: material work"))?;
        }
        if self.pixels > MAX_WORK_PIXELS {
            bail!("CAPTION_BUDGET_EXCEEDED: material work");
        }
        Ok(())
    }
}
pub(super) struct EmptyMedia;
impl FrameMedia for EmptyMedia {
    fn frame(&mut self, _: &str, _: i64) -> Result<Arc<Pixmap>> {
        bail!("CAPTION_RESOURCE_MISSING")
    }
}
fn padding(materials: &[CaptionMaterial]) -> u32 {
    materials
        .iter()
        .map(|m| match m {
            CaptionMaterial::Blur { radius, passes, .. } => {
                let max = match radius {
                    DynamicValue::Constant { value } => value.as_f64().unwrap_or(64.0),
                    _ => 64.0,
                };
                libm::ceil(max) as u32 * passes
            }
            CaptionMaterial::WaveDisplace { amplitude, .. } => {
                let max = match amplitude {
                    DynamicValue::Constant { value } => value.as_f64().unwrap_or(256.0).abs(),
                    _ => 256.0,
                };
                libm::ceil(max) as u32
            }
            CaptionMaterial::NoisySweep { .. }
            | CaptionMaterial::SoftBand { .. }
            | CaptionMaterial::GradientSmear { .. }
            | CaptionMaterial::AngularSampleBlend { .. }
            | CaptionMaterial::AffineSampleBlend { .. }
            | CaptionMaterial::AffineOver { .. }
            | CaptionMaterial::NoisePaletteMix { .. }
            | CaptionMaterial::NoiseDisplace { .. }
            | CaptionMaterial::GradientNoiseDisplace { .. }
            | CaptionMaterial::ScanWarp { .. }
            | CaptionMaterial::RadialWarp { .. }
            | CaptionMaterial::GaussianAxis { .. }
            | CaptionMaterial::GaussianUv { .. }
            | CaptionMaterial::GlowCascade { .. } => 0,
            CaptionMaterial::Feedback {
                samples, offset, ..
            } => libm::ceil(offset[0].abs().max(offset[1].abs()) * f64::from(*samples)) as u32,
        })
        .sum()
}
fn raster_depth(nodes: &[Node]) -> u64 {
    nodes
        .iter()
        .map(|n| u64::from(n.kind != NodeKind::Repeat) + raster_depth(&n.children))
        .max()
        .unwrap_or(0)
}
fn translated(frame: &mut FrameOps, pad: u32) {
    translate_frame_ops(frame, [pad as f32; 2]);
}
pub(super) fn translate_frame_ops(frame: &mut FrameOps, offset: [f32; 2]) {
    for op in &mut frame.ops {
        let matrix = match op {
            DrawOp::FillRect { tf, .. }
            | DrawOp::FillPath { tf, .. }
            | DrawOp::StrokePath { tf, .. }
            | DrawOp::DrawMedia { tf, .. }
            | DrawOp::ClipPath { tf, .. }
            | DrawOp::FillPathPaint { tf, .. }
            | DrawOp::StrokePathPaint { tf, .. }
            | DrawOp::DrawBitmap { tf, .. }
            | DrawOp::DrawEmissiveBitmap { tf, .. } => Some(tf),
            _ => None,
        };
        if let Some(m) = matrix {
            m[4] += offset[0];
            m[5] += offset[1];
        }
    }
}
pub(super) fn material_surface_context(context: &mut Context, surface: MaterialCapture) {
    for (key, value) in [
        ("material.surfaceX", f64::from(surface.origin[0])),
        ("material.surfaceY", f64::from(surface.origin[1])),
        ("material.surfaceWidth", f64::from(surface.width)),
        ("material.surfaceHeight", f64::from(surface.height)),
    ] {
        context
            .fields
            .insert(key.into(), Evaluated::Number(ValueType::Length, value));
    }
}

enum CapturedMaterial {
    Shared(MaterialCommand),
    AffineOver(filters::affine_over::Config),
    GaussianUv(filters::gaussian_uv::Config),
}

impl ScenePlan {
    pub(super) fn record_materials(
        &mut self,
        t: f64,
        budget: &mut Budget,
    ) -> Result<(FrameOps, Vec<SceneHit>)> {
        if !t.is_finite() {
            bail!("CAPTION_SCENE_INVALID: sample time");
        }
        let materials = self.style.scene().materials.clone();
        if materials.iter().all(|m| match m {
            CaptionMaterial::Blur {
                radius: DynamicValue::Constant { value },
                ..
            } => value.as_f64() == Some(0.0),
            CaptionMaterial::Feedback { decay, .. } => *decay == 0.0,
            _ => false,
        }) {
            return self.record_base(t, None, budget);
        }
        self.record_stack(
            t,
            &materials,
            None,
            CaptionLayerBlend::SourceOver,
            false,
            0,
            budget,
            &mut Work { pixels: 0 },
        )
    }
    pub(super) fn record_layered_materials(
        &mut self,
        t: f64,
        budget: &mut Budget,
    ) -> Result<(FrameOps, Vec<SceneHit>)> {
        if !t.is_finite() {
            bail!("CAPTION_SCENE_INVALID: sample time");
        }
        let layers = self.style.scene().render_layers.clone();
        let active = self
            .cues
            .iter()
            .filter(|c| t >= c.start && t < c.end)
            .count() as u64;
        // Both FrameOps bytes and the public Vec-backed output planes coexist briefly.
        let has_capture = layers.iter().any(|layer| layer.capture.is_some());
        let retained = if has_capture {
            0
        } else {
            u64::from(self.width) * u64::from(self.height) * 8 * active * layers.len() as u64
        };
        if retained > MAX_SURFACE_BYTES {
            bail!("CAPTION_BUDGET_EXCEEDED: layer outputs");
        }
        let mut result = FrameOps::default();
        let mut hits = Vec::new();
        let mut work = Work { pixels: 0 };
        for layer in layers {
            // Local captures retain their own actual output bytes, not one canvas
            // allocation per layer. Existing uncaptured-only budgeting stays unchanged.
            let retained = if has_capture {
                result
                    .bitmaps
                    .iter()
                    .map(|image| image.rgba.len() as u64 * 2)
                    .sum()
            } else {
                retained
            };
            let (mut ops, layer_hits) = if let Some(capture) = &layer.capture {
                self.record_captured_stack(t, &layer, capture, retained, budget, &mut work)?
            } else {
                let retained = if has_capture {
                    retained
                        .saturating_add(u64::from(self.width) * u64::from(self.height) * 8 * active)
                } else {
                    retained
                };
                self.record_stack(
                    t,
                    &layer.materials,
                    Some(&layer.source),
                    layer.blend,
                    true,
                    retained,
                    budget,
                    &mut work,
                )?
            };
            let base = result.bitmaps.len() as u32;
            for op in &mut ops.ops {
                if let DrawOp::DrawEmissiveBitmap { bitmap, .. } = op {
                    *bitmap += base;
                }
            }
            result.bitmaps.extend(ops.bitmaps);
            result.ops.extend(ops.ops);
            for hit in layer_hits {
                if !hits.iter().any(|existing: &SceneHit| {
                    existing.cue_id == hit.cue_id
                        && existing.document_id == hit.document_id
                        && existing.bounds.x == hit.bounds.x
                        && existing.bounds.y == hit.bounds.y
                        && existing.bounds.width == hit.bounds.width
                        && existing.bounds.height == hit.bounds.height
                }) {
                    hits.push(hit);
                }
            }
        }
        Ok((result, hits))
    }
    fn record_stack(
        &mut self,
        t: f64,
        materials: &[CaptionMaterial],
        source: Option<&CaptionLayerSource>,
        blend: CaptionLayerBlend,
        layered: bool,
        retained: u64,
        budget: &mut Budget,
        work: &mut Work,
    ) -> Result<(FrameOps, Vec<SceneHit>)> {
        let pad = padding(&materials);
        let width = self
            .width
            .checked_add(pad * 2)
            .ok_or_else(|| anyhow::anyhow!("CAPTION_BUDGET_EXCEEDED: padding"))?;
        let height = self
            .height
            .checked_add(pad * 2)
            .ok_or_else(|| anyhow::anyhow!("CAPTION_BUDGET_EXCEEDED: padding"))?;
        let bytes = u64::from(width) * u64::from(height) * 4;
        let surface_count = materials
            .iter()
            .map(|material| match material {
                CaptionMaterial::GlowCascade { levels, .. } => levels.len() as u64 + 4,
                CaptionMaterial::GaussianAxis { .. }
                | CaptionMaterial::AffineSampleBlend { .. } => 4,
                CaptionMaterial::AffineOver { .. } => 4,
                CaptionMaterial::GaussianUv { .. } => 4,
                _ => 2,
            })
            .sum::<u64>()
            + 4
            + raster_depth(&self.style.scene().nodes);
        if bytes * surface_count + retained > MAX_SURFACE_BYTES {
            bail!("CAPTION_BUDGET_EXCEEDED: material surfaces");
        }
        let indices = self
            .cues
            .iter()
            .enumerate()
            .filter(|(_, c)| t >= c.start && t < c.end)
            .map(|(i, _)| i)
            .collect::<Vec<_>>();
        if bytes * surface_count
            + u64::from(self.width) * u64::from(self.height) * 4 * indices.len() as u64
            > MAX_SURFACE_BYTES
        {
            bail!("CAPTION_BUDGET_EXCEEDED: material outputs");
        }
        let mut builder = FrameBuilder::default();
        let mut hits = Vec::new();
        for ci in indices {
            let (image, current_hits) = self.material_prefix(
                ci,
                t,
                materials,
                source,
                materials.len(),
                pad,
                (width, height),
                budget,
                work,
            )?;
            hits.extend(current_hits);
            let mut cropped = Vec::with_capacity(self.width as usize * self.height as usize * 4);
            for y in pad..pad + self.height {
                let start = (y as usize * width as usize + pad as usize) * 4;
                cropped.extend_from_slice(&image.data()[start..start + self.width as usize * 4]);
            }
            let id = builder.bitmap_id(BitmapData {
                width: self.width,
                height: self.height,
                rgba: Arc::from(cropped),
            });
            if layered || component_stack(materials) {
                builder.push(DrawOp::DrawEmissiveBitmap {
                    bitmap: id,
                    blend: match blend {
                        CaptionLayerBlend::SourceOver => {
                            render_raster::drawop::AssociatedBlend::SourceOver
                        }
                        CaptionLayerBlend::Screen => render_raster::drawop::AssociatedBlend::Screen,
                        CaptionLayerBlend::Add => render_raster::drawop::AssociatedBlend::Add,
                    },
                    opacity: 1.0,
                    tf: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
                });
            } else {
                builder.push(DrawOp::DrawBitmap {
                    bitmap: id,
                    opacity: 1.0,
                    tf: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
                });
            }
        }
        Ok((builder.finish(), hits))
    }
    /// Rasterize a source directly in its explicit local texture. No canvas
    /// crop or implicit effect padding can remove source pixels before filtering.
    fn record_captured_stack(
        &mut self,
        t: f64,
        layer: &CaptionRenderLayer,
        capture: &CaptionLayerCapture,
        mut retained: u64,
        budget: &mut Budget,
        work: &mut Work,
    ) -> Result<(FrameOps, Vec<SceneHit>)> {
        let CaptionLayerSource::Nodes { node_ids } = &layer.source else {
            bail!("CAPTION_MATERIAL_INVALID: capture requires a node source");
        };
        let indices: Vec<_> = self
            .cues
            .iter()
            .enumerate()
            .filter(|(_, cue)| t >= cue.start && t < cue.end)
            .map(|(index, _)| index)
            .collect();
        let mut builder = FrameBuilder::default();
        let mut hits = Vec::new();
        for ci in indices {
            let Some(surface) = self.resolve_layer_capture(ci, t, capture, budget)? else {
                continue;
            };
            let size = filters::Size {
                width: surface.width,
                height: surface.height,
            };
            let bytes = u64::from(size.width) * u64::from(size.height) * 4;
            let mut commands = Vec::with_capacity(layer.materials.len());
            let mut visible = true;
            // Reserve source raster isolation, component conversion and retained
            // output copies before allocating any source or effect image.
            // Paint preparation shares a frame-wide cap of 16M RGBA-equivalent
            // pixels, including expanded blur scratch and immutable source bitmaps.
            let mut peak = bytes
                .saturating_mul(4 + raster_depth(&self.style.scene().nodes))
                .saturating_add(64 * 1024 * 1024);
            for material in &layer.materials {
                let command = match material {
                    CaptionMaterial::AffineOver { .. } => self
                        .resolve_affine_over_on_surface(ci, t, material, surface, budget)?
                        .map(CapturedMaterial::AffineOver),
                    CaptionMaterial::GaussianUv { .. } => self
                        .resolve_gaussian_uv_on_surface(ci, t, material, surface, budget)?
                        .map(CapturedMaterial::GaussianUv),
                    _ => self
                        .resolve_material_command_on_surface(ci, t, material, surface, budget)?
                        .map(CapturedMaterial::Shared),
                };
                let Some(command) = command else {
                    visible = false;
                    break;
                };
                let extra = match &command {
                    CapturedMaterial::Shared(MaterialCommand::Glow(config)) => {
                        filters::estimate_glow_peak_bytes(size, config)?
                    }
                    _ => bytes.saturating_mul(4),
                };
                peak = peak.saturating_add(extra);
                commands.push(command);
            }
            if !visible {
                continue;
            }
            if peak.saturating_add(retained) > MAX_SURFACE_BYTES {
                bail!("CAPTION_BUDGET_EXCEEDED: capture surfaces");
            }
            let (mut source, source_hits) = self.record_selected_nodes_in_viewport(
                t,
                Some(ci),
                Some(node_ids),
                Some(surface.into()),
                budget,
            )?;
            translate_frame_ops(&mut source, surface.origin.map(|value| -(value as f32)));
            work.spend(size.width, size.height)?;
            let mut image =
                rasterize_with_media(&source, size.width, size.height, &mut EmptyMedia)?;
            for command in commands {
                if let CapturedMaterial::Shared(MaterialCommand::NoisySweep {
                    domain,
                    position,
                    mask_scale,
                    reveal,
                    flip_y,
                }) = command
                {
                    image = render_raster::effects::noisy_sweep::apply(
                        &image,
                        0,
                        domain,
                        position,
                        mask_scale,
                        reveal,
                        if flip_y {
                            render_raster::effects::noisy_sweep::UvY::Up
                        } else {
                            render_raster::effects::noisy_sweep::UvY::Down
                        },
                        |count| work.samples(count),
                    )?;
                    continue;
                }
                work.spend(size.width, size.height)?;
                let input = component_crop(&image, 0, (size.width, size.height))?;
                let filtered = match command {
                    CapturedMaterial::Shared(MaterialCommand::Gaussian(pass)) => {
                        work.components(filters::estimate_gaussian_reads(&input, pass)?)?;
                        filters::gaussian(&input, pass)?
                    }
                    CapturedMaterial::Shared(MaterialCommand::AffineSampleBlend(config)) => {
                        filters::affine_samples::apply(&input, &config, |count| {
                            work.samples(count)
                        })?
                    }
                    CapturedMaterial::Shared(MaterialCommand::Glow(config)) => {
                        work.components(filters::estimate_glow_reads(&input, &config)?)?;
                        filters::cascade_glow(&input, &config)?.image
                    }
                    CapturedMaterial::AffineOver(config) => {
                        filters::affine_over::apply(&input, &config, |count| work.samples(count))?
                    }
                    CapturedMaterial::GaussianUv(config) => {
                        filters::gaussian_uv::apply(&input, &config, |count| work.samples(count))?
                    }
                    CapturedMaterial::Shared(MaterialCommand::NoisySweep { .. }) => unreachable!(),
                };
                if filtered.size() != size {
                    bail!("CAPTION_MATERIAL_INVALID: capture filter output size");
                }
                work.spend(size.width, size.height)?;
                image = component_surface(filtered, 0, (size.width, size.height))?;
            }
            work.spend(size.width, size.height)?;
            let bitmap = builder.bitmap_id(BitmapData {
                width: size.width,
                height: size.height,
                rgba: Arc::from(image.data()),
            });
            builder.push(DrawOp::DrawEmissiveBitmap {
                bitmap,
                blend: match layer.blend {
                    CaptionLayerBlend::SourceOver => {
                        render_raster::drawop::AssociatedBlend::SourceOver
                    }
                    CaptionLayerBlend::Screen => render_raster::drawop::AssociatedBlend::Screen,
                    CaptionLayerBlend::Add => render_raster::drawop::AssociatedBlend::Add,
                },
                opacity: 1.0,
                tf: [
                    1.0,
                    0.0,
                    0.0,
                    1.0,
                    surface.origin[0] as f32,
                    surface.origin[1] as f32,
                ],
            });
            retained = retained.saturating_add(bytes.saturating_mul(2));
            hits.extend(source_hits);
        }
        Ok((builder.finish(), hits))
    }
    pub(super) fn material_page_context(
        &mut self,
        ci: usize,
        t: f64,
        node_id: &str,
        budget: &mut Budget,
    ) -> Result<Option<Context>> {
        let cue = &self.cues[ci];
        let params = cue_parameters(&self.style, &self.presentation, cue, &self.instance_id)?;
        let t = layout_clock::sample(
            self.style.scene(),
            cue,
            ci,
            self.cues.len(),
            t,
            &params,
            (self.width, self.height),
            &self.instance_id,
            &self.presentation.seed,
            budget,
        )?;
        let early = layout_clock::early_context(
            self.style.scene(),
            cue,
            ci,
            self.cues.len(),
            t,
            &params,
            (self.width, self.height),
            &self.instance_id,
            &self.presentation.seed,
        )?;
        let sampled = sampled_layout::sample_scene(self.style.scene(), &early, t, budget)?;
        let scene = sampled.as_ref().unwrap_or(self.style.scene());
        let units = resolved_units(
            &mut self.text,
            &self.layouts,
            ci,
            cue,
            scene,
            sampled.is_some(),
            t,
            &params,
            &self.presentation,
            &self.instance_id,
            (self.width, self.height),
            budget,
        )?;
        let Some((unit, _)) = units
            .get(node_id)
            .and_then(|v| v.iter().find(|(u, _)| u.kind == UnitKind::Page))
        else {
            return Ok(None);
        };
        let render = RenderContext {
            paint_viewport: None,
            scene,
            units: &units,
            params: &params,
            seconds: t,
            seed: u64::from_str_radix(&self.presentation.seed, 16)?,
            instance: &self.instance_id,
            cue,
            size: (self.width, self.height),
            images: &self.images,
        };
        Ok(Some(context(unit, &render)))
    }
    fn material_prefix(
        &mut self,
        ci: usize,
        t: f64,
        materials: &[CaptionMaterial],
        source_spec: Option<&CaptionLayerSource>,
        prefix: usize,
        pad: u32,
        size: (u32, u32),
        budget: &mut Budget,
        work: &mut Work,
    ) -> Result<(Pixmap, Vec<SceneHit>)> {
        budget.spend()?;
        if t < self.cues[ci].start || t >= self.cues[ci].end {
            return Ok((
                Pixmap::new(size.0, size.1)
                    .ok_or_else(|| anyhow::anyhow!("CAPTION_BUDGET_EXCEEDED: surface"))?,
                vec![],
            ));
        }
        if prefix == 0 {
            if let Some(CaptionLayerSource::ImageSequence { .. }) = source_spec {
                return self.sequence_source(ci, t, source_spec.unwrap(), pad, size, budget, work);
            }
            let selected = match source_spec {
                Some(CaptionLayerSource::Nodes { node_ids }) => Some(node_ids.as_slice()),
                _ => None,
            };
            let (mut ops, hits) = self.record_selected_nodes(t, Some(ci), selected, budget)?;
            translated(&mut ops, pad);
            work.spend(size.0, size.1)?;
            return Ok((
                rasterize_with_media(&ops, size.0, size.1, &mut EmptyMedia)?,
                hits,
            ));
        }
        match &materials[prefix - 1] {
            CaptionMaterial::NoisySweep { .. } => {
                let (mut source, hits) = self.material_prefix(
                    ci,
                    t,
                    materials,
                    source_spec,
                    prefix - 1,
                    pad,
                    size,
                    budget,
                    work,
                )?;
                let Some(MaterialCommand::NoisySweep {
                    domain,
                    position,
                    mask_scale,
                    reveal,
                    flip_y,
                }) = self.resolve_material_command(ci, t, &materials[prefix - 1], budget)?
                else {
                    source.data_mut().fill(0);
                    return Ok((source, vec![]));
                };
                Ok((
                    render_raster::effects::noisy_sweep::apply(
                        &source,
                        pad,
                        domain,
                        position,
                        mask_scale,
                        reveal,
                        if flip_y {
                            render_raster::effects::noisy_sweep::UvY::Up
                        } else {
                            render_raster::effects::noisy_sweep::UvY::Down
                        },
                        |n| work.samples(n),
                    )?,
                    hits,
                ))
            }
            CaptionMaterial::Blur { id, radius, passes } => {
                let (mut source, hits) = self.material_prefix(
                    ci,
                    t,
                    materials,
                    source_spec,
                    prefix - 1,
                    pad,
                    size,
                    budget,
                    work,
                )?;
                let cue = &self.cues[ci];
                let params =
                    cue_parameters(&self.style, &self.presentation, cue, &self.instance_id)?;
                let sampled_time = layout_clock::sample(
                    self.style.scene(),
                    cue,
                    ci,
                    self.cues.len(),
                    t,
                    &params,
                    (self.width, self.height),
                    &self.instance_id,
                    &self.presentation.seed,
                    budget,
                )?;
                let mut context = layout_clock::early_context(
                    self.style.scene(),
                    cue,
                    ci,
                    self.cues.len(),
                    sampled_time,
                    &params,
                    (self.width, self.height),
                    &self.instance_id,
                    &self.presentation.seed,
                )?;
                material_surface_context(&mut context, self.canvas_material_surface());
                context.stable_key.push_str(&format!("|material|{id}"));
                let amount = sample_value(
                    radius,
                    ValueType::Length,
                    self.style.scene(),
                    &context,
                    t,
                    budget,
                )?
                .map(|v| v.number())
                .transpose()?
                .unwrap_or(0.0);
                if !(0.0..=64.0).contains(&amount) {
                    bail!("CAPTION_MATERIAL_INVALID: blur radius");
                }
                let radius = libm::floor(amount + 0.5) as usize;
                if radius > 0 {
                    for _ in 0..*passes {
                        work.spend(size.0, size.1)?;
                        box_blur_premul_u8(source.data_mut(), size.0, size.1, radius);
                    }
                }
                Ok((source, hits))
            }
            CaptionMaterial::WaveDisplace {
                id,
                amplitude,
                wavelength,
                phase,
                axis,
                context_node_id,
            } => {
                let (mut source, hits) = self.material_prefix(
                    ci,
                    t,
                    materials,
                    source_spec,
                    prefix - 1,
                    pad,
                    size,
                    budget,
                    work,
                )?;
                let mut context = if let Some(node_id) = context_node_id {
                    // Page-relative uniforms: without a current page there is no domain.
                    let Some(context) = self.material_page_context(ci, t, node_id, budget)? else {
                        source.data_mut().fill(0);
                        return Ok((source, vec![]));
                    };
                    context
                } else {
                    let cue = &self.cues[ci];
                    let params =
                        cue_parameters(&self.style, &self.presentation, cue, &self.instance_id)?;
                    let sampled_time = layout_clock::sample(
                        self.style.scene(),
                        cue,
                        ci,
                        self.cues.len(),
                        t,
                        &params,
                        (self.width, self.height),
                        &self.instance_id,
                        &self.presentation.seed,
                        budget,
                    )?;
                    layout_clock::early_context(
                        self.style.scene(),
                        cue,
                        ci,
                        self.cues.len(),
                        sampled_time,
                        &params,
                        (self.width, self.height),
                        &self.instance_id,
                        &self.presentation.seed,
                    )?
                };
                material_surface_context(&mut context, self.canvas_material_surface());
                context.stable_key.push_str(&format!("|material|{id}"));
                let mut sample = |value: &DynamicValue, ty, fallback| -> Result<f64> {
                    Ok(
                        sample_value(value, ty, self.style.scene(), &context, t, budget)?
                            .map(|v| v.number())
                            .transpose()?
                            .unwrap_or(fallback),
                    )
                };
                let amplitude = sample(amplitude, ValueType::Length, 0.0)?;
                let wavelength = sample(wavelength, ValueType::Length, 1.0)?;
                let phase = sample(phase, ValueType::Angle, 0.0)?;
                if !amplitude.is_finite()
                    || !(-256.0..=256.0).contains(&amplitude)
                    || !wavelength.is_finite()
                    || !(1.0..=1_000_000.0).contains(&wavelength)
                    || !phase.is_finite()
                {
                    bail!("CAPTION_MATERIAL_INVALID: wave displacement uniforms");
                }
                if amplitude == 0.0 {
                    return Ok((source, hits));
                }
                // Four source texels per bilinear destination sample.
                for _ in 0..4 {
                    work.spend(size.0, size.1)?;
                }
                Ok((
                    wave_displace(&source, pad, amplitude, wavelength, phase, *axis)?,
                    hits,
                ))
            }
            CaptionMaterial::SoftBand {
                id,
                context_node_id,
                axis,
                center,
                half_width,
                feather,
                amount,
                opacity,
            } => {
                let (mut source, hits) = self.material_prefix(
                    ci,
                    t,
                    materials,
                    source_spec,
                    prefix - 1,
                    pad,
                    size,
                    budget,
                    work,
                )?;
                let Some(mut context) =
                    self.material_page_context(ci, t, context_node_id, budget)?
                else {
                    source.data_mut().fill(0);
                    return Ok((source, vec![]));
                };
                material_surface_context(&mut context, self.canvas_material_surface());
                context.stable_key.push_str(&format!("|material|{id}"));
                let mut sample = |value: &DynamicValue, fallback: f64| -> Result<f64> {
                    Ok(sample_value(
                        value,
                        ValueType::Scalar,
                        self.style.scene(),
                        &context,
                        t,
                        budget,
                    )?
                    .map(|v| v.number())
                    .transpose()?
                    .unwrap_or(fallback))
                };
                let center = sample(center, 0.5)?;
                let half_width = sample(half_width, 0.5)?;
                let feather = sample(feather, 0.0)?;
                let amount = sample(amount, 0.0)?;
                let opacity = sample(opacity, 1.0)?;
                if !(-4.0..=4.0).contains(&center)
                    || !(0.0..=4.0).contains(&half_width)
                    || !(0.0..=4.0).contains(&feather)
                    || !(0.0..=1.0).contains(&amount)
                    || !(0.0..=1.0).contains(&opacity)
                {
                    bail!("CAPTION_MATERIAL_INVALID: soft-band uniforms");
                }
                if amount != 0.0 || opacity != 1.0 {
                    work.spend(size.0, size.1)?;
                    soft_band(
                        &mut source,
                        pad,
                        (self.width, self.height),
                        *axis,
                        center,
                        half_width,
                        feather,
                        amount,
                        opacity,
                    );
                }
                Ok((source, hits))
            }
            CaptionMaterial::NoisePaletteMix {
                id,
                context_node_id,
                palette_resource_id,
                palette_position,
                phase,
                domain,
            } => {
                let (mut source, hits) = self.material_prefix(
                    ci,
                    t,
                    materials,
                    source_spec,
                    prefix - 1,
                    pad,
                    size,
                    budget,
                    work,
                )?;
                let Some(mut context) =
                    self.material_page_context(ci, t, context_node_id, budget)?
                else {
                    source.data_mut().fill(0);
                    return Ok((source, vec![]));
                };
                material_surface_context(&mut context, self.canvas_material_surface());
                context.stable_key.push_str(&format!("|material|{id}"));
                let scene = self.style.scene();
                let phase = component_uniform(
                    phase,
                    scene,
                    &context,
                    t,
                    budget,
                    0.0,
                    -1_000_000.0,
                    1_000_000.0,
                )?;
                let position =
                    component_uniform(palette_position, scene, &context, t, budget, 0.0, 0.0, 1.0)?;
                let mut rect = [0.0; 4];
                for (index, value) in [&domain.x, &domain.y, &domain.width, &domain.height]
                    .into_iter()
                    .enumerate()
                {
                    let Some(value) =
                        sample_value(value, ValueType::Length, scene, &context, t, budget)?
                    else {
                        source.data_mut().fill(0);
                        return Ok((source, vec![]));
                    };
                    rect[index] = value.number()?;
                }
                let palette = self.images.get(palette_resource_id).ok_or_else(|| {
                    anyhow::anyhow!("CAPTION_RESOURCE_MISSING: {palette_resource_id}")
                })?;
                // Fixed-cost six-corner noise and color arithmetic per destination.
                // Charge the full surface before evaluating any pixels.
                for _ in 0..32 {
                    work.spend(size.0, size.1)?;
                }
                super::noise_palette::apply(
                    source.data_mut(),
                    size,
                    pad,
                    rect,
                    phase,
                    palette,
                    position,
                )?;
                Ok((source, hits))
            }
            CaptionMaterial::NoiseDisplace {
                id,
                context_node_id,
                domain,
                noise_scale,
                phase,
                brightness,
                contrast,
                strength,
            } => {
                let (source, hits) = self.material_prefix(
                    ci,
                    t,
                    materials,
                    source_spec,
                    prefix - 1,
                    pad,
                    size,
                    budget,
                    work,
                )?;
                let Some(mut context) =
                    self.material_page_context(ci, t, context_node_id, budget)?
                else {
                    let mut source = source;
                    source.data_mut().fill(0);
                    return Ok((source, vec![]));
                };
                context.stable_key.push_str(&format!("|material|{id}"));
                let scene = self.style.scene();
                let mut uniform = |value, low, high| {
                    component_uniform(value, scene, &context, t, budget, 0.0, low, high)
                };
                let phase = uniform(phase, -1_000_000.0, 1_000_000.0)?;
                let brightness = uniform(brightness, -16.0, 16.0)?;
                let contrast = uniform(contrast, 0.0, 1000.0)?;
                let strength = uniform(strength, -16.0, 16.0)?;
                let mut rect = [0.0; 4];
                for (index, value) in [&domain.x, &domain.y, &domain.width, &domain.height]
                    .into_iter()
                    .enumerate()
                {
                    let Some(value) =
                        sample_value(value, ValueType::Length, scene, &context, t, budget)?
                    else {
                        let mut source = source;
                        source.data_mut().fill(0);
                        return Ok((source, vec![]));
                    };
                    rect[index] = value.number()?;
                }
                // Fixed noise kernel plus four bilinear taps per destination pixel,
                // charged for the full surface before evaluating any pixels.
                for _ in 0..36 {
                    work.spend(size.0, size.1)?;
                }
                let out = super::noise_displace::apply(
                    &source,
                    pad,
                    &super::noise_displace::NoiseDisplace {
                        domain: rect,
                        noise_scale: *noise_scale,
                        phase,
                        brightness,
                        contrast,
                        strength,
                    },
                )?;
                Ok((out, hits))
            }
            CaptionMaterial::GradientNoiseDisplace {
                id,
                context_node_id,
                domain,
                uv_y,
                field,
                brightness,
                contrast,
                range,
            } => {
                let (source, hits) = self.material_prefix(
                    ci,
                    t,
                    materials,
                    source_spec,
                    prefix - 1,
                    pad,
                    size,
                    budget,
                    work,
                )?;
                let Some(mut context) =
                    self.material_page_context(ci, t, context_node_id, budget)?
                else {
                    let mut source = source;
                    source.data_mut().fill(0);
                    return Ok((source, vec![]));
                };
                context.stable_key.push_str(&format!("|material|{id}"));
                let scene = self.style.scene();
                // A zoom without a keyframe value is neutral, not zero.
                let scale = component_uniform(&field.scale, scene, &context, t, budget, 1.0, 0.001, 1000.0)?;
                let mut uniform = |value, low, high| {
                    component_uniform(value, scene, &context, t, budget, 0.0, low, high)
                };
                let offset = [
                    uniform(&field.offset[0], -100_000.0, 100_000.0)?,
                    uniform(&field.offset[1], -100_000.0, 100_000.0)?,
                ];
                let evolution = uniform(&field.evolution, -100_000.0, 100_000.0)?;
                let brightness = uniform(brightness, -16.0, 16.0)?;
                let contrast = uniform(contrast, 0.0, 1000.0)?;
                let range = uniform(range, -16.0, 16.0)?;
                let mut rect = [0.0; 4];
                for (index, value) in [&domain.x, &domain.y, &domain.width, &domain.height]
                    .into_iter()
                    .enumerate()
                {
                    let Some(value) =
                        sample_value(value, ValueType::Length, scene, &context, t, budget)?
                    else {
                        let mut source = source;
                        source.data_mut().fill(0);
                        return Ok((source, vec![]));
                    };
                    rect[index] = value.number()?;
                }
                work.spend(size.0, size.1)?;
                let out = super::gradient_noise_displace::apply(
                    &source,
                    pad,
                    &super::gradient_noise_displace::GradientNoiseDisplace {
                        domain: rect,
                        uv_y: *uv_y,
                        complexity: field.complexity,
                        cycle: field.cycle,
                        sub_impact: field.sub_impact,
                        sub_scale: field.sub_scale,
                        sub_rotation: field.sub_rotation,
                        sub_offset: field.sub_offset,
                        rotation: field.rotation,
                        scale,
                        offset,
                        evolution,
                        brightness,
                        contrast,
                        range,
                    },
                    |count| work.samples(count),
                )?;
                Ok((out, hits))
            }
            CaptionMaterial::ScanWarp {
                id,
                context_node_id,
                domain,
                uv_y,
                warp,
                stripe,
                scanlines,
                gain,
            } => {
                let (source, hits) = self.material_prefix(
                    ci,
                    t,
                    materials,
                    source_spec,
                    prefix - 1,
                    pad,
                    size,
                    budget,
                    work,
                )?;
                let Some(mut context) =
                    self.material_page_context(ci, t, context_node_id, budget)?
                else {
                    let mut source = source;
                    source.data_mut().fill(0);
                    return Ok((source, vec![]));
                };
                context.stable_key.push_str(&format!("|material|{id}"));
                let scene = self.style.scene();
                let mut uniform = |value, low, high| {
                    component_uniform(value, scene, &context, t, budget, 0.0, low, high)
                };
                let evolution = uniform(&warp.evolution, -100_000.0, 100_000.0)?;
                let offset = [
                    uniform(&warp.offset[0], -100_000.0, 100_000.0)?,
                    uniform(&warp.offset[1], -100_000.0, 100_000.0)?,
                ];
                let strength = [
                    uniform(&warp.strength[0], -4.0, 4.0)?,
                    uniform(&warp.strength[1], -4.0, 4.0)?,
                ];
                let stripe_uniform = super::scan_warp::Stripe {
                    center: uniform(&stripe.center, -4.0, 4.0)?,
                    core_half_height: uniform(&stripe.core_half_height, 0.0, 1_000_000.0)?,
                    falloff: uniform(&stripe.falloff, 0.0, 1_000_000.0)?,
                    gate: uniform(&stripe.gate, 0.0, 1_000_000.0)?,
                    amount: uniform(&stripe.amount, -1.0, 1.0)?,
                    side: stripe.side,
                };
                let scanline_uniform = super::scan_warp::Scanlines {
                    amount: uniform(&scanlines.amount, -1.0, 1.0)?,
                    pitch: scanlines.pitch,
                    phase: uniform(&scanlines.phase, -1_000_000.0, 1_000_000.0)?,
                };
                let gain = uniform(gain, 0.0, 4.0)?;
                let mut rect = [0.0; 4];
                for (index, value) in [&domain.x, &domain.y, &domain.width, &domain.height]
                    .into_iter()
                    .enumerate()
                {
                    let Some(value) =
                        sample_value(value, ValueType::Length, scene, &context, t, budget)?
                    else {
                        let mut source = source;
                        source.data_mut().fill(0);
                        return Ok((source, vec![]));
                    };
                    rect[index] = value.number()?;
                }
                work.spend(size.0, size.1)?;
                let out = super::scan_warp::apply(
                    &source,
                    pad,
                    &super::scan_warp::ScanWarp {
                        domain: rect,
                        uv_y: *uv_y,
                        scale: warp.scale,
                        complexity: warp.complexity,
                        sub_impact: warp.sub_impact,
                        sub_scale: warp.sub_scale,
                        evolution,
                        offset,
                        strength,
                        swap_axes: warp.swap_axes,
                        stripe: stripe_uniform,
                        scanlines: scanline_uniform,
                        gain,
                    },
                    |count| work.samples(count),
                )?;
                Ok((out, hits))
            }
            CaptionMaterial::RadialWarp {
                id,
                context_node_id,
                domain,
                uv_y,
                strength,
                shift,
            } => {
                let (source, hits) = self.material_prefix(
                    ci,
                    t,
                    materials,
                    source_spec,
                    prefix - 1,
                    pad,
                    size,
                    budget,
                    work,
                )?;
                let Some(mut context) =
                    self.material_page_context(ci, t, context_node_id, budget)?
                else {
                    let mut source = source;
                    source.data_mut().fill(0);
                    return Ok((source, vec![]));
                };
                context.stable_key.push_str(&format!("|material|{id}"));
                let scene = self.style.scene();
                let mut uniform = |value, low, high| {
                    component_uniform(value, scene, &context, t, budget, 0.0, low, high)
                };
                let strength = uniform(strength, -4.0, 4.0)?;
                let shift = [uniform(&shift[0], -4.0, 4.0)?, uniform(&shift[1], -4.0, 4.0)?];
                let mut rect = [0.0; 4];
                for (index, value) in [&domain.x, &domain.y, &domain.width, &domain.height]
                    .into_iter()
                    .enumerate()
                {
                    let Some(value) =
                        sample_value(value, ValueType::Length, scene, &context, t, budget)?
                    else {
                        let mut source = source;
                        source.data_mut().fill(0);
                        return Ok((source, vec![]));
                    };
                    rect[index] = value.number()?;
                }
                work.spend(size.0, size.1)?;
                let out = super::radial_warp::apply(
                    &source,
                    pad,
                    &super::radial_warp::RadialWarp {
                        domain: rect,
                        uv_y: *uv_y,
                        strength,
                        shift,
                    },
                    |count| work.samples(count),
                )?;
                Ok((out, hits))
            }
            CaptionMaterial::GradientSmear {
                id,
                context_node_id,
                domain,
                rect_scale,
                evolution,
                seed,
                stretch,
                progress,
                strength,
                noise,
                uv_y,
            } => {
                let (mut source, hits) = self.material_prefix(
                    ci,
                    t,
                    materials,
                    source_spec,
                    prefix - 1,
                    pad,
                    size,
                    budget,
                    work,
                )?;
                let Some(mut context) =
                    self.material_page_context(ci, t, context_node_id, budget)?
                else {
                    source.data_mut().fill(0);
                    return Ok((source, vec![]));
                };
                material_surface_context(&mut context, self.canvas_material_surface());
                context.stable_key.push_str(&format!("|material|{id}"));
                let scene = self.style.scene();
                let mut rect = [0.0; 4];
                for (i, value) in [&domain.x, &domain.y, &domain.width, &domain.height]
                    .into_iter()
                    .enumerate()
                {
                    let Some(value) =
                        sample_value(value, ValueType::Length, scene, &context, t, budget)?
                    else {
                        source.data_mut().fill(0);
                        return Ok((source, vec![]));
                    };
                    rect[i] = value.number()?;
                }
                let scale = [
                    component_uniform(
                        &rect_scale[0],
                        scene,
                        &context,
                        t,
                        budget,
                        1.0,
                        0.001,
                        10_000.0,
                    )?,
                    component_uniform(
                        &rect_scale[1],
                        scene,
                        &context,
                        t,
                        budget,
                        1.0,
                        0.001,
                        10_000.0,
                    )?,
                ];
                let amount = [
                    component_uniform(&strength[0], scene, &context, t, budget, 0.0, -16.0, 16.0)?,
                    component_uniform(&strength[1], scene, &context, t, budget, 0.0, -16.0, 16.0)?,
                ];
                let uniforms = super::gradient_smear::Uniforms {
                    rect_scale: scale.map(|n| n as f32),
                    evolution: component_uniform(
                        evolution, scene, &context, t, budget, 0.0, -100_000.0, 100_000.0,
                    )? as f32,
                    seed: component_uniform(
                        seed, scene, &context, t, budget, 0.0, -100_000.0, 100_000.0,
                    )? as f32,
                    stretch: component_uniform(stretch, scene, &context, t, budget, 0.0, -2.0, 2.0)?
                        as f32,
                    progress: component_uniform(
                        progress, scene, &context, t, budget, 0.0, 0.0, 1.0,
                    )? as f32,
                    strength: amount.map(|n| n as f32),
                };
                work.spend(size.0, size.1)?;
                let image = super::gradient_smear::apply(
                    &source,
                    pad,
                    rect,
                    &uniforms,
                    noise,
                    *uv_y,
                    |count| work.samples(count),
                )?;
                Ok((image, hits))
            }
            CaptionMaterial::AngularSampleBlend {
                id,
                context_node_id,
                domain,
                aspect,
                angle,
            } => {
                let (mut source, hits) = self.material_prefix(
                    ci,
                    t,
                    materials,
                    source_spec,
                    prefix - 1,
                    pad,
                    size,
                    budget,
                    work,
                )?;
                let Some(mut context) =
                    self.material_page_context(ci, t, context_node_id, budget)?
                else {
                    source.data_mut().fill(0);
                    return Ok((source, vec![]));
                };
                material_surface_context(&mut context, self.canvas_material_surface());
                context.stable_key.push_str(&format!("|material|{id}"));
                let scene = self.style.scene();
                let aspect =
                    component_uniform(aspect, scene, &context, t, budget, 1.0, 0.0001, 10_000.0)?;
                let angle = sample_value(angle, ValueType::Angle, scene, &context, t, budget)?
                    .map(|v| v.number())
                    .transpose()?
                    .unwrap_or(0.0);
                let mut rect = [0.0; 4];
                for (i, value) in [&domain.x, &domain.y, &domain.width, &domain.height]
                    .into_iter()
                    .enumerate()
                {
                    let Some(value) =
                        sample_value(value, ValueType::Length, scene, &context, t, budget)?
                    else {
                        source.data_mut().fill(0);
                        return Ok((source, vec![]));
                    };
                    rect[i] = value.number()?;
                }
                // Clear/write the output once; the kernel charges actual 1/2/4
                // texel reads before each read and all 60 sample transforms.
                work.spend(size.0, size.1)?;
                let image =
                    super::angular_samples::apply(&source, pad, rect, aspect, angle, |count| {
                        work.samples(count)
                    })?;
                Ok((image, hits))
            }
            CaptionMaterial::AffineOver { .. } => {
                let (mut source, hits) = self.material_prefix(
                    ci,
                    t,
                    materials,
                    source_spec,
                    prefix - 1,
                    pad,
                    size,
                    budget,
                    work,
                )?;
                let Some(config) =
                    self.resolve_affine_over(ci, t, &materials[prefix - 1], budget)?
                else {
                    source.data_mut().fill(0);
                    return Ok((source, vec![]));
                };
                work.spend(self.width, self.height)?;
                let input = component_crop(&source, pad, (self.width, self.height))?;
                let image =
                    filters::affine_over::apply(&input, &config, |count| work.samples(count))?;
                work.spend(size.0, size.1)?;
                Ok((component_surface(image, pad, size)?, hits))
            }
            CaptionMaterial::AffineSampleBlend { .. } => {
                let (mut source, hits) = self.material_prefix(
                    ci,
                    t,
                    materials,
                    source_spec,
                    prefix - 1,
                    pad,
                    size,
                    budget,
                    work,
                )?;
                let Some(config) =
                    self.resolve_affine_samples(ci, t, &materials[prefix - 1], budget)?
                else {
                    source.data_mut().fill(0);
                    return Ok((source, vec![]));
                };
                work.spend(self.width, self.height)?;
                let input = component_crop(&source, pad, (self.width, self.height))?;
                let image =
                    filters::affine_samples::apply(&input, &config, |count| work.samples(count))?;
                work.spend(size.0, size.1)?;
                Ok((component_surface(image, pad, size)?, hits))
            }
            CaptionMaterial::GaussianUv { .. } => {
                let (mut source, hits) = self.material_prefix(
                    ci,
                    t,
                    materials,
                    source_spec,
                    prefix - 1,
                    pad,
                    size,
                    budget,
                    work,
                )?;
                let Some(config) =
                    self.resolve_gaussian_uv(ci, t, &materials[prefix - 1], budget)?
                else {
                    source.data_mut().fill(0);
                    return Ok((source, vec![]));
                };
                work.spend(self.width, self.height)?;
                let input = component_crop(&source, pad, (self.width, self.height))?;
                let image = filters::gaussian_uv::apply(&input, &config, |n| work.samples(n))?;
                work.spend(size.0, size.1)?;
                Ok((component_surface(image, pad, size)?, hits))
            }
            CaptionMaterial::GaussianAxis { .. } => {
                let (mut source, hits) = self.material_prefix(
                    ci,
                    t,
                    materials,
                    source_spec,
                    prefix - 1,
                    pad,
                    size,
                    budget,
                    work,
                )?;
                let Some(MaterialCommand::Gaussian(pass)) =
                    self.resolve_material_command(ci, t, &materials[prefix - 1], budget)?
                else {
                    source.data_mut().fill(0);
                    return Ok((source, vec![]));
                };
                work.spend(self.width, self.height)?;
                let input = component_crop(&source, pad, (self.width, self.height))?;
                work.components(filters::estimate_gaussian_reads(&input, pass)?)?;
                let image = filters::gaussian(&input, pass)?;
                work.spend(size.0, size.1)?;
                Ok((component_surface(image, pad, size)?, hits))
            }
            CaptionMaterial::GlowCascade { .. } => {
                let (mut source, hits) = self.material_prefix(
                    ci,
                    t,
                    materials,
                    source_spec,
                    prefix - 1,
                    pad,
                    size,
                    budget,
                    work,
                )?;
                let Some(MaterialCommand::Glow(config)) =
                    self.resolve_material_command(ci, t, &materials[prefix - 1], budget)?
                else {
                    source.data_mut().fill(0);
                    return Ok((source, vec![]));
                };
                work.spend(self.width, self.height)?;
                let input = component_crop(&source, pad, (self.width, self.height))?;
                if filters::estimate_glow_peak_bytes(input.size(), &config)? > MAX_SURFACE_BYTES {
                    bail!("CAPTION_BUDGET_EXCEEDED: component surfaces");
                }
                work.components(filters::estimate_glow_reads(&input, &config)?)?;
                let image = filters::cascade_glow(&input, &config)?.image;
                work.spend(size.0, size.1)?;
                Ok((component_surface(image, pad, size)?, hits))
            }
            CaptionMaterial::Feedback {
                samples,
                step,
                decay,
                offset,
                composite,
                ..
            } => {
                let mut out = Pixmap::new(size.0, size.1)
                    .ok_or_else(|| anyhow::anyhow!("CAPTION_BUDGET_EXCEEDED: surface"))?;
                let mut hits = Vec::new();
                // Mean: each in-cue sample lands on its own transparent surface
                // through the same placement path, then premultiplied bytes are
                // averaged with integer round-half-up over the in-cue count.
                let mean = *composite == FeedbackComposite::Mean;
                let mut sums = if mean {
                    vec![0u32; out.data().len()]
                } else {
                    Vec::new()
                };
                let mut count = 0u32;
                for i in (0..=*samples).rev() {
                    let past = t - step.seconds() * f64::from(i);
                    if past < self.cues[ci].start || past >= self.cues[ci].end {
                        continue;
                    }
                    let mut alpha = 1.0;
                    for _ in 0..i {
                        alpha *= decay;
                    }
                    if alpha == 0.0 {
                        continue;
                    }
                    let (source, current_hits) = self.material_prefix(
                        ci,
                        past,
                        materials,
                        source_spec,
                        prefix - 1,
                        pad,
                        size,
                        budget,
                        work,
                    )?;
                    if i == 0 {
                        hits = current_hits;
                    }
                    work.spend(size.0, size.1)?;
                    let mut sample_surface =
                        if mean {
                            Some(Pixmap::new(size.0, size.1).ok_or_else(|| {
                                anyhow::anyhow!("CAPTION_BUDGET_EXCEEDED: surface")
                            })?)
                        } else {
                            None
                        };
                    let target = sample_surface.as_mut().unwrap_or(&mut out);
                    if component_stack(&materials[..prefix - 1]) {
                        render_raster::emissive::composite_associated(
                            target,
                            source.as_ref(),
                            alpha as f32,
                            [
                                1.0,
                                0.0,
                                0.0,
                                1.0,
                                (offset[0] * f64::from(i)) as f32,
                                (offset[1] * f64::from(i)) as f32,
                            ],
                            None,
                        )?;
                    } else {
                        target.draw_pixmap(
                            0,
                            0,
                            source.as_ref(),
                            &tiny_skia::PixmapPaint {
                                opacity: alpha as f32,
                                ..Default::default()
                            },
                            Transform::from_translate(
                                (offset[0] * f64::from(i)) as f32,
                                (offset[1] * f64::from(i)) as f32,
                            ),
                            None,
                        );
                    }
                    if let Some(sample) = sample_surface {
                        work.spend(size.0, size.1)?;
                        for (sum, byte) in sums.iter_mut().zip(sample.data()) {
                            *sum += u32::from(*byte);
                        }
                        count += 1;
                    }
                }
                if mean && count > 0 {
                    for (byte, sum) in out.data_mut().iter_mut().zip(&sums) {
                        *byte = ((sum + count / 2) / count) as u8;
                    }
                }
                Ok((out, hits))
            }
        }
    }
}

fn component_stack(materials: &[CaptionMaterial]) -> bool {
    materials.iter().any(|material| {
        matches!(
            material,
            CaptionMaterial::NoisySweep { .. }
                | CaptionMaterial::AngularSampleBlend { .. }
                | CaptionMaterial::AffineSampleBlend { .. }
                | CaptionMaterial::AffineOver { .. }
                | CaptionMaterial::GradientSmear { .. }
                | CaptionMaterial::NoisePaletteMix { .. }
                | CaptionMaterial::GaussianAxis { .. }
                | CaptionMaterial::GaussianUv { .. }
                | CaptionMaterial::GlowCascade { .. }
        )
    })
}

pub(super) fn component_uniform(
    value: &DynamicValue,
    scene: &Scene,
    context: &Context,
    t: f64,
    budget: &mut Budget,
    fallback: f64,
    low: f64,
    high: f64,
) -> Result<f64> {
    let value = sample_value(value, ValueType::Scalar, scene, context, t, budget)?
        .map(|v| v.number())
        .transpose()?
        .unwrap_or(fallback);
    if !value.is_finite() || !(low..=high).contains(&value) {
        bail!("CAPTION_MATERIAL_INVALID: component uniform");
    }
    Ok(value)
}
pub(super) fn component_glow_tint(
    value: Option<&DynamicValue>,
    scene: &Scene,
    context: &Context,
    t: f64,
    budget: &mut Budget,
) -> Result<[f64; 3]> {
    // Omitted tint retains the old evaluation budget and exact white behavior.
    let Some(value) = value else {
        return Ok([1.0; 3]);
    };
    let color = match sample_value(value, ValueType::Color, scene, context, t, budget)? {
        Some(Evaluated::Color(color)) => color,
        None => [1.0; 4],
        _ => bail!("CAPTION_MATERIAL_INVALID: glow tint color"),
    };
    if color
        .iter()
        .any(|c| !c.is_finite() || !(0.0..=1.0).contains(c))
    {
        bail!("CAPTION_MATERIAL_INVALID: glow tint color");
    }
    // The alpha channel is validated as color data but is never a glow gain.
    Ok([color[0], color[1], color[2]])
}
pub(super) fn component_level_color(
    value: Option<&DynamicValue>,
    scene: &Scene,
    context: &Context,
    t: f64,
    budget: &mut Budget,
) -> Result<Option<[f64; 4]>> {
    // Unlike glowTint, a missing keyframe value means no level color, never white.
    let Some(value) = value else {
        return Ok(None);
    };
    let color = match sample_value(value, ValueType::Color, scene, context, t, budget)? {
        Some(Evaluated::Color(color)) => color,
        None => return Ok(None),
        _ => bail!("CAPTION_MATERIAL_INVALID: glow level color"),
    };
    if color
        .iter()
        .any(|c| !c.is_finite() || !(0.0..=1.0).contains(c))
    {
        bail!("CAPTION_MATERIAL_INVALID: glow level color");
    }
    Ok(Some(color))
}

pub(super) fn component_stage(
    stage: &GaussianStage,
    axis: filters::Axis,
    input: filters::Size,
    canvas: filters::Size,
    gamma: f64,
    scene: &Scene,
    context: &Context,
    t: f64,
    budget: &mut Budget,
) -> Result<filters::GaussianPass> {
    if stage.scale.num == 0 || stage.scale.num > stage.scale.den || stage.scale.den > 4096 {
        bail!("CAPTION_MATERIAL_INVALID: surface scale");
    }
    let scale = |dimension: u32| {
        ((u64::from(dimension) * u64::from(stage.scale.num) / u64::from(stage.scale.den)).max(1))
            as u32
    };
    let dimension = f64::from(if axis == filters::Axis::X {
        input.width
    } else {
        input.height
    });
    Ok(filters::GaussianPass {
        sampling: None,
        spacing_ramp: None,
        axis,
        sample_count: component_uniform(
            &stage.samples,
            scene,
            context,
            t,
            budget,
            0.0,
            0.0,
            1024.0,
        )?,
        step_pixels: component_uniform(&stage.step_uv, scene, context, t, budget, 0.0, 0.0, 1.0)?
            * dimension,
        sigma_pixels: component_uniform(
            &stage.sigma_uv,
            scene,
            context,
            t,
            budget,
            0.0,
            0.0,
            1024.0,
        )? * dimension,
        gamma: (gamma != 1.0).then_some(gamma),
        boundary: filters::Boundary::Replicate,
        output: filters::Size {
            width: scale(canvas.width),
            height: scale(canvas.height),
        },
    })
}
fn component_crop(source: &Pixmap, pad: u32, size: (u32, u32)) -> Result<filters::ComponentImage> {
    let mut data = Vec::with_capacity(size.0 as usize * size.1 as usize * 4);
    for y in pad..pad + size.1 {
        let start = (y as usize * source.width() as usize + pad as usize) * 4;
        data.extend_from_slice(&source.data()[start..start + size.0 as usize * 4]);
    }
    filters::ComponentImage::new(size.0, size.1, data)
}
fn component_surface(image: filters::ComponentImage, pad: u32, size: (u32, u32)) -> Result<Pixmap> {
    if image.width() + pad * 2 != size.0 || image.height() + pad * 2 != size.1 {
        bail!("CAPTION_MATERIAL_INVALID: component output dimensions");
    }
    let mut output = Pixmap::new(size.0, size.1)
        .ok_or_else(|| anyhow::anyhow!("CAPTION_BUDGET_EXCEEDED: component output"))?;
    let row = image.width() as usize * 4;
    for y in 0..image.height() as usize {
        let start = ((y + pad as usize) * size.0 as usize + pad as usize) * 4;
        output.data_mut()[start..start + row]
            .copy_from_slice(&image.data()[y * row..(y + 1) * row]);
    }
    Ok(output)
}

/// Closed lower edge and open upper edge when feather is zero, matching step.
fn band_smoothstep(low: f64, high: f64, u: f64) -> f64 {
    if high == low {
        return if u < low { 0.0 } else { 1.0 };
    }
    let t = ((u - low) / (high - low)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}
fn soft_band(
    source: &mut Pixmap,
    pad: u32,
    canvas: (u32, u32),
    axis: WaveAxis,
    center: f64,
    half_width: f64,
    feather: f64,
    amount: f64,
    opacity: f64,
) {
    let width = source.width() as usize;
    let dimension = f64::from(if axis == WaveAxis::X {
        canvas.0
    } else {
        canvas.1
    });
    for (i, pixel) in source.data_mut().chunks_exact_mut(4).enumerate() {
        let coordinate = if axis == WaveAxis::X {
            i % width
        } else {
            i / width
        };
        let u = (coordinate as f64 + 0.5 - f64::from(pad)) / dimension;
        let band = band_smoothstep(center - half_width - feather, center - half_width, u)
            * (1.0 - band_smoothstep(center + half_width, center + half_width + feather, u));
        let factor = ((1.0 - amount) + amount * band) * opacity;
        for channel in pixel {
            *channel = libm::floor(f64::from(*channel) * factor + 0.5) as u8;
        }
    }
}

/// Pixel centers use canvas coordinates, independent of temporary material padding.
/// The inverse map reads y + A*sin(tau*x/L + phase) for Y, and swaps axes for X.
fn wave_displace(
    source: &Pixmap,
    pad: u32,
    amplitude: f64,
    wavelength: f64,
    phase: f64,
    axis: WaveAxis,
) -> Result<Pixmap> {
    let width = source.width();
    let height = source.height();
    let mut out = Pixmap::new(width, height)
        .ok_or_else(|| anyhow::anyhow!("CAPTION_BUDGET_EXCEEDED: wave surface"))?;
    let phase = libm::fmod(phase, std::f64::consts::TAU);
    let count = if axis == WaveAxis::Y { width } else { height };
    let displacement = (0..count)
        .map(|coordinate| {
            let position = f64::from(coordinate) + 0.5 - f64::from(pad);
            amplitude * libm::sin(std::f64::consts::TAU * position / wavelength + phase)
        })
        .collect::<Vec<_>>();
    for y in 0..height {
        for x in 0..width {
            let (sx, sy) = match axis {
                WaveAxis::Y => (f64::from(x), f64::from(y) + displacement[x as usize]),
                WaveAxis::X => (f64::from(x) + displacement[y as usize], f64::from(y)),
            };
            let color = bilinear_transparent(source, sx, sy);
            let index = (y as usize * width as usize + x as usize) * 4;
            out.data_mut()[index..index + 4].copy_from_slice(&color);
        }
    }
    Ok(out)
}

/// Coordinates here index texel centers (integer zero is the first center).
pub(super) fn bilinear_transparent(source: &Pixmap, x: f64, y: f64) -> [u8; 4] {
    let left = libm::floor(x) as i64;
    let top = libm::floor(y) as i64;
    let dx = x - left as f64;
    let dy = y - top as f64;
    let mut values = [0.0; 4];
    for (tx, ty, weight) in [
        (left, top, (1.0 - dx) * (1.0 - dy)),
        (left + 1, top, dx * (1.0 - dy)),
        (left, top + 1, (1.0 - dx) * dy),
        (left + 1, top + 1, dx * dy),
    ] {
        if tx < 0 || ty < 0 || tx >= i64::from(source.width()) || ty >= i64::from(source.height()) {
            continue;
        }
        let index = (ty as usize * source.width() as usize + tx as usize) * 4;
        for channel in 0..4 {
            values[channel] += f64::from(source.data()[index + channel]) * weight;
        }
    }
    values.map(|value| libm::floor(value + 0.5).clamp(0.0, 255.0) as u8)
}

#[cfg(test)]
mod wave_tests {
    use super::*;

    fn dot(width: u32, height: u32, x: usize, y: usize) -> Pixmap {
        let mut image = Pixmap::new(width, height).unwrap();
        let index = (y * width as usize + x) * 4;
        image.data_mut()[index..index + 4].copy_from_slice(&[128, 64, 0, 128]);
        image
    }
    fn pixel(image: &Pixmap, x: usize, y: usize) -> [u8; 4] {
        let index = (y * image.width() as usize + x) * 4;
        image.data()[index..index + 4].try_into().unwrap()
    }
    #[test]
    fn bilinear_samples_premultiplied_channels_and_transparent_edges() {
        let image = dot(2, 2, 0, 0);
        assert_eq!(bilinear_transparent(&image, 0.0, 0.0), [128, 64, 0, 128]);
        assert_eq!(bilinear_transparent(&image, -0.5, 0.0), [64, 32, 0, 64]);
        assert_eq!(bilinear_transparent(&image, 0.5, 0.5), [32, 16, 0, 32]);
        assert_eq!(bilinear_transparent(&image, -1.0, 0.0), [0; 4]);
        assert_eq!(bilinear_transparent(&image, 2.0, 0.0), [0; 4]);
    }
    #[test]
    fn inverse_wave_uses_pixel_centers_signed_amplitude_and_selected_axis() {
        let phase = -std::f64::consts::FRAC_PI_4;
        let source = dot(8, 8, 1, 3);
        let up = wave_displace(&source, 0, 2.0, 4.0, phase, WaveAxis::Y).unwrap();
        let down = wave_displace(&source, 0, -2.0, 4.0, phase, WaveAxis::Y).unwrap();
        assert_eq!(pixel(&up, 1, 1), [128, 64, 0, 128]);
        assert_eq!(pixel(&down, 1, 5), [128, 64, 0, 128]);
        assert_eq!(pixel(&up, 1, 3), [0; 4]);
        let source = dot(8, 8, 3, 1);
        let left = wave_displace(&source, 0, 2.0, 4.0, phase, WaveAxis::X).unwrap();
        assert_eq!(pixel(&left, 1, 1), [128, 64, 0, 128]);
    }
    #[test]
    fn padding_does_not_change_canvas_phase_or_premultiplied_colors() {
        let original = dot(8, 8, 2, 3);
        let padded = dot(18, 18, 7, 8);
        let a = wave_displace(&original, 0, 1.2, 5.7, 0.8, WaveAxis::Y).unwrap();
        let b = wave_displace(&padded, 5, 1.2, 5.7, 0.8, WaveAxis::Y).unwrap();
        for y in 0..8 {
            for x in 0..8 {
                assert_eq!(pixel(&a, x, y), pixel(&b, x + 5, y + 5));
            }
        }
        assert!(
            b.data()
                .chunks_exact(4)
                .all(|p| p[..3].iter().all(|c| *c <= p[3]))
        );
        let repeated = wave_displace(
            &original,
            0,
            1.2,
            5.7,
            0.8 + std::f64::consts::TAU * 12.0,
            WaveAxis::Y,
        )
        .unwrap();
        assert_eq!(a.data(), repeated.data());
    }
}

#[cfg(test)]
mod soft_band_tests {
    use super::*;
    fn solid(w: u32, h: u32) -> Pixmap {
        let mut image = Pixmap::new(w, h).unwrap();
        for pixel in image.data_mut().chunks_exact_mut(4) {
            pixel.copy_from_slice(&[128, 64, 32, 128]);
        }
        image
    }
    #[test]
    fn soft_band_equals_its_two_smoothstep_formula_including_outside_centers() {
        let smooth = |low: f64, high: f64, u: f64| {
            let t = ((u - low) / (high - low)).clamp(0.0, 1.0);
            t * t * (3.0 - 2.0 * t)
        };
        for center in [-2.0, -0.3, 0.0, 0.5, 1.0, 1.7, 4.0] {
            let mut image = solid(101, 1);
            soft_band(
                &mut image,
                0,
                (101, 1),
                WaveAxis::X,
                center,
                0.2,
                0.3,
                1.0,
                1.0,
            );
            for (x, pixel) in image.data().chunks_exact(4).enumerate() {
                let u = (x as f64 + 0.5) / 101.0;
                let alpha = smooth(center - 0.5, center - 0.2, u)
                    * smooth(0.5 - center, 0.8 - center, 1.0 - u);
                let expected =
                    [128.0, 64.0, 32.0, 128.0].map(|c| libm::floor(c * alpha + 0.5) as u8);
                assert_eq!(pixel, expected, "center={center}, x={x}");
            }
        }
    }
    #[test]
    fn soft_band_zero_feather_step_amount_and_opacity_are_exact() {
        let original = solid(4, 1);
        let mut no_op = original.clone();
        soft_band(&mut no_op, 0, (4, 1), WaveAxis::X, 4.0, 0.0, 0.0, 0.0, 1.0);
        assert_eq!(no_op.data(), original.data());
        let mut image = original.clone();
        soft_band(&mut image, 0, (4, 1), WaveAxis::X, 0.5, 0.25, 0.0, 1.0, 1.0);
        assert_eq!(
            image
                .data()
                .chunks_exact(4)
                .map(|p| p[3])
                .collect::<Vec<_>>(),
            vec![0, 128, 128, 0]
        );
        soft_band(&mut image, 0, (4, 1), WaveAxis::X, 0.5, 0.25, 0.0, 0.0, 0.5);
        assert_eq!(
            image
                .data()
                .chunks_exact(4)
                .map(|p| p[3])
                .collect::<Vec<_>>(),
            vec![0, 64, 64, 0]
        );
        soft_band(&mut image, 0, (4, 1), WaveAxis::X, 0.5, 0.25, 0.0, 1.0, 0.0);
        assert!(image.data().iter().all(|v| *v == 0));
        assert_eq!(band_smoothstep(0.5, 0.5, 0.5), 1.0);
        assert_eq!(band_smoothstep(0.5, 0.5, 0.49), 0.0);
    }
    #[test]
    fn soft_band_uses_original_canvas_uv_for_both_axes_with_padding() {
        for axis in [WaveAxis::X, WaveAxis::Y] {
            let mut a = solid(8, 6);
            let mut b = solid(18, 16);
            soft_band(&mut a, 0, (8, 6), axis, 0.37, 0.13, 0.31, 0.82, 0.73);
            soft_band(&mut b, 5, (8, 6), axis, 0.37, 0.13, 0.31, 0.82, 0.73);
            for y in 0..6 {
                for x in 0..8 {
                    let ai = (y * 8 + x) * 4;
                    let bi = ((y + 5) * 18 + x + 5) * 4;
                    assert_eq!(&a.data()[ai..ai + 4], &b.data()[bi..bi + 4]);
                }
            }
            assert!(
                b.data()
                    .chunks_exact(4)
                    .all(|p| p[..3].iter().all(|c| *c <= p[3]))
            );
        }
    }

    fn fixture() -> serde_json::Value {
        serde_json::from_str(include_str!(
            "../../../caption-scene/tests/fixtures/soft-band.json"
        ))
        .unwrap()
    }
    fn cue(id: &str, start: f64, end: f64) -> SceneCue {
        SceneCue {
            id: id.into(),
            document_id: "doc".into(),
            text: "A B C D".into(),
            start,
            end,
            words: ["A", "B", "C", "D"]
                .iter()
                .enumerate()
                .map(|(i, text)| SceneWord {
                    id: format!("{id}-{i}"),
                    text: (*text).into(),
                    start: start + i as f64 * (end - start) / 4.0,
                    end: start + (i as f64 + 0.8) * (end - start) / 4.0,
                })
                .collect(),
        }
    }
    fn plan(body: serde_json::Value, cues: Vec<SceneCue>) -> ScenePlan {
        ScenePlan::compile(
            parse_style(&body).unwrap(),
            Presentation::default(),
            cues,
            (160, 90),
            TextEngine::with_document_fonts(&[include_bytes!(
                "../../../render-raster/assets/fonts/NotoSansSC-Variable.ttf"
            )
            .to_vec()]),
            "instance".into(),
        )
        .unwrap()
    }
    #[test]
    fn soft_band_neutral_parameters_preserve_rendered_rgba() {
        let mut body = fixture();
        body["scene"]["value"]["materials"][0]["amount"] =
            serde_json::json!({"kind":"constant","value":0});
        body["scene"]["value"]["materials"][0]["opacity"] =
            serde_json::json!({"kind":"constant","value":1});
        let mut masked = plan(body.clone(), vec![cue("same", 0.0, 4.0)]);
        body["scene"]["value"]["materials"] = serde_json::json!([]);
        let mut plain = plan(body, vec![cue("same", 0.0, 4.0)]);
        for t in [0.2, 1.4, 2.2, 3.5] {
            assert_eq!(
                masked.render(t).unwrap().rgba,
                plain.render(t).unwrap().rgba
            );
        }
    }
    #[test]
    fn soft_band_context_uses_its_resolved_page_and_input_last_word_timing() {
        let mut p = plan(fixture(), vec![cue("first", 0.0, 4.0)]);
        for (t, page, last_start) in [(0.5, 0.0, 1.0), (2.5, 1.0, 3.0), (0.5, 0.0, 1.0)] {
            let c = p
                .material_page_context(0, t, "caption", &mut Budget::default())
                .unwrap()
                .unwrap();
            assert_eq!(c.fields["unit.pageIndex"].number().unwrap(), page);
            assert_eq!(c.fields["unit.pageCount"].number().unwrap(), 2.0);
            assert!(c.fields["unit.pageLastWordTimed"].boolean().unwrap());
            assert!(
                (c.fields["time.pageLastWordElapsedSeconds"]
                    .number()
                    .unwrap()
                    - (t - last_start))
                    .abs()
                    < 1e-12
            );
            assert!(
                (c.fields["time.pageLastWordDurationSeconds"]
                    .number()
                    .unwrap()
                    - 0.8)
                    .abs()
                    < 1e-12
            );
            assert!(c.fields["layout.inkHeight"].number().unwrap() > 0.0);
        }
        assert!(
            p.material_page_context(0, 0.5, "missing", &mut Budget::default())
                .unwrap()
                .is_none()
        );
        let mut body = fixture();
        body["scene"]["value"]["speechState"]["timingPolicy"] = serde_json::json!("estimated");
        let mut untimed = cue("untimed", 0.0, 4.0);
        untimed.words.clear();
        let mut p = plan(body.clone(), vec![untimed]);
        let c = p
            .material_page_context(0, 2.5, "caption", &mut Budget::default())
            .unwrap()
            .unwrap();
        assert!(!c.fields["unit.pageLastWordTimed"].boolean().unwrap());
        assert_eq!(
            c.fields["time.pageLastWordElapsedSeconds"]
                .number()
                .unwrap(),
            0.0
        );
        assert_eq!(
            c.fields["time.pageLastWordDurationSeconds"]
                .number()
                .unwrap(),
            0.0
        );
        // Static text is display content, even when it happens to equal a timed cue.
        body["scene"]["value"]["nodes"][0]["text"] =
            serde_json::json!({"source":"static","text":"A B C D"});
        let mut p = plan(body, vec![cue("timed", 0.0, 4.0)]);
        assert!(
            !p.material_page_context(0, 0.5, "caption", &mut Budget::default())
                .unwrap()
                .unwrap()
                .fields["unit.pageLastWordTimed"]
                .boolean()
                .unwrap()
        );
    }
    #[test]
    fn soft_band_missing_page_and_invalid_sampled_uniforms_are_explicit() {
        let mut body = fixture();
        body["scene"]["value"]["layout"]["leadingGap"] = serde_json::json!("hide");
        let mut delayed = cue("delayed", 0.0, 4.0);
        for w in &mut delayed.words {
            w.start += 0.5;
            w.end += 0.5;
        }
        let mut p = plan(body, vec![delayed]);
        assert!(
            p.material_page_context(0, 0.1, "caption", &mut Budget::default())
                .unwrap()
                .is_none()
        );
        assert!(p.render(0.1).unwrap().rgba.iter().all(|v| *v == 0));
        let mut body = fixture();
        body["scene"]["value"]["materials"][0]["amount"] = serde_json::json!({"kind":"expression","expression":{"op":"literal","type":"scalar","value":2}});
        let error = plan(body, vec![cue("invalid", 0.0, 4.0)])
            .render(0.5)
            .err()
            .unwrap()
            .to_string();
        assert!(error.contains("CAPTION_MATERIAL_INVALID"), "{error}");
    }
    #[test]
    fn soft_band_feedback_recomputes_each_history_page_and_cannot_cross_cues() {
        let mut body = fixture();
        body["scene"]["value"]["materials"].as_array_mut().unwrap().push(serde_json::json!({"kind":"feedback","id":"tail","samples":2,"step":{"ticks":150,"timescale":1000},"decay":0.6,"offset":[1,0]}));
        let mut p = plan(
            body.clone(),
            vec![cue("first", 0.0, 4.0), cue("second", 4.0, 8.0)],
        );
        for t in [1.75, 2.05, 3.2, 4.02, 1.75] {
            let now = p.render(t).unwrap();
            let fresh = plan(
                body.clone(),
                vec![cue("first", 0.0, 4.0), cue("second", 4.0, 8.0)],
            )
            .render(t)
            .unwrap();
            assert_eq!(now.rgba, fresh.rgba);
            assert_eq!(now.fingerprint, fresh.fingerprint);
        }
        assert!(p.render(3.72).unwrap().rgba.iter().any(|v| *v > 0));
        let isolated = plan(body, vec![cue("second", 4.0, 8.0)])
            .render(4.02)
            .unwrap();
        assert_eq!(p.render(4.02).unwrap().rgba, isolated.rgba);
    }
    #[test]
    fn page_envelope_material_context_tracks_real_size_runs_and_feedback_samples() {
        let body: serde_json::Value = serde_json::from_str(include_str!(
            "../../../caption-scene/tests/fixtures/page-envelope.json"
        ))
        .unwrap();
        let mut p = plan(body.clone(), vec![cue("first", 0.0, 4.0)]);
        let initial = p
            .material_page_context(0, 0.0, "caption", &mut Budget::default())
            .unwrap()
            .unwrap();
        let peak = p
            .material_page_context(0, 0.28, "caption", &mut Budget::default())
            .unwrap()
            .unwrap();
        assert!(
            initial.fields["unit.pageEnvelopeAvailable"]
                .boolean()
                .unwrap()
        );
        assert_eq!(initial.fields["unit.pageLineCount"].number().unwrap(), 2.0);
        assert_eq!(
            initial.fields["layout.pageMaxFontSize"].number().unwrap(),
            20.0
        );
        assert!((peak.fields["layout.pageMaxFontSize"].number().unwrap() - 26.0).abs() < 1e-8);
        assert!(
            peak.fields["layout.pageEnvelopeHeight"].number().unwrap()
                > initial.fields["layout.pageEnvelopeHeight"]
                    .number()
                    .unwrap()
        );
        let next = p
            .material_page_context(0, 3.1, "caption", &mut Budget::default())
            .unwrap()
            .unwrap();
        assert_eq!(next.fields["unit.pageLineCount"].number().unwrap(), 1.0);
        assert!(next.fields["layout.pageMaxFontSize"].number().unwrap() < 26.0);
        assert_eq!(
            initial.fields,
            p.material_page_context(0, 0.0, "caption", &mut Budget::default())
                .unwrap()
                .unwrap()
                .fields
        );

        let mut feedback = body;
        feedback["scene"]["value"]["requiredCapabilities"]
            .as_array_mut()
            .unwrap()
            .push(serde_json::json!("caption-feedback/1"));
        feedback["scene"]["value"]["materials"] = serde_json::json!([{"kind":"feedback","id":"trail","samples":2,"step":{"ticks":150,"timescale":1000},"decay":0.6,"offset":[1,0]}]);
        let mut reused = plan(feedback.clone(), vec![cue("first", 0.0, 4.0)]);
        for time in [0.28, 3.1, 1.5, 0.28] {
            let frame = reused.render(time).unwrap();
            let fresh = plan(feedback.clone(), vec![cue("first", 0.0, 4.0)])
                .render(time)
                .unwrap();
            assert_eq!(frame.rgba, fresh.rgba);
            assert_eq!(frame.fingerprint, fresh.fingerprint);
        }
    }
}

#[cfg(test)]
mod glow_tint_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn glow_tint_uses_shared_budget_color_type_and_white_keyframe_fallback() {
        let body = serde_json::from_str(include_str!(
            "../../../caption-scene/tests/fixtures/glow-cascade.json"
        ))
        .unwrap();
        let style = caption_scene::parse_style(&body).unwrap();
        let mut context = Context::default();
        context.spans.insert(UnitKind::Page, (1.0, 2.0));
        let mut none_budget = Budget::new(0);
        assert_eq!(
            component_glow_tint(None, style.scene(), &context, 0.0, &mut none_budget).unwrap(),
            [1.0; 3]
        );
        assert_eq!(none_budget.remaining(), 0);
        let value: DynamicValue =
            serde_json::from_value(json!({"kind":"constant","value":"#FFFFFF00"})).unwrap();
        assert!(
            component_glow_tint(
                Some(&value),
                style.scene(),
                &context,
                0.0,
                &mut Budget::new(0)
            )
            .unwrap_err()
            .to_string()
            .contains("CAPTION_BUDGET_EXCEEDED")
        );
        assert_eq!(
            component_glow_tint(
                Some(&value),
                style.scene(),
                &context,
                0.0,
                &mut Budget::new(1)
            )
            .unwrap(),
            [1.0; 3]
        );
        let keys: DynamicValue = serde_json::from_value(json!({"kind":"keyframes","clock":{"unit":"page","origin":"start","duration":{"kind":"unit-span"}},"keys":[{"at":0,"value":"#FF0000"},{"at":1,"value":"#0000FF"}]})).unwrap();
        assert_eq!(
            component_glow_tint(
                Some(&keys),
                style.scene(),
                &context,
                0.0,
                &mut Budget::default()
            )
            .unwrap(),
            [1.0; 3]
        );
        assert_eq!(
            component_glow_tint(
                Some(&keys),
                style.scene(),
                &context,
                1.0,
                &mut Budget::default()
            )
            .unwrap(),
            [1.0, 0.0, 0.0]
        );
        let invalid: DynamicValue = serde_json::from_value(json!({"kind":"expression","expression":{"op":"call","function":"mix","args":[{"op":"literal","type":"color","value":"#000000"},{"op":"literal","type":"color","value":"#FFFFFF"},{"op":"literal","type":"scalar","value":2}]}})).unwrap();
        assert!(
            component_glow_tint(
                Some(&invalid),
                style.scene(),
                &context,
                0.0,
                &mut Budget::default()
            )
            .unwrap_err()
            .to_string()
            .contains("CAPTION_MATERIAL_INVALID")
        );
    }
}

pub(super) fn sample_domain(
    domain: &MaterialDomain,
    scene: &Scene,
    context: &Context,
    t: f64,
    budget: &mut Budget,
) -> Result<[f64; 4]> {
    let mut rect = [0.0; 4];
    for (i, value) in [&domain.x, &domain.y, &domain.width, &domain.height]
        .into_iter()
        .enumerate()
    {
        rect[i] = sample_value(value, ValueType::Length, scene, context, t, budget)?
            .ok_or_else(|| anyhow::anyhow!("CAPTION_MATERIAL_INVALID: missing domain"))?
            .number()?;
        let low = if i < 2 { -1_000_000.0 } else { 0.001 };
        if !rect[i].is_finite() || !(low..=1_000_000.0).contains(&rect[i]) {
            bail!("CAPTION_MATERIAL_INVALID: domain");
        }
    }
    Ok(rect)
}
impl ScenePlan {
    fn sequence_source(
        &mut self,
        ci: usize,
        t: f64,
        source: &CaptionLayerSource,
        pad: u32,
        size: (u32, u32),
        budget: &mut Budget,
        work: &mut Work,
    ) -> Result<(Pixmap, Vec<SceneHit>)> {
        work.spend(size.0, size.1)?;
        let mut out = Pixmap::new(size.0, size.1)
            .ok_or_else(|| anyhow::anyhow!("CAPTION_BUDGET_EXCEEDED: sequence surface"))?;
        let Some(quad) = self.resolve_sequence_quad(ci, t, source, budget)? else {
            return Ok((out, vec![]));
        };
        let bitmap = quad.bitmap;
        let rect = quad.domain;
        let uv_scale = quad.uv_scale;
        let uv_offset = quad.uv_offset;
        let x0 = libm::floor(rect[0] + f64::from(pad))
            .max(0.0)
            .min(f64::from(size.0)) as u32;
        let y0 = libm::floor(rect[1] + f64::from(pad))
            .max(0.0)
            .min(f64::from(size.1)) as u32;
        let x1 = libm::ceil(rect[0] + rect[2] + f64::from(pad))
            .max(0.0)
            .min(f64::from(size.0)) as u32;
        let y1 = libm::ceil(rect[1] + rect[3] + f64::from(pad))
            .max(0.0)
            .min(f64::from(size.1)) as u32;
        work.samples(u64::from(x1.saturating_sub(x0)) * u64::from(y1.saturating_sub(y0)) * 5)?;
        for y in y0..y1 {
            for x in x0..x1 {
                let local = [
                    (f64::from(x) + 0.5 - f64::from(pad) - rect[0]) / rect[2],
                    (f64::from(y) + 0.5 - f64::from(pad) - rect[1]) / rect[3],
                ];
                if local.iter().any(|n| *n < 0.0 || *n >= 1.0) {
                    continue;
                }
                let uv: [f64; 2] = std::array::from_fn(|i| {
                    ((local[i] - 0.5) / uv_scale[i] + 0.5 + uv_offset[i]).clamp(0.0, 1.0)
                });
                let pos = [
                    (uv[0] * f64::from(bitmap.width) - 0.5).clamp(0.0, f64::from(bitmap.width - 1)),
                    (uv[1] * f64::from(bitmap.height) - 0.5)
                        .clamp(0.0, f64::from(bitmap.height - 1)),
                ];
                let ix = libm::floor(pos[0]) as u32;
                let iy = libm::floor(pos[1]) as u32;
                let fx = (pos[0] - f64::from(ix)) as f32;
                let fy = (pos[1] - f64::from(iy)) as f32;
                let mut pixel = [0.0f32; 4];
                for (dy, wy) in [(0, 1.0 - fy), (1, fy)] {
                    for (dx, wx) in [(0, 1.0 - fx), (1, fx)] {
                        let off = (((iy + dy).min(bitmap.height - 1) * bitmap.width
                            + (ix + dx).min(bitmap.width - 1))
                            * 4) as usize;
                        for c in 0..4 {
                            pixel[c] += f32::from(bitmap.rgba[off + c]) * wx * wy;
                        }
                    }
                }
                let off = ((y * size.0 + x) * 4) as usize;
                for c in 0..4 {
                    out.data_mut()[off + c] = libm::floorf(pixel[c] + 0.5).clamp(0.0, 255.0) as u8;
                }
            }
        }
        Ok((out, vec![]))
    }
}
