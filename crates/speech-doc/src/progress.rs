//! 断点续跑的进度状态（对拍 voice-ink `ProgressTracker` / `PipelineStatus`）。
//!
//! 纪律：分页边界不落盘（从指纹化词流确定性重导出）；进度只存已完成的最小
//! 状态；指纹不符整体作废；阶段完成必须删除 status 文件（宿主负责 I/O）。

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineStatus<T> {
    /// 输入词流指纹；不符直接作废。
    pub fingerprint: String,
    pub total_pages: u32,
    pub processed_pages: u32,
    /// 各阶段自定义：已提交段落 / 已译句 id 映射……
    pub custom: T,
}

impl<T: Serialize + DeserializeOwned> PipelineStatus<T> {
    pub fn new(fingerprint: impl Into<String>, total_pages: u32, custom: T) -> Self {
        Self {
            fingerprint: fingerprint.into(),
            total_pages,
            processed_pages: 0,
            custom,
        }
    }

    /// 从字节恢复；指纹不符返回 `None`（部分/过期状态绝不静默使用）。
    /// 页数校验因阶段而异：organize/segment 要求 `total_pages` 一致，
    /// translate 以句 id 为持久单位、分页变化无害——由调用方自行加判。
    pub fn resume(bytes: &[u8], fingerprint: &str) -> Option<Self> {
        let status: Self = serde_json::from_slice(bytes).ok()?;
        (status.fingerprint == fingerprint && status.processed_pages <= status.total_pages)
            .then_some(status)
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        serde_json::to_vec_pretty(self).expect("progress status serializes")
    }
}

/// 翻译阶段的自定义进度：**句 id 是持久单位**（分页参数变化后续跑仍有效）。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslateProgress {
    /// 句 id → 译文。
    pub translated_sentences: std::collections::BTreeMap<String, String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resume_rejects_fingerprint_mismatch() {
        let status = PipelineStatus::new("fp-1", 3, TranslateProgress::default());
        let bytes = status.to_bytes();
        assert!(PipelineStatus::<TranslateProgress>::resume(&bytes, "fp-1").is_some());
        assert!(PipelineStatus::<TranslateProgress>::resume(&bytes, "fp-2").is_none());
    }
}
