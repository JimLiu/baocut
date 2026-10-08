//! 识别提示（ASR initial prompt / context）的**能力表与载体**。
//!
//! 「吃不吃得下提示」是语音模型自己的属性，不是一个可以到处打开的开关：后端自报的
//! `hint_kind` 与这张表说的必须是同一件事。
//!
//! 移植自 v2 `bcut-speech-core`。v2 的 `hint_kind` 是识别 trait 的方法；v3 的
//! [`SpeechRecognizer`](super::SpeechRecognizer) 还没有它，接入 Whisper / MOSS 的批次再加。
//! v2 在编辑器纯层另有一张同内容的孪生表并由对拍测试守着；v3 目前只有这一张。

/// **能力门**：吃不吃提示由语音模型说了算。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HintKind {
    /// Whisper 系的 initial prompt，篇幅有限。模型把它当成**前文**来读，不是指令。
    Prompt,
    /// Qwen3-ASR 的上下文文本，宽得多；可以写这段录音在讲什么。
    Context,
    /// 这只模型没有提示通道，开关对它无效——页面要直说而不是假装生效。
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AsrHint {
    pub kind: HintKind,
    /// 预算（字符数）。`None` 档是 0。
    pub budget: usize,
}

impl AsrHint {
    pub fn supported(self) -> bool {
        self.kind != HintKind::None
    }
}

/// 逐只模型判。判据写在这里而不是模型目录里：目录是「装了什么」，这是「吃不吃得下」，
/// 两件事换代的节奏不同。
pub fn asr_hint(model_id: &str) -> AsrHint {
    let id = model_id.to_ascii_lowercase();
    // 云端 STT 的 id 带家族前缀（`cloud:openai/gpt-4o-transcribe`），本地的不带；
    // 取最后一段再判，免得前缀参与匹配。
    let leaf = id.rsplit(['/', ':']).next().unwrap_or(id.as_str());
    // **不能**只看「含 -transcribe」：本地的 `moss-transcribe-diarize` 也含它，
    // 而 MOSS 根本不收提示。OpenAI 那一族是 `gpt-*-transcribe` 的后缀形。
    let openai_transcribe = leaf.starts_with("gpt-") && leaf.ends_with("-transcribe");
    if leaf.starts_with("whisper") || openai_transcribe {
        AsrHint {
            kind: HintKind::Prompt,
            budget: PROMPT_BUDGET,
        }
    } else if leaf.contains("qwen3-asr") {
        AsrHint {
            kind: HintKind::Context,
            budget: CONTEXT_BUDGET,
        }
    } else {
        AsrHint {
            kind: HintKind::None,
            budget: 0,
        }
    }
}

/// Whisper 的 initial prompt 在解码器里占 KV 缓存，上限约 224 token；按字符报的
/// 预算取保守的 180，留出语言/任务那三个 token 与 CJK 的一字多 token。
pub const PROMPT_BUDGET: usize = 180;
/// Qwen3-ASR 的上下文写进 system 段，篇幅宽得多。
pub const CONTEXT_BUDGET: usize = 1_200;

/// 送进语音后端的那一份提示。
///
/// `kind` 记的是**调用方按哪条通道拼的**（预算不同，拼出来的长度不同）；真正吃不吃
/// 得下以后端的 `hint_kind` 为准——后端是权威，不匹配不是错误，
/// 而是「这一只忽略它」，由编排层报出来。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TranscribeHint {
    pub kind: HintKind,
    pub text: String,
}

impl TranscribeHint {
    /// 按模型 id 的能力拼一份；文本为空或这只模型没有通道时是 `None`——
    /// 空提示与「没给提示」必须无法区分，否则后端会为一串空白改变解码。
    pub fn for_model(model_id: &str, text: &str) -> Option<Self> {
        let text = text.trim();
        if text.is_empty() {
            return None;
        }
        let hint = asr_hint(model_id);
        hint.supported().then(|| Self {
            kind: hint.kind,
            text: text.to_owned(),
        })
    }

    pub fn as_str(&self) -> &str {
        &self.text
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_capability_table_reads_the_last_id_segment() {
        assert_eq!(asr_hint("whisper-large-v3").kind, HintKind::Prompt);
        assert_eq!(asr_hint("gpt-4o-transcribe").kind, HintKind::Prompt);
        assert_eq!(asr_hint("cloud:openai/gpt-4o-mini-transcribe").kind, HintKind::Prompt);
        assert_eq!(asr_hint("cloud:openai/whisper-1").kind, HintKind::Prompt);
        assert_eq!(asr_hint("qwen3-asr-0.6b").kind, HintKind::Context);
        assert_eq!(asr_hint("cloud:dashscope/qwen3-asr-flash").kind, HintKind::Context);
        // 名字里有 transcribe 但根本不收提示的那一只。
        assert_eq!(asr_hint("moss-transcribe-diarize").kind, HintKind::None);
        assert_eq!(asr_hint("moss-transcribe-diarize").budget, 0);
    }

    #[test]
    fn an_empty_prompt_is_indistinguishable_from_no_prompt() {
        assert!(TranscribeHint::for_model("whisper-large-v3", "   \n ").is_none());
        assert!(TranscribeHint::for_model("moss-transcribe-diarize", "威科夫").is_none());
        let hint = TranscribeHint::for_model("qwen3-asr-0.6b", "  威科夫、量价  ").unwrap();
        assert_eq!(hint.kind, HintKind::Context);
        assert_eq!(hint.as_str(), "威科夫、量价");
    }
}
