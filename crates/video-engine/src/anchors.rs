//! 语义锚的跟随（视频格式规范 §3.16 的 `speech-anchor`）：每笔编辑事务的最后，按最终的时间线重新求锚点，把实例摆到求出的位置。
//!
//! - 词的投影与按文稿闪避同一种（`render_graph::text_plan::plan_text`，作用范围是转写素材在序列上的视频、音频实例，
//!   按起点、再按 ID 排）：投影决定词出现在哪些实例上；时刻按那个实例的线性映射与词的刻度精确求，不经浮点秒。
//! - 判定沿用 `timeline::anchors`：词的中点落在剪口里算被剪掉（`CutSet::word_is_cut`），端点落在剪口里时起点推到
//!   保留部分的开头、终点拉到保留部分的结尾；中点出现不止一处时有歧义；偏移之后为负的锚点无效。原因码与
//!   `AnchorError::code` 相同，另加句子、实例、序列锚点与摆放的几种。
//! - 求不出来、或者摆不下（与同轨道的实例重叠、超出素材）时，实例留在原来的位置，列为 `orphaned`：回执的
//!   `impact.orphanedAnchors` 与 [`orphaned`]（`videos.inspect`）。状态不落盘，每次按时间线现算。
//! - 这笔事务里写下（新建或改了）的锚点有歧义、或者指向不存在的转写文档时整笔拒绝；早先写下的只列为 `orphaned`。

use std::collections::{BTreeMap, HashMap};

use editor_semantics::{FrameAlignment, Rate, Ratio, TimeMap, TimelineTimeInput, frame_time, quantize_frame};
use render_graph::VideoView;
use render_graph::text_plan::plan_text;
use serde::Serialize;
use serde_json::{Value, json};
use timeline::anchors::AnchorError;
use timeline::cuts::CutSet;
use video_model::cut_set::CutSetBody;

use crate::error::{EngineResult, ErrorBody, kinds, msg};
use crate::model::*;
use crate::ops::{Edge, EditContext, ItemMove, move_item, trim_item};
use crate::state::{VideoState, item_range};

/// 读一份文档某个版本的正文；文档或版本不存在时为 `None`。
pub type Loader<'a> = dyn FnMut(&str, &str) -> EngineResult<Option<Value>> + 'a;

/// 求不出锚点、或者摆不到求出的位置上的实例。
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrphanedAnchor {
    pub item_id: Id,
    /// `word-anchor-missing`、`word-anchor-cut`、`word-anchor-unmapped`、`word-anchor-ambiguous`、`word-anchor-invalid`、
    /// `sentence-anchor-missing`、`item-anchor-missing`、`sequence-anchor-mismatch`、`anchor-range-empty`（求出的终点不晚于起点）、
    /// `anchor-blocked`（摆不下：与同轨道的实例重叠、超出素材）。
    pub reason: String,
}

/// 投影里浮点秒与精确时刻比较的容差。
const EPS: f64 = 1e-6;

#[derive(Clone, Debug)]
struct Fail {
    reason: String,
    /// 锚点是这笔事务里写下的时整笔拒绝，而不是列为 `orphaned`。
    reject_when_written: bool,
}

impl Fail {
    fn orphan(reason: &str) -> Fail {
        Fail {
            reason: reason.into(),
            reject_when_written: false,
        }
    }

    fn reject(reason: &str) -> Fail {
        Fail {
            reason: reason.into(),
            reject_when_written: true,
        }
    }

    fn anchor(error: AnchorError) -> Fail {
        match error {
            AnchorError::Ambiguous(_) => Fail::reject(error.code()),
            other => Fail::orphan(other.code()),
        }
    }
}

/// 求出的起点、终点（精确的序列时刻）；没有锚点的一端为 `None`。
#[derive(Clone, Debug, PartialEq)]
pub struct Target {
    start: Option<Ratio>,
    end: Option<Ratio>,
}

/// 一个实例的求值结果。
pub struct Resolution {
    item_id: Id,
    outcome: Result<Target, Fail>,
}

/// 词在一个作用实例上的投影：序列上的浮点区间，加上那个实例的精确映射。
#[derive(Clone, Debug)]
struct Piece {
    item_id: Id,
    origin: Id,
    start: f64,
    end: f64,
    item_start: Ratio,
    item_end: Ratio,
    source_in: Ratio,
    rate: Ratio,
}

impl Piece {
    fn map(&self, source: Ratio) -> Option<Ratio> {
        self.item_start
            .checked_add(source.checked_sub(self.source_in)?.checked_div(self.rate)?)
    }

    fn covers(&self, time: Ratio) -> bool {
        let t = time.to_f64();
        t >= self.start - EPS && t <= self.end + EPS
    }
}

/// 一份转写文档在一个序列上的投影。
struct Projection {
    /// 文档时间就是序列时间，不经映射。
    sequence_clock: bool,
    words: HashMap<String, (Ratio, Ratio)>,
    /// 存下来的句子：句子 ID → 成员词（按顺序）。文档没有句子时为 `None`。
    sentences: Option<HashMap<String, Vec<String>>>,
    pieces: HashMap<String, Vec<Piece>>,
    /// 素材的剪口（精确时刻，按 `t0` 排）与判定用的 `CutSet`。
    cuts: Vec<(Ratio, Ratio)>,
    cut_set: Option<CutSet>,
}

fn has_speech_anchor(state: &VideoState) -> bool {
    state
        .items
        .values()
        .any(|p| matches!(p.value.base().follow_policy, FollowPolicy::SpeechAnchor { .. }))
}

/// 按 `state` 的时间线求每个 `speech-anchor` 实例的锚点。
pub fn resolve(state: &VideoState, load: &mut Loader<'_>) -> EngineResult<Vec<Resolution>> {
    if !has_speech_anchor(state) {
        return Ok(Vec::new());
    }
    let snapshot = state.snapshot();
    let view = VideoView::from(&snapshot);
    let mut projections: HashMap<(Id, Revision, Id), Option<Projection>> = HashMap::new();
    let mut resolutions = Vec::new();
    for placed in state.items.values() {
        let FollowPolicy::SpeechAnchor { start, end } = &placed.value.base().follow_policy else {
            continue;
        };
        let item_id = placed.value.base().id.clone();
        let sequence_id = placed.sequence_id.clone();
        let mut one = |anchor: &Option<SemanticAnchor>| -> EngineResult<Result<Option<Ratio>, Fail>> {
            let Some(anchor) = anchor else { return Ok(Ok(None)) };
            Ok(resolve_anchor(state, view, &sequence_id, anchor, load, &mut projections)?.map(Some))
        };
        let outcome = match (one(start)?, one(end)?) {
            (Ok(start), Ok(end)) => Ok(Target { start, end }),
            (Err(fail), _) | (_, Err(fail)) => Err(fail),
        };
        resolutions.push(Resolution { item_id, outcome });
    }
    Ok(resolutions)
}

fn resolve_anchor(
    state: &VideoState,
    view: VideoView<'_>,
    sequence_id: &str,
    anchor: &SemanticAnchor,
    load: &mut Loader<'_>,
    projections: &mut HashMap<(Id, Revision, Id), Option<Projection>>,
) -> EngineResult<Result<Ratio, Fail>> {
    let fps = sequence_fps(state, sequence_id)?;
    match anchor {
        SemanticAnchor::Word {
            speech_ref,
            word_id,
            occurrence_id,
            edge: word_edge,
            offset,
        } => {
            let Some(projection) = projection(state, view, sequence_id, speech_ref, load, projections)? else {
                return Ok(Err(Fail::reject("word-anchor-missing")));
            };
            let time = match word_time(projection, word_id, *word_edge, occurrence_id.as_deref()) {
                Ok(time) => time,
                Err(fail) => return Ok(Err(fail)),
            };
            let offset = match offset {
                Some(offset) => offset.to_ratio("offset")?,
                None => Ratio::ZERO,
            };
            let time = time.checked_add(offset).ok_or_else(crate::ops::overflow)?;
            if time.is_negative() {
                return Ok(Err(Fail::orphan("word-anchor-invalid")));
            }
            Ok(Ok(time))
        }
        SemanticAnchor::Sentence {
            speech_ref,
            sentence_id,
            occurrence_id,
            edge: sentence_edge,
        } => {
            let Some(projection) = projection(state, view, sequence_id, speech_ref, load, projections)? else {
                return Ok(Err(Fail::reject("word-anchor-missing")));
            };
            let Some(members) = projection.sentences.as_ref().and_then(|s| s.get(sentence_id)) else {
                return Ok(Err(Fail::orphan("sentence-anchor-missing")));
            };
            // 句子的起点是第一个求得出的词的开头，终点是最后一个求得出的词的结尾。
            let ordered: Vec<&String> = match sentence_edge {
                AnchorEdge::Start => members.iter().collect(),
                AnchorEdge::End => members.iter().rev().collect(),
            };
            let mut first_fail = None;
            for word in ordered {
                match word_time(projection, word, *sentence_edge, occurrence_id.as_deref()) {
                    Ok(time) => return Ok(Ok(time)),
                    Err(fail) if fail.reject_when_written => return Ok(Err(fail)),
                    Err(fail) => {
                        first_fail.get_or_insert(fail);
                    }
                }
            }
            Ok(Err(first_fail.unwrap_or_else(|| Fail::orphan("sentence-anchor-missing"))))
        }
        SemanticAnchor::Item { item_id, local_offset } => {
            let Some(target) = state.items.get(item_id).filter(|p| p.sequence_id == sequence_id) else {
                return Ok(Err(Fail::orphan("item-anchor-missing")));
            };
            let (start, _) = item_range(&target.value, fps)?;
            let time = start
                .checked_add(local_offset.to_ratio("localOffset")?)
                .ok_or_else(crate::ops::overflow)?;
            if time.is_negative() {
                return Ok(Err(Fail::orphan("anchor-range-empty")));
            }
            Ok(Ok(time))
        }
        SemanticAnchor::Sequence {
            sequence_id: anchored,
            frame,
        } => {
            if anchored != sequence_id {
                return Ok(Err(Fail::orphan("sequence-anchor-mismatch")));
            }
            Ok(Ok(frame_time(*frame as i128, fps).ok_or_else(crate::ops::overflow)?))
        }
    }
}

fn sequence_fps(state: &VideoState, sequence_id: &str) -> EngineResult<Rate> {
    state
        .sequences
        .get(sequence_id)
        .map(|s| s.header.fps)
        .ok_or_else(|| ErrorBody::not_found(kinds::sequence(), sequence_id))
}

/// 一个锚点的时刻：词的中点所在的出现处，再求这个端点。
fn word_time(projection: &Projection, word_id: &str, edge: AnchorEdge, occurrence: Option<&str>) -> Result<Ratio, Fail> {
    let missing = || AnchorError::WordMissing {
        source_id: String::new(),
        word_id: word_id.to_string(),
    };
    let &(t0, t1) = projection.words.get(word_id).ok_or_else(|| Fail::anchor(missing()))?;
    let source = match edge {
        AnchorEdge::Start => t0,
        AnchorEdge::End => t1,
    };
    if projection.sequence_clock {
        return Ok(source);
    }
    if projection.cut_set.as_ref().is_some_and(|c| c.word_is_cut(t0.to_f64(), t1.to_f64())) {
        return Err(Fail::anchor(AnchorError::WordCut(word_id.to_string())));
    }
    let pieces = projection.pieces.get(word_id).map(Vec::as_slice).unwrap_or_default();
    let middle = t0
        .checked_add(t1)
        .and_then(|s| s.checked_div(Ratio::from_int(2)?))
        .ok_or_else(|| Fail::orphan("word-anchor-invalid"))?;
    // 中点的出现处：同一刻的音画只算一处。
    let mut found: Vec<(&Piece, Ratio)> = Vec::new();
    for piece in pieces {
        if occurrence.is_some_and(|o| o != piece.item_id && o != piece.origin) {
            continue;
        }
        if let Some(t) = piece.map(middle).filter(|t| piece.covers(*t))
            && !found.iter().any(|(_, seen)| *seen == t)
        {
            found.push((piece, t));
        }
    }
    let (home, middle_time) = match found.as_slice() {
        [] => return Err(Fail::anchor(AnchorError::Unmapped(word_id.to_string()))),
        [one] => *one,
        _ => return Err(Fail::anchor(AnchorError::Ambiguous(word_id.to_string()))),
    };
    // 端点落在剪口里：起点推到剪口之后，终点拉到剪口之前（timeline::anchors 的 SeamBias）。
    let mut x = source;
    while let Some(&(c0, c1)) = projection.cuts.iter().find(|(c0, c1)| *c0 <= x && x < *c1) {
        x = match edge {
            AnchorEdge::Start => c1,
            AnchorEdge::End => c0,
        };
        if edge == AnchorEdge::End {
            break;
        }
    }
    // 端点在任何一段上的位置：起点取不晚于中点的最近一处，终点取不早于中点的最近一处。
    let candidates = pieces.iter().filter_map(|p| p.map(x).filter(|t| p.covers(*t)));
    let chosen = match edge {
        AnchorEdge::Start => candidates.filter(|t| *t <= middle_time).max(),
        AnchorEdge::End => candidates.filter(|t| *t >= middle_time).min(),
    };
    Ok(match chosen {
        Some(t) => t,
        // 端点被修剪掉了（不是剪口）：靠到中点所在实例的边上。
        None => {
            let t = home.map(x).unwrap_or(middle_time);
            t.max(home.item_start).min(home.item_end)
        }
    })
}

fn projection<'p>(
    state: &VideoState,
    view: VideoView<'_>,
    sequence_id: &str,
    speech_ref: &VersionRef,
    load: &mut Loader<'_>,
    projections: &'p mut HashMap<(Id, Revision, Id), Option<Projection>>,
) -> EngineResult<Option<&'p Projection>> {
    let key = (speech_ref.id.clone(), speech_ref.revision.clone(), sequence_id.to_string());
    if !projections.contains_key(&key) {
        let built = build_projection(state, view, sequence_id, speech_ref, load)?;
        projections.insert(key.clone(), built);
    }
    Ok(projections[&key].as_ref())
}

fn build_projection(
    state: &VideoState,
    view: VideoView<'_>,
    sequence_id: &str,
    speech_ref: &VersionRef,
    load: &mut Loader<'_>,
) -> EngineResult<Option<Projection>> {
    let Some(record) = state.documents.get(&speech_ref.id) else {
        return Ok(None);
    };
    let Some(body) = load(&speech_ref.id, &speech_ref.revision)? else {
        return Ok(None);
    };
    if body.get("schema").and_then(Value::as_str) != Some("baocut.speech/1") {
        return Ok(None);
    }
    let timescale = body.get("timescale").and_then(Value::as_u64).unwrap_or(1_000_000).max(1) as i128;
    let mut words = HashMap::new();
    let mut order: Vec<String> = Vec::new();
    for word in body.get("words").and_then(Value::as_array).into_iter().flatten() {
        let (Some(id), Some(start), Some(end)) = (
            word.get("id").and_then(Value::as_str),
            word.get("start").and_then(ticks),
            word.get("end").and_then(ticks),
        ) else {
            continue;
        };
        let (Some(t0), Some(t1)) = (Ratio::new(start, timescale), Ratio::new(end, timescale)) else {
            continue;
        };
        order.push(id.to_string());
        words.insert(id.to_string(), (t0, t1));
    }
    let sentences = body.get("sentences").and_then(Value::as_array).map(|list| {
        let index: HashMap<&str, usize> = order.iter().enumerate().map(|(i, id)| (id.as_str(), i)).collect();
        list.iter()
            .filter_map(|s| {
                let id = s.get("id").and_then(Value::as_str)?;
                let members: Vec<String> = if let Some(ids) = s.get("wordIds").and_then(Value::as_array) {
                    ids.iter().filter_map(|w| w.as_str().map(str::to_string)).collect()
                } else {
                    let first = s.get("first").and_then(Value::as_str).and_then(|w| index.get(w).copied())?;
                    let last = s.get("last").and_then(Value::as_str).and_then(|w| index.get(w).copied())?;
                    order.get(first..=last)?.to_vec()
                };
                Some((id.to_string(), members))
            })
            .collect()
    });
    let sequence_clock = body.get("clock").and_then(Value::as_str) == Some("sequence");
    let mut projection = Projection {
        sequence_clock,
        words,
        sentences,
        pieces: HashMap::new(),
        cuts: Vec::new(),
        cut_set: None,
    };
    if sequence_clock {
        return Ok(Some(projection));
    }
    let Some(asset_id) = &record.source_asset_id else {
        return Ok(Some(projection));
    };
    let fps = sequence_fps(state, sequence_id)?;

    // 作用范围与按文稿闪避相同：素材的视频、音频实例，按起点、再按 ID 排。
    let mut scope: Vec<(Ratio, Id)> = Vec::new();
    let mut maps: BTreeMap<Id, (Ratio, Ratio, Ratio, Ratio, Id)> = BTreeMap::new();
    for placed in state.items.values().filter(|p| p.sequence_id == sequence_id) {
        let (map, asset) = match &placed.value {
            TimelineItem::Video(v) => (&v.time_map, &v.asset_ref.id),
            TimelineItem::Audio(a) => (&a.time_map, &a.asset_ref.id),
            _ => continue,
        };
        if asset != asset_id {
            continue;
        }
        let (start, end) = item_range(&placed.value, fps)?;
        let base = placed.value.base();
        scope.push((start, base.id.clone()));
        if let TimeMap::Linear { source_in, rate } = map {
            let origin = base
                .lineage
                .as_ref()
                .map(|l| l.origin_item_id.clone())
                .unwrap_or_else(|| base.id.clone());
            maps.insert(base.id.clone(), (start, end, source_in.to_ratio("sourceIn")?, rate.ratio(), origin));
        }
    }
    scope.sort();
    let scope: Vec<Id> = scope.into_iter().map(|(_, id)| id).collect();
    if !scope.is_empty() {
        match plan_text(view, sequence_id, record, &body, &scope, None) {
            Ok(plan) => {
                for entry in plan.entries {
                    let Some(item_id) = entry.scope_item_id else { continue };
                    let Some((item_start, item_end, source_in, rate, origin)) = maps.get(&item_id).cloned() else {
                        continue;
                    };
                    projection.pieces.entry(entry.id).or_default().push(Piece {
                        item_id,
                        origin,
                        start: entry.start,
                        end: entry.end,
                        item_start,
                        item_end,
                        source_in,
                        rate,
                    });
                }
            }
            Err(error) if error.code == "EXPORT_SOURCE_UNPLACED" || error.code == "EXPORT_RANGE_EMPTY" => {}
            Err(error) => return Err(ErrorBody::invalid_operation(error.message).details(json!({ "rule": error.code }))),
        }
    }

    // 素材的剪口集合：判定词有没有被剪掉，端点落在剪口里时靠边。
    if let Some(cut_set_id) = crate::cuts::cut_set_document(state, asset_id)
        && let Some(revision) = state.documents.get(&cut_set_id).map(|d| d.current_revision.clone())
        && let Some(body) = load(&cut_set_id, &revision)?
        && let Ok(parsed) = serde_json::from_value::<CutSetBody>(body)
    {
        projection.cuts = parsed.cuts.iter().filter_map(|c| c.range(parsed.timescale)).collect();
        projection.cuts.sort();
        let duration = state
            .assets
            .get(asset_id)
            .and_then(|a| a.revisions.get(&a.current_revision))
            .and_then(|r| r.duration.as_ref())
            .and_then(|d| d.to_ratio("duration").ok());
        let projected = parsed
            .cuts
            .iter()
            .zip(&projection.cuts)
            .map(|(c, (t0, t1))| timeline::schema::Cut {
                id: c.id.clone(),
                t0: t0.to_f64(),
                t1: t1.to_f64(),
                r#ref: None,
            })
            .collect();
        let duration = duration
            .map(Ratio::to_f64)
            .or_else(|| projection.cuts.last().map(|c| c.1.to_f64()))
            .unwrap_or(0.0);
        projection.cut_set = CutSet::new(duration, projected).ok();
    }
    Ok(Some(projection))
}

fn ticks(value: &Value) -> Option<i128> {
    match value {
        Value::Number(n) => n.as_i64().map(i128::from),
        Value::String(s) => s.parse().ok(),
        _ => None,
    }
}

/// 摆放的目标：精确的起止与量化之后的帧。
struct Placement {
    start: Ratio,
    end: Ratio,
    start_frame: Option<i64>,
    end_frame: Option<i64>,
}

/// 求出的锚点在 `state` 上的摆放；与现在的位置相同时为 `None`。
fn placement(state: &VideoState, item_id: &str, target: &Target) -> EngineResult<Result<Option<Placement>, Fail>> {
    let placed = &state.items[item_id];
    let fps = sequence_fps(state, &placed.sequence_id)?;
    let (current_start, current_end) = item_range(&placed.value, fps)?;
    let frame = |t: Ratio, field: &str| -> EngineResult<(i64, Ratio)> {
        let f = quantize_frame(t, fps, FrameAlignment::NearestFrame, field).map_err(ErrorBody::time)?;
        Ok((f, frame_time(f as i128, fps).ok_or_else(crate::ops::overflow)?))
    };
    let (start_frame, start) = match target.start {
        Some(t) => {
            let (f, s) = frame(t, "start")?;
            (Some(f), s)
        }
        None => (None, current_start),
    };
    let (end_frame, end) = match target.end {
        Some(t) => {
            let (f, e) = frame(t, "end")?;
            (Some(f), e)
        }
        None => (
            None,
            start
                .checked_add(current_end.checked_sub(current_start).ok_or_else(crate::ops::overflow)?)
                .ok_or_else(crate::ops::overflow)?,
        ),
    };
    if end <= start {
        return Ok(Err(Fail::orphan("anchor-range-empty")));
    }
    if (start, end) == (current_start, current_end) {
        return Ok(Ok(None));
    }
    // 到序列末尾的实例终点由引擎另求：只看起点会不会落进别的实例。
    let probe_end = if placed.value.base().until_sequence_end {
        start
            .checked_add(frame_time(1, fps).ok_or_else(crate::ops::overflow)?)
            .ok_or_else(crate::ops::overflow)?
    } else {
        end
    };
    let track = &placed.value.base().track_id;
    for other in state.items.values() {
        let base = other.value.base();
        if base.id == item_id || &base.track_id != track || other.sequence_id != placed.sequence_id {
            continue;
        }
        let (s, e) = item_range(&other.value, fps)?;
        if start < e && s < probe_end {
            return Ok(Err(Fail::orphan("anchor-blocked")));
        }
    }
    Ok(Ok(Some(Placement {
        start,
        end,
        start_frame,
        end_frame,
    })))
}

/// 把求出的位置写进 `next`，返回列为 `orphaned` 的实例。锁着的实例要动时整笔拒绝（与 `follow-cuts` 相同）。
pub(crate) fn apply(
    before: &VideoState,
    next: &mut VideoState,
    resolutions: Vec<Resolution>,
    ctx: &mut EditContext<'_>,
) -> EngineResult<Vec<Id>> {
    let mut orphaned = Vec::new();
    for Resolution { item_id, outcome } in resolutions {
        let written =
            before.items.get(&item_id).map(|p| &p.value.base().follow_policy) != Some(&next.items[&item_id].value.base().follow_policy);
        let fail = match outcome {
            Ok(target) => match placement(next, &item_id, &target)? {
                Ok(None) => continue,
                Ok(Some(placement)) => match place(next, &item_id, &placement, ctx)? {
                    None => continue,
                    Some(fail) => fail,
                },
                Err(fail) => fail,
            },
            Err(fail) => fail,
        };
        if written && fail.reject_when_written {
            return Err(
                ErrorBody::invalid_operation(msg!(
                    "engine.anchorUnresolved",
                    "The semantic anchor of clip {item} cannot be resolved: {reason}",
                    item = item_id,
                    reason = fail.reason
                ))
                    .entities([item_id.clone()])
                    .details(json!({ "rule": fail.reason })),
            );
        }
        orphaned.push(item_id);
    }
    Ok(orphaned)
}

/// 移动起点、再修剪终点（关键帧与音频的子帧照常换算）。超出素材等摆不下的情况还原并返回原因。
fn place(next: &mut VideoState, item_id: &str, placement: &Placement, ctx: &mut EditContext<'_>) -> EngineResult<Option<Fail>> {
    let sequence_id = next.items[item_id].sequence_id.clone();
    let fps = sequence_fps(next, &sequence_id)?;
    // 带素材的实例修剪可能超出素材：先留一份（关键帧也会改），失败时整个还原；其余实例只会动它自己。
    let backup = next.items[item_id].value.asset_ref().is_some().then(|| next.clone());
    let item_backup = next.items[item_id].clone();
    let receipts = ctx.time_resolution.len();
    let result = (|| -> EngineResult<()> {
        let (current_start, _) = item_range(&next.items[item_id].value, fps)?;
        if placement.start != current_start {
            let frame = match placement.start_frame {
                Some(f) => f,
                None => quantize_frame(placement.start, fps, FrameAlignment::NearestFrame, "start").map_err(ErrorBody::time)?,
            };
            let mv = ItemMove {
                item_id: item_id.to_string(),
                at: Some(TimelineTimeInput::Frames { value: frame }),
                offset: None,
                track_id: None,
            };
            move_item(next, Some(&sequence_id), &mv, FrameAlignment::NearestFrame, ctx)?;
        }
        let (_, current_end) = item_range(&next.items[item_id].value, fps)?;
        if let Some(end_frame) = placement.end_frame
            && placement.end != current_end
        {
            let at = TimelineTimeInput::Frames { value: end_frame };
            trim_item(next, Some(&sequence_id), item_id, Edge::End, &at, FrameAlignment::NearestFrame, ctx)?;
        }
        Ok(())
    })();
    match result {
        Ok(()) => Ok(None),
        Err(error) if error.code == "TARGET_LOCKED" => Err(error),
        Err(_) => {
            match backup {
                Some(backup) => *next = backup,
                None => {
                    next.items.insert(item_id.to_string(), item_backup);
                }
            }
            ctx.time_resolution.truncate(receipts);
            Ok(Some(Fail::orphan("anchor-blocked")))
        }
    }
}

/// 现在的时间线上列为 `orphaned` 的实例：求不出锚点，或者不在求出的位置上（摆不下）。只读，不改视频。
pub fn orphaned(state: &VideoState, load: &mut Loader<'_>) -> EngineResult<Vec<OrphanedAnchor>> {
    let mut found = Vec::new();
    for Resolution { item_id, outcome } in resolve(state, load)? {
        let reason = match outcome {
            Ok(target) => match placement(state, &item_id, &target)? {
                Ok(None) => continue,
                Ok(Some(_)) => "anchor-blocked".to_string(),
                Err(fail) => fail.reason,
            },
            Err(fail) => fail.reason,
        };
        found.push(OrphanedAnchor { item_id, reason });
    }
    Ok(found)
}
