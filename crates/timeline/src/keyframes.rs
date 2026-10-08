//! 元素关键帧（`bcutTimeline` 0.12，BCF 规范 §19.x「关键帧」）。
//!
//! 元素上的 `keyframes` 是「属性 → 一串 `{t, v, ease?}`」，属性闭集见
//! [`KEYFRAME_PROPS`]。叠加顺序（规范性）：有关键帧的属性，取样值**取代**该属性的
//! 静态值（`place.*` 或 `volume`），成为基础姿态；入场 / 出场 / 循环三槽照旧在
//! 基础姿态之上叠加。没有关键帧的元素，每一个取样入口都原样返回静态值，渲染结果
//! 逐位不变。
//!
//! 时间写法两种，同一个属性里只能用一种：数字 = 从元素起点算的秒；`"N%"` = 元素
//! 时长的比例（修剪 / 跟随改了时长之后自动跟着）。秒写法超出元素末尾的帧不生效。
//! 缓动写在**目标帧**上：从帧 i−1 到帧 i 的那一段用帧 i 的 `ease`，缺省线性；
//! 第一帧之前取第一帧的值，最后一帧之后取最后一帧的值。
//!
//! 本模块只做纯函数：取样、换算、校验与露底判定。宿主（CPU / GPU / wasm / App
//! 预览、导出混音）都经这里取值，不各写一遍。

use serde::{Deserialize, Serialize};

use crate::schema::{ElementKind, Place, TimelineError};

/// 属性闭集（文档里的键名，顺序即 schema 与 `spec` 的列出顺序）。
pub const KEYFRAME_PROPS: &[&str] = &[
    "x", "y", "scale", "scaleY", "rot", "opacity", "radius", "volume",
];
/// 单个属性最多多少帧。
pub const KEYFRAMES_MAX_PER_PROP: usize = 256;
/// `opacity`（静态值与关键帧同一区间）。
pub const OPACITY_RANGE: (f64, f64) = (0.0, 1.0);
/// 元素音量（线性倍数；静态值与关键帧同一区间，导出混音也夹到这里）。
pub const VOLUME_RANGE: (f64, f64) = (0.0, 4.0);
/// 百分比写法的区间。
pub const PERCENT_RANGE: (f64, f64) = (0.0, 100.0);

/// 关键帧时刻：秒（从元素起点算）或元素时长的百分比。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum KeyTime {
    Seconds(f64),
    Percent(String),
}

impl KeyTime {
    /// 百分比写法的数值（`"25%"` → 25）；秒写法或写错返回 `None`。
    pub fn percent(&self) -> Option<f64> {
        match self {
            Self::Percent(text) => parse_percent(text),
            Self::Seconds(_) => None,
        }
    }

    /// 换算成元素本地秒。`duration` 是元素的时长（开放结尾按项目末尾算）。
    pub fn local_seconds(&self, duration: f64) -> f64 {
        match self {
            Self::Seconds(value) => *value,
            Self::Percent(text) => parse_percent(text).unwrap_or(0.0) / 100.0 * duration.max(0.0),
        }
    }
}

fn parse_percent(text: &str) -> Option<f64> {
    let body = text.strip_suffix('%')?;
    if body.is_empty()
        || body.starts_with('+')
        || body.starts_with('-')
        || !body.chars().all(|c| c.is_ascii_digit() || c == '.')
    {
        return None;
    }
    body.parse::<f64>().ok().filter(|value| value.is_finite())
}

/// 一个关键帧。`ease` 是进入这一帧的那一段的缓动（缺省线性）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Keyframe {
    pub t: KeyTime,
    pub v: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ease: Option<String>,
}

/// 元素上的 `keyframes`。缺席的属性用静态值。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Keyframes {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x: Option<Vec<Keyframe>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub y: Option<Vec<Keyframe>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scale: Option<Vec<Keyframe>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scale_y: Option<Vec<Keyframe>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rot: Option<Vec<Keyframe>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opacity: Option<Vec<Keyframe>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub radius: Option<Vec<Keyframe>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub volume: Option<Vec<Keyframe>>,
}

impl Keyframes {
    /// `(属性名, 帧)`，顺序同 [`KEYFRAME_PROPS`]。
    pub fn tracks(&self) -> [(&'static str, Option<&Vec<Keyframe>>); 8] {
        [
            ("x", self.x.as_ref()),
            ("y", self.y.as_ref()),
            ("scale", self.scale.as_ref()),
            ("scaleY", self.scale_y.as_ref()),
            ("rot", self.rot.as_ref()),
            ("opacity", self.opacity.as_ref()),
            ("radius", self.radius.as_ref()),
            ("volume", self.volume.as_ref()),
        ]
    }

    pub fn get(&self, prop: &str) -> Option<&Vec<Keyframe>> {
        self.tracks()
            .into_iter()
            .find(|(name, _)| *name == prop)
            .and_then(|(_, frames)| frames)
    }

    /// 换掉（`Some`）或清掉（`None`）一个属性的整串帧。未知属性名返回 `false`。
    pub fn set(&mut self, prop: &str, frames: Option<Vec<Keyframe>>) -> bool {
        let slot = match prop {
            "x" => &mut self.x,
            "y" => &mut self.y,
            "scale" => &mut self.scale,
            "scaleY" => &mut self.scale_y,
            "rot" => &mut self.rot,
            "opacity" => &mut self.opacity,
            "radius" => &mut self.radius,
            "volume" => &mut self.volume,
            _ => return false,
        };
        *slot = frames;
        true
    }

    pub fn is_empty(&self) -> bool {
        self.tracks().iter().all(|(_, frames)| frames.is_none())
    }

    /// 有没有影响画面的属性（除 `volume` 之外的任一个）。
    pub fn has_visual(&self) -> bool {
        self.tracks()
            .iter()
            .any(|(name, frames)| *name != "volume" && frames.is_some())
    }

    /// 所有属性、所有生效帧的本地秒，升序去重。重绘节拍与露底取样用。
    pub fn times(&self, duration: f64, visual_only: bool) -> Vec<f64> {
        let mut out = Vec::new();
        for (name, frames) in self.tracks() {
            if visual_only && name == "volume" {
                continue;
            }
            for frame in frames.into_iter().flatten() {
                let time = frame.t.local_seconds(duration);
                if time <= duration + TIME_EPSILON {
                    out.push(time);
                }
            }
        }
        out.sort_by(f64::total_cmp);
        out.dedup_by(|a, b| (*a - *b).abs() <= TIME_EPSILON);
        out
    }

    /// 某属性在元素本地时刻 `local` 的取样值；该属性没有关键帧（或全部超出末尾）时为 `None`。
    pub fn sample(&self, prop: &str, local: f64, duration: f64) -> Option<f64> {
        sample(self.get(prop)?, local, duration)
    }

    /// 校验。`caps` 描述元素可以带哪些属性。
    pub fn validate(&self, element_id: &str, caps: KeyframeCaps) -> Result<(), TimelineError> {
        let invalid = |message: String| Err(TimelineError::Invalid(message));
        if self.is_empty() {
            return invalid(format!(
                "element {element_id} 的 keyframes 为空，应删除整个字段"
            ));
        }
        for (name, frames) in self.tracks() {
            let Some(frames) = frames else {
                continue;
            };
            if !caps.allows(name) {
                return invalid(format!(
                    "element {element_id} 的 keyframes.{name} 不适用于这种元素"
                ));
            }
            if frames.is_empty() {
                return invalid(format!(
                    "element {element_id} 的 keyframes.{name} 为空，应删除该属性"
                ));
            }
            if frames.len() > KEYFRAMES_MAX_PER_PROP {
                return invalid(format!(
                    "element {element_id} 的 keyframes.{name} 超过 {KEYFRAMES_MAX_PER_PROP} 帧"
                ));
            }
            let percent = matches!(frames[0].t, KeyTime::Percent(_));
            let mut previous: Option<f64> = None;
            for (index, frame) in frames.iter().enumerate() {
                let at = match &frame.t {
                    KeyTime::Seconds(value) if !percent => {
                        if !value.is_finite() || *value < 0.0 {
                            return invalid(format!(
                                "element {element_id} 的 keyframes.{name}[{index}].t 须是非负秒数"
                            ));
                        }
                        *value
                    }
                    KeyTime::Percent(text) if percent => match parse_percent(text) {
                        Some(value) if (PERCENT_RANGE.0..=PERCENT_RANGE.1).contains(&value) => {
                            value
                        }
                        _ => {
                            return invalid(format!(
                                "element {element_id} 的 keyframes.{name}[{index}].t 须是 \"0%\"…\"100%\""
                            ));
                        }
                    },
                    _ => {
                        return invalid(format!(
                            "element {element_id} 的 keyframes.{name} 混用了秒与百分比两种时间写法"
                        ));
                    }
                };
                if previous.is_some_and(|last| at <= last) {
                    return invalid(format!(
                        "element {element_id} 的 keyframes.{name} 的时刻必须严格递增"
                    ));
                }
                previous = Some(at);
                if !value_in_range(name, frame.v) {
                    return invalid(format!(
                        "element {element_id} 的 keyframes.{name}[{index}].v 超出取值范围"
                    ));
                }
                if let Some(ease) = &frame.ease
                    && !::motion::curve::EASE_NAMES.contains(&ease.as_str())
                {
                    return invalid(format!(
                        "element {element_id} 的 keyframes.{name}[{index}].ease 未知：{ease}"
                    ));
                }
            }
        }
        Ok(())
    }
}

const TIME_EPSILON: f64 = 1e-9;

/// 一个属性的取值是否合法（与静态值同一处常量）。
pub fn value_in_range(prop: &str, value: f64) -> bool {
    if !value.is_finite() {
        return false;
    }
    match prop {
        "opacity" => (OPACITY_RANGE.0..=OPACITY_RANGE.1).contains(&value),
        "volume" => (VOLUME_RANGE.0..=VOLUME_RANGE.1).contains(&value),
        "radius" => value >= 0.0,
        _ => true,
    }
}

/// 元素能带哪些关键帧属性。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KeyframeCaps {
    /// `x y scale scaleY rot opacity`：一切有画面的元素。
    pub transform: bool,
    /// `radius`：图片 / 视频 / 占位 / 白板 / 素材贴纸（与 `place.radius` 的消费者一致）。
    pub radius: bool,
    /// `volume`：音频 / 视频。
    pub volume: bool,
}

impl KeyframeCaps {
    pub fn for_kind(kind: &ElementKind, visual_media: bool) -> Self {
        let audio = *kind == ElementKind::Audio;
        Self {
            transform: !audio,
            radius: visual_media,
            volume: matches!(kind, ElementKind::Audio | ElementKind::Video),
        }
    }

    pub fn allows(self, prop: &str) -> bool {
        match prop {
            "radius" => self.radius,
            "volume" => self.volume,
            "x" | "y" | "scale" | "scaleY" | "rot" | "opacity" => self.transform,
            _ => false,
        }
    }
}

/// 一串帧在元素本地时刻 `local` 的取样值。秒写法超出元素末尾的帧不生效；全部
/// 不生效或空串时返回 `None`（该属性回到静态值）。
pub fn sample(frames: &[Keyframe], local: f64, duration: f64) -> Option<f64> {
    let mut previous: Option<(f64, f64)> = None;
    for frame in frames {
        let at = frame.t.local_seconds(duration);
        if matches!(frame.t, KeyTime::Seconds(_)) && at > duration + TIME_EPSILON {
            break;
        }
        match previous {
            None if local <= at => return Some(frame.v),
            Some((from_t, from_v)) if local < at => {
                let span = at - from_t;
                if span <= 0.0 {
                    return Some(frame.v);
                }
                let progress = ((local - from_t) / span).clamp(0.0, 1.0);
                let eased = ::motion::curve::apply_ease(frame.ease.as_deref(), progress);
                return Some(from_v + (frame.v - from_v) * eased);
            }
            _ => {}
        }
        previous = Some((at, frame.v));
    }
    previous.map(|(_, value)| value)
}

/// 把关键帧取样值代入静态位置，得到这一刻的基础姿态。`keyframes` 为 `None` 或
/// 没有画面属性时返回 `None`——调用方原样用静态 `place`，保证逐位不变。
///
/// `radius` 的关键帧取代四角的全部半径（写入 `radius` 并清掉 `cornerRadii`）。
pub fn place_at(
    place: Option<&Place>,
    keyframes: Option<&Keyframes>,
    local: f64,
    duration: f64,
) -> Option<Place> {
    let keyframes = keyframes.filter(|keyframes| keyframes.has_visual())?;
    let mut out = place.cloned().unwrap_or_default();
    let mut touched = false;
    for (name, slot) in [
        ("x", &mut out.x),
        ("y", &mut out.y),
        ("scale", &mut out.scale),
        ("scaleY", &mut out.scale_y),
        ("rot", &mut out.rot),
        ("opacity", &mut out.opacity),
    ] {
        if let Some(value) = keyframes.sample(name, local, duration) {
            *slot = Some(value);
            touched = true;
        }
    }
    if let Some(value) = keyframes.sample("radius", local, duration) {
        out.radius = Some(value.max(0.0));
        out.corner_radii = None;
        touched = true;
    }
    touched.then_some(out)
}

/// 元素在本地时刻 `local` 的音量（线性倍数，夹在 [`VOLUME_RANGE`]）：有 `volume`
/// 关键帧取样值，没有用静态值。
pub fn volume_at(
    static_volume: f64,
    keyframes: Option<&Keyframes>,
    local: f64,
    duration: f64,
) -> f64 {
    keyframes
        .and_then(|keyframes| keyframes.sample("volume", local, duration))
        .unwrap_or(static_volume)
        .clamp(VOLUME_RANGE.0, VOLUME_RANGE.1)
}

/// 露底判定的容差（像素）：盒的取整与浮点误差不算露底。
pub const UNCOVERED_TOLERANCE_PX: f64 = 0.5;
/// 露底判定最多取样多少个时刻（超出时加大步长）。
pub const UNCOVERED_MAX_SAMPLES: usize = 20_000;

/// 关键帧运动露出画布底的第一处。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Uncovered {
    /// 元素本地秒。
    pub at: f64,
    /// 差多少像素才盖满（画布四角到盒边的最远距离）。
    pub gap_px: f64,
}

/// 露底检查：图片 / 视频元素的**静态**位置盖满画布时，关键帧运动的全过程也必须
/// 盖满。按帧网格（`fps`）与每个关键帧时刻取样（缓动的极值点落在网格上，越界的
/// 缓动也被取到）。静态就没盖满、没有画面关键帧、平铺或不是图片 / 视频时返回 `None`。
///
/// `natural` 是媒体像素尺寸，`canvas` 是画布像素尺寸，`duration` 是元素时长。
pub fn keyframes_uncover(
    element: &crate::schema::Element,
    natural: (f64, f64),
    canvas: (f64, f64),
    duration: f64,
    fps: f64,
) -> Option<Uncovered> {
    use crate::geometry::{media_box, media_box_uncovered_gap};
    use crate::schema::VisualMode;
    if !matches!(element.kind, ElementKind::Image | ElementKind::Video)
        || element.tile.as_ref().is_some_and(|tile| tile.on)
        || !(natural.0 > 0.0 && natural.1 > 0.0)
    {
        return None;
    }
    let keyframes = element
        .keyframes
        .as_ref()
        .filter(|keyframes| keyframes.has_visual())?;
    let fullscreen = element.mode == Some(VisualMode::Fullscreen);
    let gap_at = |place: &Place| {
        let media = media_box(element.kind, fullscreen, place, natural, canvas);
        media_box_uncovered_gap(place, media, canvas)
    };
    let static_place = element.place.clone().unwrap_or_default();
    if gap_at(&static_place) > UNCOVERED_TOLERANCE_PX {
        return None;
    }
    let duration = duration.max(0.0);
    let step = (1.0 / fps.max(1.0)).max(duration / UNCOVERED_MAX_SAMPLES as f64);
    let mut times = keyframes.times(duration, true);
    let mut index = 0usize;
    loop {
        let time = index as f64 * step;
        if time > duration {
            break;
        }
        times.push(time);
        index += 1;
    }
    times.push(duration);
    times.sort_by(f64::total_cmp);
    times.dedup_by(|a, b| (*a - *b).abs() <= TIME_EPSILON);
    times.into_iter().find_map(|time| {
        let place = place_at(Some(&static_place), Some(keyframes), time, duration)?;
        let gap = gap_at(&place);
        (gap > UNCOVERED_TOLERANCE_PX).then_some(Uncovered {
            at: time,
            gap_px: gap,
        })
    })
}

/// 一件元素的窗口被跟随 / 分割改动之后，新元素相对旧元素的取景（BCF §19.3「关键帧、纯色画布与闪避」的「关键帧与跟随」）。
///
/// 新本地时刻 = (旧本地时刻 − `head`) × `scale`。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rewindow {
    /// 旧元素时长（秒）。
    pub old_duration: f64,
    /// 新元素本地 0 对应的旧本地时刻（负数 = 新窗口往前多出一段）。
    pub head: f64,
    /// 新元素时长（秒）。
    pub new_duration: f64,
    /// 旧本地时间走 1 秒、新本地时间走多少秒（片段倍速改了才不是 1）。
    pub scale: f64,
    /// 一件分成了几件（分割、剪口把片段画面切成几段）：百分比写法按这一件分到的那一份
    /// 改写；否则百分比原样，随新时长伸缩。
    pub divided: bool,
}

impl Rewindow {
    /// 只改了起点（`head` 秒被去掉）与时长、倍速不变、没有分件——跟随里的一般修剪。
    pub fn trim(old_duration: f64, head: f64, new_duration: f64) -> Self {
        Self {
            old_duration,
            head,
            new_duration,
            scale: 1.0,
            divided: false,
        }
    }

    fn is_identity(&self) -> bool {
        self.head.abs() <= REWINDOW_EPSILON
            && (self.scale - 1.0).abs() <= REWINDOW_EPSILON
            && (self.new_duration - self.old_duration).abs() <= REWINDOW_EPSILON
    }
}

/// 改写后的秒数取到微秒，免得浮点噪声让「没变」看起来变了。
const REWINDOW_EPSILON: f64 = 1e-6;

/// 把关键帧对到新窗口上（跟随与分割共用）。规则：
///
/// - **秒写法**跟着内容走：时刻按 [`Rewindow`] 换算；落到新窗口之前的帧去掉，并在 0 处
///   补一帧取样值；落到新窗口之后（或旧元素末尾之后本就不生效）的帧去掉，并在新末尾
///   补一帧取样值（沿用下一帧的缓动）——看得见的那一段动画保持原样。
/// - **百分比写法**在元素仍是一件时原样（随新时长伸缩，「随裁剪 / 剪口走」）；一件分成
///   几件时按秒写法同样换算后再折回这一件的百分比，两半在接缝处连续。
/// - 取样值夹回该属性的取值范围；换算后时刻重合的帧只留后一帧的值，保证严格递增。
pub fn rewindow(keyframes: &Keyframes, window: Rewindow) -> Keyframes {
    if window.is_identity() {
        return keyframes.clone();
    }
    let mut out = keyframes.clone();
    for (name, frames) in keyframes.tracks() {
        if let Some(frames) = frames {
            out.set(name, Some(rewindow_track(name, frames, window)));
        }
    }
    out
}

fn rewindow_track(prop: &str, frames: &[Keyframe], window: Rewindow) -> Vec<Keyframe> {
    let percent = matches!(
        frames.first().map(|frame| &frame.t),
        Some(KeyTime::Percent(_))
    );
    if frames.is_empty() || (percent && !window.divided) {
        return frames.to_vec();
    }
    let old_duration = window.old_duration.max(0.0);
    let new_duration = window.new_duration.max(0.0);
    let scale = if window.scale > 0.0 {
        window.scale
    } else {
        1.0
    };
    let at = |frame: &Keyframe| frame.t.local_seconds(old_duration);
    let effective: Vec<&Keyframe> = frames
        .iter()
        .take_while(|frame| percent || at(frame) <= old_duration + TIME_EPSILON)
        .collect();
    if effective.is_empty() {
        return frames.to_vec();
    }
    let head = window.head;
    let tail = head + new_duration / scale;
    let clamp = |value: f64| match prop {
        "opacity" => value.clamp(OPACITY_RANGE.0, OPACITY_RANGE.1),
        "volume" => value.clamp(VOLUME_RANGE.0, VOLUME_RANGE.1),
        "radius" => value.max(0.0),
        _ => value,
    };
    let sampled = |local: f64| clamp(sample(frames, local, old_duration).unwrap_or(frames[0].v));
    let map = |local: f64| {
        let value = ((local - head) * scale).clamp(0.0, new_duration);
        (value * 1e6).round() / 1e6
    };
    let mut out: Vec<(f64, f64, Option<String>)> = Vec::new();
    let mut push = |time: f64, value: f64, ease: Option<String>| match out.last_mut() {
        Some(last) if time <= last.0 + REWINDOW_EPSILON => last.1 = value,
        _ => out.push((time, value, ease)),
    };
    if at(effective[0]) < head - REWINDOW_EPSILON {
        push(0.0, sampled(head), None);
    }
    for frame in &effective {
        let local = at(frame);
        if local < head - REWINDOW_EPSILON || local > tail + REWINDOW_EPSILON {
            continue;
        }
        push(map(local), frame.v, frame.ease.clone());
    }
    if let Some(next) = frames
        .iter()
        .find(|frame| at(frame) > tail + REWINDOW_EPSILON)
    {
        push(new_duration, sampled(tail), next.ease.clone());
    }
    let mut result: Vec<Keyframe> = Vec::with_capacity(out.len());
    for (time, value, ease) in out {
        let t = if percent {
            let share = if new_duration > 0.0 {
                time / new_duration * 100.0
            } else {
                0.0
            };
            KeyTime::Percent(format_percent(share))
        } else {
            KeyTime::Seconds(time + 0.0)
        };
        match result.last_mut() {
            Some(last) if last.t == t => last.v = value,
            _ => result.push(Keyframe { t, v: value, ease }),
        }
    }
    result
}

/// `"N%"`，最多四位小数、去掉尾随的 0（[`parse_percent`] 读得回来）。
fn format_percent(value: f64) -> String {
    let text = format!("{:.4}", value.clamp(PERCENT_RANGE.0, PERCENT_RANGE.1) + 0.0);
    let text = text.trim_end_matches('0').trim_end_matches('.');
    format!("{text}%")
}

/// 分割（BCF §19.3「分割、合并与修剪」）：时长 `duration` 的元素在本地 `cut` 处切成两半，
/// 关键帧按两半各自的新窗口改写（[`rewindow`] 的分件规则：秒写法跟内容走，百分比写法折回
/// 这一半分到的那一份，接缝处各补一帧取样值）。返回 `(左半, 右半)`。
pub fn split_keyframes(keyframes: &Keyframes, duration: f64, cut: f64) -> (Keyframes, Keyframes) {
    let half = |head: f64, new_duration: f64| Rewindow {
        old_duration: duration,
        head,
        new_duration,
        scale: 1.0,
        divided: true,
    };
    (
        rewindow(keyframes, half(0.0, cut)),
        rewindow(keyframes, half(cut, duration - cut)),
    )
}

/// 合并（[`split_keyframes`] 的逆）：时间上靠前的一半（时长 `early_duration`）与靠后的一半
/// 拼回一件。每个属性试着去掉分割补的接缝帧，拼出的那串再切一次必须逐帧对得上两半（时刻
/// 容差约 0.1 毫秒，值容差百万分之一），对得上就是还原；任何一个属性对不上（不是同一次分割
/// 切出来的两半、秒写法与百分比写法混用、只有一半有某个属性）返回 `None`。两半都没有关键帧
/// 返回 `Some(None)`。百分比写法拼回后按合并后的时长折算（四位小数）。
pub fn join_keyframes(
    early: Option<&Keyframes>,
    early_duration: f64,
    late: Option<&Keyframes>,
    late_duration: f64,
) -> Option<Option<Keyframes>> {
    let (early, late) = match (early, late) {
        (None, None) => return Some(None),
        (Some(early), Some(late)) => (early, late),
        _ => return None,
    };
    let early_duration = early_duration.max(0.0);
    let late_duration = late_duration.max(0.0);
    let mut out = Keyframes::default();
    for prop in KEYFRAME_PROPS {
        match (early.get(prop), late.get(prop)) {
            (None, None) => {}
            (Some(a), Some(b)) => {
                let joined = join_track(prop, a, early_duration, b, late_duration)?;
                out.set(prop, Some(joined));
            }
            _ => return None,
        }
    }
    Some((!out.is_empty()).then_some(out))
}

fn join_track(
    prop: &str,
    early: &[Keyframe],
    early_duration: f64,
    late: &[Keyframe],
    late_duration: f64,
) -> Option<Vec<Keyframe>> {
    let is_percent = |frames: &[Keyframe]| {
        frames
            .first()
            .is_some_and(|frame| matches!(frame.t, KeyTime::Percent(_)))
    };
    let percent = is_percent(early);
    if early.is_empty() || late.is_empty() || percent != is_percent(late) {
        return None;
    }
    let total = early_duration + late_duration;
    let tolerance = JOIN_TIME_TOLERANCE + total * 1e-6;
    let early_at = |frame: &Keyframe| frame.t.local_seconds(early_duration);
    let late_at = |frame: &Keyframe| frame.t.local_seconds(late_duration);
    let early_seam = (early_at(early.last()?) - early_duration).abs() <= tolerance;
    let late_seam = late_at(&late[0]).abs() <= tolerance;
    // 先试「两侧接缝帧都是补的」，再试只有一侧是补的（另一侧是原有的帧恰好落在切点上）。
    let candidates = [
        (early_seam, late_seam),
        (false, late_seam),
        (early_seam, false),
        (false, false),
    ];
    let mut tried = Vec::new();
    for (drop_early, drop_late) in candidates {
        if tried.contains(&(drop_early, drop_late)) {
            continue;
        }
        tried.push((drop_early, drop_late));
        let mut frames: Vec<(f64, f64, Option<String>)> = Vec::new();
        let early_kept = if drop_early {
            &early[..early.len() - 1]
        } else {
            early
        };
        let late_kept = if drop_late { &late[1..] } else { late };
        frames.extend(
            early_kept
                .iter()
                .map(|frame| (early_at(frame), frame.v, frame.ease.clone())),
        );
        frames.extend(
            late_kept
                .iter()
                .map(|frame| (early_duration + late_at(frame), frame.v, frame.ease.clone())),
        );
        if frames.is_empty()
            || frames
                .windows(2)
                .any(|pair| pair[1].0 <= pair[0].0 + REWINDOW_EPSILON)
        {
            continue;
        }
        let candidate = frames
            .into_iter()
            .map(|(time, v, ease)| Keyframe {
                t: if percent {
                    let share = if total > 0.0 {
                        time / total * 100.0
                    } else {
                        0.0
                    };
                    KeyTime::Percent(format_percent(share))
                } else {
                    KeyTime::Seconds((time * 1e6).round() / 1e6 + 0.0)
                },
                v,
                ease,
            })
            .collect::<Vec<_>>();
        let resplit = |head: f64, new_duration: f64| {
            rewindow_track(
                prop,
                &candidate,
                Rewindow {
                    old_duration: total,
                    head,
                    new_duration,
                    scale: 1.0,
                    divided: true,
                },
            )
        };
        if tracks_match(
            &resplit(0.0, early_duration),
            early,
            early_duration,
            tolerance,
        ) && tracks_match(
            &resplit(early_duration, late_duration),
            late,
            late_duration,
            tolerance,
        ) {
            return Some(candidate);
        }
    }
    None
}

/// 合并时判「两串帧是同一串」的时刻容差（秒）：百分比写法存四位小数带来的误差远小于它。
const JOIN_TIME_TOLERANCE: f64 = 1e-4;

fn tracks_match(left: &[Keyframe], right: &[Keyframe], duration: f64, tolerance: f64) -> bool {
    left.len() == right.len()
        && left.iter().zip(right).all(|(a, b)| {
            matches!(a.t, KeyTime::Percent(_)) == matches!(b.t, KeyTime::Percent(_))
                && (a.t.local_seconds(duration) - b.t.local_seconds(duration)).abs() <= tolerance
                && (a.v - b.v).abs() <= 1e-6 * a.v.abs().max(1.0)
                && a.ease == b.ease
        })
}

/// 从 JSON 解出 `keyframes`（宿主手里只有原始文档时用）。形状不对返回 `None`。
pub fn from_json(value: Option<&serde_json::Value>) -> Option<Keyframes> {
    let value = value.filter(|value| value.is_object())?;
    serde_json::from_value::<Keyframes>(value.clone())
        .ok()
        .filter(|keyframes| !keyframes.is_empty())
}

/// 线性倍数 → dB（`0` → `-inf`）。
pub fn volume_to_db(volume: f64) -> f64 {
    if volume <= 0.0 {
        f64::NEG_INFINITY
    } else {
        20.0 * volume.log10()
    }
}

/// dB → 线性倍数。
pub fn db_to_volume(db: f64) -> f64 {
    if db == f64::NEG_INFINITY {
        0.0
    } else {
        10f64.powf(db / 20.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn frames(value: serde_json::Value) -> Vec<Keyframe> {
        serde_json::from_value(value).unwrap()
    }

    #[test]
    fn rewindow_is_identity_on_an_unchanged_window_and_formats_percent_readably() {
        let keyframes: Keyframes = serde_json::from_value(json!({
            "x": [{"t": 0.5, "v": 1.0}, {"t": 9.0, "v": 3.0}],
            "opacity": [{"t": "0%", "v": 0.0}, {"t": "100%", "v": 1.0, "ease": "easeOutBack"}]
        }))
        .unwrap();
        assert_eq!(
            rewindow(&keyframes, Rewindow::trim(4.0, 0.0, 4.0)),
            keyframes
        );
        // 一件分成三份的中间一份：百分比最多四位小数，读得回来、校验通过。
        let middle = rewindow(
            &keyframes,
            Rewindow {
                old_duration: 3.0,
                head: 1.0,
                new_duration: 1.0,
                scale: 1.0,
                divided: true,
            },
        );
        let opacity = middle.get("opacity").unwrap();
        assert_eq!(opacity[0].t, KeyTime::Percent("0%".to_owned()));
        assert_eq!(opacity[1].t, KeyTime::Percent("100%".to_owned()));
        assert!(
            (0.0..=1.0).contains(&opacity[1].v),
            "越界缓动的取样夹回区间"
        );
        middle
            .validate("el", KeyframeCaps::for_kind(&ElementKind::Image, true))
            .unwrap();
        assert_eq!(format_percent(100.0 / 3.0), "33.3333%");
        assert_eq!(format_percent(-0.0), "0%");
    }

    #[test]
    fn percent_frames_follow_duration_and_hold_outside() {
        let track = frames(json!([{"t": "0%", "v": 1.0}, {"t": "100%", "v": 2.0}]));
        assert_eq!(sample(&track, -1.0, 4.0), Some(1.0));
        assert_eq!(sample(&track, 2.0, 4.0), Some(1.5));
        assert_eq!(sample(&track, 4.0, 4.0), Some(2.0));
        assert_eq!(sample(&track, 9.0, 4.0), Some(2.0));
        // 时长变了（修剪 / 跟随），百分比跟着铺满。
        assert_eq!(sample(&track, 5.0, 10.0), Some(1.5));
    }

    #[test]
    fn ease_lives_on_the_target_frame() {
        let track = frames(json!([
            {"t": 0, "v": 0.0},
            {"t": 1, "v": 1.0, "ease": "easeInQuad"},
            {"t": 2, "v": 0.0}
        ]));
        assert!((sample(&track, 0.5, 10.0).unwrap() - 0.25).abs() < 1e-12);
        assert!((sample(&track, 1.5, 10.0).unwrap() - 0.5).abs() < 1e-12);
    }

    #[test]
    fn seconds_frames_past_the_end_do_not_apply() {
        let track = frames(json!([{"t": 0, "v": 1.0}, {"t": 5, "v": 3.0}]));
        // 元素只有 2 秒：5 秒那一帧不生效，停在第一帧。
        assert_eq!(sample(&track, 1.0, 2.0), Some(1.0));
        let late = frames(json!([{"t": 5, "v": 3.0}]));
        assert_eq!(sample(&late, 1.0, 2.0), None);
    }

    #[test]
    fn place_at_is_none_without_visual_frames() {
        let place = Place {
            x: Some(10.0),
            ..Place::default()
        };
        assert_eq!(place_at(Some(&place), None, 0.0, 1.0), None);
        let volume_only: Keyframes =
            serde_json::from_value(json!({"volume": [{"t": 0, "v": 0.5}]})).unwrap();
        assert_eq!(place_at(Some(&place), Some(&volume_only), 0.0, 1.0), None);
        let moving: Keyframes = serde_json::from_value(
            json!({"x": [{"t": "0%", "v": 50.0}, {"t": "100%", "v": 70.0}], "radius": [{"t": 0, "v": 8.0}]}),
        )
        .unwrap();
        let mut rounded = place.clone();
        rounded.corner_radii = Some(crate::schema::CornerRadii {
            top_left: 1.0,
            top_right: 1.0,
            bottom_right: 1.0,
            bottom_left: 1.0,
        });
        let at = place_at(Some(&rounded), Some(&moving), 1.0, 2.0).unwrap();
        assert_eq!(at.x, Some(60.0));
        assert_eq!(at.radius, Some(8.0));
        assert_eq!(at.corner_radii, None);
    }

    #[test]
    fn validation_rejects_mixed_notation_order_range_and_kind() {
        let caps = KeyframeCaps::for_kind(&ElementKind::Image, true);
        let parse = |value: serde_json::Value| serde_json::from_value::<Keyframes>(value).unwrap();
        assert!(
            parse(
                json!({"x": [{"t": "0%", "v": 1}, {"t": "100%", "v": 2, "ease": "easeOutCubic"}]})
            )
            .validate("e", caps)
            .is_ok()
        );
        for bad in [
            json!({"x": [{"t": 0, "v": 1}, {"t": "100%", "v": 2}]}),
            json!({"x": [{"t": 1, "v": 1}, {"t": 1, "v": 2}]}),
            json!({"x": [{"t": "120%", "v": 1}]}),
            json!({"x": [{"t": "-5%", "v": 1}]}),
            json!({"opacity": [{"t": 0, "v": 1.5}]}),
            json!({"x": [{"t": 0, "v": 1, "ease": "bogus"}]}),
            json!({"volume": [{"t": 0, "v": 1}]}),
            json!({"x": []}),
            json!({}),
        ] {
            assert!(parse(bad.clone()).validate("e", caps).is_err(), "{bad}");
        }
        let audio = KeyframeCaps::for_kind(&ElementKind::Audio, false);
        assert!(
            parse(json!({"volume": [{"t": 0, "v": 0}, {"t": 1, "v": 4}]}))
                .validate("a", audio)
                .is_ok()
        );
        assert!(
            parse(json!({"x": [{"t": 0, "v": 1}]}))
                .validate("a", audio)
                .is_err()
        );
        let text = KeyframeCaps::for_kind(&ElementKind::Text, false);
        assert!(
            parse(json!({"radius": [{"t": 0, "v": 1}]}))
                .validate("t", text)
                .is_err()
        );
    }

    #[test]
    fn uncovered_check_reports_first_gap_and_skips_uncovered_statics() {
        let element = |value: serde_json::Value| -> crate::schema::Element {
            serde_json::from_value(value).unwrap()
        };
        let canvas = (1920.0, 1080.0);
        // pip，宽 100%，16:9 源：静态盖满；x 从 50 挪到 70 必露。
        let moving = element(json!({
            "id": "img", "kind": "image", "srcId": "s", "place": {"x": 50, "y": 50, "w": 100},
            "keyframes": {"x": [{"t": "0%", "v": 50}, {"t": "100%", "v": 70}]}
        }));
        let hit = keyframes_uncover(&moving, (1920.0, 1080.0), canvas, 4.0, 30.0).unwrap();
        assert!(hit.at > 0.0 && hit.at < 0.1, "{hit:?}");
        assert!(hit.gap_px > UNCOVERED_TOLERANCE_PX);
        // 放大 1.2 再平移 5%：盒比画布宽 384 px，挪 96 px 仍盖满。
        let zoomed = element(json!({
            "id": "img", "kind": "image", "srcId": "s", "place": {"x": 50, "y": 50, "w": 100, "scale": 1.2},
            "keyframes": {"x": [{"t": "0%", "v": 50}, {"t": "100%", "v": 55}]}
        }));
        assert_eq!(
            keyframes_uncover(&zoomed, (1920.0, 1080.0), canvas, 4.0, 30.0),
            None
        );
        // 铺满模式里 x 不参与盒位置；缩小到 0.9 才露。
        let full = element(json!({
            "id": "img", "kind": "image", "srcId": "s", "mode": "fullscreen",
            "keyframes": {"scale": [{"t": 0, "v": 1.0}, {"t": 2, "v": 0.9}]}
        }));
        let hit = keyframes_uncover(&full, (800.0, 800.0), canvas, 4.0, 30.0).unwrap();
        assert!(hit.at > 0.0 && hit.at < 0.1);
        // 静态就没盖满：不检查。
        let small = element(json!({
            "id": "img", "kind": "image", "srcId": "s", "place": {"w": 40},
            "keyframes": {"x": [{"t": 0, "v": 0}, {"t": 1, "v": 100}]}
        }));
        assert_eq!(
            keyframes_uncover(&small, (1920.0, 1080.0), canvas, 4.0, 30.0),
            None
        );
    }

    #[test]
    fn db_round_trip() {
        assert!((db_to_volume(-6.0) - 0.501_187_233_627_272_2).abs() < 1e-12);
        assert!((volume_to_db(db_to_volume(-6.0)) + 6.0).abs() < 1e-9);
        assert_eq!(volume_to_db(0.0), f64::NEG_INFINITY);
    }
}
