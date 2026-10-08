//! v3 的画面实例换成渲染内核（`subtitle-render`）的元素。
//!
//! 字段一一对应（视频格式规范 §3.4–§3.7 采用的就是 v2 的元素模型）：时间是实例的区间换成的秒，几何、遮罩、平铺、
//! 元素动画、文字样式与各种类的 props 原样带过去；关键帧绑定经 `bindings_to_timeline` 换成 v2 的 `keyframes`。
//! 有三处不交给内核：源画面由调用方注入（[`SOURCE_PREFIX`] 加实例 ID），`fx` 由 [`crate::effects`] 先作用在源画面上，
//! 转场由 [`crate::transition`] 在画好的层上画。

use subtitle_render::{TimelineVisualElement, vertical_align_from_str};
use timeline::schema::{Background, ElementKind, Fit, VisualMode};
use video_model::{AnimationBinding, TimelineItem};

/// 注入的源画面的 ID 前缀：`layer:<实例 ID>`。
pub const SOURCE_PREFIX: &str = "layer:";

/// 实例的源画面在内核里的 ID。
pub fn source_id(item_id: &str) -> String {
    format!("{SOURCE_PREFIX}{item_id}")
}

/// 画面实例换成内核的元素；音频与字幕没有。`bindings` 是序列上指向这个实例的关键帧绑定，读不懂的绑定当作没有
/// （引擎写入时已校验）。
pub fn visual_element<'a>(
    item: &TimelineItem,
    fps: f64,
    bindings: impl IntoIterator<Item = &'a AnimationBinding>,
) -> Option<TimelineVisualElement> {
    let span = item.span()?;
    let place = item.place()?;
    let kind = element_kind(item)?;
    let fps = if fps.is_finite() && fps > 0.0 { fps } else { 30.0 };
    let keyframes = video_model::bindings_to_timeline(bindings, fps)
        .ok()
        .filter(|k| *k != timeline::keyframes::Keyframes::default());
    let media = item.media();
    // 合成实例没有 `mode`：`place` 没写位置与宽时铺满，否则按画中画摆（与帧计划相同）。
    let (mode, fit) = match item {
        TimelineItem::Composition(_) => {
            let fullscreen = place.x.is_none() && place.y.is_none() && place.w.is_none();
            (if fullscreen { VisualMode::Fullscreen } else { VisualMode::Pip }, Fit::Contain)
        }
        // 贴纸按自己的宽高比摆，不裁切。
        TimelineItem::Sticker(_) => (VisualMode::Pip, Fit::Contain),
        _ => (media.map_or(VisualMode::Pip, |m| m.mode()), media.map_or(Fit::Cover, |m| m.fit())),
    };
    let mut element = TimelineVisualElement {
        id: item.base().id.clone(),
        kind,
        start: span.from_frame as f64 / fps,
        end: span.end_frame() as f64 / fps,
        place: place.to_timeline(),
        vertical_align: None,
        src_id: None,
        src_start: 0.0,
        rate: 1.0,
        audio_fade_in: 0.0,
        audio_fade_out: 0.0,
        mode,
        fit,
        // 合成替身没有底：全屏 + contain 的留边与透明像素都露出下层（视频格式规范 §3.7）。
        bg: match item {
            TimelineItem::Composition(_) => None,
            _ => Some(media.map_or(Background::Black, |m| m.bg())),
        },
        text: None,
        counter: None,
        style: serde_json::json!({}),
        tile: None,
        mask: item.mask().map(video_model::Mask::to_timeline),
        fx: None,
        animation: item.animate().map(video_model::Animation::to_timeline),
        transitions: None,
        keyframes,
        shape: None,
        sticker: None,
        visualizer: None,
        progress: None,
        draw: None,
        placeholder: None,
        confetti: None,
        whiteboard: None,
    };
    match item {
        TimelineItem::Image(image) => element.tile = image.tile.as_ref().map(video_model::Tile::to_timeline),
        TimelineItem::Text(text) => {
            element.text = text.text.clone();
            element.counter = text.counter.clone();
            element.style = text.style.clone().unwrap_or_else(|| serde_json::json!({}));
            element.vertical_align = text.vertical_align.as_deref().and_then(vertical_align_from_str);
            element.tile = text.tile.as_ref().map(video_model::Tile::to_timeline);
        }
        TimelineItem::Shape(shape) => element.shape = Some(shape.shape.clone()),
        TimelineItem::Sticker(sticker) => element.sticker = Some(sticker.sticker.clone()),
        TimelineItem::Visualizer(v) => element.visualizer = Some(v.visualizer.clone()),
        TimelineItem::Progress(p) => element.progress = Some(p.progress.clone()),
        TimelineItem::Draw(d) => element.draw = Some(d.draw.clone()),
        TimelineItem::Placeholder(p) => element.placeholder = Some(p.placeholder.clone()),
        TimelineItem::Confetti(c) => element.confetti = Some(c.confetti.clone()),
        TimelineItem::Whiteboard(w) => element.whiteboard = Some(w.whiteboard.clone()),
        _ => {}
    }
    Some(element)
}

/// 内核的元素种类。合成实例按视频画（它的画面是预渲染替身）。
fn element_kind(item: &TimelineItem) -> Option<ElementKind> {
    Some(match item {
        TimelineItem::Video(_) | TimelineItem::Composition(_) => ElementKind::Video,
        TimelineItem::Image(_) => ElementKind::Image,
        TimelineItem::Text(_) => ElementKind::Text,
        TimelineItem::Shape(_) => ElementKind::Shape,
        TimelineItem::Sticker(_) => ElementKind::Sticker,
        TimelineItem::Visualizer(_) => ElementKind::Visualizer,
        TimelineItem::Progress(_) => ElementKind::Progress,
        TimelineItem::Draw(_) => ElementKind::Draw,
        TimelineItem::Placeholder(_) => ElementKind::Placeholder,
        TimelineItem::Confetti(_) => ElementKind::Confetti,
        TimelineItem::Whiteboard(_) => ElementKind::Whiteboard,
        TimelineItem::Audio(_) | TimelineItem::Caption(_) => return None,
    })
}
