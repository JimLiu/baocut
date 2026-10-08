//! 转写正文的句子与原文指纹（视频格式规范 §5.2、§5.3；架构设计 §7.9）。
//!
//! 句子由字幕与翻译核心的 `derive_sentences` 从词派生（句末标点、停顿不少于 1.8 秒、换说话人、句内 80 词、
//! 分段与章节边界；隐藏的词不进句子），指纹是核心的 FNV 内容指纹。翻译、译文核对、配音与内容索引都经这里取句子，
//! 规则只有这一份：原生的调用方直接链接，界面与 Node 经 `bindings/editor-wasm`。
//!
//! 正文里存下的 `sentences` 不参与：句子总是按核心的规则从词得出。时间不经浮点：句子的起止取首词与末词在正文里的刻度。

use editor_semantics::MediaTime;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use speech_doc::sentence::{Sentence, derive_sentences};
use video_model::Id;
use video_model::speech::SpeechBody;

use crate::time::FRESH_TIMESCALE;
use crate::{BridgeError, MediaFacts, speech};

/// 句子派生规则的名字（进 `sourceBasis.editViewHash`）：字幕与翻译核心的 `derive_sentences`。
pub const SENTENCE_DERIVATION: &str = "speech-doc/sentences";

/// 一句原文。
#[derive(Clone, Debug, PartialEq)]
pub struct SourceSentence {
    /// `s-<首词 ID>`。
    pub id: Id,
    /// 句内可见的词，按词序。
    pub word_ids: Vec<Id>,
    pub text: String,
    /// 核心的内容指纹：`<词数>:<首词 ID>:<末词 ID>:<FNV-1a 的 36 进制>`。
    pub fingerprint: String,
    /// 首词的说话人；没有说话人时没有。不进指纹。
    pub speaker: Option<Id>,
    /// 首词的起点与末词的终点，正文 `timescale` 下的刻度。
    pub start: i64,
    pub end: i64,
}

/// 一份转写的全部句子。
#[derive(Clone, Debug, PartialEq)]
pub struct SourceSentences {
    pub derivation: &'static str,
    /// 正文的 `timescale`（没有时按 1 000 000）。
    pub timescale: i64,
    /// 派生规则与全部句子的 ID、指纹的摘要（`sourceBasis.editViewHash`）。
    pub edit_view_hash: String,
    /// 全文的内容指纹（核心的 `fingerprint`，算全部的词、含隐藏的）：与 `stages.asr` 同一种写法，比较二者就知道转写之后
    /// 有没有人改过原文（视频格式规范 §5.5，换用文稿的手工修改闸门）。
    pub content_fingerprint: String,
    pub sentences: Vec<SourceSentence>,
}

/// 转写正文的句子。正文不是 `baocut.speech/1`、词没有源时间或说话人不合法时报错。
pub fn source_sentences(body: &SpeechBody) -> Result<SourceSentences, BridgeError> {
    // 句子只看词、隐藏、分段与章节；素材的事实与语言不参与，用占位。
    let media = MediaFacts {
        asset_id: None,
        path: None,
        content_hash: String::new(),
        duration: MediaTime {
            ticks: "0".into(),
            timescale: 1,
        },
        sample_rate: None,
    };
    let doc = speech::to_doc(&media, None, body)?;
    let derived = derive_sentences(&doc, &[]);
    let sentences = derived
        .iter()
        .map(|sentence| {
            let first = &body.words[sentence.word_indices[0]];
            let last = &body.words[*sentence.word_indices.last().expect("句子至少有一个词")];
            let speaker = doc.words[sentence.word_indices[0]].sp.clone();
            SourceSentence {
                id: sentence.id.clone(),
                word_ids: sentence.word_indices.iter().map(|&i| body.words[i].id.clone()).collect(),
                text: sentence.source_text.clone(),
                fingerprint: sentence.src_fingerprint.clone(),
                speaker: (!speaker.is_empty()).then_some(speaker),
                // `to_doc` 已经确认每个词都有源时间。
                start: first.start.unwrap_or_default(),
                end: last.end.unwrap_or_default(),
            }
        })
        .collect();
    Ok(SourceSentences {
        derivation: SENTENCE_DERIVATION,
        timescale: body.timescale.unwrap_or(FRESH_TIMESCALE),
        edit_view_hash: edit_view_hash(&derived),
        content_fingerprint: speech_doc::fingerprint::fingerprint(&doc.words),
        sentences,
    })
}

/// `sourceBasis.editViewHash`：`'sha256:'` + `{"derivation":<规则名>,"sentences":[[<ID>,<指纹>],…]}` 的 UTF-8 的 sha256。
pub fn edit_view_hash(sentences: &[Sentence]) -> String {
    let pairs: Vec<Value> = sentences
        .iter()
        .map(|sentence| json!([sentence.id, sentence.src_fingerprint]))
        .collect();
    // 手写键序，不依赖 serde_json 的 Map 是否保序。
    let canonical = format!(
        "{{\"derivation\":{},\"sentences\":{}}}",
        Value::String(SENTENCE_DERIVATION.into()),
        Value::Array(pairs)
    );
    let digest = Sha256::digest(canonical.as_bytes());
    let hex: String = digest.iter().map(|byte| format!("{byte:02x}")).collect();
    format!("sha256:{hex}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body(value: Value) -> SpeechBody {
        serde_json::from_value(value).unwrap()
    }

    #[test]
    fn derives_with_the_core_rules_and_keeps_ticks_exact() {
        let speech = body(json!({
            "schema": "baocut.speech/1",
            "timescale": 1000,
            "words": [
                { "id": "w0", "start": 0, "end": 400, "text": "Hello", "speaker": "a" },
                { "id": "w1", "start": 500, "end": 900, "text": " there;", "speaker": "a" },
                { "id": "w2", "start": 1000, "end": 1300, "text": " friend", "speaker": "a" },
                // 1.7 秒的停顿不断句（核心是 1.8 秒）。
                { "id": "w3", "start": 3000, "end": 3200, "text": " one.", "speaker": "a" },
                { "id": "w4", "start": 3300, "end": 3500, "text": " Two", "speaker": "a" },
                { "id": "w5", "start": 3600, "end": 3700, "text": " hidden", "speaker": "a", "hidden": true },
                // 隐藏的词不算：上一个可见的词之后 1.9 秒，断句。
                { "id": "w6", "start": 5400, "end": 5600, "text": " three", "speaker": "a" },
                { "id": "w7", "start": 5700, "end": 5900, "text": " four" }
            ],
            "sentences": [{ "id": "stored", "wordIds": ["w0"] }]
        }));
        let result = source_sentences(&speech).unwrap();
        assert_eq!(result.derivation, SENTENCE_DERIVATION);
        assert_eq!(result.timescale, 1000);
        let ids: Vec<&str> = result.sentences.iter().map(|s| s.id.as_str()).collect();
        // 分号不断句；存下的句子不参与；换说话人断句。
        assert_eq!(ids, ["s-w0", "s-w4", "s-w6", "s-w7"]);
        let first = &result.sentences[0];
        assert_eq!(first.word_ids, ["w0", "w1", "w2", "w3"]);
        assert_eq!(first.text, "Hello there; friend one.");
        assert!(first.fingerprint.starts_with("4:w0:w3:"), "{}", first.fingerprint);
        assert_eq!(first.speaker.as_deref(), Some("a"));
        assert_eq!((first.start, first.end), (0, 3200));
        assert_eq!(result.sentences[1].word_ids, ["w4"]);
        assert_eq!(result.sentences[3].speaker, None);
        assert!(result.edit_view_hash.starts_with("sha256:"));
        // 全文指纹算全部的词（含隐藏的），与 `stages.asr` 同一种写法。
        assert!(result.content_fingerprint.starts_with("8:w0:w7:"), "{}", result.content_fingerprint);
    }

    #[test]
    fn rejects_bodies_the_core_cannot_read() {
        let missing_time = body(json!({ "schema": "baocut.speech/1", "words": [{ "id": "w0", "text": "x" }] }));
        assert!(source_sentences(&missing_time).is_err());
        let other = body(json!({ "schema": "baocut.caption/1", "words": [] }));
        assert!(source_sentences(&other).is_err());
    }
}
