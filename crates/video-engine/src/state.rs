//! 视频的工作态：按实体保存（视频、序列、轨道、实例、转场、标记、闪避规则、素材、文档头、检查点、保护），
//! 快照时按顺序组装。事务在副本上执行，提交前与原状态逐实体比较得到变更集。

use std::collections::{BTreeMap, BTreeSet};

use editor_semantics::{Ratio, TIME_CONTRACT_VERSION, frame_time};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::error::{EngineResult, ErrorBody, kinds, msg};
use crate::model::*;

#[derive(Clone, Debug, PartialEq)]
pub struct SequenceEntity {
    pub header: SequenceHeader,
    /// 序列内任何实体（自身、轨道、实例）最后一次变化时的视频版本。
    pub revision: i64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Placed<T> {
    pub sequence_id: Id,
    pub value: T,
}

#[derive(Clone, Debug, PartialEq)]
pub struct VideoState {
    pub id: Id,
    pub name: String,
    pub root_sequence_id: Id,
    pub revision: i64,
    pub event_seq: i64,
    pub sequences: BTreeMap<Id, SequenceEntity>,
    pub tracks: BTreeMap<Id, Placed<Track>>,
    pub items: BTreeMap<Id, Placed<TimelineItem>>,
    pub transitions: BTreeMap<Id, Placed<Transition>>,
    pub markers: BTreeMap<Id, Placed<Marker>>,
    pub ducking: BTreeMap<Id, Placed<DuckingRule>>,
    pub assets: BTreeMap<Id, AssetRecord>,
    pub documents: BTreeMap<Id, DocumentRecord>,
    pub checkpoints: BTreeMap<Id, Checkpoint>,
    pub protections: BTreeMap<Id, ProtectionRecord>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EntityKind {
    Video,
    Sequence,
    Track,
    Item,
    Transition,
    Marker,
    Ducking,
    Asset,
    Document,
    Checkpoint,
    Protection,
}

impl EntityKind {
    pub fn as_str(self) -> &'static str {
        match self {
            EntityKind::Video => "video",
            EntityKind::Sequence => "sequence",
            EntityKind::Track => "track",
            EntityKind::Item => "item",
            EntityKind::Transition => "transition",
            EntityKind::Marker => "marker",
            EntityKind::Ducking => "ducking",
            EntityKind::Asset => "asset",
            EntityKind::Document => "document",
            EntityKind::Checkpoint => "checkpoint",
            EntityKind::Protection => "protection",
        }
    }

    pub fn parse(text: &str) -> Option<EntityKind> {
        Some(match text {
            "video" => EntityKind::Video,
            "sequence" => EntityKind::Sequence,
            "track" => EntityKind::Track,
            "item" => EntityKind::Item,
            "transition" => EntityKind::Transition,
            "marker" => EntityKind::Marker,
            "ducking" => EntityKind::Ducking,
            "asset" => EntityKind::Asset,
            "document" => EntityKind::Document,
            "checkpoint" => EntityKind::Checkpoint,
            "protection" => EntityKind::Protection,
            _ => return None,
        })
    }
}

/// 存储里的一行实体。`parent` 是轨道、实例、转场、标记与闪避规则所属的序列。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityRow {
    pub kind: EntityKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent: Option<Id>,
    pub body: Value,
}

/// 一个实体在一笔事务里的前后状态。撤销用它做补偿（命令与协议规范 §8.3）。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityChange {
    pub id: Id,
    pub kind: EntityKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent: Option<Id>,
    pub before: Option<Value>,
    pub after: Option<Value>,
}

fn to_value<T: Serialize>(value: &T) -> Value {
    serde_json::to_value(value).expect("实体总能序列化")
}

fn from_value<T: for<'de> Deserialize<'de>>(kind: EntityKind, id: &str, value: Value) -> EngineResult<T> {
    serde_json::from_value(value).map_err(|e| ErrorBody::unsupported_video(msg!(
            "engine.entityUnreadable",
            "The {kind} {id} in the video cannot be read: {error}",
            kind = kind.as_str(),
            id,
            error = e.to_string()
        )))
}

impl VideoState {
    /// 所有实体的存储形式。视频自身也是一个实体（名字、根序列）。
    pub fn entities(&self) -> BTreeMap<Id, EntityRow> {
        let mut rows = BTreeMap::new();
        rows.insert(
            self.id.clone(),
            EntityRow {
                kind: EntityKind::Video,
                parent: None,
                body: json!({ "name": self.name, "rootSequenceId": self.root_sequence_id }),
            },
        );
        for (id, seq) in &self.sequences {
            rows.insert(
                id.clone(),
                EntityRow {
                    kind: EntityKind::Sequence,
                    parent: None,
                    body: to_value(&seq.header),
                },
            );
        }
        for (id, track) in &self.tracks {
            rows.insert(
                id.clone(),
                EntityRow {
                    kind: EntityKind::Track,
                    parent: Some(track.sequence_id.clone()),
                    body: to_value(&track.value),
                },
            );
        }
        for (id, item) in &self.items {
            rows.insert(
                id.clone(),
                EntityRow {
                    kind: EntityKind::Item,
                    parent: Some(item.sequence_id.clone()),
                    body: to_value(&item.value),
                },
            );
        }
        for (kind, placed) in [
            (EntityKind::Transition, placed_rows(&self.transitions)),
            (EntityKind::Marker, placed_rows(&self.markers)),
            (EntityKind::Ducking, placed_rows(&self.ducking)),
        ] {
            for (id, parent, body) in placed {
                rows.insert(
                    id,
                    EntityRow {
                        kind,
                        parent: Some(parent),
                        body,
                    },
                );
            }
        }
        for (id, asset) in &self.assets {
            rows.insert(
                id.clone(),
                EntityRow {
                    kind: EntityKind::Asset,
                    parent: None,
                    body: to_value(asset),
                },
            );
        }
        for (id, document) in &self.documents {
            rows.insert(
                id.clone(),
                EntityRow {
                    kind: EntityKind::Document,
                    parent: None,
                    body: to_value(document),
                },
            );
        }
        for (id, checkpoint) in &self.checkpoints {
            rows.insert(
                id.clone(),
                EntityRow {
                    kind: EntityKind::Checkpoint,
                    parent: None,
                    body: to_value(checkpoint),
                },
            );
        }
        for (id, protection) in &self.protections {
            rows.insert(
                id.clone(),
                EntityRow {
                    kind: EntityKind::Protection,
                    parent: None,
                    body: to_value(protection),
                },
            );
        }
        rows
    }

    /// 写入或删除一个实体（加载存储与执行补偿时用）。
    pub fn put(&mut self, id: &str, kind: EntityKind, parent: Option<&str>, body: Option<Value>) -> EngineResult<()> {
        let parent_id = || -> EngineResult<Id> {
            parent
                .map(str::to_string)
                .ok_or_else(|| ErrorBody::unsupported_video(msg!(
                    "engine.entityNoSequence",
                    "The {kind} {id} has no parent sequence",
                    kind = kind.as_str(),
                    id
                )))
        };
        match (kind, body) {
            (EntityKind::Video, Some(body)) => {
                #[derive(Deserialize)]
                #[serde(rename_all = "camelCase")]
                struct Meta {
                    name: String,
                    root_sequence_id: Id,
                }
                let meta: Meta = from_value(kind, id, body)?;
                self.id = id.to_string();
                self.name = meta.name;
                self.root_sequence_id = meta.root_sequence_id;
            }
            (EntityKind::Video, None) => return Err(ErrorBody::invalid_operation(msg!("engine.videoNotDeletable", "The video itself cannot be deleted"))),
            (EntityKind::Sequence, Some(body)) => {
                let header = from_value(kind, id, body)?;
                let revision = self.sequences.get(id).map_or(self.revision, |s| s.revision);
                self.sequences.insert(id.to_string(), SequenceEntity { header, revision });
            }
            (EntityKind::Sequence, None) => {
                self.sequences.remove(id);
            }
            (EntityKind::Track, Some(body)) => {
                self.tracks.insert(
                    id.to_string(),
                    Placed {
                        sequence_id: parent_id()?,
                        value: from_value(kind, id, body)?,
                    },
                );
            }
            (EntityKind::Track, None) => {
                self.tracks.remove(id);
            }
            (EntityKind::Item, Some(body)) => {
                self.items.insert(
                    id.to_string(),
                    Placed {
                        sequence_id: parent_id()?,
                        value: from_value(kind, id, body)?,
                    },
                );
            }
            (EntityKind::Item, None) => {
                self.items.remove(id);
            }
            (EntityKind::Transition, Some(body)) => {
                self.transitions.insert(
                    id.to_string(),
                    Placed {
                        sequence_id: parent_id()?,
                        value: from_value(kind, id, body)?,
                    },
                );
            }
            (EntityKind::Transition, None) => {
                self.transitions.remove(id);
            }
            (EntityKind::Marker, Some(body)) => {
                self.markers.insert(
                    id.to_string(),
                    Placed {
                        sequence_id: parent_id()?,
                        value: from_value(kind, id, body)?,
                    },
                );
            }
            (EntityKind::Marker, None) => {
                self.markers.remove(id);
            }
            (EntityKind::Ducking, Some(body)) => {
                self.ducking.insert(
                    id.to_string(),
                    Placed {
                        sequence_id: parent_id()?,
                        value: from_value(kind, id, body)?,
                    },
                );
            }
            (EntityKind::Ducking, None) => {
                self.ducking.remove(id);
            }
            (EntityKind::Asset, Some(body)) => {
                self.assets.insert(id.to_string(), from_value(kind, id, body)?);
            }
            (EntityKind::Asset, None) => {
                self.assets.remove(id);
            }
            (EntityKind::Document, Some(body)) => {
                self.documents.insert(id.to_string(), from_value(kind, id, body)?);
            }
            (EntityKind::Document, None) => {
                self.documents.remove(id);
            }
            (EntityKind::Checkpoint, Some(body)) => {
                self.checkpoints.insert(id.to_string(), from_value(kind, id, body)?);
            }
            (EntityKind::Checkpoint, None) => {
                self.checkpoints.remove(id);
            }
            (EntityKind::Protection, Some(body)) => {
                self.protections.insert(id.to_string(), from_value(kind, id, body)?);
            }
            (EntityKind::Protection, None) => {
                self.protections.remove(id);
            }
        }
        Ok(())
    }

    /// 两个状态之间的变更集，按实体 ID 排序。
    pub fn diff(before: &VideoState, after: &VideoState) -> Vec<EntityChange> {
        let a = before.entities();
        let b = after.entities();
        let ids: BTreeSet<&Id> = a.keys().chain(b.keys()).collect();
        ids.into_iter()
            .filter_map(|id| {
                let (old, new) = (a.get(id), b.get(id));
                if old.map(|r| &r.body) == new.map(|r| &r.body) && old.map(|r| &r.parent) == new.map(|r| &r.parent) {
                    return None;
                }
                let row = new.or(old).expect("至少一边存在");
                Some(EntityChange {
                    id: id.clone(),
                    kind: row.kind,
                    parent: row.parent.clone(),
                    before: old.map(|r| r.body.clone()),
                    after: new.map(|r| r.body.clone()),
                })
            })
            .collect()
    }

    /// 变更涉及的序列：序列自身，以及轨道、实例、转场、标记与闪避规则变化前后所属的序列。
    pub fn touched_sequences(before: &VideoState, after: &VideoState, changes: &[EntityChange]) -> BTreeSet<Id> {
        let mut touched = BTreeSet::new();
        for change in changes {
            match change.kind {
                EntityKind::Sequence => {
                    touched.insert(change.id.clone());
                }
                EntityKind::Track => {
                    for state in [before, after] {
                        if let Some(t) = state.tracks.get(&change.id) {
                            touched.insert(t.sequence_id.clone());
                        }
                    }
                }
                EntityKind::Item => {
                    for state in [before, after] {
                        if let Some(i) = state.items.get(&change.id) {
                            touched.insert(i.sequence_id.clone());
                        }
                    }
                }
                EntityKind::Transition | EntityKind::Marker | EntityKind::Ducking => {
                    touched.extend(change.parent.clone());
                }
                _ => {}
            }
        }
        touched
    }

    pub fn sequence(&self, id: &str) -> EngineResult<&SequenceEntity> {
        self.sequences.get(id).ok_or_else(|| ErrorBody::not_found(kinds::sequence(), id))
    }

    pub fn tracks_of(&self, sequence_id: &str) -> Vec<&Track> {
        let mut tracks: Vec<&Track> = self
            .tracks
            .values()
            .filter(|t| t.sequence_id == sequence_id)
            .map(|t| &t.value)
            .collect();
        tracks.sort_by(|a, b| a.order.cmp(&b.order).then_with(|| a.id.cmp(&b.id)));
        tracks
    }

    /// 实例在序列上的精确起点与终点（秒）。
    pub fn item_range(&self, item: &TimelineItem, sequence_id: &str) -> EngineResult<(Ratio, Ratio)> {
        let fps = self.sequence(sequence_id)?.header.fps;
        item_range(item, fps)
    }

    /// 根序列的长度（帧）：所有实例精确终点的最大值向上取整（视频格式规范 §3.2 `derived`）。
    pub fn duration_frames(&self, sequence_id: &str) -> EngineResult<i64> {
        let fps = self.sequence(sequence_id)?.header.fps;
        let mut max = 0i64;
        for placed in self.items.values().filter(|i| i.sequence_id == sequence_id) {
            let (_, end) = item_range(&placed.value, fps)?;
            let frames = editor_semantics::frames_at(end, fps).ok_or_else(|| ErrorBody::time(overflow("duration")))?;
            max = max.max(frames.ceil() as i64);
        }
        Ok(max)
    }

    pub fn snapshot(&self) -> VideoSnapshot {
        let mut sequences = BTreeMap::new();
        for (id, seq) in &self.sequences {
            let tracks: Vec<Track> = self.tracks_of(id).into_iter().cloned().collect();
            let order: BTreeMap<&str, i64> = tracks.iter().map(|t| (t.id.as_str(), t.order)).collect();
            let mut items: Vec<(i64, Ratio, &TimelineItem)> = self
                .items
                .values()
                .filter(|i| &i.sequence_id == id)
                .map(|i| {
                    let start = item_range(&i.value, seq.header.fps).map(|r| r.0).unwrap_or(Ratio::ZERO);
                    (order.get(i.value.base().track_id.as_str()).copied().unwrap_or(0), start, &i.value)
                })
                .collect();
            items.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)).then_with(|| a.2.base().id.cmp(&b.2.base().id)));
            sequences.insert(
                id.clone(),
                Sequence {
                    id: id.clone(),
                    revision: seq.revision.to_string(),
                    header: seq.header.clone(),
                    tracks,
                    items: items.into_iter().map(|(_, _, item)| item.clone()).collect(),
                    transitions: placed_in(&self.transitions, id).cloned().collect(),
                    markers: {
                        let mut markers: Vec<Marker> = placed_in(&self.markers, id).cloned().collect();
                        markers.sort_by(|a, b| a.frame.cmp(&b.frame).then_with(|| a.id.cmp(&b.id)));
                        markers
                    },
                    ducking: placed_in(&self.ducking, id).cloned().collect(),
                },
            );
        }
        VideoSnapshot {
            format: VIDEO_FORMAT.to_string(),
            schema_version: SCHEMA_VERSION,
            time_contract_version: TIME_CONTRACT_VERSION,
            id: self.id.clone(),
            name: self.name.clone(),
            revision: self.revision.to_string(),
            root_sequence_id: self.root_sequence_id.clone(),
            sequences,
            assets: self.assets.clone(),
            documents: self.documents.clone(),
            fonts: BTreeMap::new(),
            localization_sets: BTreeMap::new(),
            canvas_variants: BTreeMap::new(),
            sync_groups: BTreeMap::new(),
            protections: self.protections.clone(),
            checkpoints: self.checkpoints.clone(),
            links: Vec::new(),
        }
    }
}

/// 属于序列的实体的存储行：`(id, 所属序列, body)`。
fn placed_rows<T: Serialize>(map: &BTreeMap<Id, Placed<T>>) -> Vec<(Id, Id, Value)> {
    map.iter()
        .map(|(id, placed)| (id.clone(), placed.sequence_id.clone(), to_value(&placed.value)))
        .collect()
}

/// 某个序列的实体，按 ID 排序。
pub fn placed_in<'a, T>(map: &'a BTreeMap<Id, Placed<T>>, sequence_id: &'a str) -> impl Iterator<Item = &'a T> + 'a {
    map.values().filter(move |p| p.sequence_id == sequence_id).map(|p| &p.value)
}

fn overflow(field: &str) -> editor_semantics::TimeError {
    editor_semantics::TimeError::Overflow { field: field.to_string() }
}

/// 实例的精确区间 [start, end)（秒）。视觉实例在帧网格上；音频实例是粗帧 + 余数 + 播放长度。
pub fn item_range(item: &TimelineItem, fps: editor_semantics::Rate) -> EngineResult<(Ratio, Ratio)> {
    let err = || ErrorBody::time(overflow("item"));
    match item {
        TimelineItem::Audio(audio) => {
            let start = audio_start(audio, fps)?;
            let end = start.checked_add(audio.play_duration.to_ratio("playDuration")?).ok_or_else(err)?;
            Ok((start, end))
        }
        other => {
            let span = other.span().expect("音频之外的实例都在帧网格上");
            let start = frame_time(span.from_frame as i128, fps).ok_or_else(err)?;
            let end = frame_time(span.end_frame() as i128, fps).ok_or_else(err)?;
            Ok((start, end))
        }
    }
}

pub fn audio_start(audio: &AudioItem, fps: editor_semantics::Rate) -> EngineResult<Ratio> {
    frame_time(audio.from_frame as i128, fps)
        .and_then(|t| t.checked_add(audio.subframe_offset.to_ratio("subframeOffset").ok()?))
        .ok_or_else(|| ErrorBody::time(overflow("fromFrame")))
}
