//! Strict CPU reference 效果实现（ADR-M05 / 设计 §6.3）。
//!
//! 分工：**manifest 住在 `bcut-motion`**（纯函数层，`bcut-core::lint` 与
//! `bcut-timeline` 都要读效果版本表而不能依赖 host 层），`bcut-render` 只持有
//! 像素实现。两边靠 manifest 的**具名内核** `kernel` 对接：
//! [`kernel_is_implemented`] 保证每个 strict manifest 都有 CPU reference——
//! 这条不变量由 `tests/effects_conformance.rs` 逐条守。

pub mod composite;
pub mod filters;
pub mod pixel_format;
pub mod transitions;

pub use composite::blend::blend_to_skia;
pub use filters::blur::{
    ContentBox, MAX_BLUR_RADIUS, alpha_bbox, alpha_bbox_within, box_blur_bounded, box_blur_content,
    box_blur_premul_u8, clear_content_box,
};
pub use filters::composite_premul::composite_premultiplied_rgba;
pub use filters::mask_image::MaskChannel;
pub use filters::mask_shape::{multiply_pixel_coverage, multiply_premultiplied_alpha};
pub use pixel_format::{
    premultiplied_rgba_to_straight_bgra, visible_premultiplied_rgba_to_straight_bgra,
};
pub use transitions::Direction;

/// 效果词汇的转出口：host 侧（`apps/cli`）只依赖 `bcut-render`，不必为了两个
/// 值类型再连一条 `bcut-motion` 的边。
pub use motion::effect::{EffectRef, UniformMap, UniformValue};

use anyhow::{Result, anyhow, bail};
use motion::effect::lookup;
use tiny_skia::Pixmap;

/// 已实现的内核名。加一个 strict manifest 就必须在这里加一条实现。
pub const IMPLEMENTED_KERNELS: &[&str] = &[
    "box-1pass-integer",
    "brightness-unpremul-f64",
    "contrast-unpremul-f64",
    "saturation-rec709-f64",
    "grayscale-rec709-f64",
    "sepia-matrix-f64",
    "hue-rotate-matrix-f64",
    "color-adjust-grayscale-brightness-f64",
    "invert-unpremul-f64",
    "sharpen-cross-premul-u8",
    "rgb-split-premul-u8",
    "directional-17tap-premul-u8",
    "alpha-outline-square-premul-u8",
    "noise-coordinate-hash-premul-u8",
    "vignette-radial-premul-u8",
    "shadow-blur-composite-premul",
    "chroma-key-euclidean-f64",
    "alpha-threshold-smoothstep",
    "bloom-pyramid-premul-f32",
    "grade-lgg-unpremul-f64",
    "radial-zoom-3pass-premul-f32",
    "god-rays-halfres-zoom-premul-f32",
    "sdf-rounded-rect-ellipse",
    "linear-reveal-coverage",
    "alpha-mask-from-pixmap",
    "luma-mask-from-pixmap",
    "porter-duff-separable",
    "crossfade-lerp-premul-u8",
    "slide-shift-copy",
    "wipe-linear-coverage",
    "circle-crop-sdf-coverage",
    "ink-blot-noise-coverage",
    "shatter-logpolar-voronoi-premul-u8",
    "glitch-band-shift-premul-u8",
];

pub fn kernel_is_implemented(kernel: &str) -> bool {
    IMPLEMENTED_KERNELS.contains(&kernel)
}

/// 执行一条单输入滤镜。`uniforms` 必须已经过
/// [`motion::effect::EffectManifest::resolve_uniforms`]（补默认、夹范围）。
///
/// 双输入的 `mask.image` / `mask.luma` 不走这里——它们需要第二张 surface，
/// 由 `Composite` pass 的 mask 输入提供（阶段 4B）。
pub fn apply_filter(
    effect: &EffectRef,
    uniforms: &UniformMap,
    input: &Pixmap,
    canvas_short_edge: f64,
) -> Result<Pixmap> {
    let mut out = input.clone();
    apply_filter_in_place(effect, uniforms, &mut out, canvas_short_edge)?;
    Ok(out)
}

/// [`apply_filter`] 的原地形态。效果栈是一串就地变换，串起来时不该每一步都
/// 复制一张 4K 缓冲。
pub fn apply_filter_in_place(
    effect: &EffectRef,
    uniforms: &UniformMap,
    pixmap: &mut Pixmap,
    canvas_short_edge: f64,
) -> Result<()> {
    let manifest = lookup(&effect.id, effect.version).map_err(|error| anyhow!("{error}"))?;
    if manifest.inputs != 1 {
        bail!(
            "effect-input-mismatch: {} 需要 {} 个输入，Filter pass 只提供 1 个",
            manifest.qualified(),
            manifest.inputs
        );
    }
    let uniforms = manifest
        .resolve_uniforms(uniforms)
        .map_err(|error| anyhow!("{error}"))?;
    let width = pixmap.width();
    let height = pixmap.height();
    let data = pixmap.data_mut();
    // `length` 参数以画布短边为基准换算，`quantize: round-to-int` 再取整。
    let length = |key: &str| -> f64 {
        let raw = uniforms.scalar(key).unwrap_or(0.0);
        match manifest
            .params
            .get(key)
            .and_then(|spec| spec.basis.as_deref())
        {
            Some("canvasShortEdge") => raw * canvas_short_edge,
            _ => raw,
        }
    };
    let rounded = |key: &str| -> f64 {
        let value = length(key);
        match manifest
            .params
            .get(key)
            .and_then(|spec| spec.quantize.as_deref())
        {
            Some("round-to-int") => value.round(),
            _ => value,
        }
    };
    let color = |key: &str| -> [f64; 4] {
        match uniforms.get(key) {
            Some(UniformValue::Color(rgba)) => *rgba,
            _ => [0.0, 0.0, 0.0, 1.0],
        }
    };

    match manifest.kernel.as_str() {
        "rgb-split-premul-u8" => filters::studio::rgb_split(
            data,
            width as usize,
            height as usize,
            rounded("distance"),
            uniforms.scalar("angle").unwrap_or(0.0),
        ),
        "directional-17tap-premul-u8" => filters::studio::directional_blur(
            data,
            width as usize,
            height as usize,
            rounded("distance"),
            uniforms.scalar("angle").unwrap_or(0.0),
        ),
        "alpha-outline-square-premul-u8" => filters::studio::outline(
            data,
            width as usize,
            height as usize,
            rounded("radius") as usize,
            color("color"),
        ),
        "box-1pass-integer" => {
            // 走**包围盒**版本：它与整幅版本逐字节相同（证明见 `blur.rs` 的
            // 注释），但透明区大的 overlay 帧上能省掉整幅两遍扫描。
            filters::blur::box_blur_content(
                data,
                width,
                height,
                rounded("radius").max(0.0) as usize,
            );
        }
        "brightness-unpremul-f64" => {
            filters::color_adjust::brightness_only(data, uniforms.scalar("amount").unwrap_or(0.0));
        }
        "contrast-unpremul-f64" => {
            filters::color_adjust::contrast(data, uniforms.scalar("amount").unwrap_or(0.0));
        }
        "saturation-rec709-f64" => {
            filters::color_adjust::saturation(data, uniforms.scalar("amount").unwrap_or(1.0));
        }
        "grayscale-rec709-f64" => {
            filters::color_adjust::grayscale(data, uniforms.scalar("amount").unwrap_or(1.0));
        }
        "sepia-matrix-f64" => {
            filters::color_adjust::sepia(data, uniforms.scalar("amount").unwrap_or(1.0));
        }
        "hue-rotate-matrix-f64" => {
            filters::color_adjust::hue_rotate(data, uniforms.scalar("degrees").unwrap_or(0.0));
        }
        "color-adjust-grayscale-brightness-f64" => {
            filters::color_adjust::color_adjust(
                data,
                uniforms.scalar("grayscale").unwrap_or(0.0),
                uniforms.scalar("brightness").unwrap_or(0.0),
            );
        }
        "invert-unpremul-f64" => {
            filters::color_adjust::invert(data, uniforms.scalar("amount").unwrap_or(0.0));
        }
        "sharpen-cross-premul-u8" => {
            filters::stylize::sharpen(
                data,
                width,
                height,
                uniforms.scalar("amount").unwrap_or(0.0),
            );
        }
        "noise-coordinate-hash-premul-u8" => {
            filters::stylize::noise(
                data,
                width,
                height,
                uniforms.scalar("amount").unwrap_or(0.0),
            );
        }
        "vignette-radial-premul-u8" => {
            filters::stylize::vignette(
                data,
                width,
                height,
                uniforms.scalar("amount").unwrap_or(0.0),
            );
        }
        "shadow-blur-composite-premul" => {
            filters::drop_shadow::drop_shadow(
                data,
                width,
                height,
                rounded("radius").max(0.0) as usize,
                rounded("dx") as i32,
                rounded("dy") as i32,
                color("color"),
            );
        }
        "chroma-key-euclidean-f64" => {
            filters::chroma_key::chroma_key(
                data,
                color("color"),
                uniforms.scalar("similarity").unwrap_or(0.4),
                uniforms.scalar("smoothness").unwrap_or(0.1),
            );
        }
        "alpha-threshold-smoothstep" => {
            filters::alpha_threshold::alpha_threshold(
                data,
                uniforms.scalar("threshold").unwrap_or(0.5),
                uniforms.scalar("softness").unwrap_or(0.0),
            );
        }
        "bloom-pyramid-premul-f32" => {
            filters::bloom::bloom(
                data,
                width as usize,
                height as usize,
                uniforms.scalar("threshold").unwrap_or(0.8),
                uniforms.scalar("knee").unwrap_or(0.25),
                length("radius").max(0.0),
                uniforms.scalar("intensity").unwrap_or(1.0),
            );
        }
        "grade-lgg-unpremul-f64" => {
            filters::grade::grade(
                data,
                filters::grade::Grade {
                    lift: uniforms.scalar("lift").unwrap_or(0.0),
                    gamma: uniforms.scalar("gamma").unwrap_or(1.0),
                    gain: uniforms.scalar("gain").unwrap_or(1.0),
                    saturation: uniforms.scalar("saturation").unwrap_or(1.0),
                    tint: uniforms.scalar("tint").unwrap_or(0.0),
                    shoulder: uniforms.scalar("shoulder").unwrap_or(0.0),
                },
            );
        }
        "radial-zoom-3pass-premul-f32" => {
            filters::radial_blur::radial_blur(
                data,
                width as usize,
                height as usize,
                uniforms.scalar("cx").unwrap_or(0.5),
                uniforms.scalar("cy").unwrap_or(0.5),
                uniforms.scalar("strength").unwrap_or(0.0),
                uniforms.scalar("samples").unwrap_or(8.0),
            );
        }
        "god-rays-halfres-zoom-premul-f32" => {
            let tint = match uniforms.get("tint") {
                Some(UniformValue::Color(rgba)) => *rgba,
                _ => [1.0; 4],
            };
            filters::god_rays::god_rays(
                data,
                width as usize,
                height as usize,
                &filters::god_rays::GodRays {
                    cx: uniforms.scalar("cx").unwrap_or(0.5),
                    cy: uniforms.scalar("cy").unwrap_or(0.0),
                    threshold: uniforms.scalar("threshold").unwrap_or(0.6),
                    length: uniforms.scalar("length").unwrap_or(0.0),
                    intensity: uniforms.scalar("intensity").unwrap_or(0.0),
                    decay: uniforms.scalar("decay").unwrap_or(0.0),
                    tint,
                },
            );
        }
        "sdf-rounded-rect-ellipse" => {
            let mut radii = [
                length("radiusTopLeft").max(0.0),
                length("radiusTopRight").max(0.0),
                length("radiusBottomRight").max(0.0),
                length("radiusBottomLeft").max(0.0),
            ];
            if radii.iter().all(|radius| *radius <= f64::EPSILON) {
                radii = [length("radius").max(0.0); 4];
            }
            filters::mask_shape::mask_shape_corners(
                data,
                width,
                height,
                radii,
                uniforms.text("shape") == Some("ellipse"),
                length("feather").max(0.0),
            );
        }
        "linear-reveal-coverage" => {
            let progress = uniforms.scalar("progress").unwrap_or(1.0);
            if uniforms.bool("invert").unwrap_or(false) {
                filters::reveal::horizontal_reveal_inverted(data, width, height, progress);
            } else {
                filters::reveal::horizontal_reveal(data, width, height, progress);
            }
        }
        other => bail!(
            "effect-capability-unsupported: 内核 {other}（{}）没有 CPU reference 实现",
            manifest.qualified()
        ),
    }
    Ok(())
}

/// 执行一条**双画面转场**（`transition.*@1`，规范 §9）。
///
/// `progress` 是闭区间 `[0, 1]`：`0` 的输出与 `from` 逐字节相同、`1` 与 `to`
/// 逐字节相同。这不是"约等于"——`tests/effects_conformance.rs` 逐字节比。
///
/// 两张输入必须同尺寸（manifest 的 `resizeMode: same-as-input`）。
pub fn apply_transition(
    effect: &EffectRef,
    uniforms: &UniformMap,
    from: &Pixmap,
    to: &Pixmap,
    progress: f32,
    canvas_short_edge: f64,
) -> Result<Pixmap> {
    let manifest = lookup(&effect.id, effect.version).map_err(|error| anyhow!("{error}"))?;
    if manifest.domain != motion::effect::EffectDomain::Transition || manifest.inputs != 2 {
        bail!(
            "effect-input-mismatch: {} 不是双画面转场",
            manifest.qualified()
        );
    }
    if from.width() != to.width() || from.height() != to.height() {
        bail!(
            "effect-capability-unsupported: {} 的两张输入尺寸不同（{}×{} vs {}×{}），             manifest 声明 resizeMode: {}",
            manifest.qualified(),
            from.width(),
            from.height(),
            to.width(),
            to.height(),
            manifest.resize_mode
        );
    }
    let progress = f64::from(progress);
    if !(0.0..=1.0).contains(&progress) {
        bail!(
            "preset-param-invalid: {} 的 progress = {progress} 不在闭区间 [0, 1]",
            manifest.qualified()
        );
    }
    let uniforms = manifest
        .resolve_uniforms(uniforms)
        .map_err(|error| anyhow!("{error}"))?;
    let length = |key: &str| -> f64 {
        let raw = uniforms.scalar(key).unwrap_or(0.0);
        match manifest
            .params
            .get(key)
            .and_then(|spec| spec.basis.as_deref())
        {
            Some("canvasShortEdge") => raw * canvas_short_edge,
            _ => raw,
        }
    };
    let direction = || -> Result<Direction> {
        let text = uniforms.text("direction").unwrap_or("left");
        Direction::parse(text)
            .ok_or_else(|| anyhow!("preset-param-invalid: 未知 direction \"{text}\""))
    };

    let (width, height) = (from.width(), from.height());
    let mut out = Pixmap::new(width, height)
        .ok_or_else(|| anyhow!("transition 输出尺寸非法：{width}×{height}"))?;
    match manifest.kernel.as_str() {
        "crossfade-lerp-premul-u8" => {
            transitions::crossfade::crossfade(from.data(), to.data(), out.data_mut(), progress);
        }
        "slide-shift-copy" => {
            transitions::slide::slide(
                from.data(),
                to.data(),
                out.data_mut(),
                width,
                height,
                direction()?,
                progress,
            );
        }
        "wipe-linear-coverage" => {
            transitions::wipe::wipe(
                from.data(),
                to.data(),
                out.data_mut(),
                width,
                height,
                direction()?,
                length("softness"),
                progress,
            );
        }
        "circle-crop-sdf-coverage" => {
            transitions::circle_crop::circle_crop(
                from.data(),
                to.data(),
                out.data_mut(),
                width,
                height,
                uniforms.scalar("cx").unwrap_or(0.5),
                uniforms.scalar("cy").unwrap_or(0.5),
                length("softness"),
                uniforms.bool("invert").unwrap_or(false),
                progress,
            );
        }
        "ink-blot-noise-coverage" => {
            transitions::ink_blot::ink_blot(
                from.data(),
                to.data(),
                out.data_mut(),
                width,
                height,
                uniforms.scalar("cx").unwrap_or(0.5),
                uniforms.scalar("cy").unwrap_or(0.5),
                length("softness"),
                uniforms.scalar("roughness").unwrap_or(0.18),
                uniforms.scalar("seed").unwrap_or(0.0).max(0.0) as u64,
                uniforms.bool("invert").unwrap_or(false),
                progress,
            );
        }
        "shatter-logpolar-voronoi-premul-u8" => {
            transitions::shatter::shatter(
                from.data(),
                to.data(),
                out.data_mut(),
                width,
                height,
                &transitions::shatter::Shatter {
                    pieces: uniforms.scalar("pieces").unwrap_or(48.0),
                    seed: uniforms.scalar("seed").unwrap_or(0.0).max(0.0) as u64,
                    cx: uniforms.scalar("cx").unwrap_or(0.5),
                    cy: uniforms.scalar("cy").unwrap_or(0.5),
                    force: length("force"),
                    rotation: uniforms.scalar("rotation").unwrap_or(0.0),
                    gravity: length("gravity"),
                    crack: uniforms.scalar("crack").unwrap_or(0.0),
                },
                progress,
            );
        }
        "glitch-band-shift-premul-u8" => {
            transitions::glitch::glitch(
                from.data(),
                to.data(),
                out.data_mut(),
                width,
                height,
                &transitions::glitch::Glitch {
                    vertical: uniforms.text("direction").unwrap_or("vertical") != "horizontal",
                    slices: uniforms.scalar("slices").unwrap_or(24.0),
                    amount: length("amount"),
                    rgb: length("rgb"),
                    steps: uniforms.scalar("steps").unwrap_or(10.0),
                    flicker: uniforms.scalar("flicker").unwrap_or(0.0),
                    seed: uniforms.scalar("seed").unwrap_or(0.0).max(0.0) as u64,
                },
                progress,
            );
        }
        other => bail!(
            "effect-capability-unsupported: 内核 {other}（{}）没有 CPU reference 实现",
            manifest.qualified()
        ),
    }
    Ok(out)
}

/// 双输入遮罩（`mask.image@1` / `mask.luma@1`）。
pub fn apply_image_mask(
    effect: &EffectRef,
    uniforms: &UniformMap,
    input: &Pixmap,
    mask: &Pixmap,
) -> Result<Pixmap> {
    let manifest = lookup(&effect.id, effect.version).map_err(|error| anyhow!("{error}"))?;
    let uniforms = manifest
        .resolve_uniforms(uniforms)
        .map_err(|error| anyhow!("{error}"))?;
    let channel = match manifest.kernel.as_str() {
        "alpha-mask-from-pixmap" => MaskChannel::Alpha,
        "luma-mask-from-pixmap" => MaskChannel::Luminance,
        other => bail!("effect-capability-unsupported: 内核 {other} 不是图像遮罩"),
    };
    let mut out = input.clone();
    // 遮罩只读：`out` 与 `mask` 是两张不同的 Pixmap，借用不会冲突，没有理由
    // 为了过借用检查先把整幅遮罩复制一份。
    filters::mask_image::image_mask(
        out.data_mut(),
        mask.data(),
        channel,
        uniforms.bool("invert").unwrap_or(false),
    )?;
    Ok(out)
}
