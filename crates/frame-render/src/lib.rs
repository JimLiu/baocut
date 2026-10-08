//! 帧光栅（架构设计 §9.3、§13.1）：按帧计划（`render-graph`）把各层交给移植来的 CPU 渲染内核画成一帧 RGBA。
//!
//! 这是像素的单一实现：原生导出直接链它，编辑器预览经 `bindings/preview-wasm` 用同一份。计划给出层、顺序、时刻与转场；
//! 每层的像素按实例本身的字段画——几何、关键帧、元素动画、遮罩、平铺、文字样式与图形、生成类元素都由
//! `subtitle-render` 的元素管线画（[`element`] 把 v3 实例换成它的元素），`fx` 的调色与模糊先作用在源画面上，
//! 描边与阴影作用在画好的层上（[`effects`]，格式规范 §3.9 的固定顺序）；转场在层上按实例自己的框画（[`transition`]）；
//! 字幕按样式文档交给同一个内核排版（[`captions`]）；模板层按 `timeline` 的模板文档画（[`template`]）。
//!
//! 画面从哪里来由调用方经 [`LayerMedia`] 给（导出时是 `media-core` 的解码器，预览时是界面解好的帧），字体由调用方
//! 注入（[`bundled_fonts`] 是随内核发布的那一套）。画不出来的东西由 [`support`] 统一判断：预检列出来，合成时按选项
//! 报错或跳过，从不画成空白。

pub mod caption_words;
pub mod captions;
pub mod census;
pub mod documents;
pub mod effects;
pub mod element;
pub mod renderer;
pub mod spectrum;
pub mod support;
pub mod template;
pub mod text_measure;
pub mod transition;

pub use census::{FALLBACK_FAMILY, FontUsage, font_census, font_usage};
pub use documents::{Documents, FrozenDocument};
pub use render_raster::fonts::FaceUse;
pub use renderer::{FrameRenderer, GIF_MEDIA_TYPE, LayerMedia, RenderError, RenderOptions, RenderWarning, SVG_MEDIA_TYPE};
pub use spectrum::SpeakerActivity;
pub use support::UnsupportedItem;
pub use text_measure::TextBox;

use tiny_skia::{IntSize, Pixmap};

/// 非预乘的 RGBA 字节换成预乘的画面（不透明的像素不变）。
pub fn premultiplied(width: u32, height: u32, mut data: Vec<u8>) -> Option<Pixmap> {
    for px in data.chunks_exact_mut(4) {
        let a = px[3] as u32;
        if a < 255 {
            for c in &mut px[..3] {
                *c = ((*c as u32 * a + 127) / 255) as u8;
            }
        }
    }
    Pixmap::from_vec(data, IntSize::from_wh(width, height)?)
}

/// 预乘的 RGBA 还原成非预乘（界面的 ImageData 要非预乘）。
pub fn demultiplied(data: &[u8]) -> Vec<u8> {
    let mut out = data.to_vec();
    for px in out.chunks_exact_mut(4) {
        let a = px[3] as u32;
        if a > 0 && a < 255 {
            for c in &mut px[..3] {
                *c = ((*c as u32 * 255 + a / 2) / a).min(255) as u8;
            }
        }
    }
    out
}

/// [`bundled_fonts`] 的文件名（`crates/render-raster/assets/fonts` 下），次序相同。预览的构建按它把字体拷给界面、
/// 界面按它的次序读出来注入（第一份是回退字体）；与内核里的那份列表逐字节对拍（本 crate 的测试）。
pub const BUNDLED_FONT_FILES: &[&str] = &[
    "NotoSansSC-Variable.ttf",
    "Montserrat.ttf",
    "Arimo.ttf",
    "Poppins-Regular.ttf",
    "Poppins-Medium.ttf",
    "Poppins-SemiBold.ttf",
    "Poppins-ExtraBold.ttf",
    "Anton-Regular.ttf",
    "SquadaOne-Regular.ttf",
    "Shrikhand-Regular.ttf",
    "Rubik.ttf",
    "BebasNeue-Regular.ttf",
    "LexendDeca.ttf",
    "SourceSerif4.ttf",
    "Alata-Regular.ttf",
    "ArchivoBlack-Regular.ttf",
    "Bangers-Regular.ttf",
    "CarterOne-Regular.ttf",
    "DancingScript.ttf",
    "FredokaOne-Regular.ttf",
    "PaytoneOne-Regular.ttf",
    "PermanentMarker-Regular.ttf",
    "PressStart2P-Regular.ttf",
    "VKSans-400.ttf",
    "VKSans-500.ttf",
    "VKSans-600.ttf",
    "VKSans-700.ttf",
    "VKSans-800.ttf",
    "VKCode-400.ttf",
    "VKCode-500.ttf",
    "VKCode-600.ttf",
    "VKCode-700.ttf",
    "Inter-Medium.ttf",
    "Poppins-Black.ttf",
    "RobotoMono-Medium.ttf",
    "PlayfairDisplay-Italic.ttf",
    "Oswald-Bold.ttf",
    "PlayfairDisplay-Regular.ttf",
];

/// 随内核发布的字体：思源黑体（缺字的回退，排第一）加 Studio 字幕与文字样式用到的展示字体，都在
/// `render-raster/assets/fonts`，许可见同目录的 `LICENSES`。导出与预览注入同一套；预览的 WASM 不内嵌字体，
/// 由构建把同一批文件拷给界面，界面读出来注入。
#[cfg(feature = "host")]
pub fn bundled_fonts() -> Vec<Vec<u8>> {
    subtitle_render::bundled_studio_fonts()
}

/// SVG 图片按长边 `long_edge` 光栅成预乘的画面。图片层的 SVG 由 [`FrameRenderer`] 从素材字节按输出的长边光栅
/// （预览与导出同一份）；导出的预检也用它判断解不解得开。SVG 里的 `<text>` 不画（两侧的 resvg 都没有字体）。
pub fn decode_svg(bytes: &[u8], long_edge: u32) -> anyhow::Result<Pixmap> {
    render_raster::svg::decode_svg_at_long_edge(bytes, long_edge)
}

/// GIF 解码的上限：动图全帧驻留（`render_raster::source::AnimatedImage`），超过上限的只画第一帧。预览与导出用同一个
/// 上限，同一份素材两边画出的才是同一帧。
pub const GIF_BUDGET: render_raster::source::PrepareCtx = render_raster::source::PrepareCtx {
    max_frames: 2048,
    max_bytes: 128 << 20,
};

/// 读出来的 GIF：多于一帧、总时长大于 0 的按动图画，其余（单帧、每帧都不停留、超过 [`GIF_BUDGET`]）画第一帧。
pub enum Gif {
    Animated(render_raster::source::AnimatedImage),
    Still(std::sync::Arc<Pixmap>),
}

impl Gif {
    /// 画面的尺寸。
    pub fn size(&self) -> (u32, u32) {
        match self {
            Gif::Animated(animated) => (animated.metadata().width, animated.metadata().height),
            Gif::Still(still) => (still.width(), still.height()),
        }
    }

    /// 在实例里过了 `elapsed` 秒时的画面（预乘的 RGBA）。`mode` 是贴纸的 `loop`（格式规范 §3.7）：`loop` 对动图的总时长
    /// 取模，`once` 停在末帧，`hold` 停在首帧；图片实例按 `loop`。时刻按整毫秒落到 GIF 的帧表上。
    pub fn frame_at(&self, elapsed: f64, mode: &str) -> anyhow::Result<std::sync::Arc<Pixmap>> {
        use render_raster::source::{MediaTime, VisualSource};
        let animated = match self {
            Gif::Still(still) => return Ok(still.clone()),
            Gif::Animated(animated) => animated,
        };
        let total = animated.metadata().total_ms().max(1);
        let ms = if elapsed.is_finite() {
            (elapsed.max(0.0) * 1000.0).round() as i64
        } else {
            0
        };
        let at = match mode {
            timeline::schema::STICKER_LOOP_HOLD => 0,
            timeline::schema::STICKER_LOOP_ONCE => ms.min(total - 1),
            _ => ms.rem_euclid(total),
        };
        Ok(animated.sample(MediaTime::from_millis(at))?.pixmap)
    }
}

/// 读 GIF 素材（预览与导出同一份；导出的预检也用它判断解不解得开）。动图解不开时退回解第一帧，第二个返回值是给用户的
/// 提示（超过 [`GIF_BUDGET`] 时）；第一帧也解不开才算失败。
pub fn load_gif(label: &str, bytes: &[u8]) -> anyhow::Result<(Gif, Option<String>)> {
    match render_raster::source::AnimatedImage::decode(label, bytes, &GIF_BUDGET) {
        Ok(animated) if animated.frame_count() > 1 => Ok((Gif::Animated(animated), None)),
        Ok(animated) => {
            let first = animated.frame(0).ok_or_else(|| anyhow::anyhow!("{label}：GIF 没有帧"))?;
            Ok((Gif::Still(first), None))
        }
        Err(error) => {
            let still = render_raster::source::animated_image::decode_first_frame(label, bytes)?;
            let note = error
                .is::<render_raster::source::animated_image::AnimatedImageBudgetExceeded>()
                .then(|| format!("GIF 太大，只画第一帧：{error:#}"));
            Ok((Gif::Still(std::sync::Arc::new(still)), note))
        }
    }
}

/// 读 Lottie 素材：解析（JSON 或 `.lottie` 压缩包），挂上内嵌或包里的图片子资源（位图与 SVG），`overrides`（贴纸的
/// `fillOverrides`）非空时换色。只有路径、包里也没有的外部图片读不到。失败时给出跳过原因（`lottie-asset-missing` 或
/// `lottie-unreadable`）与说明。
pub fn load_lottie(
    label: &str,
    bytes: &[u8],
    overrides: Option<&std::collections::BTreeMap<String, String>>,
) -> Result<render_raster::source::Lottie, (&'static str, String)> {
    let reason = |error: anyhow::Error| {
        let message = format!("{error:#}");
        let code = if message.contains("lottie-asset-missing") {
            "lottie-asset-missing"
        } else {
            "lottie-unreadable"
        };
        (code, message)
    };
    let mut lottie = render_raster::source::Lottie::parse(label, label, bytes).map_err(reason)?;
    lottie.attach_embedded_images().map_err(reason)?;
    if let Some(overrides) = overrides.filter(|o| !o.is_empty()) {
        lottie.apply_fill_overrides(overrides);
    }
    Ok(lottie)
}

/// Lottie 素材的字节读不读得出来：读不出来时给出原因（预检用，与合成时同一个读法）。
pub fn lottie_problem(bytes: &[u8]) -> Option<(&'static str, String)> {
    load_lottie("lottie", bytes, None).err()
}

#[cfg(all(test, feature = "host"))]
mod tests {
    #[test]
    fn the_font_file_list_matches_the_bundled_fonts() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../render-raster/assets/fonts");
        let files: Vec<Vec<u8>> = super::BUNDLED_FONT_FILES
            .iter()
            .map(|name| std::fs::read(dir.join(name)).unwrap())
            .collect();
        assert!(
            files == super::bundled_fonts(),
            "BUNDLED_FONT_FILES 与内核的内置字体次序或内容不一致"
        );
    }
}
