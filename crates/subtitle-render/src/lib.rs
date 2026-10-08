//! BaoCut 字幕 overlay 渲染内核：**CLI 烧录与 App v2 预览的同一份实现**。
//!
//! 内容整体搬自 `core/crates/bcut-kernel/src/cmd/studio_export`（主方案 D2 第二刀，
//! 详见 `docs/archive/app-v2/m1-mvp.md` §2.1 W4）。搬迁是 `git mv` ＋ 可见性提升，
//! 函数体一字未改——M1-R3 要的「同一内核同一输入必然同像素」只有在真的是
//! 同一份代码时才成立，重写一遍再对拍是把风险留给用户。
//!
//! # 四条纪律
//!
//! **一、字幕排版只能有一份。** overlay 的排版、逐词状态、Designed Caption
//! 配方、timeline 元素合成与 DrawOp 指纹全在这里；`core/crates/bcut-kernel/src` 与
//! `apps/baocut/src` 里不得出现第二份实现（由
//! [`tests/no_second_implementation.rs`](https://github.com/JimLiu/baocut-app)
//! 扫描固化）。App 侧只允许调用，主方案 D6 的红线是「App 不做任何字幕排版」。
//!
//! **二、探针与时间轴投影是注入项，不是下沉项。** 画布尺寸 / 时长 / fps 由
//! 调用方探测后**作为参数传进** [`OverlayRenderPlan::compile_project`]；本 crate
//! 不 spawn `ffprobe`，也不 link 任何平台媒体框架。项目级 timeline 投影经
//! [`host::OverlayHost`] 注入（实现属于 D2 第三刀的 `bcut-workspace`）。
//! 反之，媒体路径与 BCS1 缓存命名必须下沉（见 [`paths`]）——注入它等于要求
//! 每个 host 复刻一遍命名规则，那就是纪律一说的第二份实现。
//!
//! **三、只读入口无副作用（主方案 §9.1-b）。** [`project_media`]、
//! [`load_preview_document`]、[`load_overlay_document`]、
//! [`load_subtitle_style_override`] 只读文件，不写盘、不建目录、不迁移旧数据、
//! 不申请项目锁。App 的两阶段打开会在快切项目时反复调用它们，任何写入都会
//! 变成用户看不见的静默改档。
//!
//! **四、PNG 的上游是 RGBA，不是反过来。** [`OverlayRenderPlan::render_rgba`]
//! 返回渲染器直接产出的 **premultiplied** RGBA（tiny-skia 内存布局），
//! [`OverlayRenderPlan::render_png`] 把同一份缓冲交给 `Pixmap::encode_png`
//! （PNG 是 straight alpha，编码器负责解乘）。GPUI 纹理上传走 `render_rgba`，
//! 绝不许「渲染 PNG 再解码回 RGBA」——那会引入一次无意义的编解码，
//! 且两端像素身份从此靠运气。像素身份看 [`OverlayFrame::draw_op_fingerprint`]，
//! 字幕层内容键看 [`OverlayFrame::subtitle_key`]，两者不可互相顶替。
//!
//! # 给 App v2 的最小调用序列
//!
//! ```ignore
//! subtitle_render::host::register(Box::new(MyHost));   // 进程启动时一次
//!
//! let media = subtitle_render::project_media(root)?;   // 只读
//! let probe = my_platform_probe(&media)?;                   // 探针由 host 提供
//! let document = subtitle_render::load_overlay_document(root)?;
//! let mut plan = subtitle_render::OverlayRenderPlan::compile_project(
//!     root, &document, width, height, probe.duration, probe.fps, mode,
//! )?;
//! let frame = plan.render_rgba_frame(t)?;   // frame.next_change = 下一次变化时刻
//! ```

#![allow(clippy::too_many_arguments)]

/// 画廊「动态排版」卡的真跑小样（与舞台同一套排版 / 镜头）。
pub mod caption_sequence_demo;
pub mod word_animation_catalog;
pub mod word_motion;
pub mod word_motion_demo;

#[cfg(feature = "host")]
pub mod host;
// host 实现方的共享零件（词时序装载 ＋ 词锚 → 秒）。CLI 与 App v2 两个 host
// 都调这里，D2 不允许任何一侧再写第二份锚解析。
#[cfg(feature = "host")]
pub mod host_support;
#[cfg(feature = "host")]
pub mod paths;

/// 模板层文档（`timeline.json` 的 `template`）的逐帧直绘；两个 feature 共用。
pub mod template_layer;
pub use template_layer::{FrameParams as TemplateFrameParams, TemplateScene, TemplateSource};

/// 字幕样式的双向对账（`contexts` ↔ 扁平键、轨集规范化）。从 `bcut-workspace`
/// 下沉：判据本身无 I/O，写路径与 `bcut-editor-core` 两边都要用同一份。
pub mod style_sync;
pub mod text_design;

// v3：v2 里这两块在内核之外（`bcut-kernel` 的 ASS 软字幕头、`bcut-engine` 的检查判定），它们要本
// crate 的 `LineStyle` 或时间线 schema，`speech-doc` 不反向依赖渲染，于是落在这里。
pub mod ass_style;
pub mod check;

// 扁平命名空间：下面五个文件在 `studio_export` 里就是 `include!` 组合的一个
// 模块，几百处互引都依赖这一点。改成真 module 是重写而不是搬迁，
// 会把互引全部变成可见性问题——所以组合方式原样保留。
//
// 代价要知道：rustfmt 只顺着 `mod` 声明走，**不会访问 `include!` 进来的文件**，
// 所以 `cargo fmt --all -- --check` 对下面这六个文件永远是绿的，缩进烂掉也照绿。
// 手工门禁是：
//     rustfmt --edition 2024 --check core/crates/bcut-subtitle-render/src/*.rs
include!("document.rs");
include!("caption_recipe.rs");
include!("caption_sequence.rs");
include!("transition.rs");
include!("render_plan.rs");
include!("raster.rs");
include!("text_motion_raster.rs");
include!("tests.rs");
