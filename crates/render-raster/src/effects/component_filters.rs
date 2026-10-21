//! Bounded filters over independent associated color and coverage components.
//!
//! These surfaces may contain RGB greater than alpha, including nonzero RGB at
//! zero alpha. Filtering, interpolation and UNORM writes never impose the usual
//! premultiplied-color inequality. Texture coordinates address pixel centers.

use anyhow::{Result, ensure};

#[path = "affine-samples.rs"]
pub mod affine_samples;

#[path = "affine_over.rs"]
pub mod affine_over;
#[path = "gaussian_uv.rs"]
pub mod gaussian_uv;

const MAX_PIXELS: u64 = 64 * 1024 * 1024;
const MAX_GAUSSIAN_SAMPLES: usize = 1024;
const MAX_GLOW_LEVELS: usize = 8;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Size {
    pub width: u32,
    pub height: u32,
}
impl Size {
    fn pixels(self) -> Result<u64> {
        let pixels = u64::from(self.width) * u64::from(self.height);
        ensure!(
            self.width > 0 && self.height > 0 && pixels <= MAX_PIXELS,
            "CAPTION_MATERIAL_INVALID: component image size"
        );
        Ok(pixels)
    }
    fn bytes(self) -> Result<usize> {
        usize::try_from(
            self.pixels()?
                .checked_mul(4)
                .ok_or_else(|| anyhow::anyhow!("CAPTION_BUDGET_EXCEEDED: image bytes"))?,
        )
        .map_err(|_| anyhow::anyhow!("CAPTION_BUDGET_EXCEEDED: image bytes"))
    }
}

/// Inclusive lower and exclusive upper bounds of nonzero component pixels.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Support {
    pub left: u32,
    pub top: u32,
    pub right: u32,
    pub bottom: u32,
}
impl Support {
    fn union(self, other: Self) -> Self {
        Self {
            left: self.left.min(other.left),
            top: self.top.min(other.top),
            right: self.right.max(other.right),
            bottom: self.bottom.max(other.bottom),
        }
    }
    fn include(&mut self, x: u32, y: u32) {
        self.left = self.left.min(x);
        self.top = self.top.min(y);
        self.right = self.right.max(x + 1);
        self.bottom = self.bottom.max(y + 1);
    }
}

#[derive(Clone, Debug)]
pub struct ComponentImage {
    size: Size,
    data: Vec<u8>,
    support: Option<Support>,
    // Only imported buffers require a scan. Generated buffers track support
    // while writing and do not charge another full-frame scan at each pass.
    support_scan_pixels: u64,
}
impl ComponentImage {
    pub fn new(width: u32, height: u32, data: Vec<u8>) -> Result<Self> {
        let size = Size { width, height };
        ensure!(
            data.len() == size.bytes()?,
            "CAPTION_MATERIAL_INVALID: component image length"
        );
        let mut support = None;
        for (index, rgba) in data.chunks_exact(4).enumerate() {
            if rgba.iter().any(|channel| *channel != 0) {
                include(&mut support, index as u32 % width, index as u32 / width);
            }
        }
        Ok(Self {
            size,
            data,
            support,
            support_scan_pixels: size.pixels()?,
        })
    }
    pub fn zeroed(size: Size) -> Result<Self> {
        let length = size.bytes()?;
        let mut data = Vec::new();
        data.try_reserve_exact(length)
            .map_err(|_| anyhow::anyhow!("CAPTION_BUDGET_EXCEEDED: component allocation"))?;
        data.resize(length, 0);
        Ok(Self {
            size,
            data,
            support: None,
            support_scan_pixels: 0,
        })
    }
    pub fn size(&self) -> Size {
        self.size
    }
    pub fn width(&self) -> u32 {
        self.size.width
    }
    pub fn height(&self) -> u32 {
        self.size.height
    }
    pub fn data(&self) -> &[u8] {
        &self.data
    }
    #[cfg(test)]
    pub fn support(&self) -> Option<Support> {
        self.support
    }
    fn copied(&self) -> Self {
        Self {
            size: self.size,
            data: self.data.clone(),
            support: self.support,
            support_scan_pixels: 0,
        }
    }
    fn write(&mut self, x: u32, y: u32, rgba: [f64; 4]) {
        let pixel = rgba.map(quantize);
        let offset = (y as usize * self.size.width as usize + x as usize) * 4;
        self.data[offset..offset + 4].copy_from_slice(&pixel);
        if pixel.iter().any(|value| *value != 0) {
            include(&mut self.support, x, y);
        }
    }
}
fn include(support: &mut Option<Support>, x: u32, y: u32) {
    if let Some(bounds) = support {
        bounds.include(x, y);
    } else {
        *support = Some(Support {
            left: x,
            top: y,
            right: x + 1,
            bottom: y + 1,
        });
    }
}
fn quantize(value: f64) -> u8 {
    libm::floor(0.5 + 255.0 * value.clamp(0.0, 1.0)) as u8
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Axis {
    X,
    Y,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Boundary {
    /// Discard both color and weight for samples outside normalized [0, 1].
    Normalize,
    /// Clamp the sample coordinate to the edge before interpolation.
    Replicate,
    /// Retain weight for outside samples, contributing zero to every channel.
    Transparent,
}
#[derive(Clone, Copy, Debug)]
pub struct SpacingRamp {
    /// Pixel-space domain in the input texture. UVs address pixel centers.
    pub domain: [f64; 4],
    pub axis: Axis,
    pub start: f64,
    pub end: f64,
    pub reverse: bool,
    /// Evaluate the field at the preceding tap, carrying the configured pair order
    /// across the kernel. This is spatial, not frame history.
    pub previous_sample: bool,
    pub positive_first: bool,
}
impl SpacingRamp {
    fn validate(self) -> Result<()> {
        ensure!(
            self.domain.iter().all(|v| v.is_finite())
                && self.domain[2] > 0.0
                && self.domain[3] > 0.0
                && self.start.is_finite()
                && self.end.is_finite()
                && self.end > self.start
                && (self.end - self.start).is_finite(),
            "CAPTION_MATERIAL_INVALID: Gaussian spacing ramp"
        );
        Ok(())
    }
    fn factor(self, point: [f64; 2]) -> f64 {
        let i = if self.axis == Axis::X { 0 } else { 1 };
        let mut uv = (point[i] + 0.5 - self.domain[i]) / self.domain[i + 2];
        if self.reverse {
            uv = 1.0 - uv;
        }
        let t = ((uv - self.start) / (self.end - self.start)).clamp(0.0, 1.0);
        1.0 - t * t * (3.0 - 2.0 * t)
    }
}
#[derive(Clone, Copy, Debug)]
pub struct GaussianSampling {
    /// Integer texel subview; sampling clamps to this view, not the backing image.
    pub input: [u32; 4],
    /// Output pixel-space rectangle. Pixels outside it are transparent.
    pub output: [f64; 4],
}
#[derive(Clone, Copy, Debug)]
pub struct GaussianPass {
    pub axis: Axis,
    pub sample_count: f64,
    /// Distance and sigma are in INPUT image pixels, including resized passes.
    pub step_pixels: f64,
    pub sigma_pixels: f64,
    pub gamma: Option<f64>,
    pub boundary: Boundary,
    pub output: Size,
    pub spacing_ramp: Option<SpacingRamp>,
    pub sampling: Option<GaussianSampling>,
}
impl GaussianPass {
    pub fn validate(self) -> Result<usize> {
        self.output.pixels()?;
        ensure!(
            self.sample_count.is_finite()
                && (0.0..=MAX_GAUSSIAN_SAMPLES as f64).contains(&self.sample_count),
            "CAPTION_MATERIAL_INVALID: Gaussian sample count"
        );
        ensure!(
            self.step_pixels.is_finite() && self.step_pixels >= 0.0,
            "CAPTION_MATERIAL_INVALID: Gaussian step"
        );
        let count = libm::floor(self.sample_count) as usize;
        ensure!(
            self.sigma_pixels.is_finite()
                && self.sigma_pixels >= 0.0
                && (count == 0 || self.sigma_pixels > 0.0),
            "CAPTION_MATERIAL_INVALID: Gaussian sigma"
        );
        validate_gamma(self.gamma)?;
        if let Some(ramp) = self.spacing_ramp {
            ramp.validate()?;
        }
        if let Some(view) = self.sampling {
            ensure!(
                view.input[2] > 0
                    && view.input[3] > 0
                    && view
                        .output
                        .iter()
                        .all(|v| v.is_finite() && v.abs() <= 1_000_000.0)
                    && view.output[2] > 0.0
                    && view.output[3] > 0.0,
                "CAPTION_MATERIAL_INVALID: Gaussian sampling domain"
            );
        }
        Ok(count)
    }
    pub fn sampling_domains(self, input: Size) -> Result<([f64; 4], [f64; 4])> {
        if let Some(view) = self.sampling {
            self.validate()?;
            ensure!(
                view.input[0]
                    .checked_add(view.input[2])
                    .is_some_and(|end| end <= input.width)
                    && view.input[1]
                        .checked_add(view.input[3])
                        .is_some_and(|end| end <= input.height),
                "CAPTION_MATERIAL_INVALID: Gaussian source view outside input"
            );
            Ok((view.input.map(f64::from), view.output))
        } else {
            Ok((
                [0.0, 0.0, input.width as f64, input.height as f64],
                [
                    0.0,
                    0.0,
                    self.output.width as f64,
                    self.output.height as f64,
                ],
            ))
        }
    }
}
fn validate_gamma(gamma: Option<f64>) -> Result<()> {
    if let Some(value) = gamma {
        ensure!(
            value.is_finite() && value > 0.0 && (1.0 / value).is_finite(),
            "CAPTION_MATERIAL_INVALID: gamma"
        );
    }
    Ok(())
}

/// Sampling costs are in actual texel fetches, not four for every bilinear read.
/// Imported image scans are charged once at the entry point. Output pixels are
/// separate allocation/clear/write work, so the caller can use its own budget.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct WorkEstimate {
    pub texel_reads: u64,
    pub support_scan_pixels: u64,
    pub output_pixels: u64,
}
impl WorkEstimate {
    fn add(&mut self, other: Self) -> Result<()> {
        self.texel_reads = checked_add(self.texel_reads, other.texel_reads)?;
        self.support_scan_pixels =
            checked_add(self.support_scan_pixels, other.support_scan_pixels)?;
        self.output_pixels = checked_add(self.output_pixels, other.output_pixels)?;
        Ok(())
    }
}
fn checked_add(a: u64, b: u64) -> Result<u64> {
    a.checked_add(b)
        .ok_or_else(|| anyhow::anyhow!("CAPTION_BUDGET_EXCEEDED: filter work"))
}
fn checked_mul(a: u64, b: u64) -> Result<u64> {
    a.checked_mul(b)
        .ok_or_else(|| anyhow::anyhow!("CAPTION_BUDGET_EXCEEDED: filter work"))
}

#[derive(Clone, Copy)]
struct AxisTaps {
    indices: [u32; 2],
    weights: [f64; 2],
    len: usize,
}
fn axis_taps(coordinate: f64, extent: u32) -> AxisTaps {
    let coordinate = coordinate.clamp(0.0, f64::from(extent - 1));
    let first = libm::floor(coordinate) as u32;
    let second = (first + 1).min(extent - 1);
    let fraction = coordinate - f64::from(first);
    if first == second || fraction == 0.0 {
        AxisTaps {
            indices: [first, first],
            weights: [1.0, 0.0],
            len: 1,
        }
    } else {
        AxisTaps {
            indices: [first, second],
            weights: [1.0 - fraction, fraction],
            len: 2,
        }
    }
}
fn taps_in_support(coordinate: f64, extent: u32, lo: u32, hi: u32) -> u64 {
    let taps = axis_taps(coordinate, extent);
    (0..taps.len)
        .filter(|i| taps.indices[*i] >= lo && taps.indices[*i] < hi)
        .count() as u64
}
fn sample(image: &ComponentImage, x: f64, y: f64) -> [f64; 4] {
    let Some(support) = image.support else {
        return [0.0; 4];
    };
    let xs = axis_taps(x, image.width());
    let ys = axis_taps(y, image.height());
    let mut result = [0.0; 4];
    for yi in 0..ys.len {
        let py = ys.indices[yi];
        if py < support.top || py >= support.bottom {
            continue;
        }
        for xi in 0..xs.len {
            let px = xs.indices[xi];
            if px < support.left || px >= support.right {
                continue;
            }
            let weight = xs.weights[xi] * ys.weights[yi];
            #[cfg(test)]
            FETCH_COUNT.with(|count| count.set(count.get() + 1));
            let offset = (py as usize * image.width() as usize + px as usize) * 4;
            for (channel, value) in result.iter_mut().enumerate() {
                *value += f64::from(image.data[offset + channel]) / 255.0 * weight;
            }
        }
    }
    result
}
fn center(index: u32, input: u32, output: u32) -> f64 {
    // Preserve exact integer centers for unscaled axes. This also avoids
    // phantom second fetches caused by a divide-then-multiply roundoff.
    if input == output {
        f64::from(index)
    } else {
        (f64::from(index) + 0.5) * f64::from(input) / f64::from(output) - 0.5
    }
}
fn inside(coordinate: f64, extent: u32) -> bool {
    coordinate >= -0.5 && coordinate <= f64::from(extent) - 0.5
}
fn resize_support(
    support: Option<Support>,
    input: Size,
    output: Size,
    rx: f64,
    ry: f64,
) -> Option<Support> {
    let bounds = support?;
    fn low(value: u32, radius: f64, input: u32, output: u32) -> u32 {
        libm::floor(
            ((f64::from(value) - 0.5 - radius) / f64::from(input)) * f64::from(output) - 0.5,
        )
        .clamp(0.0, f64::from(output)) as u32
    }
    fn high(value: u32, radius: f64, input: u32, output: u32) -> u32 {
        (libm::ceil(
            ((f64::from(value) + 0.5 + radius) / f64::from(input)) * f64::from(output) - 0.5,
        ) + 1.0)
            .clamp(0.0, f64::from(output)) as u32
    }
    let roi = Support {
        left: low(bounds.left, rx, input.width, output.width),
        top: low(bounds.top, ry, input.height, output.height),
        right: high(bounds.right, rx, input.width, output.width),
        bottom: high(bounds.bottom, ry, input.height, output.height),
    };
    (roi.left < roi.right && roi.top < roi.bottom).then_some(roi)
}
fn gaussian_support(
    support: Option<Support>,
    input: Size,
    pass: GaussianPass,
    count: usize,
) -> Option<Support> {
    if let Some(view) = pass.sampling {
        support?;
        let edge = |v: f64, max: u32| libm::ceil(v - 0.5).clamp(0.0, max as f64) as u32;
        let roi = Support {
            left: edge(view.output[0], pass.output.width),
            top: edge(view.output[1], pass.output.height),
            right: edge(view.output[0] + view.output[2], pass.output.width),
            bottom: edge(view.output[1] + view.output[3], pass.output.height),
        };
        return (roi.left < roi.right && roi.top < roi.bottom).then_some(roi);
    }
    if count == 0 && input == pass.output {
        return support;
    }
    let radius = count as f64 * pass.step_pixels;
    let (x, y) = if pass.axis == Axis::X {
        (radius, 0.0)
    } else {
        (0.0, radius)
    };
    resize_support(support, input, pass.output, x, y)
}
fn power(value: f64, exponent: f64) -> f64 {
    // Exact endpoints dominate sparse text surfaces. This is not a gamma LUT
    // or gamma-before-interpolation approximation.
    if value == 0.0 || value == 1.0 || exponent == 1.0 {
        value
    } else {
        libm::pow(value, exponent)
    }
}
/// `channels` is 3 (RGB only) or 4 (`gammaChannels: rgba`, alpha too).
fn encoded_sample(
    image: &ComponentImage,
    x: f64,
    y: f64,
    gamma: Option<f64>,
    channels: usize,
) -> [f64; 4] {
    let mut value = sample(image, x, y);
    if let Some(gamma) = gamma {
        for channel in &mut value[..channels] {
            *channel = power(*channel, gamma);
        }
    }
    value
}
fn scoped_sample(
    image: &ComponentImage,
    pass: GaussianPass,
    x: f64,
    y: f64,
    gamma: Option<f64>,
    channels: usize,
) -> [f64; 4] {
    let (x, y) = if let Some(view) = pass.sampling {
        (
            x.clamp(
                view.input[0] as f64,
                (view.input[0] + view.input[2] - 1) as f64,
            ),
            y.clamp(
                view.input[1] as f64,
                (view.input[1] + view.input[3] - 1) as f64,
            ),
        )
    } else {
        (x, y)
    };
    encoded_sample(image, x, y, gamma, channels)
}
/// Validated coefficients shared by CPU and GPU executors. The shader does not
/// independently approximate exp(), so backend differences are limited to f32
/// accumulation/sampling and final UNORM rounding.
pub fn gaussian_weights(pass: GaussianPass) -> Result<Vec<f64>> {
    let count = pass.validate()?;
    Ok(if count == 0 {
        Vec::new()
    } else {
        weights(pass, count)
    })
}

fn weights(pass: GaussianPass, count: usize) -> Vec<f64> {
    let ratio = pass.step_pixels / pass.sigma_pixels;
    (1..=count)
        .map(|index| {
            let x = index as f64 * ratio;
            libm::exp(-0.5 * x * x)
        })
        .collect()
}
fn gaussian_pixel(
    image: &ComponentImage,
    pass: GaussianPass,
    weights: &[f64],
    channels: usize,
    x: u32,
    y: u32,
) -> [f64; 4] {
    let (sx, sy, bounds) = if let Some(view) = pass.sampling {
        let a = view.input.map(f64::from);
        let b = view.output;
        (
            ((x as f64 + 0.5 - b[0]) / b[2]) * a[2] + a[0] - 0.5,
            ((y as f64 + 0.5 - b[1]) / b[3]) * a[3] + a[1] - 0.5,
            a,
        )
    } else {
        (
            center(x, image.width(), pass.output.width),
            center(y, image.height(), pass.output.height),
            [0.0, 0.0, image.width() as f64, image.height() as f64],
        )
    };
    if weights.is_empty() {
        return scoped_sample(image, pass, sx, sy, None, channels);
    }
    if pass
        .spacing_ramp
        .is_some_and(|ramp| ramp.factor([sx, sy]) == 0.0)
    {
        // Every following tap remains at this center, including recursive mode.
        return scoped_sample(image, pass, sx, sy, None, channels);
    }
    let mut result = scoped_sample(image, pass, sx, sy, pass.gamma, channels);
    let mut sum_weight = 1.0;
    let mut previous = [sx, sy];
    for (index, weight) in weights.iter().copied().enumerate() {
        let signs = if pass.spacing_ramp.is_some_and(|r| r.positive_first) {
            [1.0, -1.0]
        } else {
            [-1.0, 1.0]
        };
        for sign in signs {
            let factor = pass.spacing_ramp.map_or(1.0, |ramp| {
                ramp.factor(if ramp.previous_sample {
                    previous
                } else {
                    [sx, sy]
                })
            });
            let distance = (index + 1) as f64 * pass.step_pixels * factor;
            let (tx, ty) = if pass.axis == Axis::X {
                (sx + sign * distance, sy)
            } else {
                (sx, sy + sign * distance)
            };
            previous = [tx, ty];
            if pass.boundary == Boundary::Replicate {
                previous = [
                    tx.clamp(bounds[0] - 0.5, bounds[0] + bounds[2] - 0.5),
                    ty.clamp(bounds[1] - 0.5, bounds[1] + bounds[3] - 0.5),
                ];
            }
            let valid = tx >= bounds[0] - 0.5
                && tx <= bounds[0] + bounds[2] - 0.5
                && ty >= bounds[1] - 0.5
                && ty <= bounds[1] + bounds[3] - 0.5;
            if valid || pass.boundary == Boundary::Replicate {
                let value = scoped_sample(image, pass, tx, ty, pass.gamma, channels);
                for (out, channel) in result.iter_mut().zip(value) {
                    *out += weight * channel;
                }
                sum_weight += weight;
            } else if pass.boundary == Boundary::Transparent {
                sum_weight += weight;
            }
        }
    }
    for channel in &mut result {
        *channel /= sum_weight;
    }
    if let Some(gamma) = pass.gamma {
        for channel in &mut result[..channels] {
            *channel = power(*channel, 1.0 / gamma);
        }
    }
    result
}

pub fn gaussian(image: &ComponentImage, pass: GaussianPass) -> Result<ComponentImage> {
    gaussian_channels(image, pass, 3)
}
fn gaussian_channels(
    image: &ComponentImage,
    pass: GaussianPass,
    channels: usize,
) -> Result<ComponentImage> {
    let count = pass.validate()?;
    pass.sampling_domains(image.size)?;
    if count == 0 && pass.sampling.is_none() {
        return resize(image, pass.output);
    }
    let mut output = ComponentImage::zeroed(pass.output)?;
    if let Some(roi) = gaussian_support(image.support, image.size, pass, count) {
        let weights = weights(pass, count);
        for y in roi.top..roi.bottom {
            for x in roi.left..roi.right {
                output.write(x, y, gaussian_pixel(image, pass, &weights, channels, x, y));
            }
        }
    }
    Ok(output)
}
pub fn resize(image: &ComponentImage, output: Size) -> Result<ComponentImage> {
    output.pixels()?;
    if image.size == output {
        return Ok(image.copied());
    }
    let mut result = ComponentImage::zeroed(output)?;
    if let Some(roi) = resize_support(image.support, image.size, output, 0.0, 0.0) {
        for y in roi.top..roi.bottom {
            for x in roi.left..roi.right {
                result.write(
                    x,
                    y,
                    sample(
                        image,
                        center(x, image.width(), output.width),
                        center(y, image.height(), output.height),
                    ),
                );
            }
        }
    }
    Ok(result)
}
fn sample_axis_sum(
    input: u32,
    output: u32,
    lo: u32,
    hi: u32,
    support_lo: u32,
    support_hi: u32,
) -> u64 {
    (lo..hi)
        .map(|index| taps_in_support(center(index, input, output), input, support_lo, support_hi))
        .sum()
}
fn estimate_resize_geometry(
    input: Size,
    support: Option<Support>,
    output: Size,
) -> Result<WorkEstimate> {
    input.pixels()?;
    let mut work = WorkEstimate {
        output_pixels: output.pixels()?,
        ..Default::default()
    };
    if input == output {
        return Ok(work);
    }
    if let (Some(bounds), Some(roi)) = (support, resize_support(support, input, output, 0.0, 0.0)) {
        work.texel_reads = checked_mul(
            sample_axis_sum(
                input.width,
                output.width,
                roi.left,
                roi.right,
                bounds.left,
                bounds.right,
            ),
            sample_axis_sum(
                input.height,
                output.height,
                roi.top,
                roi.bottom,
                bounds.top,
                bounds.bottom,
            ),
        )?;
    }
    Ok(work)
}
fn estimate_gaussian_geometry(
    input: Size,
    support: Option<Support>,
    pass: GaussianPass,
) -> Result<WorkEstimate> {
    input.pixels()?;
    let count = pass.validate()?;
    pass.sampling_domains(input)?;
    if count == 0 && pass.sampling.is_none() {
        return estimate_resize_geometry(input, support, pass.output);
    }
    let mut work = WorkEstimate {
        output_pixels: pass.output.pixels()?,
        ..Default::default()
    };
    if let (Some(bounds), Some(roi)) = (support, gaussian_support(support, input, pass, count)) {
        if pass.spacing_ramp.is_some() {
            // Variable positions destroy separability of the sparse read count.
            // Bound four bilinear reads per tap over the conservative support.
            work.texel_reads = checked_mul(
                checked_mul(
                    u64::from(roi.right - roi.left),
                    u64::from(roi.bottom - roi.top),
                )?,
                (2 * count as u64 + 1) * 4,
            )?;
            return Ok(work);
        }
        if let Some(view) = pass.sampling {
            // Rectangular remapping remains separable. Only a spacing field
            // couples the axes; a subview/fractional quad alone does not.
            // Count the same clamped 1/2-tap axes that scoped_sample reads,
            // including discarded vs replicated taps at the ROI edge.
            let at = |index: u32, axis: usize| {
                ((index as f64 + 0.5 - view.output[axis]) / view.output[axis + 2])
                    * view.input[axis + 2] as f64
                    + view.input[axis] as f64
                    - 0.5
            };
            let clipped = |coordinate: f64, axis: usize| {
                coordinate.clamp(
                    view.input[axis] as f64,
                    (view.input[axis] + view.input[axis + 2] - 1) as f64,
                )
            };
            let axis = if pass.axis == Axis::X { 0 } else { 1 };
            let other_axis = 1 - axis;
            let edges = [roi.left, roi.top, roi.right, roi.bottom];
            let extents = [input.width, input.height];
            let support_edges = [bounds.left, bounds.top, bounds.right, bounds.bottom];
            let mut other = 0_u64;
            for index in edges[other_axis]..edges[other_axis + 2] {
                other = checked_add(
                    other,
                    taps_in_support(
                        clipped(at(index, other_axis), other_axis),
                        extents[other_axis],
                        support_edges[other_axis],
                        support_edges[other_axis + 2],
                    ),
                )?;
            }
            let mut along = 0_u64;
            let lo = view.input[axis] as f64 - 0.5;
            let hi = lo + view.input[axis + 2] as f64;
            for index in edges[axis]..edges[axis + 2] {
                let center = at(index, axis);
                along = checked_add(
                    along,
                    taps_in_support(
                        clipped(center, axis),
                        extents[axis],
                        support_edges[axis],
                        support_edges[axis + 2],
                    ),
                )?;
                for tap in 1..=count {
                    for sign in [-1.0, 1.0] {
                        let point = center + sign * tap as f64 * pass.step_pixels;
                        if (lo..=hi).contains(&point) || pass.boundary == Boundary::Replicate {
                            along = checked_add(
                                along,
                                taps_in_support(
                                    clipped(point, axis),
                                    extents[axis],
                                    support_edges[axis],
                                    support_edges[axis + 2],
                                ),
                            )?;
                        }
                    }
                }
            }
            work.texel_reads = checked_mul(along, other)?;
            return Ok(work);
        }
        let (extent, out_extent, lo, hi, support_lo, support_hi, other) = match pass.axis {
            Axis::X => (
                input.width,
                pass.output.width,
                roi.left,
                roi.right,
                bounds.left,
                bounds.right,
                sample_axis_sum(
                    input.height,
                    pass.output.height,
                    roi.top,
                    roi.bottom,
                    bounds.top,
                    bounds.bottom,
                ),
            ),
            Axis::Y => (
                input.height,
                pass.output.height,
                roi.top,
                roi.bottom,
                bounds.top,
                bounds.bottom,
                sample_axis_sum(
                    input.width,
                    pass.output.width,
                    roi.left,
                    roi.right,
                    bounds.left,
                    bounds.right,
                ),
            ),
        };
        let mut along = 0_u64;
        for index in lo..hi {
            let coordinate = center(index, extent, out_extent);
            along = checked_add(
                along,
                taps_in_support(coordinate, extent, support_lo, support_hi),
            )?;
            for tap in 1..=count {
                for sign in [-1.0, 1.0] {
                    let at = coordinate + sign * tap as f64 * pass.step_pixels;
                    if inside(at, extent) || pass.boundary == Boundary::Replicate {
                        along = checked_add(
                            along,
                            taps_in_support(at, extent, support_lo, support_hi),
                        )?;
                    }
                }
            }
        }
        work.texel_reads = checked_mul(along, other)?;
    }
    Ok(work)
}
pub fn estimate_gaussian_reads(image: &ComponentImage, pass: GaussianPass) -> Result<WorkEstimate> {
    let mut work = estimate_gaussian_geometry(image.size, image.support, pass)?;
    work.support_scan_pixels = image.support_scan_pixels;
    Ok(work)
}
#[cfg(test)]
pub fn estimate_resize_reads(image: &ComponentImage, output: Size) -> Result<WorkEstimate> {
    let mut work = estimate_resize_geometry(image.size, image.support, output)?;
    work.support_scan_pixels = image.support_scan_pixels;
    Ok(work)
}

#[derive(Clone, Copy, Debug)]
pub struct GlowLevel {
    pub x: GaussianPass,
    pub y: GaussianPass,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GlowComposite {
    Screen,
    SourceOverGlow,
    /// Original kept over its screen with the glow (`O'+(1-O.a)*S`, `O'.a=O.a^2`).
    OriginalOverScreen,
}
/// `aggregation: linear`: levels are decoded, folded with per-level gains,
/// scaled by intensity and encoded once.
#[derive(Clone, Debug)]
pub struct LinearGlow {
    /// One gain per level in [0,2]: `D = 1-(1-D)(1-gain*decoded)`.
    pub gains: Vec<f64>,
    /// Straight RGBA; replaces level RGB with `rgb*a*level.a` before decoding.
    pub color: Option<[f64; 4]>,
}
#[derive(Clone, Debug)]
pub struct GlowConfig {
    pub levels: Vec<GlowLevel>,
    pub intensity: f64,
    /// Exponent denominator for intensity shaping; per-pass gamma is separate.
    pub gamma: f64,
    pub original_opacity: f64,
    /// RGB multiplier applied after cascade aggregation, before composition.
    pub glow_tint: [f64; 3],
    /// Row-major RGB matrix after tint, with clamping before source composition.
    pub glow_color_matrix: [f64; 9],
    /// Per-pass and aggregation gamma also decode/encode alpha.
    pub gamma_alpha: bool,
    pub linear: Option<LinearGlow>,
    pub composite: GlowComposite,
    pub output: Size,
}
pub const IDENTITY_GLOW_MATRIX: [f64; 9] = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0];
impl GlowConfig {
    pub fn validate(&self) -> Result<f64> {
        ensure!(
            (1..=MAX_GLOW_LEVELS).contains(&self.levels.len()),
            "CAPTION_MATERIAL_INVALID: glow levels"
        );
        ensure!(
            self.intensity.is_finite() && self.intensity >= 0.0,
            "CAPTION_MATERIAL_INVALID: glow intensity"
        );
        validate_gamma(Some(self.gamma))?;
        ensure!(
            self.original_opacity.is_finite() && (0.0..=1.0).contains(&self.original_opacity),
            "CAPTION_MATERIAL_INVALID: original opacity"
        );
        ensure!(
            self.glow_tint
                .iter()
                .all(|c| c.is_finite() && (0.0..=1.0).contains(c)),
            "CAPTION_MATERIAL_INVALID: glow tint"
        );
        ensure!(
            self.glow_color_matrix.iter().all(|c| c.is_finite()),
            "CAPTION_MATERIAL_INVALID: glow color matrix"
        );
        if let Some(linear) = &self.linear {
            ensure!(
                linear.gains.len() == self.levels.len()
                    && linear
                        .gains
                        .iter()
                        .all(|g| g.is_finite() && (0.0..=2.0).contains(g)),
                "CAPTION_MATERIAL_INVALID: glow level gains"
            );
            ensure!(
                linear
                    .color
                    .is_none_or(|c| c.iter().all(|v| v.is_finite() && (0.0..=1.0).contains(v))),
                "CAPTION_MATERIAL_INVALID: glow level color"
            );
        }
        self.output.pixels()?;
        for level in &self.levels {
            ensure!(
                level.x.axis == Axis::X && level.y.axis == Axis::Y,
                "CAPTION_MATERIAL_INVALID: glow axes"
            );
            level.x.validate()?;
            level.y.validate()?;
        }
        // Encoded-fold gain; for linear aggregation only its sign (intensity > 0) is used.
        let gain = power(self.intensity * 0.5, 1.0 / self.gamma);
        ensure!(gain.is_finite(), "CAPTION_MATERIAL_INVALID: glow gain");
        Ok(gain)
    }
    /// The GPU glow executor covers up to 7 encoded levels with RGB gamma and
    /// screen/source-over-glow only (`caption-glow-linear/1` runs on the CPU).
    pub fn gpu_supported(&self) -> bool {
        self.levels.len() <= 7
            && !self.gamma_alpha
            && self.linear.is_none()
            && self.composite != GlowComposite::OriginalOverScreen
    }
    fn gamma_channels(&self) -> usize {
        if self.gamma_alpha {
            4
        } else {
            3
        }
    }
}
#[derive(Debug)]
pub struct GlowResult {
    pub image: ComponentImage,
    #[cfg(test)]
    pub levels: Vec<ComponentImage>,
}
fn merge_support(a: Option<Support>, b: Option<Support>) -> Option<Support> {
    match (a, b) {
        (Some(a), Some(b)) => Some(a.union(b)),
        (a, b) => a.or(b),
    }
}
fn composite_support(
    input: Size,
    support: Option<Support>,
    levels: &[(Size, Option<Support>)],
    cfg: &GlowConfig,
    gain: f64,
) -> Option<Support> {
    let mut roi = if cfg.original_opacity > 0.0 {
        resize_support(support, input, cfg.output, 0.0, 0.0)
    } else {
        None
    };
    if gain > 0.0 {
        for (size, support) in levels {
            roi = merge_support(roi, resize_support(*support, *size, cfg.output, 0.0, 0.0));
        }
    }
    roi
}
fn composite_pixel(
    input: &ComponentImage,
    levels: &[ComponentImage],
    cfg: &GlowConfig,
    gain: f64,
    x: u32,
    y: u32,
) -> Result<[f64; 4]> {
    let mut original = if cfg.original_opacity > 0.0 {
        sample(
            input,
            center(x, input.width(), cfg.output.width),
            center(y, input.height(), cfg.output.height),
        )
    } else {
        [0.0; 4]
    };
    for value in &mut original {
        *value *= cfg.original_opacity;
    }
    let mut glow = if let Some(linear) = &cfg.linear {
        let channels = cfg.gamma_channels();
        let mut folded = [0.0; 4];
        if gain > 0.0 {
            for (level, level_gain) in levels.iter().zip(&linear.gains) {
                let mut value = sample(
                    level,
                    center(x, level.width(), cfg.output.width),
                    center(y, level.height(), cfg.output.height),
                );
                if let Some(color) = linear.color {
                    for channel in 0..3 {
                        value[channel] = color[channel] * color[3] * value[3];
                    }
                }
                for (channel, (out, value)) in folded.iter_mut().zip(value).enumerate() {
                    let decoded = if channel < channels {
                        power(value, cfg.gamma)
                    } else {
                        value
                    };
                    *out = 1.0 - (1.0 - *out) * (1.0 - level_gain * decoded);
                }
            }
        }
        std::array::from_fn(|channel| {
            let value = folded[channel] * cfg.intensity;
            if channel < channels {
                power(value.max(0.0), 1.0 / cfg.gamma).clamp(0.0, 1.0)
            } else {
                value.clamp(0.0, 1.0)
            }
        })
    } else {
        let mut product = [1.0; 4];
        if gain > 0.0 {
            for level in levels {
                let value = sample(
                    level,
                    center(x, level.width(), cfg.output.width),
                    center(y, level.height(), cfg.output.height),
                );
                for (out, channel) in product.iter_mut().zip(value) {
                    *out *= 1.0 - (channel * gain).clamp(0.0, 1.0);
                }
            }
        }
        product.map(|value| ((1.0 - value) * gain.max(1.0)).clamp(0.0, 1.0))
    };
    for (channel, tint) in glow.iter_mut().take(3).zip(cfg.glow_tint) {
        *channel *= tint;
    }
    if cfg.glow_color_matrix != IDENTITY_GLOW_MATRIX {
        let rgb = [glow[0], glow[1], glow[2]];
        for (channel, row) in cfg.glow_color_matrix.chunks_exact(3).enumerate() {
            let value = row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2];
            ensure!(
                value.is_finite(),
                "CAPTION_MATERIAL_INVALID: glow color matrix overflow"
            );
            glow[channel] = value.clamp(0.0, 1.0);
        }
    }
    Ok(std::array::from_fn(|channel| match cfg.composite {
        GlowComposite::Screen => 1.0 - (1.0 - glow[channel]) * (1.0 - original[channel]),
        GlowComposite::SourceOverGlow => original[channel] + glow[channel] * (1.0 - original[3]),
        GlowComposite::OriginalOverScreen => {
            let alpha = original[3];
            let screen = 1.0 - (1.0 - glow[channel]) * (1.0 - original[channel]);
            let kept = if channel == 3 {
                alpha * alpha
            } else if alpha > 0.0 {
                original[channel]
            } else {
                0.0
            };
            kept + (1.0 - alpha) * screen
        }
    }))
}
pub fn cascade_glow(input: &ComponentImage, cfg: &GlowConfig) -> Result<GlowResult> {
    let gain = cfg.validate()?;
    let mut levels: Vec<ComponentImage> = Vec::with_capacity(cfg.levels.len());
    for level in &cfg.levels {
        let previous = levels.last().unwrap_or(input);
        let x = gaussian_channels(previous, level.x, cfg.gamma_channels())?;
        levels.push(gaussian_channels(&x, level.y, cfg.gamma_channels())?);
    }
    let mut image = ComponentImage::zeroed(cfg.output)?;
    let metadata = levels
        .iter()
        .map(|image| (image.size, image.support))
        .collect::<Vec<_>>();
    if let Some(roi) = composite_support(input.size, input.support, &metadata, cfg, gain) {
        for y in roi.top..roi.bottom {
            for x in roi.left..roi.right {
                image.write(x, y, composite_pixel(input, &levels, cfg, gain, x, y)?);
            }
        }
    }
    Ok(GlowResult {
        image,
        #[cfg(test)]
        levels,
    })
}
fn estimate_composite(
    input: Size,
    support: Option<Support>,
    levels: &[(Size, Option<Support>)],
    cfg: &GlowConfig,
    gain: f64,
) -> Result<WorkEstimate> {
    let mut work = WorkEstimate {
        output_pixels: cfg.output.pixels()?,
        ..Default::default()
    };
    if let Some(roi) = composite_support(input, support, levels, cfg, gain) {
        let mut add_image = |size: Size, support: Option<Support>| -> Result<()> {
            if let Some(bounds) = support {
                let x = sample_axis_sum(
                    size.width,
                    cfg.output.width,
                    roi.left,
                    roi.right,
                    bounds.left,
                    bounds.right,
                );
                let y = sample_axis_sum(
                    size.height,
                    cfg.output.height,
                    roi.top,
                    roi.bottom,
                    bounds.top,
                    bounds.bottom,
                );
                work.texel_reads = checked_add(work.texel_reads, checked_mul(x, y)?)?;
            }
            Ok(())
        };
        if cfg.original_opacity > 0.0 {
            add_image(input, support)?;
        }
        if gain > 0.0 {
            for (size, support) in levels {
                add_image(*size, *support)?;
            }
        }
    }
    Ok(work)
}
/// Conservative preflight: intermediate UNORM rounding may shrink support, but
/// the propagated boxes never trim a possible nonzero color or coverage value.
pub fn estimate_glow_reads(input: &ComponentImage, cfg: &GlowConfig) -> Result<WorkEstimate> {
    let gain = cfg.validate()?;
    let mut work = WorkEstimate {
        support_scan_pixels: input.support_scan_pixels,
        ..Default::default()
    };
    let mut size = input.size;
    let mut support = input.support;
    let mut levels = Vec::new();
    for level in &cfg.levels {
        work.add(estimate_gaussian_geometry(size, support, level.x)?)?;
        support = gaussian_support(support, size, level.x, level.x.validate()?);
        size = level.x.output;
        work.add(estimate_gaussian_geometry(size, support, level.y)?)?;
        support = gaussian_support(support, size, level.y, level.y.validate()?);
        size = level.y.output;
        levels.push((size, support));
    }
    work.add(estimate_composite(
        input.size,
        input.support,
        &levels,
        cfg,
        gain,
    )?)?;
    Ok(work)
}
/// Includes the caller-owned input, all retained Y levels, the temporary X
/// surface and final output. Does not include unrelated caller allocations.
pub fn estimate_glow_peak_bytes(input: Size, cfg: &GlowConfig) -> Result<u64> {
    cfg.validate()?;
    let original = input.pixels()? * 4;
    let mut retained = 0_u64;
    let mut peak = original;
    for level in &cfg.levels {
        let x = level.x.output.pixels()? * 4;
        let y = level.y.output.pixels()? * 4;
        peak = peak.max(checked_add(
            original,
            checked_add(retained, checked_add(x, y)?)?,
        )?);
        retained = checked_add(retained, y)?;
    }
    Ok(peak.max(checked_add(
        original,
        checked_add(retained, cfg.output.pixels()? * 4)?,
    )?))
}

#[cfg(test)]
thread_local! { static FETCH_COUNT: std::cell::Cell<u64> = const { std::cell::Cell::new(0) }; }

#[cfg(test)]
mod tests {
    use super::*;

    fn pass(
        size: Size,
        axis: Axis,
        count: f64,
        step: f64,
        gamma: Option<f64>,
        boundary: Boundary,
    ) -> GaussianPass {
        GaussianPass {
            sampling: None,
            spacing_ramp: None,
            axis,
            sample_count: count,
            step_pixels: step,
            sigma_pixels: 1.1,
            gamma,
            boundary,
            output: size,
        }
    }
    fn image(width: u32, height: u32, pixels: &[(u32, u32, [u8; 4])]) -> ComponentImage {
        let mut data = vec![0; width as usize * height as usize * 4];
        for (x, y, value) in pixels {
            let at = (*y as usize * width as usize + *x as usize) * 4;
            data[at..at + 4].copy_from_slice(value);
        }
        ComponentImage::new(width, height, data).unwrap()
    }
    // Dense reference intentionally ignores support, visits every output pixel
    // and fetches all four taps, including zeros and duplicated border texels.
    fn dense_sample(input: &ComponentImage, x: f64, y: f64) -> [f64; 4] {
        let x = x.clamp(0.0, f64::from(input.width() - 1));
        let y = y.clamp(0.0, f64::from(input.height() - 1));
        let x0 = libm::floor(x) as u32;
        let y0 = libm::floor(y) as u32;
        let fx = x - f64::from(x0);
        let fy = y - f64::from(y0);
        let mut value = [0.0; 4];
        for (py, wy) in [(y0, 1.0 - fy), ((y0 + 1).min(input.height() - 1), fy)] {
            for (px, wx) in [(x0, 1.0 - fx), ((x0 + 1).min(input.width() - 1), fx)] {
                for (channel, out) in value.iter_mut().enumerate() {
                    *out +=
                        f64::from(input.data[((py * input.width() + px) * 4) as usize + channel])
                            / 255.0
                            * (wx * wy);
                }
            }
        }
        value
    }
    fn dense_resize(input: &ComponentImage, output: Size) -> ComponentImage {
        let mut result = ComponentImage::zeroed(output).unwrap();
        for y in 0..output.height {
            for x in 0..output.width {
                result.write(
                    x,
                    y,
                    dense_sample(
                        input,
                        center(x, input.width(), output.width),
                        center(y, input.height(), output.height),
                    ),
                );
            }
        }
        result
    }
    fn dense_gaussian(input: &ComponentImage, pass: GaussianPass) -> ComponentImage {
        let count = pass.validate().unwrap();
        if count == 0 {
            return dense_resize(input, pass.output);
        }
        let weights = weights(pass, count);
        let mut result = ComponentImage::zeroed(pass.output).unwrap();
        for y in 0..pass.output.height {
            for x in 0..pass.output.width {
                let sx = center(x, input.width(), pass.output.width);
                let sy = center(y, input.height(), pass.output.height);
                let encode = |value: [f64; 4]| -> [f64; 4] {
                    std::array::from_fn(|channel| {
                        if channel < 3 {
                            pass.gamma
                                .map_or(value[channel], |g| power(value[channel], g))
                        } else {
                            value[channel]
                        }
                    })
                };
                let mut color = encode(dense_sample(input, sx, sy));
                let mut weight_sum = 1.0;
                for (i, weight) in weights.iter().copied().enumerate() {
                    for sign in [-1.0, 1.0] {
                        let delta = sign * (i + 1) as f64 * pass.step_pixels;
                        let (tx, ty) = if pass.axis == Axis::X {
                            (sx + delta, sy)
                        } else {
                            (sx, sy + delta)
                        };
                        if inside(tx, input.width()) && inside(ty, input.height())
                            || pass.boundary == Boundary::Replicate
                        {
                            let value = encode(dense_sample(input, tx, ty));
                            for (out, channel) in color.iter_mut().zip(value) {
                                *out += weight * channel;
                            }
                            weight_sum += weight;
                        } else if pass.boundary == Boundary::Transparent {
                            weight_sum += weight;
                        }
                    }
                }
                for (channel, value) in color.iter_mut().enumerate() {
                    *value /= weight_sum;
                    if channel < 3 {
                        if let Some(gamma) = pass.gamma {
                            *value = power(*value, 1.0 / gamma);
                        }
                    }
                }
                result.write(x, y, color);
            }
        }
        result
    }

    #[test]
    fn constructors_and_filter_parameters_are_checked() {
        assert!(ComponentImage::new(0, 1, vec![]).is_err());
        assert!(ComponentImage::new(2, 1, vec![0; 4]).is_err());
        assert!(
            ComponentImage::zeroed(Size {
                width: u32::MAX,
                height: u32::MAX
            })
            .is_err()
        );
        let input = image(2, 1, &[(0, 0, [255, 0, 0, 0])]);
        let mut config = pass(input.size(), Axis::X, 1.0, 1.0, None, Boundary::Normalize);
        config.sigma_pixels = 0.0;
        assert!(gaussian(&input, config).is_err());
        config.sample_count = 0.0;
        assert_eq!(gaussian(&input, config).unwrap().data(), input.data());
        config.sample_count = 1024.1;
        assert!(gaussian(&input, config).is_err());
        config.sample_count = f64::NAN;
        assert!(gaussian(&input, config).is_err());
        config.sample_count = 1.0;
        config.sigma_pixels = 1.0;
        config.gamma = Some(0.0);
        assert!(gaussian(&input, config).is_err());
        config.gamma = None;
        config.step_pixels = -1.0;
        assert!(gaussian(&input, config).is_err());
    }

    #[test]
    fn gamma_white_impulse_and_zero_alpha_color_remain_independent() {
        let input = image(5, 1, &[(2, 0, [255, 255, 255, 255])]);
        let output = gaussian(
            &input,
            pass(
                input.size(),
                Axis::X,
                1.0,
                1.0,
                Some(2.2),
                Boundary::Transparent,
            ),
        )
        .unwrap();
        let neighbor = &output.data()[4..8];
        assert!(
            neighbor[0] > neighbor[3],
            "gamma-filtered RGB must not be clamped to coverage"
        );
        assert_eq!(neighbor[0], neighbor[1]);
        let emission = image(5, 1, &[(2, 0, [200, 10, 0, 0])]);
        let filtered = gaussian(
            &emission,
            pass(
                emission.size(),
                Axis::X,
                1.0,
                0.75,
                Some(2.2),
                Boundary::Normalize,
            ),
        )
        .unwrap();
        assert!(
            filtered
                .data()
                .chunks_exact(4)
                .any(|p| p[0] > 0 && p[3] == 0)
        );
        assert!(filtered.support().is_some());
        let half = image(5, 1, &[(2, 0, [128, 64, 32, 128])]);
        let filtered = gaussian(
            &half,
            pass(
                half.size(),
                Axis::X,
                1.0,
                1.0,
                Some(2.2),
                Boundary::Normalize,
            ),
        )
        .unwrap();
        assert!(filtered.data()[4] > filtered.data()[7]);
    }

    #[test]
    fn normalized_replicate_and_transparent_borders_have_distinct_meanings() {
        let input = image(3, 1, &[(0, 0, [255, 100, 0, 255])]);
        let colors = [
            Boundary::Normalize,
            Boundary::Replicate,
            Boundary::Transparent,
        ]
        .map(|boundary| {
            gaussian(
                &input,
                pass(input.size(), Axis::X, 1.0, 1.0, None, boundary),
            )
            .unwrap()
            .data()[0]
        });
        assert!(colors[1] > colors[0] && colors[0] > colors[2]);
        let a = gaussian(
            &input,
            pass(input.size(), Axis::X, 1.0, 1.0, None, Boundary::Normalize),
        )
        .unwrap();
        let b = gaussian(
            &input,
            pass(input.size(), Axis::X, 1.99, 1.0, None, Boundary::Normalize),
        )
        .unwrap();
        assert_eq!(
            a.data(),
            b.data(),
            "finite sample count floors before the integer loop"
        );
    }

    #[test]
    fn sparse_gaussian_and_resize_match_dense_reference_byte_for_byte() {
        let input = image(
            9,
            7,
            &[
                (0, 0, [140, 20, 90, 0]),
                (4, 3, [255, 99, 31, 128]),
                (8, 6, [0, 0, 200, 100]),
            ],
        );
        let isolated = image(9, 7, &[(4, 3, [11, 255, 70, 0])]);
        for input in [&input, &isolated] {
            for output in [
                input.size(),
                Size {
                    width: 4,
                    height: 3,
                },
                Size {
                    width: 13,
                    height: 11,
                },
                Size {
                    width: 1,
                    height: 1,
                },
            ] {
                assert_eq!(
                    resize(input, output).unwrap().data(),
                    dense_resize(input, output).data()
                );
                for axis in [Axis::X, Axis::Y] {
                    for boundary in [
                        Boundary::Normalize,
                        Boundary::Replicate,
                        Boundary::Transparent,
                    ] {
                        for (count, step) in
                            [(0.0, 0.0), (1.0, 0.4), (3.7, 1.25), (5.0, 7.0), (2.0, 0.0)]
                        {
                            for gamma in [None, Some(2.2)] {
                                let config = pass(output, axis, count, step, gamma, boundary);
                                let actual = gaussian(input, config).unwrap();
                                let expected = dense_gaussian(input, config);
                                assert_eq!(
                                    actual.data(),
                                    expected.data(),
                                    "{axis:?} {boundary:?} {count} {step} {gamma:?} {output:?}"
                                );
                            }
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn sparse_support_includes_rgb_when_alpha_is_zero() {
        let input = image(17, 15, &[(8, 7, [1, 0, 0, 0])]);
        assert_eq!(
            input.support(),
            Some(Support {
                left: 8,
                top: 7,
                right: 9,
                bottom: 8
            })
        );
        let config = pass(
            Size {
                width: 31,
                height: 29,
            },
            Axis::Y,
            2.0,
            0.8,
            Some(2.2),
            Boundary::Replicate,
        );
        let expected = dense_gaussian(&input, config);
        let actual = gaussian(&input, config).unwrap();
        assert_eq!(actual.data(), expected.data());
        assert!(
            actual
                .data()
                .chunks_exact(4)
                .any(|p| p[0] != 0 && p[3] == 0)
        );
        let empty = ComponentImage::new(17, 15, vec![0; 17 * 15 * 4]).unwrap();
        let cost = estimate_gaussian_reads(&empty, config).unwrap();
        assert_eq!(cost.texel_reads, 0);
        assert_eq!(cost.support_scan_pixels, 17 * 15);
        assert!(
            gaussian(&empty, config)
                .unwrap()
                .data()
                .iter()
                .all(|value| *value == 0)
        );
    }

    #[test]
    fn sampling_estimates_match_actual_one_two_and_four_texel_fetches() {
        let input = image(8, 6, &[(3, 2, [200, 30, 0, 0]), (4, 3, [0, 80, 200, 180])]);
        for output in [
            input.size(),
            Size {
                width: 4,
                height: 3,
            },
            Size {
                width: 11,
                height: 9,
            },
        ] {
            for step in [0.0, 0.5, 1.0, 1.25, 10.0] {
                for axis in [Axis::X, Axis::Y] {
                    for boundary in [
                        Boundary::Normalize,
                        Boundary::Replicate,
                        Boundary::Transparent,
                    ] {
                        let config = pass(output, axis, 3.0, step, Some(2.2), boundary);
                        FETCH_COUNT.with(|count| count.set(0));
                        gaussian(&input, config).unwrap();
                        let actual = FETCH_COUNT.with(|count| count.get());
                        assert_eq!(
                            estimate_gaussian_reads(&input, config).unwrap().texel_reads,
                            actual
                        );
                    }
                }
            }
            FETCH_COUNT.with(|count| count.set(0));
            resize(&input, output).unwrap();
            assert_eq!(
                estimate_resize_reads(&input, output).unwrap().texel_reads,
                FETCH_COUNT.with(|count| count.get())
            );
        }
    }

    #[test]
    fn rectangular_sampling_estimates_equal_instrumented_texel_fetches() {
        let input = image(8, 6, &[(3, 2, [200, 30, 0, 0]), (4, 3, [0, 80, 200, 180])]);
        for source in [[0, 0, 8, 6], [2, 1, 4, 4], [3, 2, 1, 1]] {
            for destination in [
                [0.0, 0.0, 14.0, 9.0],
                [2.25, -1.375, 10.5, 8.5],
                [-4.5, 3.25, 15.75, 5.125],
                [8.5, 9.5, 0.25, 0.25],
            ] {
                for axis in [Axis::X, Axis::Y] {
                    for count in [0.0, 3.7, 40.0] {
                        for step in [0.0, 0.5, 1.25, 10.0] {
                            for boundary in [
                                Boundary::Normalize,
                                Boundary::Replicate,
                                Boundary::Transparent,
                            ] {
                                let mut config = pass(
                                    Size {
                                        width: 14,
                                        height: 9,
                                    },
                                    axis,
                                    count,
                                    step,
                                    Some(2.2),
                                    boundary,
                                );
                                config.sampling = Some(GaussianSampling {
                                    input: source,
                                    output: destination,
                                });
                                FETCH_COUNT.with(|count| count.set(0));
                                gaussian(&input, config).unwrap();
                                let actual = FETCH_COUNT.with(|count| count.get());
                                let cost = estimate_gaussian_reads(&input, config).unwrap();
                                assert_eq!(
                                    cost.texel_reads, actual,
                                    "{source:?} {destination:?} {axis:?} {count} {step} {boundary:?}"
                                );
                                assert_eq!(cost.output_pixels, 14 * 9);
                                assert_eq!(cost.support_scan_pixels, 8 * 6);
                            }
                        }
                    }
                }
            }
        }
    }

    fn glow_config(input: Size, output: Size, composite: GlowComposite) -> GlowConfig {
        let first = Size {
            width: (input.width / 2).max(1),
            height: (input.height / 2).max(1),
        };
        GlowConfig {
            levels: vec![
                GlowLevel {
                    x: pass(first, Axis::X, 1.0, 0.8, Some(2.2), Boundary::Replicate),
                    y: pass(first, Axis::Y, 1.0, 0.6, Some(2.2), Boundary::Replicate),
                },
                GlowLevel {
                    x: pass(input, Axis::X, 2.0, 1.2, Some(2.2), Boundary::Replicate),
                    y: pass(first, Axis::Y, 2.0, 0.9, Some(2.2), Boundary::Replicate),
                },
            ],
            intensity: 0.2,
            gamma: 2.2,
            original_opacity: 0.7,
            glow_tint: [1.0; 3],
            glow_color_matrix: IDENTITY_GLOW_MATRIX,
            gamma_alpha: false,
            linear: None,
            composite,
            output,
        }
    }
    #[test]
    fn cascade_retains_quantized_levels_and_filters_the_previous_level() {
        let input = image(11, 9, &[(5, 3, [255, 64, 2, 90])]);
        for composite in [GlowComposite::Screen, GlowComposite::SourceOverGlow] {
            let cfg = glow_config(
                input.size(),
                Size {
                    width: 13,
                    height: 11,
                },
                composite,
            );
            FETCH_COUNT.with(|count| count.set(0));
            let actual = cascade_glow(&input, &cfg).unwrap();
            let actual_reads = FETCH_COUNT.with(|count| count.get());
            assert_eq!(actual.levels.len(), 2);
            assert!(actual.levels[0].support().is_some());
            assert!(actual.levels[1].support().is_some());
            assert!(estimate_glow_reads(&input, &cfg).unwrap().texel_reads >= actual_reads);
            let first = dense_gaussian(&dense_gaussian(&input, cfg.levels[0].x), cfg.levels[0].y);
            let second = dense_gaussian(&dense_gaussian(&first, cfg.levels[1].x), cfg.levels[1].y);
            assert_eq!(actual.levels[0].data(), first.data());
            assert_eq!(actual.levels[1].data(), second.data());
            let mut dense_output = ComponentImage::zeroed(cfg.output).unwrap();
            let gain = libm::pow(cfg.intensity * 0.5, 1.0 / cfg.gamma);
            for y in 0..cfg.output.height {
                for x in 0..cfg.output.width {
                    let mut foreground = dense_sample(
                        &input,
                        center(x, input.width(), cfg.output.width),
                        center(y, input.height(), cfg.output.height),
                    );
                    for value in &mut foreground {
                        *value *= cfg.original_opacity;
                    }
                    let mut product = [1.0; 4];
                    for level in [&first, &second] {
                        let value = dense_sample(
                            level,
                            center(x, level.width(), cfg.output.width),
                            center(y, level.height(), cfg.output.height),
                        );
                        for channel in 0..4 {
                            product[channel] *= 1.0 - (value[channel] * gain).clamp(0.0, 1.0);
                        }
                    }
                    let glow = product.map(|value| ((1.0 - value) * gain.max(1.0)).clamp(0.0, 1.0));
                    let color = std::array::from_fn(|channel| match composite {
                        GlowComposite::Screen => {
                            1.0 - (1.0 - glow[channel]) * (1.0 - foreground[channel])
                        }
                        GlowComposite::SourceOverGlow => {
                            foreground[channel] + glow[channel] * (1.0 - foreground[3])
                        }
                        GlowComposite::OriginalOverScreen => unreachable!(),
                    });
                    dense_output.write(x, y, color);
                }
            }
            assert_eq!(actual.image.data(), dense_output.data());
            let independent =
                dense_gaussian(&dense_gaussian(&input, cfg.levels[1].x), cfg.levels[1].y);
            assert_ne!(
                actual.levels[1].data(),
                independent.data(),
                "cascade must not filter the original independently"
            );
            let again = cascade_glow(&input, &cfg).unwrap();
            assert_eq!(actual.image.data(), again.image.data());
            assert!(
                estimate_glow_peak_bytes(input.size(), &cfg).unwrap()
                    >= input.data().len() as u64 + actual.image.data().len() as u64
            );
        }
    }

    #[test]
    fn glow_composite_formulas_preserve_emissive_components_and_zero_intensity() {
        let input = image(1, 1, &[(0, 0, [180, 70, 2, 40])]);
        for composite in [GlowComposite::Screen, GlowComposite::SourceOverGlow] {
            let mut cfg = glow_config(input.size(), input.size(), composite);
            for level in &mut cfg.levels {
                level.x.sample_count = 0.0;
                level.y.sample_count = 0.0;
            }
            cfg.original_opacity = 0.7;
            let actual = cascade_glow(&input, &cfg).unwrap();
            let gain = libm::pow(cfg.intensity * 0.5, 1.0 / cfg.gamma);
            let original = [180.0 / 255.0, 70.0 / 255.0, 2.0 / 255.0, 40.0 / 255.0];
            let expected: [u8; 4] = std::array::from_fn(|channel| {
                let g = 1.0 - libm::pow(1.0 - original[channel] * gain, 2.0);
                let foreground = original[channel] * cfg.original_opacity;
                quantize(match composite {
                    GlowComposite::Screen => 1.0 - (1.0 - g) * (1.0 - foreground),
                    GlowComposite::SourceOverGlow => {
                        foreground + g * (1.0 - original[3] * cfg.original_opacity)
                    }
                    GlowComposite::OriginalOverScreen => unreachable!(),
                })
            });
            assert_eq!(actual.image.data(), &expected);
            assert!(actual.image.data()[0] > actual.image.data()[3]);
            cfg.intensity = 0.0;
            cfg.original_opacity = 1.0;
            assert_eq!(
                cascade_glow(&input, &cfg).unwrap().image.data(),
                input.data()
            );
            cfg.levels.clear();
            assert!(cascade_glow(&input, &cfg).is_err());
        }
    }

    #[test]
    fn linear_glow_folds_decoded_levels_with_gains_color_and_original_over_screen() {
        let input = image(1, 1, &[(0, 0, [180, 70, 2, 40])]);
        let original = [180.0 / 255.0, 70.0 / 255.0, 2.0 / 255.0, 40.0 / 255.0];
        for (gamma_alpha, color, composite) in [
            (false, None, GlowComposite::Screen),
            (true, Some([1.0, 0.84, 0.0, 0.5]), GlowComposite::OriginalOverScreen),
            (true, None, GlowComposite::SourceOverGlow),
            (false, Some([0.2, 0.4, 1.0, 1.0]), GlowComposite::OriginalOverScreen),
        ] {
            let mut cfg = glow_config(input.size(), input.size(), composite);
            for level in &mut cfg.levels {
                level.x.sample_count = 0.0;
                level.y.sample_count = 0.0;
            }
            cfg.intensity = 3.0;
            cfg.gamma_alpha = gamma_alpha;
            cfg.linear = Some(LinearGlow {
                gains: vec![1.0, 1.5],
                color,
            });
            let channels = if gamma_alpha { 4 } else { 3 };
            let level: [f64; 4] = std::array::from_fn(|channel| match color {
                Some(color) if channel < 3 => color[channel] * color[3] * original[3],
                _ => original[channel],
            });
            let o = original.map(|value| value * cfg.original_opacity);
            let expected: [u8; 4] = std::array::from_fn(|channel| {
                let decoded = if channel < channels {
                    libm::pow(level[channel], cfg.gamma)
                } else {
                    level[channel]
                };
                let mut folded = 0.0;
                for gain in [1.0, 1.5] {
                    folded = 1.0 - (1.0 - folded) * (1.0 - gain * decoded);
                }
                let g = if channel < channels {
                    libm::pow(folded * cfg.intensity, 1.0 / cfg.gamma)
                } else {
                    folded * cfg.intensity
                }
                .clamp(0.0, 1.0);
                let screen = 1.0 - (1.0 - g) * (1.0 - o[channel]);
                quantize(match composite {
                    GlowComposite::Screen => screen,
                    GlowComposite::SourceOverGlow => o[channel] + g * (1.0 - o[3]),
                    GlowComposite::OriginalOverScreen => {
                        let kept = if channel == 3 { o[3] * o[3] } else { o[channel] };
                        kept + (1.0 - o[3]) * screen
                    }
                })
            });
            assert_eq!(cascade_glow(&input, &cfg).unwrap().image.data(), &expected);
            cfg.intensity = 0.0;
            cfg.original_opacity = 1.0;
            let unlit = cascade_glow(&input, &cfg).unwrap();
            if composite == GlowComposite::OriginalOverScreen {
                // Zero glow screens the original with itself under partial alpha.
                assert!(unlit.image.data()[0] > input.data()[0]);
            } else {
                assert_eq!(unlit.image.data(), input.data());
            }
        }
    }

    #[test]
    fn rgba_gamma_spreads_alpha_further_and_rgb_gamma_keeps_old_passes() {
        let input = image(8, 1, &[(4, 0, [255, 255, 255, 255])]);
        let blur = pass(input.size(), Axis::X, 1.0, 1.0, Some(2.2), Boundary::Normalize);
        let rgb = gaussian_channels(&input, blur, 3).unwrap();
        let rgba = gaussian_channels(&input, blur, 4).unwrap();
        assert_eq!(rgb.data(), gaussian(&input, blur).unwrap().data());
        assert!(rgba.data()[3 * 4 + 3] > rgb.data()[3 * 4 + 3]);
        assert!(rgb.data()[3 * 4 + 3] > 0);
        assert_eq!(rgba.data()[3 * 4], rgba.data()[3 * 4 + 3]);
    }

    #[test]
    fn linear_glow_validation_and_gpu_scope() {
        let size = Size {
            width: 4,
            height: 4,
        };
        let mut cfg = glow_config(size, size, GlowComposite::Screen);
        assert!(cfg.gpu_supported());
        cfg.composite = GlowComposite::OriginalOverScreen;
        cfg.validate().unwrap();
        assert!(!cfg.gpu_supported());
        cfg.composite = GlowComposite::Screen;
        cfg.gamma_alpha = true;
        assert!(!cfg.gpu_supported());
        cfg.gamma_alpha = false;
        cfg.linear = Some(LinearGlow {
            gains: vec![0.0, 2.0],
            color: Some([1.0, 0.0, 0.5, 0.25]),
        });
        cfg.validate().unwrap();
        assert!(!cfg.gpu_supported());
        for (gains, color) in [
            (vec![1.0], None),
            (vec![1.0, 2.1], None),
            (vec![1.0, -0.1], None),
            (vec![1.0, f64::NAN], None),
            (vec![1.0, 1.0], Some([1.0, 1.0, 1.0, 1.5])),
            (vec![1.0, 1.0], Some([f64::NAN, 1.0, 1.0, 1.0])),
        ] {
            cfg.linear = Some(LinearGlow { gains, color });
            assert!(cfg.validate().is_err());
        }
        cfg.linear = None;
        let level = cfg.levels[0];
        cfg.levels = vec![level; 8];
        cfg.validate().unwrap();
        assert!(!cfg.gpu_supported());
        cfg.levels = vec![level; 9];
        assert!(cfg.validate().is_err());
    }

    #[test]
    fn glow_tint_matches_dense_reference_after_aggregation_without_coloring_original_or_alpha() {
        let input = image(
            9,
            7,
            &[
                (2, 2, [255, 255, 255, 200]),
                (3, 2, [255, 255, 255, 200]),
                (4, 3, [30, 90, 160, 255]),
                (6, 4, [180, 70, 2, 0]),
            ],
        );
        for composite in [GlowComposite::Screen, GlowComposite::SourceOverGlow] {
            for intensity in [0.2, 8.0] {
                let mut cfg = glow_config(input.size(), input.size(), composite);
                cfg.intensity = intensity;
                let baseline = cascade_glow(&input, &cfg).unwrap();
                // This independent dense filter path computes its own levels;
                // tint is applied to the completed emission, never its inputs.
                let first =
                    dense_gaussian(&dense_gaussian(&input, cfg.levels[0].x), cfg.levels[0].y);
                let second =
                    dense_gaussian(&dense_gaussian(&first, cfg.levels[1].x), cfg.levels[1].y);
                let gain = libm::pow(intensity * 0.5, 1.0 / cfg.gamma);
                for tint in [[1.0; 3], [0.0, 0.25, 0.75], [0.0; 3]] {
                    cfg.glow_tint = tint;
                    let actual = cascade_glow(&input, &cfg).unwrap();
                    assert_eq!(actual.levels[0].data(), first.data());
                    assert_eq!(actual.levels[1].data(), second.data());
                    let mut expected = ComponentImage::zeroed(cfg.output).unwrap();
                    for y in 0..cfg.output.height {
                        for x in 0..cfg.output.width {
                            let original = dense_sample(&input, x as f64, y as f64);
                            let layers = [&first, &second].map(|level| {
                                dense_sample(
                                    level,
                                    (x as f64 + 0.5) * level.width() as f64
                                        / cfg.output.width as f64
                                        - 0.5,
                                    (y as f64 + 0.5) * level.height() as f64
                                        / cfg.output.height as f64
                                        - 0.5,
                                )
                            });
                            let color = std::array::from_fn(|channel| {
                                let combined = 1.0
                                    - (1.0 - (layers[0][channel] * gain).clamp(0.0, 1.0))
                                        * (1.0 - (layers[1][channel] * gain).clamp(0.0, 1.0));
                                let emission = (combined * gain.max(1.0)).clamp(0.0, 1.0)
                                    * if channel < 3 { tint[channel] } else { 1.0 };
                                let original_channel = original[channel] * cfg.original_opacity;
                                match composite {
                                    GlowComposite::Screen => {
                                        1.0 - (1.0 - emission) * (1.0 - original_channel)
                                    }
                                    GlowComposite::SourceOverGlow => {
                                        original_channel
                                            + emission * (1.0 - original[3] * cfg.original_opacity)
                                    }
                                    GlowComposite::OriginalOverScreen => unreachable!(),
                                }
                            });
                            expected.write(x, y, color);
                        }
                    }
                    assert_eq!(actual.image.data(), expected.data());
                    for (colored, white) in actual
                        .image
                        .data()
                        .chunks_exact(4)
                        .zip(baseline.image.data().chunks_exact(4))
                    {
                        assert_eq!(colored[3], white[3], "tint never changes alpha");
                    }
                    if tint == [1.0; 3] {
                        assert_eq!(
                            actual.image.data(),
                            baseline.image.data(),
                            "white is byte-identical"
                        );
                    }
                    if tint == [0.0; 3] {
                        for (colored, original) in actual
                            .image
                            .data()
                            .chunks_exact(4)
                            .zip(input.data().chunks_exact(4))
                        {
                            for channel in 0..3 {
                                assert_eq!(
                                    colored[channel],
                                    quantize(
                                        original[channel] as f64 / 255.0 * cfg.original_opacity
                                    ),
                                    "black glow tint retains original RGB"
                                );
                            }
                        }
                    }
                }
                cfg.glow_tint = [f64::NAN, 1.0, 1.0];
                assert!(cascade_glow(&input, &cfg).is_err());
                cfg.glow_tint = [1.01, 1.0, 1.0];
                assert!(estimate_glow_reads(&input, &cfg).is_err());
            }
        }
    }

    #[test]
    fn glow_matrix_matches_independent_rgb_reference_after_tint_and_preserves_alpha() {
        let input = image(
            3,
            2,
            &[
                (0, 0, [255, 255, 255, 96]),
                (1, 0, [12, 210, 45, 255]),
                (2, 0, [180, 60, 240, 0]),
                (0, 1, [0, 255, 0, 40]),
                (1, 1, [70, 10, 200, 90]),
                (2, 1, [170, 140, 15, 150]),
            ],
        );
        let swap = [0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
        let selective = [
            1.0, 0.0, 0.0, -0.104270, 1.148957, -0.044687, -0.104270, -0.351043, 1.455313,
        ];
        for composite in [GlowComposite::Screen, GlowComposite::SourceOverGlow] {
            for intensity in [0.2, 8.0] {
                let mut cfg = glow_config(input.size(), input.size(), composite);
                cfg.intensity = intensity;
                for level in &mut cfg.levels {
                    level.x.output = input.size();
                    level.y.output = input.size();
                    level.x.sample_count = 0.0;
                    level.y.sample_count = 0.0;
                }
                cfg.glow_tint = [0.4, 0.7, 0.2];
                let baseline = cascade_glow(&input, &cfg).unwrap();
                let gain = libm::pow(intensity * 0.5, 1.0 / cfg.gamma);
                for matrix in [IDENTITY_GLOW_MATRIX, swap, selective, [0.0; 9]] {
                    cfg.glow_color_matrix = matrix;
                    let actual = cascade_glow(&input, &cfg).unwrap();
                    let mut expected = Vec::new();
                    for source in input.data().chunks_exact(4) {
                        let original: [f64; 4] = std::array::from_fn(|i| source[i] as f64 / 255.0);
                        let aggregated = original.map(|v| {
                            let level = (v * gain).clamp(0.0, 1.0);
                            ((1.0 - (1.0 - level) * (1.0 - level)) * gain.max(1.0)).clamp(0.0, 1.0)
                        });
                        let rgb: [f64; 3] =
                            std::array::from_fn(|i| aggregated[i] * cfg.glow_tint[i]);
                        // Independent reference formulas: channel permutation and
                        // selective G/B luminance adjustment, not the matrix loop.
                        let transformed = if matrix == IDENTITY_GLOW_MATRIX {
                            rgb
                        } else if matrix == swap {
                            [rgb[2], rgb[0], rgb[1]]
                        } else if matrix == [0.0; 9] {
                            [0.0; 3]
                        } else {
                            let luminance =
                                0.208540 * rgb[0] + 0.702086 * rgb[1] + 0.089374 * rgb[2];
                            [
                                rgb[0],
                                (1.5 * rgb[1] - 0.5 * luminance).clamp(0.0, 1.0),
                                (1.5 * rgb[2] - 0.5 * luminance).clamp(0.0, 1.0),
                            ]
                        };
                        for channel in 0..4 {
                            let g = if channel < 3 {
                                transformed[channel]
                            } else {
                                aggregated[3]
                            };
                            let o = original[channel] * cfg.original_opacity;
                            expected.push(quantize(match composite {
                                GlowComposite::Screen => 1.0 - (1.0 - g) * (1.0 - o),
                                GlowComposite::SourceOverGlow => {
                                    o + g * (1.0 - original[3] * cfg.original_opacity)
                                }
                                GlowComposite::OriginalOverScreen => unreachable!(),
                            }));
                        }
                    }
                    assert_eq!(actual.image.data(), expected.as_slice());
                    for (current, original) in actual
                        .image
                        .data()
                        .chunks_exact(4)
                        .zip(baseline.image.data().chunks_exact(4))
                    {
                        assert_eq!(current[3], original[3]);
                    }
                    if matrix == IDENTITY_GLOW_MATRIX {
                        assert_eq!(actual.image.data(), baseline.image.data());
                    }
                    assert_eq!(
                        actual.levels[0].data(),
                        input.data(),
                        "matrix never colors source levels"
                    );
                }
                cfg.intensity = 8.0;
                cfg.glow_tint = [1.0; 3];
                cfg.glow_color_matrix = [f64::MAX; 9];
                assert!(
                    cascade_glow(&input, &cfg)
                        .unwrap_err()
                        .to_string()
                        .contains("CAPTION_MATERIAL_INVALID")
                );
                cfg.glow_color_matrix = [f64::NAN; 9];
                assert!(estimate_glow_reads(&input, &cfg).is_err());
            }
        }
    }

    #[test]
    fn sparse_text_sized_work_stays_bounded_without_changing_pass_resolution() {
        for size in [
            Size {
                width: 720,
                height: 1280,
            },
            Size {
                width: 1080,
                height: 1920,
            },
        ] {
            let mut input = ComponentImage::zeroed(size).unwrap();
            for y in size.height * 11 / 24..size.height * 13 / 24 {
                for x in size.width / 8..size.width * 7 / 8 {
                    input.write(x, y, [0.5, 0.25, 0.1, 0.2]);
                }
            }
            let base = f64::from(size.width.min(size.height))
                .max(f64::from(size.width.max(size.height)) / 2.0);
            let initial = GaussianPass {
                sampling: None,
                spacing_ramp: None,
                axis: Axis::X,
                sample_count: 30.0,
                step_pixels: base / 1000.0,
                sigma_pixels: 30.0 * base / 1000.0 / 2.5,
                gamma: Some(2.2),
                boundary: Boundary::Normalize,
                output: size,
            };
            let initial_cost = estimate_gaussian_reads(&input, initial).unwrap();
            let half = Size {
                width: size.width / 2,
                height: size.height / 2,
            };
            let down: [f64; 7] = [1.0, 1.0, 1.0, 1.25, 2.5, 5.0, 10.0];
            let count = [0.625, 1.25, 2.5, 4.0, 4.0, 4.0, 4.0];
            let mut previous = size;
            let mut levels = Vec::new();
            for i in 0..7 {
                let x_step =
                    down[i] * base / f64::from(size.width) / 720.0 * f64::from(previous.width);
                let y_step =
                    down[i] * base / f64::from(size.height) / 720.0 * f64::from(half.height);
                levels.push(GlowLevel {
                    x: GaussianPass {
                        sampling: None,
                        spacing_ramp: None,
                        axis: Axis::X,
                        sample_count: count[i],
                        step_pixels: x_step,
                        sigma_pixels: x_step * count[i] / 2.5,
                        gamma: Some(2.2),
                        boundary: Boundary::Replicate,
                        output: half,
                    },
                    y: GaussianPass {
                        sampling: None,
                        spacing_ramp: None,
                        axis: Axis::Y,
                        sample_count: count[i],
                        step_pixels: y_step,
                        sigma_pixels: y_step * count[i] / 2.5,
                        gamma: Some(2.2),
                        boundary: Boundary::Replicate,
                        output: half,
                    },
                });
                previous = half;
            }
            // Preflight chaining uses conservative support, without executing
            // a large render in this budget test or dropping quantized halos.
            let supported =
                gaussian_support(input.support, size, initial, initial.validate().unwrap());
            let mut proxy = input.copied();
            proxy.support = supported;
            let cfg = GlowConfig {
                levels,
                intensity: 0.05,
                gamma: 2.2,
                original_opacity: 1.0,
                glow_tint: [1.0; 3],
                glow_color_matrix: IDENTITY_GLOW_MATRIX,
                gamma_alpha: false,
                linear: None,
                composite: GlowComposite::Screen,
                output: size,
            };
            let glow_cost = estimate_glow_reads(&proxy, &cfg).unwrap();
            let reads = initial_cost.texel_reads + glow_cost.texel_reads + size.pixels().unwrap();
            let writes = initial_cost.output_pixels + glow_cost.output_pixels;
            assert!(reads + writes < 256 * 1024 * 1024);
            eprintln!(
                "component filter budget {}x{}: Gaussian={} glow={} initial-scan={} total={}",
                size.width,
                size.height,
                initial_cost.texel_reads,
                glow_cost.texel_reads,
                size.pixels().unwrap(),
                reads
            );
            assert!(reads < 256 * 1024 * 1024);
        }
    }
}
