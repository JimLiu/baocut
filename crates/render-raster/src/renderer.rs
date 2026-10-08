//! sample(t) 驱动的帧录制（DrawOp IR）：与 swift-renderer Renderer.swift 逐函数对应，
//! visual clip（含转场 wrap 通道）→ camera → 媒体节点 → captions，
//! 但产出与后端无关的指令流；光栅化见 raster::rasterize。
//! record 是 (ir, t) 的纯函数 ⇒ 同帧字节相同（指纹缓存与跨端比对的前提）。

#[cfg(feature = "media")]
use crate::assets::LoadedAssets;
use crate::drawop::{
    BitmapData, DrawOp, FrameBuilder, FrameOps, Mat6, MatteMode, PathData, path_from_skia,
};
use crate::fonts::{ShapedLine, TextEngine, fmt_count};
#[cfg(feature = "media")]
use crate::media::MediaStore;
use crate::source::{Lottie, MediaTime};
use anyhow::{Result, bail};
use motion::effect::BlendMode;
use scene_primitives::Rgba;
use scene_primitives::json::{JsonExt, clamp};
use scene_primitives::layout;
use scene_primitives::pathstyle::{self, Cadence, LineCap, LineJoin};
use scene_primitives::resolve::{
    BgGradient, BoxBorder, CapItem, CaptionClip, ClipPoly, ClipShape, Ir, PartMotion, RNode,
    ResolvedEffect, VisualClip,
};
use scene_primitives::sample::{Channel, sample_channels, sample_frames};
use serde_json::{Map, Value};
use std::collections::BTreeSet;
use std::sync::Arc;
#[cfg(feature = "media")]
use tiny_skia::Pixmap;
use tiny_skia::{PathBuilder, Transform};

/// 组合两个仿射变换：先 inner 后 outer（CG 的 translateBy/scaleBy 调用序语义）。
fn compose(o: Transform, i: Transform) -> Transform {
    Transform::from_row(
        o.sx * i.sx + o.kx * i.ky,
        o.ky * i.sx + o.sy * i.ky,
        o.sx * i.kx + o.kx * i.sy,
        o.ky * i.kx + o.sy * i.sy,
        o.sx * i.tx + o.kx * i.ty + o.tx,
        o.ky * i.tx + o.sy * i.ty + o.ty,
    )
}

fn translate(x: f64, y: f64) -> Transform {
    Transform::from_translate(x as f32, y as f32)
}

fn scale_xy(sx: f64, sy: f64) -> Transform {
    Transform::from_scale(sx as f32, sy as f32)
}

fn mat(tf: Transform) -> Mat6 {
    [tf.sx, tf.ky, tf.kx, tf.sy, tf.tx, tf.ty]
}

/// 彩色字形位图的超采样倍率：取变换的较大轴缩放，向上取到 2 的幂，夹在 ¼–4×。
///
/// 取幂档让连续缩放动画只在少数几个字号上重光栅化（字形缓存与位图侧表都能
/// 复用）；向上取保证位图在画面上只会被缩小（至多 2×），不会被放大到发软。
/// 容差 0.01（log2 域）挡住 1.0 附近的浮点抖动，不让静止文字翻到 2×。
fn bitmap_oversample(tf: Transform) -> f32 {
    let scale = f64::from(tf.sx.hypot(tf.ky)).max(f64::from(tf.kx.hypot(tf.sy)));
    if !scale.is_finite() || scale <= 0.0 {
        return 1.0;
    }
    let exp = (scale.log2() - 0.01).ceil().clamp(-2.0, 2.0);
    2f64.powi(exp as i32) as f32
}

/// 彩色字形（emoji 等 `sbix` / `CBDT` / `COLR`）→ 一条 `DrawBitmap`。
///
/// `gt` 是字形原点（基线左端）到 surface 的变换。返回 `false` = 这不是彩色
/// 字形，调用方照旧走轮廓；单色 face 不会触发任何光栅化（见
/// [`TextEngine::color_glyph`]）。位图不吃文字颜色，只吃它的 alpha。
fn record_color_glyph(
    key: cosmic_text::CacheKey,
    gt: Transform,
    opacity: f32,
    b: &mut FrameBuilder,
    engine: &mut TextEngine,
) -> bool {
    let oversample = bitmap_oversample(gt);
    let Some(image) = engine.color_glyph(key, oversample) else {
        return false;
    };
    // 位图像素 → 字形本地：先按 placement 平移（`top` 以 y 向上为正），
    // 再缩回布局字号。
    let inv = 1.0 / f64::from(oversample);
    let place = compose(
        scale_xy(inv, inv),
        translate(f64::from(image.left), -f64::from(image.top)),
    );
    let bitmap = b.bitmap_id(BitmapData {
        width: image.width,
        height: image.height,
        rgba: image.rgba,
    });
    b.push(DrawOp::DrawBitmap {
        bitmap,
        opacity,
        tf: mat(compose(gt, place)),
    });
    true
}

fn col(c: &Rgba, alpha: f64) -> [f32; 4] {
    [
        (c.r / 255.0).clamp(0.0, 1.0) as f32,
        (c.g / 255.0).clamp(0.0, 1.0) as f32,
        (c.b / 255.0).clamp(0.0, 1.0) as f32,
        (c.a * alpha).clamp(0.0, 1.0) as f32,
    ]
}

/// 节点采样时钟（规范 §7.10）。`real` 是项目真实时间；`t` 是本节点所在
/// `cadence` 采样域量化后的时间，没有域时两者相等。
#[derive(Clone, Copy)]
struct Clock {
    real: f64,
    t: f64,
    /// 当前域的绘制频率；`None` = 不在任何域里。
    fps: Option<f64>,
    /// 宿主 clip 的起点：量化不得把时间拉到 clip 开始之前（起点不在格上的
    /// clip，首个绘制帧按 clip 起点采样）。
    floor: f64,
}

impl Clock {
    fn new(real: f64, floor: f64) -> Clock {
        Clock {
            real,
            t: real,
            fps: None,
            floor,
        }
    }

    /// 进入一个 `cadence` 声明。继承同一域时原样返回——父子不重复量化。
    fn enter(self, cadence: Cadence) -> Clock {
        match cadence {
            Cadence::Inherit => self,
            Cadence::Off => Clock {
                t: self.real,
                fps: None,
                ..self
            },
            Cadence::Fps(fps) => Clock {
                t: pathstyle::hold(self.real, fps).max(self.floor.min(self.real)),
                fps: Some(fps),
                ..self
            },
        }
    }
}

/// 一帧的**分层**录制结果（设计 §6.3）。
///
/// 没有效果的文档只会得到一个 [`FrameLayer::Ops`]——planner 把它折叠成单个
/// Draw pass，与 [`FrameRenderer::record`] 之后原样光栅化逐字节相同。
#[derive(Debug)]
pub enum FrameLayer {
    /// 直接画进累积画面的指令流。
    Ops(FrameOps),
    /// 需要独立离屏 surface 的元素：`ops` 画进一张透明画布，逐条跑 `Filter`
    /// pass，再按 `blend` / `opacity` 合成回累积画面（规范 §6.6）。
    Effect {
        ops: FrameOps,
        effects: Vec<ResolvedEffect>,
        blend: BlendMode,
        opacity: f32,
    },
    /// 子树先合成，再依次裁剪/遮罩、滤镜，最后施加组透明度和混合。
    Group {
        layers: Vec<FrameLayer>,
        masks: Vec<(Vec<FrameLayer>, MatteMode)>,
        effects: Vec<ResolvedEffect>,
        blend: BlendMode,
        opacity: f32,
    },
    Temporal {
        samples: Vec<(Vec<FrameLayer>, f64)>,
        mode: scene_primitives::temporal::EchoMode,
    },
    /// Independent raster canvas, transformed into the parent after its own effects.
    LocalCanvas {
        layers: Vec<FrameLayer>,
        width: u32,
        height: u32,
        tf: Mat6,
    },
    /// Samples completed lower siblings in the nearest isolated group.
    Backdrop {
        masks: Vec<(Vec<FrameLayer>, MatteMode)>,
        effects: Vec<ResolvedEffect>,
        opacity: f32,
    },
    /// Surface Transition（规范 §9）：两侧各画进一张透明离屏 surface，再由
    /// `progress` 驱动的双输入效果合成，结果整块贴回累积画面。
    ///
    /// `from_static` / `to_static` 说的是「这一侧的画面跨帧不变」——两侧因此
    /// 可以声明成 [`crate::plan::SurfaceLifetime::Static`]。判据是保守的：
    /// 子树里一条通道都没有、也不含视频（见 `clip_is_static`）。
    Transition {
        from: Vec<FrameLayer>,
        to: Vec<FrameLayer>,
        effect: motion::effect::EffectRef,
        /// 闭区间 `[0, 1]`。
        progress: f32,
        uniforms: motion::effect::UniformMap,
        from_static: bool,
        to_static: bool,
    },
}

/// [`FrameRenderer::record_layered`] 的产物。
#[derive(Debug, Default)]
pub struct RecordedFrame {
    pub layers: Vec<FrameLayer>,
}

impl RecordedFrame {
    /// 恰好一层普通指令流 ⇒ 可折叠成单 Draw pass。
    pub fn is_folded(&self) -> bool {
        matches!(self.layers.as_slice(), [FrameLayer::Ops(_)])
    }
}

/// 录制模式。平坦路径画不出 `Transition` pass，因此 Surface Transition 在
/// 那条路上一律降级成它的 Motion fallback（规范 §9）。
#[derive(Clone, Copy)]
enum RecordMode<'a> {
    Flat,
    /// 分层录制 + planner 给出的降级名单（按 `from_clip` 的 id）。
    Layered(&'a BTreeSet<String>),
}

/// [`FrameRenderer::wrap_clip_path`] 的三态：不裁 / 裁空（本刻不出画）/ 路径。
enum WrapClip {
    None,
    Empty,
    Path(PathData),
}

/// 单 Draw 流的层/裁剪栈；离屏组只在完整作用域边界创建。
enum Open {
    Layer,
    Clip,
}

/// 分层录制器。`split = false` 时行为与 4A 的单 `FrameBuilder` 完全一致
/// （效果节点原样内联，不产生第二层）——`record()` 走的就是这条路。
struct Recorder {
    split: bool,
    layers: Vec<FrameLayer>,
    b: FrameBuilder,
    stack: Vec<Open>,
}

impl Recorder {
    fn new(split: bool) -> Self {
        Recorder {
            split,
            layers: Vec::new(),
            b: FrameBuilder::default(),
            stack: Vec::new(),
        }
    }

    fn push_layer(&mut self, opacity: f32, blend: BlendMode) {
        self.b.push(DrawOp::PushLayer { opacity, blend });
        self.stack.push(Open::Layer);
    }

    fn pop_layer(&mut self) {
        self.b.push(DrawOp::PopLayer);
        debug_assert!(matches!(self.stack.last(), Some(Open::Layer)));
        self.stack.pop();
    }

    fn push_clip(&mut self, path: PathData, tf: Mat6) {
        let id = self.b.path_id(path.clone());
        self.b.push(DrawOp::ClipPath { path: id, tf });
        self.stack.push(Open::Clip);
    }

    fn pop_clip(&mut self) {
        self.b.push(DrawOp::PopClip);
        debug_assert!(matches!(self.stack.last(), Some(Open::Clip)));
        self.stack.pop();
    }

    fn push_group(&mut self, layer: FrameLayer) {
        debug_assert!(self.stack.is_empty(), "离屏组不能拆开祖先的透明度或裁剪");
        let ops = std::mem::take(&mut self.b).finish();
        if !ops.ops.is_empty() {
            self.layers.push(FrameLayer::Ops(ops));
        }
        self.layers.push(layer);
    }

    /// 收下一个 Surface Transition 层。调用点在 clip 循环的**顶层**，
    /// 此时层 / 裁剪栈必然是空的（每个 clip 自己开自己收），因此不需要
    /// 拆开任何祖先作用域。
    #[allow(clippy::too_many_arguments)]
    fn push_transition(
        &mut self,
        from: Vec<FrameLayer>,
        to: Vec<FrameLayer>,
        effect: motion::effect::EffectRef,
        progress: f32,
        uniforms: motion::effect::UniformMap,
        from_static: bool,
        to_static: bool,
    ) {
        debug_assert!(self.stack.is_empty(), "转场层只在 clip 循环顶层开");
        let ops = std::mem::take(&mut self.b).finish();
        if !ops.ops.is_empty() {
            self.layers.push(FrameLayer::Ops(ops));
        }
        self.layers.push(FrameLayer::Transition {
            from,
            to,
            effect,
            progress,
            uniforms,
            from_static,
            to_static,
        });
        self.b = FrameBuilder::default();
    }

    fn finish(mut self) -> RecordedFrame {
        let ops = std::mem::take(&mut self.b).finish();
        if !ops.ops.is_empty() || self.layers.is_empty() {
            self.layers.push(FrameLayer::Ops(ops));
        }
        RecordedFrame {
            layers: self.layers,
        }
    }
}

/// 一个 clip 的录制上下文：clip 根、根处的时钟与变换。`style.mask` 的遮罩源要从
/// 根沿祖先链重算变换，所以每个节点都带着它往下走（`Copy`，只是三个借用 / 值）。
#[derive(Clone, Copy)]
struct ClipCtx<'a> {
    root: &'a RNode,
    clock: Clock,
    tf: Transform,
    skip_root: bool,
    end: f64,
}

/// [`FrameRenderer::node_pose`] 的产物：本刻的时钟、局部→画布变换与采样结果。
struct NodePose {
    clock: Clock,
    tf: Transform,
    opacity: f64,
    blur: f64,
    pose: scene_primitives::sample::SampledPose,
}

/// 从 `root` 到 id 为 `id` 的节点的路径（含两端）。找到返回 true。
fn find_node_chain<'a>(root: &'a RNode, id: &str, chain: &mut Vec<&'a RNode>) -> bool {
    chain.push(root);
    if root.id == id {
        return true;
    }
    if chain.len() > 1 && root.composition.is_some() {
        chain.pop();
        return false;
    }
    for child in &root.children {
        if find_node_chain(child, id, chain) {
            return true;
        }
    }
    chain.pop();
    false
}

/// [`FrameRenderer::record_text_parts`] 的逐 part 预计算结果：同一 part 的所有
/// 字形共享同一份 delta 与同一个水平锚点，采一次即可复用。
/// [`PartPose::IDENTITY`] 是「没有 part 覆盖」的中性值，与逐字形版本的
/// `(1, 0, 0, 1)` 逐位一致（此时 `scale == 1.0`，`anchor` 不参与运算）。
#[derive(Clone, Copy)]
struct PartPose {
    opacity: f64,
    dx: f64,
    dy: f64,
    scale: f64,
    anchor: f64,
    color: Option<Rgba>,
    reveal_end: usize,
    /// part 的 `blur` 通道（px，≥ 0）。> 0 的 part 画进按半径分桶的离屏层，
    /// 由 [`FrameRenderer::flush_part_blur`] 各施一次 `filter.blur`。
    blur: f64,
}

impl PartPose {
    const IDENTITY: PartPose = PartPose {
        opacity: 1.0,
        dx: 0.0,
        dy: 0.0,
        scale: 1.0,
        anchor: 0.0,
        color: None,
        reveal_end: usize::MAX,
        blur: 0.0,
    };
}

/// 分词模糊的分桶：同一半径的 part 共用一张离屏层（还没开始的 part 半径相同，
/// 自然落进同一桶）。键是半径的位模式——只合并**逐位相同**的半径，不量化。
type PartBlurBuckets = Vec<(u64, FrameBuilder)>;

fn part_blur_bucket(buckets: &mut PartBlurBuckets, blur: f64) -> &mut FrameBuilder {
    let key = blur.to_bits();
    let index = match buckets.iter().position(|(bits, _)| *bits == key) {
        Some(index) => index,
        None => {
            buckets.push((key, FrameBuilder::default()));
            buckets.len() - 1
        }
    };
    &mut buckets[index].1
}

fn text_reveal_end(
    text: &str,
    unit: Option<motion::PartUnit>,
    progress: f64,
    block: Option<&scene_primitives::text_layout::TextBlock>,
) -> usize {
    if progress >= 1.0 {
        return usize::MAX;
    }
    if progress <= 0.0 {
        return 0;
    }
    let unit = unit.unwrap_or(motion::PartUnit::Char);
    let ranges = if unit == motion::PartUnit::Line {
        block
            .map(|block| block.lines.iter().map(|line| line.bytes.clone()).collect())
            .unwrap_or_else(|| motion::split_animation_parts(text, unit))
    } else {
        motion::split_animation_parts(text, unit)
    };
    let count = (progress * ranges.len() as f64 + 1e-9).floor() as usize;
    if count == 0 {
        0
    } else {
        ranges.get(count - 1).map_or(text.len(), |range| range.end)
    }
}

#[derive(Default)]
struct GridGeometryCache(
    std::sync::Mutex<(
        usize,
        std::collections::VecDeque<(u64, Arc<PathData>, usize)>,
    )>,
);
impl GridGeometryCache {
    fn get(&self, key: u64) -> Option<Arc<PathData>> {
        self.0
            .lock()
            .ok()?
            .1
            .iter()
            .find(|(k, _, _)| *k == key)
            .map(|(_, path, _)| path.clone())
    }
    fn put(&self, key: u64, path: Arc<PathData>) {
        let bytes = path.0.capacity() * std::mem::size_of::<crate::drawop::PathSeg>();
        const MAX_BYTES: usize = 16 * 1024 * 1024;
        if bytes > MAX_BYTES {
            return;
        }
        if let Ok(mut cache) = self.0.lock() {
            if cache.1.iter().any(|(k, _, _)| *k == key) {
                return;
            }
            while cache.0 + bytes > MAX_BYTES || cache.1.len() >= 32 {
                if let Some((_, _, size)) = cache.1.pop_front() {
                    cache.0 -= size;
                } else {
                    break;
                }
            }
            cache.0 += bytes;
            cache.1.push_back((key, path, bytes));
        }
    }
}

pub struct FrameRenderer {
    pub width: u32,
    pub height: u32,
    /// Lottie 源（asset id → 已解析的文档）。
    ///
    /// 位图媒体在光栅化阶段才进场（`MediaStore`），Lottie 不行——它**在录制期
    /// 就要变成 DrawOp**，所以录制器必须持有它。由 [`FrameRenderer::new_with_lotties`]
    /// 装上，缺资源在那一步就是硬错误，不留"画面里少一块"的静默口子。
    lotties: std::collections::HashMap<String, Arc<Lottie>>,
    /// 纹理填充的几何缓存（`source::texture`）。命中与否不影响输出。
    textures: Arc<crate::source::texture::TextureCache>,
    /// `brush.kind: "paint"` 描边笔触的几何缓存（`source::paint`）。命中与否不影响输出。
    paints: Arc<crate::source::paint::PaintCache>,
    grid_cache: Arc<GridGeometryCache>,
}

impl FrameRenderer {
    /// 顺序是**契约**：布局 → `build_channels_after_layout`（相对长度求值）→ 录制。
    /// `selfWidth` / `parentWidth` 这类基准要静态布局盒才有值（设计 §5.5）。
    ///
    /// 文档里有 `lottie` 元素时必须用 [`FrameRenderer::new_with_lotties`]。
    pub fn new(ir: &mut Ir, engine: &mut TextEngine) -> Result<Self> {
        Self::new_with_lotties(ir, engine, &Default::default())
    }

    /// [`FrameRenderer::new`] 加上 host 侧已加载的矢量源。
    ///
    /// 这里会核对每个 `lottie` 元素的资产都在 `assets.lotties` 里——录制期
    /// 发现不了这种缺失（`record` 是纯函数、没有返回错误的地方），只能在
    /// 装配期 fail-fast。
    #[cfg(feature = "media")]
    pub fn new_with_assets(
        ir: &mut Ir,
        engine: &mut TextEngine,
        assets: &LoadedAssets,
    ) -> Result<Self> {
        Self::new_with_lotties(ir, engine, &assets.lotties)
    }

    /// 用宿主已解析的矢量源准备录制器。与资源加载、文件系统和媒体解码无关，
    /// native 与 WASM 使用同一条布局和动画编译路径。
    pub fn new_with_lotties(
        ir: &mut Ir,
        engine: &mut TextEngine,
        lotties: &std::collections::HashMap<String, Arc<Lottie>>,
    ) -> Result<Self> {
        let (w, h) = (ir.w, ir.h);
        for clip in &mut ir.visual_clips {
            layout::layout_tree(&mut clip.tree, w, h, engine);
        }
        layout::layout_captions(ir, engine);
        scene_primitives::resolve::build_channels_after_layout(ir)?;
        for clip in &ir.visual_clips {
            check_lottie_sources(&clip.tree, lotties)?;
        }
        Ok(FrameRenderer {
            width: ir.w as u32,
            height: ir.h as u32,
            lotties: lotties.clone(),
            textures: Default::default(),
            paints: Default::default(),
            grid_cache: Default::default(),
        })
    }

    /// 录制 t 时刻的完整帧指令（纯函数；不触碰媒体字节）。
    ///
    /// **平坦形态**：效果栈不在这里生效（效果是 `Filter` pass，不是 DrawOp
    /// 原语，规范 §14.5）；`clipPath` 与 `blendMode` 是单 surface 语义，照常
    /// 进指令流。`bcut ops` 打印的就是这条流。
    pub fn record(&self, ir: &Ir, engine: &mut TextEngine, t: f64) -> FrameOps {
        let mut frame = self.record_into(ir, engine, t, RecordMode::Flat);
        match frame.layers.pop() {
            Some(FrameLayer::Ops(ops)) => ops,
            _ => unreachable!("平坦录制只会产出一层普通指令流"),
        }
    }

    /// 分层录制：带效果栈的元素各自成层，其余仍是一条指令流（设计 §6.3）。
    /// 没有效果的文档得到的 `layers` 恰好是 `[Ops(record(t))]`。
    pub fn record_layered(&self, ir: &Ir, engine: &mut TextEngine, t: f64) -> RecordedFrame {
        self.record_layered_with(ir, engine, t, &BTreeSet::new())
    }

    /// [`FrameRenderer::record_layered`] 加一张**降级名单**：名单里的
    /// Surface Transition（按 `from_clip` 的 id 记）改用它的 Motion fallback
    /// 通道，不起 `Transition` 层。名单由 planner 的 preflight 给出——
    /// 后端能不能跑一条效果是 capability 的事，录制器自己不知道。
    pub fn record_layered_with(
        &self,
        ir: &Ir,
        engine: &mut TextEngine,
        t: f64,
        fallbacks: &BTreeSet<String>,
    ) -> RecordedFrame {
        self.record_into(ir, engine, t, RecordMode::Layered(fallbacks))
    }

    fn record_into(
        &self,
        ir: &Ir,
        engine: &mut TextEngine,
        t: f64,
        mode: RecordMode<'_>,
    ) -> RecordedFrame {
        let split = matches!(mode, RecordMode::Layered(_));
        let mut r = Recorder::new(split);
        let b = &mut r.b;
        b.push(DrawOp::Clear {
            color: col(&ir.bg, 1.0),
        });
        // `meta.background.texture`：铺满画布，在相机之外（纸不跟着镜头走）。
        if let Some(texture) = &ir.bg_texture {
            self.record_texture(
                (0.0, 0.0, ir.w, ir.h),
                texture,
                Some(ir.bg),
                1.0,
                &box_path(ir.w, ir.h),
                Transform::identity(),
                b,
            );
            // 背景纸与时间无关：像素只由（纹理参数, 底色, 画布尺寸）决定，交给光栅器
            // 按这个键缓存整段前缀（`Clear` + 纹理），不必每帧重画几万粒颗粒。
            let key = crate::drawop::fnv1a64(
                format!("bg-texture/1 {texture:?} {:?} {} {}", ir.bg, ir.w, ir.h).as_bytes(),
            );
            b.frame.static_prefix = Some(crate::drawop::StaticPrefix {
                key,
                ops: b.frame.ops.len(),
            });
        }

        // camera（作用于全部 visual clip；字幕在相机之外）
        let cam_t = self.camera_transform(ir, t);

        // Surface Transition（规范 §9）：本刻活跃的剪辑点。名单里的走 Motion
        // 降级，平坦路径（`record`）一律走降级——单 surface 的指令流表达不了
        // 双输入合成，静默丢掉才是错的。
        let mut consumed: Vec<&str> = Vec::new();
        for clip in &ir.visual_clips {
            if consumed.contains(&clip.id.as_str()) {
                continue;
            }
            if t < clip.render_start || t > clip.render_end {
                continue;
            }
            if let RecordMode::Layered(fallbacks) = mode
                && let Some((entry, progress)) = ir
                    .surface_transitions
                    .iter()
                    .filter(|entry| entry.from_clip == clip.id)
                    .find_map(|entry| entry.progress_at(t).map(|p| (entry, p)))
                && !fallbacks.contains(&entry.from_clip)
                && let Some(to_clip) = ir
                    .visual_clips
                    .iter()
                    .find(|other| other.id == entry.to_clip)
            {
                let from = self.record_clip_isolated(ir, clip, t, cam_t, engine);
                let to = self.record_clip_isolated(ir, to_clip, t, cam_t, engine);
                r.push_transition(
                    from,
                    to,
                    entry.effect.clone(),
                    progress as f32,
                    entry.uniforms.clone(),
                    Self::clip_is_static(clip),
                    Self::clip_is_static(to_clip),
                );
                consumed.push(entry.to_clip.as_str());
                continue;
            }
            let fallback = Self::fallback_channels(ir, clip, t, mode);
            self.record_visual_clip(ir, clip, t, cam_t, fallback, &mut r, engine);
        }

        self.record_captions(ir, engine, t, &mut r.b);
        r.finish()
    }

    /// 录制 + 光栅化的**平坦**单帧入口。
    ///
    /// 只画 DrawOp 原语：效果栈是 `Filter` pass（规范 §14.5），不在指令流里，
    /// 因此这条路径**不施加 `effects[]` 与 `blur`**。产品路径请用
    /// [`crate::plan::FramePlanner::render`]；这里保留给「只关心指令流」的
    /// 测试与对拍。
    #[cfg(feature = "media")]
    pub fn draw(
        &self,
        ir: &Ir,
        engine: &mut TextEngine,
        media: &mut MediaStore,
        t: f64,
    ) -> Result<Pixmap> {
        let frame = self.record(ir, engine, t);
        crate::raster::rasterize(&frame, self.width, self.height, media)
    }

    /// 本刻该给这个 clip 补哪些**降级**转场通道。
    ///
    /// 平坦路径永远补（它画不出 `Transition` pass）；分层路径只在 planner 把
    /// 这个剪辑点列进降级名单时补。返回的是借用，不复制通道。
    fn fallback_channels<'a>(
        ir: &'a Ir,
        clip: &VisualClip,
        t: f64,
        mode: RecordMode<'_>,
    ) -> Vec<&'a Channel> {
        let mut out = Vec::new();
        for entry in &ir.surface_transitions {
            let side = if entry.from_clip == clip.id {
                &entry.fallback_out
            } else if entry.to_clip == clip.id {
                &entry.fallback_in
            } else {
                continue;
            };
            let degraded = match mode {
                RecordMode::Flat => true,
                RecordMode::Layered(fallbacks) => fallbacks.contains(&entry.from_clip),
            };
            // 窗口外也要补：转场通道在窗口外取端点值（可见性的延长段靠它归位）。
            let _ = t;
            if degraded {
                out.extend(side.iter());
            }
        }
        out
    }

    /// 这个 clip 的画面**跨帧不变**吗——转场两侧因此可以声明成 `Static`。
    ///
    /// 判据刻意保守：子树里一条通道都没有、没有文字 part 动画、没有视频 / 动图
    /// 节点，clip 自己也没有 wrap 通道。判错方向只会少一次缓存复用，不会画错。
    fn clip_is_static(clip: &VisualClip) -> bool {
        fn node_is_static(node: &RNode) -> bool {
            node.channels.is_empty()
                && node.echo.is_none()
                && node.follow.is_none()
                && node.char_grid.is_none()
                && node.proc.is_none()
                && node.local_camera.is_empty()
                && node.time_map.is_none()
                && node.part_motion.is_none()
                && node.wobble.is_none_or(|wobble| wobble.every == 0)
                && !matches!(
                    node.ntype.as_str(),
                    "video" | "animatedImage" | "lottie" | "program"
                )
                && node.children.iter().all(node_is_static)
        }
        clip.wrap_channels.is_empty() && node_is_static(&clip.tree)
    }

    /// 把一个 clip 单独录到一条**透明**指令流上（转场的一侧）。
    ///
    /// 没有 `Clear`：两侧画面之外是透明的，画布背景由累积层负责。
    /// 每侧递归录制自己的滤镜、遮罩与混合。
    fn record_clip_isolated(
        &self,
        ir: &Ir,
        clip: &VisualClip,
        t: f64,
        cam_t: Transform,
        engine: &mut TextEngine,
    ) -> Vec<FrameLayer> {
        let mut side = Recorder::new(true);
        self.record_visual_clip(ir, clip, t, cam_t, Vec::new(), &mut side, engine);
        side.finish().layers
    }

    /// 一个 visual clip 的录制：转场 wrap 通道 → 组不透明度 / 擦除裁剪 → 子树。
    #[allow(clippy::too_many_arguments)]
    fn record_visual_clip(
        &self,
        ir: &Ir,
        clip: &VisualClip,
        t: f64,
        cam_t: Transform,
        extra_channels: Vec<&Channel>,
        r: &mut Recorder,
        engine: &mut TextEngine,
    ) {
        let mut tf = if clip.screen_space {
            Transform::identity()
        } else {
            cam_t
        };
        // 转场 wrap 通道**不走 §7.7 的折叠**：一个 clip 可能同时挂着左边界的
        // "in" 与右边界的 "out"，两者的位移在这里是**逐条累加**的（各自在
        // 窗口外取端点值 0）。改成 replace 折叠会让 "out" 的端点 0 把 "in"
        // 的动画顶掉。转场配方是封闭的内置集合，不接受作者 composite。
        //
        // 各通道的累加规则（恒等元即"窗口外的端点值"）：
        // `x`/`y` 逐条相加，`scale` 逐条相乘（恒等 1），`clipInset*` 逐条取
        // 大（恒等 0，两端的擦除因此取交集）。`opacity` 仍是 **replace**
        // ——那是阶段 1 起的语义，改成相乘会动已发布文档的像素。
        let mut wrap_alpha = 1.0f64;
        let mut wrap_scale = 1.0f64;
        // 顺序：left, top, right, bottom（画布尺寸的比例）。
        let mut wrap_inset = [0.0f64; 4];
        for ch in clip.wrap_channels.iter().chain(extra_channels) {
            let v = sample_frames(&ch.frames, t);
            match ch.prop.as_str() {
                "x" => tf = compose(tf, translate(v.as_f64().unwrap_or(0.0), 0.0)),
                "y" => tf = compose(tf, translate(0.0, v.as_f64().unwrap_or(0.0))),
                "opacity" => wrap_alpha = v.as_f64().unwrap_or(1.0),
                "scale" => wrap_scale *= v.as_f64().unwrap_or(1.0),
                "clipInsetLeft" => wrap_inset[0] = wrap_inset[0].max(v.as_f64().unwrap_or(0.0)),
                "clipInsetTop" => wrap_inset[1] = wrap_inset[1].max(v.as_f64().unwrap_or(0.0)),
                "clipInsetRight" => wrap_inset[2] = wrap_inset[2].max(v.as_f64().unwrap_or(0.0)),
                "clipInsetBottom" => wrap_inset[3] = wrap_inset[3].max(v.as_f64().unwrap_or(0.0)),
                _ => {}
            }
        }
        if wrap_alpha <= 0.001 {
            return;
        }
        // 缩放以**画布中心**为锚点：转场是整幅画面的事，不是某个元素盒的事。
        if wrap_scale != 1.0 {
            if wrap_scale.abs() < 0.0005 {
                return;
            }
            let (cx, cy) = (ir.w / 2.0, ir.h / 2.0);
            tf = compose(tf, translate(cx, cy));
            tf = compose(tf, scale_xy(wrap_scale, wrap_scale));
            tf = compose(tf, translate(-cx, -cy));
        }
        let wrap_clip = Self::wrap_clip_path(ir, wrap_inset);
        if matches!(wrap_clip, WrapClip::Empty) {
            return;
        }
        // 外层裁剪/透明度包住整个 clip，不在子效果处分裂。
        let isolate = r.split
            && Self::subtree_has_effect(&clip.tree)
            && (wrap_alpha < 0.999 || matches!(wrap_clip, WrapClip::Path(_)));
        let mut isolated = Recorder::new(true);
        let target = if isolate { &mut isolated } else { &mut *r };
        let clipped = !isolate && matches!(&wrap_clip, WrapClip::Path(_));
        if clipped && let WrapClip::Path(path) = &wrap_clip {
            target.push_clip(path.clone(), mat(Transform::identity()));
        }
        let layered = !isolate && wrap_alpha < 0.999;
        if layered {
            target.push_layer(wrap_alpha as f32, BlendMode::Normal);
        }
        // `cadence`（规范 §7.10）只量化节点采样时钟：clip 激活、转场窗口、相机与
        // 字幕都走真实时间。文档级缺省 → clip 级 → 节点级，逐级覆盖。
        let mut clock = Clock::new(t, clip.render_start);
        if let Some(fps) = ir.cadence_fps {
            clock = clock.enter(Cadence::Fps(fps));
        }
        clock = clock.enter(clip.cadence);
        let ctx = ClipCtx {
            root: &clip.tree,
            clock,
            tf,
            skip_root: false,
            end: clip.render_end,
        };
        self.record_node(&clip.tree, clock, tf, ctx, target, engine);
        if layered {
            target.pop_layer();
        }
        if clipped {
            target.pop_clip();
        }
        if isolate {
            let masks = match wrap_clip {
                WrapClip::Path(path) => vec![(
                    Self::path_mask(path, Transform::identity()),
                    MatteMode::Alpha,
                )],
                _ => Vec::new(),
            };
            r.push_group(FrameLayer::Group {
                layers: isolated.finish().layers,
                masks,
                effects: Vec::new(),
                blend: BlendMode::Normal,
                opacity: wrap_alpha as f32,
            });
        }
    }

    /// 转场擦除通道（`clipInset*`，画布尺寸的比例）→ 画布空间矩形路径。
    fn wrap_clip_path(ir: &Ir, inset: [f64; 4]) -> WrapClip {
        if inset.iter().all(|value| *value <= 0.0) {
            return WrapClip::None;
        }
        let x0 = inset[0].clamp(0.0, 1.0) * ir.w;
        let y0 = inset[1].clamp(0.0, 1.0) * ir.h;
        let x1 = ir.w - inset[2].clamp(0.0, 1.0) * ir.w;
        let y1 = ir.h - inset[3].clamp(0.0, 1.0) * ir.h;
        if x1 <= x0 || y1 <= y0 {
            return WrapClip::Empty;
        }
        let Some(rect) = tiny_skia::Rect::from_ltrb(x0 as f32, y0 as f32, x1 as f32, y1 as f32)
        else {
            return WrapClip::Empty;
        };
        let mut pb = PathBuilder::new();
        pb.push_rect(rect);
        match pb.finish() {
            Some(path) => WrapClip::Path(path_from_skia(&path)),
            None => WrapClip::Empty,
        }
    }

    fn camera_transform(&self, ir: &Ir, t: f64) -> Transform {
        let mut cam = (0.0f64, 0.0f64, 1.0f64);
        for c in &ir.camera_clips {
            if t >= c.start && t <= c.end {
                let v = sample_frames(&c.frames, t);
                cam = (
                    v.gf64("x").unwrap_or(0.0),
                    v.gf64("y").unwrap_or(0.0),
                    v.gf64("zoom").unwrap_or(1.0),
                );
                break;
            }
        }
        if cam.2 == 1.0 && cam.0 == 0.0 && cam.1 == 0.0 {
            return Transform::identity();
        }
        let cx = ir.w / 2.0;
        let cy = ir.h / 2.0;
        let mut tf = Transform::identity();
        tf = compose(tf, translate(cx, cy));
        tf = compose(tf, translate(-cam.0 * cam.2, -cam.1 * cam.2));
        tf = compose(tf, scale_xy(cam.2, cam.2));
        tf = compose(tf, translate(-cx, -cy));
        tf
    }

    // ── 元素 ──
    fn record_node(
        &self,
        node: &RNode,
        clock: Clock,
        parent: Transform,
        ctx: ClipCtx<'_>,
        r: &mut Recorder,
        engine: &mut TextEngine,
    ) {
        // 被 `style.mask.source` 点名的元素是遮罩定义，不在正常流里出画
        // （规范 §6.3）；只有 `record_mask_source` 会把它画进遮罩层。
        if node.mask_source {
            return;
        }
        self.record_node_inner(node, clock, parent, ctx, r, engine);
    }

    /// 元素本刻的采样时钟与局部→画布变换。`None` = 本刻不出画（不透明度或缩放归零）。
    ///
    /// 与 [`Self::record_node_inner`] 共用：遮罩源的祖先链只需要变换，不需要出画。
    fn node_pose(&self, node: &RNode, clock: Clock, parent: Transform) -> Option<NodePose> {
        let clock = clock.enter(node.cadence);
        let t = clock.t;
        // 规范 §7.7 的固定序：base → replace（order 大者胜）→ add 求和 →
        // multiply 求积 → 属性归一。没有 add / multiply 参与时 `scalar()` 原样
        // 返回 replace 值 ⇒ legacy 四槽逐位不变（「最后一条通道赢」）。
        let pose = sample_channels(&node.channels, t);
        let tx = pose.scalar("x", 0.0);
        let ty = pose.scalar("y", 0.0);
        let s_base = pose.scalar("scale", node.base_scale);
        let sx = pose.scalar("scaleX", node.base_scale_x.unwrap_or(1.0)) * s_base;
        let sy = pose.scalar("scaleY", node.base_scale_y.unwrap_or(1.0)) * s_base;
        let rot = pose.scalar("rotation", node.base_rotation);
        // `skewX` / `skewY`（§6.4）：CSS 口径的角度，x' = x + tan(skewX)·y。
        let skx = pose.scalar("skewX", 0.0);
        let sky = pose.scalar("skewY", 0.0);
        let opacity = pose.scalar("opacity", node.base_opacity);

        if opacity <= 0.001 || sx.abs() < 0.0005 || sy.abs() < 0.0005 {
            return None;
        }

        let a = self.anchor_point(node);
        let inherited_anchor = (
            parent.sx as f64 * (node.frame.x + tx + a.0)
                + parent.kx as f64 * (node.frame.y + ty + a.1)
                + parent.tx as f64,
            parent.ky as f64 * (node.frame.x + tx + a.0)
                + parent.sy as f64 * (node.frame.y + ty + a.1)
                + parent.ty as f64,
        );
        let parent = if node.screen_size {
            let x = (parent.sx as f64).hypot(parent.ky as f64).max(1e-9) as f32;
            let y = (parent.kx as f64).hypot(parent.sy as f64).max(1e-9) as f32;
            Transform::from_row(
                parent.sx / x,
                parent.ky / x,
                parent.kx / y,
                parent.sy / y,
                parent.tx,
                parent.ty,
            )
        } else {
            parent
        };
        let mut tf = compose(parent, translate(node.frame.x + tx, node.frame.y + ty));
        if rot != 0.0 || sx != 1.0 || sy != 1.0 || skx != 0.0 || sky != 0.0 {
            let a = self.anchor_point(node);
            tf = compose(tf, translate(a.0, a.1));
            if rot != 0.0 {
                tf = compose(tf, Transform::from_rotate(rot as f32));
            }
            if skx != 0.0 || sky != 0.0 {
                tf = compose(
                    tf,
                    Transform::from_skew(
                        skx.to_radians().tan() as f32,
                        sky.to_radians().tan() as f32,
                    ),
                );
            }
            tf = compose(tf, scale_xy(sx, sy));
            tf = compose(tf, translate(-a.0, -a.1));
        }
        if node.screen_size {
            tf.tx = (inherited_anchor.0 - tf.sx as f64 * a.0 - tf.kx as f64 * a.1) as f32;
            tf.ty = (inherited_anchor.1 - tf.ky as f64 * a.0 - tf.sy as f64 * a.1) as f32;
        }
        Some(NodePose {
            clock,
            tf,
            opacity,
            blur: pose.scalar("blur", 0.0),
            pose,
        })
    }

    /// Follow sources are constrained to paths with no following ancestor, so
    /// computing their transform cannot recurse through another follow dependency.
    fn node_pose_in_context(
        &self,
        node: &RNode,
        clock: Clock,
        parent: Transform,
        ctx: ClipCtx<'_>,
    ) -> Option<NodePose> {
        let mut own = self.node_pose(node, clock, parent)?;
        let Some(follow) = &node.follow else {
            return Some(own);
        };
        let mut chain = Vec::new();
        if !find_node_chain(ctx.root, &follow.source, &mut chain) {
            return None;
        }
        let source = *chain.last()?;
        let (mut source_clock, mut source_tf) = (ctx.clock, ctx.tf);
        let mut source_pose = None;
        for target in chain.iter().skip(usize::from(ctx.skip_root)) {
            let pose = self.node_pose(target, source_clock, source_tf)?;
            source_clock = pose.clock;
            source_tf = pose.tf;
            source_pose = Some(pose);
        }
        let source_pose = source_pose?;
        let values = &source_pose.pose.values;
        let morph = values
            .get("pathMorph")
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        let morphed = morph_subpaths(source, morph);
        let base = morphed.as_ref().unwrap_or(&source.subpaths);
        let total = if morphed.is_some() {
            polyline_len(base)
        } else {
            source.total_len
        };
        let wobbled = wobble_paths(source, base, source_clock);
        let paths = wobbled.as_ref().unwrap_or(base);
        let interval = path_interval(source, values);
        let fraction = own
            .pose
            .get("pathProgress")
            .and_then(Value::as_f64)
            .unwrap_or_else(|| match follow.position {
                pathstyle::FollowPosition::Start => interval.0,
                pathstyle::FollowPosition::End => interval.1,
                pathstyle::FollowPosition::Progress(p) => p,
            })
            .clamp(0.0, 1.0);
        let (point, tangent) = scene_primitives::svgpath::point_at(paths, total * fraction)?;
        let map = |tf: Transform, p: (f64, f64)| {
            (
                tf.sx as f64 * p.0 + tf.kx as f64 * p.1 + tf.tx as f64,
                tf.ky as f64 * p.0 + tf.sy as f64 * p.1 + tf.ty as f64,
            )
        };
        let mut goal = map(source_tf, point);
        let offset = (
            follow.offset[0] + node.frame.x + own.pose.scalar("x", 0.0),
            follow.offset[1] + node.frame.y + own.pose.scalar("y", 0.0),
        );
        goal.0 += parent.sx as f64 * offset.0 + parent.kx as f64 * offset.1;
        goal.1 += parent.ky as f64 * offset.0 + parent.sy as f64 * offset.1;
        if follow.rotate {
            let direction = (
                source_tf.sx as f64 * tangent.0 + source_tf.kx as f64 * tangent.1,
                source_tf.ky as f64 * tangent.0 + source_tf.sy as f64 * tangent.1,
            );
            let desired = direction.1.atan2(direction.0).to_degrees()
                + own.pose.scalar("rotation", node.base_rotation);
            let current = (own.tf.ky as f64).atan2(own.tf.sx as f64).to_degrees();
            own.tf = compose(Transform::from_rotate((desired - current) as f32), own.tf);
        }
        let anchor = self.anchor_point(node);
        own.tf.tx = (goal.0 - own.tf.sx as f64 * anchor.0 - own.tf.kx as f64 * anchor.1) as f32;
        own.tf.ty = (goal.1 - own.tf.ky as f64 * anchor.0 - own.tf.sy as f64 * anchor.1) as f32;
        Some(own)
    }

    fn record_node_inner(
        &self,
        node: &RNode,
        clock: Clock,
        parent: Transform,
        ctx: ClipCtx<'_>,
        r: &mut Recorder,
        engine: &mut TextEngine,
    ) {
        if r.split
            && let Some(echo) = &node.echo
        {
            let shift = |clock: Clock, offset: f64| {
                let real = (clock.real + offset).clamp(clock.floor.min(ctx.end), ctx.end);
                let shifted = Clock::new(real, clock.floor);
                clock
                    .fps
                    .map_or(shifted, |fps| shifted.enter(Cadence::Fps(fps)))
            };
            let mut samples = Vec::new();
            for &(offset, weight) in &echo.samples {
                if weight == 0.0 {
                    continue;
                }
                let mut sample = Recorder::new(true);
                let shifted = shift(clock, offset);
                let shifted_ctx = ClipCtx {
                    clock: shift(ctx.clock, offset),
                    ..ctx
                };
                self.record_node_without_echo(
                    node,
                    shifted,
                    parent,
                    shifted_ctx,
                    &mut sample,
                    engine,
                );
                samples.push((sample.finish().layers, weight));
            }
            r.push_group(FrameLayer::Group {
                layers: vec![FrameLayer::Temporal {
                    samples,
                    mode: echo.mode,
                }],
                masks: Vec::new(),
                effects: Vec::new(),
                blend: node.blend,
                opacity: 1.0,
            });
        } else {
            self.record_node_without_echo(node, clock, parent, ctx, r, engine);
        }
    }

    fn record_node_without_echo(
        &self,
        node: &RNode,
        clock: Clock,
        parent: Transform,
        ctx: ClipCtx<'_>,
        r: &mut Recorder,
        engine: &mut TextEngine,
    ) {
        let Some(NodePose {
            clock,
            tf,
            opacity,
            blur,
            pose,
        }) = self.node_pose_in_context(node, clock, parent, ctx)
        else {
            return;
        };
        if node.composition.is_some() && (node.frame.w <= 0.0 || node.frame.h <= 0.0) {
            return;
        }
        // 只读投影：借用即可，别为每节点每帧再深拷贝一张 map。
        let count_meta = pose.count_meta.as_ref();
        let mut text_values = None;
        if node.ntype == "text"
            && pose.has_composition()
            && node.channels.iter().any(|c| {
                matches!(
                    c.prop.as_str(),
                    "fontWeight" | "letterSpacing" | "textReveal"
                )
            })
        {
            let mut values = pose.values.clone();
            let spacing = if node.text_wrap.is_some() {
                node.style
                    .get("letterSpacing")
                    .and_then(Value::as_f64)
                    .unwrap_or(0.0)
            } else {
                0.0
            };
            for (prop, base) in [
                ("fontWeight", node.font_weight as f64),
                ("letterSpacing", spacing),
                ("textReveal", 1.0),
            ] {
                values.insert(prop.into(), Value::from(pose.scalar(prop, base)));
            }
            text_values = Some(values);
        }
        let p = text_values.as_ref().unwrap_or(&pose.values);

        if r.split && !node.backdrop_effects.is_empty() {
            let mut masks = vec![(
                Self::path_mask(box_path(node.frame.w, node.frame.h), tf),
                MatteMode::Alpha,
            )];
            let clip_path = self.node_clip_path(node, p);
            if let Some(path) = clip_path {
                masks.push((Self::path_mask(path, tf), MatteMode::Alpha));
            }
            if let Some(mask) = &node.mask {
                let mut source = Recorder::new(true);
                self.record_mask_source(&mask.source, ctx, &mut source, engine);
                masks.push((source.finish().layers, Self::matte_mode(mask)));
            }
            r.push_group(FrameLayer::Backdrop {
                masks,
                effects: node.backdrop_effects.clone(),
                opacity: opacity as f32,
            });
        }

        // ── 效果栈（规范 §6.6）：本元素及其子树先画进一张离屏 surface ──
        //
        // `blur` 通道等价于效果栈末尾隐式追加一个 `filter.blur`，与显式条目
        // 同时存在时相加（§6.6 的 `add` 合成）。半径以画布短边为基准换算成
        // 比例，与 manifest 的 `basis: canvasShortEdge` 同一口径。
        let effects = self.effect_stack(node, blur, &pose);
        // 本元素自己的分词模糊同样要求离屏组内录制（层 / 裁剪栈为空）。
        let descendants_fx =
            node.children.iter().any(Self::subtree_has_effect) || Self::has_part_blur(node);
        let mask_fx = node.mask.as_ref().is_some_and(|mask| {
            let mut chain = Vec::new();
            find_node_chain(ctx.root, &mask.source, &mut chain)
                && chain
                    .last()
                    .is_some_and(|source| Self::subtree_has_effect(source))
        });
        let has_clip = node.clip_poly.is_some() || Self::clip_shape_at(node, p).is_some();
        if r.split
            && (!effects.is_empty()
                || node.composition.is_some()
                || mask_fx
                || (descendants_fx
                    && (opacity < 0.999
                        || node.blend != BlendMode::Normal
                        || node.mask.is_some()
                        || has_clip)))
        {
            let mut sub = Recorder::new(true);
            self.record_node_content(node, clock, tf, p, count_meta, ctx, &mut sub, engine);
            let mut masks = Vec::new();
            if node.composition.is_some() {
                masks.push((
                    Self::path_mask(box_path(node.frame.w, node.frame.h), tf),
                    MatteMode::Alpha,
                ));
            }
            let clip_path = self.node_clip_path(node, p);
            if let Some(path) = clip_path {
                masks.push((Self::path_mask(path, tf), MatteMode::Alpha));
            }
            if let Some(mask) = &node.mask {
                let mut source = Recorder::new(true);
                self.record_mask_source(&mask.source, ctx, &mut source, engine);
                masks.push((source.finish().layers, Self::matte_mode(mask)));
            }
            r.push_group(FrameLayer::Group {
                layers: sub.finish().layers,
                masks,
                effects,
                blend: node.blend,
                opacity: opacity as f32,
            });
            return;
        }

        // 组不透明度 / 混合模式：层合成。`blendMode ≠ normal` 即使全不透明也要
        // 起层——混合是「这一层怎么合成回父画面」的语义。`style.mask` 也要起层：
        // 遮罩折进的是「这一层」的 alpha。
        let layered = opacity < 0.999 || node.blend != BlendMode::Normal || node.mask.is_some();
        if layered {
            r.push_layer(opacity as f32, node.blend);
        }
        self.record_body(node, clock, tf, p, count_meta, ctx, r, engine);
        if layered {
            r.pop_layer();
        }
    }

    /// 元素本体：裁剪 → 内容与子树 → （`style.mask`）遮罩层。调用方保证已处在
    /// 一个 `PushLayer` 之内（带 mask 时）。
    #[allow(clippy::too_many_arguments)]
    fn record_body(
        &self,
        node: &RNode,
        clock: Clock,
        tf: Transform,
        p: &Map<String, Value>,
        count_meta: Option<&Map<String, Value>>,
        ctx: ClipCtx<'_>,
        r: &mut Recorder,
        engine: &mut TextEngine,
    ) {
        if node.composition.is_some() {
            r.push_clip(box_path(node.frame.w, node.frame.h), mat(tf));
        }
        let clipped = self.record_clip(node, p, tf, r);
        self.record_node_content(node, clock, tf, p, count_meta, ctx, r, engine);
        if clipped {
            r.pop_clip();
        }
        if node.composition.is_some() {
            r.pop_clip();
        }
        if let Some(mask) = &node.mask {
            // 规范 §6.3：`PushMatte` → 遮罩源子树 → `PopMatte{mode}`，
            // 折进本层 alpha。裁剪已在上面配对收掉，不跨层边界。
            r.b.push(DrawOp::PushMatte);
            self.record_mask_source(&mask.source, ctx, r, engine);
            let mode = match (mask.luma, mask.invert) {
                (false, false) => MatteMode::Alpha,
                (false, true) => MatteMode::AlphaInverted,
                (true, false) => MatteMode::Luma,
                (true, true) => MatteMode::LumaInverted,
            };
            r.b.push(DrawOp::PopMatte { mode: mode.code() });
        }
    }

    /// 把 `style.mask.source` 指向的元素画进当前（遮罩）层。
    ///
    /// 遮罩源按**自己的布局位置与祖先变换**渲染：从 clip 根沿祖先链把每一级的
    /// 本刻变换与时钟算下来，祖先的不透明度、裁剪与混合不参与（遮罩只取 alpha /
    /// 亮度）。祖先链上任何一级本刻不出画 ⇒ 遮罩为空。
    /// 源子树使用调用方同样的分层方式，允许滤镜。
    fn record_mask_source(
        &self,
        source: &str,
        ctx: ClipCtx<'_>,
        r: &mut Recorder,
        engine: &mut TextEngine,
    ) {
        let mut chain: Vec<&RNode> = Vec::new();
        if !find_node_chain(ctx.root, source, &mut chain) {
            return;
        }
        let Some((target, ancestors)) = chain.split_last() else {
            return;
        };
        let mut clock = ctx.clock;
        let mut tf = ctx.tf;
        for ancestor in ancestors.iter().skip(usize::from(ctx.skip_root)) {
            let Some(pose) = self.node_pose_in_context(ancestor, clock, tf, ctx) else {
                return;
            };
            clock = pose.clock;
            tf = pose.tf;
        }
        self.record_node_inner(target, clock, tf, ctx, r, engine);
    }

    fn node_clip_path(&self, node: &RNode, p: &Map<String, Value>) -> Option<PathData> {
        if !p.get("clipPath").is_some_and(|value| !value.is_null())
            && let Some(poly) = &node.clip_poly
        {
            return Self::clip_poly_data(node, poly);
        }
        Self::clip_shape_at(node, p).and_then(|shape| Self::clip_path_data(node, shape))
    }

    fn subtree_has_effect(node: &RNode) -> bool {
        node.mask.is_some()
            || node.echo.is_some()
            || node.composition.is_some()
            || !node.backdrop_effects.is_empty()
            || !node.effects.is_empty()
            || node.channels.iter().any(|c| c.prop == "blur")
            || Self::has_part_blur(node)
            || node.children.iter().any(Self::subtree_has_effect)
    }

    /// `animate.parts` 里有 `blur` 通道（§6.4 分词模糊）。
    fn has_part_blur(node: &RNode) -> bool {
        node.part_motion.as_ref().is_some_and(|parts| {
            parts
                .channels
                .iter()
                .flatten()
                .any(|channel| channel.prop == "blur")
        })
    }

    /// 把分词模糊的各桶收成离屏层：每桶一层 `filter.blur`（半径按画布短边换成
    /// 比例，与元素级 `blur` 通道同一口径），按首次出现的顺序叠在元素内容之上。
    fn flush_part_blur(&self, buckets: PartBlurBuckets, r: &mut Recorder) {
        use motion::effect::{EffectRef, UniformMap, UniformValue};
        let short_edge = f64::from(self.width.min(self.height)).max(1.0);
        for (bits, builder) in buckets {
            let ops = builder.finish();
            if ops.ops.is_empty() {
                continue;
            }
            r.push_group(FrameLayer::Effect {
                ops,
                effects: vec![ResolvedEffect {
                    effect: EffectRef::new("filter.blur", 1),
                    uniforms: UniformMap::new().with(
                        "radius",
                        UniformValue::Scalar(f64::from_bits(bits) / short_edge),
                    ),
                }],
                blend: BlendMode::Normal,
                opacity: 1.0,
            });
        }
    }

    fn path_mask(path: PathData, tf: Transform) -> Vec<FrameLayer> {
        let mut b = FrameBuilder::default();
        let path = b.path_id(path);
        b.push(DrawOp::FillPath {
            path,
            color: [1.0; 4],
            tf: mat(tf),
        });
        vec![FrameLayer::Ops(b.finish())]
    }

    fn matte_mode(mask: &scene_primitives::resolve::ElementMask) -> MatteMode {
        match (mask.luma, mask.invert) {
            (false, false) => MatteMode::Alpha,
            (false, true) => MatteMode::AlphaInverted,
            (true, false) => MatteMode::Luma,
            (true, true) => MatteMode::LumaInverted,
        }
    }

    /// 本刻生效的效果栈。空 ⇒ 不需要离屏 surface。
    fn effect_stack(
        &self,
        node: &RNode,
        blur_px: f64,
        pose: &scene_primitives::sample::SampledPose,
    ) -> Vec<ResolvedEffect> {
        use motion::effect::{EffectRef, UniformValue};
        let short_edge = f64::from(self.width.min(self.height)).max(1.0);
        let extra = if blur_px > 0.0 {
            blur_px / short_edge
        } else {
            0.0
        };
        if node.effects.is_empty() && extra <= 0.0 {
            return Vec::new();
        }
        let mut stack = node.effects.clone();
        // 效果参数通道 `effects[N].<param>`（§6.6）：本刻采样值覆盖静态参数，再按
        // manifest 的 min/max 夹取。覆盖后的 uniform 进入 Filter pass，因而也进入
        // 帧指纹——动画帧不会被 FrameCache 当成同一帧去重。
        for channel in &node.channels {
            let Some((index, param)) = motion::value::effect_param_channel(&channel.prop) else {
                continue;
            };
            let Some(item) = stack.get_mut(index) else {
                continue;
            };
            let Ok(manifest) = motion::effect::lookup(&item.effect.id, item.effect.version) else {
                continue;
            };
            let Some(spec) = manifest.params.get(param) else {
                continue;
            };
            if !matches!(
                spec.kind,
                motion::effect::ParamKind::Number | motion::effect::ParamKind::Length
            ) {
                continue;
            }
            let base = item.uniforms.scalar(param).unwrap_or(0.0);
            let mut value = pose.scalar(&channel.prop, base);
            if !value.is_finite() {
                continue;
            }
            if let Some(min) = spec.min {
                value = value.max(min);
            }
            if let Some(max) = spec.max {
                value = value.min(max);
            }
            item.uniforms.insert(param, UniformValue::Scalar(value));
        }
        if extra > 0.0 {
            match stack
                .iter_mut()
                .find(|item| item.effect.id == "filter.blur")
            {
                // 同时存在 ⇒ 相加（§6.6）。
                Some(existing) => {
                    let base = existing.uniforms.scalar("radius").unwrap_or(0.0);
                    existing
                        .uniforms
                        .insert("radius", UniformValue::Scalar(base + extra));
                }
                None => stack.push(ResolvedEffect {
                    effect: EffectRef::new("filter.blur", 1),
                    uniforms: motion::effect::UniformMap::new()
                        .with("radius", UniformValue::Scalar(extra)),
                }),
            }
        }
        stack
    }

    /// `clipPath`（规范 §6.3）：静态 `style.clipPath` 由本刻的 `clipPath` 通道
    /// 覆盖。发 `ClipPath` 时返回 true，调用方负责配对的 `PopClip`。
    fn record_clip(
        &self,
        node: &RNode,
        p: &Map<String, Value>,
        tf: Transform,
        r: &mut Recorder,
    ) -> bool {
        // 通道优先：`clipPath` 通道本刻有值就用它；否则静态 `path` 形状、再否则
        // 静态参数化形状。
        let channel_live = p.get("clipPath").is_some_and(|value| !value.is_null());
        if !channel_live
            && let Some(poly) = &node.clip_poly
            && let Some(path) = Self::clip_poly_data(node, poly)
        {
            r.push_clip(path, mat(tf));
            return true;
        }
        let Some(shape) = Self::clip_shape_at(node, p) else {
            return false;
        };
        let Some(path) = Self::clip_path_data(node, shape) else {
            return false;
        };
        r.push_clip(path, mat(tf));
        true
    }

    /// `path` 形状（元素盒比例的折线）→ 局部坐标路径。
    ///
    /// `DrawOp::ClipPath` 只有 nonzero 语义；even-odd 在这里不可表达，解析期
    /// 已接受该键是为了与 `fillRule` 同形，录制期按 nonzero 处理并由 lint 提示。
    fn clip_poly_data(node: &RNode, poly: &ClipPoly) -> Option<PathData> {
        let (w, h) = (node.frame.w, node.frame.h);
        if w <= 0.0 || h <= 0.0 {
            return None;
        }
        let mut pb = PathBuilder::new();
        for sub in &poly.subpaths {
            pb.move_to((sub[0].0 * w) as f32, (sub[0].1 * h) as f32);
            for point in &sub[1..] {
                pb.line_to((point.0 * w) as f32, (point.1 * h) as f32);
            }
            pb.close();
        }
        Some(path_from_skia(&pb.finish()?))
    }

    fn clip_shape_at(node: &RNode, p: &Map<String, Value>) -> Option<ClipShape> {
        match p.get("clipPath") {
            // 通道值非法在 lint 期已是 error（`schema` / `effect-capability-unsupported`）；
            // 录制期没有 Result，退回静态形状而不是画错。
            Some(value) if !value.is_null() => {
                ClipShape::parse(value).ok().flatten().or(node.clip_shape)
            }
            _ => node.clip_shape,
        }
    }

    /// 形状（元素盒比例）→ 局部坐标路径。恒等裁剪返回 `None`。
    fn clip_path_data(node: &RNode, shape: ClipShape) -> Option<PathData> {
        if shape.is_identity() {
            return None;
        }
        let (w, h) = (node.frame.w, node.frame.h);
        if w <= 0.0 || h <= 0.0 {
            return None;
        }
        let short = w.min(h);
        let mut pb = PathBuilder::new();
        match shape {
            ClipShape::Inset {
                top,
                right,
                bottom,
                left,
                radius,
            } => {
                let x0 = (left * w).max(0.0);
                let y0 = (top * h).max(0.0);
                let x1 = (w - right * w).min(w);
                let y1 = (h - bottom * h).min(h);
                if x1 <= x0 || y1 <= y0 {
                    // 完全裁空：给一条零面积路径，元素本刻不出画。
                    pb.push_rect(tiny_skia::Rect::from_xywh(0.0, 0.0, 0.0, 0.0)?);
                    return Some(path_from_skia(&pb.finish()?));
                }
                let r = radius * short;
                if r > 0.0 {
                    // 圆角矩形与 `FillRect{radius}` 共用同一条路径构造，
                    // 免得裁剪边与背景边差半个像素。
                    let path = crate::raster::rounded_rect_path(x0, y0, x1 - x0, y1 - y0, r)?;
                    return Some(path_from_skia(&path));
                }
                pb.push_rect(tiny_skia::Rect::from_ltrb(
                    x0 as f32, y0 as f32, x1 as f32, y1 as f32,
                )?);
            }
            ClipShape::Circle { cx, cy, r } => {
                let radius = (r * short) as f32;
                if radius <= 0.0 {
                    return None;
                }
                pb.push_circle((cx * w) as f32, (cy * h) as f32, radius);
            }
            ClipShape::Ellipse { cx, cy, rx, ry } => {
                let (a, bb) = ((rx * w) as f32, (ry * h) as f32);
                if a <= 0.0 || bb <= 0.0 {
                    return None;
                }
                let rect = tiny_skia::Rect::from_ltrb(
                    (cx * w) as f32 - a,
                    (cy * h) as f32 - bb,
                    (cx * w) as f32 + a,
                    (cy * h) as f32 + bb,
                )?;
                pb.push_oval(rect);
            }
        }
        Some(path_from_skia(&pb.finish()?))
    }

    fn record_node_background(
        node: &RNode,
        p: &Map<String, Value>,
        tf: Transform,
        b: &mut FrameBuilder,
    ) {
        let bg = Rgba::parse_value(p.get("backgroundColor")).or(node.bg_color);
        let radius = p
            .get("borderRadius")
            .and_then(Value::as_f64)
            .unwrap_or(node.border_radius);
        if let Some(bg) = bg {
            b.push(DrawOp::FillRect {
                x: 0.0,
                y: 0.0,
                w: node.frame.w as f32,
                h: node.frame.h as f32,
                radius: radius as f32,
                color: col(&bg, 1.0),
                tf: mat(tf),
            });
        } else if let Some(gradient) = &node.bg_gradient {
            // 渐变背景（规范 §6.3）：圆角矩形路径 + paint 侧表，与 `FillRect` 共用
            // 同一条路径构造，圆角边与纯色背景差不到半个像素。`backgroundColor`
            // 通道本刻有值时上面那支已经画了纯色——通道压过静态渐变。
            Self::record_gradient_background(node, gradient, radius, tf, b);
        }
        if let Some(border) = &node.border {
            Self::record_border(node, border, radius, tf, b);
        }
    }

    /// `style.border`（§6.3）：外圈是元素盒的圆角矩形、内圈向里收 `width`，even-odd 填出一圈；
    /// 内圆角 = 外圆角（按盒短边的一半封顶后）− width。描边宽过盒的一半时整块填满。
    fn record_border(
        node: &RNode,
        border: &BoxBorder,
        radius: f64,
        tf: Transform,
        b: &mut FrameBuilder,
    ) {
        let (w, h) = (node.frame.w, node.frame.h);
        if w <= 0.0 || h <= 0.0 {
            return;
        }
        let Some(outer) = crate::raster::rounded_rect_path(0.0, 0.0, w, h, radius) else {
            return;
        };
        let bw = border.width.min(w / 2.0).min(h / 2.0);
        let outer_r = radius.min(w.min(h) / 2.0).max(0.0);
        let mut pb = PathBuilder::new();
        pb.push_path(&outer);
        if let Some(inner) = crate::raster::rounded_rect_path(
            bw,
            bw,
            w - 2.0 * bw,
            h - 2.0 * bw,
            (outer_r - bw).max(0.0),
        ) {
            pb.push_path(&inner);
        }
        let Some(ring) = pb.finish() else {
            return;
        };
        let path = b.path_id(path_from_skia(&ring));
        let paint = b.paint_id(crate::drawop::PaintData::Solid(col(&border.color, 1.0)));
        b.push(DrawOp::FillPathPaint {
            path,
            paint,
            even_odd: true,
            tf: mat(tf),
        });
    }

    #[allow(clippy::too_many_arguments)]
    fn record_node_content(
        &self,
        node: &RNode,
        clock: Clock,
        tf: Transform,
        p: &Map<String, Value>,
        count_meta: Option<&Map<String, Value>>,
        ctx: ClipCtx<'_>,
        r: &mut Recorder,
        engine: &mut TextEngine,
    ) {
        if r.split
            && let Some(canvas) = &node.composition
        {
            let local_renderer = FrameRenderer {
                width: canvas.width as u32,
                height: canvas.height as u32,
                lotties: self.lotties.clone(),
                textures: self.textures.clone(),
                paints: self.paints.clone(),
                grid_cache: self.grid_cache.clone(),
            };
            let mut local_recorder = Recorder::new(true);
            Self::record_node_background(
                node,
                p,
                scale_xy(canvas.width / node.frame.w, canvas.height / node.frame.h),
                &mut local_recorder.b,
            );
            let elapsed = clock.real - node.media_win_start;
            let local = node
                .time_map
                .as_ref()
                .map_or(elapsed, |map| map.sample(elapsed))
                .clamp(0.0, canvas.duration);
            let mut local_clock = Clock::new(local, 0.0);
            if let Some(fps) = clock.fps {
                local_clock = local_clock.enter(Cadence::Fps(fps));
            }
            let camera = sample_frames(&node.local_camera, local);
            let (x, y, zoom) = (
                camera.gf64("x").unwrap_or(0.0),
                camera.gf64("y").unwrap_or(0.0),
                camera.gf64("zoom").unwrap_or(1.0),
            );
            let camera_tf = compose(
                compose(
                    translate(
                        canvas.width / 2.0 - x * zoom,
                        canvas.height / 2.0 - y * zoom,
                    ),
                    scale_xy(zoom, zoom),
                ),
                translate(-canvas.width / 2.0, -canvas.height / 2.0),
            );
            let local_ctx = ClipCtx {
                root: node,
                clock: local_clock,
                tf: camera_tf,
                skip_root: true,
                end: canvas.duration,
            };
            for child in &node.children {
                local_renderer.record_node(
                    child,
                    local_clock,
                    camera_tf,
                    local_ctx,
                    &mut local_recorder,
                    engine,
                );
            }
            r.push_group(FrameLayer::LocalCanvas {
                layers: local_recorder.finish().layers,
                width: canvas.width as u32,
                height: canvas.height as u32,
                tf: mat(compose(
                    tf,
                    scale_xy(node.frame.w / canvas.width, node.frame.h / canvas.height),
                )),
            });
            return;
        }
        // 分词模糊（§6.4）：只有分层录制、且没有未收的祖先层 / 裁剪时才能起离屏组；
        // 调用方（`record_node_without_echo` 的 Group 判据）保证带 part blur 的元素
        // 与其祖先在需要时已经改走离屏组，这里的栈是空的。
        let mut part_blur =
            (r.split && r.stack.is_empty() && Self::has_part_blur(node)).then(PartBlurBuckets::new);
        let b = &mut r.b;
        let t = clock.t;
        Self::record_node_background(node, p, tf, b);

        match node.ntype.as_str() {
            "text" => self.record_text(node, t, p, count_meta, tf, b, part_blur.as_mut(), engine),
            "charGrid" => {
                self.record_char_grid(node, (t - node.media_win_start).max(0.0), tf, b, engine)
            }
            // 程序化源（§6.12）：局部秒闭式求值，受 `cadence` 量化（与 charGrid 同）。
            "proc" => {
                if let Some(proc) = &node.proc {
                    crate::source::proc::record_proc(
                        proc,
                        node.frame.w,
                        node.frame.h,
                        (t - node.media_win_start).max(0.0),
                        tf,
                        b,
                    );
                }
            }
            "path" => self.record_path(node, p, clock, tf, b),
            // 媒体自带时间轴：不受 `cadence` 量化（规范 §7.10）。
            "image" | "animatedImage" | "program" | "video" => {
                self.record_media(node, clock.real, p, tf, b)
            }
            "lottie" => self.record_lottie(node, clock.real, tf, b),
            _ => {}
        }
        if let Some(buckets) = part_blur {
            self.flush_part_blur(buckets, r);
        }
        if let Some(canvas) = &node.composition {
            let elapsed = clock.real - node.media_win_start;
            let local = node
                .time_map
                .as_ref()
                .map_or(elapsed, |map| map.sample(elapsed))
                .clamp(0.0, canvas.duration);
            let mut local_clock = Clock::new(local, 0.0);
            if let Some(fps) = clock.fps {
                local_clock = local_clock.enter(Cadence::Fps(fps));
            }
            let camera = sample_frames(&node.local_camera, local);
            let (x, y, zoom) = (
                camera.gf64("x").unwrap_or(0.0),
                camera.gf64("y").unwrap_or(0.0),
                camera.gf64("zoom").unwrap_or(1.0),
            );
            let mut child_tf = compose(
                tf,
                scale_xy(node.frame.w / canvas.width, node.frame.h / canvas.height),
            );
            child_tf = compose(
                child_tf,
                translate(
                    canvas.width / 2.0 - x * zoom,
                    canvas.height / 2.0 - y * zoom,
                ),
            );
            child_tf = compose(child_tf, scale_xy(zoom, zoom));
            child_tf = compose(
                child_tf,
                translate(-canvas.width / 2.0, -canvas.height / 2.0),
            );
            let local_ctx = ClipCtx {
                root: node,
                clock: local_clock,
                tf: child_tf,
                skip_root: true,
                end: canvas.duration,
            };
            for child in &node.children {
                self.record_node(child, local_clock, child_tf, local_ctx, r, engine);
            }
        } else {
            for child in &node.children {
                self.record_node(child, clock, tf, ctx, r, engine);
            }
        }
    }

    fn record_char_grid(
        &self,
        node: &RNode,
        time: f64,
        tf: Transform,
        b: &mut FrameBuilder,
        engine: &mut TextEngine,
    ) {
        let Some(grid) = &node.char_grid else {
            return;
        };
        struct Glyph {
            path: Option<tiny_skia::Path>,
            width: f64,
            ascent: f64,
            descent: f64,
        }
        let mut glyphs = std::collections::HashMap::<&str, Glyph>::new();
        for layer in &grid.layers {
            let cells = grid.sample_layer(layer, time);
            let mut key = Vec::new();
            key.extend(node.font_family.as_bytes());
            key.push(0);
            for n in [
                node.font_size,
                grid.cell_width,
                grid.cell_height,
                grid.cols as f64,
            ] {
                key.extend(n.to_le_bytes());
            }
            key.extend(node.font_weight.to_le_bytes());
            key.push(u8::from(node.font_italic));
            for cell in &cells {
                if let Some(text) = cell {
                    key.push(1);
                    key.extend(text.as_bytes());
                } else {
                    key.push(0);
                }
                key.push(0);
            }
            let key = crate::drawop::fnv1a64(&key);
            if let Some(path) = self.grid_cache.get(key) {
                let path = b.path_id(path.as_ref().clone());
                b.push(DrawOp::FillPath {
                    path,
                    color: col(&layer.color, 1.0),
                    tf: mat(tf),
                });
                continue;
            }
            let mut batch = PathBuilder::new();
            for (index, text) in cells
                .into_iter()
                .enumerate()
                .filter_map(|(i, c)| c.map(|s| (i, s)))
            {
                if text.chars().all(char::is_whitespace) {
                    continue;
                }
                let glyph = glyphs.entry(text).or_insert_with(|| {
                    if let Some(path) =
                        cell_symbol(text, grid.cell_width, grid.cell_height, node.font_size)
                    {
                        return Glyph {
                            path: Some(path),
                            width: grid.cell_width,
                            ascent: grid.cell_height,
                            descent: 0.0,
                        };
                    }
                    let shaped = engine.shape_styled(
                        text,
                        &node.font_family,
                        node.font_size,
                        node.font_weight,
                        node.font_italic,
                    );
                    let mut path = PathBuilder::new();
                    for glyph in &shaped.glyphs {
                        if let Some(outline) = engine
                            .glyph_path(glyph.cache_key)
                            .and_then(|path| path.transform(translate(glyph.x, glyph.y)))
                        {
                            path.push_path(&outline);
                        }
                    }
                    Glyph {
                        path: path.finish(),
                        width: shaped.width,
                        ascent: shaped.ascent,
                        descent: shaped.descent,
                    }
                });
                let Some(path) = &glyph.path else {
                    continue;
                };
                let scale = (grid.cell_width / glyph.width.max(1.0))
                    .min(grid.cell_height / (glyph.ascent + glyph.descent).max(1.0))
                    .min(1.0);
                let x = (index % grid.cols) as f64 * grid.cell_width
                    + (grid.cell_width - glyph.width * scale) / 2.0;
                let baseline = (index / grid.cols) as f64 * grid.cell_height
                    + (grid.cell_height - (glyph.ascent + glyph.descent) * scale) / 2.0
                    + glyph.ascent * scale;
                if let Some(outline) = path
                    .clone()
                    .transform(compose(translate(x, baseline), scale_xy(scale, scale)))
                {
                    batch.push_path(&outline);
                }
            }
            if let Some(path) = batch.finish() {
                let path = Arc::new(path_from_skia(&path));
                self.grid_cache.put(key, path.clone());
                let path = b.path_id(path.as_ref().clone());
                b.push(DrawOp::FillPath {
                    path,
                    color: col(&layer.color, 1.0),
                    tf: mat(tf),
                });
            }
        }
    }

    fn anchor_point(&self, node: &RNode) -> (f64, f64) {
        let (w, h) = (node.frame.w, node.frame.h);
        if let Some((x, y)) = node.anchor_xy {
            return (x * w, y * h);
        }
        match node.anchor.as_str() {
            "bottom" => (w / 2.0, h),
            "top" => (w / 2.0, 0.0),
            _ => (w / 2.0, h / 2.0),
        }
    }

    // ── 媒体节点（image / video）：只录引用，字节在光栅化阶段进入 ──
    fn record_media(
        &self,
        node: &RNode,
        t: f64,
        p: &Map<String, Value>,
        tf: Transform,
        b: &mut FrameBuilder,
    ) {
        let Some(id) = &node.asset_id else { return };
        if node.nat_w <= 0.0 || node.nat_h <= 0.0 {
            return; // 元数据未注入（lint/加载阶段已报错，这里防御）
        }
        let mut bounds = [
            f64::INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
        ];
        for (x, y) in [
            (0.0, 0.0),
            (node.frame.w, 0.0),
            (0.0, node.frame.h),
            (node.frame.w, node.frame.h),
        ] {
            let (x, y) = (
                tf.sx as f64 * x + tf.kx as f64 * y + tf.tx as f64,
                tf.ky as f64 * x + tf.sy as f64 * y + tf.ty as f64,
            );
            bounds[0] = bounds[0].min(x);
            bounds[1] = bounds[1].min(y);
            bounds[2] = bounds[2].max(x);
            bounds[3] = bounds[3].max(y);
        }
        if bounds[2] < 0.0
            || bounds[3] < 0.0
            || bounds[0] > self.width as f64
            || bounds[1] > self.height as f64
        {
            return;
        }
        let media_ms: i64 = match node.ntype.as_str() {
            "video" => (Self::video_src_time(node, t) * 1000.0).round() as i64,
            // `program`（§6.5.3）与动图同一套帧表语义：帧起点毫秒按声明的 fps 生成。
            "animatedImage" | "program" => Self::animated_src_ms(node, t),
            _ => -1,
        };
        // 天然尺寸 → 布局盒（§6.5 fit；image 保持既有拉伸语义 = fill）
        let framing = node.media_crop.is_some()
            || node.media_focal.is_some()
            || ["crop", "focalX", "focalY"]
                .iter()
                .any(|key| p.contains_key(*key));
        let (s, src) = if framing {
            Self::framed_media_transform(node, p)
        } else if node.ntype == "image" {
            (
                scale_xy(node.frame.w / node.nat_w, node.frame.h / node.nat_h),
                [0.0f32; 4],
            )
        } else {
            Self::fit_transform(node)
        };
        let asset = b.string_id(id);
        b.push(DrawOp::DrawMedia {
            asset,
            media_ms,
            src,
            tf: mat(compose(tf, s)),
        });
    }

    /// §6.5 帧精确采样：srcTime = mediaStart + (t − clip.start) × rate，
    /// segment/loop 折叠后按源帧率量化到帧起点；越界 clamp 至末帧（冻结）。
    fn video_src_time(node: &RNode, t: f64) -> f64 {
        let mut src = node.time_map.as_ref().map_or_else(
            || node.media_start + (t - node.media_win_start) * node.playback_rate,
            |map| map.sample(t - node.media_win_start),
        );
        if let Some((s0, s1)) = node.segment {
            if node.loop_media && s1 > s0 {
                src = s0 + (src - s0).rem_euclid(s1 - s0);
            } else {
                src = src.min(s1); // 片段尽头冻结
            }
        } else if node.loop_media && node.media_duration > 0.0 {
            src = src.rem_euclid(node.media_duration);
        }
        src = src.max(0.0);
        if node.media_fps > 0.0 {
            // frameIndex = clamp(floor(srcTime × fps + ε), 0, N−1)，N 未知时不设上限
            let mut idx = (src * node.media_fps + 1e-9).floor();
            if node.media_duration > 0.0 {
                let n = (node.media_duration * node.media_fps).round().max(1.0);
                idx = idx.clamp(0.0, n - 1.0);
            } else {
                idx = idx.max(0.0);
            }
            src = idx / node.media_fps;
        } else if node.media_duration > 0.0 {
            src = src.min(node.media_duration);
        }
        src
    }

    /// §6.5.1 动图采样：源时间公式与视频同构
    /// （`srcTime = mediaStart + (t − clip.start) × rate`），只是把"按源帧率
    /// 量化"换成"按逐帧时长表量化"，并且循环按**播放遍数**折叠。
    ///
    /// 返回的是该帧的**起点毫秒**：同一帧窗口内的所有时刻因此发出逐字节相同的
    /// `DrawMedia`，静止帧缓存与帧指纹才命中得了。
    fn animated_src_ms(node: &RNode, t: f64) -> i64 {
        let table = &node.frame_starts_ms;
        let n = table.len().saturating_sub(1);
        if n == 0 {
            return 0; // 元数据未注入（加载阶段已报错，这里防御）
        }
        let total = table[n] as f64 / 1000.0;
        let (s0, s1) = match node.segment {
            Some((a, b)) => (a.min(total), b.min(total)),
            None => (0.0, total),
        };
        let mut src = node.time_map.as_ref().map_or_else(
            || node.media_start + (t - node.media_win_start) * node.playback_rate,
            |map| map.sample(t - node.media_win_start),
        );
        let span = s1 - s0;
        let elapsed = src - s0;
        if node.time_map.is_none() && span > 0.0 && elapsed >= 0.0 {
            // plays = 0 → 无限循环；否则放完 plays 遍就冻结在片段末尾
            if node.media_plays == 0 || elapsed < span * f64::from(node.media_plays) {
                src = s0 + elapsed.rem_euclid(span);
            } else {
                src = s1;
            }
        }
        // 帧表按 `round(k·1000/fps)` 建，起点可能恰在半毫秒上（29.97 fps 的第 15 帧是
        // 500.5 ms、48 fps 的第 3 帧是 62.5 ms）；clip 不从 0 开始时 `t - start` 的浮点
        // 误差会让它落在 500.4999… 而舍到上一帧。加 1 ns 的容差吸收这类误差。
        let ms = (src.clamp(0.0, total) * 1000.0 + 1e-6).round() as i64;
        crate::source::frame_start_ms(table, ms)
    }

    /// 矢量源（`lottie`，§6.5.2）：不发 `DrawMedia`，把子集渲染器的指令**内联**
    /// 进本帧的指令流。矢量内容因此跟着元素盒缩放，而不是先烤成素材原尺寸的
    /// 位图再拉伸。
    ///
    /// 源时间语义与动图逐字相同（`animated_src_ms`）：`loop` / `segment` /
    /// `playbackRate` 折叠后按合成帧表量化到帧起点，同一帧窗口发出逐字节相同
    /// 的指令，静止帧缓存照常命中。
    fn record_lottie(&self, node: &RNode, t: f64, tf: Transform, b: &mut FrameBuilder) {
        let Some(id) = &node.asset_id else { return };
        let Some(lottie) = self.lotties.get(id) else {
            return; // `new_with_assets` 已 fail-fast，这里只是防御
        };
        if node.nat_w <= 0.0 || node.nat_h <= 0.0 {
            return;
        }
        let ms = Self::animated_src_ms(node, t);
        let (fit, clip_to_box) = Self::vector_fit(node);
        let inner = compose(tf, fit);
        if clip_to_box {
            // cover 的画面比盒子大：矢量没有"源裁剪矩形"可用，改裁盒子本身
            let path = b.path_id(box_path(node.frame.w, node.frame.h));
            b.push(DrawOp::ClipPath { path, tf: mat(tf) });
        }
        // `record` 只在子资源缺失时才会失败，而那在 `load_assets` 已经拦过了
        let _ = lottie.record(MediaTime::from_millis(ms), inner, b);
        if clip_to_box {
            b.push(DrawOp::PopClip);
        }
    }

    /// 矢量源的 §6.5 fit。返回 (变换, 是否需要把画面裁回元素盒)。
    ///
    /// 与 [`FrameRenderer::fit_transform`] 的差别只在 `cover`：位图那条路把
    /// 溢出部分从**源像素**里裁掉，矢量没有源像素，只能居中之后裁盒子。
    fn vector_fit(node: &RNode) -> (Transform, bool) {
        let (nw, nh) = (node.nat_w, node.nat_h);
        let (bw, bh) = (node.frame.w, node.frame.h);
        match node.fit {
            scene_primitives::Fit::Fill => (scale_xy(bw / nw, bh / nh), false),
            scene_primitives::Fit::Contain | scene_primitives::Fit::Cover => {
                let cover = matches!(node.fit, scene_primitives::Fit::Cover);
                let s = if cover {
                    (bw / nw).max(bh / nh)
                } else {
                    (bw / nw).min(bh / nh)
                };
                let tf = compose(
                    translate((bw - nw * s) / 2.0, (bh - nh * s) / 2.0),
                    scale_xy(s, s),
                );
                (tf, cover)
            }
        }
    }

    fn framed_media_transform(node: &RNode, p: &Map<String, Value>) -> (Transform, [f32; 4]) {
        let mut crop = node.media_crop.unwrap_or([0.0, 0.0, 1.0, 1.0]);
        if let Some(animated) = p.get("crop") {
            for (i, key) in ["x", "y", "width", "height"].iter().enumerate() {
                crop[i] = animated
                    .get(*key)
                    .and_then(Value::as_f64)
                    .unwrap_or(crop[i]);
            }
        }
        crop[2] = crop[2].clamp(1e-6, 1.0);
        crop[3] = crop[3].clamp(1e-6, 1.0);
        crop[0] = crop[0].clamp(0.0, 1.0 - crop[2]);
        crop[1] = crop[1].clamp(0.0, 1.0 - crop[3]);
        let base = node.media_focal.unwrap_or([0.5, 0.5]);
        let fx = p
            .get("focalX")
            .and_then(Value::as_f64)
            .unwrap_or(base[0])
            .clamp(0.0, 1.0);
        let fy = p
            .get("focalY")
            .and_then(Value::as_f64)
            .unwrap_or(base[1])
            .clamp(0.0, 1.0);
        let (x, y, w, h) = (
            crop[0] * node.nat_w,
            crop[1] * node.nat_h,
            crop[2] * node.nat_w,
            crop[3] * node.nat_h,
        );
        let (bw, bh) = (node.frame.w, node.frame.h);
        let rect = |x, y, w, h| [x as f32, y as f32, w as f32, h as f32];
        match node.fit {
            scene_primitives::Fit::Fill => (scale_xy(bw / w, bh / h), rect(x, y, w, h)),
            scene_primitives::Fit::Contain => {
                let scale = (bw / w).min(bh / h);
                (
                    compose(
                        translate((bw - w * scale) * fx, (bh - h * scale) * fy),
                        scale_xy(scale, scale),
                    ),
                    rect(x, y, w, h),
                )
            }
            scene_primitives::Fit::Cover => {
                let scale = (bw / w).max(bh / h);
                let (vw, vh) = (bw / scale, bh / scale);
                (
                    scale_xy(scale, scale),
                    rect(x + (w - vw) * fx, y + (h - vh) * fy, vw, vh),
                )
            }
        }
    }

    /// §6.5 fit：天然尺寸到布局盒的变换 + cover 的源裁剪矩形。
    fn fit_transform(node: &RNode) -> (Transform, [f32; 4]) {
        let (nw, nh) = (node.nat_w, node.nat_h);
        let (bw, bh) = (node.frame.w, node.frame.h);
        match node.fit {
            scene_primitives::Fit::Fill => (scale_xy(bw / nw, bh / nh), [0.0; 4]),
            scene_primitives::Fit::Contain => {
                let s = (bw / nw).min(bh / nh);
                let tf = compose(
                    translate((bw - nw * s) / 2.0, (bh - nh * s) / 2.0),
                    scale_xy(s, s),
                );
                (tf, [0.0; 4])
            }
            scene_primitives::Fit::Cover => {
                let s = (bw / nw).max(bh / nh);
                // 源侧裁掉盒外区域：可见源区 = 盒尺寸 / s，居中
                let (vw, vh) = (bw / s, bh / s);
                let (sx, sy) = ((nw - vw) / 2.0, (nh - vh) / 2.0);
                let src = [sx as f32, sy as f32, vw as f32, vh as f32];
                (scale_xy(s, s), src)
            }
        }
    }

    // ── 文本（含 countUp 数字滚动、文字 part 动画） ──
    #[allow(clippy::too_many_arguments)]
    fn record_text(
        &self,
        node: &RNode,
        t: f64,
        p: &Map<String, Value>,
        count_meta: Option<&Map<String, Value>>,
        tf: Transform,
        b: &mut FrameBuilder,
        mut blurred: Option<&mut PartBlurBuckets>,
        engine: &mut TextEngine,
    ) {
        let mut string = p
            .get("text")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .unwrap_or_else(|| node.text.clone().unwrap_or_default());
        let weight = p
            .get("fontWeight")
            .and_then(Value::as_f64)
            .map(|weight| weight.round().clamp(1.0, 1000.0) as u16)
            .unwrap_or(node.font_weight);
        let reveal = p
            .get("textReveal")
            .and_then(Value::as_f64)
            .unwrap_or(1.0)
            .clamp(0.0, 1.0);
        if let Some(count) = p.get("textCount").and_then(Value::as_f64) {
            string = fmt_count(count, count_meta);
        }
        let mut color = node.text_color;
        if let Some(cs) = p.get("color").and_then(Value::as_str) {
            if let Some(c) = Rgba::parse(cs) {
                color = c;
            }
        }
        if let Some(base_block) = &node.text_block {
            let base_spacing = node
                .style
                .get("letterSpacing")
                .and_then(Value::as_f64)
                .unwrap_or(0.0);
            let spacing = p
                .get("letterSpacing")
                .or_else(|| node.style.get("letterSpacing"))
                .and_then(Value::as_f64)
                .unwrap_or(0.0);
            let base = scene_primitives::text_layout::FontStyle {
                family: &node.font_family,
                size: node.font_size,
                weight,
                italic: node.font_italic,
                spacing,
            };
            let changed_block;
            let block = if node.text.as_deref() == Some(string.as_str()) {
                base_block
            } else {
                changed_block = scene_primitives::text_layout::layout(
                    &string,
                    node.text_wrap.unwrap(),
                    node.style.get("width").and_then(Value::as_f64),
                    base_block.line_height,
                    |range| {
                        let shaped = engine.shape_spaced(
                            &string[range],
                            &node.font_family,
                            node.font_size,
                            node.font_weight,
                            node.font_italic,
                            base_spacing,
                        );
                        scene_primitives::layout::TextMetricsLine {
                            width: shaped.width,
                            ascent: shaped.ascent,
                            descent: shaped.descent,
                        }
                    },
                );
                &changed_block
            };
            let reveal_end = text_reveal_end(&string, node.split, reveal, Some(block));
            let top = (node.frame.h - block.height) / 2.0;
            for line in &block.lines {
                let runs = if node.text.as_deref() == Some(string.as_str()) {
                    node.text_runs.as_slice()
                } else {
                    &[]
                };
                let shaped =
                    engine.shape_rich(&string, line.bytes.start..line.paint_end, base, runs);
                let x = match node
                    .style
                    .get("textAlign")
                    .and_then(Value::as_str)
                    .unwrap_or("center")
                {
                    "left" => 0.0,
                    "right" => node.frame.w - shaped.width,
                    _ => (node.frame.w - shaped.width) / 2.0,
                };
                let baseline = top
                    + line.offset
                    + (line.line_height - line.metrics.ascent - line.metrics.descent) / 2.0
                    + line.metrics.ascent;
                let parts = node
                    .part_motion
                    .as_ref()
                    .filter(|_| node.text.as_deref() == Some(string.as_str()));
                self.record_text_parts(
                    parts,
                    runs,
                    node,
                    reveal_end,
                    &shaped,
                    x,
                    baseline,
                    &color,
                    t,
                    tf,
                    b,
                    blurred.as_deref_mut(),
                    engine,
                );
            }
            return;
        }
        let mut shaped = engine.shape_spaced(
            &string,
            &node.font_family,
            node.font_size,
            weight,
            node.font_italic,
            p.get("letterSpacing")
                .and_then(Value::as_f64)
                .unwrap_or(0.0),
        );
        let reveal_end = text_reveal_end(&string, node.split, reveal, None);
        // 水平居中于布局盒（countUp 文本变宽时保持居中，与 DOM 行为一致）
        let x = (node.frame.w - shaped.width) / 2.0;
        let box_h = node.frame.h;
        let baseline = (box_h - (shaped.ascent + shaped.descent)) / 2.0 + shaped.ascent;
        // part 动画的 part map 是按 `node.text` 切的；`countUp` 换掉了整串时
        // 那张 map 不再成立，退回整串绘制。
        match &node.part_motion {
            Some(part_motion) if node.text.as_deref() == Some(string.as_str()) => self
                .record_text_parts(
                    Some(part_motion),
                    &[],
                    node,
                    reveal_end,
                    &shaped,
                    x,
                    baseline,
                    &color,
                    t,
                    tf,
                    b,
                    blurred,
                    engine,
                ),
            _ if node.text_stroke.is_some() => self.record_text_parts(
                None,
                &[],
                node,
                reveal_end,
                &shaped,
                x,
                baseline,
                &color,
                t,
                tf,
                b,
                None,
                engine,
            ),
            _ => {
                shaped
                    .glyphs
                    .retain(|glyph| glyph.cluster.start < reveal_end);
                self.record_shaped(&shaped, x, baseline, &color, 1.0, tf, b, engine)
            }
        }
    }

    /// 逐 part 采样并绘制（规范 §7.9、设计 §5.6）。
    ///
    /// 与 `studio_export/raster.rs::chunk_part_delta` **同语义**：part 的
    /// `opacity` 夹到 `[0,1]`、`x`/`y` 是位移、缺席的 part 取 `(1, 0, 0)`。
    /// 两处的差别只有两点，都写在设计 §15 阶段 3：
    /// ① studio_export 按 chunk 施加 delta，这里按字形（同 part 的字形拿同一个
    ///    delta，等价）；② studio_export 逐 piece 单独 shape，这里整串一次
    ///    shape ⇒ 保留了跨 part 的字距与连字。
    ///
    /// **不改变布局**：只加 translate / scale / alpha，`node.frame` 不参与。
    #[allow(clippy::too_many_arguments)]
    fn record_text_parts(
        &self,
        part_motion: Option<&PartMotion>,
        runs: &[scene_primitives::text_layout::Run],
        node: &RNode,
        reveal_end: usize,
        shaped: &ShapedLine,
        x0: f64,
        baseline: f64,
        color: &Rgba,
        t: f64,
        tf: Transform,
        b: &mut FrameBuilder,
        mut blurred: Option<&mut PartBlurBuckets>,
        engine: &mut TextEngine,
    ) {
        let count = part_motion.map_or(0, |parts| parts.map.len());
        // part 的水平锚点：本 part 首字形的 x 到下一个 part 首字形的 x 的中点。
        // `ShapedGlyph` 不带 advance，用「下一个 part 的起点」是既不需要新度量、
        // 又对 scale 视觉正确的取法（末 part 取整行宽）。
        let mut left: Vec<Option<f64>> = vec![None; count];
        for glyph in &shaped.glyphs {
            if let Some(part) = part_motion.and_then(|parts| parts.map.part_of(glyph.cluster.start))
            {
                let entry = &mut left[part];
                if entry.is_none_or(|seen| glyph.x < seen) {
                    *entry = Some(glyph.x);
                }
            }
        }
        // 同一 part 的所有字形共享同一个 delta 与同一个锚点 ⇒ 逐 part 预计算一次，
        // 字形循环只查表：既省掉每字形一次 `sample_channels`，也省掉 `anchor` 的
        // 线性右扫。只为「本行真有字形落进去」的 part 采样（`left[i].is_some()`
        // 与字形循环里 `part_of` 命中的集合逐一对应），采样集合与逐字形版本相同。
        //
        // `end` = `left[i + 1..]` 里第一个 `Some`，否则整行宽 ⇒ 从右往左单趟递推。
        let mut table: Vec<Option<PartPose>> = vec![None; count];
        let mut next_left = shaped.width;
        for index in (0..count).rev() {
            let Some(start) = left[index] else { continue };
            let pose = sample_channels(&part_motion.expect("part table exists").channels[index], t);
            let range = &part_motion.unwrap().map.ranges[index];
            let part_reveal = pose.scalar("textReveal", 1.0).clamp(0.0, 1.0);
            let part_reveal_end = if part_reveal >= 1.0 {
                usize::MAX
            } else {
                range.start
                    + text_reveal_end(
                        &node.text.as_deref().unwrap_or("")[range.clone()],
                        None,
                        part_reveal,
                        None,
                    )
            };
            table[index] = Some(PartPose {
                opacity: clamp(pose.scalar("opacity", 1.0), 0.0, 1.0),
                dx: pose.scalar("x", 0.0),
                dy: pose.scalar("y", 0.0),
                scale: pose.scalar("scale", 1.0),
                anchor: x0 + (start + next_left) / 2.0,
                color: Rgba::parse_value(pose.get("color")),
                reveal_end: part_reveal_end,
                blur: pose.scalar("blur", 0.0).max(0.0),
            });
            next_left = start;
        }

        let paint_passes = if node.text_stroke.is_some() { 2 } else { 1 };
        for paint_pass in 0..paint_passes {
            for glyph in &shaped.glyphs {
                if glyph.cluster.start >= reveal_end {
                    continue;
                }
                let part = part_motion
                    .and_then(|parts| parts.map.part_of(glyph.cluster.start))
                    .and_then(|index| table[index]);
                let PartPose {
                    opacity,
                    dx,
                    dy,
                    scale,
                    anchor,
                    color: part_color,
                    reveal_end: part_reveal_end,
                    blur,
                } = part.unwrap_or(PartPose::IDENTITY);
                if glyph.cluster.start >= part_reveal_end {
                    continue;
                }
                if opacity <= 0.001 || scale.abs() < 0.0005 {
                    continue;
                }
                // 模糊中的 part 画进自己半径的桶；没有桶（平坦录制 / 祖先作用域
                // 未收）时原样内联，退化为不模糊。
                let b: &mut FrameBuilder = match blurred.as_deref_mut() {
                    Some(buckets) if blur > 0.0 => part_blur_bucket(buckets, blur),
                    _ => &mut *b,
                };
                let mut gt = compose(tf, translate(dx, dy));
                if scale != 1.0 {
                    let ax = anchor;
                    gt = compose(gt, translate(ax, baseline));
                    gt = compose(gt, scale_xy(scale, scale));
                    gt = compose(gt, translate(-ax, -baseline));
                }
                if paint_passes == 2 && paint_pass == 0 {
                    // 描边只描轮廓：彩色字形（emoji 位图）没有轮廓，这一遍跳过。
                    if let Some(stroke) = node
                        .text_stroke
                        .as_ref()
                        .filter(|stroke| stroke.width > 0.0)
                    {
                        if let Some(path) = engine.glyph_path(glyph.cache_key).and_then(|path| {
                            path.transform(translate(x0 + glyph.x, baseline + glyph.y))
                        }) {
                            let path = b.path_id(path_from_skia(&path));
                            let paint = if let Some(gradient) = &stroke.gradient {
                                Self::gradient_paint(
                                    gradient,
                                    node.frame.w.max(1.0),
                                    node.frame.h.max(1.0),
                                    opacity,
                                )
                            } else {
                                crate::drawop::PaintData::Solid(col(
                                    &stroke.color.unwrap_or(*color),
                                    opacity,
                                ))
                            };
                            let paint = b.paint_id(paint);
                            b.push(DrawOp::StrokePathPaint {
                                path,
                                paint,
                                width: stroke.width as f32,
                                cap: LineCap::Round.code(),
                                join: LineJoin::Round.code(),
                                miter: 4.0,
                                tf: mat(gt),
                            });
                        }
                    }
                    continue;
                }
                gt = compose(gt, translate(x0 + glyph.x, baseline + glyph.y));
                let run =
                    runs.get(runs.partition_point(|run| run.bytes.end <= glyph.cluster.start));
                let color = part_color
                    .or_else(|| run.and_then(|run| Rgba::parse_value(run.style.get("color"))))
                    .unwrap_or(*color);
                let c = col(&color, opacity);
                if record_color_glyph(glyph.cache_key, gt, c[3], b, engine) {
                    continue;
                }
                let Some(path) = engine.glyph_path(glyph.cache_key) else {
                    continue;
                };
                let id = b.path_id(path_from_skia(&path));
                b.push(DrawOp::FillPath {
                    path: id,
                    color: c,
                    tf: mat(gt),
                });
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn record_shaped(
        &self,
        shaped: &ShapedLine,
        x0: f64,
        baseline: f64,
        color: &Rgba,
        alpha: f64,
        tf: Transform,
        b: &mut FrameBuilder,
        engine: &mut TextEngine,
    ) {
        let c = col(color, alpha);
        for g in &shaped.glyphs {
            let gt = compose(tf, translate(x0 + g.x, baseline + g.y));
            if record_color_glyph(g.cache_key, gt, c[3], b, engine) {
                continue;
            }
            if let Some(path) = engine.glyph_path(g.cache_key) {
                let id = b.path_id(path_from_skia(&path));
                b.push(DrawOp::FillPath {
                    path: id,
                    color: c,
                    tf: mat(gt),
                });
            }
        }
    }

    // ── path：填充 → 纹理 → 描边（规范 §6.2.1） ──
    fn record_path(
        &self,
        node: &RNode,
        p: &Map<String, Value>,
        clock: Clock,
        tf: Transform,
        b: &mut FrameBuilder,
    ) {
        let progress = p.get("pathDraw").and_then(Value::as_f64).unwrap_or(1.0);
        let morph = p.get("pathMorph").and_then(Value::as_f64).unwrap_or(0.0);
        // `pathMorph`（规范 §6.2.1）：填充、纹理、描边与 `pathDraw` 的长度口径都跟着插值后的形状走。
        let morphed = morph_subpaths(node, morph);
        let base: &Vec<Vec<(f64, f64)>> = morphed.as_ref().unwrap_or(&node.subpaths);
        let total_len = if morphed.is_some() {
            polyline_len(base)
        } else {
            node.total_len
        };
        // 填充与纹理按完整闭合几何画；`pathDraw` 只管描边进度，不隐式改变填充。
        self.record_path_fill(node, base, tf, b);
        let Some(stroke_color) = node.stroke else {
            return;
        };
        if total_len <= 0.0 {
            return;
        }
        // 描边抖动：逐顶点按 (seed, 顶点序号) 取偏移；填充不抖 ⇒ 填充与轮廓错位。
        // boil 的重播种按所在 cadence 域的绘制帧计。
        let wobbled = wobble_paths(node, base, clock);
        let subpaths: &Vec<Vec<(f64, f64)>> = wobbled.as_ref().unwrap_or(base);
        let prog = clamp(progress, 0.0, 1.0);
        if prog <= 0.0 {
            return;
        }
        // 1. 按进度截断（长度口径用未抖动的 `total_len`，与既有 golden 同）
        let mut remain = total_len * prog;
        let mut drawn: Vec<Vec<(f64, f64)>> = Vec::new();
        'outer: for poly in subpaths {
            if poly.len() < 2 {
                continue;
            }
            let mut out = vec![poly[0]];
            for i in 1..poly.len() {
                let (a, bp) = (poly[i - 1], poly[i]);
                let seg = ((bp.0 - a.0).powi(2) + (bp.1 - a.1).powi(2)).sqrt();
                if seg <= remain {
                    out.push(bp);
                    remain -= seg;
                } else {
                    let u = if seg > 0.0 { remain / seg } else { 0.0 };
                    out.push((a.0 + (bp.0 - a.0) * u, a.1 + (bp.1 - a.1) * u));
                    drawn.push(out);
                    break 'outer;
                }
            }
            drawn.push(out);
        }
        if node.path_trim.is_some() || p.contains_key("pathStart") || p.contains_key("pathEnd") {
            let (start, end) = path_interval(node, p);
            drawn = scene_primitives::svgpath::slice(subpaths, total_len * start, total_len * end);
        }
        // 2. 虚线：逐子路径从相位 0 起切（SVG 语义）
        if !node.dash.is_empty() {
            let pattern: Vec<f64> = node.dash.iter().map(|v| v * node.svg_scale).collect();
            drawn = drawn
                .iter()
                .flat_map(|poly| {
                    dash_polyline(
                        poly,
                        &pattern,
                        p.get("dashOffset")
                            .and_then(Value::as_f64)
                            .unwrap_or(node.dash_offset)
                            * node.svg_scale,
                    )
                })
                .collect();
        }
        if let Some(brush) = node.stroke_brush
            && brush.kind == pathstyle::BrushKind::Paint
        {
            // 整笔 + 可见区间：宽度曲线按整笔算，画到一半的前沿是一排圆头鬃毛。
            // 虚线则每一段各算一整笔。
            let (strokes, vis) = if node.dash.is_empty() {
                let vis = if node.path_trim.is_some()
                    || p.contains_key("pathStart")
                    || p.contains_key("pathEnd")
                {
                    path_interval(node, p)
                } else {
                    (0.0, prog)
                };
                (subpaths, vis)
            } else {
                (&drawn, (0.0, 1.0))
            };
            self.record_paint_stroke(node, strokes, vis, &stroke_color, brush, tf, b);
            return;
        }
        let mut pb = PathBuilder::new();
        for poly in &drawn {
            pb.move_to(poly[0].0 as f32, poly[0].1 as f32);
            for point in &poly[1..] {
                pb.line_to(point.0 as f32, point.1 as f32);
            }
        }
        let Some(path) = pb.finish() else { return };
        let path = if node.screen_stroke {
            match path.transform(tf) {
                Some(path) => path,
                None => return,
            }
        } else {
            path
        };
        let id = b.path_id(path_from_skia(&path));
        let tf = if node.screen_stroke {
            Transform::identity()
        } else {
            tf
        };
        let width = (node.stroke_width
            * if node.screen_stroke {
                1.0
            } else {
                node.svg_scale
            }) as f32;
        let passes: &[(f32, f64)] = match node.stroke_brush.map(|b| b.kind) {
            Some(pathstyle::BrushKind::Pencil) => &[(1.0, 0.85), (0.7, 0.3), (0.55, 0.22)],
            Some(pathstyle::BrushKind::Ink) => &[(1.05, 0.92), (0.5, 0.12)],
            _ => &[(1.0, 1.0)],
        };
        for (index, (width_factor, alpha)) in passes.iter().copied().enumerate() {
            let brush_tf = if index == 0 {
                tf
            } else {
                let brush = node.stroke_brush.unwrap();
                let amp = brush.roughness
                    * if node.screen_stroke {
                        1.0
                    } else {
                        node.svg_scale
                    };
                let dx = motion::rng::splitmix64_signed(brush.seed, index as i64 * 2) * amp;
                let dy = motion::rng::splitmix64_signed(brush.seed, index as i64 * 2 + 1) * amp;
                compose(tf, translate(dx, dy))
            };
            if node.line_cap == LineCap::Round && node.line_join == LineJoin::Round {
                // 缺省线帽 / 接头走 v3 的 `StrokePath`（恒 Round/Round）：既有文档逐字节不变。
                b.push(DrawOp::StrokePath {
                    path: id,
                    color: col(&stroke_color, alpha),
                    width: width * width_factor,
                    tf: mat(brush_tf),
                });
            } else {
                let paint = b.paint_id(crate::drawop::PaintData::Solid(col(&stroke_color, alpha)));
                b.push(DrawOp::StrokePathPaint {
                    path: id,
                    paint,
                    width: width * width_factor,
                    cap: node.line_cap.code(),
                    join: node.line_join.code(),
                    miter: 4.0,
                    tf: mat(brush_tf),
                });
            }
        }
    }

    /// `brush.kind: "paint"` 的描边（规范 §6.9）：按明暗 / 含色分桶，一桶一次填充。
    /// 描边色带 alpha 时整笔进一个离屏层，鬃毛带之间的重叠不会叠深。
    #[allow(clippy::too_many_arguments)]
    fn record_paint_stroke(
        &self,
        node: &RNode,
        strokes: &[Vec<(f64, f64)>],
        vis: (f64, f64),
        color: &Rgba,
        brush: pathstyle::StrokeBrush,
        tf: Transform,
        b: &mut FrameBuilder,
    ) {
        let mapped;
        let (strokes, tf, width) = if node.screen_stroke {
            let map = |x: f64, y: f64| {
                (
                    tf.sx as f64 * x + tf.kx as f64 * y + tf.tx as f64,
                    tf.ky as f64 * x + tf.sy as f64 * y + tf.ty as f64,
                )
            };
            mapped = strokes
                .iter()
                .map(|poly| poly.iter().map(|&(x, y)| map(x, y)).collect())
                .collect::<Vec<Vec<(f64, f64)>>>();
            (&mapped[..], Transform::identity(), node.stroke_width)
        } else {
            (strokes, tf, node.stroke_width * node.svg_scale)
        };
        let params = crate::source::paint::PaintParams {
            seed: brush.seed,
            rough: brush.roughness,
            dry: brush.dry,
            load: brush.load.is_some(),
        };
        let geom = self.paints.brush(strokes, width, &params, vis);
        if geom.is_empty() {
            return;
        }
        let layered = color.a < 0.999;
        if layered {
            b.push(DrawOp::PushLayer {
                opacity: color.a.clamp(0.0, 1.0) as f32,
                blend: motion::effect::BlendMode::Normal,
            });
        }
        for (load, tone, path) in &geom.buckets {
            let mut c = crate::source::paint::tone_color(color, brush.load.as_ref(), *load, *tone);
            if layered {
                c.a = 1.0;
            }
            let id = b.path_id(path.clone());
            b.push(DrawOp::FillPath {
                path: id,
                color: col(&c, 1.0),
                tf: mat(tf),
            });
        }
        if layered {
            b.push(DrawOp::PopLayer);
        }
    }

    /// path 填充 + 渲染期纹理。局部坐标；形状不 morph 时无时间依赖。
    fn record_path_fill(
        &self,
        node: &RNode,
        subpaths: &[Vec<(f64, f64)>],
        tf: Transform,
        b: &mut FrameBuilder,
    ) {
        if node.fill.is_none() && node.texture.is_none() {
            return;
        }
        let mut pb = PathBuilder::new();
        let (mut x0, mut y0, mut x1, mut y1) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
        for poly in subpaths {
            if poly.len() < 3 {
                continue;
            }
            pb.move_to(poly[0].0 as f32, poly[0].1 as f32);
            for p in &poly[1..] {
                pb.line_to(p.0 as f32, p.1 as f32);
            }
            pb.close();
            for p in poly {
                x0 = x0.min(p.0);
                y0 = y0.min(p.1);
                x1 = x1.max(p.0);
                y1 = y1.max(p.1);
            }
        }
        let Some(shape) = pb.finish() else { return };
        let shape = path_from_skia(&shape);
        if let Some(fill) = node.fill {
            let id = b.path_id(shape.clone());
            if node.fill_even_odd {
                let paint = b.paint_id(crate::drawop::PaintData::Solid(col(&fill, 1.0)));
                b.push(DrawOp::FillPathPaint {
                    path: id,
                    paint,
                    even_odd: true,
                    tf: mat(tf),
                });
            } else {
                b.push(DrawOp::FillPath {
                    path: id,
                    color: col(&fill, 1.0),
                    tf: mat(tf),
                });
            }
        }
        if let Some(texture) = &node.texture {
            self.record_texture(
                (x0, y0, x1, y1),
                texture,
                node.fill,
                node.svg_scale,
                &shape,
                tf,
                b,
            );
        }
    }

    /// `style.background` 的渐变形态（规范 §6.3）→ `FillPathPaint`。
    ///
    /// 几何在元素局部坐标里：线性渐变按 CSS 角度口径取盒的两端点（0° 从下到上、
    /// 90° 从左到右），长度是盒在该方向上的投影，与浏览器同一条公式；径向渐变的
    /// 圆心是盒比例、半径以盒短边为基准。
    fn record_gradient_background(
        node: &RNode,
        gradient: &BgGradient,
        radius: f64,
        tf: Transform,
        b: &mut FrameBuilder,
    ) {
        let (w, h) = (node.frame.w, node.frame.h);
        if w <= 0.0 || h <= 0.0 {
            return;
        }
        let Some(path) = crate::raster::rounded_rect_path(0.0, 0.0, w, h, radius) else {
            return;
        };
        let paint = Self::gradient_paint(gradient, w, h, 1.0);
        let path = b.path_id(path_from_skia(&path));
        let paint = b.paint_id(paint);
        b.push(DrawOp::FillPathPaint {
            path,
            paint,
            even_odd: false,
            tf: mat(tf),
        });
    }

    fn gradient_paint(
        gradient: &BgGradient,
        w: f64,
        h: f64,
        alpha: f64,
    ) -> crate::drawop::PaintData {
        use crate::drawop::{GradientStop, PaintData};
        let stops = |stops: &[(f64, Rgba)]| -> Vec<GradientStop> {
            stops
                .iter()
                .map(|(at, color)| GradientStop {
                    offset: *at as f32,
                    color: col(color, alpha),
                })
                .collect()
        };
        match gradient {
            BgGradient::Linear { angle, stops: st } => {
                let theta = angle.to_radians();
                let (dx, dy) = (theta.sin(), -theta.cos());
                // CSS：渐变线长度 = |w·sinθ| + |h·cosθ|，经过盒中心。
                let len = (w * dx).abs() + (h * dy).abs();
                let (cx, cy) = (w / 2.0, h / 2.0);
                PaintData::Linear {
                    p0: [(cx - dx * len / 2.0) as f32, (cy - dy * len / 2.0) as f32],
                    p1: [(cx + dx * len / 2.0) as f32, (cy + dy * len / 2.0) as f32],
                    stops: stops(st),
                }
            }
            BgGradient::Radial {
                cx,
                cy,
                r,
                stops: st,
            } => {
                let center = [(cx * w) as f32, (cy * h) as f32];
                PaintData::Radial {
                    center,
                    radius: (r * w.min(h)) as f32,
                    focus: center,
                    stops: stops(st),
                }
            }
        }
    }

    /// 把一份纹理裁剪进 `shape` 画出来。`bbox` 与 `shape` 同在局部坐标。
    /// `fill` 是 `paint` finish 的底色（缺席时取纹理 `color`）。
    #[allow(clippy::too_many_arguments)]
    fn record_texture(
        &self,
        bbox: (f64, f64, f64, f64),
        texture: &pathstyle::PathTexture,
        fill: Option<Rgba>,
        scale: f64,
        shape: &PathData,
        tf: Transform,
        b: &mut FrameBuilder,
    ) {
        let geom = self.textures.get(bbox, texture, scale);
        if geom.is_empty() {
            return;
        }
        let clip_id = b.path_id(shape.clone());
        b.push(DrawOp::ClipPath {
            path: clip_id,
            tf: mat(tf),
        });
        let base = fill.unwrap_or(texture.color);
        for (load, tone, path) in &geom.paint.buckets {
            let color =
                crate::source::paint::tone_color(&base, texture.load.as_ref(), *load, *tone);
            let id = b.path_id(path.clone());
            b.push(DrawOp::FillPath {
                path: id,
                color: col(&color, texture.alpha),
                tf: mat(tf),
            });
        }
        if let Some((hatch, width)) = &geom.hatch {
            let id = b.path_id(hatch.clone());
            b.push(DrawOp::StrokePath {
                path: id,
                color: col(&texture.color, texture.alpha),
                width: *width,
                tf: mat(tf),
            });
        }
        if let Some(dots) = &geom.dots {
            let id = b.path_id(dots.clone());
            b.push(DrawOp::FillPath {
                path: id,
                color: col(&texture.color, texture.alpha),
                tf: mat(tf),
            });
        }
        for (patch, opacity, radial) in &geom.wash {
            let path = b.path_id(patch.clone());
            let alpha = texture.alpha * opacity;
            let stops = [(0.0, 1.0), (0.5, 0.5), (0.85, 0.08), (1.0, 0.0)]
                .into_iter()
                .map(|(offset, falloff)| crate::drawop::GradientStop {
                    offset,
                    color: col(&texture.color, alpha * falloff),
                })
                .collect();
            let paint = b.paint_id(crate::drawop::PaintData::Radial {
                center: [radial[0], radial[1]],
                focus: [radial[0], radial[1]],
                radius: radial[2],
                stops,
            });
            b.push(DrawOp::FillPathPaint {
                path,
                paint,
                even_odd: false,
                tf: mat(tf),
            });
        }
        if let Some(grain) = &geom.grain {
            let id = b.path_id(grain.clone());
            let color = texture.grain_color.unwrap_or(texture.color);
            b.push(DrawOp::FillPath {
                path: id,
                color: col(&color, texture.grain_alpha),
                tf: mat(tf),
            });
        }
        b.push(DrawOp::PopClip);
    }

    // ── 字幕（流式 / 双语 lane / 词高亮 / 贴字背景） ──
    fn record_captions(&self, ir: &Ir, engine: &mut TextEngine, t: f64, b: &mut FrameBuilder) {
        let mut active: Option<(&CaptionClip, &CapItem)> = None;
        for c in &ir.caption_clips {
            if t < c.start || t > c.end {
                continue;
            }
            for it in &c.items {
                if t >= it.at_abs && t < it.until_abs {
                    active = Some((c, it));
                    break;
                }
            }
        }
        let Some((cap, item)) = active else { return };
        // 没声明 exit 的 lane 按 clip 的 fade 整块淡出；声明了的走自己的 exit 通道（§8.4）
        let block_alpha = clamp((item.until_abs - t) / cap.fade, 0.0, 1.0);

        // 行盒由 core（layout::layout_captions）排定，渲染端只画（§8.4）
        let rel = t - item.at_abs;
        for lane in &cap.lanes {
            let Some(line) = item.lines.get(&lane.id) else {
                continue;
            };
            let Some(boxes) = &line.boxes else { continue };
            // lane 入场通道（锚定本条 at_abs）
            let mut lane_alpha = 1.0f64;
            let mut y_off = 0.0f64;
            let chs: Vec<Channel> = scene_primitives::resolve::lay_static(
                &lane.enter_kfs,
                item.at_abs + lane.enter_delay,
                lane.enter_dur,
            );
            for ch in &chs {
                let v = sample_frames(&ch.frames, t);
                if ch.prop == "opacity" {
                    lane_alpha = v.as_f64().unwrap_or(1.0);
                }
                if ch.prop == "y" {
                    y_off = v.as_f64().unwrap_or(0.0);
                }
            }
            // lane 退场通道（锚定本条 until_abs）
            let mut exit_alpha = block_alpha;
            if !lane.exit_kfs.is_empty() {
                exit_alpha = 1.0;
                let chs: Vec<Channel> = scene_primitives::resolve::lay_static(
                    &lane.exit_kfs,
                    item.until_abs - lane.exit_dur,
                    lane.exit_dur,
                );
                for ch in &chs {
                    let v = sample_frames(&ch.frames, t);
                    if ch.prop == "opacity" {
                        exit_alpha = v.as_f64().unwrap_or(1.0);
                    }
                    if ch.prop == "y" {
                        y_off += v.as_f64().unwrap_or(0.0);
                    }
                }
            }
            let alpha = exit_alpha * lane_alpha;
            if alpha <= 0.001 {
                continue;
            }
            let layered = alpha < 0.999;
            if layered {
                b.push(DrawOp::PushLayer {
                    opacity: alpha as f32,
                    blend: BlendMode::Normal,
                });
            }
            for lb in boxes {
                let content_top = lb.y + y_off;
                if lane.bg_mode.is_some() {
                    b.push(DrawOp::FillRect {
                        x: (lb.x - lane.bg_pad_h) as f32,
                        y: (content_top - lane.bg_pad_v) as f32,
                        w: (lb.w + lane.bg_pad_h * 2.0) as f32,
                        h: (lb.h + lane.bg_pad_v * 2.0) as f32,
                        radius: lane.bg_radius as f32,
                        color: col(&lane.bg_color, 1.0),
                        tf: mat(Transform::identity()),
                    });
                }
                let baseline = content_top + (lb.h - (lb.ascent + lb.descent)) / 2.0 + lb.ascent;
                if lb.words.is_empty() {
                    let shaped = engine.shape(
                        &lb.text,
                        &lane.font_family,
                        lane.font_size,
                        lane.font_weight,
                    );
                    self.record_shaped(
                        &shaped,
                        lb.x,
                        baseline,
                        &lane.color,
                        1.0,
                        Transform::identity(),
                        b,
                        engine,
                    );
                } else {
                    let words = line.words.as_deref().unwrap_or(&[]);
                    let hi = lane.hi_color.unwrap_or(lane.color);
                    for wb in &lb.words {
                        let h = match words.get(wb.index) {
                            Some(w) => {
                                clamp((rel - w.t) / lane.hi_transition, 0.0, 1.0)
                                    - clamp((rel - w.end) / lane.hi_transition, 0.0, 1.0)
                            }
                            None => 0.0,
                        };
                        let color = lane.color.mixed(&hi, h);
                        let shaped = engine.shape(
                            &wb.text,
                            &lane.font_family,
                            lane.font_size,
                            lane.font_weight,
                        );
                        self.record_shaped(
                            &shaped,
                            lb.x + wb.dx,
                            baseline,
                            &color,
                            1.0,
                            Transform::identity(),
                            b,
                            engine,
                        );
                    }
                }
            }
            if layered {
                b.push(DrawOp::PopLayer);
            }
        }
    }
}

/// 元素盒的矩形路径（矢量源 `cover` 的裁剪框）。
/// 把一条折线按 `pattern`（[画, 空, …]，偶数项、总长为正）切成若干「画」段。
fn wobble_paths(
    node: &RNode,
    base: &[Vec<(f64, f64)>],
    clock: Clock,
) -> Option<Vec<Vec<(f64, f64)>>> {
    node.wobble.as_ref().map(|w| {
        let epoch = if w.every > 0 {
            let fps = clock.fps.unwrap_or(pathstyle::DEFAULT_DRAW_FPS);
            pathstyle::draw_frame(clock.real, fps) / u64::from(w.every)
        } else {
            0
        };
        let seed = w.seed ^ epoch.wrapping_mul(0xA24B_AED4_963E_E407);
        let amp = w.amp * node.svg_scale;
        let mut index = 0i64;
        base.iter()
            .map(|poly| {
                let closed = poly.len() > 2 && poly.first() == poly.last();
                let mut out: Vec<(f64, f64)> = poly
                    .iter()
                    .map(|(x, y)| {
                        let dx = motion::rng::splitmix64_signed(seed, index) * 0.5 * amp;
                        let dy = motion::rng::splitmix64_signed(seed, index + 1) * 0.5 * amp;
                        index += 2;
                        (x + dx, y + dy)
                    })
                    .collect();
                if closed && let Some(first) = out.first().copied() {
                    let last = out.len() - 1;
                    out[last] = first;
                }
                out
            })
            .collect()
    })
}

fn path_interval(node: &RNode, p: &Map<String, Value>) -> (f64, f64) {
    let defaults = node.path_trim.unwrap_or((0.0, 1.0));
    let start = p
        .get("pathStart")
        .and_then(Value::as_f64)
        .unwrap_or(defaults.0)
        .clamp(0.0, 1.0);
    let end = p
        .get("pathEnd")
        .and_then(Value::as_f64)
        .unwrap_or(defaults.1)
        .clamp(0.0, 1.0)
        .max(start);
    let progress = p
        .get("pathDraw")
        .and_then(Value::as_f64)
        .unwrap_or(1.0)
        .clamp(0.0, 1.0);
    (start, start + (end - start) * progress)
}

fn dash_polyline(poly: &[(f64, f64)], pattern: &[f64], offset: f64) -> Vec<Vec<(f64, f64)>> {
    let mut out: Vec<Vec<(f64, f64)>> = Vec::new();
    if poly.len() < 2 || pattern.is_empty() {
        return vec![poly.to_vec()];
    }
    let mut slot = 0usize;
    let mut phase = offset.rem_euclid(pattern.iter().sum());
    while phase > 0.0 && phase >= pattern[slot] {
        phase -= pattern[slot];
        slot = (slot + 1) % pattern.len();
    }
    let mut left = pattern[slot] - phase;
    let mut current: Vec<(f64, f64)> = vec![poly[0]];
    for pair in poly.windows(2) {
        let (a, b) = (pair[0], pair[1]);
        let seg = ((b.0 - a.0).powi(2) + (b.1 - a.1).powi(2)).sqrt();
        let mut at = 0.0;
        while seg - at > left {
            at += left;
            let u = if seg > 0.0 { at / seg } else { 0.0 };
            let point = (a.0 + (b.0 - a.0) * u, a.1 + (b.1 - a.1) * u);
            if slot % 2 == 0 {
                current.push(point);
                if current.len() > 1 {
                    out.push(std::mem::take(&mut current));
                }
            } else {
                current = vec![point];
            }
            slot = (slot + 1) % pattern.len();
            left = pattern[slot];
        }
        left -= seg - at;
        if slot % 2 == 0 {
            current.push(b);
        }
    }
    if slot % 2 == 0 && current.len() > 1 {
        out.push(current);
    }
    out
}

/// Terminal line/block characters occupy complete cells even when a fallback font
/// gives them a double-width advance. This keeps adjoining border segments connected.
fn cell_symbol(text: &str, w: f64, h: f64, font_size: f64) -> Option<tiny_skia::Path> {
    let mut pb = PathBuilder::new();
    let mut rect = |x: f64, y: f64, width: f64, height: f64| {
        if let Some(r) =
            tiny_skia::Rect::from_xywh(x as f32, (y - h) as f32, width as f32, height as f32)
        {
            pb.push_rect(r);
        }
    };
    match text {
        "█" => rect(0.0, 0.0, w, h),
        "▀" => rect(0.0, 0.0, w, h / 2.0),
        "▄" => rect(0.0, h / 2.0, w, h / 2.0),
        "▌" => rect(0.0, 0.0, w / 2.0, h),
        "▐" => rect(w / 2.0, 0.0, w / 2.0, h),
        "░" | "▒" | "▓" => {
            let level = match text {
                "░" => 1,
                "▒" => 2,
                _ => 3,
            };
            for row in 0..4 {
                for col in 0..4 {
                    if (row * 3 + col) % 4 < level {
                        rect(col as f64 * w / 4.0, row as f64 * h / 4.0, w / 4.0, h / 4.0);
                    }
                }
            }
        }
        "─" | "│" | "┌" | "┐" | "└" | "┘" | "├" | "┤" | "┬" | "┴" | "┼" => {
            let stroke = (font_size / 12.0).clamp(1.0, 2.0).min(w).min(h);
            if matches!(text, "─" | "┐" | "┘" | "┤" | "┬" | "┴" | "┼") {
                rect(0.0, (h - stroke) / 2.0, (w + stroke) / 2.0, stroke);
            }
            if matches!(text, "─" | "┌" | "└" | "├" | "┬" | "┴" | "┼") {
                rect(
                    (w - stroke) / 2.0,
                    (h - stroke) / 2.0,
                    (w + stroke) / 2.0,
                    stroke,
                );
            }
            if matches!(text, "│" | "└" | "┘" | "├" | "┤" | "┴" | "┼") {
                rect((w - stroke) / 2.0, 0.0, stroke, (h + stroke) / 2.0);
            }
            if matches!(text, "│" | "┌" | "┐" | "├" | "┤" | "┬" | "┼") {
                rect(
                    (w - stroke) / 2.0,
                    (h - stroke) / 2.0,
                    stroke,
                    (h + stroke) / 2.0,
                );
            }
        }
        _ => return None,
    }
    pb.finish()
}

fn box_path(w: f64, h: f64) -> PathData {
    let mut pb = PathBuilder::new();
    match tiny_skia::Rect::from_xywh(0.0, 0.0, w.max(0.0) as f32, h.max(0.0) as f32) {
        Some(rect) => pb.push_rect(rect),
        None => return PathData::default(),
    }
    match pb.finish() {
        Some(path) => path_from_skia(&path),
        None => PathData::default(),
    }
}

/// 每个 `lottie` 元素的资产都装上了吗（装配期 fail-fast，见
/// [`FrameRenderer::new_with_lotties`]）。
fn check_lottie_sources(
    node: &RNode,
    lotties: &std::collections::HashMap<String, Arc<Lottie>>,
) -> Result<()> {
    if node.ntype == "lottie" {
        match &node.asset_id {
            Some(id) if lotties.contains_key(id) => {}
            Some(id) => bail!(
                "lottie-source-missing: 元素 \"{}\" 引用的 Lottie 资产 \"{id}\" 没有被加载；\
                 渲染器必须注入已解析的 Lottie 源",
                node.id
            ),
            None => bail!("lottie-source-missing: 元素 \"{}\" 没有 src", node.id),
        }
    }
    for child in &node.children {
        check_lottie_sources(child, lotties)?;
    }
    Ok(())
}

fn polyline_len(subpaths: &[Vec<(f64, f64)>]) -> f64 {
    let mut len = 0.0;
    for poly in subpaths {
        for w in poly.windows(2) {
            len += ((w[1].0 - w[0].0).powi(2) + (w[1].1 - w[0].1).powi(2)).sqrt();
        }
    }
    len
}

/// `pathMorph` 通道值 `v ∈ [0, N]`（`N` = `morphTo` 个数）：形状序列 `[d, morphTo…]` 上的
/// 分段线性插值，逐顶点 lerp。没有目标或 `v <= 0` 时返回 `None`（走 `d` 原几何，既有文档逐字节不变）。
fn morph_subpaths(node: &RNode, v: f64) -> Option<Vec<Vec<(f64, f64)>>> {
    let n = node.morph_shapes.len();
    if n == 0 || !(v > 0.0) {
        return None;
    }
    let v = v.min(n as f64);
    let i = (v.floor() as usize).min(n - 1);
    let u = v - i as f64;
    let from = if i == 0 {
        &node.subpaths
    } else {
        &node.morph_shapes[i - 1]
    };
    let to = &node.morph_shapes[i];
    Some(
        from.iter()
            .zip(to)
            .map(|(a, b)| {
                a.iter()
                    .zip(b)
                    .map(|(p, q)| (p.0 + (q.0 - p.0) * u, p.1 + (q.1 - p.1) * u))
                    .collect()
            })
            .collect(),
    )
}
