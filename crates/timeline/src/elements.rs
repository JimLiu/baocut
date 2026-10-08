use serde_json::Value;

use crate::schema::{Element, Track, TrackKind};
use crate::{TimelineDocument, TimelineError};

fn element_locations(
    document: &TimelineDocument,
) -> impl Iterator<Item = (usize, usize, &Element)> {
    document
        .tracks
        .iter()
        .enumerate()
        .flat_map(|(track_index, track)| {
            track
                .elements
                .iter()
                .enumerate()
                .map(move |(element_index, element)| (track_index, element_index, element))
        })
}

pub fn resolve_element_id(
    document: &TimelineDocument,
    selector: &str,
) -> Result<String, TimelineError> {
    if selector.is_empty() {
        return Err(TimelineError::Invalid(
            "element selector 不能为空".to_owned(),
        ));
    }
    if let Some((_, _, element)) =
        element_locations(document).find(|(_, _, element)| element.id == selector)
    {
        return Ok(element.id.clone());
    }
    let prefix = element_locations(document)
        .filter(|(_, _, element)| element.id.starts_with(selector))
        .map(|(_, _, element)| element.id.clone())
        .collect::<Vec<_>>();
    if prefix.len() == 1 {
        return Ok(prefix[0].clone());
    }
    if prefix.len() > 1 {
        return Err(TimelineError::Ambiguous(format!(
            "element 前缀 {selector} 匹配 {prefix:?}"
        )));
    }
    let names = element_locations(document)
        .filter(|(_, _, element)| element.name.as_deref() == Some(selector))
        .map(|(_, _, element)| element.id.clone())
        .collect::<Vec<_>>();
    match names.as_slice() {
        [id] => Ok(id.clone()),
        [] => Err(TimelineError::Unmapped(selector.to_owned())),
        _ => Err(TimelineError::Ambiguous(format!(
            "element name {selector} 匹配 {names:?}"
        ))),
    }
}

pub fn add_element(
    document: &mut TimelineDocument,
    track_id: &str,
    track_name: Option<String>,
    element: Element,
) -> Result<usize, TimelineError> {
    if document
        .tracks
        .iter()
        .flat_map(|track| &track.elements)
        .any(|candidate| candidate.id == element.id)
    {
        return Err(TimelineError::Invalid(format!("重复 id：{}", element.id)));
    }
    let required_kind = if element.kind == crate::schema::ElementKind::Audio {
        TrackKind::Audio
    } else {
        TrackKind::Overlay
    };
    let track_index = if let Some(index) = document
        .tracks
        .iter()
        .position(|track| track.id == track_id)
    {
        let track = &document.tracks[index];
        if track.locked {
            return Err(TimelineError::Invalid(format!("track {} 已锁定", track.id)));
        }
        if track.kind != required_kind {
            return Err(TimelineError::Invalid(format!(
                "track {} kind 与 element {} 不匹配",
                track.id, element.id
            )));
        }
        index
    } else {
        document.tracks.push(Track {
            id: track_id.to_owned(),
            kind: required_kind,
            name: track_name,
            hidden: false,
            locked: false,
            muted: false,
            elements: Vec::new(),
        });
        document.tracks.len() - 1
    };
    document.tracks[track_index].elements.push(element);
    document.validate()?;
    Ok(document.tracks[track_index].elements.len() - 1)
}

/// RFC 7396 JSON Merge Patch：对象逐键合并，`null` 删键，标量整体替换。
///
/// 目标位置尚不存在（或不是对象）而补丁是对象时，必须**先立一个空对象再逐键
/// 合并**，不能把补丁原样拷过去——原样拷会把补丁里表示「删键」的 `null` 连同
/// 键一起带进目标，随后反序列化成 `BTreeMap<String, String>` 之类的强类型字段
/// 时就会炸成 `invalid type: null, expected a string`（贴纸首次改色时
/// `sticker.fillOverrides` 还不存在，正是这一步）。
pub fn merge_patch(target: &mut Value, patch: &Value) {
    let Value::Object(patch) = patch else {
        *target = patch.clone();
        return;
    };
    if !target.is_object() {
        *target = Value::Object(serde_json::Map::new());
    }
    let Value::Object(target) = target else {
        unreachable!("刚刚已保证 target 是对象");
    };
    for (key, value) in patch {
        if value.is_null() {
            target.remove(key);
        } else {
            merge_patch(target.entry(key.clone()).or_insert(Value::Null), value);
        }
    }
}

pub fn patch_element(
    document: &mut TimelineDocument,
    selector: &str,
    patch: &Value,
) -> Result<Element, TimelineError> {
    let id = resolve_element_id(document, selector)?;
    let (track_index, element_index, _) = element_locations(document)
        .find(|(_, _, element)| element.id == id)
        .expect("resolved element exists");
    if document.tracks[track_index].locked {
        return Err(TimelineError::Invalid(format!(
            "track {} 已锁定",
            document.tracks[track_index].id
        )));
    }
    if patch.get("id").is_some() || patch.get("kind").is_some() {
        return Err(TimelineError::Invalid(
            "element patch 不允许修改 id/kind".to_owned(),
        ));
    }
    let mut value = serde_json::to_value(&document.tracks[track_index].elements[element_index])
        .map_err(|error| TimelineError::Invalid(error.to_string()))?;
    merge_patch(&mut value, patch);
    let updated: Element = serde_json::from_value(value)
        .map_err(|error| TimelineError::Invalid(format!("element patch 非法：{error}")))?;
    document.tracks[track_index].elements[element_index] = updated.clone();
    document.validate()?;
    Ok(updated)
}

pub fn replace_element(
    document: &mut TimelineDocument,
    selector: &str,
    replacement: Element,
) -> Result<Element, TimelineError> {
    let id = resolve_element_id(document, selector)?;
    if replacement.id != id {
        return Err(TimelineError::Invalid(
            "replacement 必须保留 element id".to_owned(),
        ));
    }
    let (track_index, element_index, _) = element_locations(document)
        .find(|(_, _, element)| element.id == id)
        .expect("resolved element exists");
    if document.tracks[track_index].locked {
        return Err(TimelineError::Invalid(format!(
            "track {} 已锁定",
            document.tracks[track_index].id
        )));
    }
    document.tracks[track_index].elements[element_index] = replacement.clone();
    document.validate()?;
    Ok(replacement)
}

pub fn remove_element(
    document: &mut TimelineDocument,
    selector: &str,
) -> Result<Element, TimelineError> {
    let id = resolve_element_id(document, selector)?;
    let (track_index, element_index, _) = element_locations(document)
        .find(|(_, _, element)| element.id == id)
        .expect("resolved element exists");
    if document.tracks[track_index].locked {
        return Err(TimelineError::Invalid(format!(
            "track {} 已锁定",
            document.tracks[track_index].id
        )));
    }
    Ok(document.tracks[track_index].elements.remove(element_index))
}

/// 元素的**轨内**重排（z 序 = `tracks[]` 顺序 × 轨内 `elements[]` 顺序，本函数
/// 只动后者；跨轨层级归 `moveTrack`）。`to` 是同一条轨 `elements[]` 的 0 基目标
/// 下标——与 `moveTrack` 同一条约定：「上移一层」是往数组**后面**挪，方向由
/// 客户端换算成下标，这里只认下标。返回 `(元素 id, 轨 id, 原下标)`。
pub fn reorder_element(
    document: &mut TimelineDocument,
    selector: &str,
    to: usize,
) -> Result<(String, String, usize), TimelineError> {
    let id = resolve_element_id(document, selector)?;
    let (track_index, element_index, _) = element_locations(document)
        .find(|(_, _, element)| element.id == id)
        .expect("resolved element exists");
    let track = &document.tracks[track_index];
    if track.locked {
        return Err(TimelineError::Invalid(format!("track {} 已锁定", track.id)));
    }
    if to >= track.elements.len() {
        return Err(TimelineError::Invalid(format!(
            "reorder 目标下标越界：{to}（track {} 共 {} 个元素）",
            track.id,
            track.elements.len()
        )));
    }
    let track_id = track.id.clone();
    if to != element_index {
        let element = document.tracks[track_index].elements.remove(element_index);
        document.tracks[track_index].elements.insert(to, element);
    }
    Ok((id, track_id, element_index))
}

/// 把元素挪到**另一条**已有的轨，落在目标轨的下标 `to`（数组越靠后越在上层；
/// `to == 目标轨元素数` = 最上层）。目标轨就是原轨时等价于 [`reorder_element`]。
///
/// 两条轨都不能锁定；目标轨必须已经存在（挪进一条不存在的轨几乎都是笔误，不像
/// [`add_element`] 那样顺手建轨），种类要与元素相容（音频元素只进音频轨）。
/// 返回 `(元素 id, 原轨 id, 原轨内下标)`。
pub fn move_element_to_track(
    document: &mut TimelineDocument,
    selector: &str,
    track_id: &str,
    to: usize,
) -> Result<(String, String, usize), TimelineError> {
    let id = resolve_element_id(document, selector)?;
    let (from_track, from_index, element) = element_locations(document)
        .find(|(_, _, element)| element.id == id)
        .map(|(track, index, element)| (track, index, element.kind))
        .expect("resolved element exists");
    let Some(target) = document
        .tracks
        .iter()
        .position(|track| track.id == track_id)
    else {
        return Err(TimelineError::Unmapped(format!("track {track_id}")));
    };
    if target == from_track {
        return reorder_element(document, &id, to);
    }
    for index in [from_track, target] {
        let track = &document.tracks[index];
        if track.locked {
            return Err(TimelineError::Invalid(format!("track {} 已锁定", track.id)));
        }
    }
    let required_kind = if element == crate::schema::ElementKind::Audio {
        TrackKind::Audio
    } else {
        TrackKind::Overlay
    };
    if document.tracks[target].kind != required_kind {
        return Err(TimelineError::Invalid(format!(
            "track {} kind 与 element {id} 不匹配",
            document.tracks[target].id
        )));
    }
    let length = document.tracks[target].elements.len();
    if to > length {
        return Err(TimelineError::Invalid(format!(
            "move 目标下标越界：{to}（track {} 共 {length} 个元素）",
            document.tracks[target].id
        )));
    }
    let from_track_id = document.tracks[from_track].id.clone();
    let moved = document.tracks[from_track].elements.remove(from_index);
    document.tracks[target].elements.insert(to, moved);
    document.validate()?;
    Ok((id, from_track_id, from_index))
}

pub fn patch_main(
    document: &mut TimelineDocument,
    patch: &Value,
) -> Result<crate::schema::Main, TimelineError> {
    if !patch.is_object() {
        return Err(TimelineError::Invalid("main patch 须为 object".to_owned()));
    }
    let mut value = document
        .main
        .as_ref()
        .map(serde_json::to_value)
        .transpose()
        .map_err(|error| TimelineError::Invalid(error.to_string()))?
        .unwrap_or_else(|| serde_json::json!({}));
    merge_patch(&mut value, patch);
    let updated: crate::schema::Main = serde_json::from_value(value)
        .map_err(|error| TimelineError::Invalid(format!("main patch 非法：{error}")))?;
    document.main = Some(updated.clone());
    document.validate()?;
    Ok(updated)
}

// ---------------------------------------------------------------------------
// 元素的分割 / 修剪 / 合并：时钟算术与合并判据
// ---------------------------------------------------------------------------
//
// App / Web 的时间轴手势（`bcut-editor-core::timeline_edit`）与 `bcut element
// split|trim|join` 共用这里的算术：播放倍率、左修边后的源入点、切点是否留得下
// 两段。只剩这一份。

/// 媒体元素的播放倍率（每时间轴秒走过的源秒）：缺席、非有限或不为正都按 1×。
pub fn media_play_rate(rate: Option<f64>) -> f64 {
    match rate {
        Some(rate) if rate.is_finite() && rate > 0.0 => rate,
        _ => 1.0,
    }
}

/// 带源时钟的种类：切开或左修边时 `srcStart` 跟着前进（`video` / `audio`）。
pub fn carries_source_clock(kind: crate::schema::ElementKind) -> bool {
    matches!(
        kind,
        crate::schema::ElementKind::Video | crate::schema::ElementKind::Audio
    )
}

/// 元素在时间轴上的起点从 `old_start` 挪到 `new_start` 后新的 `srcStart`：
/// 每时间轴秒烧掉 `rate` 源秒。不夹取，需要夹到 ≥ 0 的调用方自己夹。
pub fn shifted_src_start(src_start: f64, old_start: f64, new_start: f64, rate: f64) -> f64 {
    src_start + (new_start - old_start) * rate
}

/// 在 `at` 处切开 `[start, end)` 能不能让两段都不短于 `minimum`（负数按 0）：
/// `start + minimum ≤ at ≤ end − minimum`；`end` 缺席（跟片尾）只查左边界。
pub fn split_point_inside(start: f64, end: Option<f64>, at: f64, minimum: f64) -> bool {
    let minimum = minimum.max(0.0);
    at.is_finite() && at >= start + minimum && end.is_none_or(|end| at <= end - minimum)
}

/// 把元素在成片时刻 `at` 切成两段：原件（id 不变）的 `end` 改成 `at`；右半是
/// 原件的完整副本，换成 `new_id`、`start = at`、`end` 照抄（原件跟片尾则右半也
/// 跟片尾），紧挨着放在原件之上（同一条轨、下标 +1，z 序与 App 分割一致）。带源
/// 时钟的种类右半 `srcStart` 前进 `(at − start) × rate`。
///
/// 关键帧（0.12）按两半各自的新窗口改写（[`crate::keyframes::split_keyframes`]）；闪避、
/// 静态音量等其余属性两半照抄。
///
/// `start` / `end` 是原件解算后的起止（词锚已解，跟片尾的按片尾）；切点是否留得下两段由
/// 调用方用 [`split_point_inside`] 判定。返回右半。
pub fn split_element(
    document: &mut TimelineDocument,
    selector: &str,
    (start, end): (f64, f64),
    at: f64,
    new_id: &str,
) -> Result<Element, TimelineError> {
    use crate::schema::TimeValue;

    let id = resolve_element_id(document, selector)?;
    if new_id.is_empty() || element_locations(document).any(|(_, _, el)| el.id == new_id) {
        return Err(TimelineError::Invalid(format!(
            "element id 已被占用：{new_id}"
        )));
    }
    let (track_index, element_index, _) = element_locations(document)
        .find(|(_, _, element)| element.id == id)
        .expect("resolved element exists");
    if document.tracks[track_index].locked {
        return Err(TimelineError::Invalid(format!(
            "track {} 已锁定",
            document.tracks[track_index].id
        )));
    }
    let original = document.tracks[track_index].elements[element_index].clone();
    let mut right = original.clone();
    right.id = new_id.to_owned();
    right.start = Some(TimeValue::Seconds(at));
    if carries_source_clock(original.kind) {
        right.src_start = Some(shifted_src_start(
            original.src_start.unwrap_or(0.0),
            start,
            at,
            media_play_rate(original.rate),
        ));
    }
    let mut left = original;
    left.end = Some(TimeValue::Seconds(at));
    if let Some(keyframes) = &left.keyframes {
        let (left_frames, right_frames) =
            crate::keyframes::split_keyframes(keyframes, (end - start).max(0.0), at - start);
        left.keyframes = Some(left_frames);
        right.keyframes = Some(right_frames);
    }
    let elements = &mut document.tracks[track_index].elements;
    elements[element_index] = left;
    elements.insert(element_index + 1, right.clone());
    document.validate()?;
    Ok(right)
}

/// `join` 在两件元素属性不一致时保留哪一边（按命令里给出的先后）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JoinKeep {
    First,
    Second,
}

/// `join` 拒绝的原因。`Attributes` 可以用 [`JoinKeep`] 显式选一边放行，其余不行。
#[derive(Debug, Clone, PartialEq)]
pub enum JoinRefusal {
    /// 种类不同。
    Kind,
    /// 时间上不首尾相接：`gap` = 后者起点 − 前者终点（负数是重叠）。
    NotAdjacent { gap: f64 },
    /// 源不同，或播放倍率不同（`key` 是 `srcId` / `rate`）。
    Source { key: &'static str },
    /// 源时间不连续：后者的 `srcStart` 应为 `expected`。
    SourceGap { expected: f64, actual: f64 },
    /// 其余属性不一致的键（按字母序）。
    Attributes { keys: Vec<String> },
}

/// 首尾相接、源时间连续的判定容差（秒）。
pub const JOIN_EPSILON: f64 = 1e-3;

/// 不参与 `join` 属性比较的键：两段本来就该不同的时间与身份，外加名字（名字只是
/// 标签，不影响画面，合并后取保留那一边的）。
const JOIN_OWN_KEYS: [&str; 5] = ["id", "name", "start", "end", "srcStart"];

/// 两件元素合并成一件（[`split_element`] 的逆）：按解算后的时间排出前后，要求种类
/// 相同、首尾相接（容差 [`JOIN_EPSILON`]）、带源时钟的同源同倍率且源时间连续、其
/// 余属性一致。属性不一致时 `keep` 选一边的属性。
///
/// 结果沿用**时间上靠前**那件的 id、`start`（原样，词锚不解开）与 `srcStart`，
/// `end` 取靠后那件的（原样，跟片尾的仍跟片尾）；其余属性取 `keep` 那一边，一致时
/// 取靠前那件。`first` / `second` 与 `keep` 同序（命令里给出的先后），`*_span` 是
/// 两件解算后的 `(start, end)`。同一条轨由调用方判定。
pub fn join_elements(
    first: &Element,
    first_span: (f64, f64),
    second: &Element,
    second_span: (f64, f64),
    keep: Option<JoinKeep>,
) -> Result<Element, JoinRefusal> {
    if first.kind != second.kind {
        return Err(JoinRefusal::Kind);
    }
    let first_is_earlier = first_span.0 <= second_span.0;
    let ((early, early_span), (late, late_span)) = if first_is_earlier {
        ((first, first_span), (second, second_span))
    } else {
        ((second, second_span), (first, first_span))
    };
    let gap = late_span.0 - early_span.1;
    if gap.abs() > JOIN_EPSILON {
        return Err(JoinRefusal::NotAdjacent { gap });
    }
    if carries_source_clock(early.kind) || early.src_id.is_some() || late.src_id.is_some() {
        if early.src_id != late.src_id {
            return Err(JoinRefusal::Source { key: "srcId" });
        }
    }
    if carries_source_clock(early.kind) {
        let rate = media_play_rate(early.rate);
        if (rate - media_play_rate(late.rate)).abs() > 1e-9 {
            return Err(JoinRefusal::Source { key: "rate" });
        }
        let expected = shifted_src_start(
            early.src_start.unwrap_or(0.0),
            early_span.0,
            early_span.1,
            rate,
        );
        let actual = late.src_start.unwrap_or(0.0);
        if (actual - expected).abs() > JOIN_EPSILON * rate.max(1.0) {
            return Err(JoinRefusal::SourceGap { expected, actual });
        }
    }
    // 关键帧（0.12）是分割切开的两半时拼回原样，不参与属性比较；拼不回时按普通属性比
    // （两边一有关键帧就算不一致，`keep` 取那一边的原样）。
    let joined_keyframes = crate::keyframes::join_keyframes(
        early.keyframes.as_ref(),
        (early_span.1 - early_span.0).max(0.0),
        late.keyframes.as_ref(),
        (late_span.1 - late_span.0).max(0.0),
    );
    let attributes = |element: &Element| {
        let mut value = serde_json::to_value(element).expect("element serialization");
        let object = value.as_object_mut().expect("element is an object");
        for key in JOIN_OWN_KEYS {
            object.remove(key);
        }
        if joined_keyframes.is_some() {
            object.remove("keyframes");
        }
        std::mem::take(object)
    };
    let (early_attrs, late_attrs) = (attributes(early), attributes(late));
    let mut keys = early_attrs
        .keys()
        .chain(late_attrs.keys())
        .filter(|key| early_attrs.get(*key) != late_attrs.get(*key))
        .cloned()
        .collect::<Vec<_>>();
    if joined_keyframes.is_none() {
        keys.push("keyframes".to_owned());
    }
    keys.sort();
    keys.dedup();
    let base = match keep {
        _ if keys.is_empty() => early,
        Some(JoinKeep::First) => first,
        Some(JoinKeep::Second) => second,
        None => return Err(JoinRefusal::Attributes { keys }),
    };
    let mut merged = base.clone();
    merged.id = early.id.clone();
    merged.start = early.start.clone();
    merged.end = late.end.clone();
    merged.src_start = early.src_start;
    if let Some(keyframes) = joined_keyframes {
        merged.keyframes = keyframes;
    }
    if keys.is_empty() {
        merged.name = early.name.clone();
    }
    Ok(merged)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::schema::{ElementKind, ElementRole};

    use super::*;

    fn text(id: &str, name: Option<&str>) -> Element {
        Element {
            id: id.to_owned(),
            kind: ElementKind::Text,
            name: name.map(str::to_owned),
            role: Some(ElementRole::Screentext),
            start: None,
            end: None,
            place: None,
            vertical_align: None,
            src_id: None,
            src_start: None,
            rate: None,
            muted: None,
            volume: None,
            audio_fade_in: None,
            audio_fade_out: None,
            bcf_clip: None,
            mode: None,
            fit: None,
            bg: None,
            text: Some("Hello".to_owned()),
            style: None,
            style_preset_id: None,
            tile: None,
            mask: None,
            fx: None,
            animate: None,
            transitions: None,
            keyframes: None,
            duck: None,
            source: None,
            html: None,
            ai: None,
            counter: None,
            shape: None,
            sticker: None,
            visualizer: None,
            progress: None,
            draw: None,
            placeholder: None,
            confetti: None,
            whiteboard: None,
            hidden: false,
        }
    }

    #[test]
    fn add_patch_resolve_and_remove_share_one_strict_path() {
        let mut document = TimelineDocument::default();
        add_element(&mut document, "text", None, text("el-10", Some("Title"))).unwrap();
        add_element(&mut document, "text", None, text("el-20", Some("Other"))).unwrap();
        assert_eq!(resolve_element_id(&document, "el-1").unwrap(), "el-10");
        assert_eq!(resolve_element_id(&document, "Title").unwrap(), "el-10");
        assert!(matches!(
            resolve_element_id(&document, "el-"),
            Err(TimelineError::Ambiguous(_))
        ));
        let updated = patch_element(
            &mut document,
            "Title",
            &json!({"text":"Updated", "place":{"x":50,"opacity":0.6}, "hidden":true}),
        )
        .unwrap();
        assert_eq!(updated.text.as_deref(), Some("Updated"));
        assert_eq!(updated.place.unwrap().x, Some(50.0));
        assert!(updated.hidden);
        assert_eq!(remove_element(&mut document, "el-10").unwrap().id, "el-10");
        assert_eq!(document.tracks[0].elements.len(), 1);
        let main = patch_main(&mut document, &json!({"muted":true,"background":"black"})).unwrap();
        assert!(main.muted);
    }

    /// 0.12：改别的属性（面板拖位置、改文字）不碰 `keyframes` / `duck`；按属性
    /// 合并与清除走同一条 merge-patch。
    #[test]
    fn keyframes_and_duck_survive_unrelated_patches_and_merge_per_property() {
        let mut document = TimelineDocument::default();
        let mut element = text("el-1", Some("Title"));
        element.keyframes = Some(
            serde_json::from_value(
                json!({"x": [{"t": "0%", "v": 40.0}, {"t": "100%", "v": 60.0}]}),
            )
            .unwrap(),
        );
        add_element(&mut document, "text", None, element).unwrap();
        let updated = patch_element(
            &mut document,
            "el-1",
            &json!({"text": "New", "place": {"y": 30.0}}),
        )
        .unwrap();
        assert!(updated.keyframes.as_ref().unwrap().get("x").is_some());
        let updated = patch_element(
            &mut document,
            "el-1",
            &json!({"keyframes": {"scale": [{"t": "0%", "v": 1.0}, {"t": "100%", "v": 1.2}]}}),
        )
        .unwrap();
        let keyframes = updated.keyframes.as_ref().unwrap();
        assert!(keyframes.get("x").is_some() && keyframes.get("scale").is_some());
        let updated =
            patch_element(&mut document, "el-1", &json!({"keyframes": {"x": null}})).unwrap();
        assert!(updated.keyframes.as_ref().unwrap().get("x").is_none());
        // 文字元素不能带 volume 关键帧，也不能闪避。
        assert!(
            patch_element(
                &mut document,
                "el-1",
                &json!({"keyframes": {"volume": [{"t": 0.0, "v": 0.5}]}})
            )
            .is_err()
        );
        assert!(
            patch_element(&mut document, "el-1", &json!({"duck": {"under": "speech"}})).is_err()
        );
    }

    /// 贴纸**首次**改色：元素序列化后根本没有 `sticker.fillOverrides` 这一键
    /// （`skip_serializing_if = BTreeMap::is_empty`），补丁里同色分组写的
    /// `null`（RFC 7396 的「删键」）必须被吃掉，而不是原样拷进目标再炸掉反序列化。
    #[test]
    fn merge_patch_drops_nulls_when_creating_a_missing_object() {
        use crate::schema::StickerProps;

        let mut document = TimelineDocument::default();
        let mut sticker = text("st-1", Some("Emoji"));
        sticker.kind = ElementKind::Sticker;
        sticker.text = None;
        sticker.role = None;
        let mut props = StickerProps::new("asset");
        props.path = Some("media/elements/emoji.svg".to_owned());
        sticker.sticker = Some(props);
        add_element(&mut document, "sticker", None, sticker).unwrap();
        assert!(
            serde_json::to_value(&document.tracks[0].elements[0]).unwrap()["sticker"]
                .get("fillOverrides")
                .is_none(),
            "前提：空表不序列化"
        );

        let updated = patch_element(
            &mut document,
            "st-1",
            &json!({"sticker": {"fillOverrides": {"#ffffff": null, "#112233": "#ff0000"}}}),
        )
        .expect("首次改色不能因 null 分组失败");
        let overrides = &updated.sticker.as_ref().unwrap().fill_overrides;
        assert_eq!(overrides.len(), 1);
        assert_eq!(
            overrides.get("#112233").map(String::as_str),
            Some("#ff0000")
        );

        // 第二次：把已有的一组改回原色（null 删键）、另一组换色。
        let updated = patch_element(
            &mut document,
            "st-1",
            &json!({"sticker": {"fillOverrides": {"#112233": null, "#445566": "#00ff00"}}}),
        )
        .unwrap();
        let overrides = &updated.sticker.as_ref().unwrap().fill_overrides;
        assert_eq!(overrides.len(), 1);
        assert_eq!(
            overrides.get("#445566").map(String::as_str),
            Some("#00ff00")
        );
    }

    /// 标量位置遇到对象补丁：先立空对象再合并，`null` 同样不落地。
    #[test]
    fn merge_patch_replaces_a_scalar_with_a_fresh_object() {
        let mut target = json!({"a": 1});
        merge_patch(&mut target, &json!({"a": {"x": null, "y": 2}}));
        assert_eq!(target, json!({"a": {"y": 2}}));
        let mut target = json!({"a": {"x": 1}});
        merge_patch(&mut target, &json!({"a": 3}));
        assert_eq!(target, json!({"a": 3}));
    }

    #[test]
    fn reorder_moves_within_the_track_and_rejects_out_of_range() {
        let mut document = TimelineDocument::default();
        add_element(&mut document, "text", None, text("el-1", None)).unwrap();
        add_element(&mut document, "text", None, text("el-2", None)).unwrap();
        add_element(&mut document, "text", None, text("el-3", None)).unwrap();

        // 「移到最前」= 挪到数组末尾（数组顺序就是 z 序，越靠后越靠上）。
        let (id, track_id, from) = reorder_element(&mut document, "el-1", 2).unwrap();
        assert_eq!((id.as_str(), track_id.as_str(), from), ("el-1", "text", 0));
        let order: Vec<&str> = document.tracks[0]
            .elements
            .iter()
            .map(|element| element.id.as_str())
            .collect();
        assert_eq!(order, ["el-2", "el-3", "el-1"]);

        // 原地不动是合法的 no-op。
        reorder_element(&mut document, "el-3", 1).unwrap();
        assert_eq!(document.tracks[0].elements[1].id, "el-3");

        // 越界与锁轨都拒绝。
        assert!(reorder_element(&mut document, "el-1", 3).is_err());
        document.tracks[0].locked = true;
        assert!(reorder_element(&mut document, "el-1", 0).is_err());
    }

    #[test]
    fn move_to_another_track_lands_at_the_requested_layer() {
        let mut document = TimelineDocument::default();
        add_element(&mut document, "a", None, text("el-1", None)).unwrap();
        add_element(&mut document, "b", None, text("el-2", None)).unwrap();
        add_element(&mut document, "b", None, text("el-3", None)).unwrap();

        // 挪进 b 的最底层。
        let (id, from, index) = move_element_to_track(&mut document, "el-1", "b", 0).unwrap();
        assert_eq!((id.as_str(), from.as_str(), index), ("el-1", "a", 0));
        assert!(document.tracks[0].elements.is_empty());
        let order: Vec<&str> = document.tracks[1]
            .elements
            .iter()
            .map(|element| element.id.as_str())
            .collect();
        assert_eq!(order, ["el-1", "el-2", "el-3"]);

        // 同一条轨 = 轨内重排。
        move_element_to_track(&mut document, "el-1", "b", 2).unwrap();
        assert_eq!(document.tracks[1].elements[2].id, "el-1");

        // 不存在的轨、越界、锁轨、种类不符都拒绝。
        assert!(matches!(
            move_element_to_track(&mut document, "el-1", "missing", 0),
            Err(TimelineError::Unmapped(_))
        ));
        assert!(move_element_to_track(&mut document, "el-1", "a", 1).is_err());
        document.tracks.push(Track {
            id: "audio".to_owned(),
            kind: TrackKind::Audio,
            name: None,
            hidden: false,
            locked: false,
            muted: false,
            elements: Vec::new(),
        });
        assert!(move_element_to_track(&mut document, "el-1", "audio", 0).is_err());
        document.tracks[0].locked = true;
        assert!(move_element_to_track(&mut document, "el-1", "a", 0).is_err());
    }

    #[test]
    fn locked_and_kind_mismatched_tracks_reject_mutation() {
        let mut document = TimelineDocument::default();
        add_element(&mut document, "text", None, text("el-1", None)).unwrap();
        document.tracks[0].locked = true;
        assert!(patch_element(&mut document, "el-1", &json!({"text":"No"})).is_err());
        assert!(remove_element(&mut document, "el-1").is_err());
    }
    fn audio(id: &str, start: f64, end: f64, src_start: f64) -> Element {
        use crate::schema::TimeValue;
        let mut element = text(id, Some("Music"));
        element.kind = ElementKind::Audio;
        element.role = None;
        element.text = None;
        element.src_id = Some("src-a".to_owned());
        element.start = Some(TimeValue::Seconds(start));
        element.end = Some(TimeValue::Seconds(end));
        element.src_start = Some(src_start);
        element.rate = Some(2.0);
        element.volume = Some(0.5);
        element
    }

    #[test]
    fn split_then_join_restores_the_original_element() {
        let mut document = TimelineDocument::default();
        document.sources.insert(
            "src-a".to_owned(),
            crate::schema::Source {
                path: Some("/music.m4a".to_owned()),
                kind: Some(crate::schema::SourceKind::Audio),
                duration: Some(60.0),
                ..crate::schema::Source::default()
            },
        );
        add_element(&mut document, "audio", None, audio("el-1", 10.0, 20.0, 3.0)).unwrap();
        let original = document.tracks[0].elements[0].clone();
        assert!(split_point_inside(10.0, Some(20.0), 12.0, 0.5));
        assert!(!split_point_inside(10.0, Some(20.0), 10.2, 0.5));
        assert!(!split_point_inside(10.0, Some(20.0), 19.9, 0.5));
        assert!(
            split_point_inside(10.0, None, 19.9, 0.5),
            "跟片尾只查左边界"
        );

        let right = split_element(&mut document, "el-1", (10.0, 20.0), 12.0, "el-1-2").unwrap();
        assert_eq!(right.src_start, Some(7.0), "srcStart 前进 (12 − 10) × 2");
        assert!(split_element(&mut document, "el-1", (10.0, 20.0), 11.0, "el-1-2").is_err());
        let elements = &document.tracks[0].elements;
        assert_eq!(elements.len(), 2);
        assert_eq!(elements[1].id, "el-1-2", "右半紧挨在原件之上");

        let (left, right) = (elements[0].clone(), elements[1].clone());
        // 两种先后都合回原件：沿用时间上靠前那件的 id。
        for (a, a_span, b, b_span) in [
            (&left, (10.0, 12.0), &right, (12.0, 20.0)),
            (&right, (12.0, 20.0), &left, (10.0, 12.0)),
        ] {
            assert_eq!(join_elements(a, a_span, b, b_span, None).unwrap(), original);
        }
    }

    /// 0.12：关键帧按两半各自的窗口切开（百分比折回各自那一份、秒写法跟内容走，接缝补一帧
    /// 取样值），闪避与静态音量照抄；合回去逐字还原——包括带缓动的段、恰好落在切点上的原有帧、
    /// 跟片尾的元素。不是同一次分割切出来的关键帧不能悄悄拼，要 `keep`。
    #[test]
    fn split_then_join_restores_keyframes_and_duck() {
        use crate::schema::TimeValue;
        let mut document = TimelineDocument::default();
        document.sources.insert(
            "src-a".to_owned(),
            crate::schema::Source {
                path: Some("/music.m4a".to_owned()),
                kind: Some(crate::schema::SourceKind::Audio),
                duration: Some(60.0),
                ..crate::schema::Source::default()
            },
        );
        let mut music = audio("bgm", 10.0, 20.0, 3.0);
        music.duck =
            Some(serde_json::from_value(json!({"under": "speech", "depth": 12.0})).unwrap());
        music.keyframes = Some(
            serde_json::from_value(json!({"volume": [
                {"t": "0%", "v": 0.2},
                {"t": "50%", "v": 1.0, "ease": "easeInOutCubic"},
                {"t": "100%", "v": 0.4}
            ]}))
            .unwrap(),
        );
        let mut title = text("title", Some("Title"));
        title.start = Some(TimeValue::Seconds(10.0));
        title.keyframes = Some(
            serde_json::from_value(json!({
                "x": [{"t": 0.0, "v": 10.0}, {"t": 2.0, "v": 50.0}, {"t": 6.0, "v": 90.0, "ease": "easeOutQuad"}],
                "opacity": [{"t": "0%", "v": 0.0}, {"t": "25%", "v": 1.0}]
            }))
            .unwrap(),
        );
        add_element(&mut document, "audio", None, music).unwrap();
        add_element(&mut document, "text", None, title).unwrap();

        // 音乐在 14 秒（本地 4 秒，40%）切；文字跟片尾（按 30 秒解算），在 12 秒——恰好是
        // x 的一帧——切。
        for (id, span, at) in [("bgm", (10.0, 20.0), 14.0), ("title", (10.0, 30.0), 12.0)] {
            let original = document
                .tracks
                .iter()
                .flat_map(|track| &track.elements)
                .find(|element| element.id == id)
                .unwrap()
                .clone();
            let new_id = format!("{id}-2");
            let right = split_element(&mut document, id, span, at, &new_id).unwrap();
            let left = document
                .tracks
                .iter()
                .flat_map(|track| &track.elements)
                .find(|element| element.id == id)
                .unwrap()
                .clone();
            assert_eq!(left.duck, original.duck, "闪避两半照抄");
            assert_eq!(right.duck, original.duck);
            assert_ne!(left.keyframes, original.keyframes, "关键帧按新窗口改写");
            if id == "bgm" {
                let volume = |element: &Element| {
                    serde_json::to_value(element.keyframes.as_ref().unwrap().get("volume").unwrap())
                        .unwrap()
                };
                // 左半是原来的 0–40%：50% 那帧落在右半，接缝补取样值。
                assert_eq!(volume(&left)[0], json!({"t": "0%", "v": 0.2}));
                assert_eq!(volume(&left)[1]["t"], json!("100%"));
                assert_eq!(volume(&right)[0]["t"], json!("0%"));
                assert_eq!(
                    volume(&right)[1]["t"],
                    json!("16.6667%"),
                    "原 50% = 右半 1/6"
                );
            }
            let left_span = (span.0, at);
            let right_span = (at, span.1);
            let joined = join_elements(&left, left_span, &right, right_span, None).unwrap();
            assert_eq!(joined, original, "{id}：split→join 回原状");
            let swapped = join_elements(&right, right_span, &left, left_span, None).unwrap();
            assert_eq!(swapped, original);
            // 把两半撤回原样，下一件接着切。
            remove_element(&mut document, &new_id).unwrap();
            replace_element(&mut document, id, original).unwrap();
        }

        // 两件关键帧相同、但不是同一次分割切出来的：拼不回，算属性不一致，`keep` 取一边原样。
        let mut a = audio("a", 10.0, 12.0, 3.0);
        let ramp = serde_json::from_value::<crate::keyframes::Keyframes>(
            json!({"volume": [{"t": "0%", "v": 0.2}, {"t": "100%", "v": 1.0}]}),
        )
        .unwrap();
        a.keyframes = Some(ramp.clone());
        let mut b = audio("b", 12.0, 20.0, 7.0);
        b.keyframes = Some(ramp.clone());
        assert_eq!(
            join_elements(&a, (10.0, 12.0), &b, (12.0, 20.0), None),
            Err(JoinRefusal::Attributes {
                keys: vec!["keyframes".to_owned()]
            })
        );
        let kept =
            join_elements(&a, (10.0, 12.0), &b, (12.0, 20.0), Some(JoinKeep::Second)).unwrap();
        assert_eq!(kept.keyframes, Some(ramp));
    }

    #[test]
    fn join_refuses_gaps_other_sources_and_differing_attributes() {
        let left = audio("a", 10.0, 12.0, 3.0);
        let right = audio("b", 12.0, 20.0, 7.0);
        let spans = ((10.0, 12.0), (12.0, 20.0));

        let gapped = join_elements(&left, spans.0, &right, (12.5, 20.0), None);
        assert!(
            matches!(gapped, Err(JoinRefusal::NotAdjacent { gap }) if (gap - 0.5).abs() < 1e-9)
        );

        let mut other = right.clone();
        other.src_id = Some("src-b".to_owned());
        assert_eq!(
            join_elements(&left, spans.0, &other, spans.1, Some(JoinKeep::Second)),
            Err(JoinRefusal::Source { key: "srcId" })
        );

        let mut jumped = right.clone();
        jumped.src_start = Some(9.0);
        assert!(matches!(
            join_elements(&left, spans.0, &jumped, spans.1, None),
            Err(JoinRefusal::SourceGap { expected, .. }) if (expected - 7.0).abs() < 1e-9
        ));

        let mut louder = right.clone();
        louder.volume = Some(0.8);
        assert_eq!(
            join_elements(&left, spans.0, &louder, spans.1, None),
            Err(JoinRefusal::Attributes {
                keys: vec!["volume".to_owned()]
            })
        );
        let kept = join_elements(&left, spans.0, &louder, spans.1, Some(JoinKeep::Second)).unwrap();
        assert_eq!((kept.id.as_str(), kept.volume), ("a", Some(0.8)));
        assert_eq!(kept.src_start, Some(3.0));
        assert_eq!(kept.end, right.end);
    }
}
