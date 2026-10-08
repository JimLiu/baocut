//! 实例的窗口变了之后改写它的关键帧绑定与音量包络（视频格式规范 §3.15、§3.9）。
//!
//! 换算只有一份，取 `timeline::keyframes`：裁切与跟随用 `rewindow`，拆分用 `split_keyframes`，合并用
//! `join_keyframes`。这里只做两种写法之间的转换：绑定的 `localFrame` 按序列帧率换成实例局部的秒，换算之后取
//! 最近的帧写回（同一帧上的几帧只留后一帧的值）；百分比原样往返。音量包络的 `at` 换算之后按微秒写回
//! （`rewindow` 本身就取到微秒）。

use editor_semantics::{MediaTime, Rate, Ratio};
use timeline::keyframes::{KeyTime, Keyframe as V2Keyframe, Keyframes, Rewindow, join_keyframes, rewindow, split_keyframes};

use crate::error::{EngineResult, ErrorBody, Text, kinds};
use crate::ids::new_id;
use crate::model::*;
use crate::state::VideoState;
use render_graph::envelope::envelope_keyframes;

/// 一个实例的关键帧（画面绑定与音量包络）：v2 的写法。
fn keyframes_of(state: &VideoState, item_id: &str, fps: f64) -> EngineResult<Keyframes> {
    let placed = state.items.get(item_id).ok_or_else(|| ErrorBody::not_found(kinds::item(), item_id))?;
    let header = &state.sequence(&placed.sequence_id)?.header;
    let fail = |message: Text| ErrorBody::invalid_operation(message).entities([item_id]);
    let mut keyframes = bindings_to_timeline(header.animation_bindings.iter().filter(|b| b.target_id == item_id), fps).map_err(fail)?;
    if let Some(points) = envelope(&placed.value).filter(|p| !p.is_empty()) {
        keyframes.volume = Some(envelope_keyframes(points).map_err(|e| fail(e.into()))?);
    }
    Ok(keyframes)
}

/// 把 v2 写法的关键帧写回实例：画面属性写成序列上的绑定（已有的绑定保留 ID，新的分配 ID），音量写回包络。
/// 没有出现的属性去掉。
fn write_keyframes(state: &mut VideoState, item_id: &str, keyframes: &Keyframes, fps: f64) -> EngineResult<()> {
    let placed = state.items.get_mut(item_id).ok_or_else(|| ErrorBody::not_found(kinds::item(), item_id))?;
    if let Some(points) = envelope_mut(&mut placed.value) {
        *points = keyframes.volume.as_deref().map(to_envelope).unwrap_or_default();
    }
    let sequence_id = placed.sequence_id.clone();
    let header = &mut state
        .sequences
        .get_mut(&sequence_id)
        .ok_or_else(|| ErrorBody::not_found(kinds::sequence(), &sequence_id))?
        .header;
    let mut kept = Vec::new();
    for property in ALL_PROPERTIES {
        let frames = keyframes.get(property.as_str()).filter(|f| !f.is_empty());
        let existing = header
            .animation_bindings
            .iter()
            .find(|b| b.target_id == item_id && b.property_path == property)
            .map(|b| b.id.clone());
        if let Some(frames) = frames {
            kept.push(AnimationBinding {
                id: existing.unwrap_or_else(|| new_id("kb")),
                target_id: item_id.to_string(),
                property_path: property,
                keyframes: to_binding_keyframes(frames, fps),
            });
        }
    }
    // 保持绑定在序列上的先后：原位替换，新增的接在后面。
    let mut out = Vec::with_capacity(header.animation_bindings.len());
    for binding in header.animation_bindings.drain(..) {
        if binding.target_id != item_id {
            out.push(binding);
        } else if let Some(i) = kept.iter().position(|k| k.id == binding.id) {
            out.push(kept.remove(i));
        }
    }
    out.extend(kept);
    header.animation_bindings = out;
    Ok(())
}

/// 裁切与跟随：实例的窗口按 `window` 改了（§3.15「裁切或跟随剪口改变实例的窗口时」）。
pub(crate) fn rewindow_item(state: &mut VideoState, item_id: &str, window: Rewindow, fps: Rate) -> EngineResult<()> {
    let fps = fps.ratio().to_f64();
    let keyframes = keyframes_of(state, item_id, fps)?;
    if keyframes.is_empty() {
        return Ok(());
    }
    write_keyframes(state, item_id, &rewindow(&keyframes, window), fps)
}

/// 拆分：`left_id` 已是左半、`right_id` 是新的右半（还带着左半的关键帧）。`duration` 是拆分之前的长度，
/// `cut` 是拆分点的实例局部秒。左半保留原来的绑定 ID，右半的绑定是新的。
pub(crate) fn split_item(state: &mut VideoState, left_id: &str, right_id: &str, duration: f64, cut: f64, fps: Rate) -> EngineResult<()> {
    let fps = fps.ratio().to_f64();
    let keyframes = keyframes_of(state, left_id, fps)?;
    if keyframes.is_empty() {
        return Ok(());
    }
    let (left, right) = split_keyframes(&keyframes, duration, cut);
    write_keyframes(state, left_id, &left, fps)?;
    write_keyframes(state, right_id, &right, fps)
}

/// 合并：时间上靠前的 `early`（长 `early_duration` 秒）与靠后的 `late` 拼回一件。能还原成同一串帧时返回
/// 拼好的关键帧（`Some(None)` 是两边都没有），否则 `None`。
pub(crate) fn join_items(
    state: &VideoState,
    early: &str,
    early_duration: f64,
    late: &str,
    late_duration: f64,
    fps: Rate,
) -> EngineResult<Option<Option<Keyframes>>> {
    let fps = fps.ratio().to_f64();
    let some = |k: Keyframes| (!k.is_empty()).then_some(k);
    let a = some(keyframes_of(state, early, fps)?);
    let b = some(keyframes_of(state, late, fps)?);
    Ok(join_keyframes(a.as_ref(), early_duration, b.as_ref(), late_duration))
}

/// 把合并拼好的关键帧写到留下的实例上。
pub(crate) fn write_joined(state: &mut VideoState, item_id: &str, keyframes: Option<&Keyframes>, fps: Rate) -> EngineResult<()> {
    write_keyframes(state, item_id, keyframes.unwrap_or(&Keyframes::default()), fps.ratio().to_f64())
}

/// 把 `from` 的关键帧原样搬到 `to` 上（合并时用 `keep` 选了靠后那一边）。
pub(crate) fn copy_bindings(state: &mut VideoState, from: &str, to: &str) -> EngineResult<()> {
    let sequence_id = state
        .items
        .get(to)
        .ok_or_else(|| ErrorBody::not_found(kinds::item(), to))?
        .sequence_id
        .clone();
    let header = &mut state
        .sequences
        .get_mut(&sequence_id)
        .ok_or_else(|| ErrorBody::not_found(kinds::sequence(), &sequence_id))?
        .header;
    header.animation_bindings.retain(|b| b.target_id != to);
    for binding in header.animation_bindings.iter_mut().filter(|b| b.target_id == from) {
        binding.target_id = to.to_string();
    }
    Ok(())
}

const ALL_PROPERTIES: [KeyframeProperty; 7] = [
    KeyframeProperty::X,
    KeyframeProperty::Y,
    KeyframeProperty::Scale,
    KeyframeProperty::ScaleY,
    KeyframeProperty::Rot,
    KeyframeProperty::Opacity,
    KeyframeProperty::Radius,
];

/// v2 的帧换回绑定的帧：秒取最近的帧，同一帧上只留后一帧的值；百分比原样。
pub(crate) fn to_binding_keyframes(frames: &[V2Keyframe], fps: f64) -> Vec<Keyframe> {
    let mut out: Vec<Keyframe> = Vec::with_capacity(frames.len());
    for frame in frames {
        let (local_frame, percent) = match &frame.t {
            KeyTime::Seconds(s) => (Some((s * fps).round().max(0.0) as i64), None),
            KeyTime::Percent(_) => (None, frame.t.percent()),
        };
        match out.last_mut() {
            Some(last) if local_frame.is_some() && last.local_frame == local_frame => last.value = frame.v,
            _ => out.push(Keyframe {
                local_frame,
                percent,
                value: frame.v,
                ease: frame.ease.clone(),
            }),
        }
    }
    out
}

/// v2 的音量帧换回包络：秒按微秒写回。
fn to_envelope(frames: &[V2Keyframe]) -> Vec<EnvelopePoint> {
    frames
        .iter()
        .map(|frame| {
            let (at, percent) = match &frame.t {
                KeyTime::Seconds(s) => {
                    let micros = (s * 1e6).round().max(0.0) as i128;
                    let at = Ratio::new(micros, 1_000_000).and_then(|r| MediaTime::from_ratio(r, "at").ok());
                    (at, None)
                }
                KeyTime::Percent(_) => (None, frame.t.percent()),
            };
            EnvelopePoint {
                at,
                percent,
                volume: frame.v,
                ease: frame.ease.clone(),
            }
        })
        .collect()
}

fn envelope(item: &TimelineItem) -> Option<&[EnvelopePoint]> {
    match item {
        TimelineItem::Audio(a) => Some(&a.mix.envelope),
        TimelineItem::Video(v) => Some(&v.embedded_audio.envelope),
        TimelineItem::Composition(CompositionItem { audio: Some(audio), .. }) => Some(&audio.envelope),
        _ => None,
    }
}

fn envelope_mut(item: &mut TimelineItem) -> Option<&mut Vec<EnvelopePoint>> {
    match item {
        TimelineItem::Audio(a) => Some(&mut a.mix.envelope),
        TimelineItem::Video(v) => Some(&mut v.embedded_audio.envelope),
        TimelineItem::Composition(CompositionItem { audio: Some(audio), .. }) => Some(&mut audio.envelope),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seconds_round_to_the_nearest_frame_and_collapse_on_the_same_frame() {
        let frames = [
            V2Keyframe {
                t: KeyTime::Seconds(0.0),
                v: 0.0,
                ease: None,
            },
            V2Keyframe {
                t: KeyTime::Seconds(0.01),
                v: 0.5,
                ease: None,
            },
            V2Keyframe {
                t: KeyTime::Seconds(1.0),
                v: 1.0,
                ease: Some("easeOutQuad".into()),
            },
        ];
        let out = to_binding_keyframes(&frames, 30.0);
        assert_eq!(out.len(), 2);
        assert_eq!((out[0].local_frame, out[0].value), (Some(0), 0.5));
        assert_eq!((out[1].local_frame, out[1].ease.as_deref()), (Some(30), Some("easeOutQuad")));
        let percent = to_binding_keyframes(
            &[V2Keyframe {
                t: KeyTime::Percent("12.5%".into()),
                v: 1.0,
                ease: None,
            }],
            30.0,
        );
        assert_eq!((percent[0].local_frame, percent[0].percent), (None, Some(12.5)));
    }
}
