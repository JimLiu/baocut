//! 闪避（视频格式规范 §3.9）：有人说话时，或触发组里的实例发声时，把目标组压低 `depth` dB。
//!
//! 按时间线上的区间算，不看信号电平：结果只取决于时间线，逐帧确定，预览与导出一致。曲线（区间合并、
//! 四点展开、线性增益插值）取 v2 的 `timeline::duck`；区间与缺省取 `timeline::duck` 的常量。

use editor_semantics::MediaTime;
use serde::{Deserialize, Serialize};

use crate::Id;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuckingRule {
    pub id: Id,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub enabled: bool,
    /// 什么时候压低：有人说话时，或这些实例发声时。
    pub trigger: DuckingTrigger,
    /// 被压低的轨道或实例。
    pub target: DuckingGroup,
    /// 压低的 dB，[0, 60]，缺省 10。
    pub depth: f64,
    /// 触发开始之前多久开始下降，[0, 5] 秒。
    pub attack: MediaTime,
    /// 触发结束之后多久恢复，[0, 5] 秒。
    pub release: MediaTime,
}

/// 闪避的触发。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum DuckingTrigger {
    /// 按文稿：当前有效词流里每个词在序列上的区间。
    Speech,
    /// 按实例：组里这些实例发声的区间。
    Items(DuckingGroup),
}

impl DuckingTrigger {
    /// 按实例触发时的组；按文稿触发没有。
    pub fn group(&self) -> Option<&DuckingGroup> {
        match self {
            DuckingTrigger::Speech => None,
            DuckingTrigger::Items(group) => Some(group),
        }
    }

    pub fn group_mut(&mut self) -> Option<&mut DuckingGroup> {
        match self {
            DuckingTrigger::Speech => None,
            DuckingTrigger::Items(group) => Some(group),
        }
    }
}

/// 一组轨道与实例。轨道包括它上面所有的实例；指向已经不存在的轨道或实例时那一项不起作用。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuckingGroup {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub track_ids: Vec<Id>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub item_ids: Vec<Id>,
}

impl DuckingGroup {
    pub fn is_empty(&self) -> bool {
        self.track_ids.is_empty() && self.item_ids.is_empty()
    }

    /// 实例是否在这一组里：实例本身被点名，或它所在的轨道被点名。
    pub fn contains(&self, item_id: &str, track_id: &str) -> bool {
        self.item_ids.iter().any(|id| id == item_id) || self.track_ids.iter().any(|id| id == track_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn triggers_round_trip() {
        let speech = json!({ "kind": "speech" });
        let items = json!({ "kind": "items", "trackIds": ["t1"] });
        let a: DuckingTrigger = serde_json::from_value(speech.clone()).unwrap();
        let b: DuckingTrigger = serde_json::from_value(items.clone()).unwrap();
        assert_eq!(a, DuckingTrigger::Speech);
        assert_eq!(serde_json::to_value(&a).unwrap(), speech);
        assert_eq!(serde_json::to_value(&b).unwrap(), items);
        assert!(b.group().is_some_and(|g| g.contains("x", "t1")));
    }
}
