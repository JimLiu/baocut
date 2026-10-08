//! Preset 配方注册表（ADR-M03，设计 §5.4）。
//!
//! 内置配方是**数据**：`core/presets/builtin/{motion,transition}/*.json`，
//! 经 `include_str!` 嵌入、`OnceLock` 一次性解析成 `'static` 结构。
//! 数字全部来自 manifest，算法按名字引用（`lattice-murmur-v1`、`idle-ramp-v1`），
//! 未知算法名在解析期就被拒绝（`manifest-invalid`）。
//!
//! 两种形状并存（ADR-M08）：
//!
//! - [`frozen`]：阶段 1 已发布的 `timeline.*@1` / `bcf.*@1` / 转场配方，
//!   四条专用解析路径，**不得改写**——它们钉着旧项目的像素。
//! - [`manifest`]：设计 §5.4.1 的通用 manifest（`tracks` 或 `compose` + `params`
//!   + `aliases` + `exposedTo`），阶段 2 的 canonical family 走它；
//!   展开在 [`compose`]，`"{param}"` 替换在 [`substitute`]。
//!
//! 为什么用显式 `include_str!` 清单而不是 `build.rs`：清单可 grep、改名即红、
//! `cargo build --offline` 与 `apps/gpui` 的独立 lockfile 都不受影响，
//! "加一个 preset = 加一行"是字面意义上的。目录与清单的一致性由
//! `tests/manifests.rs`（dev-only，可以读文件系统）守住。

use std::sync::OnceLock;

use serde_json::{Map, Value};

use crate::MotionError;
use crate::fingerprint::fnv1a64;

macro_rules! builtin {
    ($ns:literal, $file:literal) => {
        (
            $file,
            include_str!(concat!("../../presets/builtin/", $ns, "/", $file, ".json")),
        )
    };
}

/// 加一个 motion 配方 = 加一行。
static MOTION_SOURCES: &[(&str, &str)] = &[
    builtin!("motion", "timeline.enter.none"),
    builtin!("motion", "timeline.enter.fade"),
    builtin!("motion", "timeline.enter.rise"),
    builtin!("motion", "timeline.enter.drop"),
    builtin!("motion", "timeline.enter.slideL"),
    builtin!("motion", "timeline.enter.slideR"),
    builtin!("motion", "timeline.enter.pop"),
    builtin!("motion", "timeline.enter.zoomIn"),
    builtin!("motion", "timeline.enter.zoomOut"),
    builtin!("motion", "timeline.enter.spin"),
    builtin!("motion", "timeline.enter.blurIn"),
    builtin!("motion", "timeline.enter.typewriter"),
    builtin!("motion", "timeline.enter.riseWords"),
    builtin!("motion", "timeline.enter.wipe"),
    // 设计稿文字动画目录补齐（`designs/baocut/app/model-textpresets.js`）：
    // 姿态按同名动画的起点与时长感觉取值，单 pose 模型近似。
    builtin!("motion", "timeline.enter.compress"),
    builtin!("motion", "timeline.enter.bounce"),
    builtin!("motion", "timeline.enter.fall"),
    builtin!("motion", "timeline.enter.skid"),
    builtin!("motion", "timeline.enter.roll"),
    // 第 156 轮补齐到设计稿 In 19 / Out 16 / Loop 9：slide 补上下两向
    // （入场方向 = 从哪一侧来），wave/flipboard/dragonfly/billboard 首次落核。
    builtin!("motion", "timeline.enter.slideUp"),
    builtin!("motion", "timeline.enter.slideDown"),
    builtin!("motion", "timeline.enter.wave"),
    builtin!("motion", "timeline.enter.flipboard"),
    builtin!("motion", "timeline.enter.dragonfly"),
    builtin!("motion", "timeline.enter.billboard"),
    builtin!("motion", "timeline.enter.elFade"),
    builtin!("motion", "timeline.enter.elFloatL"),
    builtin!("motion", "timeline.enter.elFloatR"),
    builtin!("motion", "timeline.enter.elFloatUp"),
    builtin!("motion", "timeline.enter.elFloatDown"),
    builtin!("motion", "timeline.enter.elZoom"),
    builtin!("motion", "timeline.enter.elKenBurns"),
    builtin!("motion", "timeline.enter.elDrop"),
    builtin!("motion", "timeline.enter.elSlideL"),
    builtin!("motion", "timeline.enter.elSlideR"),
    builtin!("motion", "timeline.enter.elSlideUp"),
    builtin!("motion", "timeline.enter.elSlideDown"),
    builtin!("motion", "timeline.enter.elWipeL"),
    builtin!("motion", "timeline.enter.elWipeR"),
    builtin!("motion", "timeline.enter.elWipeUp"),
    builtin!("motion", "timeline.enter.elWipeDown"),
    builtin!("motion", "timeline.enter.elPop"),
    builtin!("motion", "timeline.enter.elBounce"),
    builtin!("motion", "timeline.enter.elSpinCw"),
    builtin!("motion", "timeline.enter.elSpinCcw"),
    builtin!("motion", "timeline.enter.elSlideBounceL"),
    builtin!("motion", "timeline.enter.elSlideBounceR"),
    builtin!("motion", "timeline.enter.elSlideBounceUp"),
    builtin!("motion", "timeline.enter.elSlideBounceDown"),
    builtin!("motion", "timeline.enter.elGentleFloatL"),
    builtin!("motion", "timeline.enter.elGentleFloatR"),
    builtin!("motion", "timeline.enter.elGentleFloatUp"),
    builtin!("motion", "timeline.enter.elGentleFloatDown"),
    builtin!("motion", "timeline.exit.none"),
    builtin!("motion", "timeline.exit.fade"),
    builtin!("motion", "timeline.exit.sink"),
    builtin!("motion", "timeline.exit.rise"),
    builtin!("motion", "timeline.exit.slideL"),
    builtin!("motion", "timeline.exit.slideR"),
    builtin!("motion", "timeline.exit.shrink"),
    builtin!("motion", "timeline.exit.zoomIn"),
    builtin!("motion", "timeline.exit.zoomOut"),
    builtin!("motion", "timeline.exit.spin"),
    builtin!("motion", "timeline.exit.wipe"),
    builtin!("motion", "timeline.exit.compress"),
    builtin!("motion", "timeline.exit.fall"),
    builtin!("motion", "timeline.exit.skid"),
    builtin!("motion", "timeline.exit.roll"),
    // 出场方向 = 往哪一侧去；`drop` 是设计稿 stomp 的出场（下沉放大）。
    builtin!("motion", "timeline.exit.slideUp"),
    builtin!("motion", "timeline.exit.slideDown"),
    builtin!("motion", "timeline.exit.drop"),
    builtin!("motion", "timeline.exit.flipboard"),
    builtin!("motion", "timeline.exit.dragonfly"),
    builtin!("motion", "timeline.exit.billboard"),
    builtin!("motion", "timeline.exit.elFade"),
    builtin!("motion", "timeline.exit.elFloatL"),
    builtin!("motion", "timeline.exit.elFloatR"),
    builtin!("motion", "timeline.exit.elFloatUp"),
    builtin!("motion", "timeline.exit.elFloatDown"),
    builtin!("motion", "timeline.exit.elZoom"),
    builtin!("motion", "timeline.exit.elKenBurns"),
    builtin!("motion", "timeline.exit.elDrop"),
    builtin!("motion", "timeline.exit.elSlideL"),
    builtin!("motion", "timeline.exit.elSlideR"),
    builtin!("motion", "timeline.exit.elSlideUp"),
    builtin!("motion", "timeline.exit.elSlideDown"),
    builtin!("motion", "timeline.exit.elWipeL"),
    builtin!("motion", "timeline.exit.elWipeR"),
    builtin!("motion", "timeline.exit.elWipeUp"),
    builtin!("motion", "timeline.exit.elWipeDown"),
    builtin!("motion", "timeline.exit.elPop"),
    builtin!("motion", "timeline.exit.elBounce"),
    builtin!("motion", "timeline.exit.elSpinCw"),
    builtin!("motion", "timeline.exit.elSpinCcw"),
    builtin!("motion", "timeline.exit.elSlideBounceL"),
    builtin!("motion", "timeline.exit.elSlideBounceR"),
    builtin!("motion", "timeline.exit.elSlideBounceUp"),
    builtin!("motion", "timeline.exit.elSlideBounceDown"),
    builtin!("motion", "timeline.exit.elGentleFloatL"),
    builtin!("motion", "timeline.exit.elGentleFloatR"),
    builtin!("motion", "timeline.exit.elGentleFloatUp"),
    builtin!("motion", "timeline.exit.elGentleFloatDown"),
    builtin!("motion", "timeline.loop.float"),
    builtin!("motion", "timeline.loop.pulse"),
    builtin!("motion", "timeline.loop.sway"),
    builtin!("motion", "timeline.loop.jitter"),
    builtin!("motion", "timeline.loop.blink"),
    // 设计稿 Loop 目录：rotate 走 ramp 波（360° 接缝闭合）、heartBeat 走
    // heartbeat 波，其余是 sine/dip 的多通道组合。
    builtin!("motion", "timeline.loop.rotate"),
    builtin!("motion", "timeline.loop.heartBeat"),
    builtin!("motion", "timeline.loop.vogue"),
    builtin!("motion", "timeline.loop.dragonfly"),
    builtin!("motion", "timeline.loop.billboard"),
    builtin!("motion", "timeline.loop.roll"),
    builtin!("motion", "timeline.loop.elSpin"),
    builtin!("motion", "timeline.loop.elSpinSmooth"),
    builtin!("motion", "timeline.loop.elSpin3d"),
    builtin!("motion", "timeline.loop.elBounce"),
    builtin!("motion", "timeline.loop.elHeartbeat"),
    builtin!("motion", "timeline.loop.elSway"),
    builtin!("motion", "timeline.loop.elSway3d"),
    builtin!("motion", "timeline.loop.elSqueezy"),
    builtin!("motion", "timeline.loop.elJiggle"),
    builtin!("motion", "bcf.fadeIn"),
    builtin!("motion", "bcf.fadeOut"),
    builtin!("motion", "bcf.countUp"),
    builtin!("motion", "bcf.barFill"),
    builtin!("motion", "bcf.kenBurns"),
];

static TRANSITION_SOURCES: &[(&str, &str)] = &[
    builtin!("transition", "bcf.cut"),
    builtin!("transition", "bcf.crossfade"),
    builtin!("transition", "bcf.slideLeft"),
    builtin!("transition", "bcf.slideRight"),
    builtin!("transition", "bcf.slideUp"),
    builtin!("transition", "bcf.slideDown"),
    // 阶段 5：补齐规范 §9 的 Motion Transition 词汇。
    builtin!("transition", "bcf.wipeLeft"),
    builtin!("transition", "bcf.wipeRight"),
    builtin!("transition", "bcf.zoomThrough"),
    builtin!("transition", "bcf.whipPan"),
];

/// 字幕入场姿态配方（阶段 5 收编的 `magic-*`）。与 `TRANSITION_SOURCES` 分表：
/// 它们不产生 BCF 通道，消费者是 `studio_export` 的字幕合成。
static CAPTION_TRANSITION_SOURCES: &[(&str, &str)] = &[
    builtin!("transition", "caption.fade"),
    builtin!("transition", "caption.pop"),
    builtin!("transition", "caption.flip"),
];

/// 目录型配方（ADR-E05）：**shape / visualizer / progress 的形状库**。
///
/// 与 `MOTION_SOURCES` / `TRANSITION_SOURCES` / `MANIFEST_SOURCES` 三份清单
/// 并列的第四份，走独立循环与独立 parser，解析结果存 [`RegistryData`] 的独立
/// 字段——**不进 `manifests` 向量**，因此不出现在 `families()` / `manifest_ids()`
/// 里，阶段 2 的三条守卫不受影响。
///
/// P0 只落首批 4 份 shape；P7 扩到 23 种基础形状，P2 补 visualizer / progress。
/// 形状目录（设计 §10 P7）。清单顺序无所谓——面板顺序来自 `order` 字段，
/// 这里按面板网格序书写只是为了好读。
///
/// **23 种基础形状**：21 份 `viewBox="0 0 100 100"` 的 `d=` → 0..1 归一化
/// outline；`rect` / `ellipse` 是参数化的 `path.kind`。
/// **`line` 是 BaoCut 自有的第 24 份**：P0 已经把它写进
/// 契约、golden 与三端孪生，删掉等于让现存文档的形状静默消失，收益为零。
/// `arrow` 是 P0 的**线段 + 端头**
/// （带 `endpoints` / `head` 两个参数，标注用途更强），不是块状箭头——
/// 块状箭头的形状由同族的 `squig2`（右向块状箭头）覆盖。
static SHAPE_SOURCES: &[(&str, &str)] = &[
    builtin!("shape", "rect"),
    builtin!("shape", "ellipse"),
    builtin!("shape", "triangle"),
    builtin!("shape", "rombus"),
    builtin!("shape", "pentagon"),
    builtin!("shape", "hex"),
    builtin!("shape", "octagon"),
    builtin!("shape", "squig"),
    builtin!("shape", "squig2"),
    builtin!("shape", "line"),
    builtin!("shape", "arrow"),
    builtin!("shape", "tick"),
    builtin!("shape", "tick2"),
    builtin!("shape", "chevron"),
    builtin!("shape", "chevron2"),
    builtin!("shape", "cross2"),
    builtin!("shape", "cross"),
    builtin!("shape", "love2"),
    builtin!("shape", "love"),
    builtin!("shape", "diamond"),
    builtin!("shape", "star"),
    builtin!("shape", "sharp"),
    builtin!("shape", "star2"),
    builtin!("shape", "sharp2"),
];

/// 模板贴纸（设计 §10 P7 的 `StickerProps.source == "template"`）。
///
/// **首批 10 份，全部是 BaoCut 自绘的归一化 path**，不含第三方美术资产。
/// 静态贴纸就是单帧 SVG/PNG，动态贴纸 = 带 alpha 的循环 WebM。
///
/// 首批刻意选**可精确构造的几何**（圆、正多边形、星形、圆角矩形、三次贝塞尔
/// 心形/水滴），这样"结构对不对"能被 golden 钉死；补充美术型模板是纯数据，
/// 加一份 = 加一行 + 一个 JSON（P7c）。
static STICKER_SOURCES: &[(&str, &str)] = &[
    builtin!("sticker", "badge_check"),
    builtin!("sticker", "badge_cross"),
    builtin!("sticker", "star_burst"),
    builtin!("sticker", "speech_bubble"),
    builtin!("sticker", "heart"),
    builtin!("sticker", "bolt"),
    builtin!("sticker", "pin"),
    builtin!("sticker", "sparkle"),
    builtin!("sticker", "arrow_curved"),
    builtin!("sticker", "crown"),
];

/// 10 种 sound wave（设计 §7.3）。顺序无所谓——目录顺序来自 `order` 字段。
static VISUALIZER_SOURCES: &[(&str, &str)] = &[
    builtin!("visualizer", "bars"),
    builtin!("visualizer", "bars_rounded"),
    builtin!("visualizer", "bars_bottom"),
    builtin!("visualizer", "ring_bars"),
    builtin!("visualizer", "oscilloscope"),
    builtin!("visualizer", "ring_wave"),
    builtin!("visualizer", "spectrum_area"),
    builtin!("visualizer", "dots"),
    builtin!("visualizer", "pulse_rings"),
    builtin!("visualizer", "ribbons"),
];

/// 2026-09 之前的声波目录是旧的 15 款；换代后老 `timeline.json` 里的
/// `visualizer.style` 仍可能写着旧 id。这张表把每个旧 id 指到造型最接近的新款，
/// 让老项目照常打开、照常渲染（属性面板会显示新款）。表是只增不删的兼容层，
/// 新目录自身的 id 不在表里。
static VISUALIZER_STYLE_ALIASES: &[(&str, &str)] = &[
    ("trio_wave", "bars"),
    ("formation", "bars"),
    ("formation_thin", "bars"),
    ("formation_rounded", "bars_rounded"),
    ("formation_aligned", "bars_bottom"),
    ("formation_thin_aligned", "bars_bottom"),
    ("static", "bars_bottom"),
    ("formation_circle", "ring_bars"),
    ("beam", "oscilloscope"),
    ("simi", "ribbons"),
    ("harmony", "ribbons"),
    ("waves", "ribbons"),
    ("frequency_lines", "dots"),
    ("echo_lines", "dots"),
    ("ripple_wave", "pulse_rings"),
];

/// 14 种 progress（设计 §7.4）。面板上有 16 个 tile，但 Countdown / Count Up
/// 实为文字元素，不是 progress shader——这里只登记真正的 14 种。
static PROGRESS_SOURCES: &[(&str, &str)] = &[
    builtin!("progress", "normal"),
    builtin!("progress", "rounded"),
    builtin!("progress", "circle"),
    builtin!("progress", "donut"),
    builtin!("progress", "border"),
    builtin!("progress", "reverse_border"),
    builtin!("progress", "rainbow_border"),
    builtin!("progress", "reverse_rainbow_border"),
    builtin!("progress", "strobe_border"),
    builtin!("progress", "reverse_strobe_border"),
    builtin!("progress", "snake"),
    builtin!("progress", "snake_spin"),
    builtin!("progress", "snake_rainbow"),
    builtin!("progress", "snake_spin_rainbow"),
];

/// 10 款彩纸（`docs/design/elements/bcut-confetti-element-design.md` §4.4）：改编自 react-confetti /
/// party-js / js-confetti 三个 MIT 来源，一款一份配方。
static CONFETTI_SOURCES: &[(&str, &str)] = &[
    builtin!("confetti", "rainbow-paper"),
    builtin!("confetti", "pastel-fall"),
    builtin!("confetti", "neon-streamers"),
    builtin!("confetti", "golden-starburst"),
    builtin!("confetti", "festival-fireworks"),
    builtin!("confetti", "hearts-petals"),
    builtin!("confetti", "party-cannons"),
    builtin!("confetti", "curling-ribbons"),
    builtin!("confetti", "geometric-pop"),
    builtin!("confetti", "champagne-sparkle"),
];

/// 文字预设包（`docs/design/app-v2/text-pane-and-groups.md` §6.2）：Text 面板预设库的
/// 目录。**第五份清单**，独立结构、独立循环、独立字段——一条预设是「一组排好版
/// 的元素」，不是「一个 kind 的一种画法」，塞不进 `CatalogueRecipe`（见
/// [`textpreset`] 模块头）。
///
/// 首批 51 条，分四类（simple 13 / title 10 / lowerThird 20 / other 8）。
/// 每条是**配置参数**——分类、坐标、字号、字体名、颜色、动画时序与 delay，
/// 单位在生成期换算成 BaoCut 自己的（画幅百分比 / 短边 540 像素 / 角度）；
/// 图片型装饰用本目录已有的等价形状（`arrow` / `diamond`），不含第三方美术素材。
static TEXTPRESET_SOURCES: &[(&str, &str)] = &[
    builtin!("textpreset", "simple.01"),
    builtin!("textpreset", "simple.02"),
    builtin!("textpreset", "simple.03"),
    builtin!("textpreset", "simple.04"),
    builtin!("textpreset", "simple.05"),
    builtin!("textpreset", "simple.06"),
    builtin!("textpreset", "simple.07"),
    builtin!("textpreset", "simple.08"),
    builtin!("textpreset", "simple.09"),
    builtin!("textpreset", "simple.10"),
    builtin!("textpreset", "simple.11"),
    builtin!("textpreset", "simple.12"),
    builtin!("textpreset", "simple.13"),
    builtin!("textpreset", "title.01"),
    builtin!("textpreset", "title.02"),
    builtin!("textpreset", "title.03"),
    builtin!("textpreset", "title.04"),
    builtin!("textpreset", "title.05"),
    builtin!("textpreset", "title.06"),
    builtin!("textpreset", "title.07"),
    builtin!("textpreset", "title.08"),
    builtin!("textpreset", "title.09"),
    builtin!("textpreset", "title.10"),
    builtin!("textpreset", "lowerThird.01"),
    builtin!("textpreset", "lowerThird.02"),
    builtin!("textpreset", "lowerThird.03"),
    builtin!("textpreset", "lowerThird.04"),
    builtin!("textpreset", "lowerThird.05"),
    builtin!("textpreset", "lowerThird.06"),
    builtin!("textpreset", "lowerThird.07"),
    builtin!("textpreset", "lowerThird.08"),
    builtin!("textpreset", "lowerThird.09"),
    builtin!("textpreset", "lowerThird.10"),
    builtin!("textpreset", "lowerThird.11"),
    builtin!("textpreset", "lowerThird.12"),
    builtin!("textpreset", "lowerThird.13"),
    builtin!("textpreset", "lowerThird.14"),
    builtin!("textpreset", "lowerThird.15"),
    builtin!("textpreset", "lowerThird.16"),
    builtin!("textpreset", "lowerThird.17"),
    builtin!("textpreset", "lowerThird.18"),
    builtin!("textpreset", "lowerThird.19"),
    builtin!("textpreset", "lowerThird.20"),
    builtin!("textpreset", "other.01"),
    builtin!("textpreset", "other.02"),
    builtin!("textpreset", "other.03"),
    builtin!("textpreset", "other.04"),
    builtin!("textpreset", "other.05"),
    builtin!("textpreset", "other.06"),
    builtin!("textpreset", "other.07"),
    builtin!("textpreset", "other.08"),
];

pub mod catalogue;
pub mod compose;
pub mod frozen;
pub(crate) mod json;
pub mod manifest;
pub mod substitute;
pub mod textpreset;

pub use catalogue::{
    BinWidth, CONFETTI_SHAPES, CatalogueBody, CatalogueKind, CatalogueRecipe, ConfettiBody,
    PathSegment, ProgressAspect, ProgressBody, Recipe, RecipeAlgorithm,
    STICKER_DEFAULT_STROKE_WIDTH, ShapeBody, ShapeHead, ShapeParam, ShapePath, StickerBody,
    StickerLayer, VisualizerAspect, VisualizerBody,
};
pub use compose::{ExpandCtx, ExpandedPreset, ResolvedFrame, ResolvedTrack, expand, expand_with};
pub use frozen::{
    BcfPreset, CaptionChannel, CaptionTransitionRecipe, LoopRecipe, RecipeSurface, Slot,
    SlotChannels, SlotKeyframe, SlotRecipe, TransitionChannel, TransitionRecipe, TranslateBasis,
};
pub use manifest::{
    AppliesTo, Determinism, ManifestDomain, ParamSpec, ParamType, PresetBody, PresetManifest,
    Surface,
};
pub use textpreset::{
    TextPresetCategory, TextPresetItem, TextPresetItemKind, TextPresetRecipe, TextPresetTables,
};

/// 设计 §13「Preset 词汇膨胀」风险行与 §5.4.3：**元素** canonical family 上限。
/// 改这个常量前回到 ADR——UI 变体靠**参数**扩张，不靠新家族。
///
/// 设计 §5.4.3 列的 12 个家族里没有 `fadeIn`（本实现把它单独发成一个家族，
/// 它是 Gallery 里最常用的一张卡），因此实际预算是 12 + 1（§15 阶段 3 偏离）。
pub const CANONICAL_FAMILY_BUDGET: usize = 13;

/// 文字 part 家族的独立预算（规范 §7.9）。part 效果是另一套词汇，
/// 混进元素预算只会让两边互相挤占。
pub const PART_FAMILY_BUDGET: usize = 8;

use frozen::{parse_bcf, parse_caption_transition, parse_loop, parse_slot, parse_transition};

/// 通用 manifest（设计 §5.4.1）。加一个 family = 加一行。
/// 前八个是**内部积木**（`family: null`），只被 `compose` 引用，不进 Gallery。
static MANIFEST_SOURCES: &[(&str, &str)] = &[
    builtin!("motion", "motion.shiftIn"),
    builtin!("motion", "motion.shiftOut"),
    builtin!("motion", "motion.zoomIn"),
    builtin!("motion", "motion.zoomOut"),
    builtin!("motion", "motion.spinIn"),
    builtin!("motion", "motion.spinOut"),
    builtin!("motion", "motion.blurFrom"),
    builtin!("motion", "motion.blurTo"),
    builtin!("motion", "motion.fadeIn"),
    builtin!("motion", "motion.fadeOut"),
    builtin!("motion", "motion.moveIn"),
    builtin!("motion", "motion.moveOut"),
    builtin!("motion", "motion.scaleIn"),
    builtin!("motion", "motion.scaleOut"),
    builtin!("motion", "motion.backIn"),
    builtin!("motion", "motion.backOut"),
    builtin!("motion", "motion.elasticIn"),
    builtin!("motion", "motion.elasticOut"),
    builtin!("motion", "motion.rotateIn"),
    builtin!("motion", "motion.rotateOut"),
    builtin!("motion", "motion.rollIn"),
    builtin!("motion", "motion.rollOut"),
    builtin!("motion", "motion.blurIn"),
    builtin!("motion", "motion.blurOut"),
    builtin!("motion", "motion.pulse"),
    builtin!("motion", "motion.flash"),
    builtin!("motion", "motion.tilt"),
    builtin!("motion", "motion.shake"),
    builtin!("motion", "motion.drift"),
    // 文字 part 配方（`appliesTo: "part"`，规范 §7.9）
    builtin!("motion", "motion.typewriter"),
    builtin!("motion", "motion.riseParts"),
    builtin!("motion", "motion.wipeParts"),
    builtin!("motion", "motion.karaokeScale"),
    builtin!("motion", "motion.seededJitter"),
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Domain {
    TimelineEnter,
    TimelineExit,
    TimelineLoop,
    BcfMotion,
    BcfTransition,
    /// 目录型配方：Timeline `shape` 元素的形状库（ADR-E05）。
    TimelineShape,
    /// 目录型配方：Timeline `sticker` 元素的模板贴纸库（设计 §10 P7）。
    TimelineSticker,
    /// 目录型配方：Timeline `visualizer` 元素的 10 种 sound wave（设计 §7.3）。
    TimelineVisualizer,
    /// 目录型配方：Timeline `progress` 元素的 14 种进度条（设计 §7.4）。
    TimelineProgress,
    /// 目录型配方：Timeline `confetti` 元素的 10 款彩纸（彩纸设计稿 §4）。
    TimelineConfetti,
    /// 文字预设包：Text 面板预设库的 51 条场景模板（§6.2）。
    TextPreset,
}

/// 逐通道 `Option<f64>`，字段顺序与 `AnimationPose` 一致。

struct RegistryData {
    manifests: Vec<PresetManifest>,
    /// alias → canonical id。解析期建，冲突即 `manifest-invalid`。
    aliases: Vec<(String, String)>,
    enter: Vec<SlotRecipe>,
    exit: Vec<SlotRecipe>,
    loops: Vec<LoopRecipe>,
    bcf: Vec<BcfPreset>,
    transitions: Vec<TransitionRecipe>,
    caption_transitions: Vec<CaptionTransitionRecipe>,
    /// 目录型配方（ADR-E05）：**独立字段**，刻意不混进 `manifests`。
    shapes: Vec<CatalogueRecipe>,
    stickers: Vec<CatalogueRecipe>,
    visualizers: Vec<CatalogueRecipe>,
    progresses: Vec<CatalogueRecipe>,
    confettis: Vec<CatalogueRecipe>,
    /// 文字预设包：同样是独立字段，不混进任何一张动画表。
    text_presets: Vec<TextPresetRecipe>,
    bcf_map: Value,
}

fn data() -> &'static RegistryData {
    static DATA: OnceLock<RegistryData> = OnceLock::new();
    DATA.get_or_init(|| build().expect("builtin preset manifests"))
}

fn build() -> Result<RegistryData, MotionError> {
    let mut enter = Vec::new();
    let mut exit = Vec::new();
    let mut loops = Vec::new();
    let mut bcf = Vec::new();
    for (file, source) in MOTION_SOURCES {
        let hash = fnv1a64(source.as_bytes());
        let doc: Value = serde_json::from_str(source)
            .map_err(|err| MotionError::ManifestInvalid(format!("{file}: {err}")))?;
        match doc.get("namespace").and_then(Value::as_str) {
            Some("timeline") => match doc.get("slot").and_then(Value::as_str) {
                Some("enter") => enter.push(parse_slot(file, &doc, Slot::Enter, hash)?),
                Some("exit") => exit.push(parse_slot(file, &doc, Slot::Exit, hash)?),
                Some("loop") => loops.push(parse_loop(file, &doc, hash)?),
                other => {
                    return Err(MotionError::ManifestInvalid(format!(
                        "{file}: unknown slot {other:?}"
                    )));
                }
            },
            Some("bcf") => bcf.push(parse_bcf(file, &doc, hash)?),
            other => {
                return Err(MotionError::ManifestInvalid(format!(
                    "{file}: unknown namespace {other:?}"
                )));
            }
        }
    }
    let mut transitions = Vec::new();
    for (file, source) in TRANSITION_SOURCES {
        let hash = fnv1a64(source.as_bytes());
        let doc: Value = serde_json::from_str(source)
            .map_err(|err| MotionError::ManifestInvalid(format!("{file}: {err}")))?;
        transitions.push(parse_transition(file, &doc, hash)?);
    }
    let mut caption_transitions = Vec::new();
    for (file, source) in CAPTION_TRANSITION_SOURCES {
        let hash = fnv1a64(source.as_bytes());
        let doc: Value = serde_json::from_str(source)
            .map_err(|err| MotionError::ManifestInvalid(format!("{file}: {err}")))?;
        caption_transitions.push(parse_caption_transition(file, &doc, hash)?);
    }
    caption_transitions.sort_by_key(|recipe| recipe.order);
    enter.sort_by_key(|recipe| recipe.order);
    exit.sort_by_key(|recipe| recipe.order);
    loops.sort_by_key(|recipe| recipe.order);
    bcf.sort_by_key(|preset| preset.order);
    transitions.sort_by_key(|recipe| recipe.order);

    let mut map = Map::new();
    for preset in &bcf {
        map.insert(preset.id.clone(), preset.definition.clone());
    }
    let mut manifests = Vec::new();
    for (file, source) in MANIFEST_SOURCES {
        let hash = fnv1a64(source.as_bytes());
        let doc: Value = serde_json::from_str(source)
            .map_err(|err| MotionError::ManifestInvalid(format!("{file}: {err}")))?;
        manifests.push(manifest::parse_manifest(file, &doc, hash)?);
    }
    manifests.sort_by(|a, b| a.id.cmp(&b.id));
    let mut aliases: Vec<(String, String)> = Vec::new();
    for entry in &manifests {
        if manifests.iter().filter(|m| m.id == entry.id).count() > 1 {
            return Err(MotionError::ManifestInvalid(format!(
                "duplicate manifest id \"{}\"",
                entry.id
            )));
        }
        for alias in &entry.aliases {
            if manifests.iter().any(|m| &m.id == alias) || bcf.iter().any(|p| &p.id == alias) {
                return Err(MotionError::ManifestInvalid(format!(
                    "alias \"{alias}\" collides with a canonical id"
                )));
            }
            if let Some((_, owner)) = aliases.iter().find(|(name, _)| name == alias) {
                return Err(MotionError::ManifestInvalid(format!(
                    "alias \"{alias}\" declared by both \"{owner}\" and \"{}\"",
                    entry.id
                )));
            }
            aliases.push((alias.clone(), entry.id.clone()));
        }
    }
    aliases.sort();
    // 目录型配方的独立循环（ADR-E05）：三份清单、三个循环、共用
    // `parse_catalogue` 骨架；结果不进 `manifests`，也不参与 alias 表。
    let shapes = build_catalogue(CatalogueKind::Shape, SHAPE_SOURCES)?;
    let stickers = build_catalogue(CatalogueKind::Sticker, STICKER_SOURCES)?;
    let visualizers = build_catalogue(CatalogueKind::Visualizer, VISUALIZER_SOURCES)?;
    let progresses = build_catalogue(CatalogueKind::Progress, PROGRESS_SOURCES)?;
    let confettis = build_catalogue(CatalogueKind::Confetti, CONFETTI_SOURCES)?;
    let text_presets = build_text_presets(textpreset::TextPresetTables {
        shapes: &shapes,
        enter: &enter,
        exit: &exit,
        loops: &loops,
    })?;
    Ok(RegistryData {
        manifests,
        aliases,
        enter,
        exit,
        loops,
        bcf,
        transitions,
        caption_transitions,
        shapes,
        stickers,
        visualizers,
        progresses,
        confettis,
        text_presets,
        bcf_map: Value::Object(map),
    })
}

/// 一份目录型清单 → 排好序、查过重的配方表。
fn build_catalogue(
    kind: CatalogueKind,
    sources: &[(&str, &str)],
) -> Result<Vec<CatalogueRecipe>, MotionError> {
    let mut out = Vec::with_capacity(sources.len());
    for (file, source) in sources {
        let hash = fnv1a64(source.as_bytes());
        let doc: Value = serde_json::from_str(source)
            .map_err(|err| MotionError::ManifestInvalid(format!("{file}: {err}")))?;
        out.push(catalogue::parse_catalogue(kind, file, &doc, hash)?);
    }
    out.sort_by_key(|recipe| recipe.order);
    if let Some(duplicate) = out
        .windows(2)
        .find(|pair| pair[0].order == pair[1].order || pair[0].id == pair[1].id)
    {
        return Err(MotionError::ManifestInvalid(format!(
            "duplicate {} recipe \"{}\" / \"{}\"",
            kind.dir(),
            duplicate[0].id,
            duplicate[1].id
        )));
    }
    Ok(out)
}

/// 文字预设清单 → 按 `order` 排好序、查过重的预设表。
///
/// 参照表（形状目录与三张动画表）是**参数**而不是查询面：这个函数跑在
/// `build()` 内部，那时 `data()` 的 `OnceLock` 还没初始化完，查一次就是重入，
/// 而 `get_or_init` 遇到重入是死锁不是报错。
fn build_text_presets(
    tables: textpreset::TextPresetTables<'_>,
) -> Result<Vec<TextPresetRecipe>, MotionError> {
    let mut out = Vec::with_capacity(TEXTPRESET_SOURCES.len());
    for (file, source) in TEXTPRESET_SOURCES {
        let hash = fnv1a64(source.as_bytes());
        let doc: Value = serde_json::from_str(source)
            .map_err(|err| MotionError::ManifestInvalid(format!("{file}: {err}")))?;
        out.push(textpreset::parse_text_preset(file, &doc, hash, tables)?);
    }
    out.sort_by_key(|recipe| recipe.order);
    if let Some(duplicate) = out
        .windows(2)
        .find(|pair| pair[0].order == pair[1].order || pair[0].id == pair[1].id)
    {
        return Err(MotionError::ManifestInvalid(format!(
            "duplicate textpreset \"{}\" / \"{}\"",
            duplicate[0].id, duplicate[1].id
        )));
    }
    Ok(out)
}

// ── 查询面 ───────────────────────────────────────────────────────────

pub fn timeline_enter(id: &str) -> Option<&'static SlotRecipe> {
    data().enter.iter().find(|recipe| recipe.id == id)
}

pub fn timeline_exit(id: &str) -> Option<&'static SlotRecipe> {
    data().exit.iter().find(|recipe| recipe.id == id)
}

pub fn timeline_loop(id: &str) -> Option<&'static LoopRecipe> {
    data().loops.iter().find(|recipe| recipe.id == id)
}

pub fn bcf_preset(name: &str) -> Option<&'static BcfPreset> {
    data().bcf.iter().find(|preset| preset.id == name)
}

/// `{params?, keyframes}` 定义体，供 `Resolver::expand_preset_def` 消费。
pub fn bcf_builtin(name: &str) -> Option<&'static Value> {
    bcf_preset(name).map(|preset| &preset.definition)
}

/// 与 `resolve.rs::BUILTIN_PRESETS` 解析结果逐字相同的 `Value::Object`。
pub fn bcf_builtin_map() -> &'static Value {
    &data().bcf_map
}

/// 替代 `resolve.rs:709` 的 `name == "countUp"` 硬编码。
pub fn emits_params_meta(name: &str) -> bool {
    bcf_preset(name).is_some_and(|preset| preset.emits_params_meta)
}

pub fn bcf_transition(name: &str) -> Option<&'static TransitionRecipe> {
    data().transitions.iter().find(|recipe| recipe.id == name)
}

/// 字幕入场姿态配方。**按持久化里那个历史 id 查**（`magic-fade` …）——
/// 字幕样式存的就是它，配方 id `transition.caption.fade` 是收编后的规范名。
pub fn caption_transition(legacy_id: &str) -> Option<&'static CaptionTransitionRecipe> {
    data()
        .caption_transitions
        .iter()
        .find(|recipe| recipe.legacy_id == legacy_id)
}

/// 全部字幕入场姿态配方（目录顺序）。
pub fn caption_transitions() -> &'static [CaptionTransitionRecipe] {
    &data().caption_transitions
}

/// UI 目录顺序（数据，不是文件名排序）。
pub fn ids(domain: Domain) -> Vec<&'static str> {
    match domain {
        Domain::TimelineEnter => data().enter.iter().map(|r| r.id.as_str()).collect(),
        Domain::TimelineExit => data().exit.iter().map(|r| r.id.as_str()).collect(),
        Domain::TimelineLoop => data().loops.iter().map(|r| r.id.as_str()).collect(),
        Domain::BcfMotion => data().bcf.iter().map(|r| r.id.as_str()).collect(),
        Domain::BcfTransition => data().transitions.iter().map(|r| r.id.as_str()).collect(),
        Domain::TimelineShape => data().shapes.iter().map(|r| r.id.as_str()).collect(),
        Domain::TimelineSticker => data().stickers.iter().map(|r| r.id.as_str()).collect(),
        Domain::TimelineVisualizer => data().visualizers.iter().map(|r| r.id.as_str()).collect(),
        Domain::TimelineProgress => data().progresses.iter().map(|r| r.id.as_str()).collect(),
        Domain::TimelineConfetti => data().confettis.iter().map(|r| r.id.as_str()).collect(),
        Domain::TextPreset => data().text_presets.iter().map(|r| r.id.as_str()).collect(),
    }
}

/// Timeline `shape` 元素的形状配方。查询键就是 `timeline.json` 里
/// `shape.shape` 的面值（`rect` / `ellipse` / `line` / `arrow`）。
pub fn timeline_shape(id: &str) -> Option<&'static CatalogueRecipe> {
    data().shapes.iter().find(|recipe| recipe.id == id)
}

/// 属性面板可选到的形状（`available: true`，目录顺序）。
pub fn timeline_shapes() -> &'static [CatalogueRecipe] {
    &data().shapes
}

/// Timeline `sticker` 元素的模板配方。查询键是 `sticker.templateId` 的面值
/// （`heart` / `badge_check` / …，设计 §10 P7）。
pub fn timeline_sticker(id: &str) -> Option<&'static CatalogueRecipe> {
    data().stickers.iter().find(|recipe| recipe.id == id)
}

/// 全部模板贴纸（目录顺序）——贴纸选择器的数据源。
pub fn timeline_stickers() -> &'static [CatalogueRecipe] {
    &data().stickers
}

/// Timeline `visualizer` 元素的样式配方。查询键是 `visualizer.style` 的面值
/// （`bars` / `ribbons` / …，设计 §7.3）；旧目录的 id 经
/// [`canonical_visualizer_style`] 折到新款，老项目不会因此丢元素。
pub fn timeline_visualizer(id: &str) -> Option<&'static CatalogueRecipe> {
    let id = canonical_visualizer_style(id);
    data().visualizers.iter().find(|recipe| recipe.id == id)
}

/// 把旧目录的声波 style id 折到当前目录的等价款；当前目录的 id 与未知 id
/// 原样返回（未知 id 交给 [`timeline_visualizer`] 返回 `None`）。
pub fn canonical_visualizer_style(id: &str) -> &str {
    VISUALIZER_STYLE_ALIASES
        .iter()
        .find(|(old, _)| *old == id)
        .map_or(id, |(_, new)| new)
}

/// 全部 10 种 sound wave（目录顺序）。
pub fn timeline_visualizers() -> &'static [CatalogueRecipe] {
    &data().visualizers
}

/// Timeline `progress` 元素的样式配方（设计 §7.4）。
pub fn timeline_progress(id: &str) -> Option<&'static CatalogueRecipe> {
    data().progresses.iter().find(|recipe| recipe.id == id)
}

/// 全部 14 种进度条（目录顺序）。
pub fn timeline_progresses() -> &'static [CatalogueRecipe] {
    &data().progresses
}

/// Timeline `confetti` 元素的款式配方（彩纸设计稿 §4）。查询键是
/// `confetti.style` 的面值（`rainbow-paper` / `party-cannons` / …）。
pub fn timeline_confetti(id: &str) -> Option<&'static CatalogueRecipe> {
    data().confettis.iter().find(|recipe| recipe.id == id)
}

/// 全部 10 款彩纸（目录顺序）——「彩纸」磁贴格的数据源。
pub fn timeline_confettis() -> &'static [CatalogueRecipe] {
    &data().confettis
}

/// 只解析一类目录型配方，不建整张注册表：调用方只引用这一类的清单，别的内置配方就不会链接进它的产物
/// （界面的编辑语义 WASM 只要声波、进度条与彩纸的目录）。解析与 [`timeline_visualizers`] 等查询面是同一份，
/// 每次调用都重新解析，调用方自己缓存。
pub fn parse_builtin_catalogue(kind: CatalogueKind) -> Result<Vec<CatalogueRecipe>, MotionError> {
    let sources = match kind {
        CatalogueKind::Shape => SHAPE_SOURCES,
        CatalogueKind::Sticker => STICKER_SOURCES,
        CatalogueKind::Visualizer => VISUALIZER_SOURCES,
        CatalogueKind::Progress => PROGRESS_SOURCES,
        CatalogueKind::Confetti => CONFETTI_SOURCES,
    };
    build_catalogue(kind, sources)
}

/// 声波旧 style id → 当前目录的等价款（[`canonical_visualizer_style`] 查的那张表）。
pub fn visualizer_style_aliases() -> &'static [(&'static str, &'static str)] {
    VISUALIZER_STYLE_ALIASES
}

/// 一条文字预设（§6.2）。查询键是预设 id（`lowerThird.07`），也是文件名。
pub fn text_preset(id: &str) -> Option<&'static TextPresetRecipe> {
    data().text_presets.iter().find(|recipe| recipe.id == id)
}

/// 全部文字预设（`order` 升序）——Text 面板预设库的数据源。
pub fn text_presets() -> &'static [TextPresetRecipe] {
    &data().text_presets
}

/// 通用 manifest 查询（设计 §5.4.1）。
pub fn manifest(id: &str) -> Option<&'static PresetManifest> {
    data().manifests.iter().find(|m| m.id == id)
}

/// alias → canonical id；不是 alias 时原样返回。
pub fn canonical_id<'a>(id: &'a str) -> &'a str {
    match data().aliases.iter().find(|(alias, _)| alias == id) {
        Some((_, canonical)) => canonical.as_str(),
        None => id,
    }
}

/// 通用 manifest 的全部 canonical id（升序）。
pub fn manifest_ids() -> Vec<&'static str> {
    data().manifests.iter().map(|m| m.id.as_str()).collect()
}

/// 全部 alias（升序），`(alias, canonical)`。
pub fn aliases() -> Vec<(&'static str, &'static str)> {
    data()
        .aliases
        .iter()
        .map(|(a, c)| (a.as_str(), c.as_str()))
        .collect()
}

/// 去重后的**元素** UI 家族（不含内部积木的 `family: null`，也不含 part 家族）。
pub fn families() -> Vec<&'static str> {
    families_of(AppliesTo::Element)
}

/// 去重后的**文字 part** 家族（规范 §7.9）。
pub fn part_families() -> Vec<&'static str> {
    families_of(AppliesTo::Part)
}

fn families_of(scope: AppliesTo) -> Vec<&'static str> {
    let mut out: Vec<&'static str> = Vec::new();
    for entry in &data().manifests {
        if entry.applies_to != scope {
            continue;
        }
        if let Some(family) = entry.family.as_deref() {
            if !out.contains(&family) {
                out.push(family);
            }
        }
    }
    out.sort_unstable();
    out
}

/// 配方作用域（`appliesTo`）。未知 id 返回 `None`。
pub fn applies_to(id: &str) -> Option<AppliesTo> {
    manifest(canonical_id(id)).map(|entry| entry.applies_to)
}

/// preset id → 家族（`preset-sprawl` 的归一口径）。未知 id 返回 `None`。
pub fn family_of(id: &str) -> Option<&'static str> {
    manifest(canonical_id(id)).and_then(|m| m.family.as_deref())
}

/// `include_str!` 清单里的文件名（不含扩展名），目录一致性测试用。
pub fn registered_files(domain_dir: &str) -> Vec<&'static str> {
    match domain_dir {
        "motion" => MOTION_SOURCES
            .iter()
            .chain(MANIFEST_SOURCES.iter())
            .map(|(file, _)| *file)
            .collect(),
        "transition" => TRANSITION_SOURCES
            .iter()
            .chain(CAPTION_TRANSITION_SOURCES.iter())
            .map(|(file, _)| *file)
            .collect(),
        "shape" => SHAPE_SOURCES.iter().map(|(file, _)| *file).collect(),
        "sticker" => STICKER_SOURCES.iter().map(|(file, _)| *file).collect(),
        "visualizer" => VISUALIZER_SOURCES.iter().map(|(file, _)| *file).collect(),
        "progress" => PROGRESS_SOURCES.iter().map(|(file, _)| *file).collect(),
        "confetti" => CONFETTI_SOURCES.iter().map(|(file, _)| *file).collect(),
        "textpreset" => TEXTPRESET_SOURCES.iter().map(|(file, _)| *file).collect(),
        _ => Vec::new(),
    }
}

/// 强制解析全部 manifest；解析错误在这里暴露而不是在第一次采样时 panic。
pub fn validate_all() -> Result<(), MotionError> {
    build().map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::curve::{CurveSpec, EaseId};
    use crate::loop_kernel::{NoiseKind, WaveKind};
    use crate::preset_registry::frozen::{parse_loop, parse_transition};
    use crate::relative_value::LengthBasis;
    use crate::text_parts::PartUnit;

    #[test]
    fn one_catalogue_parses_the_same_as_the_full_registry() {
        let kinds = [
            (CatalogueKind::Shape, timeline_shapes()),
            (CatalogueKind::Sticker, timeline_stickers()),
            (CatalogueKind::Visualizer, timeline_visualizers()),
            (CatalogueKind::Progress, timeline_progresses()),
            (CatalogueKind::Confetti, timeline_confettis()),
        ];
        for (kind, registry) in kinds {
            assert_eq!(
                parse_builtin_catalogue(kind).unwrap(),
                registry,
                "{}",
                kind.dir()
            );
        }
        assert!(visualizer_style_aliases().contains(&("beam", "oscilloscope")));
    }

    #[test]
    fn catalogue_is_frozen_at_fifty_three_enter_forty_nine_exit_twenty_loop() {
        // 文字目录 25/21/11（2026-09-05 冻结）+ 元素目录 28/28/9（2026-09-08，
        // `surface: "element"`，走多关键帧形态）。
        assert_eq!(ids(Domain::TimelineEnter).len(), 53);
        assert_eq!(ids(Domain::TimelineExit).len(), 49);
        assert_eq!(ids(Domain::TimelineLoop).len(), 20);
        let element = |domain| {
            ids(domain)
                .into_iter()
                .filter(|id| id.starts_with("el"))
                .count()
        };
        assert_eq!(element(Domain::TimelineEnter), 28);
        assert_eq!(element(Domain::TimelineExit), 28);
        assert_eq!(element(Domain::TimelineLoop), 9);
        assert_eq!(ids(Domain::BcfMotion).len(), 5);
        assert_eq!(ids(Domain::BcfTransition).len(), 10);
    }

    #[test]
    fn enter_order_matches_the_timeline_schema_enum() {
        assert_eq!(
            ids(Domain::TimelineEnter),
            vec![
                // 第 156 轮起 slide 四向在 `order` 上连续（方向族成员必须相邻，
                // 否则 `anim_direction::families` 的展平与注册表不一致）；其余
                // 新配方追加在尾部。schema 枚举只管成员资格，不管顺序。
                "none",
                "fade",
                "rise",
                "drop",
                "slideL",
                "slideR",
                "slideUp",
                "slideDown",
                "pop",
                "zoomIn",
                "zoomOut",
                "spin",
                "blurIn",
                "typewriter",
                "riseWords",
                "wipe",
                "compress",
                "bounce",
                "fall",
                "skid",
                "roll",
                "wave",
                "flipboard",
                "dragonfly",
                "billboard",
                "elFade",
                "elFloatL",
                "elFloatR",
                "elFloatUp",
                "elFloatDown",
                "elZoom",
                "elKenBurns",
                "elDrop",
                "elSlideL",
                "elSlideR",
                "elSlideUp",
                "elSlideDown",
                "elWipeL",
                "elWipeR",
                "elWipeUp",
                "elWipeDown",
                "elPop",
                "elBounce",
                "elSpinCw",
                "elSpinCcw",
                "elSlideBounceL",
                "elSlideBounceR",
                "elSlideBounceUp",
                "elSlideBounceDown",
                "elGentleFloatL",
                "elGentleFloatR",
                "elGentleFloatUp",
                "elGentleFloatDown",
            ]
        );
        assert_eq!(
            ids(Domain::TimelineLoop),
            vec![
                "float",
                "pulse",
                "sway",
                "jitter",
                "blink",
                "rotate",
                "heartBeat",
                "vogue",
                "dragonfly",
                "billboard",
                "roll",
                "elSpin",
                "elSpinSmooth",
                "elSpin3d",
                "elBounce",
                "elHeartbeat",
                "elSway",
                "elSway3d",
                "elSqueezy",
                "elJiggle",
            ]
        );
    }

    #[test]
    fn enter_and_exit_tables_stay_asymmetric() {
        // exit 表接受 sink/shrink，两者没有同名入场；反过来
        // pop/blurIn/typewriter/riseWords 没有 exit 配方（`drop` 自
        // 第 156 轮起有同名出场 = 设计稿 stomp 的出场，enter drop 镜像改指它）。
        // `bounce` 自己不做出场配方——倒放的弹跳（先弹再飞走）没有设计稿
        // 条目——但镜像指向 `rise`：App 律 6 要求每条入场都能派生「跟随入场」
        // 的退场，配对与 drop→rise 相同（从上方进场、向上离场）。
        assert!(timeline_exit("sink").is_some());
        assert!(timeline_exit("shrink").is_some());
        assert!(timeline_enter("sink").is_none());
        for id in ["pop", "blurIn", "typewriter", "riseWords", "bounce"] {
            assert!(timeline_exit(id).is_none(), "{id} must have no exit recipe");
        }
        assert_eq!(
            timeline_enter("bounce").unwrap().mirror.as_deref(),
            Some("rise")
        );
        assert_eq!(
            timeline_enter("drop").unwrap().mirror.as_deref(),
            Some("drop")
        );
        // slide 四向：入场「从哪一侧来」与出场「往哪一侧去」同名配对。
        for id in ["slideL", "slideR", "slideUp", "slideDown"] {
            assert_eq!(timeline_enter(id).unwrap().mirror.as_deref(), Some(id));
        }
        assert!(timeline_enter("slideUp").unwrap().from.dy.unwrap() < 0.0);
        assert!(timeline_exit("slideUp").unwrap().from.dy.unwrap() < 0.0);
        assert!(timeline_enter("slideDown").unwrap().from.dy.unwrap() > 0.0);
        assert!(timeline_exit("slideDown").unwrap().from.dy.unwrap() > 0.0);
    }

    #[test]
    fn every_mirror_resolves_to_an_exit_recipe() {
        for id in ids(Domain::TimelineEnter) {
            let recipe = timeline_enter(id).unwrap();
            if let Some(mirror) = &recipe.mirror {
                assert!(
                    timeline_exit(mirror).is_some(),
                    "{id} mirrors missing exit {mirror}"
                );
            }
        }
    }

    #[test]
    fn one_over_twenty_four_survives_json_bit_for_bit() {
        let plan = timeline_enter("typewriter").unwrap().parts.unwrap();
        assert_eq!(plan.stagger.to_bits(), (1.0f64 / 24.0).to_bits());
        assert_eq!(plan.part_dur.to_bits(), 0.04f64.to_bits());
        assert_eq!(plan.unit, PartUnit::Char);
    }

    #[test]
    fn timeline_numbers_match_the_old_hardcoded_tables_bit_for_bit() {
        // 旧表（`bcut-timeline/src/motion.rs:154-391`、`:905-941`）逐行对照。
        let enter_expect: &[(&str, f64, Option<&str>)] = &[
            ("none", 0.0, None),
            ("fade", 0.40, Some("fade")),
            ("rise", 0.50, Some("sink")),
            ("drop", 0.50, Some("drop")),
            ("slideL", 0.50, Some("slideL")),
            ("slideR", 0.50, Some("slideR")),
            ("pop", 0.45, Some("shrink")),
            ("zoomIn", 0.50, Some("zoomIn")),
            ("zoomOut", 0.50, Some("zoomOut")),
            ("spin", 0.55, Some("spin")),
            ("blurIn", 0.55, Some("fade")),
            ("typewriter", 0.60, Some("fade")),
            ("riseWords", 0.90, Some("sink")),
            ("wipe", 0.45, Some("wipe")),
            // 第 156 轮新配方与镜像。
            ("slideUp", 0.5, Some("slideUp")),
            ("slideDown", 0.5, Some("slideDown")),
            ("wave", 0.6, Some("sink")),
            ("flipboard", 0.5, Some("flipboard")),
            ("dragonfly", 0.6, Some("dragonfly")),
            ("billboard", 0.5, Some("billboard")),
        ];
        for (id, duration, mirror) in enter_expect {
            let recipe = timeline_enter(id).unwrap();
            assert_eq!(recipe.duration.to_bits(), duration.to_bits(), "{id}");
            assert_eq!(recipe.mirror.as_deref(), *mirror, "{id}");
            assert_eq!(recipe.version, 1);
        }
        assert_eq!(timeline_enter("rise").unwrap().from.dy, Some(0.033));
        assert_eq!(timeline_enter("drop").unwrap().from.dy, Some(-0.033));
        assert_eq!(timeline_enter("slideL").unwrap().from.dx, Some(-0.05));
        assert_eq!(timeline_enter("slideR").unwrap().from.dx, Some(0.05));
        assert_eq!(timeline_enter("blurIn").unwrap().from.blur, Some(8.0));
        assert_eq!(timeline_enter("wipe").unwrap().from.reveal, Some(0.0));
        assert_eq!(timeline_enter("wipe").unwrap().from.opacity, None);
        assert_eq!(timeline_enter("riseWords").unwrap().from.dy, Some(0.026));
        assert_eq!(timeline_enter("spin").unwrap().from.rotation, Some(-12.0));
        assert_eq!(
            timeline_enter("pop").unwrap().curve,
            CurveSpec::Spring {
                response: 0.5,
                damping: 0.82
            }
        );
        assert_eq!(
            timeline_enter("pop").unwrap().opacity_curve,
            Some(CurveSpec::Named(EaseId::EaseOutExpo))
        );
        assert_eq!(
            timeline_enter("spin").unwrap().opacity_curve,
            Some(CurveSpec::Named(EaseId::EaseOutCubic))
        );

        let exit_expect: &[(&str, f64)] = &[
            ("none", 0.0),
            ("fade", 0.30),
            ("sink", 0.375),
            ("rise", 0.375),
            ("slideL", 0.375),
            ("slideR", 0.375),
            ("shrink", 0.34),
            ("zoomIn", 0.375),
            ("zoomOut", 0.375),
            ("spin", 0.41),
            ("wipe", 0.34),
        ];
        for (id, duration) in exit_expect {
            let recipe = timeline_exit(id).unwrap();
            assert_eq!(recipe.duration.to_bits(), duration.to_bits(), "{id}");
            assert!(recipe.mirror.is_none(), "{id}");
        }
        assert_eq!(timeline_exit("sink").unwrap().from.dy, Some(0.028));
        assert_eq!(timeline_exit("rise").unwrap().from.dy, Some(-0.028));
        assert_eq!(timeline_exit("slideL").unwrap().from.dx, Some(-0.042));
        assert_eq!(timeline_exit("slideR").unwrap().from.dx, Some(0.042));
        assert_eq!(timeline_exit("shrink").unwrap().from.scale_x, Some(0.60));
        assert_eq!(timeline_exit("spin").unwrap().from.rotation, Some(12.0));
        assert_eq!(
            timeline_exit("spin").unwrap().opacity_curve,
            Some(CurveSpec::Named(EaseId::EaseInCubic))
        );

        let loop_expect: &[(&str, f64, WaveKind)] = &[
            ("float", 2.4, WaveKind::Sine),
            ("pulse", 2.0, WaveKind::Sine),
            ("sway", 2.8, WaveKind::Sine),
            ("jitter", 0.6, WaveKind::Noise),
            ("blink", 1.2, WaveKind::Dip),
            ("rotate", 2.0, WaveKind::Ramp),
            ("heartBeat", 2.0, WaveKind::Heartbeat),
            ("vogue", 2.4, WaveKind::Sine),
            ("dragonfly", 1.6, WaveKind::Sine),
            ("billboard", 2.0, WaveKind::Dip),
            ("roll", 2.0, WaveKind::Sine),
        ];
        for (id, period, wave) in loop_expect {
            let recipe = timeline_loop(id).unwrap();
            assert_eq!(recipe.period.to_bits(), period.to_bits(), "{id}");
            assert_eq!(recipe.wave, *wave, "{id}");
            assert_eq!(recipe.wave_samples, 32, "{id}");
            assert_eq!(recipe.channel_seed_stride, 101, "{id}");
            assert_eq!(recipe.default_seed, 17, "{id}");
        }
        assert_eq!(timeline_loop("float").unwrap().amplitudes.dy, Some(0.0055));
        assert_eq!(
            timeline_loop("pulse").unwrap().amplitudes.scale_x,
            Some(0.012)
        );
        assert_eq!(
            timeline_loop("sway").unwrap().amplitudes.rotation,
            Some(0.6)
        );
        assert_eq!(timeline_loop("jitter").unwrap().amplitudes.dx, Some(0.0035));
        assert_eq!(
            timeline_loop("blink").unwrap().amplitudes.opacity,
            Some(0.35)
        );
        let noise = timeline_loop("jitter").unwrap().noise.unwrap();
        assert_eq!(noise.kind, NoiseKind::LatticeMurmurV1);
        assert_eq!(noise.lattice, 8);
        assert_eq!(noise.default_seed, 17);
    }

    #[test]
    fn builtin_map_equals_the_old_resolve_literal() {
        // `bcut-core/src/resolve.rs:425-438` 的字符串常量副本。提取无损性由这条
        // 测试证明；发布一版后可以删掉字面量。
        const OLD_BUILTIN_PRESETS: &str = r#"{
  "fadeIn":  { "keyframes": [ { "prop": "opacity", "frames": [ { "t": "0%", "v": 0 }, { "t": "100%", "v": 1 } ] } ] },
  "fadeOut": { "keyframes": [ { "prop": "opacity", "frames": [ { "t": "0%", "v": 1 }, { "t": "100%", "v": 0 } ] } ] },
  "countUp": { "params": { "to": { "default": 1 }, "prefix": { "default": "" }, "suffix": { "default": "" }, "decimals": { "default": 0 } },
    "keyframes": [ { "prop": "textCount", "frames": [ { "t": "0%", "v": 0 }, { "t": "100%", "v": "{to}", "ease": "easeOutCubic" } ] } ] },
  "barFill": { "params": { "to": { "default": 1 } },
    "keyframes": [ { "prop": "scaleY", "frames": [ { "t": "0%", "v": 0 }, { "t": "100%", "v": "{to}", "ease": "easeOutQuart" } ] } ] },
  "kenBurns": { "params": { "fromZoom": { "default": 1 }, "toZoom": { "default": 1.1 },
                            "fromX": { "default": 0 }, "toX": { "default": 0 },
                            "fromY": { "default": 0 }, "toY": { "default": 0 } },
    "keyframes": [ { "prop": "cam", "frames": [
      { "t": "0%",   "v": { "x": "{fromX}", "y": "{fromY}", "zoom": "{fromZoom}" } },
      { "t": "100%", "v": { "x": "{toX}",   "y": "{toY}",   "zoom": "{toZoom}" }, "ease": "easeInOutSine" } ] } ] }
}"#;
        let old: Value = serde_json::from_str(OLD_BUILTIN_PRESETS).unwrap();
        assert_eq!(&old, bcf_builtin_map());
        assert!(emits_params_meta("countUp"));
        assert!(!emits_params_meta("fadeIn"));
        assert!(!emits_params_meta("notAPreset"));
    }

    #[test]
    fn transition_recipes_match_the_old_match_arms() {
        assert!(bcf_transition("cut").unwrap().prop.is_none());
        assert!(bcf_transition("cut").unwrap().is_cut());
        let crossfade = bcf_transition("crossfade").unwrap();
        assert_eq!(crossfade.prop.as_deref(), Some("opacity"));
        assert_eq!(crossfade.ease.as_deref(), Some("easeInOutSine"));
        assert_eq!(crossfade.out[0].prop, "opacity");
        assert_eq!(crossfade.out[0].ease.as_deref(), Some("easeInOutSine"));
        assert_eq!(crossfade.out[0].from.value, 1.0);
        assert_eq!(crossfade.out[0].to.value, 0.0);
        assert_eq!(crossfade.r#in[0].from.value, 0.0);
        assert_eq!(crossfade.r#in[0].to.value, 1.0);

        let left = bcf_transition("slideLeft").unwrap();
        assert_eq!(left.prop.as_deref(), Some("x"));
        assert_eq!(left.out[0].to.basis, LengthBasis::CanvasWidth);
        assert_eq!(left.out[0].to.value, -1.0);
        assert_eq!(left.r#in[0].from.value, 1.0);

        let up = bcf_transition("slideUp").unwrap();
        assert_eq!(up.prop.as_deref(), Some("y"));
        assert_eq!(up.out[0].to.basis, LengthBasis::CanvasHeight);
        assert_eq!(up.out[0].to.value, -1.0);
        assert_eq!(up.r#in[0].from.value, 1.0);

        let down = bcf_transition("slideDown").unwrap();
        assert_eq!(down.out[0].to.value, 1.0);
        assert_eq!(down.r#in[0].from.value, -1.0);
        assert!(bcf_transition("nope").is_none());
    }

    /// 阶段 5 补齐的规范 §9 词汇：两侧 `prop` 不同（wipe）、一侧多条通道
    /// （zoomThrough / whipPan）都必须解析成通道表。
    #[test]
    fn the_spec_section_nine_vocabulary_is_complete() {
        assert_eq!(
            ids(Domain::BcfTransition),
            [
                "cut",
                "crossfade",
                "slideLeft",
                "slideRight",
                "slideUp",
                "slideDown",
                "wipeLeft",
                "wipeRight",
                "zoomThrough",
                "whipPan",
            ]
        );

        // wipe：同一条边，两侧裁不同的一半。
        let left = bcf_transition("wipeLeft").unwrap();
        assert!(left.prop.is_none());
        assert_eq!(left.out[0].prop, "clipInsetRight");
        assert_eq!((left.out[0].from.value, left.out[0].to.value), (0.0, 1.0));
        assert_eq!(left.r#in[0].prop, "clipInsetLeft");
        assert_eq!((left.r#in[0].from.value, left.r#in[0].to.value), (1.0, 0.0));
        let right = bcf_transition("wipeRight").unwrap();
        assert_eq!(right.out[0].prop, "clipInsetLeft");
        assert_eq!(right.r#in[0].prop, "clipInsetRight");
        // 每条通道都继承了配方的默认 ease。
        for recipe in [left, right] {
            for channel in recipe.out.iter().chain(recipe.r#in.iter()) {
                assert_eq!(channel.ease.as_deref(), Some("easeInOutSine"));
            }
        }

        // zoomThrough / whipPan：一侧两条通道，各带自己的 ease。
        let zoom = bcf_transition("zoomThrough").unwrap();
        assert_eq!(
            zoom.out.iter().map(|c| c.prop.as_str()).collect::<Vec<_>>(),
            ["scale", "opacity"]
        );
        assert_eq!(zoom.out[0].to.value, 2.5);
        assert_eq!(zoom.out[0].ease.as_deref(), Some("easeInCubic"));
        assert_eq!(zoom.r#in[0].from.value, 0.5);
        assert_eq!(zoom.r#in[0].ease.as_deref(), Some("easeOutCubic"));

        let whip = bcf_transition("whipPan").unwrap();
        assert_eq!(
            whip.out.iter().map(|c| c.prop.as_str()).collect::<Vec<_>>(),
            ["x", "opacity"]
        );
        // 出方甩向左、入方从右边刹停回来——方向必须相反，否则两张画面会叠着走。
        assert_eq!(whip.out[0].to.value, -1.2);
        assert_eq!(whip.out[0].to.basis, LengthBasis::CanvasWidth);
        assert_eq!(whip.r#in[0].from.value, 1.2);
        assert_eq!(whip.r#in[0].from.basis, LengthBasis::CanvasWidth);
    }

    #[test]
    fn manifest_hashes_are_stable_and_distinct() {
        let a = timeline_enter("fade").unwrap().manifest_hash;
        let b = timeline_enter("rise").unwrap().manifest_hash;
        assert_ne!(a, b);
        assert_eq!(a, timeline_enter("fade").unwrap().manifest_hash);
    }

    #[test]
    fn unknown_kernel_names_are_rejected_at_parse_time() {
        let bad = serde_json::json!({
            "id": "bad", "version": 1, "domain": "motion", "namespace": "timeline",
            "slot": "loop", "order": 0, "period": 1.0,
            "amplitudes": {"dy": 0.01},
            "wave": {"kind": "noise", "samples": 32, "noise": {"kind": "perlin", "lattice": 8}},
            "channelSeedStride": 101, "defaultSeed": 17,
            "envelope": {"kind": "idle-ramp-v1", "rampCap": 0.3, "rampFraction": 0.15,
                         "tailThresholdSec": 6.0, "tailStart": 0.8, "tailSpan": 0.2},
            "determinism": "strict"
        });
        assert!(matches!(
            parse_loop("bad.json", &bad, 0),
            Err(MotionError::ManifestInvalid(_))
        ));

        let bad_envelope = serde_json::json!({
            "id": "bad", "version": 1, "domain": "motion", "namespace": "timeline",
            "slot": "loop", "order": 0, "period": 1.0,
            "amplitudes": {"dy": 0.01},
            "wave": {"kind": "sine", "samples": 32},
            "channelSeedStride": 101, "defaultSeed": 17,
            "envelope": {"kind": "linear-fade", "rampCap": 0.3, "rampFraction": 0.15,
                         "tailThresholdSec": 6.0, "tailStart": 0.8, "tailSpan": 0.2},
            "determinism": "strict"
        });
        assert!(matches!(
            parse_loop("bad.json", &bad_envelope, 0),
            Err(MotionError::ManifestInvalid(_))
        ));
    }

    /// 通道表的解析纪律：空数组、缺 `prop`、`channels` 不是数组都必须报错，
    /// 而不是静默产出零通道（零通道 = `cut`，那是另一个意思）。
    #[test]
    fn transition_channel_tables_are_parsed_strictly() {
        let base = serde_json::json!({
            "id": "x", "version": 1, "order": 0,
            "out": { "channels": [] }
        });
        assert!(matches!(
            parse_transition("bad.json", &base, 0),
            Err(MotionError::ManifestInvalid(_))
        ));

        let no_prop = serde_json::json!({
            "id": "x", "version": 1, "order": 0,
            "out": { "channels": [{ "from": {"value": 0, "basis": "absolute"},
                                    "to": {"value": 1, "basis": "absolute"} }] }
        });
        assert!(matches!(
            parse_transition("bad.json", &no_prop, 0),
            Err(MotionError::ManifestInvalid(_))
        ));

        let not_array = serde_json::json!({
            "id": "x", "version": 1, "order": 0, "out": { "channels": 3 }
        });
        assert!(matches!(
            parse_transition("bad.json", &not_array, 0),
            Err(MotionError::ManifestInvalid(_))
        ));

        // 单通道糖与通道表解析成同一个结构。
        let sugar = serde_json::json!({
            "id": "x", "version": 1, "order": 0, "prop": "opacity", "ease": "linear",
            "out": { "from": {"value": 1, "basis": "absolute"},
                     "to": {"value": 0, "basis": "absolute"} }
        });
        let table = serde_json::json!({
            "id": "x", "version": 1, "order": 0,
            "out": { "channels": [{ "prop": "opacity", "ease": "linear",
                                    "from": {"value": 1, "basis": "absolute"},
                                    "to": {"value": 0, "basis": "absolute"} }] }
        });
        assert_eq!(
            parse_transition("a.json", &sugar, 0).unwrap().out,
            parse_transition("b.json", &table, 0).unwrap().out
        );
    }

    #[test]
    fn all_manifests_parse() {
        validate_all().unwrap();
        // 127 份冻结形状（timeline 文字 57 + 元素 65 + bcf 5）+ 34 份通用 manifest。
        assert_eq!(registered_files("motion").len(), 161);
        assert_eq!(MANIFEST_SOURCES.len(), 34);
        assert_eq!(registered_files("transition").len(), 13);
        // P7a：23 种基础形状 + BaoCut 自有的 `line`（见 SHAPE_SOURCES）。
        assert_eq!(registered_files("shape").len(), 24);
        assert_eq!(registered_files("visualizer").len(), 10);
        assert_eq!(registered_files("progress").len(), 14);
        // P7b：模板贴纸首批 10 份（见 `STICKER_SOURCES`）。
        assert_eq!(registered_files("sticker").len(), 10);
        // 彩纸十款（见 `CONFETTI_SOURCES`）。
        assert_eq!(registered_files("confetti").len(), 10);
        // 未知目录仍返回空——`registered_files` 是硬编码 match，忘了补臂就静默
        // 漏检，所以 `tests/manifests.rs` 的目录循环必须同步扩。哨兵用 `filter`：
        // 它是 effect 注册表的目录（`tests/effects.rs` 管），preset 这边永远不认。
        assert!(registered_files("filter").is_empty());
    }

    // ── 目录型配方（ADR-E05）─────────────────────────────────────────

    #[test]
    fn the_shape_catalogue_is_a_third_recipe_shape_not_a_manifest() {
        // 数据不进 `manifests` 向量：三条阶段 2 守卫因此不受影响。
        for id in ids(Domain::TimelineShape) {
            assert!(manifest(id).is_none(), "{id} 不该出现在通用 manifest 里");
            assert!(!manifest_ids().contains(&id), "{id}");
            assert_eq!(canonical_id(id), id, "{id} 不该有 alias");
            assert!(family_of(id).is_none(), "{id} 不该占 family 预算");
        }
        // 面板顺序 = 固定网格序，`line` 与线段版 `arrow` 占箭头槽位。
        // **不是**文件名排序，也不是清单书写序。
        assert_eq!(
            ids(Domain::TimelineShape),
            vec![
                "rect", "ellipse", "triangle", "rombus", "pentagon", "hex", "octagon", "squig",
                "squig2", "line", "arrow", "tick", "tick2", "chevron", "chevron2", "cross2",
                "cross", "love2", "love", "diamond", "star", "sharp", "star2", "sharp2"
            ],
            "目录顺序来自 order 字段，不是文件名排序"
        );
    }

    /// §10 P7 的验收判据：**23 种基础形状的名字一个不少**，
    /// 而且每一个都真的能查到配方。`line` 是 BaoCut 自有的第 24 份，单列断言，
    /// 免得"少一个基础形状但多一个自有形状"在总数上互相抵消。
    #[test]
    fn the_shape_catalogue_covers_every_base_shape_name() {
        const BASE_SHAPE_NAMES: [&str; 23] = [
            "rect", "ellipse", "triangle", "rombus", "pentagon", "hex", "octagon", "squig",
            "squig2", "arrow", "tick", "tick2", "chevron", "chevron2", "cross", "cross2", "love",
            "love2", "diamond", "star", "star2", "sharp", "sharp2",
        ];
        for name in BASE_SHAPE_NAMES {
            let recipe = timeline_shape(name).unwrap_or_else(|| panic!("缺形状 {name}"));
            assert!(recipe.available, "{name} 应可选");
            assert_eq!(recipe.qualified_id(), format!("shape.{name}"));
        }
        assert!(
            timeline_shape("line").is_some(),
            "BaoCut 自有的 line 不该被删"
        );
        assert_eq!(timeline_shapes().len(), BASE_SHAPE_NAMES.len() + 1);

        // 21 份 path 形状全部落在 `outline`（`rect` / `ellipse` 是
        // 参数化 path.kind，`line` / `arrow` 是线段）。
        let outlines = timeline_shapes()
            .iter()
            .filter(|recipe| matches!(recipe.shape().unwrap().path, ShapePath::Outline { .. }))
            .count();
        assert_eq!(outlines, 20, "20 份 outline = 21 份 path 形状 − 块状 arrow");
    }

    #[test]
    fn the_shape_recipes_carry_their_path_and_param_vocabulary() {
        let rect = timeline_shape("rect").unwrap();
        assert_eq!(rect.version, 1);
        assert!(rect.available);
        assert_eq!(rect.qualified_id(), "shape.rect");
        let body = rect.shape().unwrap();
        assert_eq!(body.path, ShapePath::Rect);
        assert!(body.supports(ShapeParam::CornerRadius));
        assert!(!body.supports(ShapeParam::Endpoints));

        assert_eq!(
            timeline_shape("ellipse").unwrap().shape().unwrap().path,
            ShapePath::Ellipse
        );
        assert_eq!(
            timeline_shape("line").unwrap().shape().unwrap().path,
            ShapePath::Segment {
                default_head: ShapeHead::None
            }
        );
        let arrow = timeline_shape("arrow").unwrap().shape().unwrap();
        assert_eq!(
            arrow.path,
            ShapePath::Segment {
                default_head: ShapeHead::Arrow
            }
        );
        assert!(arrow.supports(ShapeParam::Head));
        // 椭圆不吃圆角：属性面板据此隐藏控件，渲染据此不读那个字段。
        assert!(
            !timeline_shape("ellipse")
                .unwrap()
                .shape()
                .unwrap()
                .supports(ShapeParam::CornerRadius)
        );
        assert!(timeline_shape("hexagon").is_none());
    }

    /// `(id, version)` + `manifest_hash` 冻结纪律：同一份源逐位相同 ⇒ 同一个 hash。
    #[test]
    fn the_shape_manifest_hash_is_the_content_hash_of_the_source_file() {
        for (file, source) in SHAPE_SOURCES {
            let recipe = timeline_shape(file).unwrap();
            assert_eq!(recipe.manifest_hash, fnv1a64(source.as_bytes()), "{file}");
        }
    }

    #[test]
    fn a_shape_recipe_that_lies_about_itself_is_rejected_at_parse_time() {
        use catalogue::parse_catalogue;
        let good = serde_json::json!({
            "id": "rect", "version": 1, "domain": "shape", "namespace": "timeline",
            "order": 0, "path": {"kind": "rect"}, "params": ["fill"], "available": true
        });
        assert!(parse_catalogue(CatalogueKind::Shape, "rect", &good, 0).is_ok());
        for (file, mutate) in [
            ("rect", "id"),
            ("rect", "domain"),
            ("rect", "namespace"),
            ("rect", "params"),
            ("rect", "pathKind"),
        ] {
            let mut doc = good.clone();
            match mutate {
                "id" => doc["id"] = serde_json::json!("square"),
                "domain" => doc["domain"] = serde_json::json!("motion"),
                "namespace" => doc["namespace"] = serde_json::json!("bcf"),
                "params" => doc["params"] = serde_json::json!(["glow"]),
                _ => doc["path"]["kind"] = serde_json::json!("blob"),
            }
            assert!(
                parse_catalogue(CatalogueKind::Shape, file, &doc, 0).is_err(),
                "{mutate} 应在解析期报 manifest-invalid"
            );
        }
    }

    /// P7 的 19 种形状走 `outline`：点全部归一化到元素盒 0..1，
    /// verb 与点数在解析期就配好对，消费者不必再防。
    #[test]
    fn outline_paths_are_validated_at_parse_time() {
        let doc = serde_json::json!({
            "id": "tri", "version": 1, "domain": "shape", "namespace": "timeline",
            "order": 9, "available": true, "params": ["fill"],
            "path": {"kind": "outline", "segments": [
                {"verb": "move", "pts": [[0.5, 0.0]]},
                {"verb": "line", "pts": [[1.0, 1.0]]},
                {"verb": "line", "pts": [[0.0, 1.0]]},
                {"verb": "close"}
            ]}
        });
        let recipe = catalogue::parse_catalogue(CatalogueKind::Shape, "tri", &doc, 0).unwrap();
        assert_eq!(
            recipe.shape().unwrap().path,
            ShapePath::Outline {
                segments: vec![
                    PathSegment::Move([0.5, 0.0]),
                    PathSegment::Line([1.0, 1.0]),
                    PathSegment::Line([0.0, 1.0]),
                    PathSegment::Close,
                ]
            }
        );
        let mut bad = doc.clone();
        bad["path"]["segments"][1] =
            serde_json::json!({"verb": "line", "pts": [[0.0, 0.0], [1.0, 1.0]]});
        assert!(catalogue::parse_catalogue(CatalogueKind::Shape, "tri", &bad, 0).is_err());
        let mut headless = doc;
        headless["path"]["segments"][0] = serde_json::json!({"verb": "line", "pts": [[0.5, 0.0]]});
        assert!(catalogue::parse_catalogue(CatalogueKind::Shape, "tri", &headless, 0).is_err());
    }

    // ── visualizer / progress 目录（设计 §7.3 / §7.4）─────────────────

    /// 两个新 domain 与 shape 同构：数据在独立字段里，绝不进 `manifests`，
    /// 因此阶段 2 的守卫（family 预算 / `manifest_ids()` 的 `exposedTo` 全量断言 /
    /// 内置 preset id 查询面）**不需要修改也不会变红**。
    #[test]
    fn the_new_catalogues_stay_out_of_the_manifest_pipeline() {
        for domain in [
            Domain::TimelineVisualizer,
            Domain::TimelineProgress,
            Domain::TimelineConfetti,
        ] {
            for id in ids(domain) {
                assert!(manifest(id).is_none(), "{id} 不该出现在通用 manifest 里");
                assert!(!manifest_ids().contains(&id), "{id}");
                assert_eq!(canonical_id(id), id, "{id} 不该有 alias");
                assert!(family_of(id).is_none(), "{id} 不该占 family 预算");
                assert!(!families().contains(&id), "{id}");
            }
        }
    }

    /// 目录顺序来自 `order` 字段：声波按设计 §7.3 的表序（柱状 → 波形 → 面积 →
    /// 点阵 → 脉冲 → 丝带），进度条按 style 下拉的固定次序。
    #[test]
    fn the_catalogue_order_matches_the_style_dropdowns() {
        assert_eq!(
            ids(Domain::TimelineVisualizer),
            vec![
                "bars",
                "bars_rounded",
                "bars_bottom",
                "ring_bars",
                "oscilloscope",
                "ring_wave",
                "spectrum_area",
                "dots",
                "pulse_rings",
                "ribbons",
            ]
        );
        assert_eq!(
            ids(Domain::TimelineProgress),
            vec![
                "normal",
                "rounded",
                "circle",
                "donut",
                "border",
                "reverse_border",
                "rainbow_border",
                "reverse_rainbow_border",
                // 拼写是 `strobe`（频闪）。
                "strobe_border",
                "reverse_strobe_border",
                "snake",
                "snake_spin",
                "snake_rainbow",
                "snake_spin_rainbow",
            ]
        );
        // 彩纸目录顺序 = 设计稿 §4.4 的表序，也是原型「彩纸」磁贴格的格序。
        assert_eq!(
            ids(Domain::TimelineConfetti),
            vec![
                "rainbow-paper",
                "pastel-fall",
                "neon-streamers",
                "golden-starburst",
                "festival-fireworks",
                "hearts-petals",
                "party-cannons",
                "curling-ribbons",
                "geometric-pop",
                "champagne-sparkle",
            ]
        );
    }

    /// 十款彩纸：调色板 1–8 色、形状全在封闭表里、算法恒为 `confetti-v1`、
    /// 每款都署了改编来源。`recipe()` 对它有值（渲染核靠它取参数包）。
    #[test]
    fn every_confetti_recipe_is_well_formed() {
        assert_eq!(timeline_confettis().len(), 10);
        for recipe in timeline_confettis() {
            assert!(recipe.available, "{}", recipe.id);
            assert_eq!(recipe.version, 1, "{}", recipe.id);
            assert_eq!(recipe.qualified_id(), format!("confetti.{}", recipe.id));
            let body = recipe.confetti().expect(&recipe.id);
            assert!((1..=8).contains(&body.palette.len()), "{}", recipe.id);
            assert!(!body.shapes.is_empty(), "{}", recipe.id);
            assert!(
                body.shapes
                    .iter()
                    .all(|s| CONFETTI_SHAPES.contains(&s.as_str())),
                "{}",
                recipe.id
            );
            assert!(!body.sources.is_empty(), "{}", recipe.id);
            assert_eq!(body.recipe.algorithm, RecipeAlgorithm::ConfettiV1);
            assert_eq!(body.determinism, Determinism::Strict, "{}", recipe.id);
            assert!(recipe.recipe().is_some(), "{}", recipe.id);
            assert!(recipe.progress().is_none() && recipe.visualizer().is_none());
        }
        assert!(timeline_confetti("rainbow-paper").is_some());
        assert!(timeline_confetti("dyn-confetti-01").is_none());
    }

    /// BaoCut 不做付费分层：目录里每一款都可选。
    #[test]
    fn every_catalogue_recipe_is_available_at_version_one() {
        for recipe in timeline_visualizers()
            .iter()
            .chain(timeline_progresses().iter())
        {
            assert!(recipe.available, "{}", recipe.id);
            assert_eq!(recipe.version, 1, "{}", recipe.id);
        }
        assert_eq!(timeline_visualizers().len(), 10);
        assert_eq!(timeline_progresses().len(), 14);
        assert_eq!(
            timeline_visualizer("bars").unwrap().qualified_id(),
            "visualizer.bars"
        );
        assert_eq!(
            timeline_progress("snake_spin").unwrap().qualified_id(),
            "progress.snake_spin"
        );
        assert!(timeline_visualizer("stropeBorder").is_none());
        assert!(timeline_progress("countdown").is_none());
    }

    /// 进度条的色板编制：**四类**而不是一类。
    ///
    /// 两条彩虹边框整段颜色不出（`numColors == 0`：那两款的描边色写死在着色器的
    /// 彩虹里，色板改下去不会有画面变化）；两条游走彩虹只出一张，标题是
    /// `Background` 且落在**主色**上；两条频闪边框的两色
    /// 叫 `Color 1` / `Color 2`；其余按 `Bar/Base`（条与底）、`Bar/Background`
    /// （边框与画布底）、`Foreground/Background`（游走）分。
    #[test]
    fn the_progress_color_table_matches_the_registry() {
        let expect: &[(&str, u8, &[&str])] = &[
            ("normal", 2, &["Bar", "Base"]),
            ("rounded", 2, &["Bar", "Base"]),
            ("circle", 2, &["Bar", "Base"]),
            ("donut", 2, &["Bar", "Base"]),
            ("border", 2, &["Bar", "Background"]),
            ("reverse_border", 2, &["Bar", "Background"]),
            ("rainbow_border", 0, &[]),
            ("reverse_rainbow_border", 0, &[]),
            ("strobe_border", 2, &["Color 1", "Color 2"]),
            ("reverse_strobe_border", 2, &["Color 1", "Color 2"]),
            ("snake", 2, &["Foreground", "Background"]),
            ("snake_spin", 2, &["Foreground", "Background"]),
            ("snake_rainbow", 1, &["Background"]),
            ("snake_spin_rainbow", 1, &["Background"]),
        ];
        assert_eq!(expect.len(), timeline_progresses().len());
        for (id, num_colors, labels) in expect {
            let body = timeline_progress(id).unwrap().progress().unwrap().clone();
            assert_eq!(body.num_colors, *num_colors, "{id}");
            assert_eq!(body.color_labels, *labels, "{id}");
        }
    }

    /// 样式属性表逐条对齐设计 §7.3：两款时域波形（oscilloscope / ring_wave）用窄
    /// dB 窗、`half` bin、无 dB 控件；四款双色板（spectrum_area / dots / pulse /
    /// ribbons）各自的两个标题是属性面板色板的名字。
    #[test]
    fn the_visualizer_style_table_matches_the_design() {
        // (id, numColors, main, minDb, maxDb, hasControl, binWidth, aspect)
        let expect: &[(&str, u8, &str, f64, f64, bool, BinWidth, VisualizerAspect)] = &[
            (
                "bars",
                1,
                "#3CADFF",
                -80.0,
                40.0,
                true,
                BinWidth::Fixed64,
                VisualizerAspect::Free,
            ),
            (
                "bars_rounded",
                1,
                "#FF6B9A",
                -80.0,
                40.0,
                true,
                BinWidth::Fixed64,
                VisualizerAspect::Free,
            ),
            (
                "bars_bottom",
                1,
                "#70DB74",
                -80.0,
                40.0,
                true,
                BinWidth::Fixed64,
                VisualizerAspect::Free,
            ),
            (
                "ring_bars",
                1,
                "#FFAC46",
                -80.0,
                40.0,
                true,
                BinWidth::Fixed64,
                VisualizerAspect::Square,
            ),
            (
                "oscilloscope",
                1,
                "#46E1FF",
                -120.0,
                -10.0,
                false,
                BinWidth::Half,
                VisualizerAspect::Free,
            ),
            (
                "ring_wave",
                1,
                "#B98CFF",
                -120.0,
                -10.0,
                false,
                BinWidth::Half,
                VisualizerAspect::Square,
            ),
            (
                "spectrum_area",
                2,
                "#3CADFF",
                -80.0,
                40.0,
                true,
                BinWidth::Fixed64,
                VisualizerAspect::Free,
            ),
            (
                "dots",
                2,
                "#3CADFF",
                -80.0,
                40.0,
                true,
                BinWidth::Fixed64,
                VisualizerAspect::Free,
            ),
            (
                "pulse_rings",
                2,
                "#3CADFF",
                -80.0,
                40.0,
                true,
                BinWidth::Fixed64,
                VisualizerAspect::Square,
            ),
            (
                "ribbons",
                2,
                "#437BDC",
                -80.0,
                40.0,
                true,
                BinWidth::Fixed64,
                VisualizerAspect::Free,
            ),
        ];
        assert_eq!(expect.len(), timeline_visualizers().len());
        for (id, num_colors, main, min_db, max_db, has_control, bin_width, aspect) in expect {
            let body = timeline_visualizer(id).unwrap().visualizer().unwrap();
            assert_eq!(body.num_colors, *num_colors, "{id}");
            assert_eq!(body.color_labels.len(), usize::from(*num_colors), "{id}");
            assert_eq!(body.default_main_color, *main, "{id}");
            assert_eq!(body.default_min_db.to_bits(), min_db.to_bits(), "{id}");
            assert_eq!(body.default_max_db.to_bits(), max_db.to_bits(), "{id}");
            assert_eq!(body.has_control, *has_control, "{id}");
            assert_eq!(body.bin_width, *bin_width, "{id}");
            assert_eq!(body.aspect, *aspect, "{id}");
            assert!(
                body.shader.is_none(),
                "{id}: 声波配方全部是 CPU 矢量，没有 WGSL"
            );
        }
        // 只有读时域行的两款用窄 dB 窗，也只有它们是 `half` 且无 dB 控件。
        let half: Vec<&str> = timeline_visualizers()
            .iter()
            .filter(|r| r.visualizer().unwrap().bin_width == BinWidth::Half)
            .map(|r| r.id.as_str())
            .collect();
        assert_eq!(half, vec!["oscilloscope", "ring_wave"]);
        let labels = |id: &str| {
            timeline_visualizer(id)
                .unwrap()
                .visualizer()
                .unwrap()
                .color_labels
                .clone()
        };
        assert_eq!(labels("spectrum_area"), vec!["Fill", "Line"]);
        assert_eq!(labels("dots"), vec!["Dots", "Peaks"]);
        assert_eq!(labels("pulse_rings"), vec!["Core", "Rings"]);
        assert_eq!(labels("ribbons"), vec!["Ribbon A", "Ribbon B"]);
        assert_eq!(
            timeline_visualizer("dots")
                .unwrap()
                .visualizer()
                .unwrap()
                .default_secondary_color,
            "#FF4C45"
        );
    }

    /// 旧目录的 15 个 id 全部折到新目录：老项目的 `visualizer.style` 不会
    /// 变成 `None`；新 id 与未知 id 原样返回。
    #[test]
    fn every_legacy_visualizer_style_resolves_to_a_current_recipe() {
        let expect: &[(&str, &str)] = &[
            ("trio_wave", "bars"),
            ("formation", "bars"),
            ("formation_thin", "bars"),
            ("formation_rounded", "bars_rounded"),
            ("formation_aligned", "bars_bottom"),
            ("formation_thin_aligned", "bars_bottom"),
            ("static", "bars_bottom"),
            ("formation_circle", "ring_bars"),
            ("beam", "oscilloscope"),
            ("simi", "ribbons"),
            ("harmony", "ribbons"),
            ("waves", "ribbons"),
            ("frequency_lines", "dots"),
            ("echo_lines", "dots"),
            ("ripple_wave", "pulse_rings"),
        ];
        assert_eq!(expect.len(), 15);
        for (old, new) in expect {
            assert_eq!(canonical_visualizer_style(old), *new, "{old}");
            assert_eq!(timeline_visualizer(old).unwrap().id, *new, "{old}");
            // 别名只是兼容层：目录本身不再登记旧 id。
            assert!(!ids(Domain::TimelineVisualizer).contains(old), "{old}");
        }
        for id in ids(Domain::TimelineVisualizer) {
            assert_eq!(canonical_visualizer_style(id), id);
        }
        assert_eq!(canonical_visualizer_style("nope"), "nope");
        assert!(timeline_visualizer("nope").is_none());
    }

    /// determinism 分级是 ADR-E05 的表，值是既有的 Rust 枚举，不是新字符串常量。
    #[test]
    fn the_determinism_grades_match_adr_e05() {
        let visual_visualizers: Vec<&str> = timeline_visualizers()
            .iter()
            .filter(|r| r.visualizer().unwrap().determinism == Determinism::Visual)
            .map(|r| r.id.as_str())
            .collect();
        // 声波 10 款全是纯矢量、无噪声、无 GPU 分支——没有一款需要 `visual` 级。
        assert!(visual_visualizers.is_empty(), "{visual_visualizers:?}");
        let visual_progress: Vec<&str> = timeline_progresses()
            .iter()
            .filter(|r| r.progress().unwrap().determinism == Determinism::Visual)
            .map(|r| r.id.as_str())
            .collect();
        assert_eq!(
            visual_progress,
            vec![
                "rainbow_border",
                "reverse_rainbow_border",
                "strobe_border",
                "reverse_strobe_border",
                "snake_rainbow",
                "snake_spin_rainbow",
            ]
        );
        // 其余全是 strict，且没有一份用 backend 级。
        for recipe in timeline_visualizers()
            .iter()
            .chain(timeline_progresses().iter())
        {
            let determinism = match &recipe.body {
                CatalogueBody::Visualizer(body) => body.determinism,
                CatalogueBody::Progress(body) => body.determinism,
                CatalogueBody::Shape(_)
                | CatalogueBody::Sticker(_)
                | CatalogueBody::Confetti(_) => unreachable!(),
            };
            assert_ne!(determinism, Determinism::Backend, "{}", recipe.id);
        }
    }

    /// 算法名是封闭集合，且逐条对齐设计 §7.3 / §7.4 的 recipe 列。
    #[test]
    fn every_recipe_declares_one_of_the_closed_algorithm_names() {
        let expect: &[(&str, RecipeAlgorithm)] = &[
            ("bars", RecipeAlgorithm::SpectrumBarsV1),
            ("bars_rounded", RecipeAlgorithm::SpectrumBarsV1),
            ("bars_bottom", RecipeAlgorithm::SpectrumBarsV1),
            ("ring_bars", RecipeAlgorithm::PolarBarsV1),
            ("oscilloscope", RecipeAlgorithm::OscilloscopeV1),
            ("ring_wave", RecipeAlgorithm::OscilloscopeV1),
            ("spectrum_area", RecipeAlgorithm::SpectrumAreaV1),
            ("dots", RecipeAlgorithm::DotMatrixV1),
            ("pulse_rings", RecipeAlgorithm::PulseRingsV1),
            ("ribbons", RecipeAlgorithm::RibbonsV1),
        ];
        assert_eq!(expect.len(), timeline_visualizers().len());
        for (id, algorithm) in expect {
            let recipe = timeline_visualizer(id).unwrap().recipe().unwrap();
            assert_eq!(recipe.algorithm, *algorithm, "{id}");
        }
        let progress_expect: &[(&str, RecipeAlgorithm)] = &[
            ("normal", RecipeAlgorithm::BarV1),
            ("rounded", RecipeAlgorithm::BarV1),
            ("border", RecipeAlgorithm::FrameV1),
            ("reverse_border", RecipeAlgorithm::FrameV1),
            ("rainbow_border", RecipeAlgorithm::FrameV1),
            ("reverse_rainbow_border", RecipeAlgorithm::FrameV1),
            ("strobe_border", RecipeAlgorithm::FrameV1),
            ("reverse_strobe_border", RecipeAlgorithm::FrameV1),
            ("circle", RecipeAlgorithm::RingV1),
            ("donut", RecipeAlgorithm::RingV1),
            ("snake", RecipeAlgorithm::SnakeV1),
            ("snake_spin", RecipeAlgorithm::SnakeV1),
            ("snake_rainbow", RecipeAlgorithm::SnakeV1),
            ("snake_spin_rainbow", RecipeAlgorithm::SnakeV1),
        ];
        for (id, algorithm) in progress_expect {
            let recipe = timeline_progress(id).unwrap().recipe().unwrap();
            assert_eq!(recipe.algorithm, *algorithm, "{id}");
        }
        // rainbow / strobe 变体不新造算法名——它们是 frame-v1 / snake-v1 的
        // `colorMode` 参数（设计 §7.4 注）。
        assert_eq!(
            timeline_progress("rainbow_border")
                .unwrap()
                .recipe()
                .unwrap()
                .object("colorMode")
                .unwrap()
                .get("kind")
                .unwrap(),
            "rainbow"
        );
        assert_eq!(
            timeline_progress("strobe_border")
                .unwrap()
                .recipe()
                .unwrap()
                .object("colorMode")
                .unwrap()
                .get("kind")
                .unwrap(),
            "strobe"
        );
        assert!(
            timeline_progress("snake_spin_rainbow")
                .unwrap()
                .recipe()
                .unwrap()
                .object("spin")
                .is_some()
        );
        assert!(
            timeline_progress("snake_rainbow")
                .unwrap()
                .recipe()
                .unwrap()
                .object("spin")
                .is_none(),
            "非 spin 变体写 null，读出来必须是 None"
        );
    }

    /// 三款柱状共用 `spectrum-bars-v1`，只差参数（旧目录的六种 formation + static +
    /// trio_wave 就是靠这几个自由度合并掉的）：Rust 内核一个数字都不带。
    #[test]
    fn the_spectrum_bars_parameters_are_the_only_thing_separating_the_three_bar_styles() {
        // (id, barCount, align, gap, radius, minHeight, easing)
        let expect: &[(&str, u64, &str, f64, f64, f64, &str)] = &[
            ("bars", 48, "mirror", 0.35, 0.0, 0.02, "easeOutQuad"),
            ("bars_rounded", 32, "mirror", 0.45, 1.0, 0.06, "easeOutQuad"),
            ("bars_bottom", 64, "bottom", 0.25, 0.0, 0.02, "easeOutQuad"),
        ];
        for (id, bar_count, align, gap, radius, min_height, easing) in expect {
            let recipe = timeline_visualizer(id).unwrap().recipe().unwrap();
            assert_eq!(recipe.integer("barCount"), Some(*bar_count), "{id}");
            assert_eq!(recipe.text("align"), Some(*align), "{id}");
            assert_eq!(recipe.number("gap"), Some(*gap), "{id}");
            assert_eq!(recipe.number("radius"), Some(*radius), "{id}");
            assert_eq!(recipe.number("minHeight"), Some(*min_height), "{id}");
            assert_eq!(recipe.text("easing"), Some(*easing), "{id}");
        }
        // 两款时域波形同样只差 `layout` 与半径。
        let linear = timeline_visualizer("oscilloscope")
            .unwrap()
            .recipe()
            .unwrap();
        let polar = timeline_visualizer("ring_wave").unwrap().recipe().unwrap();
        assert_eq!(linear.text("layout"), Some("linear"));
        assert_eq!(polar.text("layout"), Some("polar"));
        assert_eq!(linear.number("baseRadius"), Some(0.0));
        assert_eq!(polar.number("baseRadius"), Some(0.6));
        assert_eq!(linear.integer("samples"), polar.integer("samples"));
    }

    /// 只有 `ribbons` 读时钟（`speed` / `cycles`）——其余九款是纯频谱/时域函数，
    /// 同一帧数据在任何时刻画出同一张图（`tests/visualizer_draw.rs` 靠这一点冻结 golden）。
    #[test]
    fn only_the_ribbons_recipe_reads_the_clock() {
        for recipe in timeline_visualizers() {
            let params = recipe.recipe().unwrap();
            let reads_clock = params.number("speed").is_some();
            assert_eq!(reads_clock, recipe.id == "ribbons", "{}", recipe.id);
        }
        let ribbons = timeline_visualizer("ribbons").unwrap().recipe().unwrap();
        assert_eq!(ribbons.integer("ribbonCount"), Some(3));
        assert_eq!(ribbons.number("cycles"), Some(2.5));
    }

    /// `(id, version)` + `manifest_hash` 冻结纪律覆盖 24 份目录配方（声波 10 + 进度 14）。
    #[test]
    fn the_catalogue_manifest_hashes_are_the_content_hashes_of_the_source_files() {
        for (file, source) in VISUALIZER_SOURCES {
            let recipe = timeline_visualizer(file).unwrap();
            assert_eq!(recipe.manifest_hash, fnv1a64(source.as_bytes()), "{file}");
        }
        for (file, source) in PROGRESS_SOURCES {
            let recipe = timeline_progress(file).unwrap();
            assert_eq!(recipe.manifest_hash, fnv1a64(source.as_bytes()), "{file}");
        }
        // 24 份互不相同——同名不同目录也不会撞。
        let mut hashes: Vec<u64> = timeline_visualizers()
            .iter()
            .chain(timeline_progresses().iter())
            .map(|recipe| recipe.manifest_hash)
            .collect();
        hashes.sort_unstable();
        let total = hashes.len();
        hashes.dedup();
        assert_eq!(hashes.len(), total);
        assert_eq!(total, 24);
    }

    /// 未知算法名、串门算法名、缺参数、越界数值、坏颜色、坏 dB 窗——
    /// 全部在**注册表解析期**报 `manifest-invalid`，而不是第一次绘制时 panic。
    #[test]
    fn a_catalogue_recipe_that_lies_about_itself_is_rejected_at_parse_time() {
        use catalogue::parse_catalogue;
        let good = serde_json::json!({
            "id": "bars", "version": 1, "domain": "visualizer", "namespace": "timeline",
            "order": 0, "numColors": 1, "colorLabels": ["Bars"],
            "defaultMainColor": "#3CADFF", "defaultSecondaryColor": "#FFFFFF",
            "defaultMinDb": -80.0, "defaultMaxDb": 40.0, "hasControl": true,
            "binWidth": "64", "aspect": "free", "determinism": "strict",
            "shader": null, "available": true,
            "recipe": {"algorithm": "spectrum-bars-v1", "params": {
                "barCount": 48, "align": "mirror", "gap": 0.35, "radius": 0.0,
                "minHeight": 0.02, "easing": "easeOutQuad"}}
        });
        assert!(parse_catalogue(CatalogueKind::Visualizer, "bars", &good, 0).is_ok());

        let mutations: &[(&str, fn(&mut Value))] = &[
            ("未知算法名", |doc| {
                doc["recipe"]["algorithm"] = serde_json::json!("bars-v1")
            }),
            ("串门算法名", |doc| {
                doc["recipe"]["algorithm"] = serde_json::json!("snake-v1")
            }),
            ("缺必填参数", |doc| {
                doc["recipe"]["params"]
                    .as_object_mut()
                    .unwrap()
                    .remove("gap");
            }),
            ("barCount 非正整数", |doc| {
                doc["recipe"]["params"]["barCount"] = serde_json::json!(0)
            }),
            ("minHeight 越界", |doc| {
                doc["recipe"]["params"]["minHeight"] = serde_json::json!(1.5)
            }),
            ("gap 越界", |doc| {
                doc["recipe"]["params"]["gap"] = serde_json::json!(-0.1)
            }),
            ("easing 不在封闭集合", |doc| {
                doc["recipe"]["params"]["easing"] = serde_json::json!("easeInBounce")
            }),
            ("align 不在封闭集合", |doc| {
                doc["recipe"]["params"]["align"] = serde_json::json!("top")
            }),
            ("colorLabels 与 numColors 不匹配", |doc| {
                doc["colorLabels"] = serde_json::json!([])
            }),
            ("numColors 越界", |doc| {
                doc["numColors"] = serde_json::json!(3)
            }),
            ("坏颜色", |doc| {
                doc["defaultMainColor"] = serde_json::json!("purple")
            }),
            ("dB 窗反了", |doc| {
                doc["defaultMinDb"] = serde_json::json!(40.0)
            }),
            ("binWidth 未知", |doc| {
                doc["binWidth"] = serde_json::json!("128")
            }),
            ("determinism 未知", |doc| {
                doc["determinism"] = serde_json::json!("eventual")
            }),
            ("声波配方不接受 shader", |doc| {
                doc["shader"] = serde_json::json!("bars.wgsl")
            }),
        ];
        for (label, mutate) in mutations {
            let mut doc = good.clone();
            mutate(&mut doc);
            assert!(
                matches!(
                    parse_catalogue(CatalogueKind::Visualizer, "bars", &doc, 0),
                    Err(MotionError::ManifestInvalid(_))
                ),
                "{label} 应在解析期报 manifest-invalid"
            );
        }
    }

    /// 曲线族的采样密度与时钟参数也在解析期把关：`samples` 至少 2、
    /// `speed` / `cycles` / `amplitude` 必须是正数。
    #[test]
    fn the_curve_recipes_reject_degenerate_densities_and_clocks() {
        use catalogue::parse_catalogue;
        let source = |id: &str| -> Value {
            serde_json::from_str(
                VISUALIZER_SOURCES
                    .iter()
                    .find(|(file, _)| *file == id)
                    .unwrap()
                    .1,
            )
            .unwrap()
        };
        let mut ribbons = source("ribbons");
        assert!(parse_catalogue(CatalogueKind::Visualizer, "ribbons", &ribbons, 0).is_ok());
        ribbons["recipe"]["params"]["samples"] = serde_json::json!(1);
        assert!(matches!(
            parse_catalogue(CatalogueKind::Visualizer, "ribbons", &ribbons, 0),
            Err(MotionError::ManifestInvalid(_))
        ));
        let mut ribbons = source("ribbons");
        ribbons["recipe"]["params"]["speed"] = serde_json::json!(0.0);
        assert!(matches!(
            parse_catalogue(CatalogueKind::Visualizer, "ribbons", &ribbons, 0),
            Err(MotionError::ManifestInvalid(_))
        ));
        let mut scope = source("oscilloscope");
        scope["recipe"]["params"]["layout"] = serde_json::json!("spiral");
        assert!(matches!(
            parse_catalogue(CatalogueKind::Visualizer, "oscilloscope", &scope, 0),
            Err(MotionError::ManifestInvalid(_))
        ));
        let mut scope = source("oscilloscope");
        scope["recipe"]["params"]["amplitude"] = serde_json::json!(-1.0);
        assert!(matches!(
            parse_catalogue(CatalogueKind::Visualizer, "oscilloscope", &scope, 0),
            Err(MotionError::ManifestInvalid(_))
        ));
    }

    #[test]
    fn canonical_families_stay_inside_the_budget() {
        let families = families();
        assert!(
            families.len() <= CANONICAL_FAMILY_BUDGET,
            "{families:?} 超出 {CANONICAL_FAMILY_BUDGET} 个 canonical family 预算（设计 §5.4.3）"
        );
        assert_eq!(
            families,
            vec![
                "backIn",
                "blurIn",
                "drift",
                "elasticIn",
                "fadeIn",
                "flash",
                "moveIn",
                "pulse",
                "rollIn",
                "rotateIn",
                "scaleIn",
                "shake",
                "tilt",
            ]
        );
    }

    #[test]
    fn part_families_have_their_own_budget() {
        let families = part_families();
        assert!(
            families.len() <= PART_FAMILY_BUDGET,
            "{families:?} 超出 {PART_FAMILY_BUDGET} 个 part family 预算（规范 §7.9）"
        );
        assert_eq!(
            families,
            vec![
                "karaokeScale",
                "riseParts",
                "seededJitter",
                "typewriter",
                "wipeParts",
            ]
        );
        // part 家族不占元素预算，反之亦然
        for family in &families {
            assert!(!super::families().contains(family), "{family}");
        }
        assert_eq!(applies_to("motion.riseParts"), Some(AppliesTo::Part));
        assert_eq!(applies_to("motion.moveIn"), Some(AppliesTo::Element));
        assert_eq!(applies_to("typeIn"), Some(AppliesTo::Part));
    }

    /// `shake` / `drift` / `seededJitter` 的真身是 `oscillate` / `noise` op
    /// （阶段 2 因为 graph 未实现而推迟到这里，§15 阶段 2 偏离 5）。
    #[test]
    fn the_op_bodied_recipes_expand_to_keyframes() {
        for id in ["motion.shake", "motion.drift", "motion.seededJitter"] {
            let entry = manifest(id).unwrap();
            assert!(matches!(entry.body, PresetBody::Ops(_)), "{id}");
            let out = expand(id, None, &Map::new(), &ExpandCtx::with_dur(1.0)).unwrap();
            assert_eq!(out.tracks.len(), 2, "{id}");
            for track in &out.tracks {
                assert!(track.frames.len() > 4, "{id}: {:?}", track.prop);
                // 相对长度原文保留，布局之后才求值
                assert!(
                    track.frames.iter().all(|f| f.v.get("basis").is_some()),
                    "{id}"
                );
            }
        }
        // 同 seed 同输出
        let a = expand("motion.shake", None, &Map::new(), &ExpandCtx::with_dur(1.0)).unwrap();
        let b = expand("motion.shake", None, &Map::new(), &ExpandCtx::with_dur(1.0)).unwrap();
        assert_eq!(a.tracks, b.tracks);
    }

    #[test]
    fn aliases_map_the_appendix_b_vocabulary_to_canonical_ids() {
        for (alias, canonical) in [
            ("rise", "motion.moveIn"),
            ("slideIn", "motion.moveIn"),
            ("slideOut", "motion.moveOut"),
            ("scaleIn", "motion.scaleIn"),
            ("scaleOut", "motion.scaleOut"),
            ("springPop", "motion.backIn"),
            ("pop", "motion.pulse"),
            ("pulse", "motion.pulse"),
            ("flash", "motion.flash"),
            ("tiltNudge", "motion.tilt"),
        ] {
            assert_eq!(canonical_id(alias), canonical, "{alias}");
            assert_eq!(
                family_of(alias),
                manifest(canonical).unwrap().family.as_deref()
            );
        }
        // 冻结的 bcf 配方名没有被 alias 抢走
        assert_eq!(canonical_id("fadeIn"), "fadeIn");
        assert!(bcf_preset("fadeIn").is_some());
    }

    #[test]
    fn the_new_families_are_not_exposed_to_the_timeline_or_the_mac_stage() {
        for id in manifest_ids() {
            let entry = manifest(id).unwrap();
            assert_eq!(
                entry.exposed_to,
                vec![Surface::Bcf],
                "{id}: 新 family 只对 BCF 开放（ADR-M09 / 设计 §10 阶段 2）"
            );
            assert_eq!(entry.determinism, Determinism::Strict, "{id}");
            assert_eq!(entry.version, 1, "{id}");
        }
    }

    #[test]
    fn internal_building_blocks_carry_no_family() {
        for id in [
            "motion.shiftIn",
            "motion.shiftOut",
            "motion.zoomIn",
            "motion.zoomOut",
            "motion.spinIn",
            "motion.spinOut",
            "motion.blurFrom",
            "motion.blurTo",
        ] {
            assert!(manifest(id).unwrap().family.is_none(), "{id}");
        }
    }
}
