//! DrawOp 重放 → tiny-skia Pixmap。层栈实现 PushLayer/PopLayer（组不透明度
//! + 混合模式），裁剪栈实现 ClipPath/PopClip，DrawMedia 经 MediaStore 取像素
//! （image 直引 / video 顺序解码），DrawBitmap 直接取帧内的位图侧表。

use crate::drawop::{
    AssociatedBlend, BitmapData, Color4, DrawOp, FrameOps, MatteMode, PaintData, PathData,
    StaticPrefix,
};
use crate::emissive::{
    composite_associated, composite_associated_with_blend, has_emissive_components,
};
#[cfg(feature = "media")]
use crate::media::MediaStore;
use crate::plan::blend_to_skia;
use anyhow::{Result, anyhow};
use std::cell::OnceCell;
use std::sync::{Arc, Mutex};

/// [`StaticPrefix`] 的光栅缓存：键 `(key, 宽, 高)` → 前缀画完后的整张画面。
/// 进程级（导出的各 worker、预览的各帧共用），至多 [`STATIC_PREFIX_ENTRIES`] 张，
/// 最近用到的排在末尾；1080p 一张 8.3 MB。
static STATIC_PREFIXES: Mutex<Vec<((u64, u32, u32), Arc<Pixmap>)>> = Mutex::new(Vec::new());
const STATIC_PREFIX_ENTRIES: usize = 2;

fn static_prefix_get(key: (u64, u32, u32)) -> Option<Arc<Pixmap>> {
    let mut entries = STATIC_PREFIXES
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    let index = entries.iter().position(|(k, _)| *k == key)?;
    let entry = entries.remove(index);
    let hit = entry.1.clone();
    entries.push(entry);
    Some(hit)
}

fn static_prefix_put(key: (u64, u32, u32), pixmap: &Pixmap) {
    let mut entries = STATIC_PREFIXES
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    if entries.iter().any(|(k, _)| *k == key) {
        return;
    }
    if entries.len() >= STATIC_PREFIX_ENTRIES {
        entries.remove(0);
    }
    entries.push((key, Arc::new(pixmap.clone())));
}

/// path 侧表按需物化：命中背景缓存时前缀里的纹理几何（几万粒颗粒）一次都不转换。
/// `get` 与 `Vec::get` 同形，调用点不变。
struct LazyPaths<'a> {
    data: &'a [PathData],
    cells: Vec<OnceCell<Option<tiny_skia::Path>>>,
}

impl<'a> LazyPaths<'a> {
    fn new(data: &'a [PathData]) -> Self {
        LazyPaths {
            data,
            cells: (0..data.len()).map(|_| OnceCell::new()).collect(),
        }
    }

    fn get(&self, index: usize) -> Option<&Option<tiny_skia::Path>> {
        let data = self.data.get(index)?;
        Some(self.cells[index].get_or_init(|| to_skia_path(data)))
    }
}
use tiny_skia::{
    Color, FillRule, FilterQuality, GradientStop, LineCap, LineJoin, Mask, Paint, PathBuilder,
    Pixmap, PixmapPaint, PixmapRef, Point, RadialGradient, SpreadMode, Stroke, Transform,
};

/// 裁剪栈的一格。`layer_depth` 是压栈时的层深度：`PopClip` 必须在同一层里
/// 完成（规范 §14.5），否则「层内建立的裁剪」会泄漏到层外的绘制上。
struct ClipEntry {
    mask: Mask,
    layer_depth: usize,
}

/// 层栈的一格：`PushLayer`（整幅）、`PushMatte`（整幅遮罩源）或 `PushShadow`（设备空间窗口）。
struct Layer {
    pixmap: Pixmap,
    opacity: f32,
    blend: tiny_skia::BlendMode,
    shadow: Option<ShadowWindow>,
}

/// `PushShadow` 打开的窗口：层内绘制平移 `-origin`、不裁剪，`PopShadow` 时才合成。
struct ShadowWindow {
    color: Color4,
    sigma: f32,
    offset: [f32; 2],
    origin: (i32, i32),
    /// 窗口为空（内容整个落在可见范围外）：层内照常执行，`PopShadow` 什么都不画。
    empty: bool,
}

/// 设备空间平移 `-origin`（阴影窗口内的绘制）；不在窗口里时原样返回。
fn place(transform: Transform, origin: Option<(i32, i32)>) -> Transform {
    match origin {
        Some((x, y)) => transform.post_translate(-(x as f32), -(y as f32)),
        None => transform,
    }
}

fn with_blend<'a>(paint: &Paint<'a>, blend: tiny_skia::BlendMode) -> Paint<'a> {
    let mut paint = paint.clone();
    paint.blend_mode = blend;
    paint
}

fn to_quality(code: u8) -> FilterQuality {
    match code {
        0 => FilterQuality::Nearest,
        2 => FilterQuality::Bicubic,
        _ => FilterQuality::Bilinear,
    }
}

/// 一次盒式模糊：输出 `i` 取 `[i - left, i + right]` 的均值，窗口外按 0（透明）计。
fn box_pass(src: &[f32], dst: &mut [f32], len: usize, rows: usize, left: usize, right: usize) {
    let size = (left + right + 1) as f32;
    for row in 0..rows {
        let line = &src[row * len..(row + 1) * len];
        let out = &mut dst[row * len..(row + 1) * len];
        let mut sum = 0.0f32;
        for value in line.iter().take(right.min(len)) {
            sum += value;
        }
        for i in 0..len {
            if i + right < len {
                sum += line[i + right];
            }
            out[i] = sum / size;
            if i >= left {
                sum -= line[i - left];
            }
        }
    }
}

fn transpose(src: &[f32], dst: &mut [f32], width: usize, height: usize) {
    for y in 0..height {
        for x in 0..width {
            dst[x * height + y] = src[y * width + x];
        }
    }
}

/// 沿行做一维高斯模糊（σ 以像素计）。σ ≥ 2 用 W3C filter-effects 的三次盒式近似
/// （Skia 同法），更小的 σ 直接卷积高斯核。
fn blur_rows(data: &mut [f32], scratch: &mut [f32], len: usize, rows: usize, sigma: f32) {
    if sigma >= 2.0 {
        let d = (sigma * 3.0 * (2.0 * std::f32::consts::PI).sqrt() / 4.0 + 0.5).floor() as usize;
        let d = d.max(1);
        let passes = if d % 2 == 1 {
            let r = (d - 1) / 2;
            [(r, r), (r, r), (r, r)]
        } else {
            [(d / 2, d / 2 - 1), (d / 2 - 1, d / 2), (d / 2, d / 2)]
        };
        for (left, right) in passes {
            box_pass(data, scratch, len, rows, left, right);
            data.copy_from_slice(scratch);
        }
        return;
    }
    let radius = (sigma * 3.0).ceil() as usize;
    let kernel: Vec<f32> = (0..=radius)
        .map(|i| (-((i * i) as f32) / (2.0 * sigma * sigma)).exp())
        .collect();
    let norm = kernel[0] + 2.0 * kernel[1..].iter().sum::<f32>();
    for row in 0..rows {
        let line = &data[row * len..(row + 1) * len];
        let out = &mut scratch[row * len..(row + 1) * len];
        for (i, slot) in out.iter_mut().enumerate() {
            let mut sum = line[i] * kernel[0];
            for (k, weight) in kernel.iter().enumerate().skip(1) {
                if i >= k {
                    sum += line[i - k] * weight;
                }
                if i + k < len {
                    sum += line[i + k] * weight;
                }
            }
            *slot = sum / norm;
        }
    }
    data.copy_from_slice(scratch);
}

/// `PopShadow` 的阴影图：窗口 alpha 经高斯模糊后乘阴影色（直通 RGBA → 预乘）。
fn shadow_pixmap(window: &Pixmap, color: &Color4, sigma: f32) -> Option<Pixmap> {
    let (width, height) = (window.width() as usize, window.height() as usize);
    let mut alpha: Vec<f32> = window
        .data()
        .chunks_exact(4)
        .map(|pixel| f32::from(pixel[3]) / 255.0)
        .collect();
    if sigma > 0.0 {
        let mut scratch = vec![0.0f32; alpha.len()];
        blur_rows(&mut alpha, &mut scratch, width, height, sigma);
        transpose(&alpha, &mut scratch, width, height);
        std::mem::swap(&mut alpha, &mut scratch);
        blur_rows(&mut alpha, &mut scratch, height, width, sigma);
        transpose(&alpha, &mut scratch, height, width);
        std::mem::swap(&mut alpha, &mut scratch);
    }
    let a = color[3].clamp(0.0, 1.0);
    let premul = [
        color[0].clamp(0.0, 1.0) * a,
        color[1].clamp(0.0, 1.0) * a,
        color[2].clamp(0.0, 1.0) * a,
        a,
    ];
    let mut out = Pixmap::new(window.width(), window.height())?;
    for (pixel, coverage) in out.data_mut().chunks_exact_mut(4).zip(alpha) {
        let coverage = coverage.clamp(0.0, 1.0);
        for (channel, value) in pixel.iter_mut().zip(premul) {
            *channel = (value * coverage * 255.0 + 0.5) as u8;
        }
    }
    Some(out)
}

fn to_paint(c: &[f32; 4]) -> Paint<'static> {
    let mut p = Paint::default();
    p.set_color(to_color(c));
    p.anti_alias = true;
    p
}

/// 自然尺寸单位的源裁剪框换到实际帧尺寸，取整后仍落在帧内（全零 = 整幅源）。
fn scale_crop(src: &[f32; 4], fx: f32, fy: f32, width: u32, height: u32) -> [f32; 4] {
    if src[2] <= 0.0 || src[3] <= 0.0 {
        return *src;
    }
    let x = (src[0] * fx).round().clamp(0.0, width as f32 - 1.0);
    let y = (src[1] * fy).round().clamp(0.0, height as f32 - 1.0);
    let right = ((src[0] + src[2]) * fx)
        .round()
        .clamp(x + 1.0, width as f32);
    let bottom = ((src[1] + src[3]) * fy)
        .round()
        .clamp(y + 1.0, height as f32);
    [x, y, right - x, bottom - y]
}

fn to_tf(m: &[f32; 6]) -> Transform {
    Transform::from_row(m[0], m[1], m[2], m[3], m[4], m[5])
}

/// 预乘 RGBA 的每个像素 alpha 都是 255（不透明：src-over 时完全遮住下层，也不可能有超过 alpha 的发光分量）。
///
/// 导出每帧都要对整幅视频问一次：按块把 alpha 字节一起与过去，不短路的折叠能向量化，比逐像素短路快得多；块与块之间
/// 仍然短路，有半透明的图扫到第一块不满就停。
pub fn is_opaque(data: &[u8]) -> bool {
    data.chunks(4096)
        .all(|block| block.chunks_exact(4).fold(0xFF, |acc, pixel| acc & pixel[3]) == 0xFF)
}

/// `out.draw_pixmap(0, 0, src, &PixmapPaint::default(), transform, None)` 的捷径（不透明度 1、src-over、不裁剪；
/// 平移时 tiny-skia 不论要的是什么滤波都按最近邻取）：`transform` 是整数平移（含恒等），且盖到的源像素只有不透明的
/// 与全零的时，src-over 就是把不透明像素原样拷过去、全零像素不动。先扫一遍再拷：有半透明像素就什么都不改、返回
/// false，调用方照走 `draw_pixmap`，两条路逐字节相同（`copy_over_tests` 与 `draw_pixmap` 对拍）。
///
/// 视频帧整幅不透明：整幅视频层（预览画的与导出画的）由此省掉逐像素的浮点管线（Pattern 着色器只有 highp 实现）。
/// 全零的行按整行与零比较，透明的大片几乎不花时间。
pub fn copy_over(out: &mut Pixmap, src: PixmapRef, transform: Transform) -> bool {
    let Transform {
        sx,
        kx,
        ky,
        sy,
        tx,
        ty,
    } = transform;
    // NaN 与无穷的 fract 是 NaN，不等于 0。
    if sx != 1.0 || sy != 1.0 || kx != 0.0 || ky != 0.0 || tx.fract() != 0.0 || ty.fract() != 0.0 {
        return false;
    }
    let (dx, dy) = (tx as i64, ty as i64);
    let (src_w, src_h) = (i64::from(src.width()), i64::from(src.height()));
    let (out_w, out_h) = (i64::from(out.width()), i64::from(out.height()));
    let (x0, x1) = (dx.max(0), (dx + src_w).min(out_w));
    let (y0, y1) = (dy.max(0), (dy + src_h).min(out_h));
    if x0 >= x1 || y0 >= y1 {
        return false;
    }
    let src_data = src.data();
    let row_of = |y: i64| {
        let start = (((y - dy) * src_w + (x0 - dx)) * 4) as usize;
        &src_data[start..start + ((x1 - x0) * 4) as usize]
    };
    #[derive(Clone, Copy, PartialEq)]
    enum Row {
        Clear,
        Opaque,
        Mixed,
    }
    static ZEROS: [u8; 4096] = [0; 4096];
    let mut rows = Vec::with_capacity((y1 - y0) as usize);
    for y in y0..y1 {
        let row = row_of(y);
        if row
            .chunks(ZEROS.len())
            .all(|chunk| chunk == &ZEROS[..chunk.len()])
        {
            rows.push(Row::Clear);
            continue;
        }
        // 整行不透明（视频）先按块折叠 alpha（[`is_opaque`]），比下面逐像素分支快得多。
        if is_opaque(row) {
            rows.push(Row::Opaque);
            continue;
        }
        let mut opaque = true;
        for pixel in row.chunks_exact(4) {
            match pixel[3] {
                255 => {}
                // 全零才是透明；预乘不合法的 (r,g,b,0) 在 src-over 里会加到底下，交给管线。
                0 if pixel == [0, 0, 0, 0] => opaque = false,
                _ => return false,
            }
        }
        rows.push(if opaque { Row::Opaque } else { Row::Mixed });
    }
    let out_row_bytes = (out_w * 4) as usize;
    let out_data = out.data_mut();
    for (y, kind) in (y0..y1).zip(rows) {
        let row = row_of(y);
        let start = y as usize * out_row_bytes + (x0 * 4) as usize;
        let target = &mut out_data[start..start + row.len()];
        match kind {
            Row::Clear => {}
            Row::Opaque => target.copy_from_slice(row),
            Row::Mixed => {
                for (to, from) in target.chunks_exact_mut(4).zip(row.chunks_exact(4)) {
                    if from[3] == 255 {
                        to.copy_from_slice(from);
                    }
                }
            }
        }
    }
    true
}

fn to_color(c: &[f32; 4]) -> Color {
    Color::from_rgba(
        c[0].clamp(0.0, 1.0),
        c[1].clamp(0.0, 1.0),
        c[2].clamp(0.0, 1.0),
        c[3].clamp(0.0, 1.0),
    )
    .expect("color")
}

/// paint 侧表条目 → tiny-skia `Paint`。
///
/// 渐变几何在 **path 本地坐标系**里（与 op 的 `tf` 同一系），shader 的
/// `transform` 因此恒为 identity——`fill_path` 会把 `tf` 一并施加上去。
/// 退化几何（起止点重合 / 半径 ≤ 0 / 只有一个色标）折成末标纯色：tiny-skia
/// 会拒绝构造这类 shader，静默不画比画错更难查。
fn paint_from<'a>(data: &PaintData, bitmaps: &'a [BitmapData]) -> Result<Paint<'a>> {
    let mut paint = Paint::default();
    paint.anti_alias = true;
    let stops = |src: &[crate::drawop::GradientStop]| -> Vec<GradientStop> {
        src.iter()
            .map(|s| GradientStop::new(s.offset.clamp(0.0, 1.0), to_color(&s.color)))
            .collect()
    };
    let fallback = |src: &[crate::drawop::GradientStop]| -> Color {
        src.last()
            .map(|s| to_color(&s.color))
            .unwrap_or(Color::TRANSPARENT)
    };
    match data {
        PaintData::Solid(color) => paint.set_color(to_color(color)),
        PaintData::Linear { p0, p1, stops: st } => {
            let shader = tiny_skia::LinearGradient::new(
                Point::from_xy(p0[0], p0[1]),
                Point::from_xy(p1[0], p1[1]),
                stops(st),
                SpreadMode::Pad,
                Transform::identity(),
            );
            match shader {
                Some(shader) => paint.shader = shader,
                None => paint.set_color(fallback(st)),
            }
        }
        PaintData::Radial {
            center,
            radius,
            focus,
            stops: st,
        } => {
            let shader = RadialGradient::new(
                Point::from_xy(focus[0], focus[1]),
                Point::from_xy(center[0], center[1]),
                radius.max(f32::MIN_POSITIVE),
                stops(st),
                SpreadMode::Pad,
                Transform::identity(),
            );
            match shader {
                Some(shader) => paint.shader = shader,
                None => paint.set_color(fallback(st)),
            }
        }
        PaintData::Pattern {
            bitmap,
            repeat,
            quality,
            opacity,
            transform,
        } => {
            let data = bitmaps
                .get(*bitmap as usize)
                .ok_or_else(|| anyhow!("PATTERN_BITMAP_MISSING: {bitmap}"))?;
            let pixels = PixmapRef::from_bytes(&data.rgba, data.width, data.height)
                .ok_or_else(|| anyhow!("PATTERN_BITMAP_SIZE_INVALID: {bitmap}"))?;
            paint.shader = tiny_skia::Pattern::new(
                pixels,
                if *repeat {
                    SpreadMode::Repeat
                } else {
                    SpreadMode::Pad
                },
                to_quality(*quality),
                opacity.clamp(0.0, 1.0),
                to_tf(transform),
            );
        }
    }
    Ok(paint)
}

fn to_cap(code: u8) -> LineCap {
    match code {
        0 => LineCap::Butt,
        2 => LineCap::Square,
        _ => LineCap::Round,
    }
}

fn to_join(code: u8) -> LineJoin {
    match code {
        0 => LineJoin::Miter,
        2 => LineJoin::Bevel,
        _ => LineJoin::Round,
    }
}

/// 把遮罩源层折进目标层的 alpha（`PopMatte`）。
///
/// 两张画面都是**预乘** RGBA 且同尺寸，逐像素乘一个 0..1 因子即可——预乘格式
/// 下「乘 alpha」就是四个分量同乘，不需要先解预乘再乘回去。因子用整数
/// （0..=255 定点）算，避免浮点取整在不同平台上分叉。
pub(crate) fn apply_matte(target: &mut Pixmap, matte: &Pixmap, mode: MatteMode) {
    let src = matte.data();
    let dst = target.data_mut();
    for (t, m) in dst.chunks_exact_mut(4).zip(src.chunks_exact(4)) {
        let alpha = u32::from(m[3]);
        let factor = match mode {
            MatteMode::Alpha => alpha,
            MatteMode::AlphaInverted => 255 - alpha,
            // 预乘像素的亮度已经含 alpha 权重（Rec.709 整数权重，和为 65536）
            MatteMode::Luma | MatteMode::LumaInverted => {
                let luma =
                    (13933 * u32::from(m[0]) + 46871 * u32::from(m[1]) + 4732 * u32::from(m[2]))
                        >> 16;
                let luma = luma.min(255);
                if mode == MatteMode::Luma {
                    luma
                } else {
                    255 - luma
                }
            }
        };
        for channel in t.iter_mut() {
            *channel = ((u32::from(*channel) * factor + 127) / 255) as u8;
        }
    }
}

fn to_skia_path(p: &PathData) -> Option<tiny_skia::Path> {
    let mut pb = PathBuilder::new();
    for seg in &p.0 {
        let q = seg.pts;
        match seg.verb {
            0 => pb.move_to(q[0], q[1]),
            1 => pb.line_to(q[0], q[1]),
            2 => pb.quad_to(q[0], q[1], q[2], q[3]),
            3 => pb.cubic_to(q[0], q[1], q[2], q[3], q[4], q[5]),
            _ => pb.close(),
        }
    }
    pb.finish()
}

pub fn rounded_rect_path(x: f64, y: f64, w: f64, h: f64, radius: f64) -> Option<tiny_skia::Path> {
    let r = radius.min(w.min(h) / 2.0).max(0.0);
    let mut pb = PathBuilder::new();
    if r <= 0.0 {
        pb.push_rect(tiny_skia::Rect::from_xywh(
            x as f32, y as f32, w as f32, h as f32,
        )?);
        return pb.finish();
    }
    const K: f64 = 0.5522847498307936; // 圆角三次贝塞尔近似
    let k = K * r;
    pb.move_to((x + r) as f32, y as f32);
    pb.line_to((x + w - r) as f32, y as f32);
    pb.cubic_to(
        (x + w - r + k) as f32,
        y as f32,
        (x + w) as f32,
        (y + r - k) as f32,
        (x + w) as f32,
        (y + r) as f32,
    );
    pb.line_to((x + w) as f32, (y + h - r) as f32);
    pb.cubic_to(
        (x + w) as f32,
        (y + h - r + k) as f32,
        (x + w - r + k) as f32,
        (y + h) as f32,
        (x + w - r) as f32,
        (y + h) as f32,
    );
    pb.line_to((x + r) as f32, (y + h) as f32);
    pb.cubic_to(
        (x + r - k) as f32,
        (y + h) as f32,
        x as f32,
        (y + h - r + k) as f32,
        x as f32,
        (y + h - r) as f32,
    );
    pb.line_to(x as f32, (y + r) as f32);
    pb.cubic_to(
        x as f32,
        (y + r - k) as f32,
        (x + r - k) as f32,
        y as f32,
        (x + r) as f32,
        y as f32,
    );
    pb.close();
    pb.finish()
}

/// DrawOp media lookup boundary. BCF rendering uses [`MediaStore`]; product
/// overlay rendering can add deterministic in-memory subtitle/text layers while
/// still replaying the exact same DrawOp stream.
pub trait FrameMedia {
    fn frame(&mut self, id: &str, media_ms: i64) -> Result<Arc<Pixmap>>;

    /// 可按任意尺寸光栅的矢量动图（program / Lottie / 动画 SVG）的自然尺寸；
    /// 位图、视频与不支持的实现返回 `None`（缺省）。
    fn vector_natural_size(&self, _id: &str) -> Option<(u32, u32)> {
        None
    }

    /// 同 [`Self::frame`]，矢量动图按 `target` 设备像素光栅。做不到的实现照旧
    /// 交自然尺寸（缺省）；调用方按交回的实际尺寸换算，不假定等于 `target`。
    fn frame_for_target(
        &mut self,
        id: &str,
        media_ms: i64,
        _target: Option<(u32, u32)>,
    ) -> Result<Arc<Pixmap>> {
        self.frame(id, media_ms)
    }
}

#[cfg(feature = "media")]
impl FrameMedia for MediaStore {
    fn frame(&mut self, id: &str, media_ms: i64) -> Result<Arc<Pixmap>> {
        self.frame_for_target(id, media_ms, None)
    }

    fn vector_natural_size(&self, id: &str) -> Option<(u32, u32)> {
        MediaStore::vector_natural_size(self, id)
    }

    fn frame_for_target(
        &mut self,
        id: &str,
        media_ms: i64,
        target: Option<(u32, u32)>,
    ) -> Result<Arc<Pixmap>> {
        // media_ms < 0 是静态图的约定标记；≥ 0 时先问动图（它已全帧驻留），
        // 再落到视频的顺序解码器。
        if media_ms < 0 {
            return self.image_frame(id);
        }
        match self.animated_frame_for_target(id, media_ms, target) {
            Some(frame) => frame,
            None => self.video_frame(id, media_ms as f64 / 1000.0),
        }
    }
}

/// 矢量源单边与面积上限：放得再大也不无界分配（8K 横幅的面积）。
const MEDIA_TARGET_MAX_SIDE: f64 = 8192.0;
const MEDIA_TARGET_MAX_AREA: f64 = 7680.0 * 4320.0;

/// 自然尺寸 `natural` 的矢量源在 `tf` 下实际占的设备像素。与自然尺寸相差不到
/// 一像素时返回 `None`：按自然尺寸光栅，结果与从前逐字节相同。
fn media_target(tf: &[f32; 6], (width, height): (u32, u32)) -> Option<(u32, u32)> {
    let w = f64::from(width) * f64::from(tf[0]).hypot(f64::from(tf[1]));
    let h = f64::from(height) * f64::from(tf[2]).hypot(f64::from(tf[3]));
    if !(w.is_finite() && h.is_finite()) || w < 0.5 || h < 0.5 {
        return None;
    }
    let (w, h) = (w.ceil(), h.ceil());
    if (w - f64::from(width)).abs() <= 1.0 && (h - f64::from(height)).abs() <= 1.0 {
        return None;
    }
    let fit = (MEDIA_TARGET_MAX_SIDE / w.max(h))
        .min((MEDIA_TARGET_MAX_AREA / (w * h)).sqrt())
        .min(1.0);
    Some((
        (w * fit).round().max(1.0) as u32,
        (h * fit).round().max(1.0) as u32,
    ))
}

#[cfg(feature = "media")]
pub fn rasterize(
    frame: &FrameOps,
    width: u32,
    height: u32,
    media: &mut MediaStore,
) -> Result<Pixmap> {
    rasterize_with_media(frame, width, height, media)
}

/// `?Sized`：`PassExecutor` 是对象安全 trait，媒体入口以 `&mut dyn FrameMedia`
/// 传进来，必须能直接喂给这里（否则折叠路径就要多包一层壳）。
pub fn rasterize_with_media(
    frame: &FrameOps,
    width: u32,
    height: u32,
    media: &mut (impl FrameMedia + ?Sized),
) -> Result<Pixmap> {
    rasterize_with_media_into(frame, width, height, None, media)
}

/// 同 [`rasterize_with_media`]，画在调用方给的旧画布 `canvas` 上（用过的，内容不要紧；尺寸不对时不用），
/// 省掉一次整幅的分配。结果与画在新建的画布上逐字节相同：旧画布不当作新建时的全零，开头的透明清屏照样整幅写零；
/// 第一条要画的指令不是清屏时先清成全零。
pub fn rasterize_with_media_into(
    frame: &FrameOps,
    width: u32,
    height: u32,
    canvas: Option<Pixmap>,
    media: &mut (impl FrameMedia + ?Sized),
) -> Result<Pixmap> {
    // path 侧表按需物化（见 [`LazyPaths`]）
    let paths = LazyPaths::new(&frame.paths);

    let paints = frame
        .paints
        .iter()
        .map(|paint| paint_from(paint, &frame.bitmaps))
        .collect::<Result<Vec<_>>>()?;

    let recycled = canvas.filter(|canvas| (canvas.width(), canvas.height()) == (width, height));
    let dirty = recycled.is_some();
    let mut base = match recycled {
        Some(canvas) => canvas,
        None => Pixmap::new(width, height).ok_or_else(|| anyhow!("pixmap"))?,
    };
    // 静态前缀（背景纸）：命中就从前缀之后接着画；未命中时画到前缀末尾存一张。
    let prefix = frame
        .static_prefix
        .filter(|prefix| prefix.ops > 0 && prefix.ops <= frame.ops.len())
        .map(|StaticPrefix { key, ops }| ((key, width, height), ops));
    let mut start = 0;
    let mut store_at = None;
    // `base` 还是新建时的全零（没接上前缀缓存、还没画过东西）：画实例的 DrawOp 都以透明清屏开头，这一遍整幅写零可以省。
    let mut untouched = !dirty;
    if let Some((key, ops)) = prefix {
        match static_prefix_get(key) {
            Some(hit) => {
                base.data_mut().copy_from_slice(hit.data());
                start = ops;
                untouched = false;
            }
            None => store_at = Some((key, ops)),
        }
    }
    if dirty && start == 0 && !matches!(frame.ops.first(), Some(DrawOp::Clear { .. })) {
        base.fill(Color::TRANSPARENT);
    }
    // 层栈：(离屏层, 合成不透明度, 混合模式)。遮罩源层用 `None` 的混合模式区分
    // ——它不回贴画面，只在 `PopMatte` 时折进下面那一层的 alpha。
    let mut layers: Vec<Layer> = Vec::new();
    // 遮罩源层在 `layers` 里的下标（`PushMatte` 压入，`PopMatte` 弹出）。
    let mut mattes: Vec<usize> = Vec::new();
    // 裁剪栈：栈顶是当前生效的累积 mask（逐层求交）
    let mut clips: Vec<ClipEntry> = Vec::new();
    // `PushBlend` 栈：(混合模式, 压栈时的层深)。只作用于同一层深的绘制。
    let mut blends: Vec<(tiny_skia::BlendMode, usize)> = Vec::new();

    macro_rules! target {
        () => {
            match layers.last_mut() {
                Some(layer) => &mut layer.pixmap,
                None => &mut base,
            }
        };
    }

    for (index, op) in frame.ops.iter().enumerate().skip(start) {
        if let Some((key, ops)) = store_at
            && index == ops
        {
            // 只在前缀真的收平时缓存（录制器保证；防御写法，不收平就不缓存）。
            if layers.is_empty() && clips.is_empty() && mattes.is_empty() {
                static_prefix_put(key, &base);
            }
            store_at = None;
        }
        // 阴影窗口里的绘制平移到窗口坐标、不裁剪（裁剪在 `PopShadow` 合成时生效）。
        let origin = layers
            .last()
            .and_then(|layer| layer.shadow.as_ref())
            .map(|shadow| shadow.origin);
        let clip = if origin.is_some() {
            None
        } else {
            clips.last().map(|entry| &entry.mask)
        };
        let blend = match blends.last() {
            Some(&(mode, depth)) if depth == layers.len() => mode,
            _ => tiny_skia::BlendMode::SourceOver,
        };
        let plain = blend == tiny_skia::BlendMode::SourceOver;
        // 透明清屏预乘后是全零，落在全零的新底图上什么都不改；别的指令（含开层）之后底图就不算新的了。
        let blank = untouched && matches!(op, DrawOp::Clear { color } if color[3] <= 0.0 && !color.iter().any(|c| c.is_nan()));
        untouched = blank;
        match op {
            DrawOp::Clear { .. } if blank => {}
            DrawOp::Clear { color } => {
                target!().fill(
                    Color::from_rgba(
                        color[0].clamp(0.0, 1.0),
                        color[1].clamp(0.0, 1.0),
                        color[2].clamp(0.0, 1.0),
                        color[3].clamp(0.0, 1.0),
                    )
                    .expect("bg"),
                );
            }
            DrawOp::FillRect {
                x,
                y,
                w,
                h,
                radius,
                color,
                tf,
            } => {
                if let Some(path) =
                    rounded_rect_path(*x as f64, *y as f64, *w as f64, *h as f64, *radius as f64)
                {
                    target!().fill_path(
                        &path,
                        &with_blend(&to_paint(color), blend),
                        FillRule::Winding,
                        place(to_tf(tf), origin),
                        clip,
                    );
                }
            }
            DrawOp::FillPath { path, color, tf } => {
                if let Some(Some(p)) = paths.get(*path as usize) {
                    target!().fill_path(
                        p,
                        &with_blend(&to_paint(color), blend),
                        FillRule::Winding,
                        place(to_tf(tf), origin),
                        clip,
                    );
                }
            }
            DrawOp::StrokePath {
                path,
                color,
                width: sw,
                tf,
            } => {
                if let Some(Some(p)) = paths.get(*path as usize) {
                    let stroke = Stroke {
                        width: *sw,
                        line_cap: LineCap::Round,
                        line_join: LineJoin::Round,
                        ..Default::default()
                    };
                    target!().stroke_path(
                        p,
                        &with_blend(&to_paint(color), blend),
                        &stroke,
                        place(to_tf(tf), origin),
                        clip,
                    );
                }
            }
            DrawOp::DrawMedia {
                asset,
                media_ms,
                src,
                tf,
            } => {
                let id = frame
                    .strings
                    .get(*asset as usize)
                    .ok_or_else(|| anyhow!("DrawMedia 引用未知 string {asset}"))?;
                // 矢量动图按它在画面里实际占的像素光栅（缩小的预览省光栅，放大的
                // 导出不糊）；`tf` 与 `src` 仍以自然尺寸为单位，按交回的尺寸换算。
                let natural = (*media_ms >= 0)
                    .then(|| media.vector_natural_size(id))
                    .flatten();
                let wanted = natural.and_then(|natural| media_target(tf, natural));
                let pm = media.frame_for_target(id, *media_ms, wanted)?;
                let (tf, src) = match natural {
                    Some((width, height)) if (pm.width(), pm.height()) != (width, height) => {
                        let fx = pm.width() as f32 / width as f32;
                        let fy = pm.height() as f32 / height as f32;
                        (
                            to_tf(tf).pre_scale(1.0 / fx, 1.0 / fy),
                            scale_crop(src, fx, fy, pm.width(), pm.height()),
                        )
                    }
                    _ => (to_tf(tf), *src),
                };
                let tf = place(tf, origin);
                let paint = PixmapPaint {
                    quality: FilterQuality::Bilinear,
                    blend_mode: blend,
                    ..Default::default()
                };
                // 源裁剪（fit: cover）：全零 = 整幅源
                if src[2] > 0.0 && src[3] > 0.0 {
                    let rect = tiny_skia::IntRect::from_xywh(
                        src[0].round() as i32,
                        src[1].round() as i32,
                        (src[2].round() as u32).max(1),
                        (src[3].round() as u32).max(1),
                    )
                    .ok_or_else(|| anyhow!("DrawMedia 裁剪矩形非法 {src:?}"))?;
                    let cropped = pm
                        .as_ref()
                        .clone_rect(rect)
                        .ok_or_else(|| anyhow!("DrawMedia 裁剪越界 {src:?}"))?;
                    if clip.is_some() || !plain || !copy_over(target!(), cropped.as_ref(), tf) {
                        target!().draw_pixmap(0, 0, cropped.as_ref(), &paint, tf, clip);
                    }
                } else if clip.is_some()
                    || !plain
                    || !copy_over(target!(), pm.as_ref().as_ref(), tf)
                {
                    target!().draw_pixmap(0, 0, pm.as_ref().as_ref(), &paint, tf, clip);
                }
            }
            DrawOp::DrawEmissiveBitmap {
                blend,
                bitmap,
                opacity,
                tf,
            } => {
                // Screen depends on the final backdrop. Flattening into an
                // offscreen group and subsequently applying source-over changes it.
                if *blend == AssociatedBlend::Screen && (!layers.is_empty() || !mattes.is_empty()) {
                    return Err(anyhow!("ASSOCIATED_SCREEN_OFFSCREEN_UNSUPPORTED"));
                }
                if !plain || origin.is_some() {
                    return Err(anyhow!("EMISSIVE_BLEND_UNSUPPORTED"));
                }
                let data = frame
                    .bitmaps
                    .get(*bitmap as usize)
                    .ok_or_else(|| anyhow!("EMISSIVE_BITMAP_MISSING: {bitmap}"))?;
                let pixels = PixmapRef::from_bytes(&data.rgba, data.width, data.height)
                    .ok_or_else(|| anyhow!("EMISSIVE_BITMAP_SIZE_INVALID: {bitmap}"))?;
                composite_associated_with_blend(target!(), pixels, *opacity, *tf, clip, *blend)?;
            }
            DrawOp::DrawBitmap {
                bitmap,
                opacity,
                tf,
            } => {
                let data = frame
                    .bitmaps
                    .get(*bitmap as usize)
                    .ok_or_else(|| anyhow!("DrawBitmap 引用未知 bitmap {bitmap}"))?;
                let pixels = PixmapRef::from_bytes(&data.rgba, data.width, data.height)
                    .ok_or_else(|| {
                        anyhow!(
                            "DrawBitmap 位图 {bitmap} 尺寸与字节不符（{}x{}，{} 字节）",
                            data.width,
                            data.height,
                            data.rgba.len()
                        )
                    })?;
                if has_emissive_components(pixels.data()) {
                    return Err(anyhow!("EMISSIVE_BITMAP_OP_REQUIRED"));
                }
                target!().draw_pixmap(
                    0,
                    0,
                    pixels,
                    &PixmapPaint {
                        opacity: opacity.clamp(0.0, 1.0),
                        quality: FilterQuality::Bilinear,
                        blend_mode: blend,
                    },
                    place(to_tf(tf), origin),
                    clip,
                );
            }
            DrawOp::FillPathPaint {
                path,
                paint,
                even_odd,
                tf,
            } => {
                let Some(Some(p)) = paths.get(*path as usize) else {
                    return Err(anyhow!("FillPathPaint 引用未知 path {path}"));
                };
                let Some(paint) = paints.get(*paint as usize) else {
                    return Err(anyhow!("FillPathPaint 引用未知 paint {paint}"));
                };
                let rule = if *even_odd {
                    FillRule::EvenOdd
                } else {
                    FillRule::Winding
                };
                target!().fill_path(
                    p,
                    &with_blend(paint, blend),
                    rule,
                    place(to_tf(tf), origin),
                    clip,
                );
            }
            DrawOp::StrokePathPaint {
                path,
                paint,
                width: sw,
                cap,
                join,
                miter,
                tf,
            } => {
                let Some(Some(p)) = paths.get(*path as usize) else {
                    return Err(anyhow!("StrokePathPaint 引用未知 path {path}"));
                };
                let Some(paint) = paints.get(*paint as usize) else {
                    return Err(anyhow!("StrokePathPaint 引用未知 paint {paint}"));
                };
                let stroke = Stroke {
                    width: *sw,
                    line_cap: to_cap(*cap),
                    line_join: to_join(*join),
                    miter_limit: miter.max(1.0),
                    ..Default::default()
                };
                target!().stroke_path(
                    p,
                    &with_blend(paint, blend),
                    &stroke,
                    place(to_tf(tf), origin),
                    clip,
                );
            }
            DrawOp::StrokePathDash {
                path,
                paint,
                width: sw,
                cap,
                join,
                miter,
                dash,
                dash_offset,
                tf,
            } => {
                let Some(Some(p)) = paths.get(*path as usize) else {
                    return Err(anyhow!("StrokePathDash references unknown path {path}"));
                };
                let Some(paint) = paints.get(*paint as usize) else {
                    return Err(anyhow!("StrokePathDash references unknown paint {paint}"));
                };
                // 不合法的虚线（奇数项、和不为正）构造不出来：与 Canvas 一样什么都不画。
                if let Some(dash) = tiny_skia::StrokeDash::new(dash.clone(), *dash_offset) {
                    let stroke = Stroke {
                        width: *sw,
                        line_cap: to_cap(*cap),
                        line_join: to_join(*join),
                        miter_limit: miter.max(1.0),
                        dash: Some(dash),
                    };
                    target!().stroke_path(
                        p,
                        &with_blend(paint, blend),
                        &stroke,
                        place(to_tf(tf), origin),
                        clip,
                    );
                }
            }
            DrawOp::PushShadow {
                color,
                sigma,
                offset,
                window,
            } => {
                if origin.is_some() {
                    return Err(anyhow!("PushShadow inside a shadow window"));
                }
                let [x, y, w, h] = *window;
                let empty = w <= 0 || h <= 0;
                let (w, h) = if empty { (1, 1) } else { (w as u32, h as u32) };
                layers.push(Layer {
                    pixmap: Pixmap::new(w, h).ok_or_else(|| anyhow!("shadow window {w}x{h}"))?,
                    opacity: 1.0,
                    blend: tiny_skia::BlendMode::SourceOver,
                    shadow: Some(ShadowWindow {
                        color: *color,
                        sigma: sigma.max(0.0),
                        offset: *offset,
                        origin: (x, y),
                        empty,
                    }),
                });
            }
            DrawOp::PopShadow => {
                if blends.last().is_some_and(|&(_, depth)| depth == layers.len()) {
                    return Err(anyhow!("PopShadow with an open PushBlend inside the window"));
                }
                let Some(Layer {
                    pixmap,
                    shadow: Some(shadow),
                    ..
                }) = layers.pop()
                else {
                    return Err(anyhow!("PopShadow without a matching PushShadow"));
                };
                if !shadow.empty {
                    let blend = match blends.last() {
                        Some(&(mode, depth)) if depth == layers.len() => mode,
                        _ => tiny_skia::BlendMode::SourceOver,
                    };
                    let outer = layers
                        .last()
                        .and_then(|layer| layer.shadow.as_ref())
                        .map(|shadow| shadow.origin);
                    let clip = if outer.is_some() {
                        None
                    } else {
                        clips.last().map(|entry| &entry.mask)
                    };
                    let (ox, oy) = (shadow.origin.0 as f32, shadow.origin.1 as f32);
                    if let Some(cast) = shadow_pixmap(&pixmap, &shadow.color, shadow.sigma) {
                        let [dx, dy] = shadow.offset;
                        let quality = if dx.fract() == 0.0 && dy.fract() == 0.0 {
                            FilterQuality::Nearest
                        } else {
                            FilterQuality::Bilinear
                        };
                        target!().draw_pixmap(
                            0,
                            0,
                            cast.as_ref(),
                            &PixmapPaint {
                                opacity: 1.0,
                                blend_mode: blend,
                                quality,
                            },
                            place(Transform::from_translate(ox + dx, oy + dy), outer),
                            clip,
                        );
                    }
                    target!().draw_pixmap(
                        0,
                        0,
                        pixmap.as_ref(),
                        &PixmapPaint {
                            opacity: 1.0,
                            blend_mode: blend,
                            quality: FilterQuality::Nearest,
                        },
                        place(Transform::from_translate(ox, oy), outer),
                        clip,
                    );
                }
            }
            DrawOp::PushBlend { blend: mode } => {
                blends.push((blend_to_skia(*mode), layers.len()));
            }
            DrawOp::PopBlend => {
                match blends.pop() {
                    Some((_, depth)) if depth == layers.len() => {}
                    Some(_) => return Err(anyhow!("PopBlend crosses a layer boundary")),
                    None => return Err(anyhow!("PopBlend without a matching PushBlend")),
                }
            }
            DrawOp::PushMatte => {
                if origin.is_some() {
                    return Err(anyhow!("PushMatte inside a shadow window"));
                }
                if layers.is_empty() {
                    return Err(anyhow!("PushMatte 必须处在某个 PushLayer 之内"));
                }
                mattes.push(layers.len());
                layers.push(Layer {
                    pixmap: Pixmap::new(width, height).ok_or_else(|| anyhow!("matte layer"))?,
                    opacity: 1.0,
                    blend: tiny_skia::BlendMode::SourceOver,
                    shadow: None,
                });
            }
            DrawOp::PopMatte { mode } => {
                let mode = MatteMode::from_code(*mode)
                    .ok_or_else(|| anyhow!("PopMatte 未知模式 {mode}"))?;
                if mattes.last() != Some(&(layers.len().saturating_sub(1))) {
                    return Err(anyhow!("PopMatte 无匹配 PushMatte"));
                }
                if clips
                    .last()
                    .is_some_and(|entry| entry.layer_depth == layers.len())
                {
                    return Err(anyhow!(
                        "PopMatte 时裁剪栈仍有遮罩层压入的 ClipPath：PopClip 不得跨越层边界"
                    ));
                }
                mattes.pop();
                let matte = layers.pop().expect("matte layer").pixmap;
                let content = &mut layers.last_mut().expect("PushMatte 已保证下面有层").pixmap;
                apply_matte(content, &matte, mode);
            }
            DrawOp::PushLayer {
                opacity,
                blend: mode,
            } => {
                if origin.is_some() {
                    return Err(anyhow!("PushLayer inside a shadow window"));
                }
                layers.push(Layer {
                    pixmap: Pixmap::new(width, height).ok_or_else(|| anyhow!("layer"))?,
                    opacity: *opacity,
                    blend: blend_to_skia(*mode),
                    shadow: None,
                });
            }
            DrawOp::PopLayer => {
                if mattes.last() == Some(&layers.len().saturating_sub(1)) {
                    return Err(anyhow!("PopLayer 时遮罩源层未 PopMatte"));
                }
                if clips
                    .last()
                    .is_some_and(|entry| entry.layer_depth == layers.len())
                {
                    return Err(anyhow!(
                        "PopLayer 时裁剪栈仍有本层压入的 ClipPath：PopClip 不得跨越层边界"
                    ));
                }
                if blends.last().is_some_and(|&(_, depth)| depth == layers.len()) {
                    return Err(anyhow!("PopLayer with an open PushBlend inside the layer"));
                }
                if layers.last().is_some_and(|layer| layer.shadow.is_some()) {
                    return Err(anyhow!("PopLayer closes a shadow window"));
                }
                let Layer {
                    pixmap: layer,
                    opacity,
                    blend: blend_mode,
                    ..
                } = layers
                    .pop()
                    .ok_or_else(|| anyhow!("PopLayer 无匹配 PushLayer"))?;
                // 层回贴不受裁剪影响：裁剪已经在层内的每次绘制上生效过了。
                if has_emissive_components(layer.data())
                    || has_emissive_components(target!().data())
                {
                    if blend_mode != tiny_skia::BlendMode::SourceOver {
                        return Err(anyhow!("EMISSIVE_BLEND_UNSUPPORTED"));
                    }
                    composite_associated(
                        target!(),
                        layer.as_ref(),
                        opacity,
                        [1., 0., 0., 1., 0., 0.],
                        None,
                    )?;
                    continue;
                }
                target!().draw_pixmap(
                    0,
                    0,
                    layer.as_ref(),
                    &PixmapPaint {
                        opacity,
                        blend_mode,
                        ..Default::default()
                    },
                    Transform::identity(),
                    None,
                );
            }
            DrawOp::ClipPath { path, tf } => {
                if origin.is_some() {
                    return Err(anyhow!("ClipPath inside a shadow window"));
                }
                let Some(Some(p)) = paths.get(*path as usize) else {
                    return Err(anyhow!("ClipPath 引用未知 path {path}"));
                };
                let mut mask = match clips.last() {
                    Some(entry) => entry.mask.clone(),
                    None => Mask::new(width, height).ok_or_else(|| anyhow!("clip mask"))?,
                };
                if clips.is_empty() {
                    mask.fill_path(p, FillRule::Winding, true, to_tf(tf));
                } else {
                    mask.intersect_path(p, FillRule::Winding, true, to_tf(tf));
                }
                clips.push(ClipEntry {
                    mask,
                    layer_depth: layers.len(),
                });
            }
            DrawOp::PopClip => {
                let entry = clips
                    .pop()
                    .ok_or_else(|| anyhow!("PopClip 无匹配 ClipPath"))?;
                if entry.layer_depth != layers.len() {
                    return Err(anyhow!(
                        "PopClip 跨越了 PushLayer/PopLayer 边界（压入时层深 {}，弹出时 {}）",
                        entry.layer_depth,
                        layers.len()
                    ));
                }
            }
        }
    }
    // 整帧只有前缀（背景纸之上什么都没有）：循环里走不到前缀末尾，在这里存。
    if let Some((key, _)) = store_at
        && layers.is_empty()
        && clips.is_empty()
        && mattes.is_empty()
    {
        static_prefix_put(key, &base);
    }
    if !layers.is_empty() {
        return Err(anyhow!("帧结束时层栈非空（{} 层未 Pop）", layers.len()));
    }
    if !mattes.is_empty() {
        return Err(anyhow!(
            "帧结束时遮罩栈非空（{} 层未 PopMatte）",
            mattes.len()
        ));
    }
    if !clips.is_empty() {
        return Err(anyhow!(
            "帧结束时裁剪栈非空（{} 层未 PopClip）",
            clips.len()
        ));
    }
    if !blends.is_empty() {
        return Err(anyhow!("{} PushBlend left open at frame end", blends.len()));
    }
    Ok(base)
}

#[cfg(test)]
mod media_target_tests {
    use super::*;
    use crate::drawop::{DrawOp, FrameBuilder};

    /// A 100×50 vector source (left half red, right half blue) that rasterizes
    /// at whatever size it is asked for and records each request.
    #[derive(Default)]
    struct Vector {
        asked: Vec<Option<(u32, u32)>>,
    }

    impl FrameMedia for Vector {
        fn frame(&mut self, id: &str, media_ms: i64) -> Result<Arc<Pixmap>> {
            self.frame_for_target(id, media_ms, None)
        }

        fn vector_natural_size(&self, _id: &str) -> Option<(u32, u32)> {
            Some((100, 50))
        }

        fn frame_for_target(
            &mut self,
            _id: &str,
            _media_ms: i64,
            target: Option<(u32, u32)>,
        ) -> Result<Arc<Pixmap>> {
            self.asked.push(target);
            let (width, height) = target.unwrap_or((100, 50));
            let mut pixmap = Pixmap::new(width, height).unwrap();
            pixmap.fill(Color::from_rgba8(0, 0, 255, 255));
            let left = tiny_skia::Rect::from_xywh(0.0, 0.0, width as f32 / 2.0, height as f32);
            let mut red = Paint::default();
            red.set_color_rgba8(255, 0, 0, 255);
            pixmap.fill_rect(left.unwrap(), &red, Transform::identity(), None);
            Ok(Arc::new(pixmap))
        }
    }

    fn draw(scale: f32, src: [f32; 4]) -> (Vec<Option<(u32, u32)>>, Pixmap) {
        let mut builder = FrameBuilder::default();
        let asset = builder.string_id("vector");
        builder.push(DrawOp::DrawMedia {
            asset,
            media_ms: 0,
            src,
            tf: [scale, 0.0, 0.0, scale, 10.0, 10.0],
        });
        let mut media = Vector::default();
        let out = rasterize_with_media(&builder.finish(), 400, 200, &mut media).unwrap();
        (media.asked, out)
    }

    fn rgba(pixmap: &Pixmap, x: u32, y: u32) -> [u8; 4] {
        let pixel = pixmap.pixel(x, y).unwrap();
        [pixel.red(), pixel.green(), pixel.blue(), pixel.alpha()]
    }

    const RED: [u8; 4] = [255, 0, 0, 255];
    const BLUE: [u8; 4] = [0, 0, 255, 255];
    const NONE: [u8; 4] = [0, 0, 0, 0];

    #[test]
    fn vector_media_rasterizes_at_the_device_size_it_covers() {
        let (asked, out) = draw(1.0, [0.0; 4]);
        assert_eq!(asked, [None], "natural size keeps the old raster");
        assert_eq!(
            (rgba(&out, 11, 11), rgba(&out, 108, 58), rgba(&out, 111, 30)),
            (RED, BLUE, NONE)
        );
        let (asked, out) = draw(0.5, [0.0; 4]);
        assert_eq!(asked, [Some((50, 25))]);
        assert_eq!(
            (rgba(&out, 11, 11), rgba(&out, 58, 33)),
            (RED, BLUE),
            "the smaller frame still fills the 50×25 box"
        );
        assert_eq!((rgba(&out, 61, 20), rgba(&out, 30, 36)), (NONE, NONE));
        let (asked, out) = draw(2.5, [0.0; 4]);
        assert_eq!(asked, [Some((250, 125))]);
        assert_eq!((rgba(&out, 12, 12), rgba(&out, 258, 133)), (RED, BLUE));
        assert_eq!(rgba(&out, 262, 60), NONE);
    }

    #[test]
    fn crops_are_mapped_into_the_target_sized_frame() {
        // fit: cover keeping the right (blue) half, drawn at 2×: 100×100 device px.
        let (asked, out) = draw(2.0, [50.0, 0.0, 50.0, 50.0]);
        assert_eq!(asked, [Some((200, 100))]);
        for (x, y) in [(11, 11), (108, 108), (60, 60)] {
            assert_eq!(rgba(&out, x, y), BLUE, "{x},{y}");
        }
        assert_eq!((rgba(&out, 112, 60), rgba(&out, 60, 112)), (NONE, NONE));
    }

    #[test]
    fn subpixel_changes_keep_natural_size_and_huge_zooms_are_capped() {
        assert_eq!(
            media_target(&[1.005, 0.0, 0.0, 1.005, 0.0, 0.0], (100, 50)),
            None
        );
        assert_eq!(
            media_target(&[0.0, 1.0, -1.0, 0.0, 9.0, 0.0], (100, 50)),
            None
        );
        assert_eq!(
            media_target(&[0.5, 0.0, 0.0, 0.5, 0.0, 0.0], (1920, 1080)),
            Some((960, 540))
        );
        // A 16:9 zoom hits the area cap; a tall strip hits the side cap.
        assert_eq!(
            media_target(&[100.0, 0.0, 0.0, 100.0, 0.0, 0.0], (1920, 1080)),
            Some((7680, 4320))
        );
        assert_eq!(
            media_target(&[100.0, 0.0, 0.0, 100.0, 0.0, 0.0], (100, 1000)),
            Some((819, 8192))
        );
        assert_eq!(
            media_target(&[5.0, 0.0, 0.0, 5.0, 0.0, 0.0], (1920, 1080)),
            Some((7680, 4320))
        );
        assert_eq!(media_target(&[0.0; 6], (100, 50)), None);
    }
}

#[cfg(test)]
mod copy_over_tests {
    use super::*;

    /// 可复现的伪随机字节（xorshift）。
    struct Bytes(u64);

    impl Bytes {
        fn next(&mut self) -> u8 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            (self.0 >> 24) as u8
        }
    }

    /// 合法的预乘像素：`alpha` 给定，颜色不超过它。
    fn pixel(bytes: &mut Bytes, alpha: u8) -> [u8; 4] {
        let channel = |bytes: &mut Bytes| {
            if alpha == 0 {
                0
            } else {
                (u16::from(bytes.next()) % (u16::from(alpha) + 1)) as u8
            }
        };
        [channel(bytes), channel(bytes), channel(bytes), alpha]
    }

    fn pixmap(width: u32, height: u32, mut fill: impl FnMut(u32, u32) -> [u8; 4]) -> Pixmap {
        let mut pixmap = Pixmap::new(width, height).unwrap();
        for (index, chunk) in pixmap.data_mut().chunks_exact_mut(4).enumerate() {
            chunk.copy_from_slice(&fill(index as u32 % width, index as u32 / width));
        }
        pixmap
    }

    /// 底下是随机的半透明画面；捷径成立时与 `draw_pixmap` 逐字节相同，不成立时 `out` 一个字节都不动。
    fn check(src: &Pixmap, transform: Transform, expect_fast: bool) {
        let mut bytes = Bytes(0x9e37_79b9_7f4a_7c15);
        let base = pixmap(37, 23, |_, _| {
            let alpha = bytes.next();
            pixel(&mut bytes, alpha)
        });
        let mut slow = base.clone();
        slow.draw_pixmap(
            0,
            0,
            src.as_ref(),
            &PixmapPaint {
                quality: FilterQuality::Bilinear,
                ..Default::default()
            },
            transform,
            None,
        );
        let mut fast = base.clone();
        let took = copy_over(&mut fast, src.as_ref(), transform);
        assert_eq!(took, expect_fast, "{transform:?}");
        if took {
            assert!(fast.data() == slow.data(), "{transform:?}");
        } else {
            assert!(fast.data() == base.data(), "{transform:?}");
        }
    }

    #[test]
    fn copy_over_matches_draw_pixmap() {
        let mut bytes = Bytes(42);
        // 每个通道值都走一遍：不透明像素的颜色取遍 0..=255。
        let mut value = 0u32;
        let opaque = pixmap(16, 16, |_, _| {
            let v = (value % 256) as u8;
            value += 1;
            [v, v.wrapping_mul(7), v.wrapping_add(91), 255]
        });
        // 透明底上一块不透明的（像一个居中的视频），与全零、不透明夹杂的行。
        let block = pixmap(20, 12, |x, y| {
            if (4..15).contains(&x) && (2..10).contains(&y) {
                pixel(&mut bytes, 255)
            } else {
                [0; 4]
            }
        });
        let speckled = pixmap(20, 12, |x, y| {
            if (x * 3 + y) % 4 == 0 {
                pixel(&mut bytes, 255)
            } else {
                [0; 4]
            }
        });
        for src in [&opaque, &block, &speckled] {
            for (tx, ty) in [
                (0.0, 0.0),
                (5.0, 3.0),
                (-4.0, -2.0),
                (30.0, 18.0),
                (-10.0, 15.0),
                (21.0, -5.0),
            ] {
                check(src, Transform::from_translate(tx, ty), true);
            }
            // 不是整数平移：交给管线。
            for transform in [
                Transform::from_translate(0.5, 0.0),
                Transform::from_scale(2.0, 2.0),
                Transform::from_row(1.0, 0.1, 0.0, 1.0, 0.0, 0.0),
            ] {
                check(src, transform, false);
            }
            // 整个落在画面外。
            check(src, Transform::from_translate(100.0, 0.0), false);
        }
        // 有半透明像素、或者预乘不合法的 (r,g,b,0)：不走捷径，什么都不动。
        let soft = pixmap(8, 8, |x, y| {
            if (x, y) == (5, 6) {
                pixel(&mut bytes, 128)
            } else {
                pixel(&mut bytes, 255)
            }
        });
        check(&soft, Transform::identity(), false);
        let invalid = pixmap(8, 8, |x, _| if x == 3 { [9, 0, 0, 0] } else { [0; 4] });
        check(&invalid, Transform::identity(), false);
    }
}

#[cfg(test)]
mod clear_tests {
    use super::*;
    use crate::drawop::{DrawOp, FrameBuilder};

    struct NoMedia;

    impl FrameMedia for NoMedia {
        fn frame(&mut self, id: &str, _media_ms: i64) -> Result<Arc<Pixmap>> {
            Err(anyhow!("no media {id}"))
        }
    }

    const NONE: [f32; 4] = [0.0; 4];
    const RED: [f32; 4] = [1.0, 0.0, 0.0, 1.0];

    fn rasterize(ops: Vec<DrawOp>) -> Vec<u8> {
        let mut builder = FrameBuilder::default();
        for op in ops {
            builder.push(op);
        }
        rasterize_with_media(&builder.finish(), 4, 2, &mut NoMedia)
            .unwrap()
            .data()
            .to_vec()
    }

    #[test]
    fn transparent_clear_is_skipped_only_on_a_fresh_canvas() {
        let clear = |color| DrawOp::Clear { color };
        let rect = DrawOp::FillRect {
            x: 0.0,
            y: 0.0,
            w: 4.0,
            h: 2.0,
            radius: 0.0,
            color: RED,
            tf: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
        };
        let red = [255, 0, 0, 255].repeat(8);
        // 新底图本来全零：开头的透明清屏省掉，结果不变。
        assert_eq!(rasterize(vec![clear(NONE)]), vec![0; 32]);
        assert_eq!(rasterize(vec![clear(NONE), clear(NONE), rect.clone()]), red);
        // 画过之后的透明清屏、不透明的清屏照做。
        assert_eq!(rasterize(vec![clear(NONE), rect, clear(NONE)]), vec![0; 32]);
        assert_eq!(rasterize(vec![clear(NONE), clear(RED)]), red);
    }

    #[test]
    fn a_recycled_canvas_draws_the_same_bytes_as_a_fresh_one() {
        // 旧画布（上一帧的内容还在）不当作新建时的全零：开头的透明清屏照样写零，不以清屏开头时先清成全零。
        let clear = |color| DrawOp::Clear { color };
        let half = DrawOp::FillRect {
            x: 0.0,
            y: 0.0,
            w: 2.0,
            h: 2.0,
            radius: 0.0,
            color: [0.0, 0.0, 1.0, 0.5],
            tf: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
        };
        let cases = [
            vec![clear(NONE)],
            vec![clear(NONE), half.clone()],
            vec![half.clone()],
            vec![clear(RED), half.clone()],
            vec![],
        ];
        for ops in cases {
            let mut builder = FrameBuilder::default();
            for op in ops.iter().cloned() {
                builder.push(op);
            }
            let frame = builder.finish();
            let mut dirty = Pixmap::new(4, 2).unwrap();
            dirty.data_mut().fill(0x7F);
            let recycled =
                rasterize_with_media_into(&frame, 4, 2, Some(dirty), &mut NoMedia).unwrap();
            assert_eq!(
                recycled.data(),
                rasterize(ops.clone()).as_slice(),
                "{ops:?}"
            );
            // 尺寸不对的旧画布不用。
            let small = Pixmap::new(2, 2).unwrap();
            let fresh = rasterize_with_media_into(&frame, 4, 2, Some(small), &mut NoMedia).unwrap();
            assert_eq!(fresh.data(), rasterize(ops.clone()).as_slice(), "{ops:?}");
        }
    }

    #[test]
    fn is_opaque_reads_every_alpha() {
        // 跨块边界（4096 字节）与不满一块的尾巴：任一像素 alpha 不是 255 都不算不透明。
        let mut data = [7, 8, 9, 255].repeat(1500);
        assert!(is_opaque(&data));
        for at in [0, 1023, 1024, 1499] {
            data[at * 4 + 3] = 254;
            assert!(!is_opaque(&data), "pixel {at}");
            data[at * 4 + 3] = 255;
        }
        assert!(is_opaque(&[]));
    }
}
