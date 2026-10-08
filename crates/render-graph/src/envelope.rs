//! 音量包络（格式规范 §3.9 的 `mix.envelope`、`embeddedAudio.envelope`、合成的 `audio.envelope`）的求值：逐帧计划
//! （预览）与区间计划（导出）共用这一份。
//!
//! 包络取代实例的 `volume`：有生效的点时，某一时刻的音量是包络在那一刻的取样值。点换成 v2 的 `volume` 关键帧后交给
//! `timeline::duck::volume_curve`（v2 预览与导出共用的同一个函数）：线性段只取点本身，带缓动的段按
//! `ENVELOPE_BAKE_STEP`（0.02 秒）烘焙成折线；`at` 超出实例终点的点不生效；值夹到 [0, 4]。折线在第一个点之前取它的值，
//! 最后一个点之后取最后一个点的值（`GainEnvelope::at`）。时刻是实例局部的秒（序列时间减实例起点），百分比按实例的长度。

use editor_semantics::{MediaTime, Ratio};
use timeline::duck::{GainEnvelope, volume_curve};
use timeline::keyframes::{KeyTime, Keyframe, Keyframes};
use video_model::{CompositionItem, EnvelopePoint, TimelineItem};

/// 一个点最多的个数（与关键帧相同）。
pub const MAX_ENVELOPE_POINTS: usize = timeline::keyframes::KEYFRAMES_MAX_PER_PROP;

/// 实例的音量包络：没有包络时为 `None`（用静态的 `volume`）。
pub fn envelope_points(item: &TimelineItem) -> Option<&[EnvelopePoint]> {
    let envelope = match item {
        TimelineItem::Audio(a) => &a.mix.envelope,
        TimelineItem::Video(v) => &v.embedded_audio.envelope,
        TimelineItem::Composition(CompositionItem { audio: Some(audio), .. }) => &audio.envelope,
        _ => return None,
    };
    (!envelope.is_empty()).then_some(envelope.as_slice())
}

/// 音量包络换成 v2 的 `volume` 关键帧：`at` 是实例局部的秒，`percent` 写成 `"N%"`。点数超限、时刻为负、`at` 与
/// `percent` 不是恰好给一个时拒绝（引擎写入时用它校验）。
pub fn envelope_keyframes(points: &[EnvelopePoint]) -> Result<Vec<Keyframe>, String> {
    if points.len() > MAX_ENVELOPE_POINTS {
        return Err(format!("音量包络最多 {MAX_ENVELOPE_POINTS} 个点"));
    }
    let mut frames = Vec::with_capacity(points.len());
    for point in points {
        let t = match (&point.at, point.percent) {
            (Some(at), None) => {
                let s = seconds(at);
                if s < 0.0 {
                    return Err("音量包络的时刻不能为负".into());
                }
                KeyTime::Seconds(s)
            }
            (None, Some(percent)) => KeyTime::Percent(format!("{percent}%")),
            _ => return Err("音量包络的每个点须在 at 与 percent 中给且只给一个".into()),
        };
        frames.push(Keyframe {
            t,
            v: point.volume,
            ease: point.ease.clone(),
        });
    }
    Ok(frames)
}

fn seconds(t: &MediaTime) -> f64 {
    t.to_ratio("time").map(Ratio::to_f64).unwrap_or(f64::NAN)
}

/// 实例的音量曲线：`points` 为空时是常数 `volume`；否则是包络烘焙出的折线（实例局部的秒，线性倍数）。
/// `duration` 是实例在序列上的长度（秒），百分比的点按它换算。写坏的包络（引擎不会写进视频）按没有包络算。
#[derive(Clone, Debug, PartialEq)]
pub enum VolumeCurve {
    Constant(f64),
    Envelope(GainEnvelope),
}

impl VolumeCurve {
    pub fn new(volume: f64, points: &[EnvelopePoint], duration: f64) -> VolumeCurve {
        if points.is_empty() {
            return VolumeCurve::Constant(volume);
        }
        let Ok(frames) = envelope_keyframes(points) else {
            return VolumeCurve::Constant(volume);
        };
        let keyframes = Keyframes {
            volume: Some(frames),
            ..Keyframes::default()
        };
        VolumeCurve::Envelope(GainEnvelope(volume_curve(volume, Some(&keyframes), duration)))
    }

    /// 实例局部 `local` 秒的音量（线性倍数）。
    pub fn at(&self, local: f64) -> f64 {
        match self {
            VolumeCurve::Constant(volume) => *volume,
            VolumeCurve::Envelope(envelope) => envelope.at(local),
        }
    }
}
