//! 单个 Timeline 元素 → DrawOp 指令。
//!
//! 这一层是 P6a 从 `core/crates/bcut-kernel/src/cmd/studio_export/render_plan.rs` 下沉过来的
//! **纯函数**部分：元素盒 + 仿射 + 三种矢量直出 kind（shape / visualizer /
//! progress）+ 缺频谱的占位块。函数体逐字搬迁，host 侧只剩「取数据、建视图、
//! 收诊断」三件事。
//!
//! ## 为什么必须是同一份代码而不是两份对齐的实现
//!
//! §10 P6 的验收标准是「同一 timeline + 同一 BCS1 + 同一 t，wasm 的
//! `fingerprintAt(t)` 与 CLI 的 DrawOp 指纹**逐位相同**」。两份实现互相对齐
//! 只能靠测试**发现**漂移；同一份实现让"逐位相同"变成结构性的——两边推进
//! 指令流的是同一个 `push_*`，指纹自然同源。
//!
//! ## host 要预先算好、这里不做的事
//!
//! * **频谱轨**（`VizTrack`）：读盘、派生、按元素 id 归并都在 host（ADR-E04
//!   的注入协议）。这里只收一个 `Option<&VizTrack>`。
//! * **采样时刻折算**：输出时刻 → 源媒体时刻要过
//!   [`timeline::TimelineProjection`]，投影表是 host 的（CLI 从项目读，
//!   wasm 侧当前没有投影表 ⇒ 传 `Some(time)`，与 CLI 无投影时的退化路径逐字
//!   相同）。这里只收一个 `Option<f64>`：`None` = 这一刻没有该音频源在播。
//! * **诊断去重**：`warn` 是个 sink，同一条诊断每帧都会命中，去重归 host。

use std::sync::Arc;

use anyhow::Result;

use crate::draw::{
    ElementBox, ElementPose, parse_color, push_draw_ops, push_media_placeholder_ops,
    push_placeholder_ops, push_shape_ops,
};
use crate::scene::SceneNode;
use render_raster::ShaderQuad;
use render_raster::drawop::{Color4, DrawOp, FrameBuilder, FrameOps, Mat6};
use render_raster::source::kernel::DrawBox;
use timeline::schema::{
    ConfettiProps, DrawProps, ElementKind, Place, PlaceholderProps, ProgressProps, ShapeProps,
    StickerProps, TimeValue, VisualizerProps, WhiteboardHand, WhiteboardPace, WhiteboardProps,
};

/// 画布尺寸。`u32` 而不是 `f64`：`short_edge` 与 `pixel_scale` 的折算口径由
/// `width.min(height)` 定义，先转成浮点再取 min 会在极端尺寸上换一个数。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Stage {
    pub width: u32,
    pub height: u32,
}

impl Stage {
    pub fn new(width: u32, height: u32) -> Self {
        Stage { width, height }
    }

    pub fn canvas(self) -> (f64, f64) {
        (f64::from(self.width), f64::from(self.height))
    }

    /// 像素单位配方参数（`strokeWidth` / `cornerRadius` / progress 的线宽）的
    /// 折算基准。参考短边的真相只有 [`timeline::REFERENCE_SHORT_EDGE`] 一处。
    pub fn short_edge(self) -> f64 {
        f64::from(self.width.min(self.height))
    }
}

/// 绘制一个元素所需的全部**契约**输入的借用视图。
///
/// host 各自的元素表（CLI 的 `TimelineVisualElement`、wasm 的
/// [`timeline::schema::Element`]）字段多寡不同，但绘制只读这几项；
/// 立一个借用视图比让本 crate 认识某一个 host 的结构体便宜得多。
#[derive(Debug, Clone, Copy)]
pub struct ElementDraw<'a> {
    pub id: &'a str,
    pub kind: ElementKind,
    pub start: f64,
    pub end: f64,
    pub place: &'a Place,
    pub shape: Option<&'a ShapeProps>,
    pub sticker: Option<&'a StickerProps>,
    pub visualizer: Option<&'a VisualizerProps>,
    pub progress: Option<&'a ProgressProps>,
    pub draw: Option<&'a DrawProps>,
    pub placeholder: Option<&'a PlaceholderProps>,
    /// `kind: "confetti"` 的参数（0.6，设计稿 `docs/design/elements/bcut-confetti-element-design.md`）。
    pub confetti: Option<&'a ConfettiProps>,
    /// `kind: "whiteboard"` 的参数（0.8，设计稿 `docs/design/video/bcut-whiteboard-animation-design.md`）。
    /// 绘制走 host 的光栅路径（同 image），这里只为 `element_aspect` 等契约保留。
    pub whiteboard: Option<&'a WhiteboardProps>,
    pub has_source: bool,
}

/// 诊断出口。host 负责去重与上浮（CLI 的 `warn_once`）。
pub type WarnSink<'a> = &'a mut dyn FnMut(String);

/// `visualizer` 的音频源 id。`VISUALIZER_AUDIO_DEFAULT` 是「跟着主音轨走」，
/// 落到 source 层就是 `main`。
pub fn visualizer_audio_source(props: &VisualizerProps) -> String {
    let audio = props.audio();
    if audio == timeline::schema::VISUALIZER_AUDIO_DEFAULT {
        "main".to_owned()
    } else {
        audio.to_owned()
    }
}

/// `draw` 缺省：`min(0.8 × 元素时长, 由分析推算的自然时长)`（ADR-WB05）。
/// 开放式片尾（`duration` 非有限）只取自然时长。结果至少 0.1 s。
pub fn whiteboard_draw_seconds(props: &WhiteboardProps, duration: f64, natural: f64) -> f64 {
    let draw = props.draw.unwrap_or_else(|| {
        if duration.is_finite() && duration > 0.0 {
            (duration * 0.8).min(natural)
        } else {
            natural
        }
    });
    draw.max(0.1)
}

/// `WhiteboardProps` → 渲染内核参数：`beats[].at` / `end`（元素本地秒）按 `draw` 归一化，
/// `pace` / `strict` 原样带过去，`draw` 作为 `natural` 换算秒的基准。
///
/// 词锚点写法的拍在这之前由宿主（`host_support::tracks_with_resolved_anchors`）解析成
/// 本地秒；到这里仍是锚点的拍（解析失败、或没有词表的路径）**整拍剔除**——它的 box
/// 里的笔画退回几何顺序，元素不消失。
pub fn whiteboard_params(
    props: &WhiteboardProps,
    draw: f64,
) -> render_raster::source::WhiteboardParams {
    let norm = |secs: f64| (secs / draw).clamp(0.0, 1.0);
    render_raster::source::WhiteboardParams {
        ink_first: props.ink_first(),
        beats: props
            .beats
            .iter()
            .flatten()
            .filter_map(|beat| {
                let at = beat.at_local()?;
                if matches!(beat.end, Some(TimeValue::Anchor(_))) {
                    return None;
                }
                Some(render_raster::source::WhiteboardBeat {
                    at: norm(at),
                    end: beat.end_local().map(norm),
                    rect: beat.rect,
                })
            })
            .collect(),
        pace: match props.pace() {
            WhiteboardPace::Stretch => render_raster::source::WhiteboardPace::Stretch,
            WhiteboardPace::Natural => render_raster::source::WhiteboardPace::Natural,
        },
        strict: props.strict(),
        draw_seconds: draw,
    }
}

/// `hand` 属性 → 内核的笔样式。
pub fn whiteboard_hand(props: &WhiteboardProps) -> render_raster::source::WhiteboardHand {
    match props.hand() {
        WhiteboardHand::Marker => render_raster::source::WhiteboardHand::Marker,
        WhiteboardHand::Pen => render_raster::source::WhiteboardHand::Pen,
        WhiteboardHand::None => render_raster::source::WhiteboardHand::None,
    }
}

/// `paper` 属性 → 纸色（非预乘 RGBA 0..1）；缺席或非法 = 透明。
pub fn whiteboard_paper(props: &WhiteboardProps) -> Option<Color4> {
    props
        .paper
        .as_deref()
        .and_then(|hex| crate::draw::parse_color(hex, 1.0))
}

/// 元素本地进度：`(time − start) / draw`，画完后恒为 1。
pub fn whiteboard_progress(element: &ElementDraw<'_>, time: f64, draw: f64) -> f64 {
    ((time - element.start) / draw).clamp(0.0, 1.0)
}

/// 目录型配方声明的 `aspect` → `timeline` 的几何默认表（ADR-E01）。
///
/// 只有 visualizer / progress 两种 kind 有这个维度；其余 kind 的高度由 shape /
/// sticker 分支决定，返回 `None`。样式没登记时也返回 `None`——几何按各自的
/// 横条类默认兜底，`preset-unknown` 的诊断由绘制分支给。
pub fn element_aspect(element: &ElementDraw<'_>) -> Option<timeline::ElementAspect> {
    use motion::preset_registry::{ProgressAspect, VisualizerAspect};
    use timeline::ElementAspect;
    match element.kind {
        ElementKind::Visualizer => {
            let recipe = motion::preset_registry::timeline_visualizer(&element.visualizer?.style)?;
            Some(match recipe.visualizer()?.aspect {
                VisualizerAspect::Free => ElementAspect::Free,
                VisualizerAspect::Square => ElementAspect::Square,
            })
        }
        ElementKind::Progress => {
            let recipe = motion::preset_registry::timeline_progress(&element.progress?.style)?;
            Some(match recipe.progress()?.aspect {
                ProgressAspect::Bar => ElementAspect::Bar,
                ProgressAspect::Square => ElementAspect::Square,
                ProgressAspect::Frame => ElementAspect::Frame,
            })
        }
        // confetti 恒为 `frame`（铺满画幅）；样式没登记时同样交给几何默认表。
        ElementKind::Confetti => {
            motion::preset_registry::timeline_confetti(&element.confetti?.style)?;
            Some(ElementAspect::Frame)
        }
        _ => None,
    }
}

/// 元素盒 + 仿射：几何全部来自 `timeline`（ADR-E01 的单一来源），
/// 舞台选中框与导出像素因此不可能算成两个盒子。
pub fn element_frame(
    element: &ElementDraw<'_>,
    pose: &timeline::AnimationPose,
    stage: Stage,
) -> (ElementBox, Mat6) {
    let canvas = stage.canvas();
    let geometry = timeline::ElementGeometry {
        shape: element.shape,
        sticker: element.sticker,
        // visualizer / progress 的 `aspect` 来自目录型配方（P2 起在注册表里）。
        // 不读它就会让 `ring_bars` / `circle` / `donut` 拿到横条类的
        // 默认盒——几何默认表与绘制端因此各说各话。
        aspect: element_aspect(element),
    };
    let (x, y, w, h) = timeline::static_box(element.kind, &geometry, Some(element.place), canvas);
    let bbox = ElementBox { x, y, w, h };
    let element_pose = ElementPose {
        dx: pose.dx,
        dy: pose.dy,
        scale_x: pose.scale_x,
        scale_y: pose.scale_y,
        rotation: pose.rotation,
    };
    let tf = crate::draw::element_transform(element.place, &element_pose, bbox, canvas);
    (bbox, tf)
}

pub fn element_opacity(element: &ElementDraw<'_>, pose: &timeline::AnimationPose) -> f64 {
    (element.place.opacity.unwrap_or(1.0) * pose.opacity).clamp(0.0, 1.0)
}

/// `kind: "shape"`：注册表的形状配方 + `ShapeProps` → 矢量直出。
pub fn push_shape_element(
    builder: &mut FrameBuilder,
    element: &ElementDraw<'_>,
    pose: &timeline::AnimationPose,
    stage: Stage,
    warn: WarnSink<'_>,
) {
    let Some(props) = element.shape else {
        return;
    };
    let Some(recipe) = motion::preset_registry::timeline_shape(&props.shape) else {
        // 注册表里没有这个 id = 文档引用了不存在的形状：`preset-unknown`
        // 的时机（§5.3），不是配方文件本身非法的 `manifest-invalid`。
        warn(format!(
            "元素 {} 引用了未登记的形状 {}（preset-unknown），已跳过渲染",
            element.id, props.shape
        ));
        return;
    };
    let opacity = element_opacity(element, pose);
    if opacity <= 0.001 {
        return;
    }
    let (bbox, tf) = element_frame(element, pose, stage);
    let short_edge = stage.short_edge();
    if push_shape_ops(builder, recipe, props, bbox, tf, opacity, short_edge) == 0 {
        warn(format!(
            "元素 {} 的形状 {} 既没有 fill 也没有 stroke，画不出任何东西",
            element.id, props.shape
        ));
    }
}

/// `kind: "sticker"` 且 `source == "template"`：注册表的模板配方 → 矢量直出。
///
/// **只认 `template` 源**。`asset` 源（PNG / JPEG / SVG / 带 alpha 的循环
/// WebM）要先解码再发 `DrawMedia`，那需要图像解码器与 ffmpeg，归 host——
/// 与 `image` / `video` 同一条路径。返回 `false` 就是"本 crate 不认领"。
///
/// 元素盒是**正方**（`element_height` 的 sticker 缺省），模板几何也画在单位
/// 正方里，因此不需要 `element_aspect` 那条配方问询。
pub fn push_sticker_element(
    builder: &mut FrameBuilder,
    element: &ElementDraw<'_>,
    pose: &timeline::AnimationPose,
    stage: Stage,
    warn: WarnSink<'_>,
) -> bool {
    let Some(props) = element.sticker else {
        return false;
    };
    if props.source != timeline::schema::STICKER_SOURCE_TEMPLATE {
        return false;
    }
    let Some(template_id) = props.template_id.as_deref() else {
        warn(format!(
            "元素 {} 的 sticker.source=template 但没有 templateId，已跳过渲染",
            element.id
        ));
        return true;
    };
    let Some(recipe) = motion::preset_registry::timeline_sticker(template_id) else {
        // 与 shape / visualizer 同一时机同一码：文档引用了注册表里没有的模板。
        warn(format!(
            "元素 {} 引用了未登记的贴纸模板 {template_id}（preset-unknown），已跳过渲染",
            element.id
        ));
        return true;
    };
    let opacity = element_opacity(element, pose);
    if opacity <= 0.001 {
        return true;
    }
    let (bbox, tf) = element_frame(element, pose, stage);
    crate::draw::push_sticker_ops(builder, recipe, props, bbox, tf, opacity);
    true
}

enum ResolvedElement<T> {
    Ready(T),
    Placeholder,
    Skip,
}

struct VisualizerInput {
    recipe: &'static motion::preset_registry::CatalogueRecipe,
    params: render_raster::source::VisualizerParams,
    frame: render_raster::source::VizFrame,
    bbox: ElementBox,
    affine: Mat6,
    local_time: f64,
}

struct ProgressInput {
    recipe: &'static motion::preset_registry::CatalogueRecipe,
    params: render_raster::source::ProgressParams,
    progress: f64,
    bbox: ElementBox,
    affine: Mat6,
    local_time: f64,
}

struct ConfettiInput {
    recipe: &'static motion::preset_registry::CatalogueRecipe,
    params: render_raster::source::ConfettiParams,
    bbox: ElementBox,
    affine: Mat6,
    local_time: f64,
    /// 元素时长（`emit.settle` 用）；开放式片尾 `None`。
    duration: Option<f64>,
}

fn resolved_color(explicit: Option<&str>, fallback: &str, opacity: f64) -> [f32; 4] {
    explicit
        .and_then(|value| parse_color(value, opacity))
        .or_else(|| parse_color(fallback, opacity))
        .unwrap_or([1.0, 1.0, 1.0, opacity as f32])
}

fn resolve_visualizer(
    element: &ElementDraw<'_>,
    time: f64,
    pose: &timeline::AnimationPose,
    stage: Stage,
    track: Option<&render_raster::source::VizTrack>,
    source_time: Option<f64>,
    warn: WarnSink<'_>,
) -> ResolvedElement<VisualizerInput> {
    let Some(props) = element.visualizer else {
        return ResolvedElement::Skip;
    };
    let Some(recipe) = motion::preset_registry::timeline_visualizer(&props.style) else {
        warn(format!(
            "元素 {} 引用了未登记的波形样式 {}（preset-unknown），已跳过渲染",
            element.id, props.style
        ));
        return ResolvedElement::Skip;
    };
    let opacity = element_opacity(element, pose);
    if opacity <= 0.001 {
        return ResolvedElement::Skip;
    }
    let Some(track) = track else {
        // preflight 缺频谱是硬错误（host 的 `load_visualizer_tracks`），走到这里
        // 只能是「没经过 preflight 的计划」——单测里的 `compile_with` 就是这样。
        warn(format!("元素 {} 没有注入频谱轨，已画占位块", element.id));
        return ResolvedElement::Placeholder;
    };
    let frame = match source_time {
        Some(source_time) => {
            let Some(frame) = render_raster::source::VizSource::sample(track, source_time) else {
                warn(format!("元素 {} 的频谱轨是空的，已画占位块", element.id));
                return ResolvedElement::Placeholder;
            };
            frame.clone()
        }
        None => track.silent_frame(),
    };
    let body = recipe
        .visualizer()
        .expect("visualizer 目录里只有 visualizer 配方");
    let params = render_raster::source::VisualizerParams {
        main_color: resolved_color(
            props.main_color.as_deref(),
            &body.default_main_color,
            opacity,
        ),
        secondary_color: resolved_color(
            props.secondary_color.as_deref(),
            &body.default_secondary_color,
            opacity,
        ),
    };
    let (bbox, affine) = element_frame(element, pose, stage);
    ResolvedElement::Ready(VisualizerInput {
        recipe,
        params,
        frame,
        bbox,
        affine,
        // 元素本地时刻（scanline/noise 相位）只由自己的 start 决定。
        local_time: (time - element.start).max(0.0),
    })
}

fn resolve_progress(
    element: &ElementDraw<'_>,
    time: f64,
    pose: &timeline::AnimationPose,
    stage: Stage,
    warn: WarnSink<'_>,
) -> ResolvedElement<ProgressInput> {
    let Some(props) = element.progress else {
        return ResolvedElement::Skip;
    };
    let Some(recipe) = motion::preset_registry::timeline_progress(&props.style) else {
        warn(format!(
            "元素 {} 引用了未登记的进度样式 {}（preset-unknown），已跳过渲染",
            element.id, props.style
        ));
        return ResolvedElement::Skip;
    };
    let opacity = element_opacity(element, pose);
    if opacity <= 0.001 {
        return ResolvedElement::Skip;
    }
    let body = recipe
        .progress()
        .expect("progress 目录里只有 progress 配方");
    let params = render_raster::source::ProgressParams {
        main_color: resolved_color(
            props.main_color.as_deref(),
            &body.default_main_color,
            opacity,
        ),
        secondary_color: resolved_color(
            props.secondary_color.as_deref(),
            &body.default_secondary_color,
            opacity,
        ),
        pixel_scale: stage.short_edge() / timeline::REFERENCE_SHORT_EDGE,
    };
    let (bbox, affine) = element_frame(element, pose, stage);
    ResolvedElement::Ready(ProgressInput {
        recipe,
        params,
        progress: props.remap(timeline::progress_at(time, element.start, element.end)),
        bbox,
        affine,
        local_time: (time - element.start).max(0.0),
    })
}

fn resolve_confetti(
    element: &ElementDraw<'_>,
    time: f64,
    pose: &timeline::AnimationPose,
    stage: Stage,
    warn: WarnSink<'_>,
) -> ResolvedElement<ConfettiInput> {
    use render_raster::source::{ConfettiEmitMode, ConfettiEmitOverride, ConfettiShape};
    let Some(props) = element.confetti else {
        return ResolvedElement::Skip;
    };
    let Some(recipe) = motion::preset_registry::timeline_confetti(&props.style) else {
        warn(format!(
            "元素 {} 引用了未登记的彩纸样式 {}（preset-unknown），已跳过渲染",
            element.id, props.style
        ));
        return ResolvedElement::Skip;
    };
    let opacity = element_opacity(element, pose) * props.opacity.unwrap_or(1.0);
    if opacity <= 0.001 {
        return ResolvedElement::Skip;
    }
    let body = recipe
        .confetti()
        .expect("confetti 目录里只有 confetti 配方");
    // 色板 / 形状表：用户写了就整表替换，否则用配方的。`validate` 已保证非空，
    // 这里对单个坏值只做跳过（解析不出的颜色不画、未知形状不画）。
    let color_names: &[String] = match &props.colors {
        Some(colors) if !colors.is_empty() => colors,
        _ => &body.palette,
    };
    let colors: Vec<[f32; 4]> = color_names
        .iter()
        .filter_map(|c| parse_color(c, 1.0))
        .collect();
    let shape_names: &[String] = match &props.shapes {
        Some(shapes) if !shapes.is_empty() => shapes,
        _ => &body.shapes,
    };
    let shapes: Vec<ConfettiShape> = shape_names
        .iter()
        .filter_map(|s| ConfettiShape::parse(s))
        .collect();
    if colors.is_empty() || shapes.is_empty() {
        return ResolvedElement::Skip;
    }
    let emit = props.emit.as_ref();
    let params = render_raster::source::ConfettiParams {
        seed: props.seed.unwrap_or(0),
        colors,
        shapes,
        size: props.size.unwrap_or(1.0),
        speed: props.speed.unwrap_or(1.0),
        gravity: props.gravity.unwrap_or(1.0),
        drift: props.drift.unwrap_or(1.0),
        spin: props.spin.unwrap_or(1.0),
        wind: props.wind.unwrap_or(0.0),
        opacity,
        emit: ConfettiEmitOverride {
            mode: emit.and_then(|e| e.mode).map(|m| match m {
                timeline::schema::ConfettiEmitMode::Continuous => ConfettiEmitMode::Continuous,
                timeline::schema::ConfettiEmitMode::Burst => ConfettiEmitMode::Burst,
            }),
            rate: emit.and_then(|e| e.rate),
            count: emit
                .and_then(|e| e.count)
                .map(|c| c.round().max(1.0) as u64),
            interval: emit.and_then(|e| e.interval),
            settle: emit.and_then(|e| e.settle).unwrap_or(false),
        },
        origin: props.origin.as_ref().map(|o| (o.x, o.y)),
        angle: props.angle,
        spread: props.spread,
        pixel_scale: stage.short_edge() / timeline::REFERENCE_SHORT_EDGE,
    };
    let (bbox, affine) = element_frame(element, pose, stage);
    let span = element.end - element.start;
    ResolvedElement::Ready(ConfettiInput {
        recipe,
        params,
        bbox,
        affine,
        local_time: time - element.start,
        duration: (span.is_finite() && span > 0.0).then_some(span),
    })
}

fn push_confetti_reference(builder: &mut FrameBuilder, input: &ConfettiInput) {
    // 空帧（还没发射 / 已全部落完）合法地零条指令。
    let _ = render_raster::source::confetti_frame(
        builder,
        input.recipe,
        &input.params,
        input.local_time,
        input.duration,
        render_raster::source::ConfettiBox {
            x: input.bbox.x,
            y: input.bbox.y,
            w: input.bbox.w,
            h: input.bbox.h,
        },
        input.affine,
    );
}

/// `kind: "confetti"`：`confetti-v1` 闭式运动核 → 矢量直出（设计稿 §5）。
///
/// 与 progress 同一条通路：CPU 发 `ClipPath + FillPath × N + PopClip`，GPU 端
/// 自动落 `SceneNode::Vectors`；本地时刻 = `t − start`，粒子表只由它与
/// `seed` 决定，因此乱序采样 == 顺序采样。
pub fn push_confetti_element(
    builder: &mut FrameBuilder,
    element: &ElementDraw<'_>,
    time: f64,
    pose: &timeline::AnimationPose,
    stage: Stage,
    warn: WarnSink<'_>,
) {
    if let ResolvedElement::Ready(input) = resolve_confetti(element, time, pose, stage, warn) {
        push_confetti_reference(builder, &input);
    }
}

fn push_visualizer_reference(builder: &mut FrameBuilder, input: &VisualizerInput) {
    // 10 款声波静音时各有自己的静止形态（柱子留 minHeight、示波器留中线…），
    // bcut-render 的 golden 逐款钉住；但退化盒（零宽高）合法返回 0 条指令。
    // 配方是否实现完整由那边的目录测试保证，不拿一帧的指令数当运行期不变量。
    let _ = render_raster::source::visualizer_frame(
        builder,
        input.recipe,
        &input.params,
        &input.frame,
        input.local_time,
        render_raster::source::VizBox {
            x: input.bbox.x,
            y: input.bbox.y,
            w: input.bbox.w,
            h: input.bbox.h,
        },
        input.affine,
    );
}

fn push_progress_reference(builder: &mut FrameBuilder, input: &ProgressInput) {
    // `pushed == 0` 只可能是无背景 strobe 在自己的空端点，属于合法画面。
    let _ = render_raster::source::progress_frame(
        builder,
        input.recipe,
        &input.params,
        input.progress,
        input.local_time,
        render_raster::source::ProgressBox {
            x: input.bbox.x,
            y: input.bbox.y,
            w: input.bbox.w,
            h: input.bbox.h,
        },
        input.affine,
    );
}

/// `visualizer`：注入的 [`render_raster::source::VizTrack`] 采样 → 配方绘制。
///
/// 数据链路在 P2 走通（BCS1 在 preflight 读好、整轨派生好、按元素 id 注入好），
/// P3–P5b 逐族填实绘制。**P5b 之后 15 种全部有实现**，因此这里只剩"没有注入
/// 频谱轨 / 频谱轨是空的"这两种真实故障才落回占位块——留空会让「我加的波形
/// 没画出来」和「这个项目的频谱没准备好」在画面上无法区分。
///
/// ## 采样时刻（P3 定案）
///
/// `audio: "project"` 的语义是「观众此刻听到的声音」，而 BCS1 是按**整条源
/// 媒体**算的。因此输出时刻 `time` 必须先经
/// [`timeline::TimelineProjection::timeline_to_source`] 折算回源媒体时刻，
/// 再取帧——剪切过的项目里输出第 7 秒可能对应源媒体的第 12 秒，直接拿输出
/// 时刻查表就会画出「几秒前的声音」。折算是 host 的活，结果由 `source_time`
/// 传进来；`None` = 折算不到本元素那条音频源（落在剪掉的空隙里、或该时刻在
/// 播另一条源），按**静音帧**处理：柱状样式的 `max(freq, minHeight)` 会画成
/// 一排小柱子，与真实静音段的观感一致。
///
/// 平滑递推**不受影响**：它在 host preflight 沿源媒体时间轴整轨算完一次
/// （`VizTrack::derive`），采样期只剩查表，因此确定性与乱序采样的契约不变。
pub fn push_visualizer_element(
    builder: &mut FrameBuilder,
    element: &ElementDraw<'_>,
    time: f64,
    pose: &timeline::AnimationPose,
    stage: Stage,
    track: Option<&render_raster::source::VizTrack>,
    source_time: Option<f64>,
    warn: WarnSink<'_>,
) {
    match resolve_visualizer(element, time, pose, stage, track, source_time, warn) {
        ResolvedElement::Ready(input) => push_visualizer_reference(builder, &input),
        ResolvedElement::Placeholder => {
            push_element_placeholder(builder, element, pose, stage, warn)
        }
        ResolvedElement::Skip => {}
    }
}

/// `kind: "progress"`：进度值 + 目录型配方 → 矢量直出。
///
/// 进度值走 [`timeline::progress_at`]（ADR-E04 的
/// `clamp((t − start) / (end − start), 0, 1)`）。
pub fn push_progress_element(
    builder: &mut FrameBuilder,
    element: &ElementDraw<'_>,
    time: f64,
    pose: &timeline::AnimationPose,
    stage: Stage,
    warn: WarnSink<'_>,
) {
    if let ResolvedElement::Ready(input) = resolve_progress(element, time, pose, stage, warn) {
        push_progress_reference(builder, &input);
    }
}

pub fn push_draw_element(
    builder: &mut FrameBuilder,
    element: &ElementDraw<'_>,
    pose: &timeline::AnimationPose,
    stage: Stage,
) {
    let Some(props) = element.draw else {
        return;
    };
    let opacity = element_opacity(element, pose);
    if opacity <= 0.001 {
        return;
    }
    let (bbox, tf) = element_frame(element, pose, stage);
    push_draw_ops(builder, props, bbox, tf, opacity, stage.short_edge());
}

pub fn push_placeholder_element(
    builder: &mut FrameBuilder,
    element: &ElementDraw<'_>,
    pose: &timeline::AnimationPose,
    stage: Stage,
) -> bool {
    if element.has_source {
        return false;
    }
    let Some(props) = element.placeholder else {
        return true;
    };
    let opacity = element_opacity(element, pose);
    if opacity <= 0.001 {
        return true;
    }
    let (bbox, tf) = element_frame(element, pose, stage);
    push_media_placeholder_ops(builder, props, bbox, tf, opacity);
    true
}

/// `visualizer` 缺频谱数据时的占位：主色（缺省半透明白）铺满元素盒。
///
/// **刻意不留空**——留空会让「我加的波形没画出来」和「这个项目的频谱没准备
/// 好」在画面上无法区分。P5b 之后 29 个样式全部有绘制实现，走到这里只剩
/// 「没有注入频谱轨」「频谱轨是空的」两种真实故障（`progress` 不吃素材，
/// 因此永远不会走到这里）。
pub fn push_element_placeholder(
    builder: &mut FrameBuilder,
    element: &ElementDraw<'_>,
    pose: &timeline::AnimationPose,
    stage: Stage,
    warn: WarnSink<'_>,
) {
    let opacity = element_opacity(element, pose) * 0.35;
    if opacity <= 0.001 {
        return;
    }
    let (style, main_color) = match element.kind {
        ElementKind::Visualizer => match element.visualizer {
            Some(props) => (props.style.clone(), props.main_color.clone()),
            None => return,
        },
        _ => match element.progress {
            Some(props) => (props.style.clone(), props.main_color.clone()),
            None => return,
        },
    };
    warn(format!(
        "元素 {} 的 {} 样式 {style} 没有可用的频谱数据，已画占位块",
        element.id,
        element.kind.as_str()
    ));
    let color = main_color
        .as_deref()
        .and_then(|color| parse_color(color, opacity))
        .unwrap_or([1.0, 1.0, 1.0, opacity as f32]);
    let (bbox, tf) = element_frame(element, pose, stage);
    push_placeholder_ops(builder, bbox, tf, color);
}

/// 按 kind 分派：矢量直出的走这里，其余（text / image / video / audio 与
/// **asset 源的 sticker**）由 host 自己的光栅化路径处理，本函数原样跳过。
///
/// 返回 `true` = 这个元素由本 crate 负责。host 用它做显式分派而不是靠
/// `match` 抄一遍 kind 表。**sticker 是唯一按 props 而不是按 kind 认领的**：
/// 同一个 kind 的两种 `source` 走两条完全不同的通路（P7b）。
pub fn push_element(
    builder: &mut FrameBuilder,
    element: &ElementDraw<'_>,
    time: f64,
    pose: &timeline::AnimationPose,
    stage: Stage,
    track: Option<&render_raster::source::VizTrack>,
    source_time: Option<f64>,
    warn: WarnSink<'_>,
) -> bool {
    match element.kind {
        ElementKind::Shape => {
            push_shape_element(builder, element, pose, stage, warn);
            true
        }
        ElementKind::Visualizer => {
            push_visualizer_element(
                builder,
                element,
                time,
                pose,
                stage,
                track,
                source_time,
                warn,
            );
            true
        }
        ElementKind::Progress => {
            push_progress_element(builder, element, time, pose, stage, warn);
            true
        }
        ElementKind::Confetti => {
            push_confetti_element(builder, element, time, pose, stage, warn);
            true
        }
        ElementKind::Draw => {
            push_draw_element(builder, element, pose, stage);
            true
        }
        ElementKind::Placeholder => push_placeholder_element(builder, element, pose, stage),
        ElementKind::Sticker => push_sticker_element(builder, element, pose, stage, warn),
        // whiteboard 与 image 同路：host 光栅化（`render_media_element` 里做揭示）。
        ElementKind::Text
        | ElementKind::Image
        | ElementKind::Video
        | ElementKind::Audio
        | ElementKind::Whiteboard => false,
    }
}

/// 单个元素在实时场景里的执行节点，以及与现有 CPU/三端指纹完全同源的
/// DrawOp reference。`reference` 只做一致性、回退与指纹；GPU 节点不会把它
/// 光栅成整幅位图。
#[derive(Debug, Clone)]
pub struct EvaluatedSceneElement {
    pub node: Option<SceneNode>,
    pub reference: Arc<FrameOps>,
}

impl EvaluatedSceneElement {
    /// 把本元素已经求出的 reference 合并进整帧指纹流。这里只重映射四张侧表，
    /// 不再调用元素配方；SceneFrame 因此既保留逐节点 z 序，又不会为了指纹把
    /// visualizer/progress 再求值一次。reference 是完整 DrawOp 语义，不应被 GPU
    /// 执行器当前支持的子集反向限制（圆角 progress 本来就含 ClipPath）。
    pub fn append_reference_to(&self, builder: &mut FrameBuilder) -> Result<()> {
        let path_ids = self
            .reference
            .paths
            .iter()
            .cloned()
            .map(|path| builder.path_id(path))
            .collect::<Vec<_>>();
        let string_ids = self
            .reference
            .strings
            .iter()
            .map(|value| builder.string_id(value))
            .collect::<Vec<_>>();
        let paint_ids = self
            .reference
            .paints
            .iter()
            .cloned()
            .map(|paint| builder.paint_id(paint))
            .collect::<Vec<_>>();
        let bitmap_ids = self
            .reference
            .bitmaps
            .iter()
            .cloned()
            .map(|bitmap| builder.bitmap_id(bitmap))
            .collect::<Vec<_>>();
        for op in &self.reference.ops {
            let remapped = match op {
                DrawOp::Clear { .. }
                | DrawOp::FillRect { .. }
                | DrawOp::PushLayer { .. }
                | DrawOp::PopLayer
                | DrawOp::PopClip
                | DrawOp::PushMatte
                | DrawOp::PopMatte { .. } => op.clone(),
                DrawOp::FillPath { path, color, tf } => DrawOp::FillPath {
                    path: *path_ids.get(*path as usize).ok_or_else(|| {
                        anyhow::anyhow!("scene reference FillPath 引用未知 path {path}")
                    })?,
                    color: *color,
                    tf: *tf,
                },
                DrawOp::StrokePath {
                    path,
                    color,
                    width,
                    tf,
                } => DrawOp::StrokePath {
                    path: *path_ids.get(*path as usize).ok_or_else(|| {
                        anyhow::anyhow!("scene reference StrokePath 引用未知 path {path}")
                    })?,
                    color: *color,
                    width: *width,
                    tf: *tf,
                },
                DrawOp::DrawMedia {
                    asset,
                    media_ms,
                    src,
                    tf,
                } => DrawOp::DrawMedia {
                    asset: *string_ids.get(*asset as usize).ok_or_else(|| {
                        anyhow::anyhow!("scene reference DrawMedia 引用未知 asset {asset}")
                    })?,
                    media_ms: *media_ms,
                    src: *src,
                    tf: *tf,
                },
                DrawOp::ClipPath { path, tf } => DrawOp::ClipPath {
                    path: *path_ids.get(*path as usize).ok_or_else(|| {
                        anyhow::anyhow!("scene reference ClipPath 引用未知 path {path}")
                    })?,
                    tf: *tf,
                },
                DrawOp::FillPathPaint {
                    path,
                    paint,
                    even_odd,
                    tf,
                } => DrawOp::FillPathPaint {
                    path: *path_ids.get(*path as usize).ok_or_else(|| {
                        anyhow::anyhow!("scene reference FillPathPaint 引用未知 path {path}")
                    })?,
                    paint: *paint_ids.get(*paint as usize).ok_or_else(|| {
                        anyhow::anyhow!("scene reference FillPathPaint 引用未知 paint {paint}")
                    })?,
                    even_odd: *even_odd,
                    tf: *tf,
                },
                DrawOp::StrokePathPaint {
                    path,
                    paint,
                    width,
                    cap,
                    join,
                    miter,
                    tf,
                } => DrawOp::StrokePathPaint {
                    path: *path_ids.get(*path as usize).ok_or_else(|| {
                        anyhow::anyhow!("scene reference StrokePathPaint 引用未知 path {path}")
                    })?,
                    paint: *paint_ids.get(*paint as usize).ok_or_else(|| {
                        anyhow::anyhow!("scene reference StrokePathPaint 引用未知 paint {paint}")
                    })?,
                    width: *width,
                    cap: *cap,
                    join: *join,
                    miter: *miter,
                    tf: *tf,
                },
                DrawOp::DrawBitmap {
                    bitmap,
                    opacity,
                    tf,
                } => DrawOp::DrawBitmap {
                    bitmap: *bitmap_ids.get(*bitmap as usize).ok_or_else(|| {
                        anyhow::anyhow!("scene reference DrawBitmap 引用未知 bitmap {bitmap}")
                    })?,
                    opacity: *opacity,
                    tf: *tf,
                },
            };
            builder.push(remapped);
        }
        Ok(())
    }
}

/// 以同一份元素输入同时求出 CPU reference 与实时 GPU 节点。
///
/// shape/template sticker 继续作为矢量 DrawOp；progress 变成 `ShaderQuad`；
/// visualizer 10 款全部是 CPU 矢量配方，与 shape 一样落 `SceneNode::Vectors`，
/// 缺频谱等降级场景原样使用 CPU 占位 DrawOp。text/image/video/audio 与 asset
/// sticker 返回 `None`，明确留给 host/R2/R4，不静默吞进 R1。
#[allow(clippy::too_many_arguments)]
pub fn evaluate_scene_element(
    element: &ElementDraw<'_>,
    time: f64,
    pose: &timeline::AnimationPose,
    stage: Stage,
    track: Option<&render_raster::source::VizTrack>,
    source_time: Option<f64>,
    warn: WarnSink<'_>,
) -> Result<Option<EvaluatedSceneElement>> {
    let mut builder = FrameBuilder::default();
    let shader = match element.kind {
        ElementKind::Visualizer => {
            match resolve_visualizer(element, time, pose, stage, track, source_time, warn) {
                ResolvedElement::Ready(input) => {
                    push_visualizer_reference(&mut builder, &input);
                    None
                }
                ResolvedElement::Placeholder => {
                    push_element_placeholder(&mut builder, element, pose, stage, warn);
                    None
                }
                ResolvedElement::Skip => None,
            }
        }
        ElementKind::Progress => match resolve_progress(element, time, pose, stage, warn) {
            ResolvedElement::Ready(input) => {
                push_progress_reference(&mut builder, &input);
                let quad = ShaderQuad::progress(
                    input.recipe,
                    &input.params,
                    input.progress,
                    input.local_time,
                    DrawBox {
                        x: input.bbox.x,
                        y: input.bbox.y,
                        w: input.bbox.w,
                        h: input.bbox.h,
                    },
                    stage.canvas(),
                )?;
                Some(SceneNode::affine_shader_quad(
                    quad,
                    input.affine,
                    stage.canvas(),
                ))
            }
            ResolvedElement::Placeholder | ResolvedElement::Skip => None,
        },
        _ => {
            if !push_element(
                &mut builder,
                element,
                time,
                pose,
                stage,
                track,
                source_time,
                warn,
            ) {
                return Ok(None);
            }
            None
        }
    };
    let reference = Arc::new(builder.finish());
    let node = shader
        .or_else(|| (!reference.ops.is_empty()).then(|| SceneNode::Vectors(reference.clone())));
    Ok(Some(EvaluatedSceneElement { node, reference }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use timeline::AnimationPose;

    /// ADR-WB05 的缺省画时一字不改：12 s 的条、4 s 自然画时 → 画 4 s；条短时取 0.8 × 时长。
    /// 0.9 缺省（无 beats、`pace` 缺席）换算出的内核参数就是 0.8 的几何顺序 + stretch。
    #[test]
    fn whiteboard_default_draw_and_params_are_unchanged_by_0_9() {
        let props = WhiteboardProps::default();
        assert_eq!(whiteboard_draw_seconds(&props, 12.0, 4.0), 4.0);
        assert_eq!(whiteboard_draw_seconds(&props, 4.0, 4.0), 3.2);
        assert_eq!(whiteboard_draw_seconds(&props, f64::INFINITY, 4.0), 4.0);
        let params = whiteboard_params(&props, 4.0);
        assert!(params.beats.is_empty());
        assert_eq!(params.pace, render_raster::source::WhiteboardPace::Stretch);
        assert!(!params.strict);
        assert_eq!(params.draw_seconds, 4.0);
        assert!(!params.needs_second_pass());
        let baseline = params.clone().beats_cleared();
        assert_eq!(baseline.draw_seconds, 0.0);
        assert!(baseline.beats.is_empty());
    }

    /// 0.9：`end` 与 `at` 同按 `draw` 归一化；仍是锚点的拍整拍剔除；`pace` / `strict` 带过去。
    #[test]
    fn whiteboard_params_normalize_end_and_drop_unresolved_anchor_beats() {
        let props: WhiteboardProps = serde_json::from_value(serde_json::json!({
            "draw": 8.0,
            "pace": "natural",
            "strict": true,
            "beats": [
                {"at": 0.0, "end": 2.0, "box": [0, 0, 50, 100]},
                {"at": "~main:g1.3:start", "box": [50, 0, 50, 100]},
                {"at": 4.0, "end": "~main:g1.9:end", "box": [0, 50, 100, 50]},
                {"at": 6.0, "box": [0, 0, 100, 100]}
            ]
        }))
        .unwrap();
        let params = whiteboard_params(&props, 8.0);
        assert_eq!(params.pace, render_raster::source::WhiteboardPace::Natural);
        assert!(params.strict);
        assert_eq!(params.draw_seconds, 8.0);
        assert_eq!(params.beats.len(), 2);
        assert_eq!(params.beats[0].at, 0.0);
        assert_eq!(params.beats[0].end, Some(0.25));
        assert_eq!(params.beats[1].at, 0.75);
        assert_eq!(params.beats[1].end, None);
        assert!(params.needs_second_pass());
    }

    fn pose() -> AnimationPose {
        timeline::resolve_animation_pose(None, 0.0, Some(4.0), 4.0, 1.0, 30.0)
    }

    fn shape_props(shape: &str) -> ShapeProps {
        let mut props = ShapeProps::new(shape);
        props.fill = Some("#ff0000".to_owned());
        props
    }

    fn view<'a>(
        id: &'a str,
        kind: ElementKind,
        place: &'a Place,
        shape: Option<&'a ShapeProps>,
        visualizer: Option<&'a VisualizerProps>,
        progress: Option<&'a ProgressProps>,
    ) -> ElementDraw<'a> {
        ElementDraw {
            id,
            kind,
            start: 0.0,
            end: 4.0,
            place,
            shape,
            sticker: None,
            visualizer,
            progress,
            draw: None,
            placeholder: None,
            confetti: None,
            whiteboard: None,
            has_source: false,
        }
    }

    /// 未登记的样式 = `preset-unknown`：一条诊断、零指令。
    #[test]
    fn an_unregistered_style_warns_and_draws_nothing() {
        let place = Place::default();
        let props = shape_props("no-such-shape");
        let element = view("e1", ElementKind::Shape, &place, Some(&props), None, None);
        let mut builder = FrameBuilder::default();
        let mut warnings = Vec::new();
        push_shape_element(
            &mut builder,
            &element,
            &pose(),
            Stage::new(1920, 1080),
            &mut |message| warnings.push(message),
        );
        assert!(builder.frame.ops.is_empty());
        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].contains("preset-unknown"), "{}", warnings[0]);
    }

    /// `aspect` 决定几何默认表那一档：方形样式的盒子必须是正方形，横条样式不是。
    #[test]
    fn the_recipe_aspect_picks_the_geometry_default() {
        let place = Place::default();
        let square = VisualizerProps::new("ring_bars");
        let bar = VisualizerProps::new("bars");
        let stage = Stage::new(1920, 1080);
        let (square_box, _) = element_frame(
            &view(
                "a",
                ElementKind::Visualizer,
                &place,
                None,
                Some(&square),
                None,
            ),
            &pose(),
            stage,
        );
        let (bar_box, _) = element_frame(
            &view("b", ElementKind::Visualizer, &place, None, Some(&bar), None),
            &pose(),
            stage,
        );
        // 两档的默认盒**必须不同**：不读 `aspect` 就会让 `ring_bars`
        // 拿到横条类的盒，几何默认表与绘制端从此各说各话。
        assert_ne!(
            (square_box.w, square_box.h),
            (bar_box.w, bar_box.h),
            "square 与 free 两档必须落在几何默认表的不同一行"
        );
        // `square` 档更高、且垂直居中；`free` 档是贴底的横条。
        assert!(
            square_box.h > bar_box.h && square_box.y < bar_box.y,
            "square 档应更高且不贴底：{square_box:?} / {bar_box:?}"
        );
    }

    /// 没有注入频谱轨 ⇒ 两条诊断 + 一块占位（不是留空）。
    #[test]
    fn a_visualizer_without_a_track_falls_back_to_the_placeholder_block() {
        let place = Place::default();
        let props = VisualizerProps::new("bars");
        let element = view(
            "v1",
            ElementKind::Visualizer,
            &place,
            None,
            Some(&props),
            None,
        );
        let mut builder = FrameBuilder::default();
        let mut warnings = Vec::new();
        push_visualizer_element(
            &mut builder,
            &element,
            1.0,
            &pose(),
            Stage::new(1920, 1080),
            None,
            Some(1.0),
            &mut |message| warnings.push(message),
        );
        assert_eq!(builder.frame.ops.len(), 1, "占位块是一条 FillRect");
        assert_eq!(warnings.len(), 2);
        assert!(warnings[0].contains("没有注入频谱轨"));
        assert!(warnings[1].contains("没有可用的频谱数据"));
    }

    /// 静音帧画的是各款的**静止形态**（示波器中线、丝带中线、频谱面积的
    /// `minHeight` 底边），不是空画面；同一条轨后面的非静音帧仍必须正常出图。
    /// 元素在片头 / 无声段不会从画布上消失，也不会把静止形态误当成“配方未实现”
    /// 去杀 App 的 overlay 线程。
    #[test]
    fn silent_frames_draw_the_resting_shape_and_loud_frames_still_draw() {
        use render_raster::source::{VizFrame, VizParams, VizTrack};

        let track = VizTrack::assemble(
            10,
            vec![
                VizFrame::silent(128, 512),
                VizFrame {
                    time: vec![128; 128].into_boxed_slice(),
                    freq: vec![220; 512].into_boxed_slice(),
                },
            ],
            VizParams {
                min_db: -80.0,
                max_db: 40.0,
                smoothing: 0.0,
                gain: 1.0,
            },
            0,
        )
        .unwrap();
        let place = Place::default();
        let stage = Stage::new(1920, 1080);
        for style in ["oscilloscope", "ribbons", "spectrum_area"] {
            let props = VisualizerProps::new(style);
            let element = view(
                "v1",
                ElementKind::Visualizer,
                &place,
                None,
                Some(&props),
                None,
            );

            let mut silent = FrameBuilder::default();
            assert!(push_element(
                &mut silent,
                &element,
                0.0,
                &pose(),
                stage,
                Some(&track),
                Some(0.0),
                &mut |_| {},
            ));
            assert!(!silent.frame.ops.is_empty(), "{style}: 静音也要画静止形态");

            let mut loud = FrameBuilder::default();
            assert!(push_element(
                &mut loud,
                &element,
                0.1,
                &pose(),
                stage,
                Some(&track),
                Some(0.1),
                &mut |_| {},
            ));
            assert!(!loud.frame.ops.is_empty(), "{style}");
        }
    }

    /// `progress` 不吃素材：不给任何轨也画得出真实画面。
    #[test]
    fn a_progress_element_draws_without_any_injected_data() {
        let place = Place::default();
        let props = ProgressProps::new("normal");
        let element = view(
            "p1",
            ElementKind::Progress,
            &place,
            None,
            None,
            Some(&props),
        );
        let mut builder = FrameBuilder::default();
        let mut warnings = Vec::new();
        push_progress_element(
            &mut builder,
            &element,
            2.0,
            &pose(),
            Stage::new(1920, 1080),
            &mut |message| warnings.push(message),
        );
        assert!(!builder.frame.ops.is_empty());
        assert!(warnings.is_empty(), "{warnings:?}");
    }

    #[test]
    fn scene_evaluation_keeps_the_cpu_reference_and_emits_an_affine_shader_quad() {
        let place = Place {
            rot: Some(30.0),
            ..Place::default()
        };
        let props = ProgressProps::new("normal");
        let element = view(
            "p1",
            ElementKind::Progress,
            &place,
            None,
            None,
            Some(&props),
        );
        let evaluated = evaluate_scene_element(
            &element,
            2.0,
            &pose(),
            Stage::new(1920, 1080),
            None,
            Some(2.0),
            &mut |_| {},
        )
        .unwrap()
        .expect("progress is compositor-owned");
        assert!(!evaluated.reference.ops.is_empty());
        let Some(SceneNode::ShaderQuad { quad, transform }) = evaluated.node else {
            panic!("progress should become a shader quad")
        };
        assert_eq!(quad.style, "normal");
        assert!(transform.transform[1].abs() > 0.01);
        assert!(transform.transform[4].abs() > 0.01);
    }

    /// 声波 10 款全部是 CPU 矢量配方：带轨时也落 `SceneNode::Vectors`，
    /// 与 CPU reference 是同一份指令流，不走 `ShaderQuad`。
    #[test]
    fn scene_evaluation_keeps_visualizers_as_vectors_even_with_a_track() {
        use render_raster::source::{VizFrame, VizParams, VizTrack};

        let track = VizTrack::assemble(
            10,
            vec![VizFrame {
                time: vec![128; 128].into_boxed_slice(),
                freq: vec![220; 512].into_boxed_slice(),
            }],
            VizParams {
                min_db: -80.0,
                max_db: 40.0,
                smoothing: 0.0,
                gain: 1.0,
            },
            0,
        )
        .unwrap();
        let place = Place::default();
        for style in ["bars", "ring_bars", "oscilloscope", "pulse_rings"] {
            let props = VisualizerProps::new(style);
            let element = view(
                "v1",
                ElementKind::Visualizer,
                &place,
                None,
                Some(&props),
                None,
            );
            let evaluated = evaluate_scene_element(
                &element,
                0.0,
                &pose(),
                Stage::new(1920, 1080),
                Some(&track),
                Some(0.0),
                &mut |_| {},
            )
            .unwrap()
            .expect("visualizer is compositor-owned");
            let Some(SceneNode::Vectors(ops)) = evaluated.node else {
                panic!("{style}: visualizer should stay a vector node")
            };
            assert!(!ops.ops.is_empty(), "{style}");
            assert_eq!(ops.ops.len(), evaluated.reference.ops.len(), "{style}");
        }
    }

    #[test]
    fn scene_evaluation_uses_vector_fallback_when_visualizer_data_is_missing() {
        let place = Place::default();
        let props = VisualizerProps::new("bars");
        let element = view(
            "v1",
            ElementKind::Visualizer,
            &place,
            None,
            Some(&props),
            None,
        );
        let evaluated = evaluate_scene_element(
            &element,
            1.0,
            &pose(),
            Stage::new(1920, 1080),
            None,
            Some(1.0),
            &mut |_| {},
        )
        .unwrap()
        .expect("visualizer is compositor-owned");
        assert!(matches!(evaluated.node, Some(SceneNode::Vectors(_))));
        assert_eq!(evaluated.reference.ops.len(), 1);
    }

    #[test]
    fn scene_references_remap_path_ids_without_re_evaluating_elements() {
        let left_place = Place {
            x: Some(30.0),
            ..Place::default()
        };
        let right_place = Place {
            x: Some(70.0),
            ..Place::default()
        };
        let props = shape_props("ellipse");
        let left = view(
            "left",
            ElementKind::Shape,
            &left_place,
            Some(&props),
            None,
            None,
        );
        let right = view(
            "right",
            ElementKind::Shape,
            &right_place,
            Some(&props),
            None,
            None,
        );
        let stage = Stage::new(640, 360);

        let mut canonical = FrameBuilder::default();
        for element in [&left, &right] {
            assert!(push_element(
                &mut canonical,
                element,
                1.0,
                &pose(),
                stage,
                None,
                Some(1.0),
                &mut |_| {},
            ));
        }

        let mut merged = FrameBuilder::default();
        for element in [&left, &right] {
            evaluate_scene_element(element, 1.0, &pose(), stage, None, Some(1.0), &mut |_| {})
                .unwrap()
                .unwrap()
                .append_reference_to(&mut merged)
                .unwrap();
        }
        let canonical = canonical.finish();
        let merged = merged.finish();
        assert_eq!(merged.paths.len(), 2);
        assert_eq!(
            render_raster::fingerprint(&merged),
            render_raster::fingerprint(&canonical)
        );
    }

    #[test]
    fn scene_reference_keeps_rounded_progress_clip_ops_for_the_canonical_fingerprint() {
        let place = Place::default();
        let props = ProgressProps::new("rounded");
        let element = view(
            "rounded",
            ElementKind::Progress,
            &place,
            None,
            None,
            Some(&props),
        );
        let stage = Stage::new(640, 360);
        let mut canonical = FrameBuilder::default();
        assert!(push_element(
            &mut canonical,
            &element,
            1.0,
            &pose(),
            stage,
            None,
            Some(1.0),
            &mut |_| {},
        ));
        assert!(
            canonical
                .frame
                .ops
                .iter()
                .any(|op| matches!(op, DrawOp::ClipPath { .. }))
        );

        let evaluated =
            evaluate_scene_element(&element, 1.0, &pose(), stage, None, Some(1.0), &mut |_| {})
                .unwrap()
                .unwrap();
        let mut merged = FrameBuilder::default();
        evaluated.append_reference_to(&mut merged).unwrap();
        assert_eq!(
            render_raster::fingerprint(&merged.finish()),
            render_raster::fingerprint(&canonical.finish())
        );
    }

    /// 分派表：三种矢量直出 kind 归本 crate，其余四种归 host；`sticker` 不在
    /// 这张表里——它按 props 分家，由下面那条测试单独钉住。
    #[test]
    fn the_dispatch_table_claims_exactly_the_three_vector_kinds() {
        let place = Place::default();
        let props = shape_props("rect");
        for (kind, claimed) in [
            (ElementKind::Shape, true),
            (ElementKind::Visualizer, true),
            (ElementKind::Progress, true),
            (ElementKind::Text, false),
            (ElementKind::Image, false),
            (ElementKind::Video, false),
            (ElementKind::Audio, false),
        ] {
            let element = view("e", kind, &place, Some(&props), None, None);
            let mut builder = FrameBuilder::default();
            assert_eq!(
                push_element(
                    &mut builder,
                    &element,
                    1.0,
                    &pose(),
                    Stage::new(1920, 1080),
                    None,
                    Some(1.0),
                    &mut |_| {},
                ),
                claimed,
                "{kind:?}"
            );
        }
    }

    // ── 模板贴纸（P7b）────────────────────────────────────────────

    fn sticker_view<'a>(place: &'a Place, props: &'a StickerProps) -> ElementDraw<'a> {
        ElementDraw {
            id: "st1",
            kind: ElementKind::Sticker,
            start: 0.0,
            end: 4.0,
            place,
            shape: None,
            sticker: Some(props),
            visualizer: None,
            progress: None,
            draw: None,
            placeholder: None,
            confetti: None,
            whiteboard: None,
            has_source: false,
        }
    }

    fn draw_sticker(props: &StickerProps) -> (FrameBuilder, Vec<String>) {
        let place = Place::default();
        let element = sticker_view(&place, props);
        let mut builder = FrameBuilder::default();
        let mut warnings = Vec::new();
        let claimed = push_element(
            &mut builder,
            &element,
            1.0,
            &pose(),
            Stage::new(1920, 1080),
            None,
            Some(1.0),
            &mut |message| warnings.push(message),
        );
        assert!(claimed, "template 源的 sticker 必须由本 crate 认领");
        (builder, warnings)
    }

    fn template(id: &str) -> StickerProps {
        let mut props = StickerProps::new(timeline::schema::STICKER_SOURCE_TEMPLATE);
        props.template_id = Some(id.to_owned());
        props
    }

    /// **sticker 按 props 分家**：`template` 归本 crate（矢量直出），
    /// `asset` 归 host（要解码器）。这条分派是 P7b 的核心契约。
    #[test]
    fn only_template_stickers_are_claimed_by_this_crate() {
        let place = Place::default();
        for (props, claimed) in [
            (template("heart"), true),
            (
                StickerProps::new(timeline::schema::STICKER_SOURCE_ASSET),
                false,
            ),
        ] {
            let element = sticker_view(&place, &props);
            let mut builder = FrameBuilder::default();
            assert_eq!(
                push_element(
                    &mut builder,
                    &element,
                    1.0,
                    &pose(),
                    Stage::new(1920, 1080),
                    None,
                    Some(1.0),
                    &mut |_| {},
                ),
                claimed,
                "{}",
                props.source
            );
        }
    }

    /// 每份模板都画得出指令，且两两不同——撞车说明某一层没被读。
    #[test]
    fn every_template_pushes_a_distinct_instruction_stream() {
        use motion::preset_registry::timeline_stickers;

        let mut seen: Vec<(String, Vec<u8>)> = Vec::new();
        for recipe in timeline_stickers() {
            let (builder, warnings) = draw_sticker(&template(&recipe.id));
            let frame = builder.finish();
            assert!(!frame.ops.is_empty(), "{}", recipe.id);
            assert!(warnings.is_empty(), "{}: {warnings:?}", recipe.id);
            let encoded = render_raster::drawop::encode(&frame);
            for (other, bytes) in &seen {
                assert_ne!(*bytes, encoded, "{} 与 {other} 的指令流相同", recipe.id);
            }
            seen.push((recipe.id.clone(), encoded));
        }
        assert_eq!(seen.len(), 10);
    }

    /// 未登记的模板 = `preset-unknown`：一条诊断、零指令；缺 `templateId` 同理。
    /// 两条都**认领**（返回 true）——不认领会让 host 再报一遍"需要光栅化"。
    #[test]
    fn an_unregistered_template_warns_and_draws_nothing() {
        for props in [
            template("no-such-template"),
            StickerProps::new(timeline::schema::STICKER_SOURCE_TEMPLATE),
        ] {
            let (builder, warnings) = draw_sticker(&props);
            assert!(builder.frame.ops.is_empty());
            assert_eq!(warnings.len(), 1, "{warnings:?}");
        }
    }

    /// 描边宽度跟着**元素盒**走，不跟画布走：同一份模板放大一倍，
    /// 外框像素宽度也翻倍（否则粗细比例会随尺寸漂移）。
    #[test]
    fn sticker_stroke_width_scales_with_the_element_box() {
        use render_raster::drawop::DrawOp;

        let widths = |percent: f64| {
            let place = Place {
                w: Some(percent),
                ..Place::default()
            };
            let props = template("speech_bubble");
            let element = sticker_view(&place, &props);
            let mut builder = FrameBuilder::default();
            push_element(
                &mut builder,
                &element,
                1.0,
                &pose(),
                Stage::new(1920, 1080),
                None,
                Some(1.0),
                &mut |_| {},
            );
            builder
                .frame
                .ops
                .iter()
                .filter_map(|op| match op {
                    DrawOp::StrokePath { width, .. } => Some(*width),
                    _ => None,
                })
                .collect::<Vec<_>>()
        };
        let small = widths(10.0);
        let large = widths(20.0);
        assert_eq!(small.len(), 1);
        assert!(
            (large[0] / small[0] - 2.0).abs() < 1e-4,
            "{small:?} {large:?}"
        );
    }

    /// `audio` 缺省 = 主音轨。
    #[test]
    fn the_default_audio_source_is_the_main_track() {
        assert_eq!(
            visualizer_audio_source(&VisualizerProps::new("bars")),
            "main"
        );
        let mut props = VisualizerProps::new("bars");
        props.audio = Some("bgm".to_owned());
        assert_eq!(visualizer_audio_source(&props), "bgm");
    }
}
