use super::*;
use crate::synthesize::types::VoiceSpec;

fn reading(start: usize, end: usize, text: &str, origin: Origin) -> Reading {
    Reading {
        start,
        end,
        reading: text.to_owned(),
        origin,
    }
}

fn pieces(list: &[&str]) -> HashSet<String> {
    list.iter().map(|s| (*s).to_owned()).collect()
}

#[test]
fn data_files_match_the_readme_digests() {
    use sha2::{Digest, Sha256};
    let readme = include_str!("data/README.md");
    for (name, bytes) in [
        ("heteronyms.txt.z", &include_bytes!("data/heteronyms.txt.z")[..]),
        ("homophones.txt.z", &include_bytes!("data/homophones.txt.z")[..]),
    ] {
        let digest: String = Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect();
        let row = readme
            .lines()
            .find(|line| line.starts_with(&format!("| `{name}` |")))
            .unwrap_or_else(|| panic!("README 没有 {name} 一行"));
        assert!(row.contains(&digest), "{name} 的 SHA-256 与 README 不符：{digest}");
    }
}

#[test]
fn tone3_spelling_matches_every_heteronym_default() {
    // 词组表与单字表存的是 strict 声韵母；拼回的 TONE3 写法必须与 pypinyin 生成的多音字表逐字一致。
    // strict 声韵母拼不回的只有这几个叹词（`yo` 与 `o` 同为零声母 + `o`，`hm` / `n` / `m` 没有韵母）；
    // 它们不在语境清单里，词组表也不会拿它们定读音。
    const LOSSY: &str = "噷唷嗯喲呣哟";
    let mut checked = 0;
    for (&c, entry) in HETERONYMS.iter() {
        assert!(entry.all.len() >= 2 && entry.all[0] == entry.default, "{c}");
        if LOSSY.contains(c) {
            assert!(!is_context_heteronym(c), "{c}");
            continue;
        }
        let id = pinyin::default_syllable(c).unwrap_or_else(|| panic!("{c} 没有默认读音"));
        assert_eq!(pinyin::tone3(id), entry.default, "{c}");
        checked += 1;
    }
    assert!(checked > 6000, "{checked}");
    assert_eq!(readings_of('绿'), ["lv4", "lu4"]);
    assert_eq!(readings_of('句')[0], "ju4");
    assert_eq!(readings_of('略'), ["lve4"]);
    assert_eq!(readings_of('远'), ["yuan3"]);
}

#[test]
fn the_context_list_is_heteronyms_without_grammar_words() {
    assert!(CONTEXT.len() >= 200 && CONTEXT.len() <= 500, "{}", CONTEXT.len());
    for c in CONTEXT.iter() {
        assert!(HETERONYMS.contains_key(c), "{c} 不是多音字");
    }
    for c in "的了着不一地得".chars() {
        assert!(!is_context_heteronym(c), "{c}");
    }
    for c in "行重长还干发".chars() {
        assert!(is_context_heteronym(c), "{c}");
    }
}

#[test]
fn every_homophone_is_a_single_reading_character() {
    assert!(HOMOPHONES.len() > 500);
    for (syllable, &c) in HOMOPHONES.iter() {
        assert!(!HETERONYMS.contains_key(&c), "{c}");
        assert_eq!(readings_of(c), [syllable.clone()], "{c}");
    }
    assert_eq!(HOMOPHONES.get("hang2"), Some(&'航'));
    assert_eq!(HOMOPHONES.get("xing2"), Some(&'形'));
    assert!(!HOMOPHONES.contains_key("le5"));
}

#[test]
fn annotate_resolves_phrases_and_lists_single_character_candidates() {
    let a = annotate("他在银行上班，觉得不行。", AnnotateOptions::default());
    assert_eq!(a.surface, "他在银行上班，觉得不行。");
    assert_eq!(a.readings, [reading(2, 4, "yin2 hang2", Origin::Phrase)]);
    // 「不行」是词组、读音与逐字默认相同：定了，不注记也不列候选。
    assert!(a.candidates.is_empty(), "{:?}", a.candidates);

    let a = annotate("这事我觉得行", AnnotateOptions::default());
    assert!(a.readings.is_empty());
    assert_eq!(a.candidates.len(), 1);
    let candidate = &a.candidates[0];
    assert_eq!((candidate.start, candidate.end), (5, 6));
    assert_eq!(candidate.default, "xing2");
    assert!(candidate.readings.contains(&"hang2".to_owned()));

    let a = annotate("这事我觉得行", AnnotateOptions { dict_readings: true });
    assert_eq!(a.readings, [reading(5, 6, "xing2", Origin::Dict)]);
}

#[test]
fn handwritten_readings_win_over_the_dictionary() {
    let a = annotate("他在银<行|xing2>里走", AnnotateOptions::default());
    assert_eq!(a.surface, "他在银行里走");
    assert_eq!(a.readings, [reading(3, 4, "xing2", Origin::User)]);
    assert!(a.candidates.is_empty());
}

/// 固定句集：普通叙述文字里候选（要看上下文的单字）不能铺满全文，词组注记也只落在真正改读音的地方。
const ARTICLE: &str = "今天早上我去公园散步，看到很多老人在打太极拳。\
    天气很好，阳光照在湖面上，几只小鸟在树上唱歌。\
    我在路边买了一杯咖啡，坐在长椅上看书。\
    这本书讲的是一个年轻人离开家乡去大城市工作的故事。\
    他一开始什么都不会，后来慢慢学会了很多东西。\
    最后他回到家乡，开了一家小店，生活过得很平静。\
    下午我还要去超市买点菜，晚上给家里人做饭。\
    明天打算和朋友一起去爬山，希望天气还是这么好。";

#[test]
fn candidates_stay_a_small_share_of_ordinary_text() {
    let a = annotate(ARTICLE, AnnotateOptions::default());
    let han = a.surface.chars().filter(|&c| is_han(c)).count();
    let candidates = a.candidates.len();
    assert!(
        candidates * 100 <= han * 5,
        "候选 {candidates} / 汉字 {han}：{:?}",
        a.candidates.iter().map(|c| a.slice(c.start, c.end)).collect::<Vec<_>>()
    );
    let phrases = a.readings.iter().filter(|r| r.origin == Origin::Phrase).count();
    assert!(
        phrases * 100 <= han * 3,
        "词组注记 {phrases} / 汉字 {han}：{:?}",
        a.readings
            .iter()
            .map(|r| (a.slice(r.start, r.end), r.reading.as_str()))
            .collect::<Vec<_>>()
    );
}

#[test]
fn auto_annotation_does_not_touch_ordinary_text_on_qwen3() {
    let a = annotate(ARTICLE, AnnotateOptions::default());
    let rendered = render(ReadingsSupport::Homophone, &a, None);
    assert_eq!(rendered.text, a.surface, "词组注记在 Qwen3 上一个字都不换");
    assert!(rendered.dropped.is_empty());
}

#[test]
fn auto_phrase_readings_survive_the_round_trip_through_the_request_text() {
    // CLI 把 `annotate` 的结果 `to_text()` 进请求，引擎包装层再解析：来源丢了，靠词组表认回来。
    let sent = annotate(ARTICLE, AnnotateOptions::default()).to_text();
    let parsed = parse_for_engine(&sent);
    assert!(parsed.readings.iter().all(|r| r.origin == Origin::Phrase));
    for support in [ReadingsSupport::Homophone, ReadingsSupport::Unsupported] {
        let rendered = render(support, &parsed, None);
        assert_eq!(rendered.text, parsed.surface, "{support:?}");
        assert!(rendered.dropped.is_empty(), "{support:?}");
    }

    let parsed = parse_for_engine("他在<银行|yin2 hang2>上班，<行长|xing2 zhang3>说");
    assert_eq!(parsed.readings[0].origin, Origin::Phrase);
    // 与词组表不一致的多字注记是用户的意思，照常渲染。
    assert_eq!(parsed.readings[1].origin, Origin::User);
    let rendered = render_homophone(&parsed);
    assert_eq!(rendered.text, "他在银行上班，形掌说");
    // 没有片的词组读音在 IndexTTS2 上原字照送、不报。
    let rendered = render_inline_pinyin(&parsed, Some(&pieces(&["XING2", "ZHANG3"])));
    assert_eq!(rendered.text, "他在银行上班，\u{E000}XING2\u{E001}\u{E000}ZHANG3\u{E001}说");
    assert!(rendered.dropped.is_empty());
}

#[test]
fn homophone_rendering() {
    let a = parse("他在这一<行|hang2>做了十年，<银行|yin2 hang2>，头<发|fa4>，<行|xing2>走");
    let rendered = render_homophone(&a);
    // 银 本来只读 yin2：空操作；发 fa4 没有代表字：保留原字、报 dropped。
    assert_eq!(rendered.text, "他在这一航做了十年，银航，头发，形走");
    assert_eq!(rendered.dropped, [reading(14, 15, "fa4", Origin::User)]);

    // 词组表来源的注记：不换、不报。
    let a = annotate("他在银行上班", AnnotateOptions::default());
    let rendered = render_homophone(&a);
    assert_eq!(rendered.text, "他在银行上班");
    assert!(rendered.dropped.is_empty());
}

#[test]
fn tone_mark_readings_render_like_their_digit_form() {
    // 带调拼音在解析时就规范成声调数字，之后各引擎的渲染与 dropped 与数字写法完全一样。
    let marked = parse_for_engine("他在这一<行|háng>做了十年，<银行|yín hang2>，头<发|fà>，<行|XÍNG>走<了|le>");
    let digits = parse_for_engine("他在这一<行|hang2>做了十年，<银行|yin2 hang2>，头<发|fa4>，<行|xing2>走<了|le5>");
    assert_eq!(marked, digits);
    let vocab = pieces(&["HANG2", "XING2", "YIN2", "LE5"]);
    for support in [
        ReadingsSupport::Annotated,
        ReadingsSupport::InlinePinyin,
        ReadingsSupport::Homophone,
        ReadingsSupport::Unsupported,
    ] {
        assert_eq!(
            render(support, &marked, Some(&vocab)),
            render(support, &digits, Some(&vocab)),
            "{support:?}"
        );
    }
    assert_eq!(
        render(ReadingsSupport::Annotated, &marked, None).text,
        "他在这一<行|hang2>做了十年，<银行|yin2 hang2>，头<发|fa4>，<行|xing2>走<了|le5>"
    );
}

#[test]
fn inline_pinyin_replaces_only_pieces_the_vocabulary_has() {
    let vocab = pieces(&["HANG2", "XING2", "YIN2", "JV4"]);
    let a = parse("银<行|hang2>门口<绿|lu4>灯，<银行|yin2 hang2>，AI<行|xing2>，<句|ju4>");
    let rendered = render_inline_pinyin(&a, Some(&vocab));
    // 句 ju4 在词表里写 JV4。
    assert_eq!(
        rendered.text,
        "银\u{E000}HANG2\u{E001}门口绿灯，银\u{E000}HANG2\u{E001}，AI\u{E000}XING2\u{E001}，\u{E000}JV4\u{E001}"
    );
    // 没有 LU4 这个片：drop，原字照送。
    assert_eq!(rendered.dropped, [reading(4, 5, "lu4", Origin::User)]);
    // 不给词表时全部 drop（不会凭空造片）。
    let rendered = render_inline_pinyin(&a, None);
    assert_eq!(rendered.text, a.surface);
    assert_eq!(rendered.dropped.len(), 5);
}

#[test]
fn malformed_literals_reach_only_annotated_engines() {
    let a = parse("去<银行|hang2>办事");
    assert_eq!(a.malformed.len(), 1);
    assert_eq!(render(ReadingsSupport::Annotated, &a, None).text, "去<银行|hang2>办事");
    for support in [
        ReadingsSupport::InlinePinyin,
        ReadingsSupport::Homophone,
        ReadingsSupport::Unsupported,
    ] {
        assert_eq!(render(support, &a, None).text, "去银行办事", "{support:?}");
    }
}

#[test]
fn a_multi_character_reading_passes_index_tts25_losslessly() {
    use crate::synthesize::index_tts2::v25::frontend::{apply_pronunciation_annotations, clean_characters, normalize_text};
    let text = "他在<银行|yin2 hang2>工作了3年，<长|zhang3>大了";
    let a = parse(text);
    let rendered = render(ReadingsSupport::Annotated, &a, None);
    assert_eq!(rendered.text, text);
    assert!(rendered.dropped.is_empty());
    // 2.5 前端（`prepare` 的前三步）：注记在数字规范化里被护住，声调数字不会被读成「二」。
    let prepared = apply_pronunciation_annotations(&normalize_text(&clean_characters(&rendered.text), "zh").to_lowercase());
    assert!(prepared.contains("<|SPECIAL_TOKEN_2|>YIN2 HANG2<|SPECIAL_TOKEN_2|>"), "{prepared}");
    assert!(prepared.contains("<|SPECIAL_TOKEN_2|>ZHANG3<|SPECIAL_TOKEN_2|>"), "{prepared}");
    assert!(prepared.contains("三年"), "{prepared}");
}

/// 各引擎怎么吃读音（v2 读音设计稿 §3 表）的测试常量：新增引擎在这里加一行、在
/// `TtsEngineKind::readings_support` 加一个分支，两处对不上就红。
const DOC_TABLE: [(TtsEngineKind, ReadingsSupport); 6] = [
    (TtsEngineKind::IndexTts25, ReadingsSupport::Annotated),
    (TtsEngineKind::IndexTts2, ReadingsSupport::InlinePinyin),
    (TtsEngineKind::Qwen3Tts, ReadingsSupport::Homophone),
    (TtsEngineKind::GptSovits, ReadingsSupport::Unsupported),
    (TtsEngineKind::VoxCpm2, ReadingsSupport::Unsupported),
    (TtsEngineKind::OmniVoice, ReadingsSupport::Unsupported),
];

#[test]
fn every_engine_declares_how_it_renders_readings() {
    assert_eq!(TtsEngineKind::ALL.len(), DOC_TABLE.len());
    let sample = parse("这一<行|hang2>，<长|zhang3>大");
    let vocab = pieces(&["HANG2", "ZHANG3"]);
    for kind in TtsEngineKind::ALL {
        let (_, documented) = DOC_TABLE
            .iter()
            .find(|(k, _)| *k == kind)
            .unwrap_or_else(|| panic!("{} 不在 DOC_TABLE 里", kind.as_str()));
        let support = kind.readings_support();
        assert_eq!(support, *documented, "{}", kind.as_str());
        let rendered = render(support, &sample, Some(&vocab));
        let all_dropped = rendered.text == sample.surface && rendered.dropped == sample.readings;
        assert_eq!(
            support == ReadingsSupport::Unsupported,
            all_dropped,
            "{}：只有 Unsupported 才等于缺省实现（表面文字 + 全部 dropped）",
            kind.as_str()
        );
        assert_eq!(
            render_unsupported(&sample) == rendered,
            support == ReadingsSupport::Unsupported,
            "{}",
            kind.as_str()
        );
    }
}

// ---- 包装层（移植自 v2 `bcut-tts::engine` 的两条单测） ----

/// 记下送进来的文字，出一段固定音频。
struct Echo {
    kind: TtsEngineKind,
    seen: std::rc::Rc<std::cell::RefCell<Vec<String>>>,
}

impl TtsEngine for Echo {
    fn kind(&self) -> TtsEngineKind {
        self.kind
    }

    fn sample_rate(&self) -> u32 {
        24_000
    }

    fn synthesize(&mut self, request: &TtsRequest, _: ProgressSink<'_>) -> Result<TtsAudio> {
        self.seen.borrow_mut().push(request.text.clone());
        Ok(TtsAudio {
            samples: vec![0.0; 10],
            sample_rate: 24_000,
            readings_dropped: Vec::new(),
        })
    }
}

fn run(kind: TtsEngineKind, text: &str) -> (String, TtsAudio) {
    let seen = std::rc::Rc::new(std::cell::RefCell::new(Vec::new()));
    let mut engine = Annotating::new(Box::new(Echo { kind, seen: seen.clone() }));
    assert_eq!(engine.kind(), kind);
    assert_eq!(engine.sample_rate(), 24_000);
    let audio = engine
        .synthesize(&TtsRequest::new(text, VoiceSpec::Default), &mut |_| true)
        .unwrap();
    let sent = seen.borrow()[0].clone();
    (sent, audio)
}

#[test]
fn plain_text_passes_through_untouched() {
    let (sent, audio) = run(TtsEngineKind::Qwen3Tts, "a < b，这件事我觉得行。");
    assert_eq!(sent, "a < b，这件事我觉得行。");
    assert!(audio.readings_dropped.is_empty());
}

#[test]
fn the_wrapper_renders_per_engine_and_reports_what_was_dropped() {
    let text = "他在这一<行|hang2>做事，剪了头<发|fa4>，去<银行|hang2>";
    let (sent, audio) = run(TtsEngineKind::Qwen3Tts, text);
    assert_eq!(sent, "他在这一航做事，剪了头发，去银行");
    let dropped: Vec<(usize, &str)> = audio.readings_dropped.iter().map(|r| (r.start, r.reading.as_str())).collect();
    // 发 fa4 没有代表字；`<银行|hang2>` 读音数不符是畸形注记（偏移指向表面文字里的字面）。
    assert_eq!(dropped, [(11, "fa4"), (15, "hang2")]);

    let (sent, audio) = run(TtsEngineKind::IndexTts25, text);
    assert_eq!(sent, text);
    assert_eq!(audio.readings_dropped.len(), 1, "只有畸形注记");

    let (sent, audio) = run(TtsEngineKind::GptSovits, text);
    assert_eq!(sent, "他在这一行做事，剪了头发，去银行");
    assert_eq!(
        audio.readings_dropped[0],
        Reading {
            start: 4,
            end: 5,
            reading: "hang2".to_owned(),
            origin: Origin::User,
        }
    );
    assert_eq!(audio.readings_dropped.len(), 3);
}
