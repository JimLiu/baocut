//! `Lottie`：bodymovin 子集的纯 Rust [`VisualSource`]（设计 §7 / ADR-M11）。
//!
//! **主路径不是光栅化，是发 DrawOp**：形状 / 描边 / 渐变 / 遮罩 / 预合成全部
//! 落到 `FillPathPaint`、`StrokePathPaint`、`ClipPath`、`PushMatte` 这些原语上，
//! 与 BCF 自己的元素共用同一条指令流、同一份帧指纹、同一套静止帧缓存；矢量
//! 内容跟着元素盒缩放，不会先烤成素材原尺寸的位图再拉伸。
//!
//! 子集边界由 2026-08-20 的 100 素材普查划定（`core/fixtures/lottie/README.md`
//! 与设计 §14 开放问题 #1），**解析期就是守门人**：
//!
//! | | 首版处置 |
//! | --- | --- |
//! | shapes / gradients / trimPaths / masks(add) / mattes / precomps(含 tm) / solids / images / markers / roundedCorners / blendModes / mergePaths `mm=1` / 关键帧动画 | 支持 |
//! | 无 expressions 的 `ef ty ∈ 0..=7` 表达式控制器组 | 忽略 + [`LOTTIE_RULE`] warn |
//! | text 图层、expressions、布尔 merge、光栅效果、repeater、3D、autoOrient、非 add 遮罩、遮罩羽化 | [`LOTTIE_RULE`] fail-fast |
//!
//! 不静默降级：拿不准的东西一律报错，而不是画一张"差不多"的图。
//!
//! 字节可以是展开的 bodymovin JSON，也可以是 `.lottie` 压缩包（[`archive`]）：包里取一段动画，
//! 图片子资源从包里补成内嵌字节。图片子资源可以是位图（PNG / JPEG / GIF 首帧 / WebP）或 SVG（`svg` feature，
//! 按资源声明的 `w`×`h` 光栅）。

pub mod archive;
pub mod geometry;
pub mod lower;
pub mod schema;
pub mod value;

use super::{
    ContentHash, MediaTime, PrepareCtx, SourceFrame, SourceKind, SourceLoop, SourceMetadata,
    VisualSource,
};
use crate::drawop::FrameBuilder;
use crate::plan::PreflightDiagnostic;
use anyhow::{Result, anyhow, bail};
use geometry::Affine;
use schema::{Animation, Diagnostics};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::sync::Arc;
use tiny_skia::Pixmap;

/// 规范 §16 的诊断码。warn（表达式控制器）与 fail（子集之外）共用一个码，
/// 靠 severity 区分——`bcut lint` 的表就是这么组织的。
pub const LOTTIE_RULE: &str = "lottie-unsupported-feature";

/// 指纹里的渲染器身份。lowering 语义（路径生成、trim 采样数、渐变色标合并）
/// 一改就必须换指纹，否则旧缓存会喂出新像素。
const RENDERER_TAG: &[u8] = b"bcut.source.lottie/v1\0";

/// Lottie 文档引用的一个图片子资源。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImageRequirement {
    /// bodymovin `assets[].id`
    pub id: String,
    /// DrawOp string 侧表里的资产名（全局唯一，形如 `lottie:<owner>/<id>`）
    pub asset_name: String,
    /// 相对 **Lottie 文档所在目录** 的路径；内嵌资源为 `None`
    pub path: Option<String>,
    /// 内嵌的字节：data URI（`e: 1`），或 `.lottie` 压缩包里按路径找到的文件
    pub embedded: Option<Vec<u8>>,
    /// 资源声明的宽高（`w` / `h`，取整；没写是 0）。SVG 子资源按它光栅。
    pub width: u32,
    pub height: u32,
}

impl ImageRequirement {
    /// 子资源字节 → 预乘的像素。SVG（`svg` feature）按声明的宽高光栅（没声明时用 SVG 自己的尺寸），
    /// 位图按原尺寸解码。解不开是 `lottie-asset-missing` 错误。各条读入路径（内嵌、压缩包、磁盘）共用这一份。
    pub fn decode(&self, bytes: &[u8]) -> Result<Pixmap> {
        let missing =
            |what: String| anyhow!("lottie-asset-missing: 图片子资源 \"{}\" {what}", self.id);
        if looks_like_svg(bytes) {
            return decode_svg(bytes, self.width, self.height)
                .map_err(|e| missing(format!("是 SVG，{e}")));
        }
        let image = image::load_from_memory(bytes)
            .map_err(|e| missing(format!("解不开：{e}")))?
            .to_rgba8();
        let (w, h) = (image.width(), image.height());
        let mut raw = image.into_raw();
        for px in raw.chunks_exact_mut(4) {
            let pm = tiny_skia::ColorU8::from_rgba(px[0], px[1], px[2], px[3]).premultiply();
            px.copy_from_slice(&[pm.red(), pm.green(), pm.blue(), pm.alpha()]);
        }
        tiny_skia::IntSize::from_wh(w, h)
            .and_then(|size| Pixmap::from_vec(raw, size))
            .ok_or_else(|| missing("是零尺寸".into()))
    }
}

/// 字节看起来是不是 SVG（跳过 BOM 与前导空白后以 `<svg` / `<?xml` 开头）。
fn looks_like_svg(bytes: &[u8]) -> bool {
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    let start = bytes
        .iter()
        .position(|b| !b.is_ascii_whitespace())
        .unwrap_or(bytes.len());
    let head = &bytes[start..];
    head.starts_with(b"<svg") || head.starts_with(b"<?xml")
}

/// SVG 子资源光栅到 `width`×`height`（两边各自缩放，与位图子资源按声明框铺满同口径）；没声明时用 SVG 自己的尺寸。
#[cfg(feature = "svg")]
fn decode_svg(bytes: &[u8], width: u32, height: u32) -> Result<Pixmap> {
    use resvg::usvg::Tree;
    let tree = Tree::from_data(bytes, &crate::svg::svg_options())?;
    let size = tree.size();
    let (sw, sh) = (size.width(), size.height());
    if sw <= 0.0 || sh <= 0.0 {
        bail!("尺寸为零");
    }
    let (w, h) = if width > 0 && height > 0 {
        (width, height)
    } else {
        (sw.ceil() as u32, sh.ceil() as u32)
    };
    let mut pixmap = Pixmap::new(w.max(1), h.max(1)).ok_or_else(|| anyhow!("尺寸为零"))?;
    let transform = tiny_skia::Transform::from_scale(w.max(1) as f32 / sw, h.max(1) as f32 / sh);
    resvg::render(&tree, transform, &mut pixmap.as_mut());
    Ok(pixmap)
}

#[cfg(not(feature = "svg"))]
fn decode_svg(_bytes: &[u8], _width: u32, _height: u32) -> Result<Pixmap> {
    bail!("这份构建不带 SVG 光栅（render-raster 的 `svg` feature）")
}

pub struct Lottie {
    doc: Animation,
    meta: SourceMetadata,
    /// 文档字节的摘要；子资源摘要在 [`Lottie::attach_images`] 里并进来
    doc_digest: [u8; 32],
    hash: ContentHash,
    diagnostics: Vec<PreflightDiagnostic>,
    requirements: Vec<ImageRequirement>,
    /// bodymovin asset id → DrawOp 资产名
    image_names: BTreeMap<String, String>,
    /// 独立采样（[`VisualSource::sample`]）用的像素；元素路径走 `MediaStore`
    images: BTreeMap<String, Arc<Pixmap>>,
    /// 已挂子资源的 `(资产名, 字节摘要)`，按名排序——换色与挂图谁先谁后都得到
    /// 同一个指纹（[`Lottie::rehash`]）。
    image_digests: Vec<(String, [u8; 32])>,
}

impl Lottie {
    /// 字节 → 已校验的 Lottie 源。
    ///
    /// `owner` 是 BCF 的 asset id（子资源命名用），`src` 只用于报错定位。
    /// 子集之外的特性在这里就是 `Err`，warn 级进 [`Lottie::diagnostics`]。
    ///
    /// `.lottie` 压缩包按 [`archive`] 的规则取一段动画；只写路径的图片子资源先在包里找，找到的
    /// 补成 [`ImageRequirement::embedded`]，找不到的留着路径（之后照旧是 `lottie-asset-missing`）。
    pub fn parse(owner: &str, src: &str, bytes: &[u8]) -> Result<Lottie> {
        let zip = if archive::looks_like_zip(bytes) {
            let opened = archive::Archive::open(bytes)
                .map_err(|e| anyhow!("{src}：`.lottie` 压缩包读不开（{e}）"))?;
            let (name, json) = opened.animation().map_err(|e| anyhow!("{src}：{e}"))?;
            Some((opened, name, json))
        } else {
            None
        };
        let (json, label) = match &zip {
            Some((_, name, json)) => (json.as_slice(), format!("{src}#{name}")),
            None => (bytes, src.to_owned()),
        };
        let src = label.as_str();
        let value: serde_json::Value =
            serde_json::from_slice(json).map_err(|e| anyhow!("{src}：不是合法 JSON（{e}）"))?;
        let mut diagnostics = Diagnostics::default();
        let doc = schema::parse(src, &value, &mut diagnostics)?;
        if doc.width <= 0.0 || doc.height <= 0.0 {
            bail!("{src}：合成尺寸非法 {}×{}", doc.width, doc.height);
        }

        let mut requirements = Vec::new();
        let mut image_names = BTreeMap::new();
        for asset in doc.images.values() {
            let asset_name = format!("lottie:{owner}/{}", asset.id);
            image_names.insert(asset.id.clone(), asset_name.clone());
            let embedded = match (&asset.embedded, &asset.path, &zip) {
                (Some(inline), _, _) => Some(inline.clone()),
                (None, Some(path), Some((opened, _, _))) => opened
                    .resolve(path)
                    .map_err(|e| anyhow!("{src}：图片子资源 \"{}\"：{e}", asset.id))?,
                _ => None,
            };
            let side = |v: f64| {
                if v.is_finite() && v > 0.0 {
                    v.round().min(16384.0) as u32
                } else {
                    0
                }
            };
            requirements.push(ImageRequirement {
                id: asset.id.clone(),
                asset_name,
                path: asset.path.clone(),
                embedded,
                width: side(asset.width),
                height: side(asset.height),
            });
        }
        requirements.sort_by(|a, b| a.id.cmp(&b.id));

        let doc_digest: [u8; 32] = {
            let mut hasher = Sha256::new();
            hasher.update(RENDERER_TAG);
            hasher.update(bytes);
            hasher.finalize().into()
        };

        let meta = SourceMetadata {
            kind: SourceKind::Lottie,
            width: doc.width.round().max(1.0) as u32,
            height: doc.height.round().max(1.0) as u32,
            frame_starts_ms: frame_table(doc.ip, doc.op, doc.fr),
            // Lottie 容器不带播放遍数：播放器一律循环，文档写不写 `loop` 才是判据
            loops: SourceLoop::Infinite,
        };
        Ok(Lottie {
            doc,
            meta,
            doc_digest,
            hash: ContentHash::new(doc_digest),
            diagnostics: diagnostics.into_inner(),
            requirements,
            image_names,
            images: BTreeMap::new(),
            image_digests: Vec::new(),
        })
    }

    /// 解码并挂上**内嵌**的图片子资源（data URI 或 `.lottie` 包里的文件；位图与 SVG 见 [`ImageRequirement::decode`]），
    /// 不读盘、不依赖 `media`，预览的 WASM 与原生同一份。只有路径、没有内嵌字节的子资源，或解不开的格式是
    /// `lottie-asset-missing` 错误。返回挂上的个数。
    pub fn attach_embedded_images(&mut self) -> Result<usize> {
        let mut loaded = Vec::new();
        for requirement in &self.requirements {
            let Some(bytes) = &requirement.embedded else {
                bail!(
                    "lottie-asset-missing: 图片子资源 \"{}\"（{}）不是内嵌的",
                    requirement.id,
                    requirement.path.as_deref().unwrap_or("<无路径>")
                );
            };
            let pixmap = requirement.decode(bytes)?;
            loaded.push((
                requirement.asset_name.clone(),
                bytes.clone(),
                Arc::new(pixmap),
            ));
        }
        let count = loaded.len();
        self.attach_images(loaded);
        Ok(count)
    }

    /// 产品层 `sticker.fillOverrides` 的 Lottie 落点：把文档里所有**纯色**填充 /
    /// 描边（`fl` / `st`，含关键帧的段首段末值）与纯色图层（solid）中，颜色等于
    /// 覆盖表键的，换成对应值。键与值都是 `#RRGGBB`（大小写不敏感；带 `AA` 的
    /// 值只取 RGB——Lottie 的透明度是独立属性，不在换色范围内）。
    ///
    /// 渐变不换：SVG 侧的 `svg_fill::apply_overrides` 同样只认纯色，两边口径
    /// 一致，属性页也只从纯色里采可编辑色。
    ///
    /// 返回命中的属性数；覆盖表并进内容指纹，同源不同覆盖表的两份 Lottie
    /// 指纹必不相同（静止帧缓存与素材共享都按指纹走）。
    pub fn apply_fill_overrides(&mut self, overrides: &BTreeMap<String, String>) -> usize {
        let table: Vec<([f64; 3], [f64; 3])> = overrides
            .iter()
            .filter_map(|(from, to)| Some((parse_hex_rgb(from)?, parse_hex_rgb(to)?)))
            .collect();
        if table.is_empty() {
            return 0;
        }
        let mut hits = 0;
        for layer in self
            .doc
            .layers
            .iter_mut()
            .chain(self.doc.precomps.values_mut().flatten())
        {
            match &mut layer.kind {
                schema::LayerKind::Solid { color, .. } => {
                    if let Some(to) = lookup_color(&table, *color) {
                        *color = to;
                        hits += 1;
                    }
                }
                schema::LayerKind::Shape(items) => hits += recolor_shapes(items, &table),
                _ => {}
            }
        }
        if hits > 0 {
            let mut hasher = Sha256::new();
            hasher.update(RENDERER_TAG);
            hasher.update(self.doc_digest);
            hasher.update(b"fill-overrides\0");
            for (from, to) in overrides {
                hasher.update((from.len() as u32).to_le_bytes());
                hasher.update(from.to_ascii_lowercase().as_bytes());
                hasher.update((to.len() as u32).to_le_bytes());
                hasher.update(to.to_ascii_lowercase().as_bytes());
            }
            self.doc_digest = hasher.finalize().into();
            self.rehash();
        }
        hits
    }

    /// warn 级诊断（表达式控制器等）。fail 级在 [`Lottie::parse`] 就是 `Err`。
    pub fn diagnostics(&self) -> &[PreflightDiagnostic] {
        &self.diagnostics
    }

    /// 需要 host 预加载的图片子资源（按 asset id 排序，确定性）。
    pub fn image_requirements(&self) -> &[ImageRequirement] {
        &self.requirements
    }

    /// 挂上已解码的子资源，并把它们的字节摘要并进内容指纹。
    ///
    /// `loaded` 是 `(资产名, 原始字节, 已解码像素)`；顺序无关——内部按资产名
    /// 排序后再进哈希链，因此 host 用什么顺序读盘都得到同一个指纹。
    pub fn attach_images(&mut self, loaded: Vec<(String, Vec<u8>, Arc<Pixmap>)>) {
        for (name, bytes, pixmap) in loaded {
            let digest: [u8; 32] = Sha256::digest(&bytes).into();
            self.image_digests.retain(|(existing, _)| *existing != name);
            self.image_digests.push((name.clone(), digest));
            self.images.insert(name, pixmap);
        }
        self.image_digests.sort_by(|a, b| a.0.cmp(&b.0));
        self.rehash();
    }

    /// 内容指纹 = 渲染器身份 ∘ 文档摘要（含换色表）∘ 子资源摘要链。
    fn rehash(&mut self) {
        let mut hasher = Sha256::new();
        hasher.update(RENDERER_TAG);
        hasher.update(self.doc_digest);
        for (name, digest) in &self.image_digests {
            hasher.update((name.len() as u32).to_le_bytes());
            hasher.update(name.as_bytes());
            hasher.update(digest);
        }
        self.hash = ContentHash::new(hasher.finalize().into());
    }

    pub fn metadata(&self) -> &SourceMetadata {
        &self.meta
    }

    /// 合成帧率。
    pub fn frame_rate(&self) -> f64 {
        self.doc.fr
    }

    /// 逐帧起点毫秒表（N+1 项）——`HostInputs` 回填给 core，录制期按它把源
    /// 时间量化到帧起点，同一帧窗口因此发出逐字节相同的指令。
    pub fn frame_starts_ms(&self) -> &[i64] {
        &self.meta.frame_starts_ms
    }

    /// bodymovin `markers`（名字 → 帧号 / 时长）。
    pub fn markers(&self) -> Vec<(String, f64, f64)> {
        self.doc
            .markers
            .iter()
            .map(|m| (m.name.clone(), m.time, m.duration))
            .collect()
    }

    /// 源时间 → 合成帧号（先量化到帧起点，再换算成整数帧）。
    fn frame_at(&self, time: MediaTime) -> f64 {
        self.doc.ip + self.meta.frame_at(time) as f64
    }

    /// **元素路径的正式入口**：把 `time` 时刻的画面直接录进指令流。
    ///
    /// `tf` 把 Lottie 的合成坐标系（左上原点、`w × h`）放到画布上，通常是
    /// 「元素盒变换 ∘ fit 缩放」。
    pub fn record(
        &self,
        time: MediaTime,
        tf: tiny_skia::Transform,
        b: &mut FrameBuilder,
    ) -> Result<()> {
        let affine = Affine {
            sx: f64::from(tf.sx),
            ky: f64::from(tf.ky),
            kx: f64::from(tf.kx),
            sy: f64::from(tf.sy),
            tx: f64::from(tf.tx),
            ty: f64::from(tf.ty),
        };
        lower::Lowering::new(&self.doc, &self.image_names).record(self.frame_at(time), affine, b)
    }
}

/// `[ip, op)` 的逐帧起点毫秒表。整数运算：`round(k * 1000 / fr)`。
fn frame_table(ip: f64, op: f64, fr: f64) -> Vec<i64> {
    let count = (op - ip).max(0.0).round() as i64;
    let count = count.max(1);
    (0..=count)
        .map(|k| ((k as f64) * 1000.0 / fr).round() as i64)
        .collect()
}

/// `#RRGGBB` / `#RRGGBBAA` → 0..1 的 RGB；其它写法一律 `None`（与 SVG 换色同口径）。
fn parse_hex_rgb(text: &str) -> Option<[f64; 3]> {
    let hex = text.trim().strip_prefix('#')?;
    if hex.len() != 6 && hex.len() != 8 {
        return None;
    }
    let channel = |at: usize| u8::from_str_radix(hex.get(at..at + 2)?, 16).ok();
    Some([
        f64::from(channel(0)?) / 255.0,
        f64::from(channel(2)?) / 255.0,
        f64::from(channel(4)?) / 255.0,
    ])
}

/// 属性值（3 或 4 分量，0..1 或 0..255 两种方言）→ 8 位量化的 RGB 三元组。
fn quantised_rgb(value: &[f64]) -> Option<[u8; 3]> {
    if value.len() < 3 {
        return None;
    }
    let mut rgb = [value[0], value[1], value[2]];
    if rgb.iter().any(|c| *c > 1.0) {
        for c in rgb.iter_mut() {
            *c /= 255.0;
        }
    }
    Some(rgb.map(|c| (c.clamp(0.0, 1.0) * 255.0).round() as u8))
}

fn lookup_color(table: &[([f64; 3], [f64; 3])], value: [f64; 3]) -> Option<[f64; 3]> {
    let wanted = quantised_rgb(&value)?;
    table
        .iter()
        .find(|(from, _)| quantised_rgb(from) == Some(wanted))
        .map(|(_, to)| *to)
}

/// 换掉一条 `Animated` 颜色里的所有纯色值（静态值、关键帧段首、段末）。
fn recolor_animated(color: &mut value::Animated, table: &[([f64; 3], [f64; 3])]) -> usize {
    let mut hits = 0;
    let mut swap = |slot: &mut Vec<f64>| {
        if slot.len() < 3 {
            return;
        }
        if let Some(to) = lookup_color(table, [slot[0], slot[1], slot[2]]) {
            slot[0] = to[0];
            slot[1] = to[1];
            slot[2] = to[2];
            hits += 1;
        }
    };
    match color {
        value::Animated::Static(values) => swap(values),
        value::Animated::Keyframed(frames) => {
            for frame in frames {
                swap(&mut frame.start);
                if let Some(end) = frame.end.as_mut() {
                    swap(end);
                }
            }
        }
    }
    hits
}

fn recolor_shapes(items: &mut [schema::ShapeItem], table: &[([f64; 3], [f64; 3])]) -> usize {
    let mut hits = 0;
    for item in items {
        match item {
            schema::ShapeItem::Group { items } => hits += recolor_shapes(items, table),
            schema::ShapeItem::Fill { color, .. } | schema::ShapeItem::Stroke { color, .. } => {
                hits += recolor_animated(color, table);
            }
            _ => {}
        }
    }
    hits
}

impl Lottie {
    /// 按**指定像素尺寸**光栅化一帧：合成坐标系等比缩放到 `width × height`。
    ///
    /// [`VisualSource::sample`] 恒用素材原尺寸，GPU 场景却是把这张纹理画进元素
    /// 盒里——1024² 的原件画进 461² 的贴纸盒，多出来的四倍像素要在 CPU 上逐层
    /// 分配、合成、上传，最后被 GPU 缩掉。缩放钉在**光栅之前**（`record` 的
    /// affine 上），于是矢量几何、描边宽度与遮罩都按目标尺寸求值，不是先出大图
    /// 再重采样。
    pub fn sample_scaled(&self, time: MediaTime, width: u32, height: u32) -> Result<SourceFrame> {
        let width = width.max(1);
        let height = height.max(1);
        let index = self.meta.frame_at(time);
        let mut builder = FrameBuilder::default();
        let tf = tiny_skia::Transform::from_scale(
            width as f32 / self.meta.width.max(1) as f32,
            height as f32 / self.meta.height.max(1) as f32,
        );
        self.record(time, tf, &mut builder)?;
        let ops = builder.finish();
        let pixmap =
            crate::raster::rasterize_with_media(&ops, width, height, &mut OwnImages(&self.images))?;
        Ok(SourceFrame {
            index,
            start: MediaTime::from_millis(self.meta.frame_starts_ms[index]),
            pixmap: Arc::new(pixmap),
        })
    }
}

/// [`VisualSource::sample`] 的媒体入口：Lottie 自己的子资源。
struct OwnImages<'a>(&'a BTreeMap<String, Arc<Pixmap>>);

impl crate::raster::FrameMedia for OwnImages<'_> {
    fn frame(&mut self, id: &str, _media_ms: i64) -> Result<Arc<Pixmap>> {
        self.0
            .get(id)
            .cloned()
            .ok_or_else(|| anyhow!("Lottie 子资源 \"{id}\" 未加载"))
    }
}

impl VisualSource for Lottie {
    fn kind(&self) -> SourceKind {
        SourceKind::Lottie
    }

    fn probe(&self) -> Result<SourceMetadata> {
        Ok(self.meta.clone())
    }

    /// 子资源在 host 侧收集并经 [`Lottie::attach_images`] 挂上；这里只复核齐全。
    fn prepare(&self, _ctx: &PrepareCtx) -> Result<()> {
        for requirement in &self.requirements {
            if !self.images.contains_key(&requirement.asset_name) {
                bail!(
                    "lottie-asset-missing: 图片子资源 \"{}\"（{}）没有被加载",
                    requirement.id,
                    requirement.path.as_deref().unwrap_or("<内嵌>")
                );
            }
        }
        Ok(())
    }

    /// 通用采样口：按**素材原尺寸**光栅化一帧。
    ///
    /// 元素渲染**不走这里**（那条路是 [`Lottie::record`]，直接发 DrawOp、跟着
    /// 元素盒缩放）；本函数留给 source conformance、`bcut probe` 的缩略与
    /// 将来可能出现的「把 Lottie 当普通图像源」的调用方。
    ///
    /// GPU 场景要的是一张纹理而不是指令流，所以它也得从这条路取像素——但必须
    /// 走 [`Lottie::sample_scaled`] 按元素盒的实际像素尺寸要，别按原件尺寸要。
    fn sample(&self, time: MediaTime) -> Result<SourceFrame> {
        self.sample_scaled(time, self.meta.width, self.meta.height)
    }

    fn fingerprint(&self) -> ContentHash {
        self.hash
    }
}

impl std::fmt::Debug for Lottie {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Lottie")
            .field("version", &self.doc.version)
            .field("size", &(self.meta.width, self.meta.height))
            .field("fps", &self.doc.fr)
            .field("frames", &self.meta.frame_count())
            .field("images", &self.requirements.len())
            .field("diagnostics", &self.diagnostics.len())
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc(extra: serde_json::Value) -> Vec<u8> {
        let mut base = serde_json::json!({
            "v": "5.7.0", "fr": 25, "ip": 0, "op": 50, "w": 64, "h": 48, "layers": []
        });
        for (k, v) in extra.as_object().unwrap() {
            base[k] = v.clone();
        }
        serde_json::to_vec(&base).unwrap()
    }

    #[test]
    fn metadata_comes_from_the_composition_header() {
        let lottie = Lottie::parse("logo", "logo.json", &doc(serde_json::json!({}))).unwrap();
        let meta = lottie.probe().unwrap();
        assert_eq!(meta.kind, SourceKind::Lottie);
        assert_eq!((meta.width, meta.height), (64, 48));
        assert_eq!(meta.frame_count(), 50);
        assert_eq!(meta.total_ms(), 2000, "50 帧 @25fps = 2s");
        assert_eq!(meta.loops, SourceLoop::Infinite);
    }

    #[test]
    fn the_frame_table_quantises_time_to_whole_composition_frames() {
        let lottie = Lottie::parse("l", "l.json", &doc(serde_json::json!({}))).unwrap();
        // 25fps ⇒ 每帧 40ms
        assert_eq!(lottie.frame_starts_ms()[..3], [0, 40, 80]);
        assert_eq!(lottie.frame_at(MediaTime::from_millis(0)), 0.0);
        assert_eq!(lottie.frame_at(MediaTime::from_millis(39)), 0.0);
        assert_eq!(lottie.frame_at(MediaTime::from_millis(40)), 1.0);
        assert_eq!(lottie.frame_at(MediaTime::from_millis(79)), 1.0);
    }

    /// 产品层换色：命中的纯色换掉、指纹跟着变；不命中什么都不动。
    #[test]
    fn fill_overrides_recolour_flat_fills_and_change_the_fingerprint() {
        let bytes = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/lottie/samples/shapes-only.json"
        ))
        .unwrap();
        let plain = Lottie::parse("s", "shapes-only.json", &bytes).unwrap();
        let mut recoloured = Lottie::parse("s", "shapes-only.json", &bytes).unwrap();
        let mut miss = Lottie::parse("s", "shapes-only.json", &bytes).unwrap();

        let mut overrides = BTreeMap::new();
        // 夹具的填充是 [0.13, 0.44, 0.9] ⇒ #2170e6（8 位量化后比对，大小写不敏感）。
        overrides.insert("#2170E6".to_owned(), "#00C853".to_owned());
        assert_eq!(recoloured.apply_fill_overrides(&overrides), 1);
        assert_ne!(plain.fingerprint(), recoloured.fingerprint());

        let mut unrelated = BTreeMap::new();
        unrelated.insert("#ff0000".to_owned(), "#00C853".to_owned());
        assert_eq!(miss.apply_fill_overrides(&unrelated), 0);
        assert_eq!(plain.fingerprint(), miss.fingerprint());

        let before = plain.sample(MediaTime::from_millis(0)).unwrap().pixmap;
        let after = recoloured.sample(MediaTime::from_millis(0)).unwrap().pixmap;
        let centre = |pixmap: &Pixmap| pixmap.pixel(100, 100).unwrap();
        assert!(centre(&before).blue() > centre(&before).green());
        assert!(centre(&after).green() > centre(&after).blue());
    }

    /// 一张 4×4 的纯色 PNG。
    fn png(rgba: [u8; 4]) -> Vec<u8> {
        let image = image::RgbaImage::from_pixel(4, 4, image::Rgba(rgba));
        let mut out = std::io::Cursor::new(Vec::new());
        image.write_to(&mut out, image::ImageFormat::Png).unwrap();
        out.into_inner()
    }

    /// 合成里只有一个图片图层，引用 `img_0`。
    fn image_doc(asset: serde_json::Value) -> serde_json::Value {
        let mut asset = asset;
        asset["id"] = serde_json::json!("img_0");
        serde_json::json!({
            "v": "5.7.0", "fr": 25, "ip": 0, "op": 25, "w": 8, "h": 8, "assets": [asset],
            "layers": [{"ty": 2, "ind": 1, "refId": "img_0", "ip": 0, "op": 25, "st": 0, "ks": {}}]
        })
    }

    fn centre(lottie: &Lottie) -> [u8; 4] {
        let frame = lottie.sample(MediaTime::from_millis(0)).unwrap().pixmap;
        let px = frame.pixel(1, 1).unwrap();
        [px.red(), px.green(), px.blue(), px.alpha()]
    }

    #[test]
    fn a_dotlottie_archive_draws_its_animation_with_images_from_the_archive() {
        let json = serde_json::to_vec(&image_doc(
            serde_json::json!({"w": 4, "h": 4, "u": "/images/", "p": "img_0.png"}),
        ))
        .unwrap();
        let bytes = archive::tests::zip(&[
            (
                "manifest.json",
                br#"{"version":"1","activeAnimationId":"hero","animations":[{"id":"hero"}]}"#,
                true,
            ),
            ("animations/hero.json", &json, true),
            ("images/img_0.png", &png([255, 0, 0, 255]), false),
        ]);
        let mut lottie = Lottie::parse("l", "hero.lottie", &bytes).unwrap();
        assert_eq!(lottie.probe().unwrap().width, 8);
        assert!(
            lottie.image_requirements()[0].embedded.is_some(),
            "包里的图片补成内嵌字节"
        );
        assert_eq!(lottie.attach_embedded_images().unwrap(), 1);
        assert_eq!(centre(&lottie), [255, 0, 0, 255]);

        // 包里没有这张图：照旧是 `lottie-asset-missing`。
        let bytes = archive::tests::zip(&[("animations/hero.json", &json, true)]);
        let mut lottie = Lottie::parse("l", "hero.lottie", &bytes).unwrap();
        let error = lottie.attach_embedded_images().unwrap_err().to_string();
        assert!(error.starts_with("lottie-asset-missing"), "{error}");

        // 读不开的包与没有动画的包是解析错误。
        assert!(
            Lottie::parse("l", "l.lottie", b"PK\x03\x04rest")
                .unwrap_err()
                .to_string()
                .contains("压缩包读不开")
        );
        let empty = archive::tests::zip(&[("images/img_0.png", b"x", false)]);
        assert!(
            Lottie::parse("l", "l.lottie", &empty)
                .unwrap_err()
                .to_string()
                .contains("没有动画")
        );
    }

    #[cfg(feature = "svg")]
    #[test]
    fn svg_images_are_rasterised_at_their_declared_size() {
        // 2×2 的 SVG 声明成 4×4：铺满声明的框。
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="%2300ff00"/></svg>"#;
        let doc = image_doc(
            serde_json::json!({"w": 4, "h": 4, "e": 1, "p": format!("data:image/svg+xml;utf8,{svg}")}),
        );
        let mut lottie = Lottie::parse("l", "l.json", &serde_json::to_vec(&doc).unwrap()).unwrap();
        lottie.attach_embedded_images().unwrap();
        assert_eq!(centre(&lottie), [0, 255, 0, 255]);
        let frame = lottie.sample(MediaTime::from_millis(0)).unwrap().pixmap;
        assert_eq!(frame.pixel(3, 3).unwrap().alpha(), 255, "铺满 4×4");
        assert_eq!(frame.pixel(5, 5).unwrap().alpha(), 0, "框外是空的");

        // 包里的 SVG 文件也一样。
        let json = serde_json::to_vec(&image_doc(
            serde_json::json!({"w": 4, "h": 4, "u": "images/", "p": "a.svg"}),
        ))
        .unwrap();
        let bytes = archive::tests::zip(&[
            ("animations/a.json", &json, true),
            ("images/a.svg", svg.replace("%23", "#").as_bytes(), true),
        ]);
        let mut lottie = Lottie::parse("l", "a.lottie", &bytes).unwrap();
        lottie.attach_embedded_images().unwrap();
        assert_eq!(centre(&lottie), [0, 255, 0, 255]);

        // 坏的 SVG：`lottie-asset-missing`。
        let doc = image_doc(
            serde_json::json!({"w": 4, "h": 4, "e": 1, "p": "data:image/svg+xml;utf8,<svg"}),
        );
        let mut lottie = Lottie::parse("l", "l.json", &serde_json::to_vec(&doc).unwrap()).unwrap();
        let error = lottie.attach_embedded_images().unwrap_err().to_string();
        assert!(error.starts_with("lottie-asset-missing"), "{error}");
    }

    #[test]
    fn sub_assets_change_the_fingerprint_and_prepare_refuses_missing_ones() {
        let bytes = doc(serde_json::json!({
            "assets": [{"id": "img_0", "w": 4, "h": 4, "u": "images/", "p": "a.png"}]
        }));
        let mut lottie = Lottie::parse("hero", "hero.json", &bytes).unwrap();
        assert_eq!(lottie.image_requirements().len(), 1);
        assert_eq!(
            lottie.image_requirements()[0].asset_name,
            "lottie:hero/img_0"
        );
        assert_eq!(
            lottie.image_requirements()[0].path.as_deref(),
            Some("images/a.png")
        );
        let bare = lottie.fingerprint();
        assert!(lottie.prepare(&PrepareCtx::default()).is_err());

        let pixmap = Arc::new(Pixmap::new(4, 4).unwrap());
        lottie.attach_images(vec![(
            "lottie:hero/img_0".into(),
            b"one".to_vec(),
            pixmap.clone(),
        )]);
        let with_a = lottie.fingerprint();
        assert_ne!(bare, with_a, "子资源必须进内容指纹");
        assert!(lottie.prepare(&PrepareCtx::default()).is_ok());

        let mut other = Lottie::parse("hero", "hero.json", &bytes).unwrap();
        other.attach_images(vec![("lottie:hero/img_0".into(), b"two".to_vec(), pixmap)]);
        assert_ne!(with_a, other.fingerprint(), "换一张子资源就换指纹");
    }

    #[test]
    fn sampling_is_random_access_and_frame_stable() {
        let bytes = doc(serde_json::json!({
            "layers": [{"ty": 4, "ind": 1, "ip": 0, "op": 50, "st": 0,
                "ks": {"p": {"a": 1, "k": [
                    {"t": 0, "s": [0, 0], "o": {"x": [0], "y": [0]}, "i": {"x": [1], "y": [1]}},
                    {"t": 50, "s": [40, 0]}]}},
                "shapes": [{"ty": "gr", "it": [
                    {"ty": "rc", "p": {"a": 0, "k": [10, 10]}, "s": {"a": 0, "k": [16, 16]},
                     "r": {"a": 0, "k": 0}},
                    {"ty": "fl", "c": {"a": 0, "k": [1, 0, 0]}, "o": {"a": 0, "k": 100}},
                    {"ty": "tr", "p": {"a": 0, "k": [0, 0]}, "a": {"a": 0, "k": [0, 0]},
                     "s": {"a": 0, "k": [100, 100]}, "r": {"a": 0, "k": 0},
                     "o": {"a": 0, "k": 100}}]}]}]
        }));
        let lottie = Lottie::parse("l", "l.json", &bytes).unwrap();
        let times: Vec<i64> = vec![0, 200, 400, 800, 1200, 1960];
        let forward: Vec<Vec<u8>> = times
            .iter()
            .map(|ms| {
                lottie
                    .sample(MediaTime::from_millis(*ms))
                    .unwrap()
                    .pixmap
                    .data()
                    .to_vec()
            })
            .collect();
        let shuffled: Vec<Vec<u8>> = times
            .iter()
            .rev()
            .map(|ms| {
                lottie
                    .sample(MediaTime::from_millis(*ms))
                    .unwrap()
                    .pixmap
                    .data()
                    .to_vec()
            })
            .collect();
        assert_eq!(
            forward,
            shuffled.into_iter().rev().collect::<Vec<_>>(),
            "乱序采样必须逐字节等于顺序采样"
        );
        // 同一帧窗口里的两个时刻取到同一张画面
        let a = lottie.sample(MediaTime::from_millis(200)).unwrap();
        let b = lottie.sample(MediaTime::from_millis(239)).unwrap();
        assert_eq!(a.index, b.index);
        assert_eq!(a.pixmap.data(), b.pixmap.data());
        // 跨帧边界必变（位置在动）
        let c = lottie.sample(MediaTime::from_millis(240)).unwrap();
        assert_ne!(a.pixmap.data(), c.pixmap.data());
    }
}
