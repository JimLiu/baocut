//! 闪避与元素增益包络（`bcutTimeline` 0.12，BCF 规范 §19.x「音量包络与闪避」）。
//!
//! 元素上的 `duck: {under, depth?, attack?, release?}`：`under` 是 `"speech"`（有人
//! 说话的时候）或一条轨的 id（那条轨上有出声的元素的时候）。**活动区间只从文档算，
//! 不做音频分析**：
//!
//! - `speech`：文稿里每个词的时间（已投影到成片时钟、剪掉的词已丢，即导出文档
//!   `cues[].words[].t0/t1`；某条 cue 没有词时退回它的 `start/end`）。
//! - 轨：那条轨（未隐藏、未静音）上未隐藏、未静音、源不是「无音轨」的
//!   audio / video 元素的 `[start, end]`，不含闪避元素自己。
//!
//! 相邻区间的间隔不超过 `max(DUCK_MERGE_GAP, attack + release)` 时合并成一段，
//! 所以压下与回升的斜坡不会重叠。每段活动 `[a, b]` 的闪避增益：`a - attack` 起
//! 从 1 线性降到 `10^(-depth/20)`，保持到 `b`，再在 `release` 秒内线性回到 1。
//!
//! 最终增益（规范性顺序）= 音量（静态值，或 `volume` 关键帧取样）× 淡入淡出 ×
//! 闪避。本模块把「音量 × 闪避」合成一条分段线性的 [`GainEnvelope`]（元素本地秒）；
//! 淡入淡出仍由各宿主按既有公式乘上去。没有 `volume` 关键帧也没有生效闪避的元素
//! 不出包络——宿主照旧用静态音量，结果逐位不变。导出混音（原生与 ffmpeg）、Web
//! 预览（经 wasm）与 App 预览都只消费 [`element_gain_envelopes`] 的结果。

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::keyframes::{self, Keyframes, VOLUME_RANGE};
use crate::schema::TimelineError;

/// `duck.under` 的保留值：有人说话的时候。
pub const DUCK_UNDER_SPEECH: &str = "speech";
/// `duck.depth` 缺省（dB，压低多少；取 BCF `audio.duck` 规范示例的 10 dB）。
pub const DUCK_DEPTH_DEFAULT: f64 = 10.0;
/// `duck.depth` 的区间（dB，含两端；0 = 不压）。
pub const DUCK_DEPTH_RANGE: (f64, f64) = (0.0, 60.0);
/// `duck.attack` 缺省（秒）：与 BCF `audio.duck` 同一个常量。
pub const DUCK_ATTACK_DEFAULT: f64 = scene_primitives::audio_mix::DUCK_ATTACK;
/// `duck.release` 缺省（秒）：与 BCF `audio.duck` 同一个常量。
pub const DUCK_RELEASE_DEFAULT: f64 = scene_primitives::audio_mix::DUCK_RELEASE;
/// `duck.attack` / `duck.release` 的区间（秒，含两端）。
pub const DUCK_TIME_RANGE: (f64, f64) = (0.0, 5.0);
/// 活动区间合并阈值（秒）：间隔不超过它（或 `attack + release`，取大）的相邻区间合并。
pub const DUCK_MERGE_GAP: f64 = 0.5;
/// 斜坡的最短时长（秒）：`attack` / `release` 写 0 时按它算，免得增益跳变出爆音，
/// 也让包络的每一段都有非零时长。
pub const DUCK_MIN_RAMP: f64 = 0.001;
/// 带缓动的 `volume` 关键帧段烘焙成折线时的步长（秒）。
pub const ENVELOPE_BAKE_STEP: f64 = 0.02;
/// 告警码：`under:"speech"` 但文档里没有任何带时间的文稿，闪避不生效。
pub const DUCK_NO_SPEECH: &str = "duck-no-speech";
/// 告警码：`under` 指向的轨不存在。
pub const DUCK_TRACK_MISSING: &str = "duck-track-missing";

/// 元素上的 `duck`。缺席的参数取缺省值（`depth` 10 dB、`attack` 0.02 s、`release` 0.35 s）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Duck {
    pub under: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub depth: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attack: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub release: Option<f64>,
}

impl Duck {
    pub fn depth_db(&self) -> f64 {
        self.depth.unwrap_or(DUCK_DEPTH_DEFAULT)
    }

    pub fn attack_seconds(&self) -> f64 {
        self.attack.unwrap_or(DUCK_ATTACK_DEFAULT)
    }

    pub fn release_seconds(&self) -> f64 {
        self.release.unwrap_or(DUCK_RELEASE_DEFAULT)
    }

    /// 闪避期间的增益（线性）。
    pub fn floor_gain(&self) -> f64 {
        keyframes::db_to_volume(-self.depth_db())
    }

    pub fn is_speech(&self) -> bool {
        self.under == DUCK_UNDER_SPEECH
    }

    /// 字段级校验（`under` 是否指向存在的轨由文档级校验做）。
    pub fn validate(&self, element_id: &str) -> Result<(), TimelineError> {
        if self.under.trim().is_empty() || self.under == "none" {
            return Err(TimelineError::Invalid(format!(
                "element {element_id} 的 duck.under 须是 \"speech\" 或一条轨的 id"
            )));
        }
        let within = |value: Option<f64>, range: (f64, f64)| {
            value.is_none_or(|value| value.is_finite() && (range.0..=range.1).contains(&value))
        };
        if !within(self.depth, DUCK_DEPTH_RANGE) {
            return Err(TimelineError::Invalid(format!(
                "element {element_id} 的 duck.depth 须在 {}..={} dB",
                DUCK_DEPTH_RANGE.0, DUCK_DEPTH_RANGE.1
            )));
        }
        for (name, value) in [("attack", self.attack), ("release", self.release)] {
            if !within(value, DUCK_TIME_RANGE) {
                return Err(TimelineError::Invalid(format!(
                    "element {element_id} 的 duck.{name} 须在 {}..={} 秒",
                    DUCK_TIME_RANGE.0, DUCK_TIME_RANGE.1
                )));
            }
        }
        Ok(())
    }
}

/// 分段线性的增益包络，时间是元素本地秒。第一点之前取第一点的值，最后一点之后
/// 取最后一点的值；点按时间升序，相邻点时间严格递增。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct GainEnvelope(pub Vec<[f64; 2]>);

impl GainEnvelope {
    pub fn points(&self) -> &[[f64; 2]] {
        &self.0
    }

    /// 本地时刻 `local` 的增益。
    pub fn at(&self, local: f64) -> f64 {
        let points = &self.0;
        let Some(first) = points.first() else {
            return 1.0;
        };
        if local <= first[0] {
            return first[1];
        }
        for pair in points.windows(2) {
            let ([t0, g0], [t1, g1]) = (pair[0], pair[1]);
            if local < t1 {
                let span = t1 - t0;
                if span <= 0.0 {
                    return g1;
                }
                return g0 + (g1 - g0) * ((local - t0) / span);
            }
        }
        points[points.len() - 1][1]
    }
}

/// 一条告警（闪避配置了却不生效的原因）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GainWarning {
    pub element: String,
    pub code: String,
    pub message: String,
}

/// [`element_gain_envelopes`] 的结果。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioGainPlan {
    /// 元素 id → 包络。只含有 `volume` 关键帧或生效闪避的元素。
    pub envelopes: BTreeMap<String, GainEnvelope>,
    pub warnings: Vec<GainWarning>,
}

/// 排序并合并区间：重叠或间隔不超过 `gap` 的相邻区间并成一段。丢掉空区间。
pub fn merge_intervals(mut intervals: Vec<(f64, f64)>, gap: f64) -> Vec<(f64, f64)> {
    intervals.retain(|(start, end)| start.is_finite() && end.is_finite() && end > start);
    intervals.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.total_cmp(&b.1)));
    let mut out: Vec<(f64, f64)> = Vec::with_capacity(intervals.len());
    for (start, end) in intervals {
        match out.last_mut() {
            Some(last) if start - last.1 <= gap => last.1 = last.1.max(end),
            _ => out.push((start, end)),
        }
    }
    out
}

fn number(value: Option<&Value>) -> Option<f64> {
    value
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite())
}

/// 文稿的说话区间（成片时钟，未合并）。`cues` 是已投影到成片时钟的 cue 数组
/// （导出文档与 Web 渲染文档的 `cues`）：每个词的 `t0/t1`（或 `start/end`）；
/// 没有词的 cue 取它自己的 `start/end`。
pub fn speech_intervals(cues: &Value) -> Vec<(f64, f64)> {
    let mut out = Vec::new();
    for cue in cues.as_array().into_iter().flatten() {
        let words = cue.get("words").and_then(Value::as_array);
        let mut any = false;
        for word in words.into_iter().flatten() {
            let start = number(word.get("t0").or_else(|| word.get("start")));
            let end = number(word.get("t1").or_else(|| word.get("end")));
            if let (Some(start), Some(end)) = (start, end)
                && end > start
            {
                out.push((start, end));
                any = true;
            }
        }
        if !any
            && let (Some(start), Some(end)) = (number(cue.get("start")), number(cue.get("end")))
            && end > start
        {
            out.push((start, end));
        }
    }
    out
}

fn element_window(element: &Value, project_end: f64) -> (f64, f64) {
    let start = number(element.get("start"))
        .unwrap_or(0.0)
        .clamp(0.0, project_end.max(0.0));
    let end = number(element.get("end"))
        .unwrap_or(project_end)
        .clamp(0.0, project_end.max(0.0));
    (start, end)
}

fn source_is_silent(timeline: &Value, element: &Value) -> bool {
    element
        .get("srcId")
        .and_then(Value::as_str)
        .and_then(|id| timeline.pointer(&format!("/sources/{id}/hasAudio")))
        .and_then(Value::as_bool)
        == Some(false)
}

/// 一条轨上出声元素的区间（成片时钟，未合并）；轨不存在返回 `None`。
pub fn track_intervals(
    timeline: &Value,
    track_id: &str,
    exclude_element: &str,
    project_end: f64,
) -> Option<Vec<(f64, f64)>> {
    let track = timeline
        .get("tracks")
        .and_then(Value::as_array)?
        .iter()
        .find(|track| track.get("id").and_then(Value::as_str) == Some(track_id))?;
    if track.get("hidden").and_then(Value::as_bool) == Some(true)
        || track.get("muted").and_then(Value::as_bool) == Some(true)
    {
        return Some(Vec::new());
    }
    let mut out = Vec::new();
    for element in track
        .get("elements")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if !matches!(
            element.get("kind").and_then(Value::as_str),
            Some("audio" | "video")
        ) || element.get("id").and_then(Value::as_str) == Some(exclude_element)
            || element.get("hidden").and_then(Value::as_bool) == Some(true)
            || element.get("muted").and_then(Value::as_bool) == Some(true)
            || source_is_silent(timeline, element)
        {
            continue;
        }
        let (start, end) = element_window(element, project_end);
        if end > start {
            out.push((start, end));
        }
    }
    Some(out)
}

/// 合并后的活动区间 → 闪避增益的折线（成片时钟）。空活动返回空折线（恒 1）。
pub fn duck_curve(activity: &[(f64, f64)], duck: &Duck) -> Vec<[f64; 2]> {
    let floor = duck.floor_gain();
    let attack = duck.attack_seconds().max(DUCK_MIN_RAMP);
    let release = duck.release_seconds().max(DUCK_MIN_RAMP);
    let merged = merge_intervals(activity.to_vec(), DUCK_MERGE_GAP.max(attack + release));
    let mut out = Vec::with_capacity(merged.len() * 4);
    for (start, end) in merged {
        out.push([start - attack, 1.0]);
        out.push([start, floor]);
        out.push([end, floor]);
        out.push([end + release, 1.0]);
    }
    out
}

/// `volume` 关键帧 → 音量折线（元素本地秒）。线性段只取关键帧处的点；带缓动的段
/// 按 [`ENVELOPE_BAKE_STEP`] 烘焙。没有生效帧时是静态音量的一个点。
pub fn volume_curve(
    static_volume: f64,
    keyframes: Option<&Keyframes>,
    duration: f64,
) -> Vec<[f64; 2]> {
    let clamp = |value: f64| value.clamp(VOLUME_RANGE.0, VOLUME_RANGE.1);
    let frames = keyframes.and_then(|keyframes| keyframes.volume.as_deref());
    let mut out: Vec<[f64; 2]> = Vec::new();
    let mut previous: Option<(f64, f64)> = None;
    for frame in frames.into_iter().flatten() {
        let at = frame.t.local_seconds(duration);
        if matches!(frame.t, keyframes::KeyTime::Seconds(_)) && at > duration + 1e-9 {
            break;
        }
        let linear = frame.ease.as_deref().is_none_or(|ease| ease == "linear");
        if let Some((from_t, from_v)) = previous
            && !linear
            && at > from_t
        {
            let steps = ((at - from_t) / ENVELOPE_BAKE_STEP).ceil().max(1.0) as usize;
            for step in 1..steps {
                let local = from_t + (at - from_t) * step as f64 / steps as f64;
                let progress = (local - from_t) / (at - from_t);
                let eased = ::motion::curve::apply_ease(frame.ease.as_deref(), progress);
                out.push([local, clamp(from_v + (frame.v - from_v) * eased)]);
            }
        }
        out.push([at, clamp(frame.v)]);
        previous = Some((at, frame.v));
    }
    if out.is_empty() {
        out.push([0.0, clamp(static_volume)]);
    }
    out
}

fn curve_at(points: &[[f64; 2]], local: f64, empty: f64) -> f64 {
    if points.is_empty() {
        empty
    } else {
        GainEnvelope(points.to_vec()).at(local)
    }
}

/// 音量折线 × 闪避折线（已换成本地秒）→ 包络。取两条折线断点的并集（夹到
/// `[0, duration]`，并含两端），逐点相乘，去掉三点同值的中间点。
fn combine(volume: &[[f64; 2]], duck: &[[f64; 2]], duration: f64) -> GainEnvelope {
    let mut times: Vec<f64> = volume
        .iter()
        .chain(duck.iter())
        .map(|point| point[0])
        .filter(|time| *time > 0.0 && *time < duration)
        .collect();
    times.push(0.0);
    times.push(duration.max(0.0));
    times.sort_by(f64::total_cmp);
    times.dedup_by(|a, b| (*a - *b).abs() <= 1e-9);
    let mut points: Vec<[f64; 2]> = Vec::with_capacity(times.len());
    for time in times {
        let gain = curve_at(volume, time, 1.0) * curve_at(duck, time, 1.0);
        if points.len() >= 2 {
            let n = points.len();
            if points[n - 1][1] == gain && points[n - 2][1] == gain {
                points[n - 1][0] = time;
                continue;
            }
        }
        points.push([time, gain]);
    }
    GainEnvelope(points)
}

/// 整条时间轴的元素增益包络。
///
/// - `timeline`：原始时间轴 JSON（`tracks[]` 的元素 `start/end` 已是成片秒；可带
///   `sources` 用来认出无音轨的源）。
/// - `cues`：已投影到成片时钟的 cue 数组（没有文稿传 `null` 或空数组）。
/// - `project_end`：开放结尾元素的末尾（成片时长）。
///
/// 只处理 audio / video 元素；隐藏或静音的元素（或所在轨）不出包络。
pub fn element_gain_envelopes(timeline: &Value, cues: &Value, project_end: f64) -> AudioGainPlan {
    let mut plan = AudioGainPlan::default();
    let mut speech: Option<Vec<(f64, f64)>> = None;
    for track in timeline
        .get("tracks")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if track.get("hidden").and_then(Value::as_bool) == Some(true)
            || track.get("muted").and_then(Value::as_bool) == Some(true)
        {
            continue;
        }
        for element in track
            .get("elements")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            if !matches!(
                element.get("kind").and_then(Value::as_str),
                Some("audio" | "video")
            ) || element.get("hidden").and_then(Value::as_bool) == Some(true)
                || element.get("muted").and_then(Value::as_bool) == Some(true)
            {
                continue;
            }
            let keyframes = keyframes::from_json(element.get("keyframes"))
                .filter(|keyframes| keyframes.volume.is_some());
            let duck = element
                .get("duck")
                .filter(|duck| duck.is_object())
                .and_then(|duck| serde_json::from_value::<Duck>(duck.clone()).ok());
            if keyframes.is_none() && duck.is_none() {
                continue;
            }
            let id = element
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned();
            let (start, end) = element_window(element, project_end);
            let duration = (end - start).max(0.0);
            let static_volume = number(element.get("volume")).unwrap_or(1.0);
            let mut duck_points = Vec::new();
            if let Some(duck) = &duck {
                let activity = if duck.is_speech() {
                    let intervals = speech.get_or_insert_with(|| speech_intervals(cues));
                    if intervals.is_empty() {
                        plan.warnings.push(GainWarning {
                            element: id.clone(),
                            code: DUCK_NO_SPEECH.into(),
                            message: "没有带时间的文稿，按人声闪避不生效".into(),
                        });
                    }
                    intervals.clone()
                } else {
                    match track_intervals(timeline, &duck.under, &id, project_end) {
                        Some(intervals) => intervals,
                        None => {
                            plan.warnings.push(GainWarning {
                                element: id.clone(),
                                code: DUCK_TRACK_MISSING.into(),
                                message: format!("闪避依据的轨 {} 不存在，闪避不生效", duck.under),
                            });
                            Vec::new()
                        }
                    }
                };
                duck_points = duck_curve(&activity, duck)
                    .into_iter()
                    .map(|[time, gain]| [time - start, gain])
                    .collect();
            }
            if keyframes.is_none() && duck_points.is_empty() {
                continue;
            }
            let volume = volume_curve(static_volume, keyframes.as_ref(), duration);
            plan.envelopes
                .insert(id, combine(&volume, &duck_points, duration));
        }
    }
    plan
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    #[test]
    fn merge_joins_close_intervals() {
        let merged = merge_intervals(vec![(3.0, 4.0), (0.0, 1.0), (1.2, 2.0), (-1.0, -1.0)], 0.5);
        assert_eq!(merged, vec![(0.0, 2.0), (3.0, 4.0)]);
    }

    #[test]
    fn speech_duck_envelope_uses_word_times_and_defaults() {
        let timeline = json!({"tracks": [{"id": "music", "kind": "audio", "elements": [
            {"id": "bgm", "kind": "audio", "srcId": "m", "start": 1.0, "end": 11.0, "volume": 0.5,
             "duck": {"under": "speech"}}
        ]}]});
        let cues = json!([
            {"start": 2.0, "end": 4.0, "words": [{"t0": 2.0, "t1": 2.5}, {"t0": 2.6, "t1": 4.0}]},
            {"start": 8.0, "end": 9.0}
        ]);
        let plan = element_gain_envelopes(&timeline, &cues, 20.0);
        assert!(plan.warnings.is_empty());
        let envelope = &plan.envelopes["bgm"];
        let floor = keyframes::db_to_volume(-DUCK_DEPTH_DEFAULT);
        // 本地秒 = 成片秒 - 1。
        assert!(close(envelope.at(0.0), 0.5));
        assert!(close(envelope.at(1.0), 0.5 * floor)); // 说话开始（成片 2.0）
        assert!(close(envelope.at(2.5), 0.5 * floor)); // 词间隙已合并
        assert!(close(envelope.at(3.0 + DUCK_RELEASE_DEFAULT), 0.5)); // 回升完毕
        assert!(close(envelope.at(7.5), 0.5 * floor));
        assert!(close(envelope.at(9.5), 0.5));
        let last = envelope.points().last().unwrap();
        assert!(close(last[0], 10.0));
    }

    #[test]
    fn speech_without_transcript_warns_and_emits_nothing() {
        let timeline = json!({"tracks": [{"id": "t", "kind": "audio", "elements": [
            {"id": "bgm", "kind": "audio", "srcId": "m", "duck": {"under": "speech"}}
        ]}]});
        let plan = element_gain_envelopes(&timeline, &Value::Null, 10.0);
        assert!(plan.envelopes.is_empty());
        assert_eq!(plan.warnings[0].code, DUCK_NO_SPEECH);
    }

    #[test]
    fn track_duck_ignores_muted_and_silent_elements() {
        let timeline = json!({
            "sources": {"quiet": {"kind": "video", "hasAudio": false}},
            "tracks": [
                {"id": "vo", "kind": "audio", "elements": [
                    {"id": "a", "kind": "audio", "srcId": "v", "start": 2.0, "end": 3.0},
                    {"id": "b", "kind": "audio", "srcId": "v", "start": 5.0, "end": 6.0, "muted": true},
                    {"id": "c", "kind": "video", "srcId": "quiet", "start": 7.0, "end": 8.0}
                ]},
                {"id": "music", "kind": "audio", "elements": [
                    {"id": "bgm", "kind": "audio", "srcId": "m", "start": 0.0, "end": 10.0,
                     "duck": {"under": "vo", "depth": 20, "attack": 0, "release": 0}}
                ]}
            ]
        });
        let plan = element_gain_envelopes(&timeline, &Value::Null, 10.0);
        let envelope = &plan.envelopes["bgm"];
        assert!(close(envelope.at(2.5), 0.1));
        assert!(close(envelope.at(5.5), 1.0));
        assert!(close(envelope.at(7.5), 1.0));
        assert!(close(envelope.at(1.0), 1.0));
    }

    #[test]
    fn volume_keyframes_without_duck_become_the_envelope() {
        let timeline = json!({"tracks": [{"id": "t", "kind": "audio", "elements": [
            {"id": "a", "kind": "audio", "srcId": "m", "start": 0.0, "end": 4.0,
             "keyframes": {"volume": [{"t": "0%", "v": 0.0}, {"t": "50%", "v": 1.0}, {"t": "100%", "v": 1.0, "ease": "easeInQuad"}]}},
            {"id": "plain", "kind": "audio", "srcId": "m", "volume": 0.3}
        ]}]});
        let plan = element_gain_envelopes(&timeline, &Value::Null, 4.0);
        assert!(!plan.envelopes.contains_key("plain"));
        let envelope = &plan.envelopes["a"];
        assert!(close(envelope.at(1.0), 0.5));
        assert!(close(envelope.at(3.0), 1.0));
        assert!(close(envelope.at(0.0), 0.0));
    }

    #[test]
    fn duck_validation_ranges() {
        let parse = |value: serde_json::Value| serde_json::from_value::<Duck>(value).unwrap();
        assert!(parse(json!({"under": "speech"})).validate("e").is_ok());
        assert!(
            parse(json!({"under": "speech", "depth": 61}))
                .validate("e")
                .is_err()
        );
        assert!(
            parse(json!({"under": "speech", "attack": -1}))
                .validate("e")
                .is_err()
        );
        assert!(parse(json!({"under": "none"})).validate("e").is_err());
        assert!(serde_json::from_value::<Duck>(json!({"depth": 3})).is_err());
    }
}
