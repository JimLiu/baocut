//! 跟随：片段与剪口改了时钟之后，元素怎么跟（BCF §19.1「跟随」，剪辑工具缺口方案 §2.1）。
//!
//! `clips[]` 加 `sources.<id>.cuts` 是时钟的唯一真相，画面与声音只在元素上。每一项改时钟的
//! 写入（剪口增删、片段增删 / 分割 / 挪动 / 修剪 / 倍速）在同一写事务里调用 [`follow_clock`]：
//! 入参是**这一项之前**的文档（只用它的时钟）与已经改好片段 / 剪口、元素还没动的文档。
//!
//! 四条规则：
//!
//! 1. **哪些元素算「片段的画面」**：在操作前的文档里，`kind:"video"`、角色不是 broll /
//!    watermark、不在音频轨上，`srcId` 与某个片段相同，并且时间区间落在该片段投影出的某一段
//!    之内、`srcStart` 与这一段在同一时刻对得上、`rate` 与片段相同（逐段判，容差
//!    [`COMPOSE_EPS`]）。挪开过（源时刻对不上）或拉长过（超出这一段）的不算。只在分离文档上认领。
//!    补一档**陈旧画面**：旧版本在分离文档上剪口时画面不跟，留下的画面对不上折叠后的任何
//!    一段，却按同样的判据对得上片段**不计剪口**的时钟（清掉全部剪口后的投影），并且这个片段
//!    一件跟得上的画面都没有——这样的也归这个片段（[`stale_pictures`]）。它们按源区间走规则 2，
//!    等于先补放了历史剪口；不改时钟的写入不碰它们。
//! 2. **操作之后画面怎么办**：对操作后每一段投影（片段 c，源区间 `[a, b)`），取归属于 c 的
//!    画面（分割出的右片段沿用母片段）、按源时间排序、各自收到交集上；**这次操作才变得可见**的
//!    源区间（恢复剪口、修剪外扩）由前一件延长补上，段首由后一件向前补，隔着旧空当时照邻件
//!    复制一件；操作前就可见却没有画面的源区间（用户删过 / 缩过）不补；不自动合并相邻两件。
//!    同一件被分到多段时源时间最靠前的一份保留原 id。整件落在被去掉范围里的删除。新加的片段按
//!    分离的缺省新建；原本就没有画面的片段不补。
//! 3. **其它按数字时间放的元素**：起止各自按「操作前成片时刻 → 片段与源时刻 → 操作后成片时刻」
//!    换算；落在被去掉的范围里时起点推到后面第一个保留时刻、终点退到前面最后一个保留时刻，
//!    终点不大于起点的删除；自带源的（`video` / `audio`）起点被推后时 `srcStart` 按操作前
//!    时钟上的推后量同步前移；跨剪口的只缩短不挖洞；超出片尾的保持到片尾的距离。挪片段时只有
//!    起止都落在同一个片段里的元素跟着片段走；分割不改时钟，切开压在分割点上的元素。
//! 4. 词锚点（`~词`）与不设终点的元素不动。
use std::collections::{BTreeMap, HashMap, HashSet};

use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

use crate::arrange::{ClipProjection, TimelineProjection};
use crate::keyframes::{Rewindow, rewindow};
use crate::schema::{
    Cut, Element, ElementKind, ElementRole, TimeValue, TimelineDocument, TimelineError,
};
use crate::schema::{Track, TrackKind};
use crate::video_elements::default_picture_element;

/// 画面认领与接缝判等的容差：内核按秒写 `segments`，元素 `start/end/srcStart` 从同一组数
/// 序列化而来，1ms 足够吸收浮点抖动，又远小于任何真实剪缝（剪口模式最短 40ms）。编辑器的
/// 碎片归组（`bcut-editor-core` 的 `compose_assignments`）引用同一个常量。
pub const COMPOSE_EPS: f64 = 1e-3;

const RATE_EPS: f64 = 1e-6;
const TINY: f64 = 1e-9;

/// 这一项写入对时钟做了什么。
#[derive(Debug, Clone, PartialEq)]
pub enum ClockEdit {
    /// 改时钟长度：剪口增删、片段增删、修剪、倍速。
    Retime,
    /// 分割：不改时钟。`right` 是新片段，画面沿用 `left`；`at` 是分割点（成片时刻）。
    Split {
        left: String,
        right: String,
        at: f64,
    },
    /// 只改片段顺序。
    Move,
}

/// 跟随新建的一件元素。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FollowCreated {
    pub id: String,
    /// 从哪件元素分出 / 照哪件复制；按缺省新建的片段画面没有来源。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    /// 片段画面所属的片段；其它元素为空。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub clip_id: Option<String>,
}

/// 跟随的结果：删了哪些、新建了哪些（及来源）、哪些保留原 id 但改了时间。
///
/// 序列化形状（命令行回执与 `EditApplied` 的 `follow`）：
/// `{"removed":[id…],"created":[{"id","from"?,"clipId"?}…],"retimed":N}`。
#[derive(Debug, Clone, Default, PartialEq)]
pub struct FollowReport {
    pub removed: Vec<String>,
    pub created: Vec<FollowCreated>,
    pub retimed: Vec<String>,
}

impl Serialize for FollowReport {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut state = serializer.serialize_struct("FollowReport", 3)?;
        state.serialize_field("removed", &self.removed)?;
        state.serialize_field("created", &self.created)?;
        state.serialize_field("retimed", &self.retimed.len())?;
        state.end()
    }
}

impl FollowReport {
    pub fn is_empty(&self) -> bool {
        self.removed.is_empty() && self.created.is_empty() && self.retimed.is_empty()
    }

    /// 同一写事务里的下一项。前面新建、后面删掉的只是没出现过；前面改时间、后面删掉的记删除。
    pub fn merge(&mut self, next: FollowReport) {
        for id in next.removed {
            if let Some(index) = self.created.iter().position(|created| created.id == id) {
                self.created.remove(index);
                continue;
            }
            self.retimed.retain(|retimed| retimed != &id);
            if !self.removed.contains(&id) {
                self.removed.push(id);
            }
        }
        for created in next.created {
            if !self.created.iter().any(|known| known.id == created.id) {
                self.created.push(created);
            }
        }
        for id in next.retimed {
            if !self.created.iter().any(|created| created.id == id) && !self.retimed.contains(&id) {
                self.retimed.push(id);
            }
        }
    }
}

/// 只留时钟（源、剪口、片段、`main`）的副本，给 [`follow_clock`] 当「操作前」。
pub fn clock_snapshot(document: &TimelineDocument) -> TimelineDocument {
    TimelineDocument {
        version: document.version.clone(),
        sources: document.sources.clone(),
        clips: document.clips.clone(),
        tracks: Vec::new(),
        main: document.main.clone(),
        template: None,
    }
}

/// 两份文档的时钟是否相同（片段与各源剪口）。登记一个新源、或补出一个空的 `main` 源
/// 不改时钟：缺席的源与没有剪口的源等价。
pub fn same_clock(a: &TimelineDocument, b: &TimelineDocument) -> bool {
    fn cuts_of<'a>(document: &'a TimelineDocument, id: &str) -> &'a [Cut] {
        document
            .sources
            .get(id)
            .map_or(&[][..], |source| source.cuts.as_slice())
    }
    a.clips == b.clips
        && a.sources
            .keys()
            .chain(b.sources.keys())
            .all(|id| cuts_of(a, id) == cuts_of(b, id))
}

/// 让元素跟随这一项对时钟的修改。
///
/// - `before`：这一项之前的文档，只读它的时钟（[`clock_snapshot`] 即可）。
/// - `document`：片段 / 剪口已改好、元素还是操作前的文档；跟随就地改它的轨与元素。
/// - `durations`：各源时长（同 [`TimelineProjection::build`]）。
/// - `widths`：新片段按分离缺省新建画面时的 `place.w`（按源，缺省 100）。
/// - `next_id`：新元素 id。
pub fn follow_clock(
    before: &TimelineDocument,
    document: &mut TimelineDocument,
    durations: &BTreeMap<String, f64>,
    widths: &BTreeMap<String, f64>,
    edit: &ClockEdit,
    next_id: &mut dyn FnMut() -> String,
) -> Result<FollowReport, TimelineError> {
    let pre = TimelineProjection::build(before, durations)?;
    let post = TimelineProjection::build(document, durations)?;
    let mut report = FollowReport::default();
    let originally_empty: HashSet<String> = document
        .tracks
        .iter()
        .filter(|track| track.elements.is_empty())
        .map(|track| track.id.clone())
        .collect();

    // 1–2. 片段的画面（只在分离文档上）。
    let mut pictures: HashSet<String> = HashSet::new();
    if document.is_detached() && (!pre.clips().is_empty() || !post.clips().is_empty()) {
        let unfolded = unfolded_projection(before, durations);
        follow_pictures(
            &pre,
            unfolded.as_ref(),
            &post,
            document,
            widths,
            edit,
            next_id,
            &mut pictures,
            &mut report,
        );
    }

    // 3. 其它按数字时间放的元素。
    if !pre.clips().is_empty() {
        match edit {
            ClockEdit::Retime => retime_elements(&pre, &post, document, &pictures, &mut report),
            ClockEdit::Move => move_elements(&pre, &post, document, &pictures, &mut report),
            ClockEdit::Split { at, .. } => {
                for (id, from) in split_elements(document, *at, next_id, &pictures) {
                    if !report.retimed.contains(&from) {
                        report.retimed.push(from.clone());
                    }
                    report.created.push(FollowCreated {
                        id,
                        from: Some(from),
                        clip_id: None,
                    });
                }
            }
        }
    }

    // 被闪避引用的轨即使跟随后空了也留着：`duck.under` 不能指向不存在的轨。
    let ducked: HashSet<String> = document
        .tracks
        .iter()
        .flat_map(|track| &track.elements)
        .filter_map(|element| element.duck.as_ref())
        .map(|duck| duck.under.clone())
        .collect();
    document.tracks.retain(|track| {
        !track.elements.is_empty()
            || originally_empty.contains(&track.id)
            || ducked.contains(&track.id)
    });
    Ok(report)
}

// ---------------------------------------------------------------------------
// 片段的画面
// ---------------------------------------------------------------------------

/// 规则 1 的公开形：每个片段名下的画面元素 id，按源时间排序（`clip list` 的 `elements`、
/// `element list` 的 `clipId` 与跟随共用这一个判据）。旧式文档（没有分离）恒为空表；
/// 没有画面的片段不出现在表里。
pub fn picture_assignments(
    document: &TimelineDocument,
    projection: &TimelineProjection,
) -> BTreeMap<String, Vec<String>> {
    let mut out: BTreeMap<String, Vec<String>> = BTreeMap::new();
    if !document.is_detached() {
        return out;
    }
    let mut claimed: Vec<(usize, f64, &str)> = claim_all(document, projection, None)
        .into_iter()
        .map(|claim| {
            let element = &document.tracks[claim.track].elements[claim.index];
            (
                claim.clip,
                element.src_start.unwrap_or(0.0),
                element.id.as_str(),
            )
        })
        .collect();
    claimed.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.total_cmp(&b.1)));
    for (clip, _, id) in claimed {
        out.entry(projection.clips()[clip].id.clone())
            .or_default()
            .push(id.to_owned());
    }
    out
}

/// 一件没跟上剪口的「陈旧画面」（规则 1 的补充）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StalePicture {
    pub element_id: String,
    pub clip_id: String,
}

/// 分离文档里认成陈旧画面的元素（`bcut check` 的 `picture-not-following-cuts` 用）。
/// 旧版本在分离文档上剪口时画面不跟，留下来的画面还对着片段不计剪口的位置；下一次改时钟的
/// 写入会把它们收到各段上（[`follow_clock`]），在那之前它们不进 [`picture_assignments`]。
pub fn stale_pictures(
    document: &TimelineDocument,
    projection: &TimelineProjection,
    durations: &BTreeMap<String, f64>,
) -> Vec<StalePicture> {
    if !document.is_detached() {
        return Vec::new();
    }
    let Some(unfolded) = unfolded_projection(document, durations) else {
        return Vec::new();
    };
    claim_all(document, projection, Some(&unfolded))
        .into_iter()
        .filter(|claim| claim.stale)
        .map(|claim| StalePicture {
            element_id: document.tracks[claim.track].elements[claim.index]
                .id
                .clone(),
            clip_id: projection.clips()[claim.clip].id.clone(),
        })
        .collect()
}

/// 不计剪口的时钟：清掉各源剪口之后的投影（片段顺序、下标与折叠后的投影一一对应）。
/// 文档里没有任何剪口时两者相同，返回 `None`。
fn unfolded_projection(
    document: &TimelineDocument,
    durations: &BTreeMap<String, f64>,
) -> Option<TimelineProjection> {
    if document
        .sources
        .values()
        .all(|source| source.cuts.is_empty())
    {
        return None;
    }
    let mut clock = clock_snapshot(document);
    for source in clock.sources.values_mut() {
        source.cuts.clear();
    }
    TimelineProjection::build(&clock, durations).ok()
}

/// 认领到的一件画面：第 `track` 条轨第 `index` 件，归属片段 `clip`（投影下标）。
struct Claim {
    track: usize,
    index: usize,
    clip: usize,
    stale: bool,
}

/// 规则 1 与它的补充。
///
/// - 跟得上的画面：对得上折叠后投影的某一段（[`claim_picture`]）。
/// - 陈旧画面（只在给了 `unfolded` 时判）：对不上折叠后的任何一段，却在片段**不计剪口**的
///   时钟上源同步（落在某一段之内、`srcStart` 对得上、倍速相同），并且这个片段一件跟得上的
///   画面都没有。旧版本剪口不带画面留下的就是这个形状；有意摆放的叠加视频起点不在片段未折叠
///   的位置上，片段自己的画面也还在，两条都挡住它。
fn claim_all(
    document: &TimelineDocument,
    folded: &TimelineProjection,
    unfolded: Option<&TimelineProjection>,
) -> Vec<Claim> {
    let folded_segments = pre_segments(folded);
    let mut claims = Vec::new();
    let mut unclaimed = Vec::new();
    for (track_index, track) in document.tracks.iter().enumerate() {
        if track.kind == TrackKind::Audio {
            continue;
        }
        for (index, element) in track.elements.iter().enumerate() {
            match claim_picture(element, &folded_segments, folded.clips()) {
                Some(clip) => claims.push(Claim {
                    track: track_index,
                    index,
                    clip,
                    stale: false,
                }),
                None => unclaimed.push((track_index, index)),
            }
        }
    }
    let Some(unfolded) = unfolded else {
        return claims;
    };
    let unfolded_segments = pre_segments(unfolded);
    let followed: HashSet<usize> = claims.iter().map(|claim| claim.clip).collect();
    for (track_index, index) in unclaimed {
        let element = &document.tracks[track_index].elements[index];
        if let Some(clip) = claim_picture(element, &unfolded_segments, unfolded.clips())
            && !followed.contains(&clip)
        {
            claims.push(Claim {
                track: track_index,
                index,
                clip,
                stale: true,
            });
        }
    }
    claims
}

/// 投影里的全部段，按成片时间排好（片段依次、段依次，本来就有序）。
fn pre_segments(projection: &TimelineProjection) -> Vec<PreSegment> {
    projection
        .clips()
        .iter()
        .enumerate()
        .flat_map(|(clip, projection)| {
            projection.segments.iter().map(move |segment| PreSegment {
                tl0: segment.timeline_start,
                tl1: segment.timeline_end,
                src0: segment.source_start,
                clip,
            })
        })
        .collect()
}

fn seconds(value: &Option<TimeValue>) -> Option<f64> {
    match value {
        Some(TimeValue::Seconds(value)) => Some(*value),
        _ => None,
    }
}

fn element_rate(element: &Element) -> f64 {
    element
        .rate
        .filter(|rate| rate.is_finite() && *rate > 0.0)
        .unwrap_or(1.0)
}

/// 操作前投影里的一段，按成片时间排好。
struct PreSegment {
    tl0: f64,
    tl1: f64,
    src0: f64,
    clip: usize,
}

/// 规则 1：这件元素算不算片段 `clip`（操作前投影里的下标）的画面。
fn claim_picture(
    element: &Element,
    segments: &[PreSegment],
    clips: &[ClipProjection],
) -> Option<usize> {
    if element.kind != ElementKind::Video
        || matches!(
            element.role,
            Some(ElementRole::Broll) | Some(ElementRole::Watermark)
        )
    {
        return None;
    }
    let start = seconds(&element.start)?;
    let end = seconds(&element.end)?;
    let src_id = element.src_id.as_deref()?;
    if !(end > start + TINY) {
        return None;
    }
    let middle = (start + end) / 2.0;
    let index = segments.partition_point(|segment| segment.tl1 <= middle);
    let segment = segments.get(index)?;
    let clip = &clips[segment.clip];
    let rate = element_rate(element);
    let aligned = clip.src_id == src_id
        && start >= segment.tl0 - COMPOSE_EPS
        && end <= segment.tl1 + COMPOSE_EPS
        && (rate - clip.rate).abs() <= RATE_EPS
        && (element.src_start.unwrap_or(0.0) - (segment.src0 + (start - segment.tl0) * clip.rate))
            .abs()
            <= COMPOSE_EPS;
    aligned.then_some(segment.clip)
}

struct Candidate {
    track: usize,
    index: usize,
    s0: f64,
    s1: f64,
    /// 操作前所属片段的倍速。
    rate: f64,
}

/// 操作后的一件画面：`candidate` 是保留的原件（`None` = 复制出来的补片），`template` 是
/// 属性来源（原件或被照着复制的那件）。
struct Piece {
    candidate: Option<usize>,
    template: usize,
    s0: f64,
    s1: f64,
    post_clip: usize,
    post_segment: usize,
}

#[allow(clippy::too_many_arguments)]
fn follow_pictures(
    pre: &TimelineProjection,
    unfolded: Option<&TimelineProjection>,
    post: &TimelineProjection,
    document: &mut TimelineDocument,
    widths: &BTreeMap<String, f64>,
    edit: &ClockEdit,
    next_id: &mut dyn FnMut() -> String,
    pictures: &mut HashSet<String>,
    report: &mut FollowReport,
) {
    // 认领（跟得上的与陈旧的一视同仁：陈旧画面按源区间收到操作后的各段上，等于先补放了
    // 历史剪口）。两种投影的片段下标一一对应，倍速取折叠后的即可。
    let mut candidates: Vec<Candidate> = Vec::new();
    let mut by_clip: Vec<Vec<usize>> = vec![Vec::new(); pre.clips().len()];
    for claim in claim_all(document, pre, unfolded) {
        let element = &document.tracks[claim.track].elements[claim.index];
        let start = seconds(&element.start).unwrap_or(0.0);
        let end = seconds(&element.end).unwrap_or(start);
        let s0 = element.src_start.unwrap_or(0.0);
        by_clip[claim.clip].push(candidates.len());
        let rate = pre.clips()[claim.clip].rate;
        candidates.push(Candidate {
            track: claim.track,
            index: claim.index,
            s0,
            s1: s0 + (end - start) * rate,
            rate,
        });
    }
    for list in &mut by_clip {
        list.sort_by(|a, b| candidates[*a].s0.total_cmp(&candidates[*b].s0));
    }

    let pre_index: HashMap<&str, usize> = pre
        .clips()
        .iter()
        .enumerate()
        .map(|(index, clip)| (clip.id.as_str(), index))
        .collect();
    let lineage = |post_clip: &ClipProjection| -> Option<usize> {
        if let ClockEdit::Split { left, right, .. } = edit
            && &post_clip.id == right
        {
            return pre_index.get(left.as_str()).copied();
        }
        pre_index
            .get(post_clip.id.as_str())
            .copied()
            .filter(|index| pre.clips()[*index].src_id == post_clip.src_id)
    };

    let mut pieces: Vec<Piece> = Vec::new();
    let mut new_clips: Vec<usize> = Vec::new();
    for (post_clip_index, post_clip) in post.clips().iter().enumerate() {
        let Some(parent) = lineage(post_clip) else {
            new_clips.push(post_clip_index);
            continue;
        };
        let list = &by_clip[parent];
        if list.is_empty() {
            continue;
        }
        let segments = &post_clip.segments;
        let mut per_segment: Vec<Vec<usize>> = vec![Vec::new(); segments.len()];
        for &candidate_index in list {
            let candidate = &candidates[candidate_index];
            let lo = segments.partition_point(|segment| segment.source_end <= candidate.s0 + TINY);
            let hi = segments.partition_point(|segment| segment.source_start < candidate.s1 - TINY);
            for (segment_index, segment) in segments.iter().enumerate().take(hi).skip(lo) {
                let mut s0 = candidate.s0.max(segment.source_start);
                let mut s1 = candidate.s1.min(segment.source_end);
                if (s0 - segment.source_start).abs() <= COMPOSE_EPS {
                    s0 = segment.source_start;
                }
                if (s1 - segment.source_end).abs() <= COMPOSE_EPS {
                    s1 = segment.source_end;
                }
                if s1 - s0 <= COMPOSE_EPS {
                    continue;
                }
                per_segment[segment_index].push(pieces.len());
                pieces.push(Piece {
                    candidate: Some(candidate_index),
                    template: candidate_index,
                    s0,
                    s1,
                    post_clip: post_clip_index,
                    post_segment: segment_index,
                });
            }
        }
        let visible = &pre.clips()[parent].segments;
        for (segment_index, segment) in segments.iter().enumerate() {
            let mut order = std::mem::take(&mut per_segment[segment_index]);
            order.sort_by(|a, b| pieces[*a].s0.total_cmp(&pieces[*b].s0));
            let (a, b) = (segment.source_start, segment.source_end);
            let mut cursor = a;
            let mut cursor_piece: Option<usize> = None;
            let mut gaps: Vec<(f64, f64, Option<usize>, Option<usize>)> = Vec::new();
            for &piece_index in &order {
                let s0 = pieces[piece_index].s0;
                if s0 > cursor + COMPOSE_EPS {
                    gaps.push((cursor, s0, cursor_piece, Some(piece_index)));
                } else if s0 > cursor {
                    pieces[piece_index].s0 = cursor;
                }
                if pieces[piece_index].s1 > cursor {
                    cursor = pieces[piece_index].s1;
                    cursor_piece = Some(piece_index);
                }
            }
            if b > cursor + COMPOSE_EPS {
                gaps.push((cursor, b, cursor_piece, None));
            } else if b > cursor
                && let Some(piece_index) = cursor_piece
            {
                pieces[piece_index].s1 = b;
            }
            for (g0, g1, previous, following) in gaps {
                for (n0, n1) in newly_visible(g0, g1, visible) {
                    if let Some(previous) = previous
                        && (n0 - g0).abs() <= COMPOSE_EPS
                        && (pieces[previous].s1 - g0).abs() <= COMPOSE_EPS
                    {
                        pieces[previous].s1 = n1;
                    } else if let Some(following) = following
                        && (n1 - g1).abs() <= COMPOSE_EPS
                    {
                        pieces[following].s0 = n0;
                    } else {
                        let template = previous
                            .or(following)
                            .map(|piece| pieces[piece].template)
                            .unwrap_or_else(|| nearest(list, &candidates, n0, n1));
                        pieces.push(Piece {
                            candidate: None,
                            template,
                            s0: n0,
                            s1: n1,
                            post_clip: post_clip_index,
                            post_segment: segment_index,
                        });
                    }
                }
            }
        }
    }

    // 定 id：每件原件源时间最靠前的一份留原 id。
    let mut by_candidate: Vec<Vec<usize>> = vec![Vec::new(); candidates.len()];
    let mut clones: Vec<Vec<usize>> = vec![Vec::new(); candidates.len()];
    for (piece_index, piece) in pieces.iter().enumerate() {
        match piece.candidate {
            Some(candidate) => by_candidate[candidate].push(piece_index),
            None => clones[piece.template].push(piece_index),
        }
    }
    let mut order: Vec<usize> = (0..candidates.len()).collect();
    order.sort_by_key(|index| (candidates[*index].track, candidates[*index].index));
    let mut outputs: HashMap<(usize, usize), Vec<Element>> = HashMap::new();
    for candidate_index in order {
        let candidate = &candidates[candidate_index];
        let original = document.tracks[candidate.track].elements[candidate.index].clone();
        let mut own = std::mem::take(&mut by_candidate[candidate_index]);
        own.sort_by(|a, b| pieces[*a].s0.total_cmp(&pieces[*b].s0));
        let mut extra = std::mem::take(&mut clones[candidate_index]);
        extra.sort_by(|a, b| pieces[*a].s0.total_cmp(&pieces[*b].s0));
        let mut emitted = Vec::with_capacity(own.len() + extra.len());
        let divided = own.len() + extra.len() > 1;
        if own.is_empty() {
            report.removed.push(original.id.clone());
        }
        for (rank, piece_index) in own.iter().chain(extra.iter()).enumerate() {
            let piece = &pieces[*piece_index];
            let post_clip = &post.clips()[piece.post_clip];
            let template = &candidates[piece.template];
            let mut element = place_piece(&original, piece, post_clip, template, divided);
            if rank == 0 && piece.candidate.is_some() {
                if element != original {
                    report.retimed.push(element.id.clone());
                }
            } else {
                element.id = next_id();
                report.created.push(FollowCreated {
                    id: element.id.clone(),
                    from: Some(original.id.clone()),
                    clip_id: Some(post_clip.id.clone()),
                });
            }
            pictures.insert(element.id.clone());
            emitted.push(element);
        }
        outputs.insert((candidate.track, candidate.index), emitted);
    }
    let touched: HashSet<usize> = outputs.keys().map(|(track, _)| *track).collect();
    for (track_index, track) in document.tracks.iter_mut().enumerate() {
        if !touched.contains(&track_index) {
            continue;
        }
        let old = std::mem::take(&mut track.elements);
        for (index, element) in old.into_iter().enumerate() {
            match outputs.remove(&(track_index, index)) {
                Some(replacement) => track.elements.extend(replacement),
                None => track.elements.push(element),
            }
        }
    }

    // 新加的片段：按分离的缺省新建。
    if new_clips.is_empty() {
        return;
    }
    let target = candidates
        .first()
        .map(|candidate| candidate.track)
        .or_else(|| {
            document
                .tracks
                .iter()
                .position(|track| track.elements.iter().any(|el| pictures.contains(&el.id)))
        });
    let target = match target {
        Some(index) => index,
        None => {
            let used: HashSet<&str> = document
                .tracks
                .iter()
                .map(|track| track.id.as_str())
                .chain(document.clips.iter().map(|clip| clip.id.as_str()))
                .chain(document.sources.keys().map(String::as_str))
                .chain(
                    document
                        .tracks
                        .iter()
                        .flat_map(|track| track.elements.iter().map(|el| el.id.as_str())),
                )
                .collect();
            let mut id = "video-track".to_owned();
            let mut suffix = 2;
            while used.contains(id.as_str()) {
                id = format!("video-track-{suffix}");
                suffix += 1;
            }
            document.tracks.insert(
                0,
                Track {
                    id,
                    kind: TrackKind::Overlay,
                    name: None,
                    hidden: false,
                    locked: false,
                    muted: false,
                    elements: Vec::new(),
                },
            );
            0
        }
    };
    for post_clip_index in new_clips {
        let clip = &post.clips()[post_clip_index];
        let width = widths.get(&clip.src_id).copied().unwrap_or(100.0);
        for segment in &clip.segments {
            let id = next_id();
            let element = default_picture_element(
                &id,
                &clip.src_id,
                segment.source_start,
                segment.timeline_start,
                segment.timeline_end,
                clip.rate,
                width,
            );
            pictures.insert(id.clone());
            report.created.push(FollowCreated {
                id,
                from: None,
                clip_id: Some(clip.id.clone()),
            });
            document.tracks[target].elements.push(element);
        }
    }
}

/// `[g0, g1)` 里操作前不可见（不在 `visible` 的任何一段里）的部分。
fn newly_visible(g0: f64, g1: f64, visible: &[crate::arrange::ClipSegment]) -> Vec<(f64, f64)> {
    let mut out = Vec::new();
    let mut cursor = g0;
    let start = visible.partition_point(|segment| segment.source_end <= g0);
    for segment in &visible[start..] {
        if segment.source_start >= g1 {
            break;
        }
        if segment.source_start > cursor + COMPOSE_EPS {
            out.push((cursor, segment.source_start.min(g1)));
        }
        cursor = cursor.max(segment.source_end);
        if cursor >= g1 {
            break;
        }
    }
    if g1 > cursor + COMPOSE_EPS {
        out.push((cursor, g1));
    }
    out
}

fn nearest(list: &[usize], candidates: &[Candidate], n0: f64, n1: f64) -> usize {
    *list
        .iter()
        .min_by(|a, b| {
            let distance = |index: usize| {
                let candidate = &candidates[index];
                (candidate.s0 - n1).max(n0 - candidate.s1).max(0.0)
            };
            distance(**a).total_cmp(&distance(**b))
        })
        .expect("clip has candidates")
}

/// `template` 是这件画面照着的那件原件（关键帧按它的源区间换算），`divided` = 这件原件
/// 分成了不止一件。
fn place_piece(
    original: &Element,
    piece: &Piece,
    clip: &ClipProjection,
    template: &Candidate,
    divided: bool,
) -> Element {
    let segment = &clip.segments[piece.post_segment];
    let start = segment.timeline_start + (piece.s0 - segment.source_start) / clip.rate;
    let end = if (piece.s1 - segment.source_end).abs() <= TINY {
        segment.timeline_end
    } else {
        segment.timeline_start + (piece.s1 - segment.source_start) / clip.rate
    };
    let mut element = original.clone();
    element.start = Some(TimeValue::Seconds(start));
    element.end = Some(TimeValue::Seconds(end));
    element.src_start = Some(piece.s0);
    if element.rate.is_some() || (clip.rate - 1.0).abs() > f64::EPSILON {
        element.rate = Some(clip.rate);
    }
    if let Some(keyframes) = &original.keyframes {
        let rate = if template.rate > 0.0 {
            template.rate
        } else {
            1.0
        };
        element.keyframes = Some(rewindow(
            keyframes,
            Rewindow {
                old_duration: (template.s1 - template.s0) / rate,
                head: (piece.s0 - template.s0) / rate,
                new_duration: end - start,
                scale: if clip.rate > 0.0 {
                    rate / clip.rate
                } else {
                    1.0
                },
                divided,
            },
        ));
    }
    element
}

// ---------------------------------------------------------------------------
// 其它按数字时间放的元素
// ---------------------------------------------------------------------------

/// 操作前成片时间 `[p0, p1)` 线性对到操作后 `[q0, q1)`：同一片段、同一段源。
#[derive(Debug, Clone, Copy)]
struct MapPiece {
    p0: f64,
    p1: f64,
    q0: f64,
    q1: f64,
}

impl MapPiece {
    fn at(self, t: f64) -> f64 {
        if self.p1 - self.p0 <= TINY {
            return self.q0;
        }
        self.q0 + (t - self.p0) * (self.q1 - self.q0) / (self.p1 - self.p0)
    }
}

struct ClockMap {
    pieces: Vec<MapPiece>,
    pre_end: f64,
    post_end: f64,
}

impl ClockMap {
    fn build(pre: &TimelineProjection, post: &TimelineProjection) -> Self {
        let post_by_id: HashMap<&str, &ClipProjection> = post
            .clips()
            .iter()
            .map(|clip| (clip.id.as_str(), clip))
            .collect();
        let mut pieces = Vec::new();
        for before in pre.clips() {
            let Some(after) = post_by_id.get(before.id.as_str()) else {
                continue;
            };
            if after.src_id != before.src_id {
                continue;
            }
            let (mut i, mut j) = (0, 0);
            while i < before.segments.len() && j < after.segments.len() {
                let (a, b) = (&before.segments[i], &after.segments[j]);
                let s0 = a.source_start.max(b.source_start);
                let s1 = a.source_end.min(b.source_end);
                if s1 > s0 + TINY {
                    let p = |s: f64| a.timeline_start + (s - a.source_start) / before.rate;
                    let q = |s: f64| b.timeline_start + (s - b.source_start) / after.rate;
                    pieces.push(MapPiece {
                        p0: p(s0),
                        p1: if s1 == a.source_end {
                            a.timeline_end
                        } else {
                            p(s1)
                        },
                        q0: q(s0),
                        q1: if s1 == b.source_end {
                            b.timeline_end
                        } else {
                            q(s1)
                        },
                    });
                }
                if a.source_end <= b.source_end {
                    i += 1;
                } else {
                    j += 1;
                }
            }
        }
        pieces.sort_by(|a, b| a.p0.total_cmp(&b.p0));
        Self {
            pieces,
            pre_end: pre.duration(),
            post_end: post.duration(),
        }
    }

    /// 起点：落在被去掉的范围里推到后面第一个保留时刻。返回（操作后时刻，操作前时钟上的推后量）。
    fn start(&self, t: f64) -> (f64, f64) {
        let k = self.pieces.partition_point(|piece| piece.p1 <= t);
        match self.pieces.get(k) {
            Some(piece) if piece.p0 <= t => (piece.at(t), 0.0),
            Some(piece) => (piece.q0, piece.p0 - t),
            None => (
                self.post_end + (t - self.pre_end).max(0.0),
                (self.pre_end - t).max(0.0),
            ),
        }
    }

    /// 终点：落在被去掉的范围里退到前面最后一个保留时刻。
    fn end(&self, t: f64) -> f64 {
        let k = self.pieces.partition_point(|piece| piece.p1 < t);
        match self.pieces.get(k) {
            Some(piece) if piece.p0 < t => piece.at(t),
            _ if k == self.pieces.len() && t > self.pre_end => t - self.pre_end + self.post_end,
            _ => match k.checked_sub(1).and_then(|index| self.pieces.get(index)) {
                Some(previous) => previous.q1,
                None => self.pieces.first().map_or(0.0, |piece| piece.q0),
            },
        }
    }
}

/// 可以按数字时间换算的元素：起止都不是词锚点，并且设了终点。
fn numeric_span(element: &Element) -> Option<(f64, f64)> {
    if matches!(element.start, Some(TimeValue::Anchor(_))) {
        return None;
    }
    let end = seconds(&element.end)?;
    Some((seconds(&element.start).unwrap_or(0.0), end))
}

fn set_span(element: &mut Element, start: f64, end: f64) {
    if element.start.is_some() || start.abs() > TINY {
        element.start = Some(TimeValue::Seconds(start));
    }
    element.end = Some(TimeValue::Seconds(end));
}

fn retime_elements(
    pre: &TimelineProjection,
    post: &TimelineProjection,
    document: &mut TimelineDocument,
    pictures: &HashSet<String>,
    report: &mut FollowReport,
) {
    let map = ClockMap::build(pre, post);
    for track in &mut document.tracks {
        track.elements.retain_mut(|element| {
            if pictures.contains(&element.id) {
                return true;
            }
            let Some((start, end)) = numeric_span(element) else {
                return true;
            };
            let (new_start, pushed) = map.start(start);
            let new_end = map.end(end);
            if new_end - new_start <= TINY {
                report.removed.push(element.id.clone());
                return false;
            }
            let before = element.clone();
            set_span(element, new_start, new_end);
            if let Some(keyframes) = &element.keyframes
                && ((new_start - start).abs() > TINY
                    || (new_end - end).abs() > TINY
                    || pushed > TINY)
            {
                element.keyframes = Some(rewindow(
                    keyframes,
                    Rewindow::trim(end - start, pushed, new_end - new_start),
                ));
            }
            if pushed > TINY && matches!(element.kind, ElementKind::Video | ElementKind::Audio) {
                element.src_start =
                    Some(element.src_start.unwrap_or(0.0) + pushed * element_rate(element));
            }
            if *element != before {
                report.retimed.push(element.id.clone());
            }
            true
        });
    }
}

fn move_elements(
    pre: &TimelineProjection,
    post: &TimelineProjection,
    document: &mut TimelineDocument,
    pictures: &HashSet<String>,
    report: &mut FollowReport,
) {
    let post_start: HashMap<&str, f64> = post
        .clips()
        .iter()
        .map(|clip| (clip.id.as_str(), clip.timeline_start))
        .collect();
    let clips = pre.clips();
    for track in &mut document.tracks {
        for element in &mut track.elements {
            if pictures.contains(&element.id) {
                continue;
            }
            let Some((start, end)) = numeric_span(element) else {
                continue;
            };
            let index = clips.partition_point(|clip| clip.timeline_end <= start + COMPOSE_EPS);
            let Some(clip) = clips.get(index) else {
                continue;
            };
            if start < clip.timeline_start - COMPOSE_EPS || end > clip.timeline_end + COMPOSE_EPS {
                continue;
            }
            let Some(target) = post_start.get(clip.id.as_str()) else {
                continue;
            };
            let delta = target - clip.timeline_start;
            if delta.abs() <= TINY {
                continue;
            }
            set_span(element, start + delta, end + delta);
            report.retimed.push(element.id.clone());
        }
    }
}

/// 分割缝切开所有轨：数字 `start < t < end` 的元素变成 `[start, t]`（原 id）加
/// `[t, end]`（新 id），媒体元素的右半 `srcStart` 前进已播放的量。边落在缝上的、
/// 不设终点的、词锚点的不动。返回 `(新 id, 原 id)`。
fn split_elements(
    document: &mut TimelineDocument,
    timeline_time: f64,
    next_id: &mut dyn FnMut() -> String,
    skip: &HashSet<String>,
) -> Vec<(String, String)> {
    let mut created = Vec::new();
    for track in &mut document.tracks {
        let mut index = 0;
        while index < track.elements.len() {
            let element = &track.elements[index];
            let span = if skip.contains(&element.id) {
                None
            } else {
                numeric_span(element)
            };
            let Some((start, end)) = span else {
                index += 1;
                continue;
            };
            if timeline_time <= start + TINY || timeline_time >= end - TINY {
                index += 1;
                continue;
            }
            let mut right = track.elements[index].clone();
            right.id = next_id();
            right.start = Some(TimeValue::Seconds(timeline_time));
            if let Some(keyframes) = right.keyframes.clone() {
                let halves = |head: f64, new_duration: f64| Rewindow {
                    old_duration: end - start,
                    head,
                    new_duration,
                    scale: 1.0,
                    divided: true,
                };
                right.keyframes = Some(rewindow(
                    &keyframes,
                    halves(timeline_time - start, end - timeline_time),
                ));
                track.elements[index].keyframes =
                    Some(rewindow(&keyframes, halves(0.0, timeline_time - start)));
            }
            if matches!(right.kind, ElementKind::Video | ElementKind::Audio) {
                right.src_start = Some(
                    right.src_start.unwrap_or(0.0) + (timeline_time - start) * element_rate(&right),
                );
            }
            created.push((right.id.clone(), track.elements[index].id.clone()));
            track.elements[index].end = Some(TimeValue::Seconds(timeline_time));
            track.elements.insert(index + 1, right);
            index += 2;
        }
    }
    created
}

#[cfg(test)]
#[path = "follow_tests.rs"]
mod tests;
