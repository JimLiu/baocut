//! 文字的时间线投影（架构设计 §9.13 的字幕与文稿导出，格式规范 §5.7 EditedSpeechView）：字幕文档的句子、转写文档的词
//! 在剪辑之后的序列上出现在哪里。规则与预览画字幕一致（[`plan_frame`](super::plan_frame) 的字幕分支）：
//!
//! - 文档在源素材时钟上时，经过作用实例的时间映射投到序列上：`seq = itemStart + (src − sourceIn) / rate`；
//!   落在所有作用实例取用的源区间之外的（剪掉的话）不出现，跨过剪点的裁到实例的边上。
//! - 几个作用实例同时覆盖一刻时，逐帧计划用列表里第一个覆盖着的实例；这里按同样的先后，后面的实例只投它没被前面
//!   覆盖的那部分。同一段源被用了两次（两个实例），句子出现两次（两个 occurrence）。
//! - 定格的实例（速度 0）与没有源素材的合成不能投影。
//! - 文档时间已经是序列时间（`clock: 'sequence'`）时不经映射，只裁到字幕实例的区间。
//!
//! 作用范围按这个顺序确定：调用方明确给的实例；显示这份文档的字幕实例（各自的作用实例与区间）；文档描述的素材在
//! 时间线上的所有实例。全部用精确的有理数算，到序列化时才变成秒。

use editor_semantics::{MediaTime, Ratio, TimeMap, map_time};
use serde::Serialize;
use serde_json::Value;
use video_model::{CompositionSource, DocumentRecord, FrameSpan, Id, Sequence, TimelineItem};

use super::{PlanError, VideoView, audio_bounds, checked_fps, span_bounds};
use crate::audio_plan::{PlanRange, resolve_range};

/// 投影的依据：用了哪些作用实例。
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextScope {
    /// `explicit`（调用方给的）、`caption-items`（显示这份文档的字幕实例）、`asset-items`（文档素材的实例）、`sequence`（不经映射）。
    pub basis: String,
    pub caption_item_ids: Vec<Id>,
    pub scope_item_ids: Vec<Id>,
}

/// 投到序列上的一句字幕或一个词。
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextEntry {
    /// occurrence：`<作用实例>:<文档里的 ID>`；同一段源用了两次时各一条。不经映射时就是文档里的 ID。
    pub key: String,
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope_item_id: Option<Id>,
    /// 秒，相对导出范围的起点。
    pub start: f64,
    pub end: f64,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speaker: Option<String>,
    /// 转写文档的句子 ID（文档有句子切分时）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sentence_id: Option<String>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub paragraph_start: bool,
    /// 时间是这个词自己的（对齐或服务商给的）。整段文字作为一个「词」、或按字符长度插值出来的词为 false：
    /// 它们只能当整段的时间用，不能冒充逐词同步（验收 AT-05）。字幕句子始终为 false（句级）。
    pub word_timing: bool,
    /// 被剪点或导出范围裁过。
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub clipped: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextPlan {
    pub sequence_id: Id,
    pub document_id: Id,
    /// `caption`（句子）或 `speech`（词）。
    pub unit: String,
    pub clock: String,
    pub scope: TextScope,
    pub range: PlanRange,
    /// 按开始时刻排，同一刻按 occurrence。
    pub entries: Vec<TextEntry>,
    /// 文档里的条目数与投影之后完全不出现的条目数（剪掉的、范围之外的）。
    pub source_count: usize,
    pub omitted_count: usize,
}

/// 文档里的一条：源时间（或序列时间）区间与文字。
struct SourceEntry {
    id: String,
    start: Ratio,
    end: Ratio,
    text: String,
    speaker: Option<String>,
    sentence_id: Option<String>,
    paragraph_start: bool,
    word_timing: bool,
}

/// 一个作用实例能投影的部分：映射与它独占的序列区间（已经扣掉前面的实例、裁到字幕区间与导出范围）。
struct Projector {
    item_id: Option<Id>,
    /// `None` 表示不经映射（文档时间就是序列时间）。
    map: Option<(Ratio, TimeMapRef)>,
    windows: Vec<(Ratio, Ratio)>,
}

#[derive(Clone, Copy)]
struct TimeMapRef {
    source_in: Ratio,
    rate: Ratio,
}

impl TimeMapRef {
    /// 源时刻 → 序列时刻（`item_start + (src − sourceIn) / rate`）。
    fn to_sequence(self, item_start: Ratio, source: Ratio) -> Option<Ratio> {
        item_start.checked_add(source.checked_sub(self.source_in)?.checked_div(self.rate)?)
    }
}

/// 投影 `document` 的正文。`scope_item_ids` 不为空时只用这些实例。
pub fn plan_text(
    video: VideoView<'_>,
    sequence_id: &str,
    document: &DocumentRecord,
    body: &Value,
    scope_item_ids: &[Id],
    range: Option<(Ratio, Ratio)>,
) -> Result<TextPlan, PlanError> {
    plan_text_scan(video, sequence_id, document, body, scope_item_ids, range, false)
}

/// `full_scan` 时每一条都与每个作用实例试一遍（测试拿它对照）；否则只试源区间可能落进实例窗口的条目。
fn plan_text_scan(
    video: VideoView<'_>,
    sequence_id: &str,
    document: &DocumentRecord,
    body: &Value,
    scope_item_ids: &[Id],
    range: Option<(Ratio, Ratio)>,
    full_scan: bool,
) -> Result<TextPlan, PlanError> {
    let sequence = video
        .sequences
        .get(sequence_id)
        .ok_or_else(|| PlanError::new("SEQUENCE_NOT_FOUND", format!("没有序列 {sequence_id}")))?;
    let (range_start, range_end) = resolve_range(sequence, range)?;
    let schema = body.get("schema").and_then(Value::as_str).unwrap_or_default();
    let (unit, entries) = match schema {
        "baocut.caption/1" => ("caption", caption_entries(body)?),
        "baocut.speech/1" => ("speech", speech_entries(body)?),
        other => {
            return Err(PlanError::new(
                "EXPORT_SOURCE_UNSUPPORTED",
                format!("这份文档（{}）不能导出为字幕或文稿：schema {other}", document.kind),
            ));
        }
    };
    let clock = body.get("clock").and_then(Value::as_str).unwrap_or("source-asset").to_string();
    let (scope, projectors) = projectors(sequence, document, &clock, scope_item_ids, (range_start, range_end))?;

    // 上千个实例 × 上千个词逐对算精确的有理数映射要几十秒（长时间线打开时预览的说话人与字幕、内容索引都卡在这里）：
    // 每个实例只试开始时刻可能落进它窗口的条目（按开始时刻排好后二分），再按原来的（条目，实例）先后逐对投影，
    // 结果与逐对试完全一样。
    let (count, scopes) = (entries.len(), projectors.len());
    let pairs: Box<dyn Iterator<Item = (usize, usize)>> = match (!full_scan).then(|| candidate_pairs(&entries, &projectors)).flatten() {
        Some(pairs) => Box::new(pairs.into_iter()),
        None => Box::new((0..count).flat_map(move |e| (0..scopes).map(move |p| (e, p)))),
    };
    let mut placed: Vec<TextEntry> = Vec::new();
    let mut shown = vec![false; entries.len()];
    for (e, p) in pairs {
        let (entry, projector) = (&entries[e], &projectors[p]);
        let (a, b) = match projector.map {
            None => (entry.start, entry.end),
            Some((item_start, map)) => (
                map.to_sequence(item_start, entry.start)
                    .ok_or_else(|| PlanError::overflow("start"))?,
                map.to_sequence(item_start, entry.end).ok_or_else(|| PlanError::overflow("end"))?,
            ),
        };
        let mut piece = 0;
        for &(from, to) in &projector.windows {
            let start = a.max(from);
            let end = b.min(to);
            if end <= start {
                continue;
            }
            piece += 1;
            shown[e] = true;
            let base = match &projector.item_id {
                Some(item) => format!("{item}:{}", entry.id),
                None => entry.id.clone(),
            };
            placed.push(TextEntry {
                key: if piece == 1 { base } else { format!("{base}#{piece}") },
                id: entry.id.clone(),
                scope_item_id: projector.item_id.clone(),
                start: start.checked_sub(range_start).ok_or_else(|| PlanError::overflow("start"))?.to_f64(),
                end: end.checked_sub(range_start).ok_or_else(|| PlanError::overflow("end"))?.to_f64(),
                text: entry.text.clone(),
                speaker: entry.speaker.clone(),
                sentence_id: entry.sentence_id.clone(),
                paragraph_start: entry.paragraph_start,
                word_timing: entry.word_timing,
                clipped: start != a || end != b,
            });
        }
    }
    let omitted = shown.iter().filter(|shown| !**shown).count();
    placed.sort_by(|x, y| x.start.total_cmp(&y.start).then_with(|| x.key.cmp(&y.key)));
    Ok(TextPlan {
        sequence_id: sequence.id.clone(),
        document_id: document.id.clone(),
        unit: unit.into(),
        clock,
        scope,
        range: PlanRange::new(range_start, range_end)?,
        entries: placed,
        source_count: entries.len(),
        omitted_count: omitted,
    })
}

/// 要逐对投影的（条目，实例），按条目、再按实例的先后。实例窗口在源时钟上是 `[lo, hi)`（映射单调递增：速度为正），
/// 条目能投进去必须 `start < hi` 且 `end > lo`；条目最长 `longest`，所以只要看开始时刻落在 `(lo − longest, hi)` 的。
/// 窗口全被前面的实例占了的实例不投任何东西，直接略过。有理数溢出算不出界时返回 `None`，退回逐对试。
fn candidate_pairs(entries: &[SourceEntry], projectors: &[Projector]) -> Option<Vec<(usize, usize)>> {
    let mut order: Vec<usize> = (0..entries.len()).collect();
    order.sort_by(|&x, &y| entries[x].start.cmp(&entries[y].start));
    let mut longest = Ratio::ZERO;
    for entry in entries {
        longest = longest.max(entry.end.checked_sub(entry.start)?);
    }
    let mut pairs = Vec::new();
    for (p, projector) in projectors.iter().enumerate() {
        let Some((lo, hi)) = source_window(projector)? else {
            continue;
        };
        let after = lo.checked_sub(longest)?;
        let first = order.partition_point(|&e| entries[e].start <= after);
        let last = order.partition_point(|&e| entries[e].start < hi);
        pairs.extend(order[first..last.max(first)].iter().map(|&e| (e, p)));
    }
    pairs.sort_unstable();
    Some(pairs)
}

/// 实例窗口的并集在源时钟上的外沿 `[lo, hi)`：`src = sourceIn + (seq − itemStart) × rate`。没有窗口时 `Some(None)`。
fn source_window(projector: &Projector) -> Option<Option<(Ratio, Ratio)>> {
    let (Some(from), Some(to)) = (
        projector.windows.iter().map(|w| w.0).min(),
        projector.windows.iter().map(|w| w.1).max(),
    ) else {
        return Some(None);
    };
    let Some((item_start, map)) = projector.map else {
        return Some(Some((from, to)));
    };
    let back = |t: Ratio| map.source_in.checked_add(t.checked_sub(item_start)?.checked_mul(map.rate)?);
    Some(Some((back(from)?, back(to)?)))
}

/// 作用实例与各自独占的区间。
fn projectors(
    sequence: &Sequence,
    document: &DocumentRecord,
    clock: &str,
    explicit: &[Id],
    range: (Ratio, Ratio),
) -> Result<(TextScope, Vec<Projector>), PlanError> {
    let fps = checked_fps(sequence)?;
    let whole = range;
    // 每个候选：作用实例（None 表示不经映射）与限定它的区间（字幕实例的 span；没有字幕实例时不限）。
    let mut candidates: Vec<(Option<&TimelineItem>, (Ratio, Ratio))> = Vec::new();
    let mut caption_item_ids: Vec<Id> = Vec::new();
    let basis;
    let find = |id: &Id| sequence.items.iter().find(|item| &item.base().id == id);
    if clock == "sequence" {
        basis = "sequence";
        let captions = displaying(sequence, &document.id);
        if captions.is_empty() {
            candidates.push((None, whole));
        }
        for (id, span) in captions {
            caption_item_ids.push(id.clone());
            candidates.push((None, span_bounds(span, fps)?));
        }
    } else if !explicit.is_empty() {
        basis = "explicit";
        for id in explicit {
            let item = find(id).ok_or_else(|| PlanError::new("ITEM_NOT_FOUND", format!("没有实例 {id}")))?;
            candidates.push((Some(item), whole));
        }
    } else {
        let captions = displaying(sequence, &document.id);
        if !captions.is_empty() {
            basis = "caption-items";
            for (id, span) in captions {
                caption_item_ids.push(id.clone());
                let caption = find(id).and_then(|item| match item {
                    TimelineItem::Caption(c) => Some(c),
                    _ => None,
                });
                let limit = span_bounds(span, fps)?;
                match caption.map(|c| c.scope_item_ids.as_slice()).unwrap_or_default() {
                    [] => candidates.push((None, limit)),
                    ids => {
                        for scope_id in ids {
                            if let Some(item) = find(scope_id) {
                                candidates.push((Some(item), limit));
                            }
                        }
                    }
                }
            }
        } else {
            basis = "asset-items";
            let Some(asset_id) = &document.source_asset_id else {
                return Err(PlanError::new(
                    "EXPORT_SOURCE_UNPLACED",
                    "文档在源素材的时钟上，但没有记下是哪个素材，时间线上也没有字幕实例显示它：给出作用实例（scopeItemIds）",
                ));
            };
            let mut items: Vec<(Ratio, &TimelineItem)> = Vec::new();
            for item in &sequence.items {
                if source_asset(item).is_some_and(|asset| &asset == asset_id) {
                    items.push((item_bounds(item, fps)?.0, item));
                }
            }
            items.sort_by(|(a, x), (b, y)| a.cmp(b).then_with(|| x.base().id.cmp(&y.base().id)));
            candidates.extend(items.into_iter().map(|(_, item)| (Some(item), whole)));
        }
    }

    let mut taken = Taken::default();
    let mut projectors = Vec::new();
    let mut scope_item_ids: Vec<Id> = Vec::new();
    for (item, (limit_start, limit_end)) in candidates {
        let (bounds, map) = match item {
            None => ((limit_start, limit_end), None),
            Some(item) => {
                let Some(map) = linear_map(item)? else {
                    continue;
                };
                let bounds = item_bounds(item, fps)?;
                if !scope_item_ids.contains(&item.base().id) {
                    scope_item_ids.push(item.base().id.clone());
                }
                (bounds, Some((bounds.0, map)))
            }
        };
        let from = bounds.0.max(limit_start).max(range.0);
        let to = bounds.1.min(limit_end).min(range.1);
        if to <= from {
            continue;
        }
        let windows = taken.subtract((from, to));
        taken.add((from, to));
        projectors.push(Projector {
            item_id: item.map(|i| i.base().id.clone()),
            map,
            windows,
        });
    }
    if projectors.is_empty() && basis != "sequence" && scope_item_ids.is_empty() {
        return Err(PlanError::new(
            "EXPORT_SOURCE_UNPLACED",
            "时间线上没有能投影这份文档的实例（文档的素材不在时间线上，或者都是定格）",
        ));
    }
    Ok((
        TextScope {
            basis: basis.into(),
            caption_item_ids,
            scope_item_ids,
        },
        projectors,
    ))
}

/// 显示这份文档的字幕实例（启用的），按区间的起点排。
fn displaying<'a>(sequence: &'a Sequence, document_id: &Id) -> Vec<(&'a Id, FrameSpan)> {
    let mut found: Vec<(&Id, FrameSpan)> = sequence
        .items
        .iter()
        .filter_map(|item| match item {
            TimelineItem::Caption(c) if c.base.enabled && &c.document_id == document_id => Some((&c.base.id, c.span)),
            _ => None,
        })
        .collect();
    found.sort_by(|(x, a), (y, b)| a.from_frame.cmp(&b.from_frame).then_with(|| x.cmp(y)));
    found
}

/// 实例取用的素材：视频与音频的素材，合成的预渲染替身（没有时是代码包）。与逐帧计划的 `scope_at` 相同。
fn source_asset(item: &TimelineItem) -> Option<Id> {
    match item {
        TimelineItem::Video(v) => Some(v.asset_ref.id.clone()),
        TimelineItem::Audio(a) => Some(a.asset_ref.id.clone()),
        TimelineItem::Composition(c) => {
            let CompositionSource::Bundle { asset_ref } = &c.source;
            Some(c.prerender.as_ref().unwrap_or(asset_ref).id.clone())
        }
        _ => None,
    }
}

/// 能投影的实例的线性映射；定格、速度不为正、没有源的实例返回 `None`。
fn linear_map(item: &TimelineItem) -> Result<Option<TimeMapRef>, PlanError> {
    if source_asset(item).is_none() {
        return Ok(None);
    }
    let time_map = match item {
        TimelineItem::Video(v) => &v.time_map,
        TimelineItem::Audio(a) => &a.time_map,
        TimelineItem::Composition(c) => &c.time_map,
        _ => return Ok(None),
    };
    match time_map {
        TimeMap::Hold { .. } => Ok(None),
        TimeMap::Linear { source_in, rate } => {
            rate.validate("timeMap.rate")?;
            let rate = rate.ratio();
            if rate <= Ratio::ZERO {
                return Ok(None);
            }
            // 与逐帧计划共用 `map_time`：确认 sourceIn 合法。
            map_time(time_map, Ratio::ZERO, Ratio::ZERO)?;
            Ok(Some(TimeMapRef {
                source_in: source_in.to_ratio("sourceIn")?,
                rate,
            }))
        }
    }
}

/// 实例在序列上占的区间：音频实例在采样级，其他按帧。
fn item_bounds(item: &TimelineItem, fps: editor_semantics::Rate) -> Result<(Ratio, Ratio), PlanError> {
    match item {
        TimelineItem::Audio(a) => audio_bounds(a, fps),
        other => span_bounds(other.span().expect("音频之外的实例都在帧网格上"), fps),
    }
}

/// 前面的候选已经占去的区间。上千个实例时逐对扣是平方级，这里记成按起点排好、互不相接（前一段的终点严格小于后一段的
/// 起点）的并集，扣与并都二分。`explicit` 与 `caption-items` 的候选不按起点排，所以并入时一般地找出重叠或相接的那几段。
#[derive(Default)]
struct Taken(Vec<(Ratio, Ratio)>);

impl Taken {
    /// `interval` 扣掉已占的区间之后剩下的部分（按先后）。与逐对扣（测试里的 `subtract_pairwise`）相同：都是 `interval`
    /// 去掉这些开区间之后长度不为零的段，端点取自同样的值（`Ratio` 总是约分，相等就是同一个值）。
    fn subtract(&self, (start, end): (Ratio, Ratio)) -> Vec<(Ratio, Ratio)> {
        let mut parts = Vec::new();
        let mut cur = start;
        let first = self.0.partition_point(|&(_, b)| b <= start);
        for &(a, b) in self.0[first..].iter().take_while(|&&(a, _)| a < end) {
            if a > cur {
                parts.push((cur, a));
            }
            cur = cur.max(b);
        }
        if cur < end {
            parts.push((cur, end));
        }
        parts
    }

    fn add(&mut self, (start, end): (Ratio, Ratio)) {
        // 与它重叠或相接的是 `first..last`；整个落在一段里时换上的还是那一段。
        let first = self.0.partition_point(|&(_, b)| b < start);
        let last = self.0.partition_point(|&(a, _)| a <= end);
        let (mut lo, mut hi) = (start, end);
        if first < last {
            lo = lo.min(self.0[first].0);
            hi = hi.max(self.0[last - 1].1);
        }
        self.0.splice(first..last, [(lo, hi)]);
    }
}

/// `interval` 扣掉 `taken` 里的区间之后剩下的部分（按先后）：逐对扣，测试拿它与 `Taken` 对照。
#[cfg(test)]
fn subtract_pairwise(interval: (Ratio, Ratio), taken: &[(Ratio, Ratio)]) -> Vec<(Ratio, Ratio)> {
    let mut parts = vec![interval];
    for &(a, b) in taken {
        let mut next = Vec::new();
        for (x, y) in parts {
            if b <= x || a >= y {
                next.push((x, y));
                continue;
            }
            if a > x {
                next.push((x, a));
            }
            if b < y {
                next.push((b, y));
            }
        }
        parts = next;
    }
    parts
}

// ---- 文档正文 ----

fn timescale(body: &Value) -> Result<i64, PlanError> {
    match body.get("timescale").and_then(Value::as_i64) {
        Some(t) if t > 0 => Ok(t),
        _ => Err(PlanError::new("EXPORT_SOURCE_INVALID", "文档的 timescale 必须是正整数")),
    }
}

fn ticks(value: Option<&Value>, timescale: i64, field: &str) -> Result<Ratio, PlanError> {
    let ticks = value
        .and_then(Value::as_i64)
        .ok_or_else(|| PlanError::new("EXPORT_SOURCE_INVALID", format!("文档里的 {field} 必须是整数刻度")))?;
    Ok(MediaTime {
        ticks: ticks.to_string(),
        timescale,
    }
    .to_ratio(field)?)
}

fn text_of(value: &Value) -> String {
    value.get("text").and_then(Value::as_str).unwrap_or_default().to_string()
}

fn string_field(value: &Value, field: &str) -> Option<String> {
    value.get(field).and_then(Value::as_str).map(str::to_string)
}

/// 字幕文档的句子：空白的句子不显示（与时间线一致），时间反了的报错。
fn caption_entries(body: &Value) -> Result<Vec<SourceEntry>, PlanError> {
    let timescale = timescale(body)?;
    let cues = body
        .get("cues")
        .and_then(Value::as_array)
        .ok_or_else(|| PlanError::new("EXPORT_SOURCE_INVALID", "字幕文档没有 cues"))?;
    let mut entries = Vec::new();
    for cue in cues {
        let text = text_of(cue);
        if text.trim().is_empty() {
            continue;
        }
        let start = ticks(cue.get("start"), timescale, "cues[].start")?;
        let end = ticks(cue.get("end"), timescale, "cues[].end")?;
        if end <= start {
            continue;
        }
        entries.push(SourceEntry {
            id: string_field(cue, "id").unwrap_or_default(),
            start,
            end,
            text,
            speaker: string_field(cue, "speaker"),
            sentence_id: None,
            paragraph_start: cue.get("paragraphStart").and_then(Value::as_bool).unwrap_or(false),
            word_timing: false,
        });
    }
    Ok(entries)
}

/// 零时长的词在后面的空隙里占的一段：到下一个词（隐藏的也算，它的时间还在）的起点为止、至多一个对齐格（0.08 秒）；
/// 后面没有词时补一格；下一个词就从这里开始（没有空隙）时 `None`。与字幕层的 `caption-cues.ts` 同一条规则。
fn zero_duration_slot(start: Ratio, next_start: Option<Ratio>) -> Option<Ratio> {
    let nominal = start.checked_add(Ratio::new(2, 25)?)?;
    match next_start {
        Some(next) if next <= start => None,
        Some(next) if next < nominal => Some(next),
        _ => Some(nominal),
    }
}

/// 转写文档的词。隐藏的词不导出。零时长的词占后面的空隙（`zero_duration_slot`），没有空隙的略过。
/// 句子切分在文档里时给每个词记上句子与段首。
///
/// 不是逐词时间的词按两条规则认出来：词上写着 `timingQuality: 'estimated' | 'missing'`（插值的、或整段写成一个词的，
/// 见 `speech-document.ts`），或者词的文字中间有空白（真正的词不含空白；旧文档没有 `timingQuality`）。
/// 它们只给整段的时间，不冒充逐词同步（验收 AT-05）。
fn speech_entries(body: &Value) -> Result<Vec<SourceEntry>, PlanError> {
    let timescale = timescale(body)?;
    let words = body
        .get("words")
        .and_then(Value::as_array)
        .ok_or_else(|| PlanError::new("EXPORT_SOURCE_INVALID", "转写文档没有 words"))?;
    let index: std::collections::HashMap<&str, usize> = words
        .iter()
        .enumerate()
        .filter_map(|(i, w)| w.get("id").and_then(Value::as_str).map(|id| (id, i)))
        .collect();
    // 词序号 → (句子 ID, 是否段首)。
    let mut sentence_of: Vec<Option<(String, bool)>> = vec![None; words.len()];
    if let Some(sentences) = body.get("sentences").and_then(Value::as_array) {
        for sentence in sentences {
            let Some(id) = string_field(sentence, "id") else {
                continue;
            };
            let paragraph = sentence.get("paragraphStart").and_then(Value::as_bool).unwrap_or(false);
            let members: Vec<usize> = if let Some(ids) = sentence.get("wordIds").and_then(Value::as_array) {
                ids.iter().filter_map(|w| w.as_str().and_then(|w| index.get(w).copied())).collect()
            } else {
                let first = sentence.get("first").and_then(Value::as_str).and_then(|w| index.get(w).copied());
                let last = sentence.get("last").and_then(Value::as_str).and_then(|w| index.get(w).copied());
                match (first, last) {
                    (Some(a), Some(b)) if a <= b => (a..=b).collect(),
                    _ => Vec::new(),
                }
            };
            for (n, i) in members.into_iter().enumerate() {
                sentence_of[i] = Some((id.clone(), paragraph && n == 0));
            }
        }
    }
    let mut entries = Vec::new();
    for (i, word) in words.iter().enumerate() {
        if word.get("hidden").and_then(Value::as_bool).unwrap_or(false) {
            continue;
        }
        let text = text_of(word);
        if text.trim().is_empty() {
            continue;
        }
        let start = ticks(word.get("start"), timescale, "words[].start")?;
        let mut end = ticks(word.get("end"), timescale, "words[].end")?;
        if end <= start {
            // 零时长的词（转写给的词时间塌成一点）：后面有空隙就占一小段，下一个词就从这里开始时才略过。
            let next_start = words[i + 1..]
                .iter()
                .find_map(|next| ticks(next.get("start"), timescale, "words[].start").ok());
            match zero_duration_slot(start, next_start) {
                Some(slot) => end = slot,
                None => continue,
            }
        }
        let quality = word.get("timingQuality").and_then(Value::as_str);
        let word_timing = !matches!(quality, Some("estimated" | "missing")) && !text.trim().contains(char::is_whitespace);
        let (sentence_id, paragraph_start) = match &sentence_of[i] {
            Some((id, paragraph)) => (Some(id.clone()), *paragraph),
            None => (None, false),
        };
        entries.push(SourceEntry {
            id: string_field(word, "id").unwrap_or_default(),
            start,
            end,
            text,
            speaker: string_field(word, "speaker"),
            sentence_id,
            paragraph_start,
            word_timing,
        });
    }
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};
    use video_model::{DocumentRecord, VideoSnapshot};

    use super::{Ratio, Taken, VideoView, plan_text_scan, subtract_pairwise};

    /// 夹具视频换成一堆同素材的实例：两条视频轨上前后交错、变速、重复取用同一段源，再加一个音频实例和一个字幕实例。
    fn video(clips: usize) -> VideoSnapshot {
        let mut value: Value = serde_json::from_str(include_str!("../tests/fixtures/video.json")).expect("夹具");
        value["assets"] = json!({ "asset_a": { "id": "asset_a", "kind": "video", "name": "a", "currentRevision": "r1", "revisions": { "r1": {
            "revision": "r1", "contentHash": "sha256:a", "byteLength": 10, "mediaType": "video/mp4", "storage": { "mode": "managed" },
            "provenance": { "origin": "import" }, "audio": { "sampleRate": 48000, "channels": 2 } } } } });
        let track = |id: &str, order: i64, kind: &str| {
            json!({ "id": id, "order": order, "kind": kind, "locked": false, "visible": true, "muted": false,
                    "solo": { "enabled": false, "group": if kind == "audio" { "audio" } else { "visual" } } })
        };
        let sequence = &mut value["sequences"]["seq_main"];
        sequence["tracks"] = json!([
            track("v1", 0, "visual"),
            track("v2", 1, "visual"),
            track("a1", 0, "audio"),
            track("s1", 0, "subtitle")
        ]);
        let base = |id: &str, track: &str| json!({ "id": id, "trackId": track, "enabled": true, "locked": false, "paintOrder": 0, "followPolicy": { "kind": "sequence-fixed" } });
        let mut seed: u64 = 7;
        let mut next = |n: u64| {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            (seed >> 33) % n
        };
        let mut items = Vec::new();
        let mut ids = Vec::new();
        for k in 0..clips {
            let id = format!("clip{k}");
            let mut item = base(&id, if k % 3 == 2 { "v2" } else { "v1" });
            let rate = [(1, 1), (2, 1), (1, 2), (3, 2)][next(4) as usize];
            item.as_object_mut().unwrap().extend(
                json!({
                    "type": "video", "span": { "fromFrame": next(1800), "durationFrames": 1 + next(240) },
                    "place": {}, "mode": "fullscreen", "fit": "contain", "assetRef": { "id": "asset_a", "revision": "r1" },
                    "timeMap": { "kind": "linear", "sourceIn": { "ticks": next(60_000).to_string(), "timescale": 1000 },
                                 "rate": { "num": rate.0, "den": rate.1 } },
                    "embeddedAudio": { "enabled": true, "volume": 1 },
                })
                .as_object()
                .unwrap()
                .clone(),
            );
            items.push(item);
            ids.push(id);
        }
        let mut audio = base("dub", "a1");
        audio.as_object_mut().unwrap().extend(
            json!({
                "type": "audio", "assetRef": { "id": "asset_a", "revision": "r1" }, "fromFrame": 300,
                "subframeOffset": { "ticks": "1", "timescale": 3000 }, "playDuration": { "ticks": "7", "timescale": 1 },
                "timeMap": { "kind": "linear", "sourceIn": { "ticks": "12", "timescale": 1 }, "rate": { "num": 1, "den": 1 } },
                "mix": { "volume": 1 },
            })
            .as_object()
            .unwrap()
            .clone(),
        );
        items.push(audio);
        let mut caption = base("cap", "s1");
        let scopes: Vec<&String> = ids.iter().step_by(2).collect();
        caption.as_object_mut().unwrap().extend(
            json!({ "type": "caption", "span": { "fromFrame": 90, "durationFrames": 1200 }, "documentId": "doc_cap", "scopeItemIds": scopes })
                .as_object()
                .unwrap()
                .clone(),
        );
        items.push(caption);
        sequence["items"] = Value::Array(items);
        serde_json::from_value(value).expect("视频快照")
    }

    fn record(id: &str, kind: &str) -> DocumentRecord {
        serde_json::from_value(
            json!({ "id": id, "kind": kind, "name": id, "currentRevision": "d1", "revisions": {}, "sourceAssetId": "asset_a" }),
        )
        .expect("文档头")
    }

    /// 词与句：大多是短的，夹着跨过剪点的长句、重叠的句子和重复的 ID。
    fn body(schema: &str, clock: &str) -> Value {
        let mut list = Vec::new();
        for k in 0..400i64 {
            let start = k * 170;
            let end = start + if k % 37 == 0 { 9_000 } else { 120 + (k % 5) * 40 };
            let id = if k % 97 == 0 { "dup".to_string() } else { format!("e{k}") };
            list.push(json!({ "id": id, "start": start, "end": end, "text": format!("t{k}") }));
        }
        let key = if schema == "baocut.caption/1" { "cues" } else { "words" };
        json!({ "schema": schema, "clock": clock, "timescale": 1000, key: list })
    }

    #[test]
    fn candidate_pairs_match_the_full_scan() {
        let video = video(60);
        let view = || VideoView::from(&video);
        let r = |a: i128, b: i128| Some((Ratio::from_int(a).unwrap(), Ratio::from_int(b).unwrap()));
        let ranges = [None, r(3, 40), r(20, 21)];
        let cases: [(&str, &str, &str, &[&str]); 5] = [
            ("doc_cap", "caption", "baocut.caption/1", &[]),
            ("doc_speech", "speech", "baocut.speech/1", &[]),
            ("doc_speech", "speech", "baocut.speech/1", &["clip3", "clip4", "dub", "clip3"]),
            ("doc_cap", "caption", "baocut.caption/1", &["dub", "clip10"]),
            ("doc_seq", "caption", "baocut.caption/1", &[]),
        ];
        for (id, kind, schema, scope) in cases {
            let clock = if id == "doc_seq" { "sequence" } else { "source-asset" };
            let body = body(schema, clock);
            let scope: Vec<String> = scope.iter().map(|s| s.to_string()).collect();
            for range in ranges {
                let fast = plan_text_scan(view(), "seq_main", &record(id, kind), &body, &scope, range, false).expect("投影");
                let full = plan_text_scan(view(), "seq_main", &record(id, kind), &body, &scope, range, true).expect("投影");
                assert!(range.is_some() || full.entries.len() > 20, "{id} {scope:?}：夹具要真的投出东西");
                assert_eq!(fast, full, "{id} {scope:?} {range:?}");
            }
        }
    }

    /// 已占区间并起来扣与逐对扣相同：候选不按起点来（`explicit`、`caption-items`），有交叠、相接、嵌套、同一区间、盖住前面几段的。
    #[test]
    fn merged_taken_matches_pairwise_subtract() {
        let mut seed: u64 = 3;
        let mut next = |n: i128| {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            ((seed >> 33) % n as u64) as i128
        };
        let q = |num: i128, den: i128| Ratio::new(num, den).unwrap();
        for _ in 0..200 {
            let mut taken = Taken::default();
            let mut raw: Vec<(Ratio, Ratio)> = Vec::new();
            for _ in 0..60 {
                let den = [1, 2, 3][next(3) as usize];
                let fresh = |next: &mut dyn FnMut(i128) -> i128| {
                    let start = q(next(600) - 100, den);
                    (start, start.checked_add(q(1 + next(60), den)).unwrap())
                };
                let (start, end) = match raw.get(next(raw.len().max(1) as i128) as usize).copied() {
                    None => fresh(&mut next),
                    Some((a, b)) => match next(6) {
                        // 接在某段后面或前面
                        0 => (b, b.checked_add(q(1 + next(30), den)).unwrap()),
                        1 => (a.checked_sub(q(1 + next(30), den)).unwrap(), a),
                        // 嵌在某段里或与它同一区间
                        2 => {
                            let length = b.checked_sub(a).unwrap();
                            let inner = |k: i128| a.checked_add(length.checked_mul(q(k, 8)).unwrap()).unwrap();
                            let from = next(8);
                            (inner(from), inner(from + 1 + next(8 - from)))
                        }
                        // 盖住某段
                        3 => (a.checked_sub(q(next(20), den)).unwrap(), b.checked_add(q(next(20), den)).unwrap()),
                        _ => fresh(&mut next),
                    },
                };
                let probe = fresh(&mut next);
                assert_eq!(taken.subtract(probe), subtract_pairwise(probe, &raw), "{probe:?} 扣 {raw:?}");
                assert_eq!(
                    taken.subtract((start, end)),
                    subtract_pairwise((start, end), &raw),
                    "{start:?}..{end:?} 扣 {raw:?}"
                );
                taken.add((start, end));
                raw.push((start, end));
                assert!(taken.0.iter().all(|&(a, b)| a < b), "{:?}", taken.0);
                assert!(
                    taken.0.windows(2).all(|w| w[0].1 < w[1].0),
                    "并集要按起点排好、互不相接：{:?}",
                    taken.0
                );
            }
        }
    }
}
