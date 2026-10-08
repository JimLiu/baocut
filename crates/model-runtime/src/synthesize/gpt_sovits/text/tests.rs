//! 前端公开接口的无外部文件回归：期望值取自上游 Python（G2PW 关闭）的 golden 输出。

use super::*;

/// 内嵌数据与 `data/README.md` 登记的 SHA-256 对拍（v3 新增：数据原样带自 v2，改了要同步登记）。
#[test]
fn data_files_match_the_readme_digests() {
    use sha2::{Digest, Sha256};
    let readme = include_str!("data/README.md");
    for (name, bytes) in [
        ("pinyin_syllables.txt.z", &include_bytes!("data/pinyin_syllables.txt.z")[..]),
        ("pinyin_chars.bin.z", &include_bytes!("data/pinyin_chars.bin.z")[..]),
        ("pinyin_phrases.txt.z", &include_bytes!("data/pinyin_phrases.txt.z")[..]),
        ("t2s.txt.z", &include_bytes!("data/t2s.txt.z")[..]),
        ("opencpop_strict.txt.z", &include_bytes!("data/opencpop_strict.txt.z")[..]),
        ("cmudict.txt.z", &include_bytes!("data/cmudict.txt.z")[..]),
        ("namedict.txt.z", &include_bytes!("data/namedict.txt.z")[..]),
        ("homographs.txt.z", &include_bytes!("data/homographs.txt.z")[..]),
        ("en_tagger.bin.z", &include_bytes!("data/en_tagger.bin.z")[..]),
        ("wordsegment.bin.z", &include_bytes!("data/wordsegment.bin.z")[..]),
        ("g2p_gru.f32", &include_bytes!("data/g2p_gru.f32")[..]),
        ("jieba_dict.txt.z", &include_bytes!("data/jieba_dict.txt.z")[..]),
        ("jieba_finalseg.bin.z", &include_bytes!("data/jieba_finalseg.bin.z")[..]),
        ("jieba_posseg.bin.z", &include_bytes!("data/jieba_posseg.bin.z")[..]),
    ] {
        let digest: String = Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect();
        let row = readme
            .lines()
            .find(|line| line.starts_with(&format!("| `{name}` |")))
            .unwrap_or_else(|| panic!("README 没有 {name} 一行"));
        assert!(row.contains(&digest), "{name} 的 SHA-256 与 README 不符：{digest}");
    }
}

fn pieces(text: &str, language: Language) -> Vec<(String, Vec<i32>, Option<Vec<usize>>)> {
    phonemize(text, language)
        .unwrap()
        .into_iter()
        .map(|piece| (piece.norm_text, piece.phones, piece.word2ph))
        .collect()
}

fn owned(items: &[&str]) -> Vec<String> {
    items.iter().map(|item| (*item).to_owned()).collect()
}

#[test]
fn resolves_request_language() {
    for (requested, text, want) in [
        (Some("zh"), "hello", Language::Zh),
        (Some("zh-Hans"), "", Language::Zh),
        (Some("zh_CN"), "", Language::Zh),
        (Some("Chinese"), "", Language::Zh),
        (Some("en-US"), "你好", Language::En),
        (Some("english"), "", Language::En),
        (Some("auto"), "今天用GPT写代码", Language::Zh),
        (None, "Hello world", Language::En),
        (None, "123", Language::En),
        (None, "列夫・托尔斯泰", Language::Zh),
    ] {
        assert_eq!(Language::resolve(requested, text).unwrap(), want, "{requested:?} {text}");
    }
    assert!(Language::resolve(Some("ja"), "こんにちは").is_err());
    assert!(Language::resolve(None, "こんにちは").is_err());
    assert!(Language::resolve(None, "안녕하세요").is_err());
}

#[test]
fn prompt_text_gets_terminal_punctuation() {
    assert_eq!(with_terminal_punctuation("\n你好\n", Language::Zh), "你好。");
    assert_eq!(with_terminal_punctuation("Hello", Language::En), "Hello.");
    assert_eq!(with_terminal_punctuation("好的！", Language::Zh), "好的！");
}

#[test]
fn splits_sentences_like_upstream() {
    let cases = [
        (
            "我喜欢用GPT来写代码，AI很强。",
            Language::Zh,
            owned(&["我喜欢用GPT来写代码，", "AI很强。"]),
        ),
        (
            "Hello world, this is a test of the text frontend.",
            Language::En,
            owned(&["Hello world,", " this is a test of the text frontend."]),
        ),
        ("你好", Language::Zh, owned(&["你好。"])),
        ("Hi", Language::En, owned(&["Hi."])),
        (
            "這是一個繁體中文的句子，我們來測試轉換。",
            Language::Zh,
            owned(&["這是一個繁體中文的句子，", "我們來測試轉換。"]),
        ),
    ];
    for (text, language, want) in cases {
        assert_eq!(split_sentences(text, language).unwrap(), want, "{text}");
    }
    assert!(split_sentences("", Language::Zh).unwrap().is_empty());
    assert!(split_sentences("……！！", Language::Zh).is_err());
}

#[test]
fn mixed_chinese_english_keeps_word2ph_per_chinese_segment() {
    let want = vec![
        (
            "我喜欢用".to_owned(),
            vec![316, 231, 317, 168, 158, 274, 318, 238],
            Some(vec![2, 2, 2, 2]),
        ),
        ("G P T".to_owned(), vec![60, 58, 73, 58, 80, 58], None),
        (
            "来写代码,".to_owned(),
            vec![224, 103, 317, 193, 127, 105, 225, 99, 1],
            Some(vec![2, 2, 2, 2, 1]),
        ),
        ("A I".to_owned(), vec![1, 42, 22], None),
        ("很强.".to_owned(), vec![158, 142, 247, 182, 3], Some(vec![2, 2, 1])),
    ];
    assert_eq!(pieces("我喜欢用GPT来写代码，AI很强。", Language::Zh), want);
}

#[test]
fn english_sentence_phonemes() {
    let got = pieces("Hello world, this is a test of the text frontend.", Language::En);
    assert_eq!(got.len(), 1);
    assert_eq!(got[0].2, None);
    assert_eq!(
        got[0].1,
        vec![
            51, 12, 62, 68, 91, 39, 62, 26, 1, 27, 55, 75, 55, 93, 12, 80, 35, 75, 80, 13, 90, 27, 12, 80, 35, 61, 75, 80, 49, 74, 13, 64,
            80, 35, 64, 26, 3
        ]
    );
}

#[test]
fn short_text_is_padded_with_a_period() {
    assert_eq!(
        pieces("你好", Language::Zh),
        vec![(".你好".to_owned(), vec![3, 227, 167, 158, 119], Some(vec![1, 2, 2]))]
    );
    assert_eq!(pieces("Hi", Language::En), vec![(". Hi".to_owned(), vec![1, 3, 51, 22], None)]);
    assert_eq!(pieces("……！！", Language::Zh), vec![(".".to_owned(), vec![3], Some(vec![1]))]);
}

#[test]
fn chinese_normalization_and_traditional_conversion() {
    assert_eq!(
        pieces("這是一個繁體中文的句子，我們來測試轉換。", Language::Zh),
        vec![(
            "这是一个繁体中文的句子,我们来测试转换.".to_owned(),
            vec![
                320, 133, 251, 214, 318, 167, 156, 134, 155, 108, 252, 168, 320, 235, 316, 141, 127, 134, 221, 299, 319, 165, 1, 316, 232,
                225, 144, 224, 103, 124, 133, 251, 214, 320, 272, 158, 273, 3
            ],
            Some(vec![2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 2, 1])
        )]
    );
    assert_eq!(
        pieces("好的，谢谢！", Language::Zh),
        vec![(
            "好的,谢谢!".to_owned(),
            vec![158, 119, 127, 134, 1, 317, 194, 317, 195, 0],
            Some(vec![2, 2, 1, 2, 2, 1])
        )]
    );
}

#[test]
fn word2ph_always_covers_every_phone() {
    for text in [
        "2024年第3季度营收增长了23.5%，达到12亿美元。",
        "iPhone 16 Pro的价格是999美元。",
        "温度是-5度，体感温度更低。",
    ] {
        for piece in phonemize(text, Language::Zh).unwrap() {
            if let Some(word2ph) = &piece.word2ph {
                assert_eq!(word2ph.iter().sum::<usize>(), piece.phones.len(), "{text}");
                assert_eq!(word2ph.len(), piece.norm_text.chars().count(), "{text}");
            }
        }
    }
}
