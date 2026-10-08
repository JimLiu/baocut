//! 声音的区间计划（架构设计 §9.13 的音频导出）：一段序列范围里有哪些声音、各自取素材的哪一段、放在时间线的哪里、
//! 增益与淡变是多少。它是 [`plan_frame`](super::plan_frame) 里 `voices` 的区间形式：哪些实例发声、增益、淡变与速度
//! 都按同一套规则（轨道静音与 Solo、实例停用、`mix.muted`、内嵌音频的开关、合成的预渲染替身），只是不逐帧求，
//! 而是给出每个实例在范围里的整段。混音由后端按计划去做（导出时是 ffmpeg），这里不解码、不混音。
//!
//! 闪避与转场的声音交叉淡化也是同一份实现：闪避的压低量来自 [`DuckingEnvelope`]（给出折点，后端在折点之间线性插值），
//! 交叉淡化的窗口来自 [`transition_window`](super::transition_window)，曲线与逐帧计划相同（等功率，线性进度）；
//! 窗口里另一侧在自己区间之外的声音按它的时间映射取 handles，是单独的一段（`handle`），不套它自己的淡入淡出。
//!
//! 音量包络（`mix.envelope`、`embeddedAudio.envelope`、合成的 `audio.envelope`）取代实例的 `volume`，与逐帧计划用同一个
//! 求值（[`VolumeCurve`]）：有包络的段 `gain_db` 是 0，音量在 `envelope` 的折点里（线性倍数，折点之间线性，两端外延）。
//!
//! 与逐帧计划一致的取舍：
//! - 按文稿触发的闪避规则（`trigger.kind = speech`）要有效词流，由调用方用 [`speech_activity`] 求出、交给
//!   [`plan_audio_with_speech`]；词流为空时不压低，被压低的实例各报一条 `DUCK_NO_SPEECH`。预览把同一份词流交给逐帧计划
//!   （[`plan_frame_with_speech`](super::plan_frame_with_speech)），两边在同一时刻的压低量相同；
//! - 交叉淡化要的 handles 超出素材的两端时，超出的部分没有声音，报出来（`CROSSFADE_HANDLE_SHORT`）；
//! - 定格（`TimeMap::Hold`）的实例逐帧计划给出速度 0，预览在速度 0 时不出声，这里不给出区间，同样报出来；
//! - 素材没有音频流（例如没有声音的视频）时没有可混的声音，不给出区间，报出来。

use std::collections::{BTreeMap, HashMap};

use editor_semantics::{MediaTime, Rate, Ratio, TimeMap, frame_time, map_time};
use serde::Serialize;
use serde_json::Value;
use video_model::{DocumentRecord, DurationPolicy, EnvelopePoint, Id, Revision, Sequence, TimelineItem, Track, VersionRef};

use super::{
    PlanError, TrackRules, VideoView, VoiceSource, audio_bounds, checked_fps, frame_start, source_rate, span_bounds, transition_window,
    volume_db,
};
use crate::ducking::DuckingEnvelope;
use crate::envelope::VolumeCurve;
use crate::text_plan::plan_text;

/// 计划覆盖的序列范围 `[start, end)`：精确值与秒数。
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanRange {
    pub start: MediaTime,
    pub end: MediaTime,
    pub start_seconds: f64,
    pub end_seconds: f64,
    pub duration_seconds: f64,
}

impl PlanRange {
    pub(crate) fn new(start: Ratio, end: Ratio) -> Result<PlanRange, PlanError> {
        let duration = end.checked_sub(start).ok_or_else(|| PlanError::overflow("range"))?;
        Ok(PlanRange {
            start: MediaTime::from_ratio(start, "range.start")?,
            end: MediaTime::from_ratio(end, "range.end")?,
            start_seconds: start.to_f64(),
            end_seconds: end.to_f64(),
            duration_seconds: duration.to_f64(),
        })
    }
}

/// 淡变：振幅在 `[start, end)` 里线性变化（淡入从 0 升到 1，淡出从 1 降到 0）。秒，相对范围的起点；可以落在区间之外
/// （区间被范围裁过时，淡变照原来的位置算）。
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct AudioFade {
    pub start: f64,
    pub end: f64,
}

/// 交叉淡化里的哪一侧：出场的一侧乘 cos(p·π/2)，入场的一侧乘 sin(p·π/2)。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CrossfadeRole {
    Outgoing,
    Incoming,
}

/// 转场的声音交叉淡化（等功率，格式规范 §3.9）：p 是 `[start, end)` 里的线性进度（不经缓动），窗口之前夹到 0、之后夹到 1。
/// 秒，相对范围的起点。
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioCrossfade {
    pub transition_id: Id,
    pub role: CrossfadeRole,
    pub start: f64,
    pub end: f64,
}

impl AudioCrossfade {
    /// `t`（秒，相对范围的起点）这一刻的振幅系数。
    pub fn amplitude(&self, t: f64) -> f64 {
        let p = ((t - self.start) / (self.end - self.start)).clamp(0.0, 1.0);
        let angle = p * std::f64::consts::FRAC_PI_2;
        match self.role {
            CrossfadeRole::Outgoing => libm::cos(angle),
            CrossfadeRole::Incoming => libm::sin(angle),
        }
    }
}

/// 一个实例在范围里发声的一整段。
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioSegment {
    pub item_id: Id,
    pub source: VoiceSource,
    pub asset: VersionRef,
    pub track_order: i64,
    /// 在输出里的位置 `[start, end)`，秒，相对范围的起点。
    pub start: f64,
    pub end: f64,
    /// `start` 这一刻取素材的哪一秒，以及之后每过一秒序列时间走多少秒源时间。
    pub source_start: f64,
    pub source_rate: f64,
    /// 实例的增益（不含淡变）。有音量包络时是 0：音量在 `envelope` 里。
    pub gain_db: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fade_in: Option<AudioFade>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fade_out: Option<AudioFade>,
    /// 这一段所在的转场交叉淡化（一个实例可以同时是一个转场的入场和另一个转场的出场）。
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub crossfades: Vec<AudioCrossfade>,
    /// 闪避压低量的折点 `[秒, dB]`（相对范围的起点）：折点之间线性，第一个之前是 0，最后一个之后保持最后的值；同一时刻两个
    /// 折点是台阶（先左侧、再右侧的值）。只给覆盖这一段要用的折点；没有闪避时为空。压低量从增益里减去。
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub ducking: Vec<(f64, f64)>,
    /// 音量包络的折点 `[秒, 线性倍数]`（相对范围的起点）：折点之间线性，第一个之前取它的值，最后一个之后取最后的值
    /// （[`envelope_at`]）。只给覆盖这一段要用的折点；没有包络时为空。包络取代实例的音量，乘在增益上。
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub envelope: Vec<(f64, f64)>,
    /// 交叉淡化时在实例自己的区间之外取 handles 的一段：不套实例的淡入淡出。
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub handle: bool,
}

impl AudioSegment {
    /// `t`（秒，相对范围的起点）这一刻的增益：实例的增益、音量包络、淡入淡出、交叉淡化与闪避都算进去。和逐帧计划的
    /// `AudioVoice.gain_db` 同一个量（测试按它核对两份计划），振幅同样不低于 -100 dB。
    pub fn gain_db_at(&self, t: f64) -> f64 {
        let mut fade: f64 = 1.0;
        if let Some(f) = self.fade_in {
            fade = fade.min(((t - f.start) / (f.end - f.start)).max(0.0));
        }
        if let Some(f) = self.fade_out {
            fade = fade.min(((f.end - t) / (f.end - f.start)).max(0.0));
        }
        let fade_db = if fade >= 1.0 { 0.0 } else { 20.0 * fade.max(1e-5).log10() };
        let crossfade: f64 = self.crossfades.iter().map(|c| 20.0 * libm::log10(c.amplitude(t).max(1e-5))).sum();
        let envelope = if self.envelope.is_empty() {
            0.0
        } else {
            volume_db(envelope_at(&self.envelope, t))
        };
        self.gain_db + envelope + fade_db + crossfade - knots_at(&self.ducking, t)
    }
}

/// 音量包络的折点在 `t` 的值（见 [`AudioSegment::envelope`]）：与 `timeline::duck::GainEnvelope::at` 同一口径。
/// 没有折点时是 1。
pub fn envelope_at(knots: &[(f64, f64)], t: f64) -> f64 {
    let Some(&(t0, first)) = knots.first() else {
        return 1.0;
    };
    if t <= t0 {
        return first;
    }
    // 第一个时刻大于 t 的折点。
    let i = knots.partition_point(|&(at, _)| at <= t);
    let Some(&(t1, g1)) = knots.get(i) else {
        return knots[knots.len() - 1].1;
    };
    let (t0, g0) = knots[i - 1];
    if t1 - t0 <= 0.0 {
        return g1;
    }
    g0 + (g1 - g0) * ((t - t0) / (t1 - t0))
}

/// 折点之间线性插值（见 [`AudioSegment::ducking`]）。
pub fn knots_at(knots: &[(f64, f64)], t: f64) -> f64 {
    let Some(i) = knots.iter().rposition(|&(at, _)| at <= t) else {
        return 0.0;
    };
    match knots.get(i + 1) {
        Some(&(t1, v1)) if t1 > knots[i].0 => {
            let (t0, v0) = knots[i];
            v0 + (v1 - v0) * (t - t0) / (t1 - t0)
        }
        _ => knots[i].1,
    }
}

/// 计划没有照做的东西：定格、没有音频流的素材、按文稿触发的闪避、不够的 handles。
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioPlanNote {
    pub code: String,
    pub item_id: Id,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioPlan {
    pub sequence_id: Id,
    pub sequence_revision: Revision,
    pub range: PlanRange,
    /// 按轨道 `order`、再按实例 ID 排（与逐帧计划的 `voices` 同序）。
    pub segments: Vec<AudioSegment>,
    pub notes: Vec<AudioPlanNote>,
}

/// 序列的精确长度：固定长度按帧；派生长度取所有实例的尾端，音频实例按采样级的尾端（格式规范 §2.10，纯音频导出不继承
/// 视觉尾端的补帧）。
pub fn sequence_end(sequence: &Sequence) -> Result<Ratio, PlanError> {
    let fps = checked_fps(sequence)?;
    if let DurationPolicy::Fixed { frames } = sequence.header.duration_policy {
        return frame_time(frames as i128, fps).ok_or_else(|| PlanError::overflow("durationPolicy.frames"));
    }
    let mut end = Ratio::ZERO;
    for item in &sequence.items {
        let item_end = match item {
            TimelineItem::Audio(audio) => audio_bounds(audio, fps)?.1,
            other => span_bounds(other.span().expect("音频之外的实例都在帧网格上"), fps)?.1,
        };
        end = end.max(item_end);
    }
    Ok(end)
}

/// 导出范围：不给时是整条序列。范围的终点超过序列长度时截到序列长度；截完是空的就报 `EXPORT_RANGE_EMPTY`。
pub fn resolve_range(sequence: &Sequence, range: Option<(Ratio, Ratio)>) -> Result<(Ratio, Ratio), PlanError> {
    let end_of_sequence = sequence_end(sequence)?;
    let (start, end) = range.unwrap_or((Ratio::ZERO, end_of_sequence));
    if start.is_negative() || end <= start {
        return Err(PlanError::new(
            "EXPORT_RANGE_EMPTY",
            "导出范围是空的：终点必须大于起点，起点不能为负",
        ));
    }
    let end = end.min(end_of_sequence);
    if end <= start {
        return Err(PlanError::new("EXPORT_RANGE_EMPTY", "导出范围在序列之外，或者序列是空的"));
    }
    Ok((start, end))
}

/// 一个发声的实例：它在序列上响的区间、取源的映射、增益与淡变。
struct Voice<'a> {
    item_id: &'a Id,
    source: VoiceSource,
    asset: &'a VersionRef,
    bounds: (Ratio, Ratio),
    time_map: &'a TimeMap,
    volume: f64,
    envelope: &'a [EnvelopePoint],
    fade_in: Option<&'a MediaTime>,
    fade_out: Option<&'a MediaTime>,
}

/// 有效词流（视频格式规范 §5.7）在序列上的区间（秒，从序列开头算）：每份转写文档（`baocut.speech/1`）按
/// [`plan_text`] 投到序列上的词，剪掉的、定格的、不在时间线上的都不在里面。投不上序列的文档跳过。按文稿触发的闪避
/// 以它为触发区间（§3.9）。
///
/// 在源素材时钟上的转写经播放它的素材的实例投影（按起点、再按 ID 排），不经字幕实例：字幕只显示一段时，
/// 其余部分的说话照样触发闪避。
pub fn speech_activity(
    video: VideoView<'_>,
    sequence_id: &str,
    documents: &[(&DocumentRecord, &Value)],
) -> Result<Vec<(f64, f64)>, PlanError> {
    let mut intervals = Vec::new();
    for_each_spoken_word(video, sequence_id, documents, |_, start, end| intervals.push((start, end)))?;
    intervals.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.total_cmp(&b.1)));
    Ok(intervals)
}

/// 每位说话人在序列上说话的区间（秒，从序列开头算）：有效词流（同 [`speech_activity`]）里写了 `speaker` 的词按说话人
/// 分开，各自按开始时刻排。没有说话人的词不算。声波的 `speaker`（视频格式规范 §3.7）以它为准，预览与导出用同一份。
pub fn speaker_activity(
    video: VideoView<'_>,
    sequence_id: &str,
    documents: &[(&DocumentRecord, &Value)],
) -> Result<BTreeMap<String, Vec<(f64, f64)>>, PlanError> {
    let mut speakers: BTreeMap<String, Vec<(f64, f64)>> = BTreeMap::new();
    for_each_spoken_word(video, sequence_id, documents, |speaker, start, end| {
        if let Some(speaker) = speaker {
            speakers.entry(speaker.to_owned()).or_default().push((start, end));
        }
    })?;
    for intervals in speakers.values_mut() {
        intervals.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.total_cmp(&b.1)));
    }
    Ok(speakers)
}

/// 有效词流里的每个词：说话人与它在序列上的区间（`end > start` 的才给）。
fn for_each_spoken_word(
    video: VideoView<'_>,
    sequence_id: &str,
    documents: &[(&DocumentRecord, &Value)],
    mut visit: impl FnMut(Option<&str>, f64, f64),
) -> Result<(), PlanError> {
    let sequence = video
        .sequences
        .get(sequence_id)
        .ok_or_else(|| PlanError::new("SEQUENCE_NOT_FOUND", format!("没有序列 {sequence_id}")))?;
    let fps = checked_fps(sequence)?;
    for (document, body) in documents {
        if body.get("schema").and_then(Value::as_str) != Some("baocut.speech/1") {
            continue;
        }
        let mut scope: Vec<(Ratio, &Id)> = Vec::new();
        if body.get("clock").and_then(Value::as_str) != Some("sequence") {
            let Some(asset_id) = &document.source_asset_id else {
                continue;
            };
            for item in &sequence.items {
                let start = match item {
                    TimelineItem::Video(v) if &v.asset_ref.id == asset_id => span_bounds(v.span, fps)?.0,
                    TimelineItem::Audio(a) if &a.asset_ref.id == asset_id => audio_bounds(a, fps)?.0,
                    _ => continue,
                };
                scope.push((start, &item.base().id));
            }
            if scope.is_empty() {
                continue;
            }
            scope.sort();
        }
        let scope: Vec<Id> = scope.into_iter().map(|(_, id)| id.clone()).collect();
        let plan = match plan_text(video, sequence_id, document, body, &scope, None) {
            Ok(plan) => plan,
            Err(error) if error.code == "EXPORT_SOURCE_UNPLACED" || error.code == "EXPORT_RANGE_EMPTY" => continue,
            Err(error) => return Err(error),
        };
        for entry in plan.entries.iter().filter(|e| e.end > e.start) {
            visit(entry.speaker.as_deref(), entry.start, entry.end);
        }
    }
    Ok(())
}

/// 序列 `sequence_id` 在 `range`（序列时间）里的声音，按文稿触发的闪避当作没有词流（见 [`plan_audio_with_speech`]）。
pub fn plan_audio(video: VideoView<'_>, sequence_id: &str, range: Option<(Ratio, Ratio)>) -> Result<AudioPlan, PlanError> {
    plan_audio_with_speech(video, sequence_id, range, &[])
}

/// 序列 `sequence_id` 在 `range`（序列时间）里的声音。`speech` 是 [`speech_activity`] 求出的有效词流区间。
pub fn plan_audio_with_speech(
    video: VideoView<'_>,
    sequence_id: &str,
    range: Option<(Ratio, Ratio)>,
    speech: &[(f64, f64)],
) -> Result<AudioPlan, PlanError> {
    let sequence = video
        .sequences
        .get(sequence_id)
        .ok_or_else(|| PlanError::new("SEQUENCE_NOT_FOUND", format!("没有序列 {sequence_id}")))?;
    let fps = checked_fps(sequence)?;
    let (range_start, range_end) = resolve_range(sequence, range)?;
    let rules = TrackRules::new(&sequence.tracks);
    let tracks: HashMap<&str, &Track> = sequence.tracks.iter().map(|t| (t.id.as_str(), t)).collect();
    let items: HashMap<&str, &TimelineItem> = sequence.items.iter().map(|item| (item.base().id.as_str(), item)).collect();

    let mut segments: Vec<AudioSegment> = Vec::new();
    let mut notes: Vec<AudioPlanNote> = Vec::new();
    // 按文稿触发的闪避：词流为空时不压低，报 `DUCK_NO_SPEECH`。
    let speech_rules: Vec<_> = sequence
        .ducking
        .iter()
        .filter(|r| r.enabled && r.depth.is_finite() && r.depth > 0.0 && r.trigger.group().is_none())
        .collect();
    for item in &sequence.items {
        let base = item.base();
        let Some(track) = tracks.get(base.track_id.as_str()) else {
            continue;
        };
        if !base.enabled || !rules.audible(track) {
            continue;
        }
        let voice = match item {
            TimelineItem::Video(v) if v.embedded_audio.enabled => Voice {
                item_id: &v.base.id,
                source: VoiceSource::Embedded,
                asset: &v.asset_ref,
                bounds: span_bounds(v.span, fps)?,
                time_map: &v.time_map,
                volume: v.embedded_audio.volume,
                envelope: &v.embedded_audio.envelope,
                fade_in: v.embedded_audio.fade_in.as_ref(),
                fade_out: v.embedded_audio.fade_out.as_ref(),
            },
            TimelineItem::Audio(a) if !a.mix.muted => Voice {
                item_id: &a.base.id,
                source: VoiceSource::Audio,
                asset: &a.asset_ref,
                bounds: audio_bounds(a, fps)?,
                time_map: &a.time_map,
                volume: a.mix.volume,
                envelope: &a.mix.envelope,
                fade_in: a.mix.fade_in.as_ref(),
                fade_out: a.mix.fade_out.as_ref(),
            },
            TimelineItem::Composition(c) => {
                let (Some(prerender), Some(audio)) = (&c.prerender, c.audio.as_ref().filter(|a| a.enabled)) else {
                    continue;
                };
                Voice {
                    item_id: &c.base.id,
                    source: VoiceSource::Embedded,
                    asset: prerender,
                    bounds: span_bounds(c.span, fps)?,
                    time_map: &c.time_map,
                    volume: audio.volume,
                    envelope: &audio.envelope,
                    fade_in: audio.fade_in.as_ref(),
                    fade_out: audio.fade_out.as_ref(),
                }
            }
            _ => continue,
        };
        let (start, end) = voice.bounds;
        let clipped = (start.max(range_start), end.min(range_end));
        if clipped.1 <= clipped.0 {
            continue;
        }
        if speech.is_empty() && speech_rules.iter().any(|r| r.target.contains(&base.id, &base.track_id)) {
            notes.push(note("DUCK_NO_SPEECH", voice.item_id));
        }
        if matches!(voice.time_map, TimeMap::Hold { .. }) {
            notes.push(note("HOLD_IS_SILENT", voice.item_id));
            continue;
        }
        if !has_audio(&video, voice.asset) {
            notes.push(note("ASSET_HAS_NO_AUDIO", voice.item_id));
            continue;
        }
        let relative =
            |t: Ratio| -> Result<f64, PlanError> { Ok(t.checked_sub(range_start).ok_or_else(|| PlanError::overflow("t"))?.to_f64()) };
        let length = |fade: Option<&MediaTime>, field: &str| -> Result<Option<Ratio>, PlanError> {
            Ok(fade.map(|f| f.to_ratio(field)).transpose()?.filter(|l| *l > Ratio::ZERO))
        };
        let fade_in = match length(voice.fade_in, "fadeIn")? {
            Some(l) => Some(AudioFade {
                start: relative(start)?,
                end: relative(start.checked_add(l).ok_or_else(|| PlanError::overflow("fadeIn"))?)?,
            }),
            None => None,
        };
        let fade_out = match length(voice.fade_out, "fadeOut")? {
            Some(l) => Some(AudioFade {
                start: relative(end.checked_sub(l).ok_or_else(|| PlanError::overflow("fadeOut"))?)?,
                end: relative(end)?,
            }),
            None => None,
        };
        let (gain_db, envelope) = volume_plan(voice.volume, voice.envelope, (start, end), range_start, clipped)?;
        segments.push(AudioSegment {
            item_id: voice.item_id.clone(),
            source: voice.source,
            asset: voice.asset.clone(),
            track_order: track.order,
            start: relative(clipped.0)?,
            end: relative(clipped.1)?,
            source_start: map_time(voice.time_map, start, clipped.0)?.to_f64(),
            source_rate: source_rate(voice.time_map)?,
            gain_db,
            fade_in,
            fade_out,
            crossfades: Vec::new(),
            envelope,
            ducking: ducking_knots(sequence, item, fps, speech, range_start, clipped)?,
            handle: false,
        });
    }
    let context = Context {
        video: &video,
        sequence,
        items: &items,
        tracks: &tracks,
        rules: &rules,
        fps,
        speech,
        range: (range_start, range_end),
    };
    context.crossfade_segments(&mut segments, &mut notes)?;
    segments.sort_by(|a, b| a.track_order.cmp(&b.track_order).then_with(|| a.item_id.cmp(&b.item_id)));
    Ok(AudioPlan {
        sequence_id: sequence.id.clone(),
        sequence_revision: sequence.revision.clone(),
        range: PlanRange::new(range_start, range_end)?,
        segments,
        notes,
    })
}

fn has_audio(video: &VideoView<'_>, asset: &VersionRef) -> bool {
    video
        .assets
        .get(&asset.id)
        .and_then(|a| a.revisions.get(&asset.revision))
        .is_some_and(|revision| revision.audio.is_some())
}

/// 实例的音量在 `[start, end)`（序列时间）这一段怎么给：没有包络时是 `volume` 折成的 dB 与空折点；有包络时增益是 0 dB，
/// 折点取包络烘焙出的折线里覆盖这一段要用的那些，换成相对范围起点的秒。`bounds` 是实例自己的区间（包络的局部时钟与
/// 百分比按它算）。
fn volume_plan(
    volume: f64,
    points: &[EnvelopePoint],
    bounds: (Ratio, Ratio),
    range_start: Ratio,
    (start, end): (Ratio, Ratio),
) -> Result<(f64, Vec<(f64, f64)>), PlanError> {
    let since = |t: Ratio| -> Result<f64, PlanError> { Ok(t.checked_sub(range_start).ok_or_else(|| PlanError::overflow("t"))?.to_f64()) };
    let duration = bounds
        .1
        .checked_sub(bounds.0)
        .ok_or_else(|| PlanError::overflow("duration"))?
        .to_f64();
    let curve = match VolumeCurve::new(volume, points, duration) {
        VolumeCurve::Constant(volume) => return Ok((volume_db(volume), Vec::new())),
        VolumeCurve::Envelope(curve) => curve,
    };
    let origin = since(bounds.0)?;
    let knots: Vec<(f64, f64)> = curve.points().iter().map(|&[t, g]| (origin + t, g)).collect();
    let (start, end) = (since(start)?, since(end)?);
    // 从 `start` 之前（含）最后一个折点到 `end` 之后（含）第一个折点；两端外延，段落在折线之外时只留一个折点。
    let first = knots.iter().rposition(|&(t, _)| t <= start).unwrap_or(0);
    let last = knots.iter().position(|&(t, _)| t >= end).unwrap_or(knots.len() - 1);
    Ok((0.0, knots[first..=last.max(first)].to_vec()))
}

/// 实例在 `[start, end)`（序列时间）里受到的闪避：只留覆盖这一段要用的折点，换成相对范围起点的秒。
fn ducking_knots(
    sequence: &Sequence,
    item: &TimelineItem,
    fps: Rate,
    speech: &[(f64, f64)],
    range_start: Ratio,
    (start, end): (Ratio, Ratio),
) -> Result<Vec<(f64, f64)>, PlanError> {
    if sequence.ducking.is_empty() {
        return Ok(Vec::new());
    }
    let knots = DuckingEnvelope::for_item_with_speech(sequence, item, fps, Some(speech))?.knots();
    if knots.is_empty() {
        return Ok(Vec::new());
    }
    let (start, end, origin) = (start.to_f64(), end.to_f64(), range_start.to_f64());
    // 从 `start` 之前（含）最后一个折点到 `end` 之后（含）第一个折点；段落在包络之外时没有压低。
    let first = knots.iter().rposition(|&(t, _)| t <= start).unwrap_or(0);
    let last = knots.iter().position(|&(t, _)| t >= end).unwrap_or(knots.len() - 1);
    let slice = &knots[first..=last.max(first)];
    if slice.iter().all(|&(_, db)| db == 0.0) {
        return Ok(Vec::new());
    }
    Ok(slice.iter().map(|&(t, db)| (t - origin, db)).collect())
}

/// 求交叉淡化的段时要用到的序列上下文。
struct Context<'a, 'v> {
    video: &'a VideoView<'v>,
    sequence: &'a Sequence,
    items: &'a HashMap<&'a str, &'a TimelineItem>,
    tracks: &'a HashMap<&'a str, &'a Track>,
    rules: &'a TrackRules,
    fps: Rate,
    speech: &'a [(f64, f64)],
    range: (Ratio, Ratio),
}

impl Context<'_, '_> {
    fn relative(&self, t: Ratio) -> Result<f64, PlanError> {
        Ok(t.checked_sub(self.range.0).ok_or_else(|| PlanError::overflow("t"))?.to_f64())
    }

    /// 带 `audioCrossfade` 的两侧转场（逐帧计划的 `crossfade_voices`）：两侧自己的段带上曲线；窗口里在实例区间之外的部分
    /// 另起一段，按实例的时间映射取 handles。两侧都启用、轨道发声才淡化；某一侧关掉了自带声音时那一侧没有声音。
    fn crossfade_segments(&self, segments: &mut Vec<AudioSegment>, notes: &mut Vec<AudioPlanNote>) -> Result<(), PlanError> {
        for tr in self.sequence.transitions.iter().filter(|tr| tr.audio_crossfade) {
            let Some((Some(TimelineItem::Video(left)), Some(TimelineItem::Video(right)), start, end)) = transition_window(self.items, tr)
            else {
                continue;
            };
            if !left.base.enabled || !right.base.enabled {
                continue;
            }
            let Some(track) = self.tracks.get(left.base.track_id.as_str()) else {
                continue;
            };
            if !self.rules.audible(track) {
                continue;
            }
            let frame = |n: i64| frame_time(n as i128, self.fps).ok_or_else(|| PlanError::overflow("transition"));
            let (from, to, cut) = (frame(start)?, frame(end)?, frame(left.span.end_frame())?);
            for (side, role) in [(left, CrossfadeRole::Outgoing), (right, CrossfadeRole::Incoming)] {
                let curve = AudioCrossfade {
                    transition_id: tr.id.clone(),
                    role,
                    start: self.relative(from)?,
                    end: self.relative(to)?,
                };
                if let Some(own) = segments
                    .iter_mut()
                    .find(|s| !s.handle && s.item_id == side.base.id && s.source == VoiceSource::Embedded)
                {
                    own.crossfades.push(curve.clone());
                }
                if !side.embedded_audio.enabled || matches!(side.time_map, TimeMap::Hold { .. }) || !has_audio(self.video, &side.asset_ref)
                {
                    continue;
                }
                // 窗口里不在实例自己区间的部分：出场的一侧在剪切点之后，入场的一侧在剪切点之前。
                let (lo, hi) = match role {
                    CrossfadeRole::Outgoing => (cut.max(from), to),
                    CrossfadeRole::Incoming => (from, cut.min(to)),
                };
                let (lo, hi) = (lo.max(self.range.0), hi.min(self.range.1));
                if hi <= lo {
                    continue;
                }
                if let Some(segment) = self.handle(side, track.order, curve, (lo, hi), notes)? {
                    segments.push(segment);
                }
            }
        }
        Ok(())
    }

    /// 一侧在自己区间之外的 handles：素材开头之前与结尾之后没有声音（段从源的 0 秒开始；结尾之后由后端补静音），报出来。
    fn handle(
        &self,
        side: &video_model::VideoItem,
        track_order: i64,
        curve: AudioCrossfade,
        (lo, hi): (Ratio, Ratio),
        notes: &mut Vec<AudioPlanNote>,
    ) -> Result<Option<AudioSegment>, PlanError> {
        let item_start = frame_start(side.span, self.fps)?;
        let rate = source_rate(&side.time_map)?;
        let (mut start, end) = (self.relative(lo)?, self.relative(hi)?);
        let mut source_start = map_time(&side.time_map, item_start, lo)?.to_f64();
        let mut short = false;
        if source_start < 0.0 {
            short = true;
            if rate <= 0.0 {
                notes.push(note("CROSSFADE_HANDLE_SHORT", &side.base.id));
                return Ok(None);
            }
            start -= source_start / rate;
            source_start = 0.0;
        }
        let duration = self
            .video
            .assets
            .get(&side.asset_ref.id)
            .and_then(|a| a.revisions.get(&side.asset_ref.revision))
            .and_then(|r| r.duration.as_ref())
            .map(|d| d.to_ratio("duration"))
            .transpose()?
            .map(Ratio::to_f64);
        if duration.is_some_and(|d| source_start + (end - start) * rate > d + 1e-9) {
            short = true;
        }
        if short {
            notes.push(note("CROSSFADE_HANDLE_SHORT", &side.base.id));
        }
        if end <= start {
            return Ok(None);
        }
        let item = self.items[side.base.id.as_str()];
        let audio = &side.embedded_audio;
        let (gain_db, envelope) = volume_plan(
            audio.volume,
            &audio.envelope,
            span_bounds(side.span, self.fps)?,
            self.range.0,
            (lo, hi),
        )?;
        Ok(Some(AudioSegment {
            item_id: side.base.id.clone(),
            source: VoiceSource::Embedded,
            asset: side.asset_ref.clone(),
            track_order,
            start,
            end,
            source_start,
            source_rate: rate,
            gain_db,
            fade_in: None,
            fade_out: None,
            crossfades: vec![curve],
            envelope,
            ducking: ducking_knots(self.sequence, item, self.fps, self.speech, self.range.0, (lo, hi))?,
            handle: true,
        }))
    }
}

fn note(code: &str, item_id: &Id) -> AudioPlanNote {
    AudioPlanNote {
        code: code.into(),
        item_id: item_id.clone(),
    }
}
