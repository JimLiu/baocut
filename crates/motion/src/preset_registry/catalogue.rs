//! 目录型配方（catalogue recipe，ADR-E05）——注册表的**第三种**配方形状。
//!
//! 与既有两种并列：
//!
//! - [`super::frozen`]：阶段 1 冻结的四条专用解析路径；
//! - [`super::manifest`]：通用动画 manifest（`tracks` 或 `compose`）；
//! - **本模块**：`core/presets/builtin/{shape,sticker,visualizer,progress,confetti}/*.json`。
//!
//! **为什么不复用 `parse_manifest`**：它有三条硬约束对目录型配方全部不成立——
//! `domain` 必须 ∈ 封闭的 `ManifestDomain{Motion,Transition,Filter}`；
//! `determinism` 必填（shape 配方没有这个概念，矢量直出恒为 strict）；
//! `tracks` 与 `compose` 必须恰有其一。目录型配方描述的是"怎么画一帧"，
//! 而不是"某个属性怎么随时间变"，硬塞进去只能靠编一个假的空 `tracks`。
//!
//! 复用的是**纪律**不是 parser：`builtin!` + `include_str!` 清单、`OnceLock`
//! 一次性 `build()`、`(id, version)` + `manifest_hash` 冻结、目录一致性由
//! `tests/manifests.rs` 守住、`available` 作为分波次上线开关。
//!
//! **分派靠清单归属，不靠 JSON `domain` 字段**——与 frozen 路径一致；JSON 里
//! 仍写 `domain`，纯粹作自描述与人读，解析期只做一次等值核对。

use serde_json::{Map, Value};

use crate::MotionError;

use super::json::{field, number, text, version};
use super::manifest::Determinism;

/// 目录型配方的种类。P0 落 [`CatalogueKind::Shape`]，P2 补齐 visualizer /
/// progress，P7b 补 [`CatalogueKind::Sticker`]，彩纸设计稿（§4）补
/// [`CatalogueKind::Confetti`]；骨架早就参数化过，所以五种共用同一条
/// `parse_catalogue` 入口，各自只多一个 body parser。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CatalogueKind {
    Shape,
    Sticker,
    Visualizer,
    Progress,
    Confetti,
}

impl CatalogueKind {
    /// JSON `domain` 字段的自描述值，同时是 `core/presets/builtin/` 的目录名。
    pub const fn dir(self) -> &'static str {
        match self {
            Self::Shape => "shape",
            Self::Sticker => "sticker",
            Self::Visualizer => "visualizer",
            Self::Progress => "progress",
            Self::Confetti => "confetti",
        }
    }
}

/// 形状轮廓：**归一化到元素盒 0..1** 的定义（左上原点）。
///
/// 封闭集合。未知 `kind` 在**注册表解析期**报 `manifest-invalid`（构建期错误，
/// 用户文档碰不到）；"`timeline.json` 引用了注册表里没有的形状名"是另一个时机
/// 另一个码（lint / resolve 期的 `preset-unknown`），见设计 §5.3。
#[derive(Clone, Debug, PartialEq)]
pub enum ShapePath {
    /// 元素盒本身；`ShapeProps.cornerRadius` 生效。
    Rect,
    /// 元素盒的内切椭圆。
    Ellipse,
    /// `ShapeProps` 的 `x1,y1 → x2,y2` 线段；`defaultHead` 是缺省端头。
    Segment { default_head: ShapeHead },
    /// 显式轮廓，P7 的 19 种形状走这条：点全部在 0..1。
    Outline { segments: Vec<PathSegment> },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ShapeHead {
    None,
    Arrow,
}

impl ShapeHead {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "none" => Some(Self::None),
            "arrow" => Some(Self::Arrow),
            _ => None,
        }
    }
}

/// 轮廓段。verb 与点数一一对应，解析期校验，消费者不必再防。
#[derive(Clone, Debug, PartialEq)]
pub enum PathSegment {
    Move([f64; 2]),
    Line([f64; 2]),
    Quad([f64; 2], [f64; 2]),
    Cubic([f64; 2], [f64; 2], [f64; 2]),
    Close,
}

/// 该形状支持的可调项（封闭集合）。属性面板据此决定显示哪些控件，
/// 渲染侧据此决定读不读某个 `ShapeProps` 字段。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ShapeParam {
    Fill,
    Stroke,
    StrokeWidth,
    CornerRadius,
    /// `x1/y1/x2/y2`。
    Endpoints,
    Head,
}

impl ShapeParam {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "fill" => Some(Self::Fill),
            "stroke" => Some(Self::Stroke),
            "strokeWidth" => Some(Self::StrokeWidth),
            "cornerRadius" => Some(Self::CornerRadius),
            "endpoints" => Some(Self::Endpoints),
            "head" => Some(Self::Head),
            _ => None,
        }
    }
}

/// 一份目录型配方。
///
/// `id` 是**文档面值**——`timeline.json` 的 `shape.shape` 写什么，这里就是什么
/// （`rect` / `ellipse` / `line` / `arrow`），与 frozen 路径的 `bcf.cut.json →
/// id "cut"` 同一约定；文件名与 id 相同，目录一致性测试因此是逐字比对。
#[derive(Clone, Debug, PartialEq)]
pub struct CatalogueRecipe {
    pub id: String,
    pub version: u32,
    pub kind: CatalogueKind,
    pub order: usize,
    pub body: CatalogueBody,
    /// **表面目录**开关，语义同 `SlotRecipe.available`：面板里能不能选到。
    /// 不使用通用 manifest 的 `exposedTo` + `Surface`——目录型配方只服务
    /// timeline 元素、`namespace` 恒为 `"timeline"`，没有多表面暴露维度。
    pub available: bool,
    pub manifest_hash: u64,
}

impl CatalogueRecipe {
    /// `Domain.dir` 前缀的限定名（`shape.rect`），供 UI 与文档引用。
    pub fn qualified_id(&self) -> String {
        format!("{}.{}", self.kind.dir(), self.id)
    }

    pub fn shape(&self) -> Option<&ShapeBody> {
        match &self.body {
            CatalogueBody::Shape(body) => Some(body),
            _ => None,
        }
    }

    pub fn sticker(&self) -> Option<&StickerBody> {
        match &self.body {
            CatalogueBody::Sticker(body) => Some(body),
            _ => None,
        }
    }

    pub fn visualizer(&self) -> Option<&VisualizerBody> {
        match &self.body {
            CatalogueBody::Visualizer(body) => Some(body),
            _ => None,
        }
    }

    pub fn progress(&self) -> Option<&ProgressBody> {
        match &self.body {
            CatalogueBody::Progress(body) => Some(body),
            _ => None,
        }
    }

    pub fn confetti(&self) -> Option<&ConfettiBody> {
        match &self.body {
            CatalogueBody::Confetti(body) => Some(body),
            _ => None,
        }
    }

    /// 绘制配方（visualizer / progress / confetti 有，shape / sticker 没有——
    /// 矢量直出不需要算法名）。
    pub fn recipe(&self) -> Option<&Recipe> {
        match &self.body {
            CatalogueBody::Shape(_) | CatalogueBody::Sticker(_) => None,
            CatalogueBody::Visualizer(body) => Some(&body.recipe),
            CatalogueBody::Progress(body) => Some(&body.recipe),
            CatalogueBody::Confetti(body) => Some(&body.recipe),
        }
    }
}

/// 逐 kind 的配方体。
#[derive(Clone, Debug, PartialEq)]
pub enum CatalogueBody {
    Shape(ShapeBody),
    Sticker(StickerBody),
    Visualizer(VisualizerBody),
    Progress(ProgressBody),
    Confetti(ConfettiBody),
}

#[derive(Clone, Debug, PartialEq)]
pub struct ShapeBody {
    pub path: ShapePath,
    pub params: Vec<ShapeParam>,
}

impl ShapeBody {
    pub fn supports(&self, param: ShapeParam) -> bool {
        self.params.contains(&param)
    }
}

// ── sticker 配方体（设计 §10 P7 的 template 源）─────────────────────

/// 模板贴纸：**一叠带自带颜色的轮廓层**，按声明顺序自下而上绘制。
///
/// 与 [`ShapeBody`] 的两处本质区别（也是为什么它不是"多几个 param 的 shape"）：
///
/// 1. **颜色在配方里，不在 props 里**。`StickerProps`（设计 §5.2）只有
///    `source` / `templateId` / `path` / `loop`，没有 `fill` / `stroke`——
///    贴纸是一张**画好的图**，不是一个可调色的图元。配色因此是模板的一部分，
///    改色要换模板，不是改元素属性。
/// 2. **多层多色**。一份模板可以是"绿底 + 白勾"两层，shape 的单 fill + 单
///    stroke 表达不了。
///
/// **几何恒为单位正方（0..1，左上原点、y 向下）**：模板贴纸的元素盒沿用
/// `element_height` 里 sticker 分支的"正方"缺省（`geometry.rs`），因此配方
/// 不需要也不允许声明纵横比——想要非正方的观感，把留白画进 viewBox 里。
/// 这条约束让 P7b 完全不必动 `bcut-timeline` 的几何默认表与三端孪生。
#[derive(Clone, Debug, PartialEq)]
pub struct StickerBody {
    pub layers: Vec<StickerLayer>,
}

/// 一层轮廓 + 它自己的颜色。`fill` / `stroke` 至少有一个（解析期校验）。
#[derive(Clone, Debug, PartialEq)]
pub struct StickerLayer {
    pub segments: Vec<PathSegment>,
    /// `#RRGGBB[AA]`。
    pub fill: Option<String>,
    pub stroke: Option<String>,
    /// **元素盒短边的比例**（0..1），不是参考短边 540 上的像素。
    ///
    /// 与 `ShapeProps.stroke_width` 的口径**刻意不同**：shape 的描边宽度是用户
    /// 属性，跟着画布走才不会在 4K 上变发丝线；贴纸的描边是**画面的一部分**，
    /// 必须跟着贴纸自己缩放——否则同一张贴纸放大一倍，外框粗细不变、比例就毁了。
    pub stroke_width: f64,
}

/// `strokeWidth` 缺省：元素盒短边的 3%。
pub const STICKER_DEFAULT_STROKE_WIDTH: f64 = 0.03;

// ── visualizer / progress 配方体（设计 §7.2）─────────────────────────

/// 音频纹理的 bin 宽度。`Half` = `fftSize/2`（bicubic 全 bin 类 4 种）。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BinWidth {
    /// 只取最低 64 个 bin，11/15 种走这条。
    Fixed64,
    Half,
}

impl BinWidth {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "64" => Some(Self::Fixed64),
            "half" => Some(Self::Half),
            _ => None,
        }
    }

    pub const fn name(self) -> &'static str {
        match self {
            Self::Fixed64 => "64",
            Self::Half => "half",
        }
    }
}

/// visualizer 元素的默认盒形（ADR-E01 的帧百分比表）。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VisualizerAspect {
    Free,
    /// 强制正方形（`ring_bars` / `ring_wave` / `pulse_rings` / progress 的 `circle` / `donut`）。
    Square,
}

impl VisualizerAspect {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "free" => Some(Self::Free),
            "square" => Some(Self::Square),
            _ => None,
        }
    }
}

/// progress 元素的默认盒形。`Frame` 类跟随画布比铺满边框。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProgressAspect {
    Bar,
    Square,
    Frame,
}

impl ProgressAspect {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "bar" => Some(Self::Bar),
            "square" => Some(Self::Square),
            "frame" => Some(Self::Frame),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct VisualizerBody {
    pub num_colors: u8,
    pub color_labels: Vec<String>,
    pub default_main_color: String,
    pub default_secondary_color: String,
    pub default_min_db: f64,
    pub default_max_db: f64,
    /// `false` = 属性面板无 dB 控件（`beam`）。
    pub has_control: bool,
    pub bin_width: BinWidth,
    pub aspect: VisualizerAspect,
    pub recipe: Recipe,
    pub determinism: Determinism,
    /// 声波 10 款全部是 CPU 矢量配方，manifest 里 `shader` 必须写 `null`
    /// （设计 §8.6 的 visualizer WGSL 清单已整体退役）；字段保留为
    /// `Option` 只是给未来 GPU 配方留位置。
    pub shader: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ProgressBody {
    pub num_colors: u8,
    /// 每个色板的标题（主色 / 副色各一条）。
    ///
    /// 与 [`VisualizerBody::color_labels`] 同一口径：条数恒等于 `num_colors`，
    /// 所以「彩虹边框整段颜色不出」（0）与「游走彩虹只出一张 Background」（1）
    /// 都由这两个字段一起表达，面板不写死款名。
    pub color_labels: Vec<String>,
    pub default_main_color: String,
    pub default_secondary_color: String,
    pub aspect: ProgressAspect,
    pub recipe: Recipe,
    pub determinism: Determinism,
    pub shader: String,
}

// ── confetti 配方体（`docs/design/elements/bcut-confetti-element-design.md` §4）────────

/// `confetti.shapes` 的封闭取值——12 种单位形，与 `bcut-timeline` 的
/// `CONFETTI_SHAPES` 是同一张表（那边守文档，这边守配方；两处都是解析期报错）。
pub const CONFETTI_SHAPES: &[&str] = &[
    "rect", "strip", "circle", "ellipse", "triangle", "diamond", "star", "starlet", "sparkle",
    "heart", "petal", "ribbon",
];

/// 一款彩纸 = **调色板 + 形状混合 + `confetti-v1` 的参数包**。
///
/// 与 [`ProgressBody`] 的两处不同：颜色是一张**列表**而不是主/副两色
/// （`ConfettiProps.colors` 缺席时整表生效，写了就整表替换）；没有 shader
/// ——十款全部由 CPU 闭式运动核发 `FillPath`，GPU 端走 `SceneNode::Vectors`
/// 复用同一批路径，因此 `determinism` 恒为 `strict`。几何恒为 `aspect: "frame"`
/// （铺满画幅），配方不声明别的盒形。
#[derive(Clone, Debug, PartialEq)]
pub struct ConfettiBody {
    /// `#RRGGBB[AA]` × 1–8，目录顺序。
    pub palette: Vec<String>,
    /// [`CONFETTI_SHAPES`] 的非空子集。
    pub shapes: Vec<String>,
    /// 改编来源（`core/assets/elements/vendor/sources.json` 的 id），只作署名与
    /// 许可清单，渲染不读。
    pub sources: Vec<String>,
    /// 属性页出不出「起点」开关（设计稿 §6.2）：多发射器 / 有方向的爆发款
    /// 为 `true`，顶部撒落的连续款为 `false`（自定起点对它没有意义）。
    pub has_emitter_control: bool,
    pub recipe: Recipe,
    pub determinism: Determinism,
}

/// 绘制配方 = **封闭算法名 + 参数包**。
///
/// 参数原样保留成 JSON 对象：Rust 侧只有算法实现，**一个数字都不带**（与阶段 1
/// `loop_kernel` 同一纪律）。P3/P4/P5 的绘制内核用 [`Recipe::number`] /
/// [`Recipe::integer`] / [`Recipe::flag`] / [`Recipe::text`] / [`Recipe::object`] /
/// [`Recipe::array`] 逐项取值；解析期已保证必填项在场且落在合法域，取值端不必再防。
#[derive(Clone, Debug, PartialEq)]
pub struct Recipe {
    pub algorithm: RecipeAlgorithm,
    pub params: Map<String, Value>,
}

impl Recipe {
    pub fn get(&self, key: &str) -> Option<&Value> {
        self.params.get(key)
    }

    /// `null` 与缺键都返回 `None`——配方里的 `null` 是"这一档不启用"的意思
    /// （`shaping: null`、`spin: null`、`echoLayers: null`）。
    fn present<'a>(&'a self, key: &str) -> Option<&'a Value> {
        match self.params.get(key) {
            None | Some(Value::Null) => None,
            Some(value) => Some(value),
        }
    }

    pub fn number(&self, key: &str) -> Option<f64> {
        self.present(key)?.as_f64()
    }

    pub fn integer(&self, key: &str) -> Option<u64> {
        self.present(key)?.as_u64()
    }

    pub fn flag(&self, key: &str) -> Option<bool> {
        self.present(key)?.as_bool()
    }

    pub fn text(&self, key: &str) -> Option<&str> {
        self.present(key)?.as_str()
    }

    pub fn object(&self, key: &str) -> Option<&Map<String, Value>> {
        self.present(key)?.as_object()
    }

    pub fn array(&self, key: &str) -> Option<&Vec<Value>> {
        self.present(key)?.as_array()
    }
}

/// 封闭算法名（设计 §7.2 / §7.4 的两张表）。未知名在**注册表解析期**报
/// `manifest-invalid`——与"文档引用了不存在的 style id"的 `preset-unknown`
/// 是两个时机两个码（设计 §5.3）。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RecipeAlgorithm {
    // visualizer（设计 §7.2）
    SpectrumBarsV1,
    PolarBarsV1,
    OscilloscopeV1,
    SpectrumAreaV1,
    DotMatrixV1,
    PulseRingsV1,
    RibbonsV1,
    // progress
    BarV1,
    FrameV1,
    RingV1,
    SnakeV1,
    // confetti（`docs/design/elements/bcut-confetti-element-design.md` §4.3）
    ConfettiV1,
}

impl RecipeAlgorithm {
    pub const fn name(self) -> &'static str {
        match self {
            Self::SpectrumBarsV1 => "spectrum-bars-v1",
            Self::PolarBarsV1 => "polar-bars-v1",
            Self::OscilloscopeV1 => "oscilloscope-v1",
            Self::SpectrumAreaV1 => "spectrum-area-v1",
            Self::DotMatrixV1 => "dot-matrix-v1",
            Self::PulseRingsV1 => "pulse-rings-v1",
            Self::RibbonsV1 => "ribbons-v1",
            Self::BarV1 => "bar-v1",
            Self::FrameV1 => "frame-v1",
            Self::RingV1 => "ring-v1",
            Self::SnakeV1 => "snake-v1",
            Self::ConfettiV1 => "confetti-v1",
        }
    }

    /// 该算法归哪个目录——防止 progress 配方里写了 visualizer 的算法名。
    const fn kind(self) -> CatalogueKind {
        match self {
            Self::BarV1 | Self::FrameV1 | Self::RingV1 | Self::SnakeV1 => CatalogueKind::Progress,
            Self::ConfettiV1 => CatalogueKind::Confetti,
            _ => CatalogueKind::Visualizer,
        }
    }

    /// 必填参数键。缺一个就在解析期报 `manifest-invalid`。
    const fn required(self) -> &'static [&'static str] {
        match self {
            Self::SpectrumBarsV1 => &["barCount", "align", "gap", "radius", "minHeight", "easing"],
            Self::PolarBarsV1 => &["barCount", "innerRadius", "gap", "minHeight", "easing"],
            Self::OscilloscopeV1 => &["layout", "samples", "lineWidth", "amplitude", "baseRadius"],
            Self::SpectrumAreaV1 => &["samples", "minHeight", "easing", "lineWidth"],
            Self::DotMatrixV1 => &["columns", "rows", "dotRadius", "easing"],
            Self::PulseRingsV1 => &["bands", "coreRadius", "ringRadius", "ringWidth", "easing"],
            Self::RibbonsV1 => &["ribbonCount", "samples", "lineWidth", "speed", "cycles"],
            Self::BarV1 => &["direction", "corner"],
            Self::FrameV1 => &["borderSize", "smoothing", "fill", "background", "colorMode"],
            Self::RingV1 => &[
                "featherPx",
                "edgeFeatherPx",
                "innerRadius",
                "startAngle",
                "direction",
            ],
            Self::SnakeV1 => &[
                "dotRadius",
                "smoothing",
                "orbitRadius",
                "startAngleDeg",
                "angleIncrementDeg",
                "maxIterations",
                "boostSteps",
                "spin",
                "colorMode",
            ],
            Self::ConfettiV1 => &[
                "emit",
                "emitters",
                "angle",
                "spread",
                "speedPx",
                "dragX",
                "dragY",
                "gravityPx",
                "windPx",
                "driftPx",
                "driftHz",
                "sizePx",
                "sizeRamp",
                "spinDps",
                "flipHz",
                "pulse",
                "lifeSec",
                "fadeIn",
                "fadeOut",
                "maxAlive",
            ],
        }
    }

    fn parse(name: &str) -> Option<Self> {
        [
            Self::SpectrumBarsV1,
            Self::PolarBarsV1,
            Self::OscilloscopeV1,
            Self::SpectrumAreaV1,
            Self::DotMatrixV1,
            Self::PulseRingsV1,
            Self::RibbonsV1,
            Self::BarV1,
            Self::FrameV1,
            Self::RingV1,
            Self::SnakeV1,
            Self::ConfettiV1,
        ]
        .into_iter()
        .find(|algorithm| algorithm.name() == name)
    }
}

/// 必须是正整数的参数键（跨算法通用）。
const POSITIVE_INT_KEYS: &[&str] = &[
    "barCount",
    "columns",
    "rows",
    "bands",
    "ribbonCount",
    "samples",
    "maxIterations",
    "maxAlive",
];

/// `samples`（曲线族的 path 采样密度）的下界。
///
/// 它是**冻结的配方常量**：曲线族能评为 `strict`（设计 §7.3 的 determinism 列）
/// 的前提就是"每份 manifest 说死自己按多少个点采样"——绘制端换一个密度就是换一份
/// 画面。两个点才连得成一条折线，一个点连不成，因此下界是 2 而不是 `POSITIVE_INT_KEYS`
/// 的 1；这是几何事实，不是样式取舍。
const MIN_SAMPLES: u64 = 2;

/// 必须落在 `[0, 1]` 的参数键（跨算法通用）。
const UNIT_INTERVAL_KEYS: &[&str] = &[
    "minHeight",
    "innerRadius",
    "gap",
    "radius",
    "lineWidth",
    "baseRadius",
    "coreRadius",
    "ringRadius",
    "ringWidth",
    "dotRadius",
    "orbitRadius",
    "borderSize",
    "smoothing",
];

/// 必须严格大于 0 的实数参数键（跨算法通用）。
const POSITIVE_NUMBER_KEYS: &[&str] = &["amplitude", "speed", "cycles"];

/// 顶层字符串参数的封闭取值表。
const ENUM_KEYS: &[(&str, &[&str])] = &[
    (
        "easing",
        &["none", "easeOutQuad", "easeOutSine", "easeOutCubic"],
    ),
    ("align", &["mirror", "bottom"]),
    ("layout", &["linear", "polar"]),
    ("fill", &["forward", "reverse"]),
    ("direction", &["ltr", "rtl", "cw", "ccw"]),
    ("startAngle", &["top"]),
];

/// 目录型配方的共用解析骨架：公共头 + 逐 kind 的配方体。
pub(crate) fn parse_catalogue(
    kind: CatalogueKind,
    file: &str,
    doc: &Value,
    manifest_hash: u64,
) -> Result<CatalogueRecipe, MotionError> {
    let id = text(file, doc, "id")?.to_owned();
    if id != file {
        return Err(MotionError::ManifestInvalid(format!(
            "{file}: \"id\" 必须与文件名一致（读到 {id:?}）"
        )));
    }
    // `domain` / `namespace` 只作自描述——分派靠清单归属；核对一次是为了挡住
    // 复制粘贴出来的串门配方。
    let domain = text(file, doc, "domain")?;
    if domain != kind.dir() {
        return Err(MotionError::ManifestInvalid(format!(
            "{file}: \"domain\" 应为 {:?}，读到 {domain:?}",
            kind.dir()
        )));
    }
    let namespace = text(file, doc, "namespace")?;
    if namespace != "timeline" {
        return Err(MotionError::ManifestInvalid(format!(
            "{file}: 目录型配方的 \"namespace\" 恒为 \"timeline\"，读到 {namespace:?}"
        )));
    }
    let order = field(file, doc, "order")?
        .as_u64()
        .ok_or_else(|| MotionError::ManifestInvalid(format!("{file}: bad \"order\"")))?
        as usize;
    let available = field(file, doc, "available")?
        .as_bool()
        .ok_or_else(|| MotionError::ManifestInvalid(format!("{file}: bad \"available\"")))?;
    let body = match kind {
        CatalogueKind::Shape => CatalogueBody::Shape(parse_shape_body(file, doc)?),
        CatalogueKind::Sticker => CatalogueBody::Sticker(parse_sticker_body(file, doc)?),
        CatalogueKind::Visualizer => CatalogueBody::Visualizer(parse_visualizer_body(file, doc)?),
        CatalogueKind::Progress => CatalogueBody::Progress(parse_progress_body(file, doc)?),
        CatalogueKind::Confetti => CatalogueBody::Confetti(parse_confetti_body(file, doc)?),
    };
    Ok(CatalogueRecipe {
        id,
        version: version(file, doc)?,
        kind,
        order,
        body,
        available,
        manifest_hash,
    })
}

fn parse_shape_body(file: &str, doc: &Value) -> Result<ShapeBody, MotionError> {
    let path_doc = field(file, doc, "path")?;
    let path = match text(file, path_doc, "kind")? {
        "rect" => ShapePath::Rect,
        "ellipse" => ShapePath::Ellipse,
        "segment" => {
            let head = text(file, path_doc, "defaultHead")?;
            ShapePath::Segment {
                default_head: ShapeHead::parse(head).ok_or_else(|| {
                    MotionError::ManifestInvalid(format!("{file}: unknown head {head:?}"))
                })?,
            }
        }
        "outline" => ShapePath::Outline {
            segments: parse_outline(file, field(file, path_doc, "segments")?)?,
        },
        other => {
            return Err(MotionError::ManifestInvalid(format!(
                "{file}: unknown path kind {other:?}"
            )));
        }
    };
    let params = field(file, doc, "params")?
        .as_array()
        .ok_or_else(|| MotionError::ManifestInvalid(format!("{file}: \"params\" is not an array")))?
        .iter()
        .map(|value| {
            value
                .as_str()
                .and_then(ShapeParam::parse)
                .ok_or_else(|| MotionError::ManifestInvalid(format!("{file}: bad param {value}")))
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(ShapeBody { path, params })
}

/// 模板贴纸：`layers[]`，每层一条轮廓 + 自带颜色。
///
/// 校验的四件事都是"画不出来"的早期发现：层数非空、每层至少有一个颜色、
/// 轮廓以 `move` 开头（复用 [`parse_outline`]）、`strokeWidth` 落在 (0, 1]
/// —— 它是元素盒短边的比例，超过 1 说明作者按像素写了。
fn parse_sticker_body(file: &str, doc: &Value) -> Result<StickerBody, MotionError> {
    let items = field(file, doc, "layers")?.as_array().ok_or_else(|| {
        MotionError::ManifestInvalid(format!("{file}: \"layers\" is not an array"))
    })?;
    if items.is_empty() {
        return Err(MotionError::ManifestInvalid(format!(
            "{file}: sticker 至少要有一层"
        )));
    }
    let mut layers = Vec::with_capacity(items.len());
    for item in items {
        let fill = optional_color(file, item, "fill")?;
        let stroke = optional_color(file, item, "stroke")?;
        if fill.is_none() && stroke.is_none() {
            return Err(MotionError::ManifestInvalid(format!(
                "{file}: sticker 的层既没有 \"fill\" 也没有 \"stroke\"，画不出任何东西"
            )));
        }
        let stroke_width = match item.get("strokeWidth") {
            None | Some(Value::Null) => STICKER_DEFAULT_STROKE_WIDTH,
            Some(value) => value
                .as_f64()
                .filter(|width| *width > 0.0 && *width <= 1.0)
                .ok_or_else(|| {
                    MotionError::ManifestInvalid(format!(
                        "{file}: \"strokeWidth\" 是元素盒短边的比例，必须落在 (0, 1]（读到 {value}）"
                    ))
                })?,
        };
        layers.push(StickerLayer {
            segments: parse_outline(file, field(file, item, "segments")?)?,
            fill,
            stroke,
            stroke_width,
        });
    }
    Ok(StickerBody { layers })
}

/// 可缺席的 `#RRGGBB[AA]` 字段。缺席与 `null` 同义，其余一律按格式校验。
fn optional_color(file: &str, doc: &Value, key: &str) -> Result<Option<String>, MotionError> {
    match doc.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(_) => parse_color(file, doc, key).map(Some),
    }
}

fn parse_outline(file: &str, doc: &Value) -> Result<Vec<PathSegment>, MotionError> {
    let items = doc.as_array().ok_or_else(|| {
        MotionError::ManifestInvalid(format!("{file}: \"segments\" is not an array"))
    })?;
    let mut out = Vec::with_capacity(items.len());
    for item in items {
        let verb = text(file, item, "verb")?;
        let points = match item.get("pts") {
            Some(Value::Array(points)) => points
                .iter()
                .map(|point| {
                    let pair = point.as_array().filter(|pair| pair.len() == 2);
                    let pair = pair.ok_or_else(|| {
                        MotionError::ManifestInvalid(format!("{file}: bad point {point}"))
                    })?;
                    let x = pair[0].as_f64();
                    let y = pair[1].as_f64();
                    match (x, y) {
                        (Some(x), Some(y)) => Ok([x, y]),
                        _ => Err(MotionError::ManifestInvalid(format!(
                            "{file}: bad point {point}"
                        ))),
                    }
                })
                .collect::<Result<Vec<_>, _>>()?,
            None => Vec::new(),
            Some(other) => {
                return Err(MotionError::ManifestInvalid(format!(
                    "{file}: \"pts\" is not an array: {other}"
                )));
            }
        };
        out.push(match (verb, points.len()) {
            ("move", 1) => PathSegment::Move(points[0]),
            ("line", 1) => PathSegment::Line(points[0]),
            ("quad", 2) => PathSegment::Quad(points[0], points[1]),
            ("cubic", 3) => PathSegment::Cubic(points[0], points[1], points[2]),
            ("close", 0) => PathSegment::Close,
            (verb, count) => {
                return Err(MotionError::ManifestInvalid(format!(
                    "{file}: verb {verb:?} 不接受 {count} 个点"
                )));
            }
        });
    }
    if !matches!(out.first(), Some(PathSegment::Move(_))) {
        return Err(MotionError::ManifestInvalid(format!(
            "{file}: outline 必须以 move 开头"
        )));
    }
    Ok(out)
}

// ── visualizer / progress ────────────────────────────────────────────

fn parse_visualizer_body(file: &str, doc: &Value) -> Result<VisualizerBody, MotionError> {
    let num_colors = parse_num_colors(file, doc)?;
    let labels = parse_color_labels(file, doc, num_colors)?;
    let default_min_db = number(file, doc, "defaultMinDb")?;
    let default_max_db = number(file, doc, "defaultMaxDb")?;
    if !(default_min_db < default_max_db) {
        return Err(MotionError::ManifestInvalid(format!(
            "{file}: dB 窗必须 min < max（读到 {default_min_db} / {default_max_db}）"
        )));
    }
    let bin_width = text(file, doc, "binWidth")?;
    let aspect = text(file, doc, "aspect")?;
    Ok(VisualizerBody {
        num_colors,
        color_labels: labels,
        default_main_color: parse_color(file, doc, "defaultMainColor")?,
        default_secondary_color: parse_color(file, doc, "defaultSecondaryColor")?,
        default_min_db,
        default_max_db,
        has_control: field(file, doc, "hasControl")?
            .as_bool()
            .ok_or_else(|| MotionError::ManifestInvalid(format!("{file}: bad \"hasControl\"")))?,
        bin_width: BinWidth::parse(bin_width).ok_or_else(|| {
            MotionError::ManifestInvalid(format!("{file}: unknown binWidth {bin_width:?}"))
        })?,
        aspect: VisualizerAspect::parse(aspect).ok_or_else(|| {
            MotionError::ManifestInvalid(format!("{file}: unknown aspect {aspect:?}"))
        })?,
        recipe: parse_recipe(file, doc, CatalogueKind::Visualizer)?,
        determinism: parse_determinism(file, doc)?,
        shader: parse_visualizer_shader(file, doc)?,
    })
}

/// 声波配方全部走 CPU 矢量内核：`shader` 只接受 `null`（或不写）。写了文件名
/// 就是 manifest 与内核不一致，解析期直接拒绝。
fn parse_visualizer_shader(file: &str, doc: &Value) -> Result<Option<String>, MotionError> {
    match doc.get("shader") {
        None | Some(Value::Null) => Ok(None),
        Some(shader) => Err(MotionError::ManifestInvalid(format!(
            "{file}: visualizer 配方没有 shader（读到 {shader}）"
        ))),
    }
}

fn parse_progress_body(file: &str, doc: &Value) -> Result<ProgressBody, MotionError> {
    let aspect = text(file, doc, "aspect")?;
    let num_colors = parse_num_colors(file, doc)?;
    Ok(ProgressBody {
        num_colors,
        color_labels: parse_color_labels(file, doc, num_colors)?,
        default_main_color: parse_color(file, doc, "defaultMainColor")?,
        default_secondary_color: parse_color(file, doc, "defaultSecondaryColor")?,
        aspect: ProgressAspect::parse(aspect).ok_or_else(|| {
            MotionError::ManifestInvalid(format!("{file}: unknown aspect {aspect:?}"))
        })?,
        recipe: parse_recipe(file, doc, CatalogueKind::Progress)?,
        determinism: parse_determinism(file, doc)?,
        shader: parse_shader(file, doc)?,
    })
}

/// 彩纸配方体：`palette[]` + `shapes[]` + `sources[]` + `confetti-v1` 参数包。
///
/// 不走 [`parse_shader`]——彩纸没有 WGSL（`shader` 写 `null` 或不写）；
/// `aspect` 只接受 `"frame"`，别的盒形不是这一族的概念。
fn parse_confetti_body(file: &str, doc: &Value) -> Result<ConfettiBody, MotionError> {
    let aspect = text(file, doc, "aspect")?;
    if aspect != "frame" {
        return Err(MotionError::ManifestInvalid(format!(
            "{file}: confetti 的 \"aspect\" 恒为 \"frame\"（读到 {aspect:?}）"
        )));
    }
    if let Some(shader) = doc.get("shader")
        && !shader.is_null()
    {
        return Err(MotionError::ManifestInvalid(format!(
            "{file}: confetti 没有 shader（读到 {shader}）"
        )));
    }
    let palette = string_list(file, doc, "palette")?;
    if palette.is_empty() || palette.len() > 8 {
        return Err(MotionError::ManifestInvalid(format!(
            "{file}: \"palette\" 须有 1..=8 项（读到 {}）",
            palette.len()
        )));
    }
    for (index, color) in palette.iter().enumerate() {
        let hex = color.strip_prefix('#').unwrap_or("");
        if !matches!(hex.len(), 6 | 8) || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(MotionError::ManifestInvalid(format!(
                "{file}: \"palette[{index}]\" 不是 #RRGGBB / #RRGGBBAA（读到 {color:?}）"
            )));
        }
    }
    let shapes = string_list(file, doc, "shapes")?;
    if shapes.is_empty() {
        return Err(MotionError::ManifestInvalid(format!(
            "{file}: \"shapes\" 不能为空"
        )));
    }
    if let Some(unknown) = shapes
        .iter()
        .find(|shape| !CONFETTI_SHAPES.contains(&shape.as_str()))
    {
        return Err(MotionError::ManifestInvalid(format!(
            "{file}: unknown confetti shape {unknown:?}"
        )));
    }
    let sources = string_list(file, doc, "sources")?;
    let has_emitter_control = field(file, doc, "hasEmitterControl")?
        .as_bool()
        .ok_or_else(|| {
            MotionError::ManifestInvalid(format!("{file}: bad \"hasEmitterControl\""))
        })?;
    let recipe = parse_recipe(file, doc, CatalogueKind::Confetti)?;
    validate_confetti_recipe(file, &recipe)?;
    Ok(ConfettiBody {
        palette,
        shapes,
        sources,
        has_emitter_control,
        recipe,
        determinism: parse_determinism(file, doc)?,
    })
}

fn string_list(file: &str, doc: &Value, key: &str) -> Result<Vec<String>, MotionError> {
    field(file, doc, key)?
        .as_array()
        .ok_or_else(|| MotionError::ManifestInvalid(format!("{file}: \"{key}\" is not an array")))?
        .iter()
        .map(|value| {
            value.as_str().map(str::to_owned).ok_or_else(|| {
                MotionError::ManifestInvalid(format!("{file}: bad \"{key}\" item {value}"))
            })
        })
        .collect()
}

/// `confetti-v1` 参数包的形状校验（设计稿 §4.2）：区间对 `[lo, hi]` 两数升序
/// 非负、发射器至少一枚且坐标是数、`emit.mode` 封闭、`pulse` 是 `null` 或
/// `{min, max, hz}`。数值本身仍是配方的自由度，Rust 侧一个数字都不带。
fn validate_confetti_recipe(file: &str, recipe: &Recipe) -> Result<(), MotionError> {
    let bad = |what: &str| MotionError::ManifestInvalid(format!("{file}: confetti-v1 的 {what}"));
    for key in ["speedPx", "sizePx", "spinDps", "flipHz"] {
        let pair = recipe
            .array(key)
            .ok_or_else(|| bad(&format!("\"{key}\" 不是数组")))?;
        let lo = pair.first().and_then(Value::as_f64);
        let hi = pair.get(1).and_then(Value::as_f64);
        match (pair.len(), lo, hi) {
            (2, Some(lo), Some(hi)) if lo >= 0.0 && hi >= lo => {}
            _ => {
                return Err(bad(&format!(
                    "\"{key}\" 须是升序非负的 [lo, hi]（读到 {pair:?}）"
                )));
            }
        }
    }
    for key in [
        "angle",
        "spread",
        "dragX",
        "dragY",
        "gravityPx",
        "windPx",
        "driftPx",
        "driftHz",
        "lifeSec",
        "fadeIn",
        "fadeOut",
    ] {
        if recipe.number(key).is_none() {
            return Err(bad(&format!("\"{key}\" 不是数字")));
        }
    }
    if recipe.number("lifeSec").is_some_and(|life| life <= 0.0) {
        return Err(bad("\"lifeSec\" 须为正"));
    }
    if recipe.flag("sizeRamp").is_none() {
        return Err(bad("\"sizeRamp\" 不是布尔"));
    }
    let emitters = recipe
        .array("emitters")
        .ok_or_else(|| bad("\"emitters\" 不是数组"))?;
    if emitters.is_empty() {
        return Err(bad("\"emitters\" 至少一枚"));
    }
    for emitter in emitters {
        for key in ["x", "y", "spreadX", "spreadY"] {
            if emitter.get(key).and_then(Value::as_f64).is_none() {
                return Err(bad(&format!("发射器缺 \"{key}\"（读到 {emitter}）")));
            }
        }
        if let Some(angle) = emitter.get("angle")
            && !angle.is_null()
            && angle.as_f64().is_none()
        {
            return Err(bad(&format!("发射器 \"angle\" 不是数字（读到 {emitter}）")));
        }
    }
    let emit = recipe
        .object("emit")
        .ok_or_else(|| bad("\"emit\" 不是对象"))?;
    validate_tagged(file, recipe, "emit", "mode", &["continuous", "burst"])?;
    for key in ["rate", "count", "interval", "jitter"] {
        if !emit
            .get(key)
            .and_then(Value::as_f64)
            .is_some_and(|v| v >= 0.0)
        {
            return Err(bad(&format!("\"emit.{key}\" 须是非负数（读到 {emit:?}）")));
        }
    }
    if let Some(pulse) = recipe.object("pulse") {
        for key in ["min", "max", "hz"] {
            if !pulse
                .get(key)
                .and_then(Value::as_f64)
                .is_some_and(|v| v >= 0.0)
            {
                return Err(bad(&format!(
                    "\"pulse.{key}\" 须是非负数（读到 {pulse:?}）"
                )));
            }
        }
    } else if recipe.get("pulse").is_some_and(|v| !v.is_null()) {
        return Err(bad("\"pulse\" 须是 null 或对象"));
    }
    Ok(())
}

/// `colorLabels`：条数必须恰好等于 `numColors`。
///
/// 声波与进度共用一份——两族的色板标题都是英文原文
/// （Bars / Wave 1 / Bar / Base / Color 1 / Foreground…），译名在各表面自己做。
fn parse_color_labels(file: &str, doc: &Value, num_colors: u8) -> Result<Vec<String>, MotionError> {
    let labels = field(file, doc, "colorLabels")?
        .as_array()
        .ok_or_else(|| {
            MotionError::ManifestInvalid(format!("{file}: \"colorLabels\" is not an array"))
        })?
        .iter()
        .map(|value| {
            value.as_str().map(str::to_owned).ok_or_else(|| {
                MotionError::ManifestInvalid(format!("{file}: bad color label {value}"))
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    if labels.len() != usize::from(num_colors) {
        return Err(MotionError::ManifestInvalid(format!(
            "{file}: \"colorLabels\" 有 {} 条，\"numColors\" 是 {num_colors}",
            labels.len()
        )));
    }
    Ok(labels)
}

fn parse_num_colors(file: &str, doc: &Value) -> Result<u8, MotionError> {
    match field(file, doc, "numColors")?.as_u64() {
        Some(count @ 0..=2) => Ok(count as u8),
        other => Err(MotionError::ManifestInvalid(format!(
            "{file}: \"numColors\" 必须是 0 / 1 / 2（读到 {other:?}）"
        ))),
    }
}

/// `#RRGGBB` 或 `#RRGGBBAA`（半透明的默认色用 8 位）。
fn parse_color(file: &str, doc: &Value, key: &str) -> Result<String, MotionError> {
    let value = text(file, doc, key)?;
    let hex = value.strip_prefix('#').unwrap_or("");
    if !matches!(hex.len(), 6 | 8) || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(MotionError::ManifestInvalid(format!(
            "{file}: \"{key}\" 不是 #RRGGBB / #RRGGBBAA（读到 {value:?}）"
        )));
    }
    Ok(value.to_owned())
}

fn parse_determinism(file: &str, doc: &Value) -> Result<Determinism, MotionError> {
    let value = text(file, doc, "determinism")?;
    Determinism::parse(value).ok_or_else(|| {
        MotionError::ManifestInvalid(format!("{file}: unknown determinism {value:?}"))
    })
}

fn parse_shader(file: &str, doc: &Value) -> Result<String, MotionError> {
    let value = text(file, doc, "shader")?;
    if !value.ends_with(".wgsl") || value.len() <= ".wgsl".len() {
        return Err(MotionError::ManifestInvalid(format!(
            "{file}: \"shader\" 必须是 WGSL 文件名（读到 {value:?}）"
        )));
    }
    Ok(value.to_owned())
}

/// `recipe` = 封闭算法名 + 参数包，参数按算法名做 schema 校验。
fn parse_recipe(file: &str, doc: &Value, kind: CatalogueKind) -> Result<Recipe, MotionError> {
    let recipe = field(file, doc, "recipe")?;
    let name = text(file, recipe, "algorithm")?;
    let algorithm = RecipeAlgorithm::parse(name).ok_or_else(|| {
        MotionError::ManifestInvalid(format!("{file}: unknown recipe algorithm {name:?}"))
    })?;
    if algorithm.kind() != kind {
        return Err(MotionError::ManifestInvalid(format!(
            "{file}: 算法 {name:?} 属于 {} 目录，不能用在 {} 配方里",
            algorithm.kind().dir(),
            kind.dir()
        )));
    }
    let params = field(file, recipe, "params")?
        .as_object()
        .ok_or_else(|| {
            MotionError::ManifestInvalid(format!("{file}: \"recipe.params\" is not an object"))
        })?
        .clone();
    let recipe = Recipe { algorithm, params };
    validate_recipe(file, &recipe)?;
    Ok(recipe)
}

fn validate_recipe(file: &str, recipe: &Recipe) -> Result<(), MotionError> {
    let name = recipe.algorithm.name();
    for key in recipe.algorithm.required() {
        if !recipe.params.contains_key(*key) {
            return Err(MotionError::ManifestInvalid(format!(
                "{file}: 配方 {name} 缺参数 \"{key}\""
            )));
        }
    }
    for (key, value) in &recipe.params {
        if matches!(value, Value::Null) {
            continue;
        }
        if POSITIVE_INT_KEYS.contains(&key.as_str())
            && !value.as_u64().is_some_and(|count| count > 0)
        {
            return Err(MotionError::ManifestInvalid(format!(
                "{file}: 配方 {name} 的 \"{key}\" 必须是正整数（读到 {value}）"
            )));
        }
        if UNIT_INTERVAL_KEYS.contains(&key.as_str())
            && !value.as_f64().is_some_and(|v| (0.0..=1.0).contains(&v))
        {
            return Err(MotionError::ManifestInvalid(format!(
                "{file}: 配方 {name} 的 \"{key}\" 必须落在 [0, 1]（读到 {value}）"
            )));
        }
        if POSITIVE_NUMBER_KEYS.contains(&key.as_str())
            && !value.as_f64().is_some_and(|v| v > 0.0 && v.is_finite())
        {
            return Err(MotionError::ManifestInvalid(format!(
                "{file}: 配方 {name} 的 \"{key}\" 必须是正数（读到 {value}）"
            )));
        }
        if key == "samples" && !value.as_u64().is_some_and(|n| n >= MIN_SAMPLES) {
            return Err(MotionError::ManifestInvalid(format!(
                "{file}: 配方 {name} 的 \"samples\" 至少是 {MIN_SAMPLES}（读到 {value}）"
            )));
        }
        if let Some((_, allowed)) = ENUM_KEYS.iter().find(|(name, _)| name == key) {
            let found = value.as_str().unwrap_or_default();
            if !allowed.contains(&found) {
                return Err(MotionError::ManifestInvalid(format!(
                    "{file}: 配方 {name} 的 \"{key}\" 只接受 {allowed:?}（读到 {value}）"
                )));
            }
        }
    }
    validate_tagged(file, recipe, "corner", "kind", &["none", "capsule"])?;
    validate_tagged(
        file,
        recipe,
        "colorMode",
        "kind",
        &["solid", "rainbow", "strobe"],
    )?;
    Ok(())
}

/// 带 tag 的嵌套参数（`{"kind": ...}` / `{"form": ...}` / `{"ease": ...}`）：
/// 存在即必须是对象，且 tag 落在封闭集合里。
fn validate_tagged(
    file: &str,
    recipe: &Recipe,
    key: &str,
    tag: &str,
    allowed: &[&str],
) -> Result<(), MotionError> {
    let Some(value) = recipe.params.get(key) else {
        return Ok(());
    };
    if matches!(value, Value::Null) {
        return Ok(());
    }
    let found = value.get(tag).and_then(Value::as_str);
    match found {
        Some(found) if allowed.contains(&found) => Ok(()),
        _ => Err(MotionError::ManifestInvalid(format!(
            "{file}: 配方 {} 的 \"{key}.{tag}\" 只接受 {allowed:?}（读到 {value}）",
            recipe.algorithm.name()
        ))),
    }
}
