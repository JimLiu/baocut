//! Resolve the shared caption semantics before selecting a pixel executor.
use super::materials::{
    component_glow_tint, component_level_color, component_stage, component_uniform, sample_domain,
};
use super::*;
use render_raster::drawop::AssociatedBlend;
use render_raster::effects::{
    component_filters as filters,
    material_plan::{ImageQuad, MaterialCommand, MaterialFrame, MaterialLayer, MaterialSource},
};
impl ScenePlan {
    pub(super) fn resolve_gaussian_uv(
        &mut self,
        ci: usize,
        t: f64,
        material: &CaptionMaterial,
        budget: &mut Budget,
    ) -> Result<Option<filters::gaussian_uv::Config>> {
        let CaptionMaterial::GaussianUv {
            id,
            context_node_id,
            sampling,
            samples,
            step_uv,
            sigma_uv,
            rgb_gain,
            boundary,
        } = material
        else {
            bail!("CAPTION_MATERIAL_INVALID: Gaussian UV kind");
        };
        let Some(mut context) = self.material_page_context(ci, t, context_node_id, budget)? else {
            return Ok(None);
        };
        context.stable_key.push_str(&format!("|material|{id}"));
        let scene = self.style.scene();
        let input = sample_domain(&sampling.input, scene, &context, t, budget)?;
        let size = filters::Size {
            width: self.width,
            height: self.height,
        };
        if input.iter().any(|v| *v < 0. || v.fract() != 0.)
            || input[0] + input[2] > size.width as f64
            || input[1] + input[3] > size.height as f64
        {
            bail!("CAPTION_MATERIAL_INVALID: Gaussian UV input ROI");
        }
        let scalar = |value: &DynamicValue, budget: &mut Budget| -> Result<f64> {
            Ok(
                sample_value(value, ValueType::Scalar, scene, &context, t, budget)?
                    .ok_or_else(|| {
                        anyhow::anyhow!("CAPTION_MATERIAL_INVALID: missing Gaussian UV value")
                    })?
                    .number()?,
            )
        };
        let config = filters::gaussian_uv::Config {
            sampling: filters::GaussianSampling {
                input: input.map(|v| v as u32),
                output: sample_domain(&sampling.output, scene, &context, t, budget)?,
            },
            samples: scalar(samples, budget)?,
            step_uv: [scalar(&step_uv[0], budget)?, scalar(&step_uv[1], budget)?],
            sigma_uv: scalar(sigma_uv, budget)?,
            rgb_gain: scalar(rgb_gain, budget)?,
            boundary: match boundary {
                ComponentBoundary::Normalize => filters::Boundary::Normalize,
                ComponentBoundary::Transparent => filters::Boundary::Transparent,
                ComponentBoundary::Replicate => filters::Boundary::Replicate,
            },
            output: size,
        };
        config.validate(size)?;
        Ok(Some(config))
    }
    pub(super) fn resolve_affine_over(
        &mut self,
        ci: usize,
        t: f64,
        material: &CaptionMaterial,
        budget: &mut Budget,
    ) -> Result<Option<filters::affine_over::Config>> {
        let CaptionMaterial::AffineOver {
            id,
            context_node_id,
            sampling,
            foreground,
            background,
            background_opacity,
            background_rgb_scale,
            boundary,
        } = material
        else {
            bail!("CAPTION_MATERIAL_INVALID: affine over kind");
        };
        let Some(mut context) = self.material_page_context(ci, t, context_node_id, budget)? else {
            return Ok(None);
        };
        context.stable_key.push_str(&format!("|material|{id}"));
        let scene = self.style.scene();
        let input = sample_domain(&sampling.input, scene, &context, t, budget)?;
        let size = filters::Size {
            width: self.width,
            height: self.height,
        };
        if input.iter().any(|v| *v < 0. || v.fract() != 0.)
            || input[0] + input[2] > size.width as f64
            || input[1] + input[3] > size.height as f64
        {
            bail!(
                "CAPTION_MATERIAL_INVALID: affine over input ROI must be integer and inside input surface"
            );
        }
        let mut matrices = [[0.; 6]; 2];
        for (matrix, values) in matrices.iter_mut().zip([foreground, background]) {
            for (slot, value) in matrix.iter_mut().zip(values) {
                *slot = sample_value(value, ValueType::Scalar, scene, &context, t, budget)?
                    .ok_or_else(|| {
                        anyhow::anyhow!("CAPTION_MATERIAL_INVALID: missing affine over value")
                    })?
                    .number()?;
            }
        }
        let scalar = |value: &DynamicValue, budget: &mut Budget| -> Result<f64> {
            Ok(
                sample_value(value, ValueType::Scalar, scene, &context, t, budget)?
                    .ok_or_else(|| {
                        anyhow::anyhow!(
                            "CAPTION_MATERIAL_INVALID: missing affine over opacity/scale"
                        )
                    })?
                    .number()?,
            )
        };
        let config = filters::affine_over::Config {
            sampling: filters::GaussianSampling {
                input: input.map(|v| v as u32),
                output: sample_domain(&sampling.output, scene, &context, t, budget)?,
            },
            foreground: matrices[0],
            background: matrices[1],
            background_opacity: scalar(background_opacity, budget)?,
            background_rgb_scale: scalar(background_rgb_scale, budget)?,
            boundary: match boundary {
                ComponentBoundary::Transparent => filters::Boundary::Transparent,
                ComponentBoundary::Replicate => filters::Boundary::Replicate,
                ComponentBoundary::Normalize => {
                    bail!("CAPTION_MATERIAL_INVALID: affine over boundary")
                }
            },
            output: size,
        };
        config.validate(size)?;
        Ok(Some(config))
    }
    pub(super) fn resolve_affine_samples(
        &mut self,
        ci: usize,
        t: f64,
        material: &CaptionMaterial,
        budget: &mut Budget,
    ) -> Result<Option<filters::affine_samples::Config>> {
        let CaptionMaterial::AffineSampleBlend {
            id,
            context_node_id,
            sampling,
            transforms,
            sample_range,
            distance_range,
            boundary,
        } = material
        else {
            bail!("CAPTION_MATERIAL_INVALID: affine material kind");
        };
        let Some(mut context) = self.material_page_context(ci, t, context_node_id, budget)? else {
            return Ok(None);
        };
        context.stable_key.push_str(&format!("|material|{id}"));
        let scene = self.style.scene();
        let input = sample_domain(&sampling.input, scene, &context, t, budget)?;
        let size = filters::Size {
            width: self.width,
            height: self.height,
        };
        if input.iter().any(|v| *v < 0.0 || v.fract() != 0.0)
            || input[0] + input[2] > size.width as f64
            || input[1] + input[3] > size.height as f64
        {
            bail!(
                "CAPTION_MATERIAL_INVALID: affine input domain requires an integer texel view inside the input surface"
            );
        }
        let mut matrices = Vec::with_capacity(transforms.len());
        for values in transforms {
            let mut matrix = [0.0; 6];
            for (slot, value) in matrix.iter_mut().zip(values) {
                *slot = sample_value(value, ValueType::Scalar, scene, &context, t, budget)?
                    .ok_or_else(|| {
                        anyhow::anyhow!("CAPTION_MATERIAL_INVALID: missing affine transform value")
                    })?
                    .number()?;
            }
            matrices.push(matrix);
        }
        let config = filters::affine_samples::Config {
            sampling: filters::GaussianSampling {
                input: input.map(|v| v as u32),
                output: sample_domain(&sampling.output, scene, &context, t, budget)?,
            },
            transforms: matrices,
            sample_range: *sample_range,
            distance_range: *distance_range,
            boundary: match boundary {
                ComponentBoundary::Normalize => filters::Boundary::Normalize,
                ComponentBoundary::Replicate => filters::Boundary::Replicate,
                ComponentBoundary::Transparent => filters::Boundary::Transparent,
            },
            output: size,
        };
        config.validate(size)?;
        Ok(Some(config))
    }
    /// Record source geometry and resolved material uniforms without executing any
    /// per-pixel filter. Unsupported material kinds fail before returning a frame.
    pub fn record_material_plan(&mut self, t: f64) -> Result<(MaterialFrame, Vec<SceneHit>)> {
        if !t.is_finite() {
            bail!("CAPTION_SCENE_INVALID: sample time");
        }
        let mut budget = Budget::default();
        let layers = if self.style.scene().render_layers.is_empty() {
            vec![CaptionRenderLayer {
                id: "main".into(),
                source: CaptionLayerSource::Nodes {
                    node_ids: self
                        .style
                        .scene()
                        .nodes
                        .iter()
                        .map(|n| n.id.clone())
                        .collect(),
                },
                materials: self.style.scene().materials.clone(),
                blend: CaptionLayerBlend::SourceOver,
            }]
        } else {
            self.style.scene().render_layers.clone()
        };
        for layer in &layers {
            for material in &layer.materials {
                if !matches!(
                    material,
                    CaptionMaterial::NoisySweep { .. }
                        | CaptionMaterial::GaussianAxis { .. }
                        | CaptionMaterial::AffineSampleBlend { .. }
                        | CaptionMaterial::GlowCascade { .. }
                ) {
                    bail!(
                        "CAPTION_MATERIAL_PLAN_UNSUPPORTED: material {}",
                        material_id(material)
                    );
                }
                // caption-glow-linear/1 is CPU-raster only; the GPU glow shader
                // covers up to 7 encoded levels with RGB gamma.
                if let CaptionMaterial::GlowCascade {
                    levels,
                    gamma_channels,
                    aggregation,
                    composite,
                    ..
                } = material
                {
                    if levels.len() > 7
                        || *gamma_channels == Some(GammaChannels::Rgba)
                        || *aggregation == Some(GlowAggregation::Linear)
                        || *composite == GlowComposite::OriginalOverScreen
                    {
                        bail!(
                            "CAPTION_MATERIAL_PLAN_UNSUPPORTED: material {}",
                            material_id(material)
                        );
                    }
                }
            }
        }
        let active: Vec<_> = self
            .cues
            .iter()
            .enumerate()
            .filter(|(_, c)| t >= c.start && t < c.end)
            .map(|(i, _)| i)
            .collect();
        if active.len().saturating_mul(layers.len()) > 64 {
            bail!("CAPTION_BUDGET_EXCEEDED: material plan layers");
        }
        let mut result = MaterialFrame {
            width: self.width,
            height: self.height,
            layers: Vec::new(),
        };
        let mut hits = Vec::new();
        for layer in layers {
            for &ci in &active {
                let (source, source_hits) = match &layer.source {
                    CaptionLayerSource::Nodes { node_ids } => {
                        let (ops, hits) =
                            self.record_selected_nodes(t, Some(ci), Some(node_ids), &mut budget)?;
                        (MaterialSource::Draw(Arc::new(ops)), hits)
                    }
                    CaptionLayerSource::ImageSequence { .. } => {
                        let Some(quad) =
                            self.resolve_sequence_quad(ci, t, &layer.source, &mut budget)?
                        else {
                            continue;
                        };
                        (MaterialSource::Image(quad), Vec::new())
                    }
                };
                let mut materials = Vec::new();
                let mut visible = true;
                for material in &layer.materials {
                    match self.resolve_material_command(ci, t, material, &mut budget)? {
                        Some(value) => materials.push(value),
                        None => {
                            visible = false;
                            break;
                        }
                    }
                }
                if visible {
                    result.layers.push(MaterialLayer {
                        source,
                        materials,
                        blend: match layer.blend {
                            CaptionLayerBlend::SourceOver => AssociatedBlend::SourceOver,
                            CaptionLayerBlend::Screen => AssociatedBlend::Screen,
                            CaptionLayerBlend::Add => AssociatedBlend::Add,
                        },
                    });
                    for hit in source_hits {
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
            }
        }
        Ok((result, hits))
    }
    pub(super) fn resolve_material_command(
        &mut self,
        ci: usize,
        t: f64,
        material: &CaptionMaterial,
        budget: &mut Budget,
    ) -> Result<Option<MaterialCommand>> {
        if matches!(material, CaptionMaterial::AffineSampleBlend { .. }) {
            return Ok(self
                .resolve_affine_samples(ci, t, material, budget)?
                .map(MaterialCommand::AffineSampleBlend));
        }
        let (id, node) = match material {
            CaptionMaterial::NoisySweep {
                id,
                context_node_id,
                ..
            }
            | CaptionMaterial::GaussianAxis {
                id,
                context_node_id,
                ..
            }
            | CaptionMaterial::GlowCascade {
                id,
                context_node_id,
                ..
            } => (id, context_node_id),
            _ => bail!(
                "CAPTION_MATERIAL_PLAN_UNSUPPORTED: material {}",
                material_id(material)
            ),
        };
        let Some(mut context) = self.material_page_context(ci, t, node, budget)? else {
            return Ok(None);
        };
        context.stable_key.push_str(&format!("|material|{id}"));
        let scene = self.style.scene();
        let size = filters::Size {
            width: self.width,
            height: self.height,
        };
        Ok(Some(match material {
            CaptionMaterial::NoisySweep {
                domain,
                position,
                mask_scale,
                reveal,
                uv_y,
                ..
            } => MaterialCommand::NoisySweep {
                domain: sample_domain(domain, scene, &context, t, budget)?,
                position: component_uniform(
                    position, scene, &context, t, budget, 0.0, -1024.0, 1024.0,
                )?,
                mask_scale: *mask_scale,
                reveal: *reveal,
                flip_y: *uv_y == MaterialUvY::Up,
            },
            CaptionMaterial::GaussianAxis {
                axis,
                samples,
                step_uv,
                sigma_uv,
                gamma,
                boundary,
                spacing_ramp,
                sampling,
                ..
            } => {
                let sampling = sampling.as_ref().map(|sampling| -> Result<filters::GaussianSampling> {
                    let input = sample_domain(&sampling.input, scene, &context, t, budget)?;
                    if input.iter().any(|v| *v < 0.0 || v.fract() != 0.0)
                        || input[0]+input[2] > size.width as f64 || input[1]+input[3] > size.height as f64 {
                        bail!("CAPTION_MATERIAL_INVALID: Gaussian input domain must be an integer texel view inside the input surface");
                    }
                    Ok(filters::GaussianSampling { input: input.map(|v|v as u32),
                        output: sample_domain(&sampling.output, scene, &context, t, budget)? })
                }).transpose()?;
                let dimension = sampling.map_or_else(
                    || {
                        if *axis == WaveAxis::X {
                            size.width
                        } else {
                            size.height
                        }
                    },
                    |view| view.input[if *axis == WaveAxis::X { 2 } else { 3 }],
                ) as f64;
                MaterialCommand::Gaussian(filters::GaussianPass {
                    sampling,
                    spacing_ramp: spacing_ramp
                        .as_ref()
                        .map(|ramp| -> Result<filters::SpacingRamp> {
                            let start = component_uniform(
                                &ramp.start,
                                scene,
                                &context,
                                t,
                                budget,
                                0.0,
                                -1024.0,
                                1024.0,
                            )?;
                            let end = component_uniform(
                                &ramp.end, scene, &context, t, budget, 1.0, -1024.0, 1024.0,
                            )?;
                            if end <= start {
                                bail!("CAPTION_MATERIAL_INVALID: Gaussian spacing ramp interval");
                            }
                            Ok(filters::SpacingRamp {
                                positive_first: ramp.sample_order
                                    == Some(GaussianSampleOrder::PositiveFirst),
                                domain: sample_domain(&ramp.domain, scene, &context, t, budget)?,
                                axis: if ramp.axis == WaveAxis::X {
                                    filters::Axis::X
                                } else {
                                    filters::Axis::Y
                                },
                                start,
                                end,
                                reverse: ramp.reverse,
                                previous_sample: ramp.evaluation
                                    == GaussianRampEvaluation::PreviousSample,
                            })
                        })
                        .transpose()?,
                    axis: if *axis == WaveAxis::X {
                        filters::Axis::X
                    } else {
                        filters::Axis::Y
                    },
                    sample_count: component_uniform(
                        samples, scene, &context, t, budget, 0.0, 0.0, 1024.0,
                    )?,
                    step_pixels: component_uniform(
                        step_uv, scene, &context, t, budget, 0.0, 0.0, 1.0,
                    )? * dimension,
                    sigma_pixels: component_uniform(
                        sigma_uv, scene, &context, t, budget, 0.0, 0.0, 1024.0,
                    )? * dimension,
                    gamma: (*gamma != 1.0).then_some(*gamma),
                    boundary: match boundary {
                        ComponentBoundary::Normalize => filters::Boundary::Normalize,
                        ComponentBoundary::Replicate => filters::Boundary::Replicate,
                        ComponentBoundary::Transparent => filters::Boundary::Transparent,
                    },
                    output: size,
                })
            }
            CaptionMaterial::GlowCascade {
                levels,
                gamma,
                intensity,
                original_opacity,
                glow_tint,
                glow_color_matrix,
                gamma_channels,
                aggregation,
                level_gains,
                level_color,
                composite,
                ..
            } => {
                let mut converted = Vec::new();
                let mut input_size = size;
                for level in levels {
                    let x = component_stage(
                        &level.horizontal,
                        filters::Axis::X,
                        input_size,
                        size,
                        *gamma,
                        scene,
                        &context,
                        t,
                        budget,
                    )?;
                    let y = component_stage(
                        &level.vertical,
                        filters::Axis::Y,
                        x.output,
                        size,
                        *gamma,
                        scene,
                        &context,
                        t,
                        budget,
                    )?;
                    input_size = y.output;
                    converted.push(filters::GlowLevel { x, y });
                }
                MaterialCommand::Glow(filters::GlowConfig {
                    levels: converted,
                    gamma: *gamma,
                    intensity: component_uniform(
                        intensity, scene, &context, t, budget, 0.0, 0.0, 16.0,
                    )?,
                    original_opacity: component_uniform(
                        original_opacity,
                        scene,
                        &context,
                        t,
                        budget,
                        1.0,
                        0.0,
                        1.0,
                    )?,
                    glow_tint: component_glow_tint(glow_tint.as_ref(), scene, &context, t, budget)?,
                    glow_color_matrix: glow_color_matrix.unwrap_or(filters::IDENTITY_GLOW_MATRIX),
                    gamma_alpha: *gamma_channels == Some(GammaChannels::Rgba),
                    linear: if *aggregation == Some(GlowAggregation::Linear) {
                        Some(filters::LinearGlow {
                            gains: level_gains.clone().unwrap_or_else(|| vec![1.0; levels.len()]),
                            color: component_level_color(level_color.as_ref(), scene, &context, t, budget)?,
                        })
                    } else {
                        None
                    },
                    composite: match composite {
                        GlowComposite::Screen => filters::GlowComposite::Screen,
                        GlowComposite::SourceOverGlow => filters::GlowComposite::SourceOverGlow,
                        GlowComposite::OriginalOverScreen => filters::GlowComposite::OriginalOverScreen,
                    },
                    output: size,
                })
            }
            _ => unreachable!(),
        }))
    }
    pub(super) fn resolve_sequence_quad(
        &mut self,
        ci: usize,
        t: f64,
        source: &CaptionLayerSource,
        budget: &mut Budget,
    ) -> Result<Option<ImageQuad>> {
        let CaptionLayerSource::ImageSequence {
            context_node_id,
            sequence_id,
            frame,
            domain,
            uv_scale,
            uv_offset,
        } = source
        else {
            bail!("CAPTION_SCENE_INVALID: sequence source");
        };
        let Some(context) = self.material_page_context(ci, t, context_node_id, budget)? else {
            return Ok(None);
        };
        let count = self
            .style
            .scene()
            .sequences
            .iter()
            .find(|s| &s.id == sequence_id)
            .unwrap()
            .frames
            .len();
        let index = component_uniform(
            frame,
            self.style.scene(),
            &context,
            t,
            budget,
            0.0,
            0.0,
            (count - 1) as f64,
        )?;
        let domain = sample_domain(domain, self.style.scene(), &context, t, budget)?;
        let bitmap = self
            .sequences
            .frame(sequence_id, libm::floor(index) as usize)?;
        Ok(Some(ImageQuad {
            bitmap,
            domain,
            uv_scale: *uv_scale,
            uv_offset: *uv_offset,
        }))
    }
}

fn material_id(material: &CaptionMaterial) -> &str {
    match material {
        CaptionMaterial::NoisySweep { id, .. }
        | CaptionMaterial::GradientSmear { id, .. }
        | CaptionMaterial::Blur { id, .. }
        | CaptionMaterial::WaveDisplace { id, .. }
        | CaptionMaterial::SoftBand { id, .. }
        | CaptionMaterial::NoisePaletteMix { id, .. }
        | CaptionMaterial::NoiseDisplace { id, .. }
        | CaptionMaterial::AngularSampleBlend { id, .. }
        | CaptionMaterial::AffineSampleBlend { id, .. }
        | CaptionMaterial::AffineOver { id, .. }
        | CaptionMaterial::GaussianAxis { id, .. }
        | CaptionMaterial::GaussianUv { id, .. }
        | CaptionMaterial::GlowCascade { id, .. }
        | CaptionMaterial::Feedback { id, .. } => id,
    }
}
