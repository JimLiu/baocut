//! 抠像：把一帧的主体分割成 alpha（显著性分割，不用绿幕）。权重是 rembg 发布的 ONNX（U²-Net、IS-Net，Apache-2.0），前后处理与
//! rembg（MIT）的 `session.predict` 相同：帧缩到模型的正方形输入，按 `像素 / 255`、减均值、除方差，取第一个输出的第一个通道，
//! 再放大回帧的尺寸。不同之处：
//!
//! - rembg 逐帧做最小最大归一化。主体占满画面的帧（IS-Net 上最大值可能只有 0.2）确实要它，但没有主体的帧也会被拉满，成了假的主体：
//!   纯色、渐变与空镜的最大值实测都不到 0.05，所以最大值低于 `MIN_SUBJECT_PEAK` 时算没有主体，不拉伸。
//! - 视频逐帧分割的 alpha 会闪烁：`temporal` 把这一帧和上一帧在模型分辨率上混合，只混变化小的像素（变化大的是主体真的动了，
//!   照旧跟上，不留拖影）。

use std::io::BufWriter;
use std::path::Path;

use anyhow::{Context, Result, ensure};
use image::codecs::png::{CompressionType, FilterType as PngFilter, PngEncoder};
use image::imageops::FilterType;
use image::{ExtendedColorType, GrayImage, ImageEncoder, RgbImage};
use tract_onnx::prelude::*;

/// 模型输出的最大值低于它时算这一帧没有主体（全透明）。
const MIN_SUBJECT_PEAK: f32 = 0.1;
/// 上一帧与这一帧相差超过它的像素不混合（模型输出 0–1）。
const TEMPORAL_MOTION_LIMIT: f32 = 0.25;
/// alpha 超过它的像素算主体（`coverage`）。
const SUBJECT_ALPHA: u8 = 128;

/// 模型的输入：正方形边长与归一化参数，随权重不同（见 Runtime 的 `FOOTAGE_MATTE_MODELS`）。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MatteOptions {
    pub side: usize,
    pub mean: [f32; 3],
    pub std: [f32; 3],
}

/// 一帧抠完的结果。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MatteOutcome {
    pub width: u32,
    pub height: u32,
    /// alpha 过半的像素占整帧的比例：接近 0 是这一帧没有认出主体。
    pub coverage: f64,
}

type Plan = Arc<TypedRunnableModel>;

/// 载入好的模型：一次载入，逐帧调用；`previous` 是上一帧在模型分辨率上的输出。
pub struct Matte {
    plan: Plan,
    options: MatteOptions,
    previous: Option<Vec<f32>>,
}

impl Matte {
    pub fn load(model: &Path, options: MatteOptions) -> TractResult<Self> {
        let side = options.side;
        let plan = tract_onnx::onnx()
            .model_for_path(model)?
            .with_input_fact(0, f32::fact([1, 3, side, side]).into())?
            .into_optimized()?
            .into_runnable()?;
        Ok(Self {
            plan,
            options,
            previous: None,
        })
    }

    /// 从 `input` 读一帧，把带 alpha 的结果写成 `output`（RGBA PNG，RGB 不动）。`temporal` 是和上一帧混合的比例（0 不混合），
    /// `reset` 丢掉上一帧（新的一段素材从这里开始）。
    pub fn matte_file(&mut self, input: &Path, output: &Path, temporal: f32, reset: bool) -> Result<MatteOutcome> {
        let frame = image::open(input)
            .with_context(|| format!("cannot read {}", input.display()))?
            .to_rgb8();
        if reset {
            self.previous = None;
        }
        let alpha = self.alpha(&frame, temporal)?;
        let outcome = MatteOutcome {
            width: frame.width(),
            height: frame.height(),
            coverage: coverage(&alpha),
        };
        write_rgba(&frame, &alpha, output)?;
        Ok(outcome)
    }

    /// 这一帧的 alpha，尺寸与帧相同。
    pub fn alpha(&mut self, frame: &RgbImage, temporal: f32) -> Result<GrayImage> {
        let side = self.options.side;
        let tensor = input_tensor(frame, &self.options);
        let outputs = self.plan.run(tvec!(tensor.into()))?;
        let view = outputs[0].to_plain_array_view::<f32>()?;
        let shape = view.shape();
        ensure!(
            shape.len() >= 2 && shape[shape.len() - 1] == side && shape[shape.len() - 2] == side,
            "unexpected model output shape {shape:?}"
        );
        // 多通道的输出取第一个通道：NCHW 排列时前 side² 个值就是它。
        let mut prediction: Vec<f32> = view.iter().take(side * side).copied().collect();
        stretch_to_full_range(&mut prediction);
        if let Some(previous) = self.previous.as_deref() {
            smooth_against(&mut prediction, previous, temporal);
        }
        let small = GrayImage::from_fn(side as u32, side as u32, |x, y| {
            image::Luma([(prediction[y as usize * side + x as usize] * 255.0).round() as u8])
        });
        self.previous = Some(prediction);
        Ok(image::imageops::resize(
            &small,
            frame.width(),
            frame.height(),
            FilterType::CatmullRom,
        ))
    }
}

/// 帧缩到模型的输入并归一化：`[1, 3, side, side]`。
fn input_tensor(frame: &RgbImage, options: &MatteOptions) -> Tensor {
    let side = options.side;
    let scaled = image::imageops::resize(frame, side as u32, side as u32, FilterType::Triangle);
    tract_ndarray::Array4::from_shape_fn((1, 3, side, side), |(_, channel, y, x)| {
        normalized(scaled.get_pixel(x as u32, y as u32)[channel], channel, options)
    })
    .into()
}

fn normalized(value: u8, channel: usize, options: &MatteOptions) -> f32 {
    (f32::from(value) / 255.0 - options.mean[channel]) / options.std[channel]
}

/// 拉到 0–1（最小最大归一化）；最大值太低时算没有主体，全部清零。
fn stretch_to_full_range(prediction: &mut [f32]) {
    let (low, high) = prediction
        .iter()
        .fold((f32::MAX, f32::MIN), |(low, high), &value| (low.min(value), high.max(value)));
    if high < MIN_SUBJECT_PEAK || high <= low {
        prediction.fill(0.0);
        return;
    }
    for value in prediction.iter_mut() {
        *value = ((*value - low) / (high - low)).clamp(0.0, 1.0);
    }
}

/// 和上一帧混合：相差不超过 `TEMPORAL_MOTION_LIMIT` 的像素按 `temporal` 混上一帧，其余保留这一帧。
fn smooth_against(prediction: &mut [f32], previous: &[f32], temporal: f32) {
    if temporal <= 0.0 || prediction.len() != previous.len() {
        return;
    }
    let keep = temporal.min(0.95);
    for (now, before) in prediction.iter_mut().zip(previous) {
        if (*now - *before).abs() <= TEMPORAL_MOTION_LIMIT {
            *now = *now * (1.0 - keep) + *before * keep;
        }
    }
}

fn coverage(alpha: &GrayImage) -> f64 {
    let total = u64::from(alpha.width()) * u64::from(alpha.height());
    if total == 0 {
        return 0.0;
    }
    let subject = alpha.pixels().filter(|pixel| pixel[0] >= SUBJECT_ALPHA).count() as f64;
    subject / total as f64
}

/// RGB 不动、alpha 换成抠出来的，写成 PNG（快速压缩：它是流水线的中间文件，读完就删）。
fn write_rgba(frame: &RgbImage, alpha: &GrayImage, output: &Path) -> Result<()> {
    ensure!(frame.dimensions() == alpha.dimensions(), "frame and alpha sizes differ");
    let mut rgba = Vec::with_capacity(frame.len() / 3 * 4);
    for (pixel, mask) in frame.pixels().zip(alpha.pixels()) {
        rgba.extend_from_slice(&[pixel[0], pixel[1], pixel[2], mask[0]]);
    }
    let file = std::fs::File::create(output).with_context(|| format!("cannot write {}", output.display()))?;
    PngEncoder::new_with_quality(BufWriter::new(file), CompressionType::Fast, PngFilter::Adaptive)
        .write_image(&rgba, frame.width(), frame.height(), ExtendedColorType::Rgba8)
        .with_context(|| format!("cannot encode {}", output.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    const U2NET: MatteOptions = MatteOptions {
        side: 320,
        mean: [0.485, 0.456, 0.406],
        std: [0.229, 0.224, 0.225],
    };

    #[test]
    fn normalization_matches_the_published_preprocessing() {
        // 像素 / 255，减均值，除方差。
        assert!((normalized(255, 0, &U2NET) - (1.0 - 0.485) / 0.229).abs() < 1e-5);
        assert!((normalized(0, 2, &U2NET) - (0.0 - 0.406) / 0.225).abs() < 1e-5);
    }

    #[test]
    fn input_tensor_is_nchw_of_the_model_side() {
        let frame = RgbImage::from_pixel(64, 32, image::Rgb([255, 0, 0]));
        let tensor = input_tensor(&frame, &MatteOptions { side: 16, ..U2NET });
        assert_eq!(tensor.shape(), &[1, 3, 16, 16]);
        let view = tensor.to_plain_array_view::<f32>().unwrap();
        assert!((view[[0, 0, 8, 8]] - (1.0 - 0.485) / 0.229).abs() < 1e-5, "红色通道");
        assert!((view[[0, 1, 8, 8]] - (0.0 - 0.456) / 0.224).abs() < 1e-5, "绿色通道");
    }

    #[test]
    fn stretches_a_weak_subject_to_full_range() {
        let mut prediction = vec![0.0, 0.1, 0.2];
        stretch_to_full_range(&mut prediction);
        assert_eq!(prediction, vec![0.0, 0.5, 1.0]);
    }

    #[test]
    fn a_frame_without_a_subject_stays_transparent() {
        // 纯色、渐变与空镜：最大值实测不到 0.05，拉伸之后会变成假的主体。
        let mut prediction = vec![0.0, 0.02, 0.046];
        stretch_to_full_range(&mut prediction);
        assert_eq!(prediction, vec![0.0, 0.0, 0.0]);
    }

    #[test]
    fn temporal_smoothing_only_touches_small_changes() {
        let mut now = vec![0.5, 1.0, 0.0];
        smooth_against(&mut now, &[0.4, 0.0, 0.1], 0.5);
        assert!((now[0] - 0.45).abs() < 1e-6, "变化小：混合");
        assert_eq!(now[1], 1.0, "变化大：主体动了，不留拖影");
        assert!((now[2] - 0.05).abs() < 1e-6, "变化小：混合");
    }

    #[test]
    fn temporal_zero_keeps_the_frame() {
        let mut now = vec![0.5, 0.6];
        smooth_against(&mut now, &[0.4, 0.5], 0.0);
        assert_eq!(now, vec![0.5, 0.6]);
    }

    #[test]
    fn coverage_counts_pixels_past_half_alpha() {
        let mut alpha = GrayImage::new(2, 2);
        alpha.put_pixel(0, 0, image::Luma([255]));
        alpha.put_pixel(1, 1, image::Luma([128]));
        alpha.put_pixel(1, 0, image::Luma([127]));
        assert!((coverage(&alpha) - 0.5).abs() < 1e-9);
    }

    #[test]
    fn writes_straight_alpha_without_touching_rgb() {
        let dir = std::env::temp_dir().join(format!("baocut-matte-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let out = dir.join("out.png");
        let frame = RgbImage::from_pixel(2, 1, image::Rgb([10, 20, 30]));
        let mut alpha = GrayImage::new(2, 1);
        alpha.put_pixel(1, 0, image::Luma([200]));
        write_rgba(&frame, &alpha, &out).unwrap();
        let back = image::open(&out).unwrap().to_rgba8();
        assert_eq!(back.get_pixel(0, 0).0, [10, 20, 30, 0]);
        assert_eq!(back.get_pixel(1, 0).0, [10, 20, 30, 200]);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
