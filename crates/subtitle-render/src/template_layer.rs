//! 模板层文档（`timeline.json` 顶层 `template`，设计原型第 112 轮 §14.5）的逐帧直绘。
//!
//! 一份文档三处用：舞台上的模板 chrome、导出的前景层、目录 / 品牌库 / 向导的缩略图。
//! 三处画的都是这同一个函数（[`raster`]），缩略图不另画一套「色块示意」——这与原型
//! `template-render.jsx` 的纪律一字不差。
//!
//! 这里**没有 I/O**：章节表、项目标题与台标图片都由 host 装进 [`TemplateScene`]
//! 再交进来，所以 `wasm-safe` 与 `host` 两个 feature 共用同一份实现，不再有 stub。
//!
//! 几何全部按画面百分比折算：盒子 `box{x,y,w,h}` 是画面的百分比，字号 `size` 是
//! **画面高**的百分比（下限 7px）。颜色只来自文档（画进视频画面的内容色）。
//!
//! 台标层的 `opacity`（0.05–1）是整层不透明度；`tile` 为真时同一枚台标在盒子里铺 24 枚、
//! 整体绕盒心斜放放大（原型 `.tpllogo--tile`）——水印并进模板后，这两个参数就是
//! 「水印」与「台标」的全部区别（台账 2026-09-14-230340）。

use std::collections::BTreeMap;
use std::sync::Arc;

use anyhow::{Context, Result};
use render_raster::TextEngine;
use render_raster::fonts::{GlyphRender, ShapedGlyph};
use timeline::template::{
    self as tpl, ChapterFill, ChapterSpan, LayerKind, LogoShape, LogoSrc, SegmentState,
    TemplateDoc, TextAlign,
};
use tiny_skia::{
    FillRule, FilterQuality, Paint, PathBuilder, Pixmap, PixmapPaint, PixmapRef, Rect, Transform,
};

use crate::{
    SubtitleColor, draw_fit_pixmap_at, fill_round_rect, parse_css_color, rounded_rect_path,
};

/// `mono` 文字层固定用的等宽族（Studio 内嵌 `VKCode-*.ttf`），忽略模板的 `font`。
pub const MONO_FAMILY: &str = "VK Code";

/// 一份可渲染的模板场景：层文档 + 它引用的项目侧事实。
///
/// `fingerprint` 覆盖文档、章节、标题与台标像素——任何一项变了，渲染计划的帧身份
/// 都跟着变；App 的缩略图缓存也按它命中。
#[derive(Clone)]
pub struct TemplateScene {
    pub doc: TemplateDoc,
    /// 输出时间轴时钟上的章节（整章被剪掉的已经不在里面）。
    pub chapters: Vec<ChapterSpan>,
    /// `{title}` 变量：project.json 的 `title`。
    pub title: String,
    /// 已解码的台标图片，key 见 [`TemplateScene::logo_key`]。
    pub logos: BTreeMap<String, Arc<Pixmap>>,
    pub fingerprint: u64,
}

impl TemplateScene {
    /// 组装场景并算内容指纹。台标按 `(key, 已解码 Pixmap)` 传入：解码需要
    /// `image`/`resvg`，那是 host 的事，渲染层不碰字节到像素的转换。
    pub fn new(
        doc: TemplateDoc,
        chapters: Vec<ChapterSpan>,
        title: impl Into<String>,
        logos: Vec<(String, Pixmap)>,
    ) -> Self {
        let title = title.into();
        let mut identity = serde_json::to_vec(&doc).unwrap_or_default();
        for chapter in &chapters {
            identity.extend_from_slice(chapter.id.as_bytes());
            identity.push(0);
            identity.extend_from_slice(chapter.title.as_bytes());
            identity.push(0);
            identity.extend_from_slice(&chapter.start.to_le_bytes());
            identity.extend_from_slice(&chapter.end.to_le_bytes());
        }
        identity.push(0);
        identity.extend_from_slice(title.as_bytes());
        let mut map = BTreeMap::new();
        for (key, pixmap) in logos {
            identity.push(0);
            identity.extend_from_slice(key.as_bytes());
            identity
                .extend_from_slice(&render_raster::drawop::fnv1a64(pixmap.data()).to_le_bytes());
            map.insert(key, Arc::new(pixmap));
        }
        let fingerprint = render_raster::drawop::fnv1a64(&identity);
        Self {
            doc,
            chapters,
            title,
            logos: map,
            fingerprint,
        }
    }

    /// 台标图片在 [`Self::logos`] 里的 key：项目内文件按相对路径，品牌 logo 按 id。
    /// 文字台标没有 key。
    pub fn logo_key(src: &LogoSrc) -> Option<&str> {
        match src {
            LogoSrc::Text(_) => None,
            LogoSrc::BrandLogo { brand_logo } => Some(brand_logo),
            LogoSrc::File { file } => Some(file),
        }
    }
}

/// 一帧的绘制参数。
#[derive(Debug, Clone, Copy)]
pub struct FrameParams<'a> {
    /// 播放头（输出时间轴时钟）。
    pub time: f64,
    /// 输出总长。
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    /// 模板没写 `font`、或写的族不在字体引擎里时用的族（通常是字幕样式的字体）。
    pub fallback_family: &'a str,
}

/// 把整份模板画成一张与画布同尺寸的透明底 premultiplied RGBA Pixmap。
///
/// 层按数组顺序画（后画在上），关掉的层不画。`editing_dim` 为真时关掉的层按
/// 0.35 透明度画出来（版面编辑器「好点回去」），舞台与导出一律传 `false`。
pub fn raster(
    scene: &TemplateScene,
    params: FrameParams<'_>,
    text: &mut TextEngine,
    editing_dim: bool,
) -> Result<Pixmap> {
    let mut pixmap =
        Pixmap::new(params.width.max(1), params.height.max(1)).context("为模板层分配画布失败")?;
    let family = resolve_family(&scene.doc, params.fallback_family, text);
    let fw = f64::from(params.width);
    let fh = f64::from(params.height);
    let segs = tpl::segments(&scene.chapters, params.time, params.duration);
    let vars = tpl::vars(
        &scene.chapters,
        params.time,
        params.duration,
        &[("title", scene.title.as_str())],
    );
    let pct = tpl::progress(params.time, params.duration);
    for layer in &scene.doc.layers {
        // 开着的层按自己的整层不透明度（台标层 `opacity`，其余恒 1）；关掉的层只在编辑态
        // 按 0.35 画出来（原型 `opacity: !l.on ? 0.35 : layerOpacity(l)`，两者不相乘）
        let opacity = if layer.on {
            layer.kind.opacity()
        } else if editing_dim {
            0.35
        } else {
            continue;
        };
        let rect = LayerRect {
            x: fw * layer.rect.x / 100.0,
            y: fh * layer.rect.y / 100.0,
            w: (fw * layer.rect.w / 100.0).max(1.0),
            h: (fh * layer.rect.h / 100.0).max(1.0),
        };
        let ctx = PaintCtx {
            fh,
            family: &family,
            segs: &segs,
            vars: &vars,
            pct,
            logos: &scene.logos,
        };
        if layer.kind.tiled() {
            // 平铺斜放放大后越出盒子是常态，只被画面裁掉：离屏取画布大小
            let mut local =
                Pixmap::new(pixmap.width(), pixmap.height()).context("为模板图层分配缓冲失败")?;
            paint_tile(&mut local, &rect, &layer.kind, &ctx, text);
            pixmap.draw_pixmap(
                0,
                0,
                local.as_ref(),
                &PixmapPaint {
                    opacity: opacity as f32,
                    quality: FilterQuality::Nearest,
                    ..Default::default()
                },
                Transform::identity(),
                None,
            );
            continue;
        }
        // 每层先画进自己的离屏盒再贴回：`overflow: hidden` 与整层透明度都在这一步落实。
        let mut local = Pixmap::new(rect.w.ceil() as u32, rect.h.ceil() as u32)
            .context("为模板图层分配缓冲失败")?;
        paint_layer(&mut local, &layer.kind, &ctx, text);
        pixmap.draw_pixmap(
            0,
            0,
            local.as_ref(),
            &PixmapPaint {
                opacity: opacity as f32,
                quality: FilterQuality::Nearest,
                ..Default::default()
            },
            Transform::from_translate(rect.x as f32, rect.y as f32),
            None,
        );
    }
    Ok(pixmap)
}

/// 模板文字用的族：`doc.font` 存在且引擎认得就用它，否则退回调用方给的族。
///
/// 缺族不报错也不 panic——模板是从别的机器/品牌库带来的，字体不在本机是常态，
/// 画面退回字幕字体比整层缺席强。
pub fn resolve_family(doc: &TemplateDoc, fallback: &str, text: &TextEngine) -> String {
    doc.font
        .as_deref()
        .map(str::trim)
        .filter(|family| !family.is_empty() && text.has_family(family))
        .unwrap_or(fallback)
        .to_owned()
}

struct LayerRect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

struct PaintCtx<'a> {
    fh: f64,
    family: &'a str,
    segs: &'a [tpl::Segment],
    vars: &'a BTreeMap<String, String>,
    pct: f64,
    logos: &'a BTreeMap<String, Arc<Pixmap>>,
}

/// 字号：画面高的百分比，下限 7px（原型 `px()`）。
fn font_px(size: f64, fh: f64) -> f64 {
    (size / 100.0 * fh).max(7.0)
}

/// 字的左右内边距：层上写了 `pad`（画面高的百分比，不设字号那样的 7px 下限）就用它，
/// 否则按本层字号推的 em 数（原型 `.tpltxt` 0.5em、`.tpllogo--badge` 0.6em）。
fn pad_px(pad: Option<f64>, fh: f64, fallback: f64) -> f64 {
    pad.map_or(fallback, |p| p / 100.0 * fh)
}

fn color(raw: &str) -> SubtitleColor {
    parse_css_color(raw).unwrap_or(SubtitleColor::WHITE)
}

fn fill_rect(pixmap: &mut Pixmap, x: f64, y: f64, w: f64, h: f64, color: SubtitleColor) {
    fill_round_rect(pixmap, x, y, w, h, 0.0, color, 1.0, Transform::identity());
}

fn paint_layer(pixmap: &mut Pixmap, kind: &LayerKind, ctx: &PaintCtx<'_>, text: &mut TextEngine) {
    let w = f64::from(pixmap.width());
    let h = f64::from(pixmap.height());
    match kind {
        LayerKind::Chapters {
            fill,
            bg,
            color: fg,
            accent,
            color_done,
            divider,
            size,
        } => {
            fill_rect(pixmap, 0.0, 0.0, w, h, color(bg));
            let px = font_px(*size, ctx.fh);
            let bar_h = (h * 0.14).max(2.0);
            let total: f64 = ctx.segs.iter().map(|s| s.span).sum::<f64>().max(0.001);
            let accent = color(accent);
            let fg = color(fg);
            let done_color = color_done.as_deref().map_or(fg, color);
            let mut cursor = 0.0;
            for (index, seg) in ctx.segs.iter().enumerate() {
                let seg_w = w * seg.span / total;
                // dim：已播段整段填 accent，正在播的段按自身进度从左填
                if *fill == ChapterFill::Dim {
                    let filled = match seg.state {
                        SegmentState::Done => seg_w,
                        SegmentState::On => seg_w * seg.done,
                        SegmentState::Todo => 0.0,
                    };
                    if filled > 0.0 {
                        fill_rect(pixmap, cursor, 0.0, filled, h, accent);
                    }
                }
                if *divider && index > 0 {
                    fill_rect(pixmap, cursor, 0.0, 1.0, h, fg);
                }
                let (title_color, weight) = match seg.state {
                    SegmentState::Todo => (fg, 700),
                    SegmentState::On => (done_color, 800),
                    SegmentState::Done => (done_color, 700),
                };
                let pad = px * 0.6;
                draw_text_in_box(
                    pixmap,
                    text,
                    &seg.title,
                    ctx.family,
                    px,
                    weight,
                    title_color,
                    (cursor + pad, 0.0, (seg_w - pad * 2.0).max(0.0), h),
                    TextAlign::Left,
                );
                if *fill == ChapterFill::Bar && seg.done > 0.0 {
                    fill_rect(pixmap, cursor, h - bar_h, seg_w * seg.done, bar_h, accent);
                }
                cursor += seg_w;
            }
        }
        LayerKind::Progress { accent, track } => {
            let radius = h / 2.0;
            fill_round_rect(
                pixmap,
                0.0,
                0.0,
                w,
                h,
                radius,
                color(track),
                1.0,
                Transform::identity(),
            );
            let filled = w * ctx.pct;
            if filled > 0.0 {
                // 与原型一致：填充条被外层 `border-radius: 999px` 裁掉两端
                let mut mask = Pixmap::new(pixmap.width(), pixmap.height());
                if let Some(mask) = mask.as_mut() {
                    fill_rect(mask, 0.0, 0.0, filled, h, color(accent));
                    clip_round(mask, radius);
                    pixmap.draw_pixmap(
                        0,
                        0,
                        mask.as_ref(),
                        &PixmapPaint::default(),
                        Transform::identity(),
                        None,
                    );
                }
            }
        }
        LayerKind::Logo {
            src,
            text: label,
            bg,
            color: fg,
            shape,
            size,
            align,
            pad,
            ..
        } => {
            if let Some(key) = TemplateScene::logo_key(src) {
                match ctx.logos.get(key) {
                    Some(image) => {
                        let mut local = Pixmap::new(pixmap.width(), pixmap.height());
                        if let Some(local) = local.as_mut() {
                            // 等比放进盒子，横向余量按 `align` 分：靠左贴左缘、靠右贴右缘
                            let anchor = match align {
                                TextAlign::Left => 0.0,
                                TextAlign::Center => 0.5,
                                TextAlign::Right => 1.0,
                            };
                            draw_fit_pixmap_at(
                                local,
                                image,
                                timeline::schema::Fit::Contain,
                                1.0,
                                anchor,
                            );
                            pixmap.draw_pixmap(
                                0,
                                0,
                                local.as_ref(),
                                &PixmapPaint::default(),
                                Transform::identity(),
                                None,
                            );
                        }
                    }
                    // 图片找不到：画底色占位（原型 `background: l.bg`），不让层整个消失
                    None => {
                        if let Some(bg) = bg {
                            fill_round_rect(
                                pixmap,
                                0.0,
                                0.0,
                                w,
                                h,
                                6.0,
                                color(bg),
                                1.0,
                                Transform::identity(),
                            );
                        }
                    }
                }
                return;
            }
            let px = font_px(*size, ctx.fh);
            let badge = *shape == LogoShape::Badge;
            if let Some(bg) = bg {
                let radius = if badge { px * 0.3 } else { 0.0 };
                fill_round_rect(
                    pixmap,
                    0.0,
                    0.0,
                    w,
                    h,
                    radius,
                    color(bg),
                    1.0,
                    Transform::identity(),
                );
            }
            let pad = pad_px(*pad, ctx.fh, if badge { px * 0.6 } else { 0.0 });
            draw_text_in_box(
                pixmap,
                text,
                label,
                ctx.family,
                px,
                800,
                color(fg),
                (pad, 0.0, (w - pad * 2.0).max(0.0), h),
                *align,
            );
        }
        LayerKind::Text {
            text: template,
            color: fg,
            bg,
            align,
            size,
            pad,
            mono,
            weight,
        } => {
            if let Some(bg) = bg {
                fill_rect(pixmap, 0.0, 0.0, w, h, color(bg));
            }
            let px = font_px(*size, ctx.fh);
            let family = if *mono { MONO_FAMILY } else { ctx.family };
            let pad = pad_px(*pad, ctx.fh, px * 0.5);
            draw_text_in_box(
                pixmap,
                text,
                &tpl::fill(template, ctx.vars),
                family,
                px,
                *weight,
                color(fg),
                (pad, 0.0, (w - pad * 2.0).max(0.0), h),
                *align,
            );
        }
    }
}

/// 平铺台标固定铺的枚数：与盒子多大无关，盒子越小越挤（原型 `Array.from({length: 24})`）。
pub(crate) const TILE_UNITS: usize = 24;
/// 平铺整体绕盒心的旋转角（度，负 = 逆时针）与放大倍数（`rotate(-16deg) scale(1.35)`）。
const TILE_ROTATE_DEG: f32 = -16.0;
const TILE_SCALE: f32 = 1.35;

/// 平铺台标（水印）：同一枚台标按 CSS flex 换行铺进盒子，盒内裁切后整体绕盒心斜放放大。
///
/// 文字单元 800 字重、字距 0.04em；图片单元 3.2em × 1.6em，图片按 contain 落进单元，
/// 品牌库里没有这张图时画 0.3em 圆角的底色占位（与不平铺时同一口径）。
fn paint_tile(
    frame: &mut Pixmap,
    rect: &LayerRect,
    kind: &LayerKind,
    ctx: &PaintCtx<'_>,
    text: &mut TextEngine,
) {
    let LayerKind::Logo {
        src,
        text: label,
        bg,
        color: fg,
        size,
        ..
    } = kind
    else {
        return;
    };
    let em = font_px(*size, ctx.fh);
    // 盒子局部像素 → 画面：先绕盒心放大、再旋转（`transform-origin: 50% 50%`）
    let transform = Transform::from_translate(-(rect.w / 2.0) as f32, -(rect.h / 2.0) as f32)
        .post_scale(TILE_SCALE, TILE_SCALE)
        .post_rotate(TILE_ROTATE_DEG)
        .post_translate(
            (rect.x + rect.w / 2.0) as f32,
            (rect.y + rect.h / 2.0) as f32,
        );
    if let Some(key) = TemplateScene::logo_key(src) {
        let (unit_w, unit_h) = (3.2 * em, 1.6 * em);
        let image = ctx.logos.get(key);
        for (x, y) in tile_positions(rect.w, rect.h, em, unit_w, unit_h, TILE_UNITS) {
            match image {
                Some(image) => {
                    let iw = f64::from(image.width().max(1));
                    let ih = f64::from(image.height().max(1));
                    let scale = (unit_w / iw).min(unit_h / ih);
                    let placement = Transform::from_scale(scale as f32, scale as f32)
                        .post_translate(
                            (x + (unit_w - iw * scale) / 2.0) as f32,
                            (y + (unit_h - ih * scale) / 2.0) as f32,
                        )
                        .post_concat(transform);
                    frame.draw_pixmap(
                        0,
                        0,
                        (**image).as_ref(),
                        &PixmapPaint {
                            quality: FilterQuality::Bilinear,
                            ..Default::default()
                        },
                        placement,
                        None,
                    );
                }
                None => {
                    if let Some(bg) = bg {
                        fill_round_rect(
                            frame,
                            x,
                            y,
                            unit_w,
                            unit_h,
                            em * 0.3,
                            color(bg),
                            1.0,
                            transform,
                        );
                    }
                }
            }
        }
    } else {
        if label.trim().is_empty() {
            return;
        }
        let shaped = text.shape(label, ctx.family, em, 800);
        // CSS `letter-spacing` 加在每个字之后（含最后一个），单元宽随之变宽
        let spacing = em * 0.04;
        let unit_w = shaped.width + label.chars().count() as f64 * spacing;
        let unit_h = shaped.ascent + shaped.descent;
        let offsets: Vec<f64> = shaped
            .glyphs
            .iter()
            .map(|glyph| {
                label
                    .get(..glyph.cluster.start)
                    .map_or(0, |head| head.chars().count()) as f64
                    * spacing
            })
            .collect();
        let fill = color(fg);
        let paint = glyph_paint(fill);
        for (x, y) in tile_positions(rect.w, rect.h, em, unit_w, unit_h, TILE_UNITS) {
            for (glyph, offset) in shaped.glyphs.iter().zip(&offsets) {
                let origin = Transform::from_translate(
                    (x + glyph.x + offset) as f32,
                    (y + shaped.ascent + glyph.y) as f32,
                )
                .post_concat(transform);
                paint_glyph(frame, text, glyph, origin, &paint, fill);
            }
        }
    }
    // `.tpllogo { overflow: hidden }` 裁在变换之前的盒子上：裁切区是随层一起斜放放大的盒子
    let Some(bounds) = Rect::from_xywh(0.0, 0.0, rect.w as f32, rect.h as f32) else {
        return;
    };
    let Some(mut mask) = tiny_skia::Mask::new(frame.width(), frame.height()) else {
        return;
    };
    mask.fill_path(
        &PathBuilder::from_rect(bounds),
        FillRule::Winding,
        true,
        transform,
    );
    frame.apply_mask(&mask);
}

/// 平铺单元在盒子里的左上角（盒子局部像素），按原型的 flex 换行排：
/// `padding: 1em`、`gap: 1.6em 2.4em`，行内 `justify-content` 与行间 `align-content`
/// 都是 `space-around`。剩余空间为负时两者都退回 `safe center`，也就是贴起点往后溢出
/// （CSS Box Alignment 的回退值；Chromium 实测台标盒 24 行、缩略格单枚宽于内容区时
/// 首枚都落在 `padding` 处），不是居中。
pub(crate) fn tile_positions(
    box_w: f64,
    box_h: f64,
    em: f64,
    unit_w: f64,
    unit_h: f64,
    count: usize,
) -> Vec<(f64, f64)> {
    if count == 0 {
        return Vec::new();
    }
    let pad = em;
    let (row_gap, col_gap) = (em * 1.6, em * 2.4);
    let content_w = (box_w - pad * 2.0).max(0.0);
    let content_h = (box_h - pad * 2.0).max(0.0);
    // 等宽单元的贪心换行：一行放得下 n 枚 ⇔ n·w + (n−1)·gap ≤ 内容宽；至少一枚
    let per_line = ((content_w + col_gap) / (unit_w + col_gap) + 1e-9).floor();
    let per_line = (per_line.max(1.0) as usize).min(count);
    let lines = count.div_ceil(per_line);
    let (top, row_step) = space_around(content_h, lines, unit_h, row_gap);
    let mut out = Vec::with_capacity(count);
    for line in 0..lines {
        let n = per_line.min(count - line * per_line);
        let (left, col_step) = space_around(content_w, n, unit_w, col_gap);
        let y = pad + top + line as f64 * row_step;
        out.extend((0..n).map(|i| (pad + left + i as f64 * col_step, y)));
    }
    out
}

/// `space-around` 沿一条轴排 `n` 个等长项（项间另有固定 `gap`）：首项偏移与步长。
/// 放不下时按 `safe center` 贴起点，溢出只往后走。
fn space_around(avail: f64, n: usize, size: f64, gap: f64) -> (f64, f64) {
    let n_f = n.max(1) as f64;
    let free = avail - n_f * size - (n_f - 1.0) * gap;
    if free > 0.0 {
        (free / (2.0 * n_f), size + gap + free / n_f)
    } else {
        (0.0, size + gap)
    }
}

/// 只保留圆角胶囊范围内的像素（进度线的 `overflow: hidden; border-radius: 999px`）。
fn clip_round(pixmap: &mut Pixmap, radius: f64) {
    let w = pixmap.width() as f32;
    let h = pixmap.height() as f32;
    let Some(rect) = Rect::from_xywh(0.0, 0.0, w, h) else {
        return;
    };
    let Some(mut mask) = tiny_skia::Mask::new(pixmap.width(), pixmap.height()) else {
        return;
    };
    let path = rounded_rect_path(0.0, 0.0, f64::from(w), f64::from(h), radius)
        .unwrap_or_else(|| PathBuilder::from_rect(rect));
    mask.fill_path(&path, FillRule::Winding, true, Transform::identity());
    pixmap.apply_mask(&mask);
}

/// 单行文字贴进盒子：垂直居中、按 `align` 水平对齐、超出右边按字形截断
/// （原型 `white-space: nowrap; overflow: hidden`）。
#[allow(clippy::too_many_arguments)]
fn draw_text_in_box(
    pixmap: &mut Pixmap,
    text: &mut TextEngine,
    content: &str,
    family: &str,
    size: f64,
    weight: u16,
    fill: SubtitleColor,
    (bx, by, bw, bh): (f64, f64, f64, f64),
    align: TextAlign,
) {
    if content.trim().is_empty() || bw <= 0.0 {
        return;
    }
    let shaped = text.shape(content, family, size, weight);
    let x0 = match align {
        TextAlign::Left => bx,
        TextAlign::Center => bx + (bw - shaped.width) / 2.0,
        TextAlign::Right => bx + bw - shaped.width,
    }
    .max(bx);
    let baseline = by + (bh - (shaped.ascent + shaped.descent)) / 2.0 + shaped.ascent;
    let limit = bx + bw;
    let paint = glyph_paint(fill);
    for glyph in &shaped.glyphs {
        // 超出盒子右缘的字形整颗不画（文字截断）
        if x0 + glyph.x >= limit {
            break;
        }
        let origin = Transform::from_translate((x0 + glyph.x) as f32, (baseline + glyph.y) as f32);
        paint_glyph(pixmap, text, glyph, origin, &paint, fill);
    }
}

fn glyph_paint(fill: SubtitleColor) -> Paint<'static> {
    let mut paint = Paint::default();
    paint.set_color_rgba8(fill.r, fill.g, fill.b, 255 - fill.a);
    paint.anti_alias = true;
    paint
}

/// 一颗字形画到 `origin`（字形原点 = 基线起点，已含调用方的整体变换）。
fn paint_glyph(
    pixmap: &mut Pixmap,
    text: &mut TextEngine,
    glyph: &ShapedGlyph,
    origin: Transform,
    paint: &Paint<'_>,
    fill: SubtitleColor,
) {
    match text.glyph_render(glyph.cache_key) {
        GlyphRender::Outline(path) => {
            pixmap.fill_path(&path, paint, FillRule::Winding, origin, None);
        }
        GlyphRender::ColorBitmap {
            width,
            height,
            rgba,
            left,
            top,
        } => {
            let Some(bitmap) = PixmapRef::from_bytes(&rgba, width, height) else {
                return;
            };
            let placement = Transform::from_translate(left as f32, -top as f32).post_concat(origin);
            pixmap.draw_pixmap(
                0,
                0,
                bitmap,
                &PixmapPaint {
                    opacity: f32::from(255 - fill.a) / 255.0,
                    quality: FilterQuality::Bilinear,
                    ..Default::default()
                },
                placement,
                None,
            );
        }
        GlyphRender::Empty => {}
    }
}

/// 没有文件系统的宿主（浏览器 wasm）手上的模板输入：层文档 + 章节 + 标题 + 台标像素。
///
/// 章节与标题由宿主从它已经持有的文档里取；台标图片由宿主按 [`Self::logo_keys`]
/// 取字节、用平台解码器解成 straight-alpha RGBA 后逐枚交进来。这里只做预乘与组装，
/// 场景规则仍是 [`TemplateScene::new`] 那一份——与 `bcut-workspace::template_scene_for`
/// 喂给导出的是同一个结构。
#[derive(Clone)]
pub struct TemplateSource {
    doc: TemplateDoc,
    chapters: Vec<ChapterSpan>,
    title: String,
    logos: BTreeMap<String, Pixmap>,
}

impl TemplateSource {
    /// `doc` 是 `timeline.json` 的 `template`；`chapters` 是输出时钟上的
    /// `[{id, title, start, end}]`，缺时间或零长的章直接丢掉（与章节投影的口径一致）。
    pub fn from_json(doc: &str, chapters: &str, title: &str) -> Result<Self> {
        let doc: TemplateDoc = serde_json::from_str(doc).context("解析模板文档")?;
        let list: serde_json::Value = serde_json::from_str(chapters).context("解析章节表")?;
        let text = |item: &serde_json::Value, key: &str| {
            item.get(key)
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default()
                .to_owned()
        };
        let chapters = list
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| {
                        let start = item.get("start")?.as_f64()?;
                        let end = item.get("end")?.as_f64()?;
                        (end > start).then(|| ChapterSpan {
                            id: text(item, "id"),
                            title: text(item, "title"),
                            start,
                            end,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        Ok(Self {
            doc,
            chapters,
            title: title.to_owned(),
            logos: BTreeMap::new(),
        })
    }

    /// 文档里图片台标的 key（按层序去重）：宿主据此去取图。
    pub fn logo_keys(&self) -> Vec<String> {
        let mut keys: Vec<String> = Vec::new();
        for layer in &self.doc.layers {
            let LayerKind::Logo { src, .. } = &layer.kind else {
                continue;
            };
            if let Some(key) = TemplateScene::logo_key(src)
                && !keys.iter().any(|known| known == key)
            {
                keys.push(key.to_owned());
            }
        }
        keys
    }

    /// 装一枚台标：`rgba` 是 straight-alpha（浏览器 `getImageData` 的形态），这里预乘。
    pub fn set_logo_rgba(
        &mut self,
        key: &str,
        width: u32,
        height: u32,
        rgba: Vec<u8>,
    ) -> Result<()> {
        let size = tiny_skia::IntSize::from_wh(width, height).context("台标尺寸必须大于零")?;
        if rgba.len() != width as usize * height as usize * 4 {
            anyhow::bail!("台标 {key}: RGBA 长度与 {width}×{height} 不符");
        }
        let mut rgba = rgba;
        for pixel in rgba.chunks_exact_mut(4) {
            let alpha = u16::from(pixel[3]);
            if alpha < 255 {
                for channel in &mut pixel[..3] {
                    *channel = ((u16::from(*channel) * alpha + 127) / 255) as u8;
                }
            }
        }
        let pixmap = Pixmap::from_vec(rgba, size).context("台标 RGBA 缓冲区无效")?;
        self.logos.insert(key.to_owned(), pixmap);
        Ok(())
    }

    /// 组装当前场景（台标缺的那几枚按文字台标画，与导出读不到品牌 logo 时同一退路）。
    pub fn scene(&self) -> TemplateScene {
        TemplateScene::new(
            self.doc.clone(),
            self.chapters.clone(),
            self.title.clone(),
            self.logos
                .iter()
                .map(|(key, pixmap)| (key.clone(), pixmap.clone()))
                .collect(),
        )
    }
}
