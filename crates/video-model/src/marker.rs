//! 序列上的标记（视频格式规范 §3.13）。章节是 `kind: 'chapter'` 的标记。

use serde::{Deserialize, Serialize};

use crate::{ChapterTextProps, Id, VersionRef};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Marker {
    pub id: Id,
    /// 序列帧。固定在序列时间上，不跟着实例移动。
    pub frame: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_frames: Option<i64>,
    /// 标记的文字；章节的标题。
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<MarkerKind>,
    /// 章节的简介。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    /// 章节的缩略图：一个图片素材版本。省略时界面用章节开始那一帧的画面。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thumbnail: Option<VersionRef>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MarkerKind {
    Chapter,
    Note,
    Todo,
}

impl Marker {
    pub fn is_chapter(&self) -> bool {
        self.kind == Some(MarkerKind::Chapter)
    }
}

/// 序列的一章（§3.13）：第几章（从 0 起）、共几章、它的标记与帧区间。`end_frame` 为 `None` 时开到序列终点。
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ChapterRange<'a> {
    pub index: usize,
    pub count: usize,
    pub marker: &'a Marker,
    pub from_frame: i64,
    pub end_frame: Option<i64>,
}

impl ChapterRange<'_> {
    pub fn covers(&self, frame: i64) -> bool {
        frame >= self.from_frame && self.end_frame.is_none_or(|end| frame < end)
    }
}

/// 序列的章节表：章节标记按帧排序，每一章从它的帧起，到它自己的 `durationFrames`（大于 0 时）或下一章的帧为止，
/// 最后一章开到序列终点。模板层的章节条与章节文字（§3.7）用的是这一份分法。
pub fn chapter_ranges(markers: &[Marker]) -> Vec<ChapterRange<'_>> {
    let mut marks: Vec<&Marker> = markers.iter().filter(|m| m.is_chapter()).collect();
    marks.sort_by_key(|m| m.frame);
    let count = marks.len();
    marks
        .iter()
        .enumerate()
        .map(|(index, mark)| ChapterRange {
            index,
            count,
            marker: mark,
            from_frame: mark.frame,
            end_frame: match (mark.duration_frames, marks.get(index + 1)) {
                (Some(d), _) if d > 0 => Some(mark.frame.saturating_add(d)),
                (_, Some(next)) => Some(next.frame),
                _ => None,
            },
        })
        .collect()
}

/// 序列帧 `frame` 所在的那一章：几章重叠时取开始得晚的；不在任何一章里（第一章之前、没有章节、`durationFrames`
/// 留出的空档）时为 `None`。
pub fn chapter_at(markers: &[Marker], frame: i64) -> Option<ChapterRange<'_>> {
    chapter_ranges(markers).into_iter().rev().find(|c| c.covers(frame))
}

/// 章节文字（`TextItem.chapter`，§3.7）在序列帧 `frame` 上画的字；这一帧不画时为 `None`。
pub fn chapter_text(markers: &[Marker], frame: i64, props: &ChapterTextProps) -> Option<String> {
    let chapter = chapter_at(markers, frame)?;
    props.text_of(
        chapter.index,
        chapter.count,
        &chapter.marker.label,
        chapter.marker.summary.as_deref(),
    )
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn mark(id: &str, frame: i64, label: &str, summary: Option<&str>) -> Marker {
        Marker {
            id: id.into(),
            frame,
            duration_frames: None,
            label: label.into(),
            kind: Some(MarkerKind::Chapter),
            summary: summary.map(Into::into),
            thumbnail: None,
        }
    }

    fn props(value: serde_json::Value) -> ChapterTextProps {
        serde_json::from_value(value).unwrap()
    }

    #[test]
    fn chapter_text_follows_the_chapter_of_each_frame() {
        // 存的顺序不要紧；别的种类的标记不算章。
        let mut note = mark("n", 10, "note", None);
        note.kind = Some(MarkerKind::Note);
        let markers = vec![mark("c2", 300, "Second", None), note, mark("c1", 30, "First", Some("Opening."))];
        let title = props(json!({ "field": "title" }));
        assert_eq!(chapter_text(&markers, 0, &title), None, "第一章之前不画");
        assert_eq!(chapter_text(&markers, 29, &title), None);
        assert_eq!(chapter_text(&markers, 30, &title).as_deref(), Some("First"));
        assert_eq!(chapter_text(&markers, 299, &title).as_deref(), Some("First"));
        assert_eq!(chapter_text(&markers, 300, &title).as_deref(), Some("Second"));
        assert_eq!(
            chapter_text(&markers, 1_000_000, &title).as_deref(),
            Some("Second"),
            "最后一章开到序列终点"
        );
        let summary = props(json!({ "field": "summary" }));
        assert_eq!(chapter_text(&markers, 40, &summary).as_deref(), Some("Opening."));
        assert_eq!(chapter_text(&markers, 400, &summary), None, "没有摘要的章不画");
        let number = props(json!({ "field": "number", "numberFormat": "1/N" }));
        assert_eq!(chapter_text(&markers, 400, &number).as_deref(), Some("2/2"));
        assert_eq!(chapter_text(&[], 0, &number), None, "没有章节时不画");
    }

    #[test]
    fn a_chapter_with_its_own_length_leaves_a_gap_and_overlaps_go_to_the_later_one() {
        let mut first = mark("c1", 0, "First", None);
        first.duration_frames = Some(100);
        let markers = vec![first.clone(), mark("c2", 200, "Second", None)];
        let title = props(json!({ "field": "title" }));
        assert_eq!(chapter_text(&markers, 99, &title).as_deref(), Some("First"));
        assert_eq!(chapter_text(&markers, 100, &title), None, "durationFrames 留出的空档不画");
        first.duration_frames = Some(500);
        let markers = vec![first, mark("c2", 200, "Second", None)];
        assert_eq!(chapter_text(&markers, 250, &title).as_deref(), Some("Second"));
    }
}
