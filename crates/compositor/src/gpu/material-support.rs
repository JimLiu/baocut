//! Conservative nonzero-component bounds for GPU material surfaces.
//!
//! `None` means proven empty, never unknown. Unknown sources use the full backing
//! surface. Bounds include all four components, including RGB at zero alpha.
use std::sync::{Arc, Weak};

use anyhow::{Result, ensure};
use render_raster::{
    drawop::BitmapData,
    effects::{
        component_filters::{Axis, Boundary, GaussianPass, Size, Support},
        material_plan::MaterialSource,
    },
};
use timeline_render::scene::{GlyphMask, SCENE_GLYPH_STROKE_WIDTH_LIMIT, SceneFrame, SceneNode, post_concat_mat6};

pub(super) fn full_support(size: Size) -> Option<Support> {
    (size.width > 0 && size.height > 0).then_some(Support {
        left: 0,
        top: 0,
        right: size.width,
        bottom: size.height,
    })
}

pub(super) fn validate_support(size: Size, support: Option<Support>) -> Result<()> {
    ensure!(size.width > 0 && size.height > 0, "gpu-component-support-size");
    if let Some(s) = support {
        ensure!(
            s.left < s.right && s.top < s.bottom && s.right <= size.width && s.bottom <= size.height,
            "gpu-component-support-bounds"
        );
    }
    Ok(())
}

fn union(a: Option<Support>, b: Option<Support>) -> Option<Support> {
    match (a, b) {
        (Some(a), Some(b)) => Some(Support {
            left: a.left.min(b.left),
            top: a.top.min(b.top),
            right: a.right.max(b.right),
            bottom: a.bottom.max(b.bottom),
        }),
        (a, b) => a.or(b),
    }
}

/// Outward bounds; pad covers interpolation, rasterization and f32 arithmetic.
fn rectangle(size: Size, bounds: [f64; 4], pad: f64) -> Option<Support> {
    if !bounds.iter().all(|v| v.is_finite()) || !pad.is_finite() {
        return full_support(size);
    }
    let s = Support {
        left: (bounds[0] - pad).floor().clamp(0.0, size.width as f64) as u32,
        top: (bounds[1] - pad).floor().clamp(0.0, size.height as f64) as u32,
        right: (bounds[2] + pad).ceil().clamp(0.0, size.width as f64) as u32,
        bottom: (bounds[3] + pad).ceil().clamp(0.0, size.height as f64) as u32,
    };
    (s.left < s.right && s.top < s.bottom).then_some(s)
}

pub(super) fn domain_support(size: Size, domain: [f64; 4]) -> Option<Support> {
    // Render uniforms contain rounded f32 domains, including their sums.
    let [x, y, w, h] = domain.map(|v| (v as f32) as f64);
    let magnitude = domain.iter().fold(1.0_f64, |n, v| n.max(v.abs()));
    rectangle(size, [x, y, x + w, y + h], 2.0 + magnitude * 32.0 * f32::EPSILON as f64)
}

#[derive(Default)]
pub(super) struct MaterialSupportCache {
    bitmaps: Vec<(Weak<BitmapData>, Option<Support>)>,
    glyphs: Vec<(Weak<GlyphMask>, Option<[u32; 4]>)>,
}
impl MaterialSupportCache {
    fn glyph_bounds(&mut self, mask: &Arc<GlyphMask>) -> Option<Option<[u32; 4]>> {
        let channels = if mask.pixels.is_color() { 4 } else { 1 };
        if mask.width == 0
            || mask.height == 0
            || mask.pixels.data().len() as u64 != u64::from(mask.width) * u64::from(mask.height) * channels as u64
        {
            return None;
        }
        self.glyphs.retain(|(key, _)| key.strong_count() != 0);
        if let Some((_, bounds)) = self.glyphs.iter().find(|(key, _)| key.ptr_eq(&Arc::downgrade(mask))) {
            return Some(*bounds);
        }
        let mut bounds: Option<[u32; 4]> = None;
        for (index, pixel) in mask.pixels.data().chunks_exact(channels).enumerate() {
            if pixel.iter().any(|component| *component != 0) {
                let x = index as u32 % mask.width;
                let y = index as u32 / mask.width;
                bounds = Some(match bounds {
                    Some([left, top, right, bottom]) => [left.min(x), top.min(y), right.max(x + 1), bottom.max(y + 1)],
                    None => [x, y, x + 1, y + 1],
                });
            }
        }
        if self.glyphs.len() == 128 {
            self.glyphs.remove(0);
        }
        self.glyphs.push((Arc::downgrade(mask), bounds));
        Some(bounds)
    }

    fn bitmap_support(&mut self, bitmap: &Arc<BitmapData>) -> Option<Support> {
        self.bitmaps.retain(|(key, _)| key.strong_count() > 0);
        if let Some((_, bounds)) = self.bitmaps.iter().find(|(key, _)| key.ptr_eq(&Arc::downgrade(bitmap))) {
            return *bounds;
        }
        let size = Size {
            width: bitmap.width,
            height: bitmap.height,
        };
        if bitmap.width == 0 || bitmap.height == 0 || bitmap.rgba.len() as u64 != u64::from(bitmap.width) * u64::from(bitmap.height) * 4 {
            return full_support(size);
        }
        let mut bounds = None;
        for (index, rgba) in bitmap.rgba.chunks_exact(4).enumerate() {
            if rgba.iter().any(|v| *v != 0) {
                let x = index as u32 % bitmap.width;
                let y = index as u32 / bitmap.width;
                bounds = union(
                    bounds,
                    Some(Support {
                        left: x,
                        top: y,
                        right: x + 1,
                        bottom: y + 1,
                    }),
                );
            }
        }
        // Metadata retains only weak references and has a fixed entry limit.
        if self.bitmaps.len() == 128 {
            self.bitmaps.remove(0);
        }
        self.bitmaps.push((Arc::downgrade(bitmap), bounds));
        bounds
    }

    pub(super) fn source_support(&mut self, source: &MaterialSource, prepared: Option<&SceneFrame>, size: Size) -> Option<Support> {
        match source {
            MaterialSource::Image(image) => {
                let full_domain = [0.0, 0.0, size.width as f64, size.height as f64];
                if image.domain != full_domain || image.uv_scale != [1.0, 1.0] || image.uv_offset != [0.0, 0.0] {
                    return domain_support(size, image.domain);
                }
                let s = self.bitmap_support(&image.bitmap)?;
                let sx = size.width as f64 / image.bitmap.width as f64;
                let sy = size.height as f64 / image.bitmap.height as f64;
                // One source texel on both sides covers linear texture sampling.
                rectangle(
                    size,
                    [
                        (s.left as f64 - 1.0) * sx,
                        (s.top as f64 - 1.0) * sy,
                        (s.right as f64 + 1.0) * sx,
                        (s.bottom as f64 + 1.0) * sy,
                    ],
                    2.0 + size.width.max(size.height) as f64 * 32.0 * f32::EPSILON as f64,
                )
            }
            MaterialSource::Draw(_) => prepared
                .map(|scene| scene_support_with(scene, size, |mask| self.glyph_bounds(mask)))
                .unwrap_or_else(|| full_support(size)),
        }
    }
}

pub(super) fn scene_support(scene: &SceneFrame, size: Size) -> Option<Support> {
    scene_support_with(scene, size, |_| None)
}

fn scene_support_with(
    scene: &SceneFrame,
    size: Size,
    mut signal: impl FnMut(&Arc<GlyphMask>) -> Option<Option<[u32; 4]>>,
) -> Option<Support> {
    let mut support = None;
    for node in &scene.nodes {
        let bounds = match node {
            SceneNode::Glyphs(run) if run.motion.is_none() => {
                let mut bounds = None;
                for glyph in run.glyphs.iter() {
                    let Some(uniform) = run.uniforms.get(glyph.uniform_index as usize) else {
                        return full_support(size);
                    };
                    // Color glyphs consume color_opacity rather than color.a.
                    // Paint gradients/textures can also differ from color, so no
                    // zero-color shortcut is used for retained geometry.
                    let spread = if glyph.mask.pixels.is_color() {
                        0.0
                    } else {
                        SCENE_GLYPH_STROKE_WIDTH_LIMIT * 0.5
                    };
                    let [x0, y0, x1, y1] = match signal(&glyph.mask) {
                        Some(Some(bounds)) => bounds,
                        Some(None) => continue,
                        None => [0, 0, glyph.mask.width, glyph.mask.height],
                    };
                    // One texel covers bilinear reach. The existing shader stroke
                    // allowance and canvas error margin also cover area sampling.
                    let left = glyph.mask.left as f32 + x0 as f32 - spread - 1.0;
                    let top = -(glyph.mask.top as f32) + y0 as f32 - spread - 1.0;
                    let right = glyph.mask.left as f32 + x1 as f32 + spread + 1.0;
                    let bottom = -(glyph.mask.top as f32) + y1 as f32 + spread + 1.0;
                    let tf = post_concat_mat6(uniform.transform, run.pose.transform);
                    let clip_x = [
                        2.0 * tf[0] / size.width as f32,
                        2.0 * tf[2] / size.width as f32,
                        2.0 * tf[4] / size.width as f32 - 1.0,
                    ];
                    let clip_y = [
                        -2.0 * tf[1] / size.height as f32,
                        -2.0 * tf[3] / size.height as f32,
                        1.0 - 2.0 * tf[5] / size.height as f32,
                    ];
                    let positions = [[left, top], [right, top], [right, bottom], [left, bottom]].map(|[x, y]| {
                        [
                            glyph.transform[0] * x + glyph.transform[2] * y + glyph.transform[4],
                            glyph.transform[1] * x + glyph.transform[3] * y + glyph.transform[5],
                        ]
                    });
                    let mut points = [[0.0; 2]; 4];
                    let mut error = 2.0_f64;
                    for (point, [x, y]) in points.iter_mut().zip(positions) {
                        let x_terms = [clip_x[0] as f64 * x as f64, clip_x[1] as f64 * y as f64, clip_x[2] as f64];
                        let y_terms = [clip_y[0] as f64 * x as f64, clip_y[1] as f64 * y as f64, clip_y[2] as f64];
                        *point = [
                            (x_terms.iter().sum::<f64>() + 1.0) * size.width as f64 * 0.5,
                            (1.0 - y_terms.iter().sum::<f64>()) * size.height as f64 * 0.5,
                        ];
                        let magnitude = x_terms.into_iter().chain(y_terms).map(f64::abs).sum::<f64>() + 1.0;
                        error = error.max(2.0 + magnitude * size.width.max(size.height) as f64 * 32.0 * f32::EPSILON as f64);
                    }
                    bounds = union(bounds, points_support(size, points, error));
                }
                bounds
            }
            SceneNode::RoundedRect(node) if node.motion.is_none() => {
                let [x, y, w, h] = node.rect;
                let points = [
                    [x - 1.5, y - 1.5],
                    [x + w + 1.5, y - 1.5],
                    [x + w + 1.5, y + h + 1.5],
                    [x - 1.5, y + h + 1.5],
                ];
                let tf = node.pose.transform.map(f64::from);
                let mut error = 2.0_f64;
                let points = points.map(|[x, y]| {
                    let x = x as f64;
                    let y = y as f64;
                    let magnitude = (tf[0] * x).abs()
                        + (tf[2] * y).abs()
                        + tf[4].abs()
                        + (tf[1] * x).abs()
                        + (tf[3] * y).abs()
                        + tf[5].abs()
                        + size.width.max(size.height) as f64;
                    error = error.max(2.0 + magnitude * 32.0 * f32::EPSILON as f64);
                    [tf[0] * x + tf[2] * y + tf[4], tf[1] * x + tf[3] * y + tf[5]]
                });
                points_support(size, points, error)
            }
            _ => return full_support(size),
        };
        support = union(support, bounds);
    }
    support
}

fn points_support(size: Size, points: [[f64; 2]; 4], error: f64) -> Option<Support> {
    let mut bounds = [f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY];
    for [x, y] in points {
        if !x.is_finite() || !y.is_finite() {
            return full_support(size);
        }
        bounds[0] = bounds[0].min(x);
        bounds[1] = bounds[1].min(y);
        bounds[2] = bounds[2].max(x);
        bounds[3] = bounds[3].max(y);
    }
    rectangle(size, bounds, error)
}

/// Bound every pixel that can sample any nonzero input component. Kernel and
/// gamma remain unchanged; rounding can only enlarge these bounds.
pub(super) fn gaussian_support(input: Size, support: Option<Support>, pass: GaussianPass) -> Result<Option<Support>> {
    validate_support(input, support)?;
    let count = pass.validate()?;
    let (id, od) = pass.sampling_domains(input)?;
    let Some(s) = support else {
        return Ok(None);
    };
    let lo = [s.left as f64, s.top as f64];
    let hi = [s.right as f64, s.bottom as f64];
    if (0..2).any(|i| hi[i] <= id[i] || lo[i] >= id[i] + id[i + 2]) {
        return Ok(None);
    }
    if pass.spacing_ramp.is_some() {
        return Ok(domain_support(pass.output, od));
    }
    let radius = count as f64 * pass.step_pixels;
    if !radius.is_finite() {
        return Ok(domain_support(pass.output, od));
    }
    let mut bounds = [0.0; 4];
    for i in 0..2 {
        let radius = if (i == 0) == (pass.axis == Axis::X) { radius } else { 0.0 };
        let mut low = lo[i].max(id[i]) - 1.0 - radius;
        let mut high = hi[i].min(id[i] + id[i + 2]) + 1.0 + radius;
        // Replicate can carry an ROI edge texel arbitrarily far. The unfiltered
        // center sample clamps too, so include edges conservatively for all modes.
        if lo[i] <= id[i] {
            low = id[i] - 0.5;
        }
        if hi[i] >= id[i] + id[i + 2] {
            high = id[i] + id[i + 2] - 0.5;
        }
        if pass.boundary == Boundary::Replicate {
            if lo[i] <= id[i] {
                low = f64::NEG_INFINITY;
            }
            if hi[i] >= id[i] + id[i + 2] {
                high = f64::INFINITY;
            }
        }
        bounds[i] = (od[i] + (low + 0.5 - id[i]) / id[i + 2] * od[i + 2]).max(od[i]);
        bounds[i + 2] = (od[i] + (high + 0.5 - id[i]) / id[i + 2] * od[i + 2]).min(od[i] + od[i + 2]);
    }
    // Account for separate f32 multiply/divide/add operations in the shader,
    // including very large kernels mapped into small fractional output quads.
    let magnitude = id.into_iter().chain(od).map(f64::abs).sum::<f64>() + radius + 1.0;
    let scale = (od[2] / id[2]).max(od[3] / id[3]).max(1.0);
    Ok(rectangle(pass.output, bounds, 2.0 + magnitude * scale * 64.0 * f32::EPSILON as f64))
}

pub(super) fn gaussian_texel_reads(input: Size, support: Option<Support>, pass: GaussianPass) -> Result<u64> {
    let count = pass.validate()?;
    let Some(source) = support else {
        return Ok(0);
    };
    let Some(active) = gaussian_support(input, support, pass)? else {
        return Ok(0);
    };
    let raw = u64::from(active.right - active.left)
        .saturating_mul(u64::from(active.bottom - active.top))
        .saturating_mul(2 * count as u64 + 1)
        .saturating_mul(4);
    if pass.spacing_ramp.is_some() {
        return Ok(raw);
    }
    let (id, od) = pass.sampling_domains(input)?;
    let id = id.map(|v| f64::from(v as f32));
    let od = od.map(|v| f64::from(v as f32));
    let step = f64::from(pass.step_pixels as f32);
    if !id.into_iter().chain(od).chain([step]).all(f64::is_finite) || od[2] <= 0.0 || od[3] <= 0.0 {
        return Ok(raw);
    }
    let ranges = [[active.left, active.right], [active.top, active.bottom]];
    let bounds = [[source.left, source.right], [source.top, source.bottom]];
    let axis = usize::from(pass.axis == Axis::Y);
    let other = 1 - axis;
    let replicated = pass.boundary == Boundary::Replicate;
    let sum = |dimension: usize, distance: f64, valid: bool| -> u64 {
        axis_reads(
            ranges[dimension],
            bounds[dimension],
            [id[dimension], id[dimension + 2]],
            [od[dimension], od[dimension + 2]],
            input,
            pass,
            dimension,
            distance,
            valid,
        )
    };
    let center = sum(axis, 0.0, false).saturating_mul(sum(other, 0.0, false));
    let other_taps = if replicated {
        sum(other, 0.0, false)
    } else {
        sum(other, 0.0, true)
    };
    let mut along_taps = 0_u64;
    for index in 1..=count {
        let distance = index as f64 * step;
        along_taps = along_taps
            .saturating_add(sum(axis, -distance, !replicated))
            .saturating_add(sum(axis, distance, !replicated));
    }
    let uncached = center.saturating_add(along_taps.saturating_mul(other_taps)).min(raw);
    let cached = cached_axis_reads(
        ranges[axis],
        bounds[axis],
        [id[axis], id[axis + 2]],
        [od[axis], od[axis + 2]],
        input,
        pass,
        axis,
        count as f64 * step,
    )
    .saturating_mul(sum(other, 0.0, false));
    Ok(uncached.min(cached))
}

#[allow(clippy::too_many_arguments)]
fn cached_axis_reads(
    range: [u32; 2],
    support: [u32; 2],
    input_domain: [f64; 2],
    output_domain: [f64; 2],
    input: Size,
    pass: GaussianPass,
    dimension: usize,
    radius: f64,
) -> u64 {
    let [origin, extent] = input_domain;
    let upper = origin + extent - 1.0;
    let raw_axis = u64::from(range[1] - range[0])
        .saturating_mul(2 * pass.validate().unwrap_or(1024) as u64 + 1)
        .saturating_mul(2);
    let mut total = 0_u64;
    for pixel in range[0]..range[1] {
        let coordinate = pixel as f64 + 0.5;
        let local = if pass.sampling.is_some() {
            (coordinate - output_domain[0]) / output_domain[1] * extent
        } else {
            coordinate
                * if dimension == 0 {
                    input.width as f64 / pass.output.width as f64
                } else {
                    input.height as f64 / pass.output.height as f64
                }
        };
        let center = if pass.sampling.is_some() {
            local + origin - 0.5
        } else {
            local - 0.5
        };
        let error = f32::EPSILON as f64 * (6.0 * local.abs() + 4.0 * center.abs() + 4.0 * radius.abs() + 4.0);
        if !center.is_finite() || !error.is_finite() || center.abs() + radius.abs() + error > f32::MAX as f64 {
            return raw_axis;
        }
        let low = (center - radius - error).clamp(origin, upper).floor().max(support[0] as f64);
        let high = ((center + radius + error).clamp(origin, upper).floor() + 1.0)
            .min(upper)
            .min(support[1] as f64 - 1.0);
        // Fixed-spacing negative/positive streams move monotonically from the
        // central cell. Adjacent cells reuse their shared corner, repeated cells
        // reuse every corner, and the two streams share the initial center data.
        total = total.saturating_add((high - low + 1.0).max(0.0) as u64);
    }
    total
}

#[allow(clippy::too_many_arguments)]
fn axis_reads(
    range: [u32; 2],
    support: [u32; 2],
    input_domain: [f64; 2],
    output_domain: [f64; 2],
    input: Size,
    pass: GaussianPass,
    dimension: usize,
    distance: f64,
    valid: bool,
) -> u64 {
    let [origin, extent] = input_domain;
    let upper = origin + extent - 1.0;
    // Clamping cannot leave this fully supported ROI. Count both shader loads
    // even when lo==hi: the shader's four-corner expressions remain unchanged.
    if !valid && support[0] as f64 <= origin && support[1] as f64 > upper {
        return u64::from(range[1] - range[0]) * 2;
    }
    let mut total = 0_u64;
    for pixel in range[0]..range[1] {
        let coordinate = pixel as f64 + 0.5;
        let local = if pass.sampling.is_some() {
            (coordinate - output_domain[0]) / output_domain[1] * extent
        } else {
            coordinate
                * if dimension == 0 {
                    input.width as f64 / pass.output.width as f64
                } else {
                    input.height as f64 / pass.output.height as f64
                }
        };
        let center = if pass.sampling.is_some() {
            local + origin - 0.5
        } else {
            local - 0.5
        };
        let point = center + distance;
        // Cover independent f32 subtraction/division/multiplication/addition,
        // the tap multiplication and permitted FMA reassociation. Params above
        // are the exact uploaded f32 values, not the unrounded CPU domains.
        let error = f32::EPSILON as f64 * (6.0 * local.abs() + 4.0 * center.abs() + 4.0 * distance.abs() + 4.0);
        if !point.is_finite() || !error.is_finite() || local.abs().max(point.abs()) > f32::MAX as f64 {
            return u64::from(range[1] - range[0]) * 2;
        }
        let low = point - error;
        let high = point + error;
        if valid && (high < origin - 0.5 || low > origin + extent - 0.5) {
            continue;
        }
        let lo_min = low.clamp(origin, upper).floor();
        let lo_max = high.clamp(origin, upper).floor();
        let intersects = |left: f64, right: f64| left < support[1] as f64 && right >= support[0] as f64;
        total += u64::from(intersects(lo_min, lo_max));
        total += u64::from(intersects((lo_min + 1.0).min(upper), (lo_max + 1.0).min(upper)));
    }
    total
}

#[cfg(test)]
#[path = "read-budget-tests.rs"]
mod read_budget_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use render_raster::effects::{
        component_filters::{ComponentImage, GaussianSampling, SpacingRamp, gaussian},
        material_plan::ImageQuad,
    };
    use timeline_render::scene::{GlyphInstance, GlyphKey, GlyphMask, GlyphPaint, GlyphRun, GlyphRunUniform, ScenePose};

    fn pass(axis: Axis, boundary: Boundary, output: Size) -> GaussianPass {
        GaussianPass {
            axis,
            boundary,
            output,
            sample_count: 3.0,
            step_pixels: 1.25,
            sigma_pixels: 2.0,
            gamma: Some(2.2),
            spacing_ramp: None,
            sampling: None,
        }
    }
    fn contains(s: Option<Support>, x: u32, y: u32) -> bool {
        s.is_some_and(|s| x >= s.left && x < s.right && y >= s.top && y < s.bottom)
    }

    #[test]
    fn source_bitmap_bounds_preserve_zero_alpha_rgb_and_cache_only_metadata() {
        let size = Size { width: 80, height: 60 };
        let mut rgba = vec![0; 20 * 15 * 4];
        rgba[(7 * 20 + 9) * 4] = 255;
        let bitmap = Arc::new(BitmapData {
            width: 20,
            height: 15,
            rgba: rgba.into(),
        });
        let source = MaterialSource::Image(ImageQuad {
            bitmap: bitmap.clone(),
            domain: [0.0, 0.0, 80.0, 60.0],
            uv_scale: [1.0; 2],
            uv_offset: [0.0; 2],
        });
        let mut cache = MaterialSupportCache::default();
        let s = cache.source_support(&source, None, size).unwrap();
        assert!(s.left <= 32 && s.right >= 44 && s.top <= 24 && s.bottom >= 36);
        assert!(s.right - s.left < size.width / 2);
        assert_eq!(cache.source_support(&source, None, size), Some(s));
        assert_eq!(cache.bitmaps.len(), 1);
        assert_eq!(Arc::strong_count(&bitmap), 2);
        let empty = MaterialSource::Image(ImageQuad {
            bitmap: Arc::new(BitmapData {
                width: 1,
                height: 1,
                rgba: vec![0; 4].into(),
            }),
            domain: [0.0, 0.0, 80.0, 60.0],
            uv_scale: [1.0; 2],
            uv_offset: [0.0; 2],
        });
        assert_eq!(cache.source_support(&empty, None, size), None);
    }

    #[test]
    fn retained_glyph_bounds_include_mask_placement_run_pose_and_color_glyph_opacity() {
        let mask = Arc::new(GlyphMask::new_color(GlyphKey([1, 2]), 4, 6, -2, 5, vec![255; 4 * 6 * 4]).unwrap());
        let run = GlyphRun {
            glyphs: vec![GlyphInstance {
                mask,
                transform: [2.0, 0.0, 0.0, 2.0, 20.0, 30.0],
                uniform_index: 0,
            }]
            .into(),
            uniforms: vec![GlyphRunUniform {
                transform: [1.0, 0.0, 0.0, 1.0, 7.0, 9.0],
                color: [0.0; 4],
                color_opacity: 1.0,
                clip: None,
                paint: GlyphPaint::Solid,
            }],
            pose: ScenePose {
                transform: [1.0, 0.0, 0.0, 1.0, 11.0, 13.0],
                ..ScenePose::IDENTITY
            },
            ..Default::default()
        };
        let size = Size { width: 100, height: 100 };
        let scene = SceneFrame {
            nodes: vec![SceneNode::Glyphs(Arc::new(run))],
            ..Default::default()
        };
        let s = scene_support(&scene, size).unwrap();
        assert!(s.left <= 34 && s.right >= 42 && s.top <= 42 && s.bottom >= 54);
        assert!(s.right - s.left < 25 && s.bottom - s.top < 25);
        assert_eq!(scene_support(&SceneFrame::default(), size), None);
    }

    #[test]
    fn glyph_signal_bounds_preserve_emission_empty_masks_and_bounded_weak_cache() {
        let mut cache = MaterialSupportCache::default();
        let mut alpha = vec![0; 40 * 50];
        alpha[17 * 40 + 12] = 1;
        alpha[22 * 40 + 21] = 255;
        let mask = Arc::new(GlyphMask::new(GlyphKey([8, 0]), 40, 50, 0, 0, alpha).unwrap());
        assert_eq!(cache.glyph_bounds(&mask), Some(Some([12, 17, 22, 23])));
        assert_eq!(cache.glyph_bounds(&mask), Some(Some([12, 17, 22, 23])));
        assert_eq!(Arc::strong_count(&mask), 1);
        assert_eq!(cache.glyphs.len(), 1);
        let mut rgba = vec![0; 40 * 50 * 4];
        rgba[(17 * 40 + 12) * 4] = 211;
        let color = Arc::new(GlyphMask::new_color(GlyphKey([9, 0]), 40, 50, 0, 0, rgba).unwrap());
        assert_eq!(cache.glyph_bounds(&color), Some(Some([12, 17, 13, 18])));
        let empty = Arc::new(GlyphMask::new(GlyphKey([10, 0]), 40, 50, 0, 0, vec![0; 40 * 50]).unwrap());
        assert_eq!(cache.glyph_bounds(&empty), Some(None));
        let mut live = Vec::new();
        for index in 0..200 {
            let glyph = Arc::new(GlyphMask::new(GlyphKey([index, 3]), 1, 1, 0, 0, vec![255]).unwrap());
            assert_eq!(cache.glyph_bounds(&glyph), Some(Some([0, 0, 1, 1])));
            live.push(glyph);
        }
        assert_eq!(cache.glyphs.len(), 128);
        assert!(live.iter().all(|glyph| Arc::strong_count(glyph) == 1));
    }

    #[test]
    fn support_metadata_rejects_empty_reversed_and_outside_boxes() {
        let size = Size { width: 8, height: 6 };
        for s in [
            Support {
                left: 2,
                top: 1,
                right: 2,
                bottom: 3,
            },
            Support {
                left: 3,
                top: 1,
                right: 2,
                bottom: 3,
            },
            Support {
                left: 0,
                top: 0,
                right: 9,
                bottom: 6,
            },
        ] {
            assert!(validate_support(size, Some(s)).is_err());
        }
        assert!(validate_support(size, None).is_ok());
    }

    #[test]
    fn gaussian_bounds_cover_reference_rgba_tails_rois_resize_and_edges() {
        let input = Size { width: 13, height: 11 };
        for (x, y) in [(0, 0), (4, 3), (6, 5), (9, 8), (12, 10)] {
            let mut data = vec![0; input.width as usize * input.height as usize * 4];
            data[(y * input.width + x) as usize * 4] = 255; // RGB with zero alpha.
            let image = ComponentImage::new(input.width, input.height, data).unwrap();
            let source = Some(Support {
                left: x,
                top: y,
                right: x + 1,
                bottom: y + 1,
            });
            for axis in [Axis::X, Axis::Y] {
                for boundary in [Boundary::Normalize, Boundary::Transparent, Boundary::Replicate] {
                    for resized in [false, true] {
                        for subview in [false, true] {
                            let output = if resized { Size { width: 21, height: 7 } } else { input };
                            let mut p = pass(axis, boundary, output);
                            if subview {
                                p.sampling = Some(GaussianSampling {
                                    input: [4, 3, 6, 6],
                                    output: [-0.3, 0.6, 17.1, 5.8],
                                });
                            }
                            let s = gaussian_support(input, source, p).unwrap();
                            let result = gaussian(&image, p).unwrap();
                            for (index, rgba) in result.data().chunks_exact(4).enumerate() {
                                if rgba.iter().any(|v| *v != 0) {
                                    assert!(
                                        contains(s, index as u32 % output.width, index as u32 / output.width),
                                        "missed output {index} from source {x},{y}, {p:?}: {s:?}"
                                    );
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn sparse_portrait_kernel_fits_unchanged_sampling_budget() {
        let size = Size { width: 720, height: 1280 };
        let p = GaussianPass {
            sample_count: 40.0,
            step_pixels: 1.0,
            sigma_pixels: 20.0,
            ..pass(Axis::X, Boundary::Normalize, size)
        };
        let old_full_reads = u64::from(size.width) * u64::from(size.height) * 81 * 4;
        assert!(old_full_reads > 256 * 1024 * 1024);
        let full_reads = gaussian_texel_reads(size, full_support(size), p).unwrap();
        assert!(full_reads < 256 * 1024 * 1024, "cached monotonic taps should reuse source cells");
        let source = Some(Support {
            left: 150,
            top: 550,
            right: 570,
            bottom: 700,
        });
        let horizontal = gaussian_support(size, source, p).unwrap();
        let vertical_pass = GaussianPass { axis: Axis::Y, ..p };
        assert!(gaussian_texel_reads(size, source, p).unwrap() < 256 * 1024 * 1024);
        assert!(gaussian_texel_reads(size, source, p).unwrap() < full_reads);
        assert!(gaussian_texel_reads(size, horizontal, vertical_pass).unwrap() < 256 * 1024 * 1024);
        assert_eq!(gaussian_texel_reads(size, None, p).unwrap(), 0);
        let ramp = GaussianPass {
            spacing_ramp: Some(SpacingRamp {
                domain: [0.0, 0.0, 720.0, 1280.0],
                axis: Axis::Y,
                start: 0.0,
                end: 1.0,
                reverse: false,
                previous_sample: true,
                positive_first: true,
            }),
            ..p
        };
        assert_eq!(gaussian_support(size, source, ramp).unwrap(), full_support(size));
    }
}
