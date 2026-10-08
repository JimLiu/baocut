use std::collections::BTreeMap;

use crate::cuts::{CutSet, SeamBias};
use crate::schema::{Clip, TimelineDocument, TimelineError};

const EPSILON: f64 = 1e-9;

/// 已投影的 clip 分段。
///
/// **serde 形态是对外线格式**（camelCase）：`apps/cli` 的
/// `studio_timeline_projection` 把同一张表发给 studio，studio 再原样回喂给
/// `bcut-wasm` 的 `loadTimeline` 信封（设计 §13 P6b「投影补接」）。字段名一旦
/// 改动，那条回路会在 `deny_unknown_fields` 上当场红。
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClipSegment {
    pub source_start: f64,
    pub source_end: f64,
    pub timeline_start: f64,
    pub timeline_end: f64,
}

/// 已投影的一个 clip。serde 形态同 [`ClipSegment`]。
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClipProjection {
    pub id: String,
    pub src_id: String,
    pub source_in: f64,
    pub source_out: f64,
    pub rate: f64,
    pub view_in: f64,
    pub view_out: f64,
    pub timeline_start: f64,
    pub timeline_end: f64,
    pub segments: Vec<ClipSegment>,
}

/// One source-clock sample resolved inside its arranged clip. `seek_source`
/// opens the following kept segment after a cut; `clip_ended` asks the host to
/// advance to the next arranged clip.
#[derive(Debug, Clone, PartialEq)]
pub struct PlaybackStep {
    pub timeline_time: f64,
    pub seek_source: Option<f64>,
    pub src_id: String,
    pub clip_id: String,
    pub clip_ended: bool,
}

/// First playable source frame of an arranged clip.
#[derive(Debug, Clone, PartialEq)]
pub struct SourcePosition {
    pub src_id: String,
    pub source_time: f64,
    pub clip_id: String,
}

/// One OUTPUT instant resolved inside its arranged clip. Borrowed from the
/// projection because the playback loop only needs the ids to drive
/// [`TimelineProjection::playback_step`].
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TimelinePosition<'a> {
    pub clip_id: &'a str,
    pub src_id: &'a str,
    /// Source-clock instant played at `timeline_time`.
    pub source_time: f64,
    pub rate: f64,
    /// The requested OUTPUT instant, clamped to `[0, duration]`.
    pub timeline_time: f64,
}

impl ClipProjection {
    pub fn duration(&self) -> f64 {
        self.timeline_end - self.timeline_start
    }

    pub fn contains_source_time(&self, source_time: f64) -> bool {
        let index = self
            .segments
            .partition_point(|segment| segment.source_end <= source_time);
        self.segments.get(index).is_some_and(|segment| {
            source_time >= segment.source_start && source_time < segment.source_end
        }) || self
            .segments
            .last()
            .is_some_and(|segment| source_time == segment.source_end)
    }

    pub fn source_to_timeline(&self, source_time: f64) -> Option<f64> {
        let index = self
            .segments
            .partition_point(|segment| segment.source_end <= source_time);
        if let Some(segment) = self.segments.get(index)
            && source_time >= segment.source_start
            && source_time < segment.source_end
        {
            return Some(segment.timeline_start + (source_time - segment.source_start) / self.rate);
        }
        self.segments
            .last()
            .filter(|segment| source_time == segment.source_end)
            .map(|segment| segment.timeline_end)
    }
}

/// 输出时刻 → `(源 id, 源媒体时刻)`，**只要一张已投影的 clip 表**。
///
/// [`TimelineProjection::timeline_to_source`] 就是它的一层包装，两者因此不可能
/// 分叉。单独暴露是给**手里只有 clip 表、没有 `CutSet` 的 host** 用的：浏览器
/// 预览（`bcut-wasm`）的投影是 studio 把服务端算好的那张表原样喂回来的，重建
/// 一份 `CutSet` 既没有输入（源时长是 host 探测的）也没有意义（折算本身一个
/// cut 都不读）。
///
/// `duration` 必须是 clip 表最后一段的 `timeline_end`——`TimelineProjection`
/// 里那一份就是这么来的（`build` 的 `timeline_cursor`）。
pub fn clips_timeline_to_source(
    clips: &[ClipProjection],
    duration: f64,
    timeline_time: f64,
    bias: SeamBias,
) -> Option<(&str, f64)> {
    clips_timeline_to_position(clips, duration, timeline_time, bias)
        .map(|position| (position.src_id, position.source_time))
}

/// [`clips_timeline_to_source`] 的完整形态：连**哪条 clip 在播**一并给出。
///
/// 折算本身与 `clips_timeline_to_source` 是同一份代码（后者就是这里的一层
/// 投影），所以两者不可能分叉。单独存在是因为 host 的播放循环需要 clip 身份：
/// [`TimelineProjection::playback_step`] 的入参就是 clip id，没有它宿主只能在
/// 自己那侧再写一遍缝判定。Swift（`TimelineMapProjection.timelineToSource`）与
/// JS（`skills/baocut/templates/studio/timeline-mapping.js`）两个孪生实现一直
/// 返回 `clipId`，这里是把 Rust 这一份补齐到同一形状。
pub fn clips_timeline_to_position(
    clips: &[ClipProjection],
    duration: f64,
    timeline_time: f64,
    bias: SeamBias,
) -> Option<TimelinePosition<'_>> {
    if !timeline_time.is_finite() || clips.is_empty() {
        return None;
    }
    let timeline_time = timeline_time.clamp(0.0, duration);
    let clip_index = clips.partition_point(|clip| {
        clip.timeline_end < timeline_time
            || (bias == SeamBias::Following && clip.timeline_end == timeline_time)
    });
    let clip = clips.get(clip_index).or_else(|| clips.last())?;
    let segment_index = clip.segments.partition_point(|segment| {
        segment.timeline_end < timeline_time
            || (bias == SeamBias::Following && segment.timeline_end == timeline_time)
    });
    let segment = clip
        .segments
        .get(segment_index)
        .or_else(|| clip.segments.last())?;
    let source_time = if timeline_time <= segment.timeline_start {
        segment.source_start
    } else if timeline_time >= segment.timeline_end {
        segment.source_end
    } else {
        segment.source_start + (timeline_time - segment.timeline_start) * clip.rate
    };
    Some(TimelinePosition {
        clip_id: &clip.id,
        src_id: &clip.src_id,
        source_time,
        rate: clip.rate,
        timeline_time,
    })
}

#[derive(Debug, Clone, PartialEq)]
pub struct TimelineProjection {
    sources: BTreeMap<String, CutSet>,
    clips: Vec<ClipProjection>,
    duration: f64,
}

impl TimelineProjection {
    /// `source_durations` is host-probed metadata. The main duration always comes from
    /// project media metadata and therefore must be supplied here, never in timeline.json.
    pub fn build(
        document: &TimelineDocument,
        source_durations: &BTreeMap<String, f64>,
    ) -> Result<Self, TimelineError> {
        document.validate()?;

        let mut sources = BTreeMap::new();
        let mut source_ids = source_durations.keys().cloned().collect::<Vec<_>>();
        source_ids.extend(document.sources.keys().cloned());
        source_ids.sort();
        source_ids.dedup();
        for source_id in source_ids {
            let source = document.sources.get(&source_id);
            let duration = source_durations
                .get(&source_id)
                .copied()
                .or_else(|| source.and_then(|value| value.duration))
                .ok_or_else(|| TimelineError::MissingSource(source_id.clone()))?;
            let cuts = source.map_or_else(Vec::new, |value| value.cuts.clone());
            sources.insert(source_id, CutSet::new(duration, cuts)?);
        }

        let clips = if document.clips.is_empty() {
            let main = sources
                .get("main")
                .ok_or_else(|| TimelineError::MissingSource("main".to_owned()))?;
            if main.duration() == 0.0 {
                Vec::new()
            } else {
                vec![Clip {
                    id: "c1".to_owned(),
                    src_id: "main".to_owned(),
                    in_time: 0.0,
                    out: main.duration(),
                    rate: 1.0,
                }]
            }
        } else {
            document.clips.clone()
        };

        let mut timeline_cursor = 0.0;
        let mut projections = Vec::with_capacity(clips.len());
        for clip in clips {
            let source = sources
                .get(&clip.src_id)
                .ok_or_else(|| TimelineError::MissingSource(clip.src_id.clone()))?;
            if clip.out > source.duration() + EPSILON {
                return Err(TimelineError::Invalid(format!(
                    "clip {} 超过 source {} 时长",
                    clip.id, clip.src_id
                )));
            }
            let kept = source.kept_intersections(clip.in_time, clip.out, 0.0);
            if kept.is_empty() {
                return Err(TimelineError::EmptyClip(clip.id));
            }
            let view_in = source.view_time_at_seam(clip.in_time);
            let view_out = source.view_time_at_seam(clip.out);
            let mut segment_cursor = timeline_cursor;
            let mut segments = Vec::with_capacity(kept.len());
            for (source_start, source_end) in kept {
                let timeline_end = segment_cursor + (source_end - source_start) / clip.rate;
                segments.push(ClipSegment {
                    source_start,
                    source_end,
                    timeline_start: segment_cursor,
                    timeline_end,
                });
                segment_cursor = timeline_end;
            }
            if segment_cursor - timeline_cursor <= EPSILON {
                return Err(TimelineError::EmptyClip(clip.id));
            }
            projections.push(ClipProjection {
                id: clip.id,
                src_id: clip.src_id,
                source_in: clip.in_time,
                source_out: clip.out,
                rate: clip.rate,
                view_in,
                view_out,
                timeline_start: timeline_cursor,
                timeline_end: segment_cursor,
                segments,
            });
            timeline_cursor = segment_cursor;
        }

        Ok(Self {
            sources,
            clips: projections,
            duration: timeline_cursor,
        })
    }

    pub fn duration(&self) -> f64 {
        self.duration
    }

    pub fn sources(&self) -> &BTreeMap<String, CutSet> {
        &self.sources
    }

    pub fn clips(&self) -> &[ClipProjection] {
        &self.clips
    }

    pub fn source(&self, id: &str) -> Option<&CutSet> {
        self.sources.get(id)
    }

    /// Returns all placements in declaration order. A source interval may be reused.
    pub fn source_to_timeline(&self, src_id: &str, source_time: f64) -> Vec<f64> {
        self.clips
            .iter()
            .filter(|clip| clip.src_id == src_id)
            .filter_map(|clip| clip.source_to_timeline(source_time))
            .collect()
    }

    pub fn timeline_to_source(&self, timeline_time: f64, bias: SeamBias) -> Option<(&str, f64)> {
        clips_timeline_to_source(&self.clips, self.duration, timeline_time, bias)
    }

    /// [`Self::timeline_to_source`] plus the clip identity the playback loop
    /// needs to call [`Self::playback_step`].
    pub fn timeline_to_position(
        &self,
        timeline_time: f64,
        bias: SeamBias,
    ) -> Option<TimelinePosition<'_>> {
        clips_timeline_to_position(&self.clips, self.duration, timeline_time, bias)
    }

    /// Maps a native player's source clock back to OUTPUT time while preserving
    /// clip identity. A sample inside a removed interval seeks to the following
    /// kept segment; passing the final segment marks the clip complete.
    pub fn playback_step(
        &self,
        clip_id: &str,
        source_time: f64,
        tolerance: f64,
    ) -> Option<PlaybackStep> {
        if !source_time.is_finite() {
            return None;
        }
        let clip = self.clips.iter().find(|clip| clip.id == clip_id)?;
        let tolerance = tolerance.max(0.0);
        for (index, segment) in clip.segments.iter().enumerate() {
            if source_time < segment.source_start - tolerance {
                return Some(PlaybackStep {
                    timeline_time: segment.timeline_start,
                    seek_source: Some(segment.source_start),
                    src_id: clip.src_id.clone(),
                    clip_id: clip.id.clone(),
                    clip_ended: false,
                });
            }
            if source_time < segment.source_end - tolerance {
                return Some(PlaybackStep {
                    timeline_time: segment.timeline_start
                        + (source_time.max(segment.source_start) - segment.source_start)
                            / clip.rate,
                    seek_source: None,
                    src_id: clip.src_id.clone(),
                    clip_id: clip.id.clone(),
                    clip_ended: false,
                });
            }
            if let Some(following) = clip.segments.get(index + 1)
                && source_time < following.source_start - tolerance
            {
                return Some(PlaybackStep {
                    timeline_time: following.timeline_start,
                    seek_source: Some(following.source_start),
                    src_id: clip.src_id.clone(),
                    clip_id: clip.id.clone(),
                    clip_ended: false,
                });
            }
        }
        Some(PlaybackStep {
            timeline_time: clip.timeline_end,
            seek_source: None,
            src_id: clip.src_id.clone(),
            clip_id: clip.id.clone(),
            clip_ended: true,
        })
    }

    /// First source frame of the clip arranged immediately after `clip_id`.
    pub fn next_position(&self, clip_id: &str) -> Option<SourcePosition> {
        let index = self.clips.iter().position(|clip| clip.id == clip_id)?;
        let clip = self.clips.get(index + 1)?;
        let segment = clip.segments.first()?;
        Some(SourcePosition {
            src_id: clip.src_id.clone(),
            source_time: segment.source_start,
            clip_id: clip.id.clone(),
        })
    }

    pub fn resolve_unique_source_time(
        &self,
        src_id: &str,
        source_time: f64,
        label: &str,
    ) -> Result<f64, TimelineError> {
        let matches = self.source_to_timeline(src_id, source_time);
        match matches.as_slice() {
            [] => Err(TimelineError::Unmapped(label.to_owned())),
            [time] => Ok(*time),
            _ => Err(TimelineError::Ambiguous(label.to_owned())),
        }
    }
}

pub fn materialize_implicit_clip(
    document: &mut TimelineDocument,
    source_durations: &BTreeMap<String, f64>,
) -> Result<bool, TimelineError> {
    if !document.clips.is_empty() {
        return Ok(false);
    }
    let duration = source_durations
        .get("main")
        .copied()
        .ok_or_else(|| TimelineError::MissingSource("main".to_owned()))?;
    if duration == 0.0 {
        return Ok(false);
    }
    document.clips.push(Clip {
        id: "c1".to_owned(),
        src_id: "main".to_owned(),
        in_time: 0.0,
        out: duration,
        rate: 1.0,
    });
    Ok(true)
}

pub fn add_clip(
    document: &mut TimelineDocument,
    source_durations: &BTreeMap<String, f64>,
    id: String,
    src_id: String,
    view_in: Option<f64>,
    view_out: Option<f64>,
    before: Option<&str>,
    after: Option<&str>,
) -> Result<usize, TimelineError> {
    if before.is_some() && after.is_some() {
        return Err(TimelineError::Invalid(
            "before 与 after 不能同时指定".to_owned(),
        ));
    }
    materialize_implicit_clip(document, source_durations)?;
    let projection = TimelineProjection::build(document, source_durations)?;
    let source = projection
        .source(&src_id)
        .ok_or_else(|| TimelineError::MissingSource(src_id.clone()))?;
    let view_in = view_in.unwrap_or(0.0);
    let view_out = view_out.unwrap_or_else(|| source.view_duration());
    if !view_in.is_finite()
        || !view_out.is_finite()
        || view_in < 0.0
        || view_out > source.view_duration()
        || view_out <= view_in
    {
        return Err(TimelineError::Invalid(format!("clip {id} 的视图区间非法")));
    }
    let in_time = source.source_time(view_in, SeamBias::Following);
    let out = source.source_time(view_out, SeamBias::Preceding);
    let index = if let Some(target) = before {
        document
            .clips
            .iter()
            .position(|clip| clip.id == target)
            .ok_or_else(|| TimelineError::Invalid(format!("clip 不存在：{target}")))?
    } else if let Some(target) = after {
        document
            .clips
            .iter()
            .position(|clip| clip.id == target)
            .map(|index| index + 1)
            .ok_or_else(|| TimelineError::Invalid(format!("clip 不存在：{target}")))?
    } else {
        document.clips.len()
    };
    document.clips.insert(
        index,
        Clip {
            id,
            src_id,
            in_time,
            out,
            rate: 1.0,
        },
    );
    TimelineProjection::build(document, source_durations)?;
    Ok(index)
}

/// Split the main-track clip under `timeline_time`. Only the clock changes here;
/// the caller runs [`crate::follow::follow_clock`] with [`crate::ClockEdit::Split`]
/// in the same edit so every element straddling the seam is split too.
pub fn split_clip(
    document: &mut TimelineDocument,
    source_durations: &BTreeMap<String, f64>,
    timeline_time: f64,
    right_id: String,
) -> Result<(String, String), TimelineError> {
    materialize_implicit_clip(document, source_durations)?;
    let projection = TimelineProjection::build(document, source_durations)?;
    let projected = projection
        .clips()
        .iter()
        .find(|clip| {
            timeline_time > clip.timeline_start + EPSILON
                && timeline_time < clip.timeline_end - EPSILON
        })
        .ok_or_else(|| TimelineError::Invalid("split 点不在 clip 内部".to_owned()))?;
    let index = document
        .clips
        .iter()
        .position(|clip| clip.id == projected.id)
        .expect("projection clip comes from document");
    let (_, left_out) = projection
        .timeline_to_source(timeline_time, SeamBias::Preceding)
        .ok_or_else(|| TimelineError::Invalid("split 点无法映射到 source".to_owned()))?;
    let (_, right_in) = projection
        .timeline_to_source(timeline_time, SeamBias::Following)
        .ok_or_else(|| TimelineError::Invalid("split 点无法映射到 source".to_owned()))?;
    let left_id = document.clips[index].id.clone();
    let mut right = document.clips[index].clone();
    document.clips[index].out = left_out;
    right.id = right_id.clone();
    right.in_time = right_in;
    document.clips.insert(index + 1, right);
    TimelineProjection::build(document, source_durations)?;
    Ok((left_id, right_id))
}

pub fn trim_clip(
    document: &mut TimelineDocument,
    source_durations: &BTreeMap<String, f64>,
    clip_id: &str,
    view_in: Option<f64>,
    view_out: Option<f64>,
) -> Result<(), TimelineError> {
    materialize_implicit_clip(document, source_durations)?;
    let projection = TimelineProjection::build(document, source_durations)?;
    let index = document
        .clips
        .iter()
        .position(|clip| clip.id == clip_id)
        .ok_or_else(|| TimelineError::Invalid(format!("clip 不存在：{clip_id}")))?;
    let source = projection
        .source(&document.clips[index].src_id)
        .expect("validated clip source");
    let in_time = view_in
        .map(|value| source.source_time(value, SeamBias::Following))
        .unwrap_or(document.clips[index].in_time);
    let out = view_out
        .map(|value| source.source_time(value, SeamBias::Preceding))
        .unwrap_or(document.clips[index].out);
    if in_time >= out {
        return Err(TimelineError::Invalid(format!(
            "clip {clip_id} trim 后为空"
        )));
    }
    document.clips[index].in_time = in_time;
    document.clips[index].out = out;
    TimelineProjection::build(document, source_durations)?;
    Ok(())
}

pub fn set_clip_rate(
    document: &mut TimelineDocument,
    source_durations: &BTreeMap<String, f64>,
    clip_id: &str,
    rate: f64,
) -> Result<(), TimelineError> {
    if !rate.is_finite() || rate <= 0.0 {
        return Err(TimelineError::Invalid(
            "clip rate 必须是有限正数".to_owned(),
        ));
    }
    materialize_implicit_clip(document, source_durations)?;
    let clip = document
        .clips
        .iter_mut()
        .find(|clip| clip.id == clip_id)
        .ok_or_else(|| TimelineError::Invalid(format!("clip 不存在：{clip_id}")))?;
    clip.rate = rate;
    TimelineProjection::build(document, source_durations)?;
    Ok(())
}

pub fn move_clip(
    document: &mut TimelineDocument,
    clip_id: &str,
    before: Option<&str>,
    after: Option<&str>,
    to: Option<usize>,
) -> Result<usize, TimelineError> {
    let selector_count =
        usize::from(before.is_some()) + usize::from(after.is_some()) + usize::from(to.is_some());
    if selector_count != 1 {
        return Err(TimelineError::Invalid(
            "move 须且只能指定 before、after 或 to".to_owned(),
        ));
    }
    let from = document
        .clips
        .iter()
        .position(|clip| clip.id == clip_id)
        .ok_or_else(|| TimelineError::Invalid(format!("clip 不存在：{clip_id}")))?;
    let clip = document.clips.remove(from);
    let insertion = if let Some(target) = before {
        document
            .clips
            .iter()
            .position(|clip| clip.id == target)
            .ok_or_else(|| TimelineError::Invalid(format!("clip 不存在：{target}")))?
    } else if let Some(target) = after {
        document
            .clips
            .iter()
            .position(|clip| clip.id == target)
            .map(|index| index + 1)
            .ok_or_else(|| TimelineError::Invalid(format!("clip 不存在：{target}")))?
    } else {
        to.expect("selector count checked")
            .min(document.clips.len())
    };
    document.clips.insert(insertion, clip);
    Ok(insertion)
}

pub fn remove_clips(
    document: &mut TimelineDocument,
    source_durations: &BTreeMap<String, f64>,
    clip_ids: &[String],
) -> Result<Vec<String>, TimelineError> {
    if document.clips.is_empty() {
        return Err(TimelineError::Invalid(
            "隐式主 clip 不能直接删除；先执行 clip split/add 物化时间轴".to_owned(),
        ));
    }
    for clip_id in clip_ids {
        if !document.clips.iter().any(|clip| &clip.id == clip_id) {
            return Err(TimelineError::Invalid(format!("clip 不存在：{clip_id}")));
        }
    }
    let retained = document
        .clips
        .iter()
        .filter(|clip| !clip_ids.contains(&clip.id))
        .count();
    if retained == 0 {
        return Err(TimelineError::Invalid(
            "不能删除最后一个 clip（空 clips 表示隐式主 clip）".to_owned(),
        ));
    }
    let removed = document
        .clips
        .iter()
        .filter(|clip| clip_ids.contains(&clip.id))
        .map(|clip| clip.id.clone())
        .collect::<Vec<_>>();
    document.clips.retain(|clip| !clip_ids.contains(&clip.id));
    TimelineProjection::build(document, source_durations)?;
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::{Cut, Source};

    fn document() -> TimelineDocument {
        TimelineDocument {
            sources: BTreeMap::from([
                (
                    "main".to_owned(),
                    Source {
                        cuts: vec![Cut {
                            id: "cut-1".to_owned(),
                            t0: 4.0,
                            t1: 6.0,
                            r#ref: None,
                        }],
                        ..Source::default()
                    },
                ),
                (
                    "src-a".to_owned(),
                    Source {
                        duration: Some(8.0),
                        ..Source::default()
                    },
                ),
            ]),
            clips: vec![
                Clip {
                    id: "c1".to_owned(),
                    src_id: "main".to_owned(),
                    in_time: 2.0,
                    out: 8.0,
                    rate: 1.0,
                },
                Clip {
                    id: "c2".to_owned(),
                    src_id: "src-a".to_owned(),
                    in_time: 1.0,
                    out: 5.0,
                    rate: 2.0,
                },
                Clip {
                    id: "c3".to_owned(),
                    src_id: "main".to_owned(),
                    in_time: 6.0,
                    out: 8.0,
                    rate: 1.0,
                },
            ],
            ..TimelineDocument::default()
        }
    }

    #[test]
    fn clips_derive_prefix_positions_from_cut_collapsed_windows() {
        let projection =
            TimelineProjection::build(&document(), &BTreeMap::from([("main".to_owned(), 10.0)]))
                .unwrap();
        assert_eq!(projection.duration(), 8.0);
        assert_eq!(
            projection
                .clips()
                .iter()
                .map(|clip| (clip.timeline_start, clip.timeline_end))
                .collect::<Vec<_>>(),
            vec![(0.0, 4.0), (4.0, 6.0), (6.0, 8.0)]
        );
        assert_eq!(projection.source_to_timeline("main", 7.0), vec![3.0, 7.0]);
        assert!(matches!(
            projection.resolve_unique_source_time("main", 7.0, "word-1"),
            Err(TimelineError::Ambiguous(_))
        ));
        assert_eq!(
            projection.timeline_to_source(4.0, SeamBias::Preceding),
            Some(("main", 8.0))
        );
        assert_eq!(
            projection.timeline_to_source(4.0, SeamBias::Following),
            Some(("src-a", 1.0))
        );
    }

    /// `timeline_to_position` 只是 `timeline_to_source` 多带 clip 身份的形态：
    /// 同一输入必须逐位同结果，clip 归属按同一条缝规则（`Preceding` 归前段、
    /// `Following` 归后段）。
    #[test]
    fn timeline_to_position_agrees_with_timeline_to_source_and_names_the_clip() {
        let projection =
            TimelineProjection::build(&document(), &BTreeMap::from([("main".to_owned(), 10.0)]))
                .unwrap();

        for time in [0.0, 1.0, 3.999, 4.0, 5.0, 6.0, 7.5, 8.0, 99.0] {
            for bias in [SeamBias::Preceding, SeamBias::Following] {
                let position = projection.timeline_to_position(time, bias);
                assert_eq!(
                    position.map(|position| (position.src_id, position.source_time)),
                    projection.timeline_to_source(time, bias),
                    "t={time} bias={bias:?}"
                );
            }
        }

        let before = projection
            .timeline_to_position(4.0, SeamBias::Preceding)
            .unwrap();
        assert_eq!(before.clip_id, "c1");
        assert_eq!(before.src_id, "main");
        assert_eq!(before.source_time, 8.0);
        assert_eq!(before.rate, 1.0);
        assert_eq!(before.timeline_time, 4.0);

        let after = projection
            .timeline_to_position(4.0, SeamBias::Following)
            .unwrap();
        assert_eq!(after.clip_id, "c2");
        assert_eq!(after.src_id, "src-a");
        assert_eq!(after.source_time, 1.0);
        assert_eq!(after.rate, 2.0);

        // 越界一律钳进排布内（与 `timeline_to_source` 同一档）。
        assert_eq!(
            projection
                .timeline_to_position(99.0, SeamBias::Following)
                .map(|position| (position.clip_id, position.timeline_time)),
            Some(("c3", 8.0))
        );
        assert!(
            projection
                .timeline_to_position(f64::NAN, SeamBias::Following)
                .is_none()
        );
    }

    #[test]
    fn playback_step_skips_cuts_and_opens_the_next_arranged_clip() {
        let projection =
            TimelineProjection::build(&document(), &BTreeMap::from([("main".to_owned(), 10.0)]))
                .unwrap();

        assert_eq!(
            projection.playback_step("c1", 2.5, 0.001),
            Some(PlaybackStep {
                timeline_time: 0.5,
                seek_source: None,
                src_id: "main".to_owned(),
                clip_id: "c1".to_owned(),
                clip_ended: false,
            })
        );
        assert_eq!(
            projection.playback_step("c1", 4.0, 0.001),
            Some(PlaybackStep {
                timeline_time: 2.0,
                seek_source: Some(6.0),
                src_id: "main".to_owned(),
                clip_id: "c1".to_owned(),
                clip_ended: false,
            })
        );
        assert!(
            projection
                .playback_step("c1", 8.0, 0.001)
                .is_some_and(|step| step.clip_ended && step.timeline_time == 4.0)
        );
        assert_eq!(
            projection.next_position("c1"),
            Some(SourcePosition {
                src_id: "src-a".to_owned(),
                source_time: 1.0,
                clip_id: "c2".to_owned(),
            })
        );
        assert!(projection.next_position("c3").is_none());
        assert!(projection.playback_step("missing", 0.0, 0.001).is_none());
        assert!(projection.playback_step("c1", f64::NAN, 0.001).is_none());
    }

    #[test]
    fn empty_clip_after_source_cuts_is_rejected() {
        let mut document = TimelineDocument::default();
        document.sources.insert(
            "main".to_owned(),
            Source {
                cuts: vec![Cut {
                    id: "cut-1".to_owned(),
                    t0: 0.0,
                    t1: 10.0,
                    r#ref: None,
                }],
                ..Source::default()
            },
        );
        document.clips.push(Clip {
            id: "c1".to_owned(),
            src_id: "main".to_owned(),
            in_time: 2.0,
            out: 3.0,
            rate: 1.0,
        });
        assert!(
            matches!(TimelineProjection::build(&document, &BTreeMap::from([("main".to_owned(), 10.0)])), Err(TimelineError::EmptyClip(id)) if id == "c1")
        );
    }

    #[test]
    fn zero_duration_main_has_no_implicit_clip_and_can_accept_the_first_source() {
        let mut document = TimelineDocument::default();
        document.sources.insert(
            "insert".into(),
            Source {
                duration: Some(2.0),
                ..Source::default()
            },
        );
        let durations = BTreeMap::from([("main".to_owned(), 0.0), ("insert".to_owned(), 2.0)]);
        let projection = TimelineProjection::build(&document, &durations).unwrap();
        assert_eq!(projection.duration(), 0.0);
        assert!(projection.clips().is_empty());
        assert!(!materialize_implicit_clip(&mut document, &durations).unwrap());
        assert!(document.clips.is_empty());
        add_clip(
            &mut document,
            &durations,
            "first".into(),
            "insert".into(),
            None,
            None,
            None,
            None,
        )
        .unwrap();
        let projection = TimelineProjection::build(&document, &durations).unwrap();
        assert_eq!(projection.clips().len(), 1);
        assert_eq!(projection.duration(), 2.0);
    }

    #[test]
    fn split_at_cut_seam_uses_preceding_left_and_following_right() {
        let mut document = TimelineDocument {
            sources: BTreeMap::from([(
                "main".to_owned(),
                Source {
                    cuts: vec![Cut {
                        id: "cut-1".to_owned(),
                        t0: 10.0,
                        t1: 20.0,
                        r#ref: None,
                    }],
                    ..Source::default()
                },
            )]),
            ..TimelineDocument::default()
        };
        let durations = BTreeMap::from([("main".to_owned(), 30.0)]);
        assert_eq!(
            split_clip(&mut document, &durations, 10.0, "c2".to_owned()).unwrap(),
            ("c1".to_owned(), "c2".to_owned())
        );
        assert_eq!(document.clips[0].out, 10.0);
        assert_eq!(document.clips[1].in_time, 20.0);
    }

    #[test]
    fn add_trim_move_and_remove_use_view_clock_and_array_order() {
        let mut document = document();
        let durations = BTreeMap::from([("main".to_owned(), 10.0)]);
        let index = add_clip(
            &mut document,
            &durations,
            "c4".to_owned(),
            "main".to_owned(),
            Some(2.0),
            Some(6.0),
            Some("c1"),
            None,
        )
        .unwrap();
        assert_eq!(index, 0);
        assert_eq!(
            (document.clips[0].in_time, document.clips[0].out),
            (2.0, 8.0)
        );
        trim_clip(&mut document, &durations, "c4", Some(3.0), Some(5.0)).unwrap();
        assert_eq!(
            (document.clips[0].in_time, document.clips[0].out),
            (3.0, 7.0)
        );
        set_clip_rate(&mut document, &durations, "c4", 2.0).unwrap();
        assert_eq!(document.clips[0].rate, 2.0);
        assert!(set_clip_rate(&mut document, &durations, "c4", 0.0).is_err());
        assert_eq!(
            move_clip(&mut document, "c4", None, Some("c3"), None).unwrap(),
            3
        );
        assert_eq!(document.clips.last().unwrap().id, "c4");
        assert_eq!(
            remove_clips(&mut document, &durations, &["c4".to_owned()]).unwrap(),
            vec!["c4"]
        );
    }
}
