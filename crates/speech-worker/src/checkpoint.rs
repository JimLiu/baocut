//! 检查点：staging 里的 `checkpoint.json`，外壳是核心的 [`PipelineStatus`]（指纹不符整份作废）。
//!
//! 翻译引擎本身是增量的：已有译文且 `transSrc` 新鲜的句子在非 force 轮跳过，每页之后回调一次（v2 的「doc 即续跑现场」）。
//! 所以检查点只存目标语言那几张表，续跑时放回 `TranscriptDoc` 再调引擎，完成的页不再发请求：
//!
//! - `translating`：简报已定（`brief`），`trans` / `transSrc` 每页之后写一次；
//! - `aligned`：主对齐完成，另存 `transDisplay` / `transAlign`，续跑跳过翻译与主对齐，从黏结收尾轮开始；
//! - `finished`：收尾轮也完成，续跑只重新写出产出。
//!
//! 以句子 ID 为持久单位（与核心的 `TranslateProgress` 同一口径），分页参数变了续跑仍然有效；`totalPages` / `processedPages`
//! 记的是句数。融合草稿不落盘：在 `translating` 与 `aligned` 之间中断时，续跑的主对齐对这些句子改发专门的对齐请求。

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use speech_doc::TranscriptDoc;
use speech_doc::doc::{TransAlign, TransDisplay};
use speech_doc::engines::brief::DocumentBrief;
use speech_doc::progress::PipelineStatus;

use crate::Failure;

pub const CHECKPOINT_FILE: &str = "checkpoint.json";

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Phase {
    /// 还没定简报。
    #[default]
    Brief,
    Translating,
    Aligned,
    Finished,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslateCheckpoint {
    pub phase: Phase,
    /// 定下的简报；生成失败或跳过且没有术语时 null。
    pub brief: Option<DocumentBrief>,
    /// 已经发过的翻译页数（含之前的尝试）。
    pub pages: u32,
    pub trans: BTreeMap<String, String>,
    pub trans_src: BTreeMap<String, String>,
    pub trans_display: BTreeMap<String, TransDisplay>,
    pub trans_align: BTreeMap<String, TransAlign>,
}

pub struct Checkpoints {
    path: PathBuf,
    key: String,
}

impl Checkpoints {
    pub fn new(staging: &Path, key: String) -> Checkpoints {
        Checkpoints {
            path: staging.join(CHECKPOINT_FILE),
            key,
        }
    }

    /// 读上次留下的检查点；没有、读不懂或指纹不符时 None（不符的那份留着，下次保存时覆盖）。
    pub fn load(&self) -> Option<TranslateCheckpoint> {
        let bytes = std::fs::read(&self.path).ok()?;
        PipelineStatus::<TranslateCheckpoint>::resume(&bytes, &self.key).map(|status| status.custom)
    }

    /// 原子地写一份：先写临时文件再改名，中途被杀不留半份。
    pub fn save(&self, checkpoint: &TranslateCheckpoint, total_sentences: usize) -> Result<(), Failure> {
        let mut status = PipelineStatus::new(self.key.clone(), total_sentences as u32, checkpoint.clone());
        status.processed_pages = (checkpoint.trans.len() as u32).min(status.total_pages);
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, status.to_bytes())
            .and_then(|()| std::fs::rename(&tmp, &self.path))
            .map_err(|error| Failure::new("STAGING_WRITE_FAILED", format!("检查点写不进 staging：{error}")))
    }
}

impl TranslateCheckpoint {
    /// 把检查点里的表放回文档（目标语言那一格）。
    pub fn restore(&self, doc: &mut TranscriptDoc, lang: &str) {
        if !self.trans.is_empty() {
            doc.trans.insert(lang.to_owned(), self.trans.clone());
            doc.trans_src.insert(lang.to_owned(), self.trans_src.clone());
        }
        if matches!(self.phase, Phase::Aligned | Phase::Finished) {
            if !self.trans_display.is_empty() {
                doc.trans_display.insert(lang.to_owned(), self.trans_display.clone());
            }
            if !self.trans_align.is_empty() {
                doc.trans_align.insert(lang.to_owned(), self.trans_align.clone());
            }
        }
    }

    /// 从文档取目标语言那几张表。
    pub fn capture(&mut self, doc: &TranscriptDoc, lang: &str, with_alignment: bool) {
        self.trans = doc.trans.get(lang).cloned().unwrap_or_default();
        self.trans_src = doc.trans_src.get(lang).cloned().unwrap_or_default();
        if with_alignment {
            self.trans_display = doc.trans_display.get(lang).cloned().unwrap_or_default();
            self.trans_align = doc.trans_align.get(lang).cloned().unwrap_or_default();
        }
    }
}
