//! Canvas 2D 录制 → DrawOp（代码包规范 §7.2「指令烘焙」）。
//!
//! 代码包宿主在 Chromium 里包装 `CanvasRenderingContext2D`，把主画布上每一帧的调用记成 NDJSON
//! （`packages/code-runtime/src/canvas-recorder.ts`）：
//!
//! - `{"type":"header", width, height, fps:{num,den}, frames, alpha}`、`{"type":"page", background}`；
//! - 资源 `{"type":"font"|"image"|"bitmap", id, …}`（字体与图片是包内相对路径，`bitmap` 是离屏画布的
//!   非预乘 RGBA 快照，base64）；
//! - 帧 `{"type":"frame", index, init?, ops, states, grads, pats}`。
//!
//! [`Converter`] 读入资源后可以跨线程共享，[`Converter::convert`] 把一帧转成 [`FrameOps`]：页面底色清屏，
//! 再逐条翻译绘制（路径在设备空间跟踪、按绘制时的变换换回局部坐标；文字由 rustybuzz 整形成轮廓；阴影、
//! 虚线、混合模式、图案用 DrawOp v8 的原语）。录制里有本模块不能忠实还原的东西时返回
//! [`ConvertError::Unsupported`]，调用方整段回退到逐帧截图。

mod frame;
pub mod gradient;
pub mod path;
pub mod text;

use crate::drawop::{BitmapData, Color4, FrameOps};
use anyhow::{Context, Result, anyhow, bail};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Debug, Clone, Copy)]
pub struct Header {
    pub width: u32,
    pub height: u32,
    pub fps_num: u32,
    pub fps_den: u32,
    pub frames: u32,
    pub alpha: bool,
}

/// 读进内存的一份录制。帧保持原始 JSON 文本，转换时才解析（各线程并行）。
pub struct Recording {
    pub header: Header,
    /// 页面底色（直通 RGBA，0..1）。
    pub background: Color4,
    resources: HashMap<u32, Value>,
    frames: Vec<Option<String>>,
}

impl Recording {
    pub fn load(file: &Path) -> Result<Recording> {
        let text =
            std::fs::read_to_string(file).with_context(|| format!("read {}", file.display()))?;
        Recording::parse(&text)
    }

    pub fn parse(text: &str) -> Result<Recording> {
        let mut header = None;
        let mut background = [0.0f32; 4];
        let mut resources = HashMap::new();
        let mut frames: Vec<Option<String>> = Vec::new();
        for (n, line) in text.lines().enumerate() {
            if line.trim().is_empty() {
                continue;
            }
            // 帧占绝大部分：只取 type 与 index，正文留到转换时再解析。
            let value: Value =
                serde_json::from_str(line).with_context(|| format!("recording line {}", n + 1))?;
            match value.get("type").and_then(Value::as_str) {
                Some("header") => {
                    let num = |key: &str| value.get(key).and_then(Value::as_u64).map(|v| v as u32);
                    let fps = value
                        .get("fps")
                        .ok_or_else(|| anyhow!("header without fps"))?;
                    let fps_part =
                        |key: &str| fps.get(key).and_then(Value::as_u64).map(|v| v as u32);
                    header = Some(Header {
                        width: num("width").ok_or_else(|| anyhow!("header without width"))?,
                        height: num("height").ok_or_else(|| anyhow!("header without height"))?,
                        fps_num: fps_part("num")
                            .ok_or_else(|| anyhow!("header without fps.num"))?,
                        fps_den: fps_part("den").unwrap_or(1),
                        frames: num("frames").ok_or_else(|| anyhow!("header without frames"))?,
                        alpha: value.get("alpha").and_then(Value::as_bool).unwrap_or(false),
                    });
                }
                Some("page") => {
                    if let Some(bg) = value.get("background").and_then(Value::as_array) {
                        for (slot, v) in background.iter_mut().zip(bg) {
                            *slot = v.as_f64().unwrap_or(0.0) as f32;
                        }
                    }
                }
                Some("font" | "image" | "bitmap") => {
                    let id = value
                        .get("id")
                        .and_then(Value::as_u64)
                        .ok_or_else(|| anyhow!("resource without id on line {}", n + 1))?;
                    resources.insert(id as u32, value);
                }
                Some("frame") => {
                    let index = value
                        .get("index")
                        .and_then(Value::as_u64)
                        .ok_or_else(|| anyhow!("frame without index on line {}", n + 1))?
                        as usize;
                    if frames.len() <= index {
                        frames.resize(index + 1, None);
                    }
                    frames[index] = Some(line.to_string());
                }
                other => bail!("unknown recording line type {other:?} on line {}", n + 1),
            }
        }
        let header = header.ok_or_else(|| anyhow!("recording without header"))?;
        Ok(Recording {
            header,
            background,
            resources,
            frames,
        })
    }

    pub fn frame(&self, index: usize) -> Option<&str> {
        self.frames.get(index).and_then(|f| f.as_deref())
    }
}

/// 读一张参考 PNG（Chromium 截的帧）成预乘的 `Pixmap`，与光栅结果同一种像素表示，可以直接对拍。
pub fn read_png(file: &Path) -> Result<tiny_skia::Pixmap> {
    let image = image::open(file)
        .with_context(|| format!("read {}", file.display()))?
        .to_rgba8();
    let (width, height) = image.dimensions();
    let mut pixmap = tiny_skia::Pixmap::new(width, height)
        .ok_or_else(|| anyhow!("empty image {}", file.display()))?;
    for (dst, src) in pixmap
        .data_mut()
        .chunks_exact_mut(4)
        .zip(image.as_raw().chunks_exact(4))
    {
        let a = u32::from(src[3]);
        for c in 0..3 {
            dst[c] = ((u32::from(src[c]) * a + 127) / 255) as u8;
        }
        dst[3] = src[3];
    }
    Ok(pixmap)
}

/// 对拍的产物：`<name>.ops.png`（本侧渲染）与 `<name>.diff.png`（逐通道差放大 4 倍）。
pub fn write_diff(
    dir: &Path,
    name: &str,
    ours: &tiny_skia::Pixmap,
    reference: &tiny_skia::Pixmap,
) -> Result<()> {
    ours.save_png(dir.join(format!("{name}.ops.png")))
        .with_context(|| format!("write {name}.ops.png"))?;
    let mut diff = tiny_skia::Pixmap::new(ours.width(), ours.height())
        .ok_or_else(|| anyhow!("empty image"))?;
    for ((d, a), b) in diff
        .data_mut()
        .chunks_exact_mut(4)
        .zip(ours.data().chunks_exact(4))
        .zip(reference.data().chunks_exact(4))
    {
        for c in 0..3 {
            d[c] = (u32::from(a[c].abs_diff(b[c])) * 4).min(255) as u8;
        }
        d[3] = 255;
    }
    diff.save_png(dir.join(format!("{name}.diff.png")))
        .with_context(|| format!("write {name}.diff.png"))
}

/// 预乘 RGBA → 直通 RGBA（就地）。
pub fn demultiply(rgba: &mut [u8]) {
    for px in rgba.chunks_exact_mut(4) {
        let a = u32::from(px[3]);
        if a == 0 || a == 255 {
            continue;
        }
        for c in 0..3 {
            px[c] = ((u32::from(px[c]) * 255 + a / 2) / a).min(255) as u8;
        }
    }
}

/// 录制转换出的帧从不引用媒体。
struct NoMedia;

impl crate::raster::FrameMedia for NoMedia {
    fn frame(&mut self, id: &str, _media_ms: i64) -> Result<std::sync::Arc<tiny_skia::Pixmap>> {
        bail!("canvas recording frames carry no media ({id})")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum ConvertError {
    /// 录制里有转换器不能忠实还原的东西（原因是给日志看的英文短语）。
    Unsupported(String),
    /// 录制本身不合法。
    Invalid(String),
}

impl std::fmt::Display for ConvertError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ConvertError::Unsupported(reason) => write!(f, "unsupported: {reason}"),
            ConvertError::Invalid(reason) => write!(f, "invalid recording: {reason}"),
        }
    }
}

impl std::error::Error for ConvertError {}

enum ImageSource {
    Bitmap(BitmapData),
    Svg {
        bytes: Vec<u8>,
        width: f64,
        height: f64,
    },
    Failed(String),
}

/// 一份录制的资源（字体、图片、位图）与转换期缓存；`Sync`，各线程共享。
pub struct Converter {
    width: u32,
    height: u32,
    background: Color4,
    fonts: HashMap<u32, Result<text::Font, String>>,
    images: HashMap<u32, ImageSource>,
    svg_cache: Mutex<HashMap<(u32, u32), BitmapData>>,
    gradient_cache: Mutex<Vec<(u64, BitmapData)>>,
}

fn premultiply(rgba: &mut [u8]) {
    for pixel in rgba.chunks_exact_mut(4) {
        let a = u32::from(pixel[3]);
        if a == 255 {
            continue;
        }
        for c in &mut pixel[..3] {
            *c = ((u32::from(*c) * a + 127) / 255) as u8;
        }
    }
}

fn base64_decode(text: &str) -> Result<Vec<u8>> {
    fn value(c: u8) -> Option<u32> {
        Some(match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return None,
        } as u32)
    }
    let bytes: Vec<u8> = text
        .bytes()
        .filter(|b| !b.is_ascii_whitespace() && *b != b'=')
        .collect();
    let mut out = Vec::with_capacity(bytes.len() * 3 / 4);
    for chunk in bytes.chunks(4) {
        let mut acc = 0u32;
        for (i, &c) in chunk.iter().enumerate() {
            acc |= value(c).ok_or_else(|| anyhow!("invalid base64"))? << (18 - 6 * i);
        }
        let n = chunk.len();
        if n == 1 {
            bail!("invalid base64 length");
        }
        out.push((acc >> 16) as u8);
        if n > 2 {
            out.push((acc >> 8) as u8);
        }
        if n > 3 {
            out.push(acc as u8);
        }
    }
    Ok(out)
}

fn load_image(root: &Path, rel: &str) -> ImageSource {
    let file: PathBuf = root.join(rel);
    let bytes = match std::fs::read(&file) {
        Ok(bytes) => bytes,
        Err(error) => return ImageSource::Failed(format!("image-unreadable: {rel}: {error}")),
    };
    if crate::svg::looks_like_svg(&bytes) {
        return match resvg::usvg::Tree::from_data(&bytes, &crate::svg::svg_options()) {
            Ok(tree) => ImageSource::Svg {
                width: f64::from(tree.size().width()),
                height: f64::from(tree.size().height()),
                bytes,
            },
            Err(error) => ImageSource::Failed(format!("image-svg: {rel}: {error}")),
        };
    }
    match image::load_from_memory(&bytes) {
        Ok(decoded) => {
            let rgba = decoded.to_rgba8();
            let (width, height) = rgba.dimensions();
            let mut data = rgba.into_raw();
            premultiply(&mut data);
            ImageSource::Bitmap(BitmapData {
                width,
                height,
                rgba: data.into(),
            })
        }
        Err(error) => ImageSource::Failed(format!("image-decode: {rel}: {error}")),
    }
}

impl Converter {
    /// `root` 是代码包目录（录制里资源路径的基准）。
    pub fn new(root: &Path, recording: &Recording) -> Result<Converter> {
        let mut fonts = HashMap::new();
        let mut images = HashMap::new();
        for (&id, res) in &recording.resources {
            let kind = res.get("type").and_then(Value::as_str).unwrap_or_default();
            let rel = res.get("path").and_then(Value::as_str);
            match kind {
                "font" => {
                    let rel = rel.ok_or_else(|| anyhow!("font resource {id} without path"))?;
                    let weight = res
                        .get("weight")
                        .and_then(Value::as_array)
                        .map(|w| {
                            let at = |i: usize| w.get(i).and_then(Value::as_f64).unwrap_or(400.0);
                            [at(0), at(1)]
                        })
                        .unwrap_or([400.0, 400.0]);
                    let style = res.get("style").and_then(Value::as_str).unwrap_or("normal");
                    let font = std::fs::read(root.join(rel))
                        .map_err(|error| format!("font-unreadable: {rel}: {error}"))
                        .and_then(|bytes| text::Font::load(bytes, weight, style));
                    fonts.insert(id, font);
                }
                "image" => {
                    let rel = rel.ok_or_else(|| anyhow!("image resource {id} without path"))?;
                    images.insert(id, load_image(root, rel));
                }
                "bitmap" => {
                    let dim = |key: &str| res.get(key).and_then(Value::as_u64).unwrap_or(0) as u32;
                    let (width, height) = (dim("w"), dim("h"));
                    let source = res
                        .get("rgba")
                        .and_then(Value::as_str)
                        .ok_or_else(|| anyhow!("bitmap resource {id} without rgba"))
                        .and_then(base64_decode);
                    let entry = match source {
                        Ok(mut data)
                            if width > 0 && data.len() == width as usize * height as usize * 4 =>
                        {
                            premultiply(&mut data);
                            ImageSource::Bitmap(BitmapData {
                                width,
                                height,
                                rgba: data.into(),
                            })
                        }
                        Ok(_) => ImageSource::Failed(format!("bitmap-size: {id}")),
                        Err(error) => ImageSource::Failed(format!("bitmap-data: {id}: {error}")),
                    };
                    images.insert(id, entry);
                }
                _ => {}
            }
        }
        Ok(Converter {
            width: recording.header.width,
            height: recording.header.height,
            background: recording.background,
            fonts,
            images,
            svg_cache: Mutex::new(HashMap::new()),
            gradient_cache: Mutex::new(Vec::new()),
        })
    }

    /// 一帧录制（原始 JSON 行）→ DrawOp。
    pub fn convert(&self, frame_json: &str) -> Result<FrameOps, ConvertError> {
        let frame: Value = serde_json::from_str(frame_json)
            .map_err(|error| ConvertError::Invalid(format!("frame json: {error}")))?;
        frame::convert(self, &frame)
    }

    /// 光栅一帧转换结果（画在可复用的旧画布上，见 [`crate::raster::rasterize_with_media_into`]）。
    pub fn rasterize(
        &self,
        ops: &FrameOps,
        canvas: Option<tiny_skia::Pixmap>,
    ) -> Result<tiny_skia::Pixmap> {
        crate::raster::rasterize_with_media_into(ops, self.width, self.height, canvas, &mut NoMedia)
    }

    /// 图片资源在 `scale` 倍（只对 SVG 有意义）下的位图；返回 (位图, 实际倍率)。
    fn image_bitmap(&self, id: u32, scale: f64) -> Result<(BitmapData, f64), ConvertError> {
        match self.images.get(&id) {
            Some(ImageSource::Bitmap(bitmap)) => Ok((bitmap.clone(), 1.0)),
            Some(ImageSource::Svg {
                bytes,
                width,
                height,
            }) => {
                let limit = 8192.0 / width.max(*height).max(1.0);
                let scale = ((scale * 8.0).ceil() / 8.0).clamp(0.125, limit);
                let key = (id, (scale * 8.0) as u32);
                if let Some(hit) = self
                    .svg_cache
                    .lock()
                    .unwrap_or_else(|p| p.into_inner())
                    .get(&key)
                {
                    return Ok((hit.clone(), scale));
                }
                let tree = resvg::usvg::Tree::from_data(bytes, &crate::svg::svg_options())
                    .map_err(|error| ConvertError::Unsupported(format!("image-svg: {error}")))?;
                let w = (width * scale).ceil().max(1.0) as u32;
                let h = (height * scale).ceil().max(1.0) as u32;
                let mut pixmap = tiny_skia::Pixmap::new(w, h)
                    .ok_or_else(|| ConvertError::Unsupported(format!("image-svg-size: {w}x{h}")))?;
                resvg::render(
                    &tree,
                    tiny_skia::Transform::from_scale(scale as f32, scale as f32),
                    &mut pixmap.as_mut(),
                );
                let bitmap = BitmapData {
                    width: w,
                    height: h,
                    rgba: pixmap.take().into(),
                };
                self.svg_cache
                    .lock()
                    .unwrap_or_else(|p| p.into_inner())
                    .insert(key, bitmap.clone());
                Ok((bitmap, scale))
            }
            Some(ImageSource::Failed(reason)) => Err(ConvertError::Unsupported(reason.clone())),
            None => Err(ConvertError::Invalid(format!(
                "unknown image resource {id}"
            ))),
        }
    }

    fn gradient_bitmap(
        &self,
        key: u64,
        make: impl FnOnce() -> Option<BitmapData>,
    ) -> Option<BitmapData> {
        {
            let mut cache = self
                .gradient_cache
                .lock()
                .unwrap_or_else(|p| p.into_inner());
            if let Some(index) = cache.iter().position(|(k, _)| *k == key) {
                let entry = cache.remove(index);
                let hit = entry.1.clone();
                cache.push(entry);
                return Some(hit);
            }
        }
        let bitmap = make()?;
        let mut cache = self
            .gradient_cache
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        if cache.len() >= 4 {
            cache.remove(0);
        }
        cache.push((key, bitmap.clone()));
        Some(bitmap)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_round_trip() {
        assert_eq!(base64_decode("AAEC/w==").unwrap(), [0, 1, 2, 255]);
        assert_eq!(base64_decode("TWFu").unwrap(), b"Man");
        assert_eq!(base64_decode("TWE=").unwrap(), b"Ma");
    }
}
