//! 口播剪口（视频格式规范 §6.7、§3.16）：`addCuts` 与 `restoreCut` 改源素材的剪口集合（`baocut.cut-set/1`），
//! 并在同一笔事务里按新的保留区间重排序列上的实例。
//!
//! - 剪口集合的实例（`scopeItemIds` 与由它们拆出来的实例）：剪口经它们的源时钟映射到序列上，量化到最近的帧；
//!   在这些实例所在的轨道上按 `removeRange` 波纹删除，恢复时在接缝处插回、把两边接上。
//! - 其余轨道上的实例按 `followPolicy`：`follow-cuts` 按 §3.16 移动、缩短或删掉，其余不动。
//! - 加入剪口按 `timeline::cuts` 的规则合并（间隔不超过 [`CUT_MERGE_GAP`] 的并成一个，保留靠前那个的 ID 与出处），
//!   时刻用精确有理数比较；合并之后的集合再用 [`CutSet::new`] 核对结构。

use std::collections::{BTreeMap, BTreeSet, HashSet};

use editor_semantics::{FrameAlignment, MAX_SAFE_INTEGER, Rate, Ratio, TimeMap, TimelineTimeInput, frame_time, quantize_frame};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use timeline::cuts::{CUT_MERGE_GAP, CutSet};
use timeline::keyframes::Rewindow;
use video_model::cut_set::{CUT_SET_KIND, CUT_SET_SCHEMA, Cut, CutSetBody, cut_set_body_problems};

use crate::error::{EngineResult, ErrorBody, kinds, msg};
use crate::ids::new_id;
use crate::model::*;
use crate::ops::{
    AssetTarget, Edge, EditContext, PutDocumentInput, delete_items, ensure_editable, join_items, overflow, put_document, remove_range,
    require_sequence, seconds_between, shift_earlier, trim_item,
};
use crate::state::{VideoState, item_range};

/// `addCuts` 的一个剪口：源素材时钟上的 `[from, to)`（十进制秒），`ref` 是出处（剪辑建议的 ID，§6.2）。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CutInput {
    pub from: String,
    pub to: String,
    #[serde(default, rename = "ref", skip_serializing_if = "Option::is_none")]
    pub reference: Option<Id>,
}

/// 剪口操作写进回执 `impact` 的结果。
#[derive(Clone, Debug, Default, PartialEq)]
pub struct CutImpact {
    /// 随剪口删掉的实例：整个落在剪掉的区间里。
    pub removed: Vec<Id>,
    /// 恢复了、却找不到接缝放回去的剪口：剪口集合里已经去掉，实例不动。
    pub not_relaid: Vec<Id>,
}

/// 这笔事务要读的剪口集合：源素材的剪口集合文档（至多一份，§6.7）。
pub fn cut_set_document(state: &VideoState, asset_id: &str) -> Option<Id> {
    state
        .documents
        .values()
        .filter(|d| d.kind == CUT_SET_KIND && d.source_asset_id.as_deref() == Some(asset_id))
        .map(|d| d.id.clone())
        .min()
}

/// 精确时刻的剪口。
#[derive(Clone, Debug)]
struct ExactCut {
    id: Id,
    t0: Ratio,
    t1: Ratio,
    reference: Option<Id>,
}

struct Loaded {
    document_id: Option<Id>,
    scope: Vec<Id>,
    cuts: Vec<ExactCut>,
}

/// 读源素材当前的剪口集合：同一笔事务里先写过的以写过的为准。
fn load(state: &VideoState, ctx: &EditContext<'_>, asset_id: &str) -> EngineResult<Loaded> {
    let Some(id) = cut_set_document(state, asset_id) else {
        return Ok(Loaded {
            document_id: None,
            scope: Vec::new(),
            cuts: Vec::new(),
        });
    };
    let body: Value = match ctx.documents.iter().rev().find(|d| d.document_id == id) {
        Some(written) => serde_json::from_str(&written.body).map_err(|e| ErrorBody::storage(msg!("engine.cutSetBodyCorrupt", "The cut set body is corrupt: {error}", error = e.to_string())))?,
        None => ctx
            .cut_sets
            .get(&id)
            .cloned()
            .ok_or_else(|| ErrorBody::storage(msg!("engine.cutSetBodyUnreadable", "Could not read the body of cut set {id}", id)))?,
    };
    let problems = cut_set_body_problems(&body, None);
    if !problems.is_empty() {
        return Err(ErrorBody::invalid_operation(msg!(
            "engine.bodyNotSchema",
            "The body does not match {schema}: {problems}",
            schema = CUT_SET_SCHEMA,
            problems = message_ref::join(problems)
        )).entities([id]));
    }
    let parsed: CutSetBody = serde_json::from_value(body).expect("刚核对过形状");
    let cuts = parsed
        .cuts
        .iter()
        .map(|c| {
            let (t0, t1) = c.range(parsed.timescale).expect("刚核对过刻度");
            ExactCut {
                id: c.id.clone(),
                t0,
                t1,
                reference: c.r#ref.clone(),
            }
        })
        .collect();
    Ok(Loaded {
        document_id: Some(id),
        scope: parsed.scope_item_ids,
        cuts,
    })
}

/// 写回剪口集合：`timescale` 取能精确表示全部剪口的最小值（各分母的最小公倍数），不舍入。
fn write(state: &mut VideoState, ctx: &mut EditContext<'_>, asset_id: &str, loaded: &Loaded) -> EngineResult<()> {
    let mut timescale: i128 = 1;
    for cut in &loaded.cuts {
        for t in [cut.t0, cut.t1] {
            timescale = lcm(timescale, t.den());
            if timescale > MAX_SAFE_INTEGER {
                return Err(ErrorBody::invalid_operation(msg!(
                    "engine.cutTimescaleUnsafe",
                    "The cut times cannot be represented exactly with a safe-integer timescale"
                )));
            }
        }
    }
    let ticks = |t: Ratio| (t.num() * (timescale / t.den())).to_string();
    let body = CutSetBody {
        schema: CUT_SET_SCHEMA.to_string(),
        timescale: timescale as u64,
        clock: "source-asset".to_string(),
        scope_item_ids: loaded.scope.clone(),
        cuts: loaded
            .cuts
            .iter()
            .map(|c| Cut {
                id: c.id.clone(),
                t0: ticks(c.t0),
                t1: ticks(c.t1),
                r#ref: c.reference.clone(),
            })
            .collect(),
    };
    let body = serde_json::to_value(&body).expect("剪口集合可以序列化");
    let target = AssetTarget::Id {
        asset_id: asset_id.to_string(),
    };
    put_document(
        state,
        PutDocumentInput {
            document_id: loaded.document_id.as_deref(),
            reference: None,
            kind: CUT_SET_KIND,
            name: loaded.document_id.is_none().then_some("剪口"),
            language: None,
            source_asset: Some(&target),
            source_document: None,
            body: &body,
            summary: None,
            extensions: &BTreeMap::new(),
        },
        ctx,
    )
}

fn lcm(a: i128, b: i128) -> i128 {
    let gcd = |mut x: i128, mut y: i128| {
        while y != 0 {
            (x, y) = (y, x % y);
        }
        x
    };
    a / gcd(a, b) * b
}

/// 被剪素材当前版本的时长：剪口不能超出它。
pub(crate) fn source_duration(state: &VideoState, asset_id: &str) -> EngineResult<Ratio> {
    let asset = state.assets.get(asset_id).ok_or_else(|| ErrorBody::not_found(kinds::asset(), asset_id))?;
    let duration = asset.revisions[&asset.current_revision]
        .duration
        .as_ref()
        .ok_or_else(|| ErrorBody::invalid_operation(msg!("engine.cutAssetNoDuration", "The asset has no duration, so it cannot be cut")).entities([asset_id]))?;
    Ok(duration.to_ratio("duration")?)
}

/// 间隔不超过 [`CUT_MERGE_GAP`]（0.02 秒）的剪口并成一个，保留靠前那个的 ID 与出处（与 `timeline::cuts::insert_cut` 同一规则，
/// 在精确时刻上比较：恰好 0.02 秒的间隔也合并）。
fn insert_exact(cuts: &mut Vec<ExactCut>, incoming: ExactCut) {
    let gap = Ratio::new(1, 50).expect("常量");
    debug_assert!((gap.to_f64() - CUT_MERGE_GAP).abs() < 1e-12);
    cuts.push(incoming);
    cuts.sort_by(|a, b| a.t0.cmp(&b.t0).then(a.t1.cmp(&b.t1)));
    let mut merged: Vec<ExactCut> = Vec::with_capacity(cuts.len());
    for cut in cuts.drain(..) {
        if let Some(previous) = merged.last_mut()
            && cut.t0.checked_sub(previous.t1).is_some_and(|d| d <= gap)
        {
            previous.t1 = previous.t1.max(cut.t1);
            continue;
        }
        merged.push(cut);
    }
    *cuts = merged;
}

fn projected(cuts: &[ExactCut]) -> Vec<timeline::schema::Cut> {
    cuts.iter()
        .map(|c| timeline::schema::Cut {
            id: c.id.clone(),
            t0: c.t0.to_f64(),
            t1: c.t1.to_f64(),
            r#ref: c.reference.clone(),
        })
        .collect()
}

/// 源素材当前的剪口集合（含这笔事务里先加的），供剪辑建议跳过已经剪掉的区间。
pub(crate) fn current_cut_set(state: &VideoState, ctx: &EditContext<'_>, asset_id: &str) -> EngineResult<CutSet> {
    let duration = source_duration(state, asset_id)?;
    let loaded = load(state, ctx, asset_id)?;
    CutSet::new(duration.to_f64(), projected(&loaded.cuts)).map_err(|e| ErrorBody::invalid_operation(msg!("engine.cutSetInvalid", "The cut set is invalid: {error}", error = e.to_string())))
}

/// 结构核对：按 `t0` 排序、互不重叠、在素材之内（`timeline::cuts::CutSet`）。
fn check_structure(cuts: &[ExactCut], duration: Ratio) -> EngineResult<()> {
    CutSet::new(duration.to_f64(), projected(cuts))
        .map(|_| ())
        .map_err(|e| ErrorBody::invalid_operation(msg!("engine.cutSetInvalid", "The cut set is invalid: {error}", error = e.to_string())))
}

/// 剪口集合的一个实例：在序列上的区间与线性的源时钟。
#[derive(Clone, Debug)]
struct Scoped {
    id: Id,
    track_id: Id,
    start: Ratio,
    end: Ratio,
    source_in: Ratio,
    rate: Ratio,
}

impl Scoped {
    fn source_out(&self) -> EngineResult<Ratio> {
        let length = self.end.checked_sub(self.start).ok_or_else(overflow)?;
        self.source_in
            .checked_add(length.checked_mul(self.rate).ok_or_else(overflow)?)
            .ok_or_else(overflow)
    }

    /// 源时刻在序列上的位置。
    fn at_source(&self, s: Ratio) -> EngineResult<Ratio> {
        let offset = s.checked_sub(self.source_in).ok_or_else(overflow)?;
        self.start
            .checked_add(offset.checked_div(self.rate).ok_or_else(overflow)?)
            .ok_or_else(overflow)
    }
}

/// 序列上播放这个素材的视频与音频实例。
fn asset_items<'s>(state: &'s VideoState, sequence_id: &str, asset_id: &str) -> impl Iterator<Item = &'s TimelineItem> {
    state.items.values().filter_map(move |p| {
        let plays = match &p.value {
            TimelineItem::Video(v) => v.asset_ref.id == asset_id,
            TimelineItem::Audio(a) => a.asset_ref.id == asset_id,
            _ => false,
        };
        (p.sequence_id == sequence_id && plays).then_some(&p.value)
    })
}

/// 剪口集合的实例：`scopeItemIds` 里的，以及 lineage 指回它们的（拆出来的右半）；一个都不在时取序列上播放这个素材的
/// 全部视频、音频实例。源时钟须是正速率的线性映射。按起点、再按 ID 排。
fn scope_of(state: &VideoState, sequence_id: &str, fps: Rate, asset_id: &str, stored: &[Id]) -> EngineResult<Vec<Scoped>> {
    let stored: HashSet<&str> = stored.iter().map(String::as_str).collect();
    let listed = |item: &&TimelineItem| {
        let base = item.base();
        stored.contains(base.id.as_str())
            || base.lineage.as_ref().is_some_and(|l| {
                stored.contains(l.origin_item_id.as_str()) || l.parent_item_id.as_deref().is_some_and(|p| stored.contains(p))
            })
    };
    let mut chosen: Vec<&TimelineItem> = asset_items(state, sequence_id, asset_id).filter(listed).collect();
    if chosen.is_empty() {
        chosen = asset_items(state, sequence_id, asset_id).collect();
    }
    let mut scope = Vec::with_capacity(chosen.len());
    for item in chosen {
        let map = match item {
            TimelineItem::Video(v) => &v.time_map,
            TimelineItem::Audio(a) => &a.time_map,
            _ => unreachable!("只取视频与音频"),
        };
        let TimeMap::Linear { source_in, rate } = map else {
            return Err(
                ErrorBody::invalid_operation(msg!(
                    "engine.cutScopeNotLinear",
                    "Clips in a cut set must use a linear source clock (held frames cannot follow cuts)"
                ))
                    .entities([item.base().id.clone()])
                    .details(json!({ "rule": "time-map" })),
            );
        };
        if rate.ratio() <= Ratio::ZERO {
            return Err(ErrorBody::invalid_operation(msg!("engine.cutScopeNotPositiveRate", "Clips in a cut set must have a positive rate"))
                .entities([item.base().id.clone()])
                .details(json!({ "rule": "time-map" })));
        }
        let (start, end) = item_range(item, fps)?;
        scope.push(Scoped {
            id: item.base().id.clone(),
            track_id: item.base().track_id.clone(),
            start,
            end,
            source_in: source_in.to_ratio("sourceIn")?,
            rate: rate.ratio(),
        });
    }
    scope.sort_by(|a, b| a.start.cmp(&b.start).then_with(|| a.id.cmp(&b.id)));
    Ok(scope)
}

/// 重排之后的 `scopeItemIds`：原来的实例里还在的，加上这笔操作里新出现的、播放这个素材的实例（拆出来的右半），按起点排。
fn rewrite_scope(
    state: &VideoState,
    sequence_id: &str,
    fps: Rate,
    asset_id: &str,
    scope: &[Scoped],
    before: &HashSet<Id>,
) -> EngineResult<Vec<Id>> {
    let kept: HashSet<&str> = scope.iter().map(|s| s.id.as_str()).collect();
    let mut ids: Vec<(Ratio, Id)> = Vec::new();
    for item in asset_items(state, sequence_id, asset_id) {
        let id = &item.base().id;
        if kept.contains(id.as_str()) || !before.contains(id) {
            ids.push((item_range(item, fps)?.0, id.clone()));
        }
    }
    ids.sort();
    Ok(ids.into_iter().map(|(_, id)| id).collect())
}

fn sequence_item_ids(state: &VideoState, sequence_id: &str) -> HashSet<Id> {
    state
        .items
        .iter()
        .filter(|(_, p)| p.sequence_id == sequence_id)
        .map(|(id, _)| id.clone())
        .collect()
}

/// 源区间的并集减去另一个并集：这次新删掉的源区间。
fn newly_removed(after: &[ExactCut], before: &[(Ratio, Ratio)]) -> Vec<(Ratio, Ratio)> {
    let mut out = Vec::new();
    for cut in after {
        let mut pieces = vec![(cut.t0, cut.t1)];
        for &(b0, b1) in before {
            pieces = pieces
                .into_iter()
                .flat_map(|(a0, a1)| {
                    if b1 <= a0 || b0 >= a1 {
                        return vec![(a0, a1)];
                    }
                    let mut rest = Vec::new();
                    if b0 > a0 {
                        rest.push((a0, b0));
                    }
                    if b1 < a1 {
                        rest.push((b1, a1));
                    }
                    rest
                })
                .collect();
        }
        out.extend(pieces);
    }
    out
}

/// 一段要波纹删除的序列区间与产生它的轨道。
struct Removal {
    f0: i64,
    f1: i64,
    tracks: BTreeSet<Id>,
}

/// 新删掉的源区间经每个实例映射到序列上（量化到最近的帧）。同一轨道上重叠的并起来；不同轨道上的区间要么完全相同
/// （同步放置的音画），要么互不相交，部分重叠时整笔拒绝。
fn removals(scope: &[Scoped], regions: &[(Ratio, Ratio)], fps: Rate) -> EngineResult<Vec<Removal>> {
    let mut per_track: BTreeMap<Id, Vec<(i64, i64)>> = BTreeMap::new();
    for item in scope {
        let out = item.source_out()?;
        for &(c0, c1) in regions {
            let (s0, s1) = (c0.max(item.source_in), c1.min(out));
            if s1 <= s0 {
                continue;
            }
            let f0 = quantize_frame(item.at_source(s0)?, fps, FrameAlignment::NearestFrame, "t0")?;
            let f1 = quantize_frame(item.at_source(s1)?, fps, FrameAlignment::NearestFrame, "t1")?;
            if f1 > f0 {
                per_track.entry(item.track_id.clone()).or_default().push((f0, f1));
            }
        }
    }
    let mut by_range: BTreeMap<(i64, i64), BTreeSet<Id>> = BTreeMap::new();
    for (track, mut ranges) in per_track {
        ranges.sort();
        let mut merged: Vec<(i64, i64)> = Vec::new();
        for (f0, f1) in ranges {
            match merged.last_mut() {
                Some(last) if f0 < last.1 => last.1 = last.1.max(f1),
                _ => merged.push((f0, f1)),
            }
        }
        for range in merged {
            by_range.entry(range).or_default().insert(track.clone());
        }
    }
    let out: Vec<Removal> = by_range.into_iter().map(|((f0, f1), tracks)| Removal { f0, f1, tracks }).collect();
    if let Some(pair) = out.windows(2).find(|w| w[1].f0 < w[0].f1) {
        let tracks: Vec<&Id> = pair[0].tracks.iter().chain(&pair[1].tracks).collect();
        return Err(
            ErrorBody::invalid_operation(msg!(
                "engine.cutScopeOverlap",
                "Clips in the cut set are not aligned across tracks: one cut maps to partly overlapping ranges on the sequence"
            )).details(
                json!({ "rule": "scope-misaligned", "trackIds": tracks, "frames": [[pair[0].f0, pair[0].f1], [pair[1].f0, pair[1].f1]] }),
            ),
        );
    }
    Ok(out)
}

fn frames(value: i64) -> TimelineTimeInput {
    TimelineTimeInput::Frames { value }
}

/// 在源素材的剪口集合里加入剪口并重排实例（§6.7）。
pub(crate) fn add_cuts(
    state: &mut VideoState,
    sequence_id: Option<&str>,
    asset_id: &str,
    inputs: &[CutInput],
    ctx: &mut EditContext<'_>,
) -> EngineResult<()> {
    if inputs.is_empty() {
        return Err(ErrorBody::invalid_operation(msg!("engine.addCutsEmpty", "addCuts needs at least one cut")));
    }
    let mut ranges = Vec::with_capacity(inputs.len());
    for input in inputs {
        // 十进制秒按最短的写法读成精确有理数（§6.7）。
        let t0 = editor_semantics::parse_decimal_seconds(&input.from, "from")?;
        let t1 = editor_semantics::parse_decimal_seconds(&input.to, "to")?;
        ranges.push(CutRange {
            t0,
            t1,
            reference: input.reference.clone(),
        });
    }
    add_cut_ranges(state, sequence_id, asset_id, &ranges, ctx)
}

/// 精确时刻的一个待加的剪口：源素材时钟上的 `[t0, t1)`（秒），`reference` 是出处。
#[derive(Clone, Debug)]
pub(crate) struct CutRange {
    pub t0: Ratio,
    pub t1: Ratio,
    pub reference: Option<Id>,
}

/// [`add_cuts`] 的本体：区间已经是精确有理数（接受剪辑建议时按刻度直接换算，不经十进制秒）。
pub(crate) fn add_cut_ranges(
    state: &mut VideoState,
    sequence_id: Option<&str>,
    asset_id: &str,
    ranges: &[CutRange],
    ctx: &mut EditContext<'_>,
) -> EngineResult<()> {
    let (sequence_id, fps, _) = require_sequence(state, sequence_id)?;
    let sequence_id = sequence_id.to_string();
    let duration = source_duration(state, asset_id)?;
    let mut loaded = load(state, ctx, asset_id)?;
    let before: Vec<(Ratio, Ratio)> = loaded.cuts.iter().map(|c| (c.t0, c.t1)).collect();
    for range in ranges {
        let (t0, t1) = (range.t0, range.t1);
        if t0.is_negative() || t1 <= t0 || t1 > duration {
            return Err(ErrorBody::invalid_operation(msg!("engine.cutRangeInvalid", "A cut must satisfy 0 ≤ from < to ≤ the asset duration"))
                .entities([asset_id])
                .details(json!({ "from": t0.to_f64().to_string(), "to": t1.to_f64().to_string() })));
        }
        insert_exact(
            &mut loaded.cuts,
            ExactCut {
                id: new_id("cut"),
                t0,
                t1,
                reference: range.reference.clone(),
            },
        );
    }
    check_structure(&loaded.cuts, duration)?;
    let scope = scope_of(state, &sequence_id, fps, asset_id, &loaded.scope)?;
    if scope.is_empty() {
        return Err(ErrorBody::invalid_operation(msg!(
            "engine.cutNoScope",
            "No clip on the sequence plays this asset, so there is nothing to cut"
        )).entities([asset_id]));
    }
    let existing = sequence_item_ids(state, &sequence_id);
    let regions = newly_removed(&loaded.cuts, &before);
    // 从后往前删：前面的区间位置不受后面的影响。
    for removal in removals(&scope, &regions, fps)?.iter().rev() {
        let tracks: Vec<Id> = removal.tracks.iter().cloned().collect();
        remove_range(
            state,
            Some(&sequence_id),
            &frames(removal.f0),
            &frames(removal.f1),
            &tracks,
            FrameAlignment::ExactFrame,
            ctx,
        )?;
        follow_removal(state, &sequence_id, removal, fps, ctx)?;
    }
    let now = sequence_item_ids(state, &sequence_id);
    let mut removed: Vec<Id> = existing.difference(&now).cloned().collect();
    removed.sort();
    for id in removed {
        if !ctx.cut_impact.removed.contains(&id) {
            ctx.cut_impact.removed.push(id);
        }
    }
    loaded.scope = rewrite_scope(state, &sequence_id, fps, asset_id, &scope, &existing)?;
    write(state, ctx, asset_id, &loaded)
}

/// 被剪轨道之外、`follow-cuts` 的实例跟着一段波纹删除走（§3.16）：之后的前移；起点落进去的推到区间终点（带源时钟的
/// 源起点同步后移）再前移；终点落进去的拉回区间起点；跨过的只缩短；整个落在里面的删掉。
fn follow_removal(state: &mut VideoState, sequence_id: &str, removal: &Removal, fps: Rate, ctx: &mut EditContext<'_>) -> EngineResult<()> {
    let t0 = frame_time(removal.f0 as i128, fps).ok_or_else(overflow)?;
    let t1 = frame_time(removal.f1 as i128, fps).ok_or_else(overflow)?;
    let length = t1.checked_sub(t0).ok_or_else(overflow)?;
    let count = removal.f1 - removal.f0;
    let mut todo: Vec<(Ratio, Ratio, Id)> = Vec::new();
    for (id, placed) in &state.items {
        let base = placed.value.base();
        if placed.sequence_id != sequence_id || removal.tracks.contains(&base.track_id) || base.follow_policy != FollowPolicy::FollowCuts {
            continue;
        }
        let (a, b) = item_range(&placed.value, fps)?;
        if b > t0 {
            ensure_editable(state, &placed.value)?;
            todo.push((a, b, id.clone()));
        }
    }
    todo.sort_by(|x, y| x.0.cmp(&y.0).then_with(|| x.2.cmp(&y.2)));
    let seq = Some(sequence_id);
    let mut deleted = Vec::new();
    for (a, b, id) in todo {
        if a >= t1 {
            shift_earlier(state, &id, length, count, fps)?;
        } else if a >= t0 && b <= t1 {
            deleted.push(id);
        } else if a < t0 && b <= t1 {
            trim_item(state, seq, &id, Edge::End, &frames(removal.f0), FrameAlignment::ExactFrame, ctx)?;
        } else if a >= t0 {
            trim_item(state, seq, &id, Edge::Start, &frames(removal.f1), FrameAlignment::ExactFrame, ctx)?;
            shift_earlier(state, &id, length, count, fps)?;
        } else {
            resize_end(state, &id, negate(length)?, -count, fps)?;
        }
    }
    if !deleted.is_empty() {
        delete_items(state, seq, &deleted)?;
    }
    Ok(())
}

pub(crate) fn negate(value: Ratio) -> EngineResult<Ratio> {
    Ratio::ZERO.checked_sub(value).ok_or_else(overflow)
}

/// 只改终点：长度加 `delta`（帧网格上的实例加 `delta_frames` 帧，音频按精确时间），关键帧按起点不动的窗口换算（§3.15）。
pub(crate) fn resize_end(state: &mut VideoState, item_id: &str, delta: Ratio, delta_frames: i64, fps: Rate) -> EngineResult<()> {
    let placed = state.items.get_mut(item_id).ok_or_else(|| ErrorBody::not_found(kinds::item(), item_id))?;
    let (start, old_end) = item_range(&placed.value, fps)?;
    match &mut placed.value {
        TimelineItem::Audio(audio) => {
            let length = audio
                .play_duration
                .to_ratio("playDuration")?
                .checked_add(delta)
                .ok_or_else(overflow)?;
            audio.play_duration = editor_semantics::MediaTime::from_ratio(length, "playDuration")?;
        }
        other => other.span_mut().expect("音频之外的实例都在帧网格上").duration_frames += delta_frames,
    }
    let new_end = item_range(&state.items[item_id].value, fps)?.1;
    if new_end <= start {
        return Err(ErrorBody::range_collapsed(item_id, msg!("engine.cutCollapsesItem", "The clip has zero length after following the cuts")));
    }
    let window = Rewindow::trim(seconds_between(start, old_end), 0.0, seconds_between(start, new_end));
    crate::item_keyframes::rewindow_item(state, item_id, window, fps)
}

/// 恢复剪口的一处接缝：左边实例的源终点对着剪口起点、右边实例的源起点对着剪口终点；只有一边时在实例首尾放回。
enum Seam {
    Both { left: Id, right: Id },
    Tail { left: Id },
    Head { right: Id },
}

/// 序列上的一处插回：在 `frame` 处放回 `frames` 帧，`tracks` 是接缝所在的轨道。
struct Insertion {
    frame: i64,
    frames: i64,
    tracks: BTreeSet<Id>,
    seams: Vec<Seam>,
}

/// 找恢复的剪口在各个实例上的接缝。源时刻与剪口边界相差不超过一帧（换到源时钟上）时算对上：剪口映射到序列时量化过。
/// 接缝要落在帧网格上；放回的长度按源区间除以速率、量化到最近的帧。
fn insertions(scope: &[Scoped], cut: &ExactCut, fps: Rate) -> EngineResult<Vec<Insertion>> {
    let frame = fps.frame_duration();
    let near = |a: Ratio, b: Ratio, rate: Ratio| -> EngineResult<bool> {
        let diff = a.checked_sub(b).ok_or_else(overflow)?;
        let diff = if diff.is_negative() { negate(diff)? } else { diff };
        Ok(diff <= frame.checked_mul(rate).ok_or_else(overflow)?)
    };
    let on_grid = |t: Ratio| {
        editor_semantics::frames_at(t, fps)
            .filter(|x| x.is_integer())
            .map(|x| x.floor() as i64)
    };
    let span_frames = |source: Ratio, rate: Ratio, alignment: FrameAlignment| -> EngineResult<i64> {
        let seconds = source.checked_div(rate).ok_or_else(overflow)?;
        Ok(quantize_frame(seconds, fps, alignment, "length")?)
    };
    let mut found: Vec<(i64, i64, Id, Seam)> = Vec::new();
    let mut paired: HashSet<&str> = HashSet::new();
    for left in scope {
        let out = left.source_out()?;
        if !near(out, cut.t0, left.rate)? {
            continue;
        }
        let Some(at) = on_grid(left.end) else { continue };
        let right = scope
            .iter()
            .find(|r| r.track_id == left.track_id && r.start == left.end && r.rate == left.rate)
            .filter(|r| near(r.source_in, cut.t1, r.rate).unwrap_or(false));
        match right {
            Some(right) => {
                paired.insert(right.id.as_str());
                let count = span_frames(
                    right.source_in.checked_sub(out).ok_or_else(overflow)?,
                    left.rate,
                    FrameAlignment::NearestFrame,
                )?;
                found.push((
                    at,
                    count,
                    left.track_id.clone(),
                    Seam::Both {
                        left: left.id.clone(),
                        right: right.id.clone(),
                    },
                ));
            }
            None => {
                let count = span_frames(cut.t1.checked_sub(out).ok_or_else(overflow)?, left.rate, FrameAlignment::FloorFrame)?;
                found.push((at, count, left.track_id.clone(), Seam::Tail { left: left.id.clone() }));
            }
        }
    }
    for right in scope {
        if paired.contains(right.id.as_str()) || !near(right.source_in, cut.t1, right.rate)? {
            continue;
        }
        let Some(at) = on_grid(right.start) else { continue };
        let count = span_frames(
            right.source_in.checked_sub(cut.t0).ok_or_else(overflow)?,
            right.rate,
            FrameAlignment::FloorFrame,
        )?;
        found.push((at, count, right.track_id.clone(), Seam::Head { right: right.id.clone() }));
    }
    let mut by_frame: BTreeMap<i64, Insertion> = BTreeMap::new();
    for (at, count, track, seam) in found {
        if count <= 0 {
            continue;
        }
        let entry = by_frame.entry(at).or_insert_with(|| Insertion {
            frame: at,
            frames: count,
            tracks: BTreeSet::new(),
            seams: Vec::new(),
        });
        if entry.frames != count {
            return Err(
                ErrorBody::invalid_operation(msg!(
                    "engine.cutScopeSeamMismatch",
                    "Clips in the cut set are not aligned across tracks: the same seam restores different lengths"
                ))
                    .details(json!({ "rule": "scope-misaligned", "frame": at, "frames": [entry.frames, count] })),
            );
        }
        entry.tracks.insert(track);
        entry.seams.push(seam);
    }
    Ok(by_frame.into_values().collect())
}

/// 恢复一个剪口（§6.7）：从剪口集合里去掉它，在每处接缝放回它删掉的源区间，之后的内容后移。找不到接缝时只改剪口集合，
/// 剪口列在回执的 `impact.cutsNotRelaid`。
pub(crate) fn restore_cut(
    state: &mut VideoState,
    sequence_id: Option<&str>,
    asset_id: &str,
    cut_id: &str,
    ctx: &mut EditContext<'_>,
) -> EngineResult<()> {
    let (sequence_id, fps, _) = require_sequence(state, sequence_id)?;
    let sequence_id = sequence_id.to_string();
    let duration = source_duration(state, asset_id)?;
    let mut loaded = load(state, ctx, asset_id)?;
    if loaded.document_id.is_none() {
        return Err(ErrorBody::not_found(kinds::cut_set(), asset_id));
    }
    let mut remaining = projected(&loaded.cuts);
    if !timeline::cuts::restore_cut(&mut remaining, cut_id) {
        return Err(ErrorBody::not_found(kinds::cut(), cut_id));
    }
    let index = loaded.cuts.iter().position(|c| c.id == cut_id).expect("刚找到");
    let cut = loaded.cuts.remove(index);
    check_structure(&loaded.cuts, duration)?;
    let scope = scope_of(state, &sequence_id, fps, asset_id, &loaded.scope)?;
    let existing = sequence_item_ids(state, &sequence_id);
    let plan = insertions(&scope, &cut, fps)?;
    if plan.is_empty() {
        ctx.cut_impact.not_relaid.push(cut.id.clone());
    }
    let seq = Some(sequence_id.as_str());
    let exact = FrameAlignment::ExactFrame;
    // 从后往前插：前面的接缝位置不受后面的影响。
    for insertion in plan.iter().rev() {
        insert_gap(state, &sequence_id, insertion, fps)?;
        let (at, count) = (insertion.frame, insertion.frames);
        for seam in &insertion.seams {
            match seam {
                Seam::Both { left, right } => {
                    trim_item(state, seq, left, Edge::End, &frames(at + count), exact, ctx)?;
                    // 两段接回原来的一段；字段已经不一致（之后单独改过）时留成两段。
                    let pair = [left.clone(), right.clone()];
                    let _ = join_items(state, seq, &pair, None);
                }
                Seam::Tail { left } => trim_item(state, seq, left, Edge::End, &frames(at + count), exact, ctx)?,
                Seam::Head { right } => trim_item(state, seq, right, Edge::Start, &frames(at), exact, ctx)?,
            }
        }
    }
    loaded.scope = rewrite_scope(state, &sequence_id, fps, asset_id, &scope, &existing)?;
    write(state, ctx, asset_id, &loaded)
}

/// 在序列的 `frame` 处放回 `frames` 帧：接缝所在的轨道上从这里开始的实例都后移；其余轨道上 `follow-cuts` 的实例按
/// 恢复之后的时间线移动（§3.16）：从这里开始的后移，跨过这一点的延长（带源时钟的不超出素材），终点正好在这里的不动。
fn insert_gap(state: &mut VideoState, sequence_id: &str, insertion: &Insertion, fps: Rate) -> EngineResult<()> {
    let at = frame_time(insertion.frame as i128, fps).ok_or_else(overflow)?;
    let length = frame_time(insertion.frames as i128, fps).ok_or_else(overflow)?;
    let back = negate(length)?;
    let mut shift = Vec::new();
    let mut extend = Vec::new();
    for (id, placed) in &state.items {
        let base = placed.value.base();
        if placed.sequence_id != sequence_id {
            continue;
        }
        let on_seam = insertion.tracks.contains(&base.track_id);
        if !on_seam && base.follow_policy != FollowPolicy::FollowCuts {
            continue;
        }
        let (a, b) = item_range(&placed.value, fps)?;
        if a >= at {
            ensure_editable(state, &placed.value)?;
            shift.push(id.clone());
        } else if !on_seam && b > at {
            ensure_editable(state, &placed.value)?;
            extend.push(id.clone());
        }
    }
    for id in shift {
        shift_earlier(state, &id, back, -insertion.frames, fps)?;
    }
    for id in extend {
        let (delta, count) = extension(state, &id, length, insertion.frames, fps)?;
        if count > 0 || delta > Ratio::ZERO {
            resize_end(state, &id, delta, count, fps)?;
        }
    }
    Ok(())
}

/// 跨过插回点的实例能延长多少：带源时钟的不超出素材（帧网格上的取整帧），其余照放回的长度。
pub(crate) fn extension(state: &VideoState, item_id: &str, length: Ratio, count: i64, fps: Rate) -> EngineResult<(Ratio, i64)> {
    let item = &state.items[item_id].value;
    let (start, end) = item_range(item, fps)?;
    let (map, asset_ref) = match item {
        TimelineItem::Video(v) => (Some(&v.time_map), Some(&v.asset_ref)),
        TimelineItem::Audio(a) => (Some(&a.time_map), Some(&a.asset_ref)),
        TimelineItem::Composition(c) => (Some(&c.time_map), c.prerender.as_ref()),
        _ => (None, None),
    };
    let (Some(TimeMap::Linear { source_in, rate }), Some(asset_ref)) = (map, asset_ref) else {
        return Ok((length, count));
    };
    let duration = state
        .assets
        .get(&asset_ref.id)
        .and_then(|a| a.revisions.get(&asset_ref.revision))
        .and_then(|r| r.duration.as_ref());
    let Some(duration) = duration else {
        return Ok((length, count));
    };
    let played = end
        .checked_sub(start)
        .ok_or_else(overflow)?
        .checked_mul(rate.ratio())
        .ok_or_else(overflow)?;
    let source_out = source_in.to_ratio("sourceIn")?.checked_add(played).ok_or_else(overflow)?;
    let left = duration.to_ratio("duration")?.checked_sub(source_out).ok_or_else(overflow)?;
    let room = left.checked_div(rate.ratio()).ok_or_else(overflow)?;
    if room >= length {
        return Ok((length, count));
    }
    if room <= Ratio::ZERO {
        return Ok((Ratio::ZERO, 0));
    }
    if matches!(item, TimelineItem::Audio(_)) {
        return Ok((room, 0));
    }
    let whole = quantize_frame(room, fps, FrameAlignment::FloorFrame, "length")?;
    Ok((frame_time(whole as i128, fps).ok_or_else(overflow)?, whole))
}
