//! `fx`（格式规范 §3.9）按固定顺序作用。
//!
//! 1–10 作用在源画面上（裁剪之后、放进框之前，与 v2 的媒体元素相同）：滤镜与特效预设、灰度与亮度、曝光、对比度、
//! 饱和度、色相经 `timeline::lower_element_effects` 的配方由 `render-raster` 执行；色温（8）没有现成的配方，在这里按
//! 规范的公式画；模糊、锐化、颗粒与暗角（9–10）再交回配方。长度按画布短边从 540 短边换算。
//! 遮罩与揭示（11–12）在内核的元素管线里。描边与阴影（13–14）作用在画好的整层上：沿 alpha 轮廓，所以已经
//! 包含遮罩、圆角与元素动画的结果；颜色与偏移是画布方向，不随实例旋转。

use anyhow::Result;
use render_raster::effects::{EffectRef, UniformMap, UniformValue, apply_filter_in_place};
use subtitle_render::apply_media_effects;
use tiny_skia::Pixmap;
use video_model::Fx;

/// 作用在源画面上的 1–10。`short_edge` 是输出画布的短边（像素）。
pub fn apply_to_source(fx: &Fx, pixmap: &mut Pixmap, short_edge: f64) {
    let scale = short_edge / timeline::REFERENCE_SHORT_EDGE;
    let v2 = fx.to_timeline();
    let colour = timeline::schema::Fx {
        blur: None,
        sharpen: None,
        noise: None,
        vignette: None,
        ..v2.clone()
    };
    apply_media_effects(pixmap, Some(&colour), scale);
    if let Some(amount) = fx.temperature.filter(|t| t.is_finite() && *t != 0.0) {
        temperature(pixmap, amount.clamp(-1.0, 1.0));
    }
    let detail = timeline::schema::Fx {
        grayscale: None,
        brightness: None,
        contrast: None,
        exposure: None,
        hue: None,
        saturation: None,
        filter_preset: None,
        effect_preset: None,
        effect_intensity: None,
        ..v2
    };
    apply_media_effects(pixmap, Some(&detail), scale);
}

/// 色温：R × (1 + 0.2t)、B × (1 − 0.2t)，截在 [0, 1]。在预乘值上算，截到 alpha 等价于在直通值上截到 1。
pub fn temperature(pixmap: &mut Pixmap, amount: f64) {
    let red = 1.0 + 0.2 * amount;
    let blue = 1.0 - 0.2 * amount;
    for px in pixmap.data_mut().chunks_exact_mut(4) {
        let a = f64::from(px[3]);
        px[0] = (f64::from(px[0]) * red).round().min(a) as u8;
        px[2] = (f64::from(px[2]) * blue).round().min(a) as u8;
    }
}

/// 作用在画好的整层上的 13–14：先描边，再阴影。
pub fn apply_to_layer(fx: &Fx, layer: &mut Pixmap, short_edge: f64) -> Result<()> {
    if let Some(stroke) = &fx.stroke
        && stroke.width > 0.0
    {
        let uniforms = UniformMap::new()
            .with(
                "radius",
                UniformValue::Scalar((stroke.width / timeline::REFERENCE_SHORT_EDGE).clamp(0.0, 0.1)),
            )
            .with("color", UniformValue::Color(straight_color(&stroke.color, 1.0)));
        apply_filter_in_place(&EffectRef::new("filter.outline", 1), &uniforms, layer, short_edge)?;
    }
    if let Some(shadow) = &fx.shadow
        && shadow.opacity > 0.0
    {
        let uniforms = UniformMap::new()
            .with(
                "radius",
                UniformValue::Scalar((shadow.blur / timeline::REFERENCE_SHORT_EDGE).clamp(0.0, 0.5)),
            )
            .with(
                "dx",
                UniformValue::Scalar((shadow.offset_x / timeline::REFERENCE_SHORT_EDGE).clamp(-1.0, 1.0)),
            )
            .with(
                "dy",
                UniformValue::Scalar((shadow.offset_y / timeline::REFERENCE_SHORT_EDGE).clamp(-1.0, 1.0)),
            )
            .with(
                "color",
                UniformValue::Color(straight_color(&shadow.color, shadow.opacity.clamp(0.0, 1.0))),
            );
        apply_filter_in_place(&EffectRef::new("filter.dropShadow", 1), &uniforms, layer, short_edge)?;
    }
    Ok(())
}

/// `#RRGGBB` / `#RRGGBBAA` 换成直通的 0–1 RGBA，alpha 再乘 `alpha`。读不懂时是黑色。
pub fn straight_color(text: &str, alpha: f64) -> [f64; 4] {
    let [r, g, b, a] = hex_rgba(text).unwrap_or([0, 0, 0, 255]);
    [
        f64::from(r) / 255.0,
        f64::from(g) / 255.0,
        f64::from(b) / 255.0,
        f64::from(a) / 255.0 * alpha,
    ]
}

/// `#RRGGBB` 或 `#RRGGBBAA` 的四个分量。
pub fn hex_rgba(text: &str) -> Option<[u8; 4]> {
    let hex = text.strip_prefix('#')?;
    if !matches!(hex.len(), 6 | 8) || !hex.is_ascii() {
        return None;
    }
    let byte = |i: usize| u8::from_str_radix(&hex[i..i + 2], 16).ok();
    Some([byte(0)?, byte(2)?, byte(4)?, if hex.len() == 8 { byte(6)? } else { 255 }])
}

/// 描边或阴影让层的像素超出它自己的框（要整张画布那么大的层）。
pub fn needs_layer_pass(fx: &Fx) -> bool {
    fx.stroke.as_ref().is_some_and(|s| s.width > 0.0) || fx.shadow.as_ref().is_some_and(|s| s.opacity > 0.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn temperature_scales_red_and_blue_and_clips_to_alpha() {
        // 预乘值：半透明的 (200, 100, 100) 是 (100, 50, 50, 128)。
        let mut pixmap = Pixmap::new(1, 1).unwrap();
        pixmap.data_mut().copy_from_slice(&[100, 50, 50, 128]);
        temperature(&mut pixmap, 1.0);
        assert_eq!(pixmap.data(), &[120, 50, 40, 128]);
        // 截到 alpha，等于直通值截到 1。
        pixmap.data_mut().copy_from_slice(&[120, 50, 40, 128]);
        temperature(&mut pixmap, 1.0);
        assert_eq!(pixmap.data(), &[128, 50, 32, 128]);
        pixmap.data_mut().copy_from_slice(&[100, 50, 100, 128]);
        temperature(&mut pixmap, -0.5);
        assert_eq!(pixmap.data(), &[90, 50, 110, 128]);
    }

    #[test]
    fn colours_read_six_and_eight_digit_hex() {
        assert_eq!(hex_rgba("#FF8000"), Some([255, 128, 0, 255]));
        assert_eq!(hex_rgba("#ff800080"), Some([255, 128, 0, 128]));
        assert_eq!(hex_rgba("#F80"), None);
        assert_eq!(hex_rgba("red"), None);
        assert_eq!(straight_color("#FFFFFF80", 0.5), [1.0, 1.0, 1.0, 128.0 / 255.0 * 0.5]);
        assert_eq!(straight_color("nope", 1.0), [0.0, 0.0, 0.0, 1.0]);
    }
}
