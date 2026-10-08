//! 源语言与译文内容的确定性质量门。
//!
//! 这里只做高精度、可解释的脚本与退化检测，不伪装成完整的统计语言识别器。
//! 规则宁可放过短句、专名与正常 code-switch，也不误杀它们；整页审计再聚合
//! 单句信号，抓住“整页原文复制/占位/错误脚本”这类灾难性输出。

use crate::atomize::{normalize_chars, spaced_script_letter};
use std::collections::BTreeMap;

/// 改动本常量会让翻译载体字节变化，从而自动失效 provider/agent 历史应答缓存。
pub const TRANSLATION_VALIDATOR_VERSION: u32 = 4;

/// 译文里连续多少个源文表意字符原样出现才算「一段没翻」：短于此的是专名、
/// 术语与正常的 code-switch（`KV cache 缓存`）。
const UNTRANSLATED_RUN_CHARS: usize = 6;

/// 译文整句照抄源文的一段时，那一段至少要有多少个空白分隔的词才算「残句
/// 照抄」：更短的是专名、片名与术语（`University of Toronto`）。
const COPIED_FRAGMENT_WORDS: usize = 4;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TranslationQualityCode {
    TargetLanguageMismatch,
    Placeholder,
    SourceCopy,
    TooShort,
}

impl TranslationQualityCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::TargetLanguageMismatch => "target-language-mismatch",
            Self::Placeholder => "translation-placeholder",
            Self::SourceCopy => "translation-source-copy",
            Self::TooShort => "translation-too-short",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TranslationQualityIssue {
    pub code: TranslationQualityCode,
    pub detail: String,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct Scripts {
    han: usize,
    kana: usize,
    hangul: usize,
    latin: usize,
    cyrillic: usize,
    arabic: usize,
    devanagari: usize,
    thai: usize,
    hebrew: usize,
}

impl Scripts {
    fn total(self) -> usize {
        self.han
            + self.kana
            + self.hangul
            + self.latin
            + self.cyrillic
            + self.arabic
            + self.devanagari
            + self.thai
            + self.hebrew
    }
}

fn scripts(text: &str) -> Scripts {
    let mut out = Scripts::default();
    for ch in text.chars() {
        let code = ch as u32;
        if matches!(code, 0x3400..=0x4dbf | 0x4e00..=0x9fff | 0xf900..=0xfaff) {
            out.han += 1;
        } else if matches!(code, 0x3040..=0x30ff | 0x31f0..=0x31ff) {
            out.kana += 1;
        } else if matches!(code, 0xac00..=0xd7af | 0x1100..=0x11ff | 0x3130..=0x318f) {
            out.hangul += 1;
        } else if ch.is_ascii_alphabetic() || matches!(code, 0x00c0..=0x024f) {
            out.latin += 1;
        } else if matches!(code, 0x0400..=0x052f) {
            out.cyrillic += 1;
        } else if matches!(code, 0x0600..=0x06ff | 0x0750..=0x077f | 0x08a0..=0x08ff) {
            out.arabic += 1;
        } else if matches!(code, 0x0900..=0x097f) {
            out.devanagari += 1;
        } else if matches!(code, 0x0e00..=0x0e7f) {
            out.thai += 1;
        } else if matches!(code, 0x0590..=0x05ff) {
            out.hebrew += 1;
        }
    }
    out
}

fn primary(lang: &str) -> String {
    lang.split(['-', '_'])
        .next()
        .unwrap_or(lang)
        .to_ascii_lowercase()
}

fn compact_word(text: &str) -> String {
    text.chars()
        .filter(|ch| ch.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn placeholder(text: &str) -> bool {
    matches!(
        compact_word(text).as_str(),
        "translation"
            | "translate"
            | "todo"
            | "tbd"
            | "na"
            | "none"
            | "null"
            | "placeholder"
            | "untranslated"
            | "待翻译"
            | "翻译"
    )
}

fn target_script_mismatch(target_lang: &str, text: &str) -> bool {
    let counts = scripts(text);
    let total = counts.total();
    if total < 4 {
        return false;
    }
    match primary(target_lang).as_str() {
        "zh" => counts.han == 0 && total >= 8,
        "ja" => counts.han + counts.kana == 0 && total >= 8,
        "ko" => counts.hangul == 0 && total >= 8,
        "ru" | "uk" | "bg" | "sr" | "mk" => counts.cyrillic == 0 && total >= 8,
        "ar" | "fa" | "ur" => counts.arabic == 0 && total >= 8,
        "hi" | "mr" | "ne" => counts.devanagari == 0 && total >= 8,
        "th" => counts.thai == 0 && total >= 8,
        "he" | "yi" => counts.hebrew == 0 && total >= 8,
        // 英文及大多数拉丁字母语言：允许数字、短专名和少量 code-switch；
        // 明显由另一套文字主导才拒绝。
        _ => {
            let foreign = total.saturating_sub(counts.latin);
            foreign >= 4 && foreign * 100 >= total * 45
        }
    }
}

/// 部分照抄：目标语言不用表意文字，译文却带着一段源文里原样存在的、至少
/// [`UNTRANSLATED_RUN_CHARS`] 个表意字符的连续文字（`毕业 5 年升职升不上去，
/// internal role transfer 没机会`）。脚本比例门抓不住这种半句没翻的输出：
/// 拉丁字母够多时它看起来「以目标脚本为主」。只有表意文字源→非表意目标这一
/// 对文字有此门；其余文字对（含表意目标里照抄的拉丁词，那常是专名与术语）
/// 不检查。返回那段照抄的文字。
fn untranslated_run(
    normalized_source: &str,
    target_lang: &str,
    normalized_target: &str,
) -> Option<String> {
    if matches!(
        primary(target_lang).as_str(),
        "zh" | "ja" | "ko" | "yue" | "cmn" | "wuu"
    ) {
        return None;
    }
    let ideograph = |ch: char| {
        let code = ch as u32;
        matches!(
            code,
            0x3400..=0x4dbf | 0x4e00..=0x9fff | 0xf900..=0xfaff | 0x3040..=0x30ff | 0xac00..=0xd7af
        )
    };
    let mut run = String::new();
    let mut runs = Vec::new();
    for ch in normalized_target.chars().chain(std::iter::once(' ')) {
        if ideograph(ch) {
            run.push(ch);
        } else if !run.is_empty() {
            runs.push(std::mem::take(&mut run));
        }
    }
    runs.into_iter().find(|run| {
        run.chars().count() >= UNTRANSLATED_RUN_CHARS && normalized_source.contains(run.as_str())
    })
}

/// 残句照抄：译文整句就是源文里一段连续的词（标点与大小写不计），至少
/// [`COPIED_FRAGMENT_WORDS`] 个空白分隔的词，源文其余部分没有出现——模型把
/// 源文的一截原样抄进了译文栏。与目标语言无关；词连写的文字（中日韩、泰文
/// 等）整句只有一个「词」，够不到门槛，表意文字源由 [`untranslated_run`] 管。
/// 半句译了半句照抄的输出不在此列：两种文字相同时，照抄的词与本该保留的
/// 专名、同形词没有确定性的分界。
fn copied_fragment(source: &str, translation: &str) -> bool {
    let words = |text: &str| -> Vec<String> {
        text.split_whitespace()
            .map(normalize_chars)
            .filter(|word| !word.is_empty())
            .collect()
    };
    let source = words(source);
    let translation = words(translation);
    translation.len() >= COPIED_FRAGMENT_WORDS
        && translation.len() < source.len()
        && source
            .windows(translation.len())
            .any(|window| window == translation.as_slice())
}

/// 单句翻译硬门。所有问题都必须在缓存写入与 transcript 提交之前处理。
pub fn translation_quality_issues(
    source: &str,
    target_lang: &str,
    translation: &str,
) -> Vec<TranslationQualityIssue> {
    let mut issues = Vec::new();
    let trimmed = translation.trim();
    if placeholder(trimmed) {
        issues.push(TranslationQualityIssue {
            code: TranslationQualityCode::Placeholder,
            detail: "译文是占位文本".to_owned(),
        });
    }
    let normalized_source = normalize_chars(source);
    let normalized_target = normalize_chars(trimmed);
    // 单个空白分隔的词（人名、品牌、口头语）照抄不是没翻；词连写的文字
    // （中日韩、泰文等）一个「词」可能是整句，不享此例外。
    let single_spaced_word = source.split_whitespace().count() == 1
        && normalized_source.chars().any(char::is_alphanumeric)
        && normalized_source
            .chars()
            .filter(|ch| ch.is_alphanumeric())
            .all(spaced_script_letter);
    if normalized_source.chars().count() >= 2
        && normalized_source == normalized_target
        && !single_spaced_word
    {
        issues.push(TranslationQualityIssue {
            code: TranslationQualityCode::SourceCopy,
            detail: "译文与源文完全相同".to_owned(),
        });
    } else if let Some(run) = untranslated_run(&normalized_source, target_lang, &normalized_target)
    {
        issues.push(TranslationQualityIssue {
            code: TranslationQualityCode::SourceCopy,
            detail: format!("译文含原样照抄的源文片段「{run}」"),
        });
    } else if copied_fragment(source, trimmed) {
        issues.push(TranslationQualityIssue {
            code: TranslationQualityCode::SourceCopy,
            detail: "译文整句是源文里原样照抄的一段".to_owned(),
        });
    }
    if target_script_mismatch(target_lang, trimmed) {
        issues.push(TranslationQualityIssue {
            code: TranslationQualityCode::TargetLanguageMismatch,
            detail: format!("期望 {target_lang}，但输出由不匹配的文字脚本主导"),
        });
    }
    let source_units = normalize_chars(source).chars().count();
    let target_units = normalized_target.chars().count();
    if source_units >= 80 && target_units <= 2 {
        issues.push(TranslationQualityIssue {
            code: TranslationQualityCode::TooShort,
            detail: format!("源文有 {source_units} 个内容单位，译文只有 {target_units} 个"),
        });
    }
    issues
}

/// 返回发生页面/批次级短串塌缩的句 id。至少三句且覆盖过半时才判定。
pub fn duplicate_collapse_ids<'a>(
    translations: impl IntoIterator<Item = (&'a str, &'a str, &'a str)>,
) -> Vec<String> {
    let items = translations.into_iter().collect::<Vec<_>>();
    let mut repeated: BTreeMap<String, Vec<(String, String)>> = BTreeMap::new();
    for (id, source, text) in &items {
        let normalized = normalize_chars(text);
        if !normalized.is_empty() && normalized.chars().count() <= 32 {
            repeated
                .entry(normalized)
                .or_default()
                .push(((*id).to_owned(), normalize_chars(source)));
        }
    }
    repeated
        .into_values()
        .filter(|rows| {
            let distinct_sources = rows
                .iter()
                .map(|(_, source)| source)
                .collect::<std::collections::BTreeSet<_>>()
                .len();
            rows.len() >= 3 && rows.len() * 2 >= items.len().max(1) && distinct_sources >= 3
        })
        .flatten()
        .map(|(id, _)| id)
        .collect()
}

/// 由脚本分布给出高置信语言族；无法高置信判断时返回 `None`。
pub fn dominant_script_language(text: &str) -> Option<&'static str> {
    let counts = scripts(text);
    let total = counts.total();
    if total < 8 {
        return None;
    }
    let candidates = [
        ("zh", counts.han),
        ("ja", counts.kana),
        ("ko", counts.hangul),
        ("ru", counts.cyrillic),
        ("ar", counts.arabic),
        ("hi", counts.devanagari),
        ("th", counts.thai),
        ("he", counts.hebrew),
        ("latin", counts.latin),
    ];
    let (lang, count) = candidates.into_iter().max_by_key(|(_, count)| *count)?;
    (count * 100 >= total * 70).then_some(lang)
}

/// BCP-47 标签是否与高置信脚本族兼容。`latin` 兼容所有常见拉丁语种。
pub fn language_matches_script(lang: &str, script_lang: &str) -> bool {
    let lang = primary(lang);
    match script_lang {
        "latin" => !matches!(
            lang.as_str(),
            "zh" | "ja" | "ko" | "ru" | "uk" | "bg" | "ar" | "fa" | "ur" | "hi" | "th" | "he"
        ),
        "ru" => matches!(lang.as_str(), "ru" | "uk" | "bg" | "sr" | "mk"),
        "ar" => matches!(lang.as_str(), "ar" | "fa" | "ur"),
        "hi" => matches!(lang.as_str(), "hi" | "mr" | "ne"),
        // 日文可能整段只有汉字而没有假名；Han 主导不能据此排除 ja。
        "zh" => matches!(lang.as_str(), "zh" | "ja" | "yue" | "cmn" | "wuu"),
        expected => lang == expected,
    }
}

/// 早期探针要攒够这么多「脚本字符」才下结论：够抵消片头的口播 / 英文片名，
/// 又只相当于中文一两分钟、英文半分钟的语音。
pub const SOURCE_PROBE_MIN_CHARS: usize = 160;
/// 攒到这个量脚本分布仍不到高置信（真正的混合语种），探针收手，交给写入前的全文校验。
pub const SOURCE_PROBE_MAX_CHARS: usize = 2400;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceProbeVerdict {
    /// 样本还不够，继续喂。
    Pending,
    /// 与期望语言相容，或混合到无法高置信判断；之后不再检查。
    Settled,
    /// 样本的主导脚本（[`dominant_script_language`] 的返回值）与期望语言明显不符。
    Mismatch(&'static str),
}

/// 转录早期的源语言一致性探针：把流式吐出的分段文本喂进来，攒够样本就与期望的
/// source-lang 对一次脚本。判定口径与写入前的全文校验相同（同一对
/// [`dominant_script_language`] / [`language_matches_script`]），只是提前到转录
/// 开头几十秒，而不是整段 ASR 跑完才发现语言给错了。结论一旦给出就不再变化。
#[derive(Debug, Clone)]
pub struct SourceLanguageProbe {
    expected: String,
    sample: String,
    verdict: SourceProbeVerdict,
}

impl SourceLanguageProbe {
    pub fn new(expected: &str) -> Self {
        Self {
            expected: expected.to_owned(),
            sample: String::new(),
            verdict: SourceProbeVerdict::Pending,
        }
    }

    pub fn expected(&self) -> &str {
        &self.expected
    }

    pub fn verdict(&self) -> SourceProbeVerdict {
        self.verdict
    }

    pub fn observe(&mut self, text: &str) -> SourceProbeVerdict {
        if self.verdict != SourceProbeVerdict::Pending {
            return self.verdict;
        }
        if !self.sample.is_empty() {
            self.sample.push(' ');
        }
        self.sample.push_str(text);
        let total = scripts(&self.sample).total();
        if total < SOURCE_PROBE_MIN_CHARS {
            return self.verdict;
        }
        self.verdict = match dominant_script_language(&self.sample) {
            Some(script) if language_matches_script(&self.expected, script) => {
                SourceProbeVerdict::Settled
            }
            Some(script) => SourceProbeVerdict::Mismatch(script),
            None if total >= SOURCE_PROBE_MAX_CHARS => SourceProbeVerdict::Settled,
            None => SourceProbeVerdict::Pending,
        };
        if self.verdict != SourceProbeVerdict::Pending {
            self.sample = String::new();
        }
        self.verdict
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_chinese_for_english_and_placeholders_and_source_copies() {
        let mismatch = translation_quality_issues("你好世界", "en", "这是完整的中文回答");
        assert!(
            mismatch
                .iter()
                .any(|issue| issue.code == TranslationQualityCode::TargetLanguageMismatch)
        );
        assert!(
            translation_quality_issues("hello", "en", "Translation.")
                .iter()
                .any(|issue| issue.code == TranslationQualityCode::Placeholder)
        );
        assert!(
            translation_quality_issues("原文复制", "en", "原文复制")
                .iter()
                .any(|issue| issue.code == TranslationQualityCode::SourceCopy)
        );
    }

    /// 单个空白分隔的词照抄（人名、品牌）不是没翻；词连写文字的单「词」
    /// 可能是整句，照抄仍算。
    #[test]
    fn a_single_spaced_word_copied_verbatim_is_not_a_source_copy() {
        assert!(translation_quality_issues("Dottie.", "zh", "Dottie.").is_empty());
        assert!(translation_quality_issues("Okay", "ja", "Okay").is_empty());
        for (source, lang) in [
            ("Hello world.", "zh"),
            ("原文复制", "en"),
            ("สวัสดีครับ", "en"),
        ] {
            assert!(
                translation_quality_issues(source, lang, source)
                    .iter()
                    .any(|issue| issue.code == TranslationQualityCode::SourceCopy),
                "{source}"
            );
        }
    }

    #[test]
    fn allows_short_names_and_normal_code_switching() {
        assert!(translation_quality_issues("包剪辑", "en", "BaoCut").is_empty());
        assert!(translation_quality_issues("缓存", "en", "KV cache 缓存").is_empty());
        // A short name kept in the source script is not an untranslated run.
        assert!(
            translation_quality_issues("我在清华大学读书。", "en", "I studied at 清华大学.")
                .is_empty()
        );
    }

    /// 半句没翻：拉丁词够多时脚本比例门看不出来，照抄的源文连续片段才是证据。
    /// 只有表意文字源→非表意目标有此门；表意目标里照抄的拉丁词不查。
    #[test]
    fn rejects_a_half_translated_sentence_that_keeps_a_source_run() {
        let issues = translation_quality_issues(
            "毕业五年升职升不上去，转岗没机会，性格越来越I。",
            "en",
            "毕业 5 年升职升不上去， internal role transfer 没机会，性格越来越 I。",
        );
        assert!(
            issues
                .iter()
                .any(|issue| issue.code == TranslationQualityCode::SourceCopy),
            "{issues:?}"
        );
        assert!(
            !issues
                .iter()
                .any(|issue| issue.code == TranslationQualityCode::TargetLanguageMismatch),
            "the script-ratio gate alone does not see it: {issues:?}"
        );
        // Five characters is below the run length; a name or a term is kept.
        assert!(
            translation_quality_issues(
                "这是升职升不上去的原因。",
                "en",
                "That is why 升职升不上 happens."
            )
            .is_empty()
        );
        // The other direction is not gated: Latin runs in a CJK target are
        // usually names, titles and terms.
        assert!(
            translation_quality_issues(
                "Read the paper Attention Is All You Need tonight.",
                "zh-Hans",
                "今晚读一下 Attention Is All You Need 这篇论文。"
            )
            .is_empty()
        );
    }

    /// 译文整句只是源文的一截（西语源、英语目标，两边文字相同，脚本门看不
    /// 出来）：四个词起算。短的专名片段、带了译文的句子、词连写文字不拦。
    #[test]
    fn rejects_a_translation_that_is_only_a_verbatim_part_of_the_source() {
        let source = "Aunque Inés salió antes que Mateo, llegó diez minutos después de él.";
        let copied = |lang: &str, translation: &str| {
            translation_quality_issues(source, lang, translation)
                .iter()
                .any(|issue| issue.code == TranslationQualityCode::SourceCopy)
        };
        assert!(copied("en", "llegó diez minutos después de él."));
        assert!(copied("en", "Aunque Inés salió antes que Mateo"));
        assert!(copied("ar", "salió antes que Mateo,"));
        // Three words: a name or a title is kept.
        assert!(!copied("en", "antes que Mateo"));
        // A sentence that carries the copied run among its own words is not
        // judged here.
        assert!(!copied(
            "en",
            "Although Inés left before Mateo, llegó diez minutos después."
        ));
        assert!(!copied(
            "en",
            "Although Inés left before Mateo, she arrived ten minutes after him."
        ));
        // Scripts written without spaces never reach the word count.
        assert!(
            translation_quality_issues("สวัสดีครับวันนี้อากาศดีมาก", "en", "วันนี้อากาศดี")
                .iter()
                .all(|issue| issue.code != TranslationQualityCode::SourceCopy)
        );
    }

    #[test]
    fn detects_dominant_source_script_conservatively() {
        assert_eq!(
            dominant_script_language("这是一个足够长的中文转录文本。"),
            Some("zh")
        );
        assert_eq!(dominant_script_language("BaoCut CLI 1.2"), Some("latin"));
        assert!(language_matches_script("en-US", "latin"));
        assert!(!language_matches_script("en", "zh"));
    }

    #[test]
    fn source_probe_waits_for_a_sample_then_flags_the_wrong_script() {
        let mut probe = SourceLanguageProbe::new("en");
        assert_eq!(
            probe.observe("大家好，欢迎来到今天的讲座。"),
            SourceProbeVerdict::Pending
        );
        let mut verdict = SourceProbeVerdict::Pending;
        for _ in 0..20 {
            verdict = probe.observe("我们今天主要讨论 AI 在海外华人社区里的应用和一些实际的例子。");
        }
        assert_eq!(verdict, SourceProbeVerdict::Mismatch("zh"));
        // 结论不回退。
        assert_eq!(
            probe.observe("This is a long English sentence that would not matter anymore."),
            SourceProbeVerdict::Mismatch("zh")
        );
    }

    #[test]
    fn source_probe_settles_on_compatible_or_truly_mixed_speech() {
        let mut probe = SourceLanguageProbe::new("zh-Hans");
        let mut verdict = SourceProbeVerdict::Pending;
        for _ in 0..20 {
            verdict = probe.observe("我们今天主要讨论 AI 在海外华人社区里的应用和一些实际的例子。");
        }
        assert_eq!(verdict, SourceProbeVerdict::Settled);

        // 中英都不到七成：到上限仍无高置信主导脚本，收手而不是误报。
        let mut mixed = SourceLanguageProbe::new("en");
        let mut verdict = SourceProbeVerdict::Pending;
        for _ in 0..200 {
            verdict = mixed.observe("这个功能我们下个迭代再讨论 roadmap 吧");
            assert!(!matches!(verdict, SourceProbeVerdict::Mismatch(_)));
        }
        assert_eq!(verdict, SourceProbeVerdict::Settled);
    }

    /// 这道门只看文字脚本、照抄与占位，不看意思：通顺但译错的句子照样通过。
    /// 验收夹具 `de-07`（条件被改、批准的主体被误读）与 `hi-07`（「第二版」
    /// 译作「另一个版本」）都不产生任何问题，意思要靠别的机制核对。
    #[test]
    fn a_fluent_mistranslation_passes_the_script_gate() {
        assert!(
            translation_quality_issues(
                "Sende Anna die Datei nur dann, wenn die Leitung der zweiten Fassung zugestimmt hat.",
                "zh-Hans",
                "只有在安娜收到文件并且第二版的负责人同意后，才发送。",
            )
            .is_empty()
        );
        assert!(
            translation_quality_issues(
                "जब तक प्रबंधक दूसरे संस्करण को मंज़ूरी न दे, तब तक फ़ाइल सारा को मत भेजें।",
                "zh-Hans",
                "在经理批准另一个版本之前，不要把文件发给萨拉。",
            )
            .is_empty()
        );
    }
}
