//! `ai/<stage>/manifest.json` 的 serde 类型（§4.2）。
//!
//! core 不产生时间戳：`RunRecord::at` 由宿主填入。

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::common::{PROTOCOL_VERSION, Problem};

/// 阶段/页的执行状态。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum RunStatus {
    /// 尚未开始。
    #[default]
    Pending,
    /// 进行中。
    Running,
    /// 已完成。
    Done,
    /// 已失败（问题写在 `problems`）。
    Failed,
}

impl RunStatus {
    /// 机器可读串。
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Running => "running",
            Self::Done => "done",
            Self::Failed => "failed",
        }
    }
}

/// 单页审计记录。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageRecord {
    /// 页 id（如 `p001`）。
    pub id: String,
    /// 页状态。
    pub status: RunStatus,
    /// 已尝试次数。
    #[serde(default)]
    pub attempts: u32,
    /// 输入文件名。
    pub src: String,
    /// 输出文件名（未完成时为 None）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub out: Option<String>,
    /// 最近一次解析的协议问题。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub problems: Vec<Problem>,
}

impl PageRecord {
    /// 构造待执行的页记录。
    pub fn pending(id: impl Into<String>, src: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            status: RunStatus::Pending,
            attempts: 0,
            src: src.into(),
            out: None,
            problems: Vec::new(),
        }
    }
}

/// 一次运行的审计记录。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunRecord {
    /// 宿主填入的时间戳（core 不取时钟）。
    pub at: String,
    /// 运行类型（`full` / `stale-only` / `targeted` …）。
    pub kind: String,
    /// 本次覆盖的句数（可选）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sentences: Option<usize>,
}

/// `manifest.json`。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    /// 阶段名。
    pub stage: String,
    /// 目标语（仅 translate/align 有）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lang: Option<String>,
    /// 阶段版本号（`v003` 的数字部分）。
    pub version: u32,
    /// 协议版本，恒为 [`PROTOCOL_VERSION`]。
    pub protocol_version: String,
    /// 输入指纹（词指纹 + 上游阶段戳）。
    pub input_fingerprint: String,
    /// 上游阶段版本（如 `{"context":"v001","polish":"v002"}`）。
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub parents: BTreeMap<String, String>,
    /// 模型标识。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// 阶段参数（如 `{"fit":16}`）。
    #[serde(default, skip_serializing_if = "serde_json::Map::is_empty")]
    pub params: serde_json::Map<String, serde_json::Value>,
    /// 分页审计表。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pages: Vec<PageRecord>,
    /// 运行历史。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub runs: Vec<RunRecord>,
    /// 阶段状态。
    pub status: RunStatus,
}

impl Manifest {
    /// 构造新 manifest（`protocolVersion` 自动填入）。
    pub fn new(
        stage: impl Into<String>,
        version: u32,
        input_fingerprint: impl Into<String>,
    ) -> Self {
        Self {
            stage: stage.into(),
            lang: None,
            version,
            protocol_version: PROTOCOL_VERSION.to_owned(),
            input_fingerprint: input_fingerprint.into(),
            parents: BTreeMap::new(),
            model: None,
            params: serde_json::Map::new(),
            pages: Vec::new(),
            runs: Vec::new(),
            status: RunStatus::Pending,
        }
    }

    /// 协议版本是否被本构建支持。
    pub fn protocol_supported(&self) -> bool {
        self.protocol_version == PROTOCOL_VERSION
    }

    /// 指纹是否与给定输入一致（不一致即需要重跑）。
    pub fn matches_input(&self, input_fingerprint: &str) -> bool {
        self.input_fingerprint == input_fingerprint
    }

    /// 尚未完成的页。
    pub fn unfinished_pages(&self) -> Vec<&PageRecord> {
        self.pages
            .iter()
            .filter(|page| page.status != RunStatus::Done)
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::filepipe::common::ProblemCode;

    #[test]
    fn manifest_round_trips_camel_case() {
        let mut manifest = Manifest::new("translate", 3, "1024:g1.0:g88.4:ab12cd");
        manifest.lang = Some("zh".to_owned());
        manifest.model = Some("provider:anthropic/claude-sonnet-5".to_owned());
        manifest
            .parents
            .insert("context".to_owned(), "v001".to_owned());
        manifest
            .parents
            .insert("polish".to_owned(), "v002".to_owned());
        manifest
            .params
            .insert("fit".to_owned(), serde_json::json!(16));
        let mut page = PageRecord::pending("p001", "p001.src.html");
        page.status = RunStatus::Done;
        page.attempts = 2;
        page.out = Some("p001.out.html".to_owned());
        manifest.pages.push(page);
        manifest.runs.push(RunRecord {
            at: "2026-08-13T00:00:00Z".to_owned(),
            kind: "stale-only".to_owned(),
            sentences: Some(12),
        });
        manifest.status = RunStatus::Done;

        let json = serde_json::to_string(&manifest).unwrap();
        assert!(json.contains("\"protocolVersion\":\"file-v1\""));
        assert!(json.contains("\"inputFingerprint\":\"1024:g1.0:g88.4:ab12cd\""));
        let decoded: Manifest = serde_json::from_str(&json).unwrap();
        assert_eq!(decoded, manifest);
        assert!(decoded.protocol_supported());
        assert!(decoded.matches_input("1024:g1.0:g88.4:ab12cd"));
        assert!(decoded.unfinished_pages().is_empty());
    }

    #[test]
    fn page_problems_serialize_with_codes() {
        let mut page = PageRecord::pending("p002", "p002.src.html");
        page.status = RunStatus::Failed;
        page.problems
            .push(Problem::sentence(ProblemCode::MissingId, "s-g1.0", "缺失"));
        let json = serde_json::to_string(&page).unwrap();
        assert!(json.contains("\"missing-id\""));
        let decoded: PageRecord = serde_json::from_str(&json).unwrap();
        assert_eq!(decoded.problems[0].code, ProblemCode::MissingId);
    }
}
