//! GPT-SoVITS v2 文本前端：对照上游 `RVC-Boss/GPT-SoVITS@48b1a0169a28`（MIT）的
//! `TTS_infer_pack/TextPreprocessor.py` 与 `text/` 逐层移植。上游 `chinese2.py` 默认开 G2PW，
//! 这里没有移植它的 ONNX 模型，走 `is_g2pw = False` 分支：多音字只靠 pypinyin 词组表。
//!
//! - 切句：`pre_seg_text`（`cut5`），见 `split`。
//! - 分段：中文请求对应上游 `language="zh"`（中英混排自动分段），英文请求整段按英文；上游用
//!   fast_langdetect 判语种，这里换成确定性的「规则 C」，见 `langseg`。
//! - 中文：`zh_normalization` → jieba 词性分词 → pypinyin + 变调 → opencpop 声韵母，产出 `word2ph`。
//! - 英文：`english.py`（inflect 数字读法、CMUdict / 姓名表、g2p_en 同形词、NLTK 词性、
//!   wordsegment 拆词、GRU 预测未登录词）。
//!
//! 词典与小模型经 `include_bytes!` 内嵌在 `data/`（约 11 MB），来源、许可与重新生成方法见
//! `data/README.md`；生成器与对拍脚本在 v2 仓库（`baocut-app`）的 `scripts/dev/gpt-sovits-text/`（没有带进 v3）。涉及的上游许可：
//! GPT-SoVITS MIT、PaddleSpeech Apache-2.0、jieba MIT、pypinyin MIT、CMUdict BSD、
//! g2p_en Apache-2.0、NLTK tagger MIT、wordsegment Apache-2.0、inflect MIT、split-lang MIT。

mod data;
mod en;
mod en_norm;
mod error;
mod gpb;
mod jieba;
mod langseg;
pub(crate) mod pinyin;
mod pychar;
mod split;
mod symbols;
mod tone_sandhi;
mod words;
mod zh;
mod zh_norm;

#[cfg(test)]
mod parity;
#[cfg(test)]
mod tests;

use anyhow::{Result, anyhow, bail};
use langseg::SegLang;

/// 前端语言模式。v2 移植只覆盖中文（含中英混排）与英文。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Language {
    Zh,
    En,
}

impl Language {
    /// 请求语言归一（`zh-Hans` / `zh_CN` / `chinese` → 中文，`en-US` / `english` → 英文）；
    /// 缺省或 `auto` 时按文本判断：含汉字为中文，其余为英文，含假名或韩文报错。
    pub fn resolve(requested: Option<&str>, text: &str) -> Result<Self> {
        let requested = requested
            .map(|language| language.trim().to_ascii_lowercase().replace('_', "-"))
            .filter(|language| !language.is_empty() && language != "auto");
        let Some(language) = requested else {
            return Self::detect(text);
        };
        match language.as_str() {
            "chinese" | "mandarin" | "cn" => return Ok(Self::Zh),
            "english" => return Ok(Self::En),
            _ => {}
        }
        match language.split('-').next() {
            Some("zh") => Ok(Self::Zh),
            Some("en") => Ok(Self::En),
            _ => bail!("GPT-SoVITS v2 只支持中文与英文，不支持「{language}」"),
        }
    }

    fn detect(text: &str) -> Result<Self> {
        // ・（U+30FB）与ー（U+30FC）也出现在中文外文译名里，不算假名
        let kana = |c: char| matches!(c, '\u{3041}'..='\u{3096}' | '\u{30A1}'..='\u{30FA}');
        let hangul = |c: char| matches!(c, '\u{AC00}'..='\u{D7AF}' | '\u{1100}'..='\u{11FF}');
        if text.chars().any(|c| kana(c) || hangul(c)) {
            bail!("GPT-SoVITS v2 只支持中文与英文，文本含日文假名或韩文：{text}");
        }
        let han = |c: char| matches!(c, '\u{3400}'..='\u{4DBF}' | '\u{4E00}'..='\u{9FFF}');
        Ok(if text.chars().any(han) { Self::Zh } else { Self::En })
    }

    fn terminal(self) -> &'static str {
        match self {
            Self::Zh => "。",
            Self::En => ".",
        }
    }

    fn seg_mode(self) -> SegLang {
        match self {
            Self::Zh => SegLang::Zh,
            Self::En => SegLang::En,
        }
    }
}

/// 一段同语言文本的音素结果；`word2ph` 只有中文段有（用来展开 BERT 特征）。
pub struct Piece {
    pub norm_text: String,
    pub phones: Vec<i32>,
    pub word2ph: Option<Vec<usize>>,
}

/// 参考文本：去掉首尾换行，末字不是切句标点时补「。」（英文补「.」）。
pub fn with_terminal_punctuation(text: &str, language: Language) -> String {
    let mut text = text.trim_matches('\n').to_owned();
    if !text.chars().last().is_some_and(split::is_split) {
        text.push_str(language.terminal());
    }
    text
}

/// 合成文本切句：连续标点只留第一个，再按 `cut5` 切并补句末标点。文本为空返回空列表，
/// 只剩标点或空白时报错。
pub fn split_sentences(text: &str, language: Language) -> Result<Vec<String>> {
    split::pre_seg_text(&split::replace_consecutive_punctuation(text), language == Language::En)
}

/// 一句文本 → 逐段音素 id（音素少于 6 个时与上游一样前补「.」重算一次）。
pub fn phonemize(text: &str, language: Language) -> Result<Vec<Piece>> {
    let segments =
        gpb::text_phones(text, language.seg_mode()).map_err(|err| anyhow!("GPT-SoVITS 文本前端无法处理（{}）：{text}", err.name()))?;
    Ok(segments
        .into_iter()
        .map(|segment| Piece {
            norm_text: segment.norm,
            phones: segment.ids.into_iter().map(|id| id as i32).collect(),
            word2ph: segment.word2ph,
        })
        .collect())
}
