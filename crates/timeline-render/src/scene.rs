use std::sync::Arc;

use motion::CurveSpec;
use render_raster::ShaderQuad;
use render_raster::drawop::{FrameOps, Mat6};
use render_raster::plan::TransformUniforms;

/// 单个 glyph scene node 的动态 run 上限。固定预算让桌面/Web 的 uniform texture
/// 都是 8×1024 RGBA32F（128 KiB），生产者可在进入 GPU 前明确回退。
pub const GLYPH_RUN_UNIFORM_LIMIT: usize = 1024;

/// 单层 scene 节点上限。BCS2 编解码与会扩张节点的生产者共用同一预算，避免
/// native 先认领、跨 wasm wire 时才因包结构过大回退。
pub const SCENE_NODE_LIMIT: usize = 4096;

/// CPU reference `filter.blur@1` 的结构上限。scene 以整数像素冻结半径，GPU
/// 执行器不得为不同平台另造夹取口径。
pub const SCENE_BLUR_RADIUS_LIMIT: u32 = 256;

/// 单个媒体元素允许冻结的 source effect 数量。Timeline 0.3 的闭集在同时启用
///四段 filter preset、五段 effect preset 与全部显式字段时最多 18 条；再留六个槽给
/// 同版本内的兼容扩展，同时阻止损坏输入制造无界 GPU pass 链。
pub const TEXTURE_EFFECT_LIMIT: usize = 24;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ScenePose {
    pub transform: Mat6,
    pub opacity: f32,
    /// 整组后处理的 box blur 半径（画布像素）。普通 vector/glyph pass 忽略它，
    /// 只有显式 `BlurredGroup` 消费；放在共享 pose 里可与 transform/opacity 同曲线采样。
    pub blur: f32,
}

impl ScenePose {
    pub const IDENTITY: Self = Self {
        transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
        opacity: 1.0,
        blur: 0.0,
    };
}

impl Default for ScenePose {
    fn default() -> Self {
        Self::IDENTITY
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SceneCurveSolver {
    Standard,
    Caption,
}

/// 合成器可直接采样的 pose 区间。曲线仍来自共享 `bcut-motion` manifest；
/// scene 只冻结绝对时间与端点，不复制字幕配方或引入平台时钟。
#[derive(Debug, Clone, PartialEq)]
pub struct SceneMotion {
    pub start: f64,
    pub end: f64,
    pub from: ScenePose,
    pub to: ScenePose,
    pub curve: CurveSpec,
    pub solver: SceneCurveSolver,
}

impl SceneMotion {
    pub fn sample(&self, time: f64) -> ScenePose {
        let duration = self.end - self.start;
        let phase = if duration.is_finite() && duration > 0.0 && time.is_finite() {
            ((time - self.start) / duration).clamp(0.0, 1.0)
        } else if time >= self.end {
            1.0
        } else {
            0.0
        };
        let eased = match (&self.curve, self.solver) {
            (CurveSpec::CubicBezier { x1, y1, x2, y2 }, SceneCurveSolver::Caption) => {
                motion::curve::cubic_bezier_caption(*x1, *y1, *x2, *y2, phase)
            }
            _ => motion::sample_curve(&self.curve, phase),
        };
        let mut transform = [0.0; 6];
        for (output, (from, to)) in transform
            .iter_mut()
            .zip(self.from.transform.into_iter().zip(self.to.transform))
        {
            *output = (f64::from(from) + f64::from(to - from) * eased) as f32;
        }
        ScenePose {
            transform,
            opacity: (f64::from(self.from.opacity)
                + f64::from(self.to.opacity - self.from.opacity) * eased)
                as f32,
            blur: (f64::from(self.from.blur) + f64::from(self.to.blur - self.from.blur) * eased)
                as f32,
        }
    }
}

/// tiny-skia `Transform::post_concat` 的 renderer-neutral Mat6 口径：先应用
/// `first`，再应用 `second`。vector 与 glyph 执行器必须共用这一份顺序。
pub fn post_concat_mat6(first: Mat6, second: Mat6) -> Mat6 {
    let [a, b, c, d, tx, ty] = first;
    let [e, f, g, h, ux, uy] = second;
    [
        e * a + g * b,
        f * a + h * b,
        e * c + g * d,
        f * c + h * d,
        e * tx + g * ty + ux,
        f * tx + h * ty + uy,
    ]
}

/// 字形光栅结果的宿主内唯一身份。它不进入 BCF / DrawOp 指纹，只用于实时
/// glyph atlas 的驻留与复用；生产者必须把字体 face、glyph id、离散字号档和
/// 次像素档都编码进来。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct GlyphKey(pub [u64; 2]);

/// glyph atlas 的像素类型。Alpha 是逐行紧排的 R8 coverage；Color 是
/// 逐行紧排的 premultiplied RGBA8。
#[derive(Debug, Clone)]
pub enum GlyphPixels {
    Alpha(Arc<[u8]>),
    Color(Arc<[u8]>),
}

impl GlyphPixels {
    pub fn data(&self) -> &Arc<[u8]> {
        match self {
            Self::Alpha(data) | Self::Color(data) => data,
        }
    }

    pub fn is_color(&self) -> bool {
        matches!(self, Self::Color(_))
    }
}

/// 一个可进入 atlas 的字形图像。像素左上角为原点；`left` / `top` 是
/// 相对字形基线原点的 swash placement（`top` 向上为正）。历史名称
/// `GlyphMask` 保持不变，但 pixels 可以是 R8 或彩色 RGBA。
#[derive(Debug, Clone)]
pub struct GlyphMask {
    pub key: GlyphKey,
    pub width: u32,
    pub height: u32,
    pub left: i32,
    pub top: i32,
    pub pixels: GlyphPixels,
}

impl GlyphMask {
    pub fn new(
        key: GlyphKey,
        width: u32,
        height: u32,
        left: i32,
        top: i32,
        alpha: impl Into<Arc<[u8]>>,
    ) -> Option<Self> {
        Self::new_pixels(
            key,
            width,
            height,
            left,
            top,
            GlyphPixels::Alpha(alpha.into()),
            1,
        )
    }

    pub fn new_color(
        key: GlyphKey,
        width: u32,
        height: u32,
        left: i32,
        top: i32,
        rgba: impl Into<Arc<[u8]>>,
    ) -> Option<Self> {
        Self::new_pixels(
            key,
            width,
            height,
            left,
            top,
            GlyphPixels::Color(rgba.into()),
            4,
        )
    }

    fn new_pixels(
        key: GlyphKey,
        width: u32,
        height: u32,
        left: i32,
        top: i32,
        pixels: GlyphPixels,
        channels: usize,
    ) -> Option<Self> {
        let expected = (width as usize)
            .checked_mul(height as usize)
            .and_then(|pixels| pixels.checked_mul(channels));
        (width > 0 && height > 0 && expected == Some(pixels.data().len())).then_some(Self {
            key,
            width,
            height,
            left,
            top,
            pixels,
        })
    }
}

/// 一个 atlas quad 的稳定几何。`transform` 把字形的**基线原点**映射到未施加
/// 动态 run pose 的画布坐标；执行器先应用 mask 自带的 `left/-top` placement，
/// 再应用该变换，最后才取 `uniform_index` 指向的动态 uniform。
#[derive(Debug, Clone)]
pub struct GlyphInstance {
    pub mask: Arc<GlyphMask>,
    pub transform: Mat6,
    pub uniform_index: u32,
}

/// renderer-neutral 字形图案纹理的内容身份。它与 [`GlyphKey`] 一样只服务
/// compositor 会话内的驻留/复用，不进入 BCF；生产者必须让 key 覆盖尺寸与全部
/// premultiplied RGBA8 字节。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct GlyphTextureKey(pub [u64; 2]);

/// retained glyph 图案的单边上限；2048² RGBA8 恰好对应 BCS2 的 16 MiB 资源上限。
pub const SCENE_GLYPH_TEXTURE_SIZE_LIMIT: u32 = 2048;

/// 一条 glyph run 可选的只读重复图案。像素逐行紧排为 premultiplied RGBA8；
/// scene 携带内容而不是平台纹理句柄，因此 native / Web 与离线执行器消费同一资源。
#[derive(Debug, Clone)]
pub struct GlyphTexture {
    pub key: GlyphTextureKey,
    pub width: u32,
    pub height: u32,
    pub rgba: Arc<[u8]>,
}

impl GlyphTexture {
    pub fn new(
        key: GlyphTextureKey,
        width: u32,
        height: u32,
        rgba: impl Into<Arc<[u8]>>,
    ) -> Option<Self> {
        let rgba = rgba.into();
        let expected = (width as usize)
            .checked_mul(height as usize)
            .and_then(|pixels| pixels.checked_mul(4));
        (width > 0
            && height > 0
            && width <= SCENE_GLYPH_TEXTURE_SIZE_LIMIT
            && height <= SCENE_GLYPH_TEXTURE_SIZE_LIMIT
            && expected == Some(rgba.len()))
        .then_some(Self {
            key,
            width,
            height,
            rgba,
        })
    }
}

/// renderer-neutral 字形填充。`RepeatLinearGradient` 在每个字形的本地轮廓坐标中
/// 定义一段 A→B→A 的重复线性渐变；`RepeatTexture` 从所属 [`GlyphRun::texture`]
/// 读取同坐标系的重复图案；`DilatedStroke` 则在稳定 alpha mask 周围按画布像素
/// 扩张居中描边。三者都让逐词状态只改 uniform、不重写 atlas quad。
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub enum GlyphPaint {
    #[default]
    Solid,
    RepeatLinearGradient {
        start: [f32; 2],
        end: [f32; 2],
        first: [f32; 4],
        middle: [f32; 4],
    },
    /// 以字形本地轮廓坐标重复采样 run 级 premultiplied RGBA8 图案。
    RepeatTexture,
    /// 对 alpha glyph 做居中描边；`width` 是完整线宽，彩色 glyph 不执行该效果。
    /// 合成器固定为 mask quad 预留扩边，因此生产者必须遵守
    /// [`SCENE_GLYPH_STROKE_WIDTH_LIMIT`]。
    DilatedStroke { width: f32 },
}

/// retained glyph shader 可在不重建 quad 的前提下表达的最大完整描边线宽。
pub const SCENE_GLYPH_STROKE_WIDTH_LIMIT: f32 = 16.0;

/// retained scene 节点与既有目标的逐像素复合方式。`Screen` 在预乘颜色下可严格写成
/// `source + destination * (1 - source)`，因此四个 wgpu 后端都能用固定混合状态
/// 执行。`Difference` / `Exclusion` 必须放在顶层 [`BlurredGroup`]，并由宿主提供
/// 可 `COPY_SRC` 的真实 target；普通透明 overlay target 必须显式回退。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum SceneCompositeMode {
    #[default]
    Normal,
    Screen,
    Difference,
    Exclusion,
}

/// 兼容 R2 首批 glyph-only scene 的公开名称；新节点使用通用枚举。
pub type GlyphCompositeMode = SceneCompositeMode;

/// 一组字形共享的 run-local 状态。`transform` 在稳定 instance 几何之后、
/// [`GlyphRun::pose`] 之前应用；颜色是 straight RGBA，fragment shader 内转预乘后
/// 按 [`GlyphRun::composite`] 合入目标。`clip` 是施加 run transform 之前的画布坐标矩形
/// `[left, top, right, bottom]`；因此裁剪框会与逐词 pose / scene pose 一起运动，
/// 但仍只改 uniform。逐词强调不重写字形顶点、更不重新光栅 mask。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GlyphRunUniform {
    pub transform: Mat6,
    pub color: [f32; 4],
    /// 不含字色 alpha 的 chunk opacity。彩色字形忽略字色，只消费这个透明度；
    /// alpha mask 仍使用 `color.a`。
    pub color_opacity: f32,
    pub clip: Option<[f32; 4]>,
    pub paint: GlyphPaint,
}

/// 保持原始绘制顺序的一批字形。逐词状态更新 `uniforms`，整组入场更新 `pose`
/// 或由 `motion` 在合成期采样；mask 本身继续命中 atlas，不再重光栅整幅 overlay。
#[derive(Debug, Clone, Default)]
pub struct GlyphRun {
    pub glyphs: Arc<[GlyphInstance]>,
    pub uniforms: Vec<GlyphRunUniform>,
    /// `RepeatTexture` 的单一只读资源。一个 run 只允许一张图案，避免把资源索引
    /// 塞进逐词 uniform；不同图案必须拆成不同有序 run。
    pub texture: Option<Arc<GlyphTexture>>,
    pub composite: GlyphCompositeMode,
    pub pose: ScenePose,
    pub motion: Option<SceneMotion>,
}

/// 先把多层 glyph source-over 到透明中间层，再对整层做一次可分离 box blur。
/// 字幕 shadow/glow 的描边与正文必须在模糊前合并；逐层各糊一次会改变交叠 alpha。
#[derive(Debug, Clone, Default)]
pub struct GlyphEffect {
    pub layers: Vec<Arc<GlyphRun>>,
    pub radius: u32,
}

/// 先按原始 z 序把子节点画进透明中间层，再对整组做可选 box blur、水平 reveal
/// 与一次性 composite。字幕入场 `magic-fade` 用它保证底板、shadow/glow、outline
/// 与 fill 一起变糊；文字元素 `wipe` 在 blur 后裁整层；非 Normal 字幕用半径 0
/// 保留 CPU 的「先组内 source-over、后整层复合」。
#[derive(Debug, Clone, Default)]
pub struct BlurredGroup {
    pub nodes: Vec<SceneNode>,
    pub radius: f32,
    pub motion: Option<SceneMotion>,
    /// blur 后从画布左缘保留的归一化宽度。`None` 表示不裁剪；执行器会把值夹到
    /// `[0, 1]`，边缘像素使用与 CPU `mask.progress@1` 相同的亚像素 coverage。
    pub reveal: Option<f32>,
    /// 子节点先按 Normal 合入透明中间层，再把完整层一次性复合到真实 target。
    pub composite: SceneCompositeMode,
}

/// 合成期程序化圆角矩形。字幕 plate 的位置、尺寸、圆角与颜色都属于逐帧
/// uniform；执行器只画一张固定 quad，不为宽度扫入或跨词移动重新 tessellate。
/// `rect` 是应用 [`Self::pose`] 前的画布像素 `[x, y, width, height]`，颜色是
/// straight RGBA，最终 opacity 还要乘 pose/motion 的组透明度。
#[derive(Debug, Clone, PartialEq)]
pub struct RoundedRectNode {
    pub rect: [f32; 4],
    pub radius: f32,
    pub color: [f32; 4],
    pub pose: ScenePose,
    pub motion: Option<SceneMotion>,
}

/// 外部媒体纹理在元素盒内的缩放规则。源像素仍由宿主保管；scene 只冻结
/// renderer-neutral 的采样语义，Web/Metal/DX12 执行器不得各自重算 cover/contain。
#[cfg(feature = "external-media-scene")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TextureFit {
    Cover,
    Contain,
}

/// `contain` 留边的合成语义。PIP 的历史行为是透明留边；fullscreen 可选择
/// 黑色，或让 compositor 以 cover → 局部 box blur → 压暗 → contain 的中间
/// pass 生成模糊背景。枚举只冻结语义，不携带任何平台纹理。
#[cfg(feature = "external-media-scene")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TextureBackground {
    Transparent,
    Black,
    Blur,
    /// 0.12 的纯色画布背景（`#RRGGBB`，不透明）。`Black` 保留为独立一档，
    /// 老文档的参数与指纹逐位不变。
    Color([u8; 3]),
}

/// 外部纹理在元素局部盒上的解析遮罩。圆角矩形继续使用 [`TextureNode::radius`]；
/// 椭圆忽略圆角半径，与 `mask.shape@1` 的 CPU reference 一致。
#[cfg(feature = "external-media-scene")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TextureMaskShape {
    RoundedRect,
    Ellipse,
}

/// 在媒体天然尺寸、fit/mask/元素仿射之前执行的有序效果。数组顺序直接来自
/// `timeline::effects::lower_element_effects`；合成器不得重新分组后改变可见
/// 的 RGBA8 round-trip 边界。`Blur` 半径已经按画布短边换成天然像素整数。
#[cfg(feature = "external-media-scene")]
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum TextureEffect {
    ColorAdjust { grayscale: f32, brightness: f32 },
    Grayscale(f32),
    Brightness(f32),
    Contrast(f32),
    Saturation(f32),
    Sepia(f32),
    HueRotate(f32),
    Invert(f32),
    Blur(u32),
    Sharpen(f32),
    Noise(f32),
    Vignette(f32),
}

/// 一个宿主纹理的有序采样节点。`texture` 是会话内 key（通常为 Timeline
/// `srcId`），不携带平台句柄；宿主在提交前只为当前 scene 真正引用的 key 拉取
/// 解码帧。`transform` 作用于画布像素中的 `rect`，与 DrawOp Mat6 同口径。
#[cfg(feature = "external-media-scene")]
#[derive(Debug, Clone, PartialEq)]
pub struct TextureNode {
    pub texture: String,
    /// 源媒体时刻；静态图片为 -1。宿主可据此驱动独立视频解码器，合成器只采样
    /// 已经到货的纹理，不在 render pass 内做 seek。
    pub media_ms: i64,
    pub source_width: u32,
    pub source_height: u32,
    pub rect: [f32; 4],
    pub transform: Mat6,
    pub opacity: f32,
    /// 圆角半径是元素局部像素，应用在 cover/contain 之后、仿射之前。
    pub radius: f32,
    /// `mask.shape@1` 的形状；全屏非平铺媒体会冻结为 RoundedRect，保持历史上
    /// 不应用局部 shape mask 的语义。
    pub mask_shape: TextureMaskShape,
    /// 遮罩羽化宽度（元素局部像素）。CPU 先在局部画布应用，再做元素仿射；
    /// compositor 必须保持同一顺序，不能按最终屏幕像素重新解释。
    pub mask_feather: f32,
    /// 媒体天然尺寸上的有序效果链。共享 lowering 已展开 filter/effect preset；
    /// 恒等效果被省略，同一链可供 native、Web 与离屏导出逐项执行。
    pub source_effects: Arc<[TextureEffect]>,
    /// `mask.progress@1` 的水平显示比例。1 表示不裁切；coverage 在元素局部
    /// 像素上求值，并与 shape mask 相乘后再进入元素仿射。
    pub reveal: f32,
    /// Circular reveal fraction, 1 = the complete local box.
    pub iris: f32,
    pub fit: TextureFit,
    pub background: TextureBackground,
}

/// 一帧场景中的一个有序节点。数组顺序就是 z 序；执行层不得再按节点类型
/// 重排。`SceneNode` 属于 timeline/render 交汇层，而不是 wgpu 执行层。
#[derive(Debug, Clone)]
pub enum SceneNode {
    /// CPU reference 与 GPU 矢量执行器共用的既有 DrawOp 指令流。
    Vectors(Arc<FrameOps>),
    /// 与 `Vectors` 同一 DrawOp 几何，但额外携带合成期 pose。字幕底板可随 glyph
    /// motion 连续运动，而求值层只需在离散词边界或 motion 结束时重建 scene。
    AnimatedVectors {
        frame: Arc<FrameOps>,
        pose: ScenePose,
        motion: Option<SceneMotion>,
    },
    /// 程序化 shader 节点显式携带画布变换。`ShaderQuad` 自身的单位变换仍供
    /// 离屏 conformance 使用，实时场景不靠执行器猜测放置语义。
    ShaderQuad {
        quad: Arc<ShaderQuad>,
        transform: TransformUniforms,
    },
    /// 图片、视频帧与 asset sticker 共用的宿主纹理节点。数组位置就是它与
    /// vector/glyph/shader 的全局 z 序；执行层不得按资源类型另开一张画布。
    #[cfg(feature = "external-media-scene")]
    Texture(Arc<TextureNode>),
    /// 共享排版层产出的字形 mask + 逐字形姿态。atlas 与 shader pass 都属于
    /// compositor；这里不携带任何 wgpu 资源。
    Glyphs(Arc<GlyphRun>),
    /// Designed Caption plate 等会逐帧改变盒参数的圆角矩形。固定 quad + fragment
    /// SDF 保证动画只写 uniform，不回退到每帧 vector tessellation。
    RoundedRect(Arc<RoundedRectNode>),
    /// 多层 glyph 先合成、后模糊，再按 source-over 放到此前节点之上。执行器使用
    /// 全 GPU 中间纹理；实时路径不得为求包围盒或模糊结果回读。
    BlurredGlyphs(Arc<GlyphEffect>),
    /// 子节点先合成再做整组 blur；`motion` 只在合成期采样半径，子节点各自仍消费
    /// 同一份 motion 的 transform/opacity 通道。
    BlurredGroup(Arc<BlurredGroup>),
}

impl SceneNode {
    pub fn shader_quad(quad: ShaderQuad, canvas: (f64, f64)) -> Self {
        let target = &quad.target;
        let transform = TransformUniforms::place(
            (
                target.x,
                target.y,
                f64::from(target.width),
                f64::from(target.height),
            ),
            canvas,
        );
        Self::ShaderQuad {
            quad: Arc::new(quad),
            transform,
        }
    }

    pub fn affine_shader_quad(quad: ShaderQuad, affine: Mat6, canvas: (f64, f64)) -> Self {
        let target = &quad.target;
        let transform = TransformUniforms::place_affine(
            (
                target.x,
                target.y,
                f64::from(target.width),
                f64::from(target.height),
            ),
            affine,
            canvas,
        );
        Self::ShaderQuad {
            quad: Arc::new(quad),
            transform,
        }
    }
}

/// 求值层交给合成器的逐帧清单。`fingerprint` 沿用既有 DrawOp/计划身份，
/// 不由 GPU 重算；`next_change` 沿用 OverlayScheduler 的绝对时间语义。
#[derive(Debug, Clone, Default)]
pub struct SceneFrame {
    pub nodes: Vec<SceneNode>,
    pub next_change: Option<f64>,
    /// `Some(t)` 表示当前 scene 在 `t` 前含连续 GPU motion；调度器应按显示刷新率
    /// 调 `render_at`，但不得重跑求值层。到点后若无其它 dirty 源恢复零帧泵。
    pub active_until: Option<f64>,
    pub fingerprint: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scene_motion_samples_shared_curve_without_clamping_overshoot() {
        let motion = SceneMotion {
            start: 1.0,
            end: 2.0,
            from: ScenePose {
                transform: [0.7, 0.0, 0.0, 0.7, 30.0, 40.0],
                opacity: 0.25,
                blur: 6.0,
            },
            to: ScenePose::IDENTITY,
            curve: CurveSpec::CubicBezier {
                x1: 0.22,
                y1: 0.19,
                x2: 0.54,
                y2: 1.62,
            },
            solver: SceneCurveSolver::Caption,
        };
        assert_eq!(motion.sample(1.0), motion.from);
        assert_eq!(motion.sample(2.0), motion.to);
        assert!(
            (1..100)
                .map(|step| motion.sample(1.0 + f64::from(step) / 100.0))
                .any(|pose| pose.transform[0] > 1.0),
            "magic-pop 的 manifest 曲线过冲不能在 scene 层被夹掉"
        );
    }

    #[test]
    fn mat6_post_concat_applies_the_second_transform_last() {
        let combined = post_concat_mat6(
            [2.0, 3.0, 5.0, 7.0, 11.0, 13.0],
            [17.0, 19.0, 23.0, 29.0, 31.0, 37.0],
        );
        let point = [41.0, 43.0];
        let first = [
            2.0 * point[0] + 5.0 * point[1] + 11.0,
            3.0 * point[0] + 7.0 * point[1] + 13.0,
        ];
        let expected = [
            17.0 * first[0] + 23.0 * first[1] + 31.0,
            19.0 * first[0] + 29.0 * first[1] + 37.0,
        ];
        let actual = [
            combined[0] * point[0] + combined[2] * point[1] + combined[4],
            combined[1] * point[0] + combined[3] * point[1] + combined[5],
        ];
        assert_eq!(actual, expected);
    }
}
