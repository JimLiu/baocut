//! DrawOp 帧指令 IR（opencat draw_op/draw_encoding 模式的 bcut 版）：
//! record(t) 产出与后端无关的指令流 + path/string 侧表（去重），
//! 二进制编码逐字节确定 ⇒ 指纹可做静止帧缓存与跨端字节级一致性测试。
//! 媒体只以 (asset id, 媒体时刻) 引用出现——字节留在 host（FrameMediaPlan 语义）。
//! 彩色字形位图（v5）不是媒体：它与字形轮廓同类，都是录制期从字体里取出的
//! 几何/像素，因此像 path 一样**内嵌**进位图侧表，指纹覆盖它的像素。

use anyhow::{Result, bail};
use motion::effect::BlendMode;
use std::collections::HashMap;
use std::sync::Arc;

/// path 段：verb 0=Move(2) 1=Line(2) 2=Quad(4) 3=Cubic(6) 4=Close(0)
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PathSeg {
    pub verb: u8,
    pub pts: [f32; 6],
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct PathData(pub Vec<PathSeg>);

pub type Color4 = [f32; 4]; // RGBA，非预乘，0..1
pub type Mat6 = [f32; 6]; // 仿射 [sx ky kx sy tx ty]（tiny-skia from_row 序）

#[derive(Debug, Clone, PartialEq)]
pub enum DrawOp {
    Clear {
        color: Color4,
    },
    /// 圆角矩形填充（box 背景 / 字幕背景）
    FillRect {
        x: f32,
        y: f32,
        w: f32,
        h: f32,
        radius: f32,
        color: Color4,
        tf: Mat6,
    },
    FillPath {
        path: u32,
        color: Color4,
        tf: Mat6,
    },
    StrokePath {
        path: u32,
        color: Color4,
        width: f32,
        tf: Mat6,
    },
    /// 媒体引用：media_ms < 0 = 静态 image；≥0 = video 在该媒体毫秒的帧。
    /// src = 源像素裁剪矩形 [x, y, w, h]（fit: cover 用）；全零 = 整幅源。
    DrawMedia {
        asset: u32,
        media_ms: i64,
        src: [f32; 4],
        tf: Mat6,
    },
    /// 离屏层：组不透明度 + 混合模式（v3 起带 `blend`；v2 的 `PushLayer{opacity}`
    /// 解码时 blend 视为 `Normal`）。
    PushLayer {
        opacity: f32,
        blend: BlendMode,
    },
    PopLayer,
    /// 裁剪：把 `path`（经 `tf` 变换）与当前裁剪求交后压栈。
    ClipPath {
        path: u32,
        tf: Mat6,
    },
    /// 弹出一层裁剪。**不得跨越 `PushLayer`/`PopLayer` 边界**（规范 §14.5）。
    PopClip,
    /// 带 paint 侧表的填充（v4）：渐变与 even-odd 填充规则，`FillPath` 表达不了。
    FillPathPaint {
        path: u32,
        paint: u32,
        /// `true` = even-odd，`false` = nonzero（`FillPath` 恒为 nonzero）。
        even_odd: bool,
        tf: Mat6,
    },
    /// 带 paint 侧表的描边（v4）：渐变描边 + 线帽/线接头（`StrokePath` 恒为 Round/Round）。
    StrokePathPaint {
        path: u32,
        paint: u32,
        width: f32,
        /// 0=butt 1=round 2=square
        cap: u8,
        /// 0=miter 1=round 2=bevel
        join: u8,
        miter: f32,
        tf: Mat6,
    },
    /// 打开一张**遮罩源**离屏层（v4）。层内绘制不进画面，只在 [`DrawOp::PopMatte`]
    /// 时按 `mode` 折进**下面那一层**的 alpha。必须处在某个 `PushLayer` 之内。
    PushMatte,
    /// 弹出遮罩源并施加到当前层：`mode` 见 [`MatteMode`]。
    PopMatte {
        mode: u8,
    },
    /// 画一张位图侧表条目（v5）：彩色字形（`sbix` / `CBDT` / `COLR`）。`tf` 把
    /// **位图像素坐标**映射到 surface——字形的 placement 与超采样倍率在录制期
    /// 已经折进去；`opacity` 单独成字段，逐 part 淡入不会让同一张位图去重失效。
    /// 像素不受文字颜色着色（与浏览器、字幕通道一致）。
    DrawBitmap {
        bitmap: u32,
        opacity: f32,
        tf: Mat6,
    },
}

/// 轨道遮罩模式（Lottie 的 `tt`）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MatteMode {
    /// 目标 alpha ×= 遮罩 alpha
    Alpha,
    /// 目标 alpha ×= 1 − 遮罩 alpha
    AlphaInverted,
    /// 目标 alpha ×= 遮罩亮度（已按遮罩 alpha 加权）
    Luma,
    /// 目标 alpha ×= 1 − 遮罩亮度
    LumaInverted,
}

impl MatteMode {
    pub fn code(self) -> u8 {
        match self {
            MatteMode::Alpha => 0,
            MatteMode::AlphaInverted => 1,
            MatteMode::Luma => 2,
            MatteMode::LumaInverted => 3,
        }
    }

    pub fn from_code(code: u8) -> Option<MatteMode> {
        match code {
            0 => Some(MatteMode::Alpha),
            1 => Some(MatteMode::AlphaInverted),
            2 => Some(MatteMode::Luma),
            3 => Some(MatteMode::LumaInverted),
            _ => None,
        }
    }
}

/// 渐变色标。`offset` ∈ [0,1]，`color` 是非预乘 RGBA。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GradientStop {
    pub offset: f32,
    pub color: Color4,
}

/// paint 侧表条目（v4）。几何量都在 **path 本地坐标系**里——与 op 的 `tf`
/// 同一个坐标系，因此 paint 跟着路径一起变换，不需要第二份矩阵。
#[derive(Debug, Clone, PartialEq)]
pub enum PaintData {
    Solid(Color4),
    Linear {
        p0: [f32; 2],
        p1: [f32; 2],
        stops: Vec<GradientStop>,
    },
    /// `focus` 是高光点（Lottie 的 `h`/`a`）；等于 `center` 时是正圆渐变。
    Radial {
        center: [f32; 2],
        radius: f32,
        focus: [f32; 2],
        stops: Vec<GradientStop>,
    },
}

/// 位图侧表条目（v5）：**预乘** RGBA8，逐行紧排，`rgba.len() == width × height × 4`。
#[derive(Clone, PartialEq)]
pub struct BitmapData {
    pub width: u32,
    pub height: u32,
    pub rgba: Arc<[u8]>,
}

impl std::fmt::Debug for BitmapData {
    /// 只打尺寸与像素指纹：逐字节打印一张 emoji 就是几万个数字。
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("BitmapData")
            .field("width", &self.width)
            .field("height", &self.height)
            .field("rgba", &format_args!("fnv:{:016x}", fnv1a64(&self.rgba)))
            .finish()
    }
}

/// 光栅提示：`ops[..ops]` 是一段像素**只由 `key` 决定**的前缀（文档背景：
/// `Clear` + `meta.background.texture`），层栈与裁剪栈在前缀末尾都已收平。
/// CPU 光栅器按 `(key, 宽, 高)` 缓存前缀画完后的整张画面，命中时拷贝它再从
/// 第 `ops` 条接着画——逐字节等同于从头重放（光栅是确定性的）。
///
/// **不进编码、不进指纹**：指令流本身不变，不认识它的执行器（GPU、`bcut ops`）
/// 照常逐条执行；`decode` 出来的帧没有它。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StaticPrefix {
    pub key: u64,
    pub ops: usize,
}

#[derive(Debug, Default)]
pub struct FrameOps {
    pub ops: Vec<DrawOp>,
    /// 见 [`StaticPrefix`]；只有录制器在帧首写背景纹理时设置。
    pub static_prefix: Option<StaticPrefix>,
    pub paths: Vec<PathData>,
    pub strings: Vec<String>,
    /// v4 的 paint 侧表。空 ⇒ 整帧仍按 v3 编码（既有 golden 逐字节不变）。
    pub paints: Vec<PaintData>,
    /// v5 的位图侧表（彩色字形）。空 ⇒ 不升 v5。
    pub bitmaps: Vec<BitmapData>,
}

/// 录制期侧表去重（首次出现序编号 ⇒ 输出确定性）
#[derive(Default)]
pub struct FrameBuilder {
    pub frame: FrameOps,
    path_ids: HashMap<u64, u32>,
    string_ids: HashMap<String, u32>,
    paint_ids: HashMap<u64, u32>,
    bitmap_ids: HashMap<u64, u32>,
}

impl FrameBuilder {
    pub fn push(&mut self, op: DrawOp) {
        self.frame.ops.push(op);
    }

    pub fn path_id(&mut self, data: PathData) -> u32 {
        let mut bytes = Vec::with_capacity(data.0.len() * 25);
        encode_path(&data, &mut bytes);
        let key = fnv1a64(&bytes);
        if let Some(&id) = self.path_ids.get(&key) {
            return id;
        }
        let id = self.frame.paths.len() as u32;
        self.frame.paths.push(data);
        self.path_ids.insert(key, id);
        id
    }

    pub fn string_id(&mut self, s: &str) -> u32 {
        if let Some(&id) = self.string_ids.get(s) {
            return id;
        }
        let id = self.frame.strings.len() as u32;
        self.frame.strings.push(s.to_string());
        self.string_ids.insert(s.to_string(), id);
        id
    }

    /// paint 侧表去重（与 `path_id` 同一口径：编码字节的 FNV 做键）。
    pub fn paint_id(&mut self, paint: PaintData) -> u32 {
        let mut bytes = Vec::with_capacity(64);
        encode_paint(&paint, &mut bytes);
        let key = fnv1a64(&bytes);
        if let Some(&id) = self.paint_ids.get(&key) {
            return id;
        }
        let id = self.frame.paints.len() as u32;
        self.frame.paints.push(paint);
        self.paint_ids.insert(key, id);
        id
    }

    /// 位图侧表去重：键是**像素内容**（尺寸 + 字节）的 FNV，不是 `Arc` 指针——
    /// 字形缓存中途淘汰再重光栅化会换一个 `Arc`，按指针去重会让同一帧的侧表
    /// 条数随缓存状态漂移，编码就不再是 `(ir, t)` 的纯函数。
    pub fn bitmap_id(&mut self, bitmap: BitmapData) -> u32 {
        let mut head = Vec::with_capacity(8);
        put_u32(&mut head, bitmap.width);
        put_u32(&mut head, bitmap.height);
        let key = fnv1a64_continue(fnv1a64(&head), &bitmap.rgba);
        if let Some(&id) = self.bitmap_ids.get(&key) {
            return id;
        }
        let id = self.frame.bitmaps.len() as u32;
        self.frame.bitmaps.push(bitmap);
        self.bitmap_ids.insert(key, id);
        id
    }

    pub fn finish(self) -> FrameOps {
        self.frame
    }
}

/// tiny-skia Path → PathData（录制侧的唯一桥）
pub fn path_from_skia(p: &tiny_skia::Path) -> PathData {
    use tiny_skia::PathSegment as S;
    let mut out = Vec::new();
    for seg in p.segments() {
        out.push(match seg {
            S::MoveTo(p) => PathSeg {
                verb: 0,
                pts: [p.x, p.y, 0.0, 0.0, 0.0, 0.0],
            },
            S::LineTo(p) => PathSeg {
                verb: 1,
                pts: [p.x, p.y, 0.0, 0.0, 0.0, 0.0],
            },
            S::QuadTo(c, p) => PathSeg {
                verb: 2,
                pts: [c.x, c.y, p.x, p.y, 0.0, 0.0],
            },
            S::CubicTo(c1, c2, p) => PathSeg {
                verb: 3,
                pts: [c1.x, c1.y, c2.x, c2.y, p.x, p.y],
            },
            S::Close => PathSeg {
                verb: 4,
                pts: [0.0; 6],
            },
        });
    }
    PathData(out)
}

const VERB_PTS: [usize; 5] = [1, 1, 2, 3, 0];

// ── 二进制信封（LE；节顺序 strings → paths → ops）──────────────────

const MAGIC: u32 = 0x42_43_4F_50; // "BCOP"
/// **基线**信封版本：不含 v4 原语的帧一律按它编码。
///
/// * v2：`DrawMedia` 增加源裁剪矩形（fit: cover，§6.5）
/// * v3：`PushLayer` 增加 `blend`，新增 `ClipPath` / `PopClip`（ADR-M04）
/// * v4：paint 侧表（渐变 / even-odd 填充）与 `PushMatte` / `PopMatte`（ADR-M11）
/// * v5：位图侧表与 `DrawBitmap`（BCF 文字的彩色字形）
///
/// `encode` 写的是**这一帧真正需要的**版本（[`required_version`]）：一条 v4
/// 原语都没有的帧仍然产出 v3 字节。这不是省事，而是承诺——阶段 0 录下的
/// `core/fixtures/motion/` 指纹不因为「渲染器学会了画渐变」而集体换值。
pub const VERSION: u32 = 3;
/// 引入 paint 侧表与遮罩的版本。
const PAINT_VERSION: u32 = 4;
/// 引入位图侧表的版本。
const BITMAP_VERSION: u32 = 5;
/// `encode` 可能产出、`decode` 必须认得的最高版本。
pub const MAX_VERSION: u32 = BITMAP_VERSION;
/// `decode` 接受的最低版本。
pub const MIN_DECODABLE_VERSION: u32 = 2;

/// 这一帧最低需要哪个信封版本。
pub fn required_version(frame: &FrameOps) -> u32 {
    let needs_v5 = !frame.bitmaps.is_empty()
        || frame
            .ops
            .iter()
            .any(|op| matches!(op, DrawOp::DrawBitmap { .. }));
    if needs_v5 {
        return BITMAP_VERSION;
    }
    let needs_v4 = !frame.paints.is_empty()
        || frame.ops.iter().any(|op| {
            matches!(
                op,
                DrawOp::FillPathPaint { .. }
                    | DrawOp::StrokePathPaint { .. }
                    | DrawOp::PushMatte
                    | DrawOp::PopMatte { .. }
            )
        });
    if needs_v4 { PAINT_VERSION } else { VERSION }
}

fn put_u32(out: &mut Vec<u8>, v: u32) {
    out.extend_from_slice(&v.to_le_bytes());
}
fn put_f32(out: &mut Vec<u8>, v: f32) {
    // -0.0 归一到 +0.0：数值等价的帧必须字节相同
    let v = if v == 0.0 { 0.0f32 } else { v };
    out.extend_from_slice(&v.to_le_bytes());
}
fn put_mat(out: &mut Vec<u8>, m: &Mat6) {
    for v in m {
        put_f32(out, *v);
    }
}
fn put_color(out: &mut Vec<u8>, c: &Color4) {
    for v in c {
        put_f32(out, *v);
    }
}

fn encode_path(p: &PathData, out: &mut Vec<u8>) {
    put_u32(out, p.0.len() as u32);
    for seg in &p.0 {
        out.push(seg.verb);
        for i in 0..VERB_PTS[seg.verb as usize] * 2 {
            put_f32(out, seg.pts[i]);
        }
    }
}

fn encode_stops(stops: &[GradientStop], out: &mut Vec<u8>) {
    put_u32(out, stops.len() as u32);
    for stop in stops {
        put_f32(out, stop.offset);
        put_color(out, &stop.color);
    }
}

fn encode_paint(paint: &PaintData, out: &mut Vec<u8>) {
    match paint {
        PaintData::Solid(color) => {
            out.push(0);
            put_color(out, color);
        }
        PaintData::Linear { p0, p1, stops } => {
            out.push(1);
            for v in p0.iter().chain(p1.iter()) {
                put_f32(out, *v);
            }
            encode_stops(stops, out);
        }
        PaintData::Radial {
            center,
            radius,
            focus,
            stops,
        } => {
            out.push(2);
            for v in center.iter().chain(std::iter::once(radius)).chain(focus) {
                put_f32(out, *v);
            }
            encode_stops(stops, out);
        }
    }
}

pub fn encode(frame: &FrameOps) -> Vec<u8> {
    let version = required_version(frame);
    let mut out = Vec::with_capacity(4096);
    put_u32(&mut out, MAGIC);
    put_u32(&mut out, version);
    put_u32(&mut out, frame.strings.len() as u32);
    for s in &frame.strings {
        put_u32(&mut out, s.len() as u32);
        out.extend_from_slice(s.as_bytes());
    }
    put_u32(&mut out, frame.paths.len() as u32);
    for p in &frame.paths {
        encode_path(p, &mut out);
    }
    if version >= PAINT_VERSION {
        put_u32(&mut out, frame.paints.len() as u32);
        for paint in &frame.paints {
            encode_paint(paint, &mut out);
        }
    }
    if version >= BITMAP_VERSION {
        put_u32(&mut out, frame.bitmaps.len() as u32);
        for bitmap in &frame.bitmaps {
            put_u32(&mut out, bitmap.width);
            put_u32(&mut out, bitmap.height);
            out.extend_from_slice(&bitmap.rgba);
        }
    }
    put_u32(&mut out, frame.ops.len() as u32);
    for op in &frame.ops {
        match op {
            DrawOp::Clear { color } => {
                out.push(0);
                put_color(&mut out, color);
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
                out.push(1);
                for v in [x, y, w, h, radius] {
                    put_f32(&mut out, *v);
                }
                put_color(&mut out, color);
                put_mat(&mut out, tf);
            }
            DrawOp::FillPath { path, color, tf } => {
                out.push(2);
                put_u32(&mut out, *path);
                put_color(&mut out, color);
                put_mat(&mut out, tf);
            }
            DrawOp::StrokePath {
                path,
                color,
                width,
                tf,
            } => {
                out.push(3);
                put_u32(&mut out, *path);
                put_color(&mut out, color);
                put_f32(&mut out, *width);
                put_mat(&mut out, tf);
            }
            DrawOp::DrawMedia {
                asset,
                media_ms,
                src,
                tf,
            } => {
                out.push(4);
                put_u32(&mut out, *asset);
                out.extend_from_slice(&media_ms.to_le_bytes());
                for v in src {
                    put_f32(&mut out, *v);
                }
                put_mat(&mut out, tf);
            }
            DrawOp::PushLayer { opacity, blend } => {
                out.push(5);
                put_f32(&mut out, *opacity);
                out.push(blend.code());
            }
            DrawOp::PopLayer => out.push(6),
            DrawOp::ClipPath { path, tf } => {
                out.push(7);
                put_u32(&mut out, *path);
                put_mat(&mut out, tf);
            }
            DrawOp::PopClip => out.push(8),
            DrawOp::FillPathPaint {
                path,
                paint,
                even_odd,
                tf,
            } => {
                out.push(9);
                put_u32(&mut out, *path);
                put_u32(&mut out, *paint);
                out.push(u8::from(*even_odd));
                put_mat(&mut out, tf);
            }
            DrawOp::StrokePathPaint {
                path,
                paint,
                width,
                cap,
                join,
                miter,
                tf,
            } => {
                out.push(10);
                put_u32(&mut out, *path);
                put_u32(&mut out, *paint);
                put_f32(&mut out, *width);
                out.push(*cap);
                out.push(*join);
                put_f32(&mut out, *miter);
                put_mat(&mut out, tf);
            }
            DrawOp::PushMatte => out.push(11),
            DrawOp::PopMatte { mode } => {
                out.push(12);
                out.push(*mode);
            }
            DrawOp::DrawBitmap {
                bitmap,
                opacity,
                tf,
            } => {
                out.push(13);
                put_u32(&mut out, *bitmap);
                put_f32(&mut out, *opacity);
                put_mat(&mut out, tf);
            }
        }
    }
    out
}

/// FNV-1a 64：编码字节 → 帧指纹（场景快照缓存键 / 跨端一致性比对）
pub fn fnv1a64(bytes: &[u8]) -> u64 {
    fnv1a64_continue(0xcbf2_9ce4_8422_2325, bytes)
}

/// 从已有状态 `h` 续算 FNV-1a 64（分段喂入与一次喂入结果相同）。
fn fnv1a64_continue(mut h: u64, bytes: &[u8]) -> u64 {
    for &b in bytes {
        h ^= b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

pub fn fingerprint(frame: &FrameOps) -> u64 {
    fnv1a64(&encode(frame))
}

// ── 解码器（v2 – v5）────────────────────────────────────────────────

/// 游标：所有取数都做边界检查，截断的输入报 `bcop-truncated` 而不是 panic。
struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Reader<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Reader { bytes, at: 0 }
    }

    fn take(&mut self, n: usize) -> Result<&'a [u8]> {
        let end = self
            .at
            .checked_add(n)
            .ok_or_else(|| anyhow::anyhow!("bcop-truncated"))?;
        if end > self.bytes.len() {
            bail!(
                "bcop-truncated: 需要 {n} 字节，剩余 {}",
                self.bytes.len() - self.at
            );
        }
        let slice = &self.bytes[self.at..end];
        self.at = end;
        Ok(slice)
    }

    fn u8(&mut self) -> Result<u8> {
        Ok(self.take(1)?[0])
    }

    fn u32(&mut self) -> Result<u32> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }

    fn i64(&mut self) -> Result<i64> {
        Ok(i64::from_le_bytes(self.take(8)?.try_into().unwrap()))
    }

    fn f32(&mut self) -> Result<f32> {
        Ok(f32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }

    fn color(&mut self) -> Result<Color4> {
        Ok([self.f32()?, self.f32()?, self.f32()?, self.f32()?])
    }

    fn mat(&mut self) -> Result<Mat6> {
        Ok([
            self.f32()?,
            self.f32()?,
            self.f32()?,
            self.f32()?,
            self.f32()?,
            self.f32()?,
        ])
    }

    fn stops(&mut self) -> Result<Vec<GradientStop>> {
        let count = self.u32()? as usize;
        let mut out = Vec::with_capacity(count.min(4096));
        for _ in 0..count {
            out.push(GradientStop {
                offset: self.f32()?,
                color: self.color()?,
            });
        }
        Ok(out)
    }

    fn paint(&mut self) -> Result<PaintData> {
        match self.u8()? {
            0 => Ok(PaintData::Solid(self.color()?)),
            1 => Ok(PaintData::Linear {
                p0: [self.f32()?, self.f32()?],
                p1: [self.f32()?, self.f32()?],
                stops: self.stops()?,
            }),
            2 => Ok(PaintData::Radial {
                center: [self.f32()?, self.f32()?],
                radius: self.f32()?,
                focus: [self.f32()?, self.f32()?],
                stops: self.stops()?,
            }),
            other => bail!("bcop-paint-kind-unknown: {other}"),
        }
    }

    fn string(&mut self) -> Result<String> {
        let len = self.u32()? as usize;
        let bytes = self.take(len)?;
        String::from_utf8(bytes.to_vec()).map_err(|_| anyhow::anyhow!("bcop-string-utf8"))
    }
}

/// 解析 BCOP 信封。返回 `(源版本, 帧)`——调用方据此判断读到的是 v2 还是 v3。
///
/// v2 的 `PushLayer` 只有 opacity，blend 补 `Normal`；因此
/// `encode(decode(v2).1)` 得到的是**语义等价的 v3**，不是原字节。
pub fn decode(bytes: &[u8]) -> Result<(u32, FrameOps)> {
    let mut r = Reader::new(bytes);
    if r.u32()? != MAGIC {
        bail!("bcop-magic-mismatch");
    }
    let version = r.u32()?;
    if !(MIN_DECODABLE_VERSION..=MAX_VERSION).contains(&version) {
        bail!(
            "bcop-version-unsupported: {version}（可读 {MIN_DECODABLE_VERSION}..={MAX_VERSION}）"
        );
    }
    let string_count = r.u32()? as usize;
    let mut strings = Vec::with_capacity(string_count.min(4096));
    for _ in 0..string_count {
        strings.push(r.string()?);
    }
    let path_count = r.u32()? as usize;
    let mut paths = Vec::with_capacity(path_count.min(4096));
    for _ in 0..path_count {
        let seg_count = r.u32()? as usize;
        let mut segs = Vec::with_capacity(seg_count.min(65536));
        for _ in 0..seg_count {
            let verb = r.u8()?;
            let points = *VERB_PTS
                .get(verb as usize)
                .ok_or_else(|| anyhow::anyhow!("bcop-path-verb-unknown: {verb}"))?;
            let mut pts = [0.0f32; 6];
            for slot in pts.iter_mut().take(points * 2) {
                *slot = r.f32()?;
            }
            segs.push(PathSeg { verb, pts });
        }
        paths.push(PathData(segs));
    }
    let mut paints = Vec::new();
    if version >= PAINT_VERSION {
        let paint_count = r.u32()? as usize;
        paints.reserve(paint_count.min(4096));
        for _ in 0..paint_count {
            paints.push(r.paint()?);
        }
    }
    let mut bitmaps = Vec::new();
    if version >= BITMAP_VERSION {
        let bitmap_count = r.u32()? as usize;
        bitmaps.reserve(bitmap_count.min(4096));
        for _ in 0..bitmap_count {
            let width = r.u32()?;
            let height = r.u32()?;
            // 尺寸乘积先做溢出检查；越界由 `take` 报 `bcop-truncated`。
            let len = (width as usize)
                .checked_mul(height as usize)
                .and_then(|pixels| pixels.checked_mul(4))
                .ok_or_else(|| anyhow::anyhow!("bcop-bitmap-size-invalid: {width}x{height}"))?;
            if len == 0 {
                bail!("bcop-bitmap-size-invalid: {width}x{height}");
            }
            bitmaps.push(BitmapData {
                width,
                height,
                rgba: r.take(len)?.into(),
            });
        }
    }
    let op_count = r.u32()? as usize;
    let mut ops = Vec::with_capacity(op_count.min(1 << 20));
    for _ in 0..op_count {
        let code = r.u8()?;
        ops.push(match code {
            0 => DrawOp::Clear { color: r.color()? },
            1 => DrawOp::FillRect {
                x: r.f32()?,
                y: r.f32()?,
                w: r.f32()?,
                h: r.f32()?,
                radius: r.f32()?,
                color: r.color()?,
                tf: r.mat()?,
            },
            2 => DrawOp::FillPath {
                path: r.u32()?,
                color: r.color()?,
                tf: r.mat()?,
            },
            3 => DrawOp::StrokePath {
                path: r.u32()?,
                color: r.color()?,
                width: r.f32()?,
                tf: r.mat()?,
            },
            4 => DrawOp::DrawMedia {
                asset: r.u32()?,
                media_ms: r.i64()?,
                src: [r.f32()?, r.f32()?, r.f32()?, r.f32()?],
                tf: r.mat()?,
            },
            5 => {
                let opacity = r.f32()?;
                // v2 没有 blend 字节：整幅层栈只有组不透明度。
                let blend = if version >= 3 {
                    let code = r.u8()?;
                    BlendMode::from_code(code)
                        .ok_or_else(|| anyhow::anyhow!("bcop-blend-unknown: {code}"))?
                } else {
                    BlendMode::Normal
                };
                DrawOp::PushLayer { opacity, blend }
            }
            6 => DrawOp::PopLayer,
            7 if version >= 3 => DrawOp::ClipPath {
                path: r.u32()?,
                tf: r.mat()?,
            },
            8 if version >= 3 => DrawOp::PopClip,
            9 if version >= 4 => DrawOp::FillPathPaint {
                path: r.u32()?,
                paint: r.u32()?,
                even_odd: r.u8()? != 0,
                tf: r.mat()?,
            },
            10 if version >= 4 => DrawOp::StrokePathPaint {
                path: r.u32()?,
                paint: r.u32()?,
                width: r.f32()?,
                cap: r.u8()?,
                join: r.u8()?,
                miter: r.f32()?,
                tf: r.mat()?,
            },
            11 if version >= 4 => DrawOp::PushMatte,
            12 if version >= 4 => {
                let mode = r.u8()?;
                if MatteMode::from_code(mode).is_none() {
                    bail!("bcop-matte-mode-unknown: {mode}");
                }
                DrawOp::PopMatte { mode }
            }
            13 if version >= 5 => DrawOp::DrawBitmap {
                bitmap: r.u32()?,
                opacity: r.f32()?,
                tf: r.mat()?,
            },
            other => bail!("bcop-op-unknown: {other}（版本 {version}）"),
        });
    }
    if r.at != bytes.len() {
        bail!(
            "bcop-trailing-bytes: 解析后剩余 {} 字节",
            bytes.len() - r.at
        );
    }
    Ok((
        version,
        FrameOps {
            static_prefix: None,
            ops,
            paths,
            strings,
            paints,
            bitmaps,
        },
    ))
}
