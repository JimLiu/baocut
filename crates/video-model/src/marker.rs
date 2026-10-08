//! 序列上的标记（视频格式规范 §3.13）。章节是 `kind: 'chapter'` 的标记。

use serde::{Deserialize, Serialize};

use crate::{Id, VersionRef};

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
