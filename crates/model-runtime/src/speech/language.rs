//! BCP 47 语言标签 ↔ Qwen3-ASR 的语言名。Qwen3-ASR 用英文语言名指定语言（`language English`），
//! 自动识别时也以同样的前缀报出它听到的语言。
//!
//! 各识别模型族认的语言各有一张表（从 v2 的语言目录移植）：[`QWEN_LANGUAGES`]、[`WHISPER_LANGUAGES`]、
//! [`MOSS_LANGUAGES`]；断言的语言由 [`supports`] 按模型族把关。Runtime 的 `@baocut/models` 有同样的三张表。

use crate::bundle::{FAMILY_MOSS_TRANSCRIBE_DIARIZE, FAMILY_QWEN3_ASR, FAMILY_WHISPER_COREML, FAMILY_WHISPER_GGML, FAMILY_WHISPER_MLX};

/// Qwen3-ASR 支持的语言：规范码与模型认的语言名。
pub const QWEN_LANGUAGES: &[(&str, &str)] = &[
    ("zh", "Chinese"),
    ("en", "English"),
    ("yue", "Cantonese"),
    ("ar", "Arabic"),
    ("de", "German"),
    ("fr", "French"),
    ("es", "Spanish"),
    ("pt", "Portuguese"),
    ("id", "Indonesian"),
    ("it", "Italian"),
    ("ko", "Korean"),
    ("ru", "Russian"),
    ("th", "Thai"),
    ("vi", "Vietnamese"),
    ("ja", "Japanese"),
    ("tr", "Turkish"),
    ("hi", "Hindi"),
    ("ms", "Malay"),
    ("nl", "Dutch"),
    ("sv", "Swedish"),
    ("da", "Danish"),
    ("fi", "Finnish"),
    ("pl", "Polish"),
    ("cs", "Czech"),
    ("fil", "Filipino"),
    ("fa", "Persian"),
    ("el", "Greek"),
    ("ro", "Romanian"),
    ("hu", "Hungarian"),
    ("mk", "Macedonian"),
];

/// Whisper large-v3 / large-v3-turbo 认的语言（规范码，即 Whisper 的语言 token）。
pub const WHISPER_LANGUAGES: &[&str] = &[
    "en", "zh", "de", "es", "ru", "ko", "fr", "ja", "pt", "tr", "pl", "ca", "nl", "ar", "sv", "it", "id", "hi", "fi", "vi", "he", "uk",
    "el", "ms", "cs", "ro", "da", "hu", "ta", "no", "th", "ur", "hr", "bg", "lt", "la", "mi", "ml", "cy", "sk", "te", "fa", "lv", "bn",
    "sr", "az", "sl", "kn", "et", "mk", "br", "eu", "is", "hy", "ne", "mn", "bs", "kk", "sq", "sw", "gl", "mr", "pa", "si", "km", "sn",
    "yo", "so", "af", "oc", "ka", "be", "tg", "sd", "gu", "am", "yi", "lo", "uz", "fo", "ht", "ps", "tk", "nn", "mt", "sa", "lb", "my",
    "bo", "tl", "mg", "as", "tt", "haw", "ln", "ha", "ba", "jw", "su", "yue",
];

/// MOSS-Transcribe-Diarize 认的语言：语言目录里全部主语种（规范码与指令里用的英文名）。
pub const MOSS_LANGUAGES: &[(&str, &str)] = &[
    ("zh", "Chinese"),
    ("en", "English"),
    ("es", "Spanish"),
    ("ja", "Japanese"),
    ("fr", "French"),
    ("de", "German"),
    ("ko", "Korean"),
    ("pt", "Portuguese"),
    ("it", "Italian"),
    ("ru", "Russian"),
    ("ar", "Arabic"),
    ("hi", "Hindi"),
    ("id", "Indonesian"),
    ("vi", "Vietnamese"),
    ("tr", "Turkish"),
    ("nl", "Dutch"),
    ("pl", "Polish"),
    ("uk", "Ukrainian"),
    ("sv", "Swedish"),
    ("th", "Thai"),
    ("el", "Greek"),
    ("he", "Hebrew"),
    ("cs", "Czech"),
    ("ro", "Romanian"),
    ("fi", "Finnish"),
    ("hu", "Hungarian"),
    ("da", "Danish"),
    ("no", "Norwegian"),
    ("ms", "Malay"),
    ("ca", "Catalan"),
    ("ta", "Tamil"),
    ("ur", "Urdu"),
    ("hr", "Croatian"),
    ("bg", "Bulgarian"),
    ("lt", "Lithuanian"),
    ("la", "Latin"),
    ("mi", "Māori"),
    ("ml", "Malayalam"),
    ("cy", "Welsh"),
    ("sk", "Slovak"),
    ("te", "Telugu"),
    ("fa", "Persian"),
    ("lv", "Latvian"),
    ("bn", "Bangla"),
    ("sr", "Serbian"),
    ("az", "Azerbaijani"),
    ("sl", "Slovenian"),
    ("kn", "Kannada"),
    ("et", "Estonian"),
    ("mk", "Macedonian"),
    ("br", "Breton"),
    ("eu", "Basque"),
    ("is", "Icelandic"),
    ("hy", "Armenian"),
    ("ne", "Nepali"),
    ("mn", "Mongolian"),
    ("bs", "Bosnian"),
    ("kk", "Kazakh"),
    ("sq", "Albanian"),
    ("sw", "Swahili"),
    ("gl", "Galician"),
    ("mr", "Marathi"),
    ("pa", "Punjabi"),
    ("si", "Sinhala"),
    ("km", "Khmer"),
    ("sn", "Shona"),
    ("yo", "Yoruba"),
    ("so", "Somali"),
    ("af", "Afrikaans"),
    ("oc", "Occitan"),
    ("ka", "Georgian"),
    ("be", "Belarusian"),
    ("tg", "Tajik"),
    ("sd", "Sindhi"),
    ("gu", "Gujarati"),
    ("am", "Amharic"),
    ("yi", "Yiddish"),
    ("lo", "Lao"),
    ("uz", "Uzbek"),
    ("fo", "Faroese"),
    ("ht", "Haitian Creole"),
    ("ps", "Pashto"),
    ("tk", "Turkmen"),
    ("nn", "Norwegian Nynorsk"),
    ("mt", "Maltese"),
    ("sa", "Sanskrit"),
    ("lb", "Luxembourgish"),
    ("my", "Burmese"),
    ("bo", "Tibetan"),
    ("tl", "Tagalog"),
    ("mg", "Malagasy"),
    ("as", "Assamese"),
    ("tt", "Tatar"),
    ("haw", "Hawaiian"),
    ("ln", "Lingala"),
    ("ha", "Hausa"),
    ("ba", "Bashkir"),
    ("jw", "Javanese"),
    ("su", "Sundanese"),
    ("yue", "Cantonese"),
    ("fil", "Filipino"),
];

/// 这个识别模型族认得 `tag`（按规范码比较）。认不出的模型族一律 `false`。
pub fn supports(family: &str, tag: &str) -> bool {
    let Some(code) = canonical_code(tag) else {
        return false;
    };
    match family {
        FAMILY_QWEN3_ASR => QWEN_LANGUAGES.iter().any(|(known, _)| *known == code),
        FAMILY_WHISPER_MLX | FAMILY_WHISPER_COREML | FAMILY_WHISPER_GGML => WHISPER_LANGUAGES.contains(&code.as_str()),
        FAMILY_MOSS_TRANSCRIBE_DIARIZE => MOSS_LANGUAGES.iter().any(|(known, _)| *known == code),
        _ => false,
    }
}

/// 三字母码与历史别名 → 规范码。
const ALIASES: &[(&str, &str)] = &[
    ("jv", "jw"),
    ("cmn", "zh"),
    ("zho", "zh"),
    ("eng", "en"),
    ("jpn", "ja"),
    ("kor", "ko"),
];

/// BCP 47 标签 → 规范码（取主语言子标签并小写，再查别名）：`zh-Hant` → `zh`，`EN-us` → `en`。
/// 不检查模型是否支持。
pub fn canonical_code(tag: &str) -> Option<String> {
    let primary = tag.trim().split(['-', '_']).next()?.to_ascii_lowercase();
    if primary.is_empty() || !primary.chars().all(|character| character.is_ascii_alphabetic()) {
        return None;
    }
    Some(
        ALIASES
            .iter()
            .find(|(alias, _)| *alias == primary)
            .map_or(primary, |(_, code)| (*code).to_owned()),
    )
}

/// BCP 47 标签 → Qwen3-ASR 语言名；模型不支持时 `None`。
pub fn qwen_name(tag: &str) -> Option<&'static str> {
    let code = canonical_code(tag)?;
    QWEN_LANGUAGES.iter().find(|(known, _)| *known == code).map(|(_, name)| *name)
}

/// Qwen3-ASR 报出的语言名 → 规范码（`English` → `en`，大小写与首尾空白不计）。
pub fn code_from_qwen_name(name: &str) -> Option<&'static str> {
    let name = name.trim();
    QWEN_LANGUAGES
        .iter()
        .find(|(_, known)| known.eq_ignore_ascii_case(name))
        .map(|(code, _)| *code)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonicalizes_bcp47_tags() {
        assert_eq!(canonical_code("zh-Hant").as_deref(), Some("zh"));
        assert_eq!(canonical_code("EN-us").as_deref(), Some("en"));
        assert_eq!(canonical_code("cmn").as_deref(), Some("zh"));
        assert_eq!(canonical_code("jv").as_deref(), Some("jw"));
        assert_eq!(canonical_code(""), None);
        assert_eq!(canonical_code("12"), None);
    }

    #[test]
    fn maps_tags_to_qwen_names_and_back() {
        assert_eq!(qwen_name("en-GB"), Some("English"));
        assert_eq!(qwen_name("yue-HK"), Some("Cantonese"));
        assert_eq!(qwen_name("sw"), None);
        assert_eq!(code_from_qwen_name(" english "), Some("en"));
        assert_eq!(code_from_qwen_name("Klingon"), None);
        for (code, name) in QWEN_LANGUAGES {
            assert_eq!(qwen_name(code), Some(*name));
            assert_eq!(code_from_qwen_name(name), Some(*code));
        }
    }

    #[test]
    fn each_family_has_its_own_languages() {
        assert_eq!(QWEN_LANGUAGES.len(), 30);
        assert_eq!(WHISPER_LANGUAGES.len(), 100);
        assert_eq!(MOSS_LANGUAGES.len(), 101);
        assert!(supports(FAMILY_QWEN3_ASR, "fil"));
        assert!(!supports(FAMILY_QWEN3_ASR, "sw"));
        assert!(supports(FAMILY_WHISPER_MLX, "sw-KE"));
        assert!(supports(FAMILY_WHISPER_MLX, "jv"), "别名折到 jw");
        assert!(!supports(FAMILY_WHISPER_MLX, "fil"));
        // whisper.cpp 的 GGML 包与 MLX 包是同一个模型，认同一张表。
        assert!(supports(FAMILY_WHISPER_GGML, "sw-KE"));
        assert!(supports(FAMILY_WHISPER_GGML, "yue"));
        assert!(!supports(FAMILY_WHISPER_GGML, "fil"));
        assert!(supports(FAMILY_MOSS_TRANSCRIBE_DIARIZE, "zh-Hant"), "按主语种比较");
        assert!(!supports(FAMILY_MOSS_TRANSCRIBE_DIARIZE, "tlh"));
        assert!(!supports("unknown-family", "en"));
        assert!(!supports(FAMILY_QWEN3_ASR, "12"));
        // MOSS 的表覆盖另两张；每张表里的码都已是规范码，没有重复。
        for code in WHISPER_LANGUAGES.iter().chain(QWEN_LANGUAGES.iter().map(|(code, _)| code)) {
            assert!(supports(FAMILY_MOSS_TRANSCRIBE_DIARIZE, code), "{code}");
        }
        let tables: [Vec<&str>; 3] = [
            QWEN_LANGUAGES.iter().map(|(code, _)| *code).collect(),
            WHISPER_LANGUAGES.to_vec(),
            MOSS_LANGUAGES.iter().map(|(code, _)| *code).collect(),
        ];
        for table in tables {
            let unique: std::collections::HashSet<_> = table.iter().collect();
            assert_eq!(unique.len(), table.len());
            for code in table {
                assert_eq!(canonical_code(code).as_deref(), Some(code));
            }
        }
    }

    // ---- 以下移植自 v2 `bcut-speech-core/src/asr_language.rs`。v3 没有 `resolve()`（换模型时的语言回落）
    // 和按语言名查 Qwen 参数，只移植落在 `supports` / `canonical_code` / `qwen_name` 上的断言 ----

    /// 原 `model_switch_keeps_supported_language_and_falls_back_to_auto`：v2 不认就回落 auto，v3 由 `supports` 把关。
    #[test]
    fn each_family_accepts_only_its_own_languages() {
        assert!(supports(FAMILY_QWEN3_ASR, "ja"));
        assert!(!supports(FAMILY_QWEN3_ASR, "uk"));
        assert!(supports(FAMILY_WHISPER_MLX, "uk"));
        assert!(supports(FAMILY_MOSS_TRANSCRIBE_DIARIZE, "ja"));
        assert!(supports(FAMILY_MOSS_TRANSCRIBE_DIARIZE, "uk"));
        // `auto` 与乱写的标签不是语言（`not-a-language` 的主子标签是 `not`，也不在任何表里）。
        for family in [
            FAMILY_QWEN3_ASR,
            FAMILY_WHISPER_MLX,
            FAMILY_WHISPER_GGML,
            FAMILY_MOSS_TRANSCRIBE_DIARIZE,
        ] {
            assert!(!supports(family, "auto"), "{family}");
            assert!(!supports(family, "not-a-language"), "{family}");
        }
    }

    /// 原 `every_moss_code_has_an_instruction_name`：每个可选 code 都能写进 MOSS 的指令，且与表里的英文名一致；
    /// 唯一例外 `yue` 折成 `Chinese`。
    #[test]
    fn every_moss_code_has_an_instruction_name() {
        use super::super::moss_common::language_name;
        for (code, name) in MOSS_LANGUAGES {
            let expected = if *code == "yue" { "Chinese" } else { name };
            assert_eq!(language_name(code).as_deref(), Some(expected), "{code}");
        }
    }

    /// 原 `qwen_parameters_use_names_and_keep_cantonese_distinct`。
    #[test]
    fn qwen_names_keep_cantonese_distinct() {
        assert_eq!(qwen_name("yue"), Some("Cantonese"));
        assert_eq!(qwen_name("zh-Hant"), Some("Chinese"));
        assert_ne!(qwen_name("yue"), qwen_name("zh"));
        assert_eq!(qwen_name("auto"), None);
        assert_eq!(qwen_name("Fujian"), None);
        assert_eq!(qwen_name("english-nonsense"), None);
        // 模型报出的名字反查回规范码；粤语与汉语各是各的。
        assert_eq!(code_from_qwen_name("Japanese"), Some("ja"));
        assert_eq!(code_from_qwen_name("Portuguese"), Some("pt"));
        assert_eq!(code_from_qwen_name("Cantonese"), Some("yue"));
        assert_eq!(code_from_qwen_name("Chinese"), Some("zh"));
    }

    /// 原 `hints_keep_whisper_only_languages_and_accept_model_names`：粤语不折成汉语，Whisper 照收。
    #[test]
    fn cantonese_stays_distinct_and_whisper_accepts_it() {
        assert_eq!(canonical_code("yue").as_deref(), Some("yue"));
        assert!(supports(FAMILY_WHISPER_MLX, "yue"));
        assert_eq!(canonical_code("cmn").as_deref(), Some("zh"));
        assert_eq!(canonical_code("zh-Hant").as_deref(), Some("zh"));
    }
}
