//! 渲染内核需要、但**不属于**渲染内核的两条项目级投影。
//!
//! overlay 的两处需要 timeline 投影：
//!
//! - [`OverlayHost::studio_timeline_projection`]——`overlay_document_with_live_timeline`
//!   把「当前时间轴」并进 Studio 正文（剪切后的词时钟、元素轨道）。
//! - [`OverlayHost::project_timeline_projection`]——visualizer 元素的采样时刻折算表。
//!
//! 这两条投影的实现要读 `.bcut/id-sequences.json` 与历史快照
//! （CLI 的 `ProjectTimeline::load` → `IdAllocator` → `HistoryStore`），
//! 那是 D2 第三刀 `bcut-workspace` 的地盘，M1 搬进来是越界。**注入而不是下沉**：
//! 它们不是「第二份实现」的风险点——CLI 与 App 都会 link 同一个 workspace crate，
//! 只是时间未到。相反 [`crate::paths`] 里的路径解析必须下沉，因为注入它
//! 等于要求每个 host 自己复刻命名规则。
//!
//! # 为什么是进程默认实例而不是函数参数
//!
//! 沿用 [`bcut_jobs`](https://docs.rs/) 的第二条纪律：不要把单例冻进公共 API。
//! 这里的取舍多一层——把 host 串成 `compile_project*` 的参数，会改到
//! `serve/endpoints/media.rs`、`studio_export/video.rs` 与几十处测试的调用点，
//! 而这些调用点跟本次下沉毫无关系。于是保留 [`register`] 的进程默认实例，
//! 公共 API 一字不动。
//!
//! **未注册时一律报错，绝不静默返回空投影**：静默的空投影会让 visualizer
//! 元素画不出来而没有任何提示，正好是这类下沉最容易埋的雷。

use std::path::Path;
use std::sync::OnceLock;

use anyhow::{Result, anyhow};
use serde_json::Value;
use timeline::arrange::TimelineProjection;

/// 由 host（CLI / App v2）提供的项目级时间轴投影。
pub trait OverlayHost: Send + Sync + 'static {
    /// Studio 正文里的 `timeline` 字段：剪切后的元素轨道与源表。
    fn studio_timeline_projection(&self, project: &Path) -> Result<Value>;

    /// 词/元素时钟映射；visualizer 的采样时刻按它折算回源时间。
    fn project_timeline_projection(&self, project: &Path) -> Result<TimelineProjection>;

    /// 按目标语言重投影 `studio/data.json` 的正文；`None` = 该语言无译文。
    ///
    /// 投影本身要读 transcript、算内容指纹并落 `studio/`，属于 workspace 层。
    /// **host 的实现应当是只读的**（主方案 §9.1-b）：`load_preview_document_for_lang`
    /// 是预览与导出的读路径，在这里落盘等于用户没请求就改了项目状态。
    /// CLI 今天走的 `studio::project_language` 会申请项目锁并补齐 `studio/` 骨架，
    /// 是历史包袱，不是这个接口的语义。
    fn reproject_language(&self, project: &Path, lang: &str) -> Result<Option<Value>>;

    /// 项目套用的模板层（`timeline.json` 的 `template`）连同它引用的项目侧事实
    /// （输出时钟上的章节、项目标题、台标图片）；`Ok(None)` = 没套模板。
    ///
    /// 读 timeline.json、transcript.json 的章节表并走时间轴投影，是 workspace 的
    /// 地盘；渲染内核只负责把交回来的场景逐帧画成一层前景。
    ///
    /// **没有默认实现是刻意的**：静默 `Ok(None)` 的代价是模板套上去画面毫无变化
    /// 而没有任何提示——正是本文件开头那条「绝不静默返回空投影」要防的雷。
    fn template_scene(&self, project: &Path) -> Result<Option<TemplateScene>>;

    /// 渲染时在**内置字体之外**还要装载的字体来源（用户导入库）。
    ///
    /// 默认 [`BundledFontSource`]：只有编进二进制的内置字体。有配置根的宿主
    /// （CLI / `bcut serve` / App v2 都经 `bcut_workspace::timeline::overlay`
    /// 注册同一个实现）覆盖它。
    ///
    /// 这条**有**默认实现，与上面几条「绝不静默」的接口不同：导入字体库缺席的
    /// 后果是字幕回退到内置字族——画面照出，只是字体不对；而投影缺席是整层
    /// 消失。默认值本身就是「没有导入库」这个合法状态。
    fn font_source(&self) -> &dyn FontSource {
        &BUNDLED_FONT_SOURCE
    }
}

/// 渲染要用的**额外**字体字节来源（提案 §5.2：`bcut-subtitle-render` 的字体库
/// 依赖改为注入的 `FontSource`）。
///
/// # 为什么是「一次交出整份字节集」而不是 `(family, weight, style) → 字节`
///
/// 消费点只有一个：`TextEngine::with_system_and_fonts(&fonts)` 收的是**整份**
/// 字体字节集，由排版层自己做 family/weight/style 匹配与 fallback。做成按三元组
/// 查询的接口，等于把字体匹配从排版层挪到注入层再实现一遍——那会动到字形选择
/// 语义，正好是「golden 指纹不许变」要防的东西。所以接口按真实消费形状定义。
pub trait FontSource: Send + Sync {
    /// 内置字体之外要一并装进文本引擎的字体字节；顺序即优先级。
    fn extra_fonts(&self) -> Vec<Vec<u8>>;
}

/// 默认字体来源：只有内置字体（`core/assets/fonts/`，见
/// [`crate::bundled_studio_fonts`]），没有用户导入库。
pub struct BundledFontSource;

impl FontSource for BundledFontSource {
    fn extra_fonts(&self) -> Vec<Vec<u8>> {
        Vec::new()
    }
}

static BUNDLED_FONT_SOURCE: BundledFontSource = BundledFontSource;

pub use crate::template_layer::TemplateScene;

static HOST: OnceLock<Box<dyn OverlayHost>> = OnceLock::new();

pub type LiveDocumentProvider = fn(&Path) -> Result<Option<Value>>;
static LIVE_DOCUMENT: OnceLock<LiveDocumentProvider> = OnceLock::new();

pub fn register_live_document(provider: LiveDocumentProvider) -> bool {
    LIVE_DOCUMENT.set(provider).is_ok()
}

pub(crate) fn live_document(project: &Path) -> Result<Option<Value>> {
    LIVE_DOCUMENT
        .get()
        .map_or(Ok(None), |provider| provider(project))
}

/// 宿主合成源为谁准备：舞台预览按渲染计划的宽度出帧，导出交出成片画布，
/// 由宿主按源在画布里要占的宽度决定用什么分辨率出帧。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VideoSourceUse {
    /// 预览（`SkipFailedElement`）：计划宽度，即舞台的 backing 像素宽。
    Preview { width: u32 },
    /// 导出（`Strict`）：成片画布，即编码尺寸。
    Export {
        canvas_width: u32,
        canvas_height: u32,
    },
}

/// BCF 等宿主合成源的准备入口。`None` 表示普通视频，继续走原解码器。
/// 已识别为合成源后，准备失败必须返回错误，不能退回旧成片。
pub type VideoSourceProvider = fn(
    &Path,
    &str,
    Option<&str>,
    VideoSourceUse,
) -> Result<Option<render_raster::media::ExternalVideoSource>>;
static VIDEO_SOURCES: OnceLock<VideoSourceProvider> = OnceLock::new();

pub fn register_video_sources(provider: VideoSourceProvider) -> bool {
    VIDEO_SOURCES.set(provider).is_ok()
}

pub(crate) fn prepare_video_source(
    project: &Path,
    id: &str,
    path: Option<&str>,
    usage: VideoSourceUse,
) -> Result<Option<render_raster::media::ExternalVideoSource>> {
    match VIDEO_SOURCES.get() {
        Some(provider) => provider(project, id, path, usage),
        None => Ok(None),
    }
}

/// 注册进程默认 host。重复注册是 no-op（返回 `false`），不 panic：
/// 测试二进制里多个测试都会走这条路。
pub fn register(host: Box<dyn OverlayHost>) -> bool {
    HOST.set(host).is_ok()
}

fn host() -> Result<&'static dyn OverlayHost> {
    HOST.get().map(AsRef::as_ref).ok_or_else(|| {
        anyhow!(
            "bcut-subtitle-render 未注册 OverlayHost：\
             宿主进程必须在渲染前调用 `subtitle_render::host::register`"
        )
    })
}

pub(crate) fn studio_timeline_projection(project: &Path) -> Result<Value> {
    host()?.studio_timeline_projection(project)
}

pub(crate) fn project_timeline_projection(project: &Path) -> Result<TimelineProjection> {
    host()?.project_timeline_projection(project)
}

pub(crate) fn reproject_language(project: &Path, lang: &str) -> Result<Option<Value>> {
    host()?.reproject_language(project, lang)
}

pub(crate) fn template_scene(project: &Path) -> Result<Option<TemplateScene>> {
    host()?.template_scene(project)
}

/// 注册 host 提供的额外字体；**未注册时是空**而不是报错——只有内置字体也能
/// 出画，理由见 [`OverlayHost::font_source`]。
pub fn extra_fonts() -> Vec<Vec<u8>> {
    HOST.get()
        .map(|host| host.font_source().extra_fonts())
        .unwrap_or_default()
}
