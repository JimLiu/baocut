//! 往返验收：v2 的 transcript.json → v3 → v2 逐字段相等（声明的取整之内）；v3 流程写出的正文 → v2 → v3 不丢字段。

use std::path::{Path, PathBuf};

use editor_semantics::MediaTime;
use serde_json::{Value, json};
use speech_doc::TranscriptDoc;
use speech_doc_bridge::time::{FRESH_TIMESCALE, seconds_to_ticks};
use speech_doc_bridge::{MediaFacts, V3Documents, WriteBase, from_transcript_doc, to_transcript_doc};
use video_model::VersionRef;
use video_model::speech::SpeechBody;
use video_model::translation::{SourceBasis, TranslationBody, UnitStatus};

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

fn read_json(path: &Path) -> Value {
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn media_of(doc: &TranscriptDoc) -> MediaFacts {
    let ticks = seconds_to_ticks(doc.media.duration, FRESH_TIMESCALE).unwrap();
    assert!(ticks.exact, "样例的时长是整微秒");
    MediaFacts {
        asset_id: doc.media.id.clone(),
        path: doc.media.path.clone(),
        content_hash: doc.media.hash.clone(),
        duration: MediaTime {
            ticks: ticks.ticks.to_string(),
            timescale: FRESH_TIMESCALE,
        },
        sample_rate: doc.media.sample_rate,
    }
}

fn media_facts() -> MediaFacts {
    MediaFacts {
        asset_id: Some("asset-1".into()),
        path: None,
        content_hash: "sha256:00".into(),
        duration: MediaTime {
            ticks: "9000".into(),
            timescale: 1000,
        },
        sample_rate: Some(16_000),
    }
}

fn basis() -> SourceBasis {
    SourceBasis {
        speech_ref: VersionRef {
            id: "doc-speech".into(),
            revision: "1".into(),
        },
        sequence_id: "seq-1".into(),
        scope_lineage: Vec::new(),
        edit_view_hash: "sha256:00".into(),
        extra: Default::default(),
    }
}

/// v2 → v3 → v2，不带底稿（第一次接入的情形）。
fn v2_round_trip(original: &TranscriptDoc) -> (TranscriptDoc, speech_doc_bridge::V3Write) {
    let source_basis = basis();
    let written = from_transcript_doc(
        original,
        &WriteBase {
            speech: None,
            translations: &[],
            source_basis: Some(&source_basis),
        },
    )
    .unwrap();
    let media = media_of(original);
    let back = to_transcript_doc(&V3Documents {
        media: &media,
        language: written.language.as_deref(),
        speech: &written.speech,
        translations: &written.translations,
    })
    .unwrap();
    (back, written)
}

#[test]
fn v2_examples_survive_v3_and_back_field_for_field() {
    let examples = Path::new(env!("CARGO_MANIFEST_DIR")).join("../speech-doc/tests/fixtures/examples");
    let mut seen = 0;
    for entry in std::fs::read_dir(&examples).unwrap() {
        let path = entry.unwrap().path().join("transcript.json");
        if !path.is_file() {
            continue;
        }
        seen += 1;
        let original: TranscriptDoc = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        let (back, written) = v2_round_trip(&original);
        assert_eq!(written.report.rounded_times, 0, "{}", path.display());
        assert!(
            written.report.dropped.is_empty(),
            "{}: {:?}",
            path.display(),
            written.report.dropped
        );
        assert_eq!(back, original, "{}", path.display());
        back.validate().unwrap();
        // 带着刚写出的正文作底稿再写一次，结果不变。
        let again = from_transcript_doc(
            &back,
            &WriteBase {
                speech: Some(&written.speech),
                translations: &written.translations,
                source_basis: None,
            },
        )
        .unwrap();
        assert_eq!(again.speech, written.speech, "{}", path.display());
        assert_eq!(again.translations, written.translations, "{}", path.display());
    }
    assert_eq!(seen, 3);
}

#[test]
fn every_v2_field_survives_within_the_declared_rounding() {
    let original: TranscriptDoc = serde_json::from_value(read_json(&fixtures().join("v2-full-transcript.json"))).unwrap();
    let (back, written) = v2_round_trip(&original);

    // 1.2345675 秒不是整微秒：按 §2.10 取整到 1 234 568 微秒，报告记一次取整、偏差不超过半个刻度。
    assert_eq!(written.report.rounded_times, 1);
    assert!(written.report.max_rounding_error_seconds <= 0.5e-6 + 1e-12);
    assert_eq!(written.speech.words[1].end, Some(1_234_568));
    let mut expected = original.clone();
    expected.words[1].t1 = 1.234568;
    assert_eq!(back, expected);

    // 补充的字段都写进了 v3 的正文。
    let speech = serde_json::to_value(&written.speech).unwrap();
    assert_eq!(speech["userBreaks"], json!({ "g1.1": "break", "g2.1": "no-break" }));
    assert_eq!(speech["autoBreaks"]["vertical"], json!({ "g2.2": "no-break" }));
    assert_eq!(speech["layoutProfileId"], json!("vertical"));
    assert_eq!(speech["paragraphBreaks"], json!(["g2.0"]));
    assert_eq!(speech["words"][4]["glue"], json!(true));
    assert_eq!(speech["words"][2]["hidden"], json!(true));
    assert_eq!(
        speech["words"][0]["timingQuality"],
        json!("estimated"),
        "alignedWords 为假的引擎写的词"
    );
    assert_eq!(speech["stages"]["aligned"]["lowConfidence"], json!(["g1.2"]));
    assert_eq!(
        speech["engine"],
        json!({ "name": "script-align", "version": "2", "alignedWords": false })
    );

    let zh = written.translations.iter().find(|t| t.language == "zh").unwrap();
    let zh_value = serde_json::to_value(zh).unwrap();
    let first = &zh_value["units"][0];
    assert_eq!(first["sourceFingerprint"], json!("2:Hello:world.:abc"));
    assert_eq!(first["alignment"]["correspondence"], json!("block"));
    assert_eq!(
        first["alignment"]["blocks"][0],
        json!({ "id": "b1", "sourceWordRange": { "firstWordId": "g1.0", "lastWordId": "g1.0" },
                "targetTextRange": { "start": 0, "end": 3 }, "confidence": 0.9, "flags": ["anchor"] })
    );
    assert_eq!(first["alignment"]["split"]["mode"], json!("many-to-one"));
    let second = &zh.units[1];
    assert_eq!(second.status, UnitStatus::Stale);
    assert_eq!(second.source_fingerprint, "3:안녕:friends.:def");
    assert_eq!(
        second.display_rewrite.as_ref().unwrap().natural_fingerprint.as_deref(),
        Some("5:abc")
    );
    let split = second.alignment.as_ref().unwrap().split.as_ref().unwrap();
    assert_eq!(split.legacy.as_ref().unwrap().crossing, Some(true));
    assert_eq!(
        second.alignment.as_ref().unwrap().source_word_ids,
        ["g2.0", "g2.1", "g2.2"],
        "没有词锚时取源句的可见词"
    );
    let ja = written.translations.iter().find(|t| t.language == "ja").unwrap();
    assert_eq!(
        ja.units[0].alignment.as_ref().unwrap().source_word_ids,
        ["g1.0", "g1.1"],
        "隐藏的词不进句子"
    );

    // 再走一遍 v3 → v2 → v3（带底稿）：补充的字段原样回来。
    let media = media_of(&original);
    let again = to_transcript_doc(&V3Documents {
        media: &media,
        language: written.language.as_deref(),
        speech: &written.speech,
        translations: &written.translations,
    })
    .unwrap();
    let rewritten = from_transcript_doc(
        &again,
        &WriteBase {
            speech: Some(&written.speech),
            translations: &written.translations,
            source_basis: None,
        },
    )
    .unwrap();
    assert_eq!(rewritten.speech, written.speech);
    assert_eq!(rewritten.translations, written.translations);
    assert_eq!(rewritten.report.rounded_times, 0);
}

/// v3 → v2 → v3，底稿就是读出的那份。
fn v3_round_trip(language: Option<&str>, speech: &SpeechBody, translations: &[TranslationBody]) -> speech_doc_bridge::V3Write {
    let media = media_facts();
    let doc = to_transcript_doc(&V3Documents {
        media: &media,
        language,
        speech,
        translations,
    })
    .unwrap();
    from_transcript_doc(
        &doc,
        &WriteBase {
            speech: Some(speech),
            translations,
            source_basis: None,
        },
    )
    .unwrap()
}

#[test]
fn transcribe_and_translate_bodies_survive_v2_and_back() {
    // 样例由现有的 TS 写入方生成：转写流程（speechDocumentOperation）、翻译流程（translationBody），
    // 第二句再经界面就地改过一次（editUnit）。
    let speech_file = read_json(&fixtures().join("v3-asr-speech.json"));
    let speech_value = speech_file["body"].clone();
    let translation_value = read_json(&fixtures().join("v3-asr-translation.json"));
    let speech: SpeechBody = serde_json::from_value(speech_value.clone()).unwrap();
    let translation: TranslationBody = serde_json::from_value(translation_value.clone()).unwrap();
    let language = speech_file["language"].as_str();

    let media = media_facts();
    let doc = to_transcript_doc(&V3Documents {
        media: &media,
        language,
        speech: &speech,
        translations: std::slice::from_ref(&translation),
    })
    .unwrap();
    assert!(!doc.engine.aligned_words, "有 estimated / missing 的词");
    assert_eq!(doc.engine.name, "local");
    assert_eq!(doc.words[1].text, " there.", "词的文本原样，含前导空格");
    assert_eq!(doc.words[5].sp, "", "没有说话人的词归到保留的说话人");
    assert_eq!(doc.trans["zh-Hans"]["s-w-000003"], "你还好吗？");
    assert!(doc.trans_src["zh-Hans"]["s-w-000001"].starts_with("sha256:"));

    let written = v3_round_trip(language, &speech, std::slice::from_ref(&translation));
    assert_eq!(written.language.as_deref(), language);
    assert_eq!(serde_json::to_value(&written.speech).unwrap(), speech_value);
    assert_eq!(written.translations.len(), 1);
    assert_eq!(serde_json::to_value(&written.translations[0]).unwrap(), translation_value);
    assert!(written.removed_languages.is_empty());
    assert_eq!(written.report.rounded_times, 0);
}

#[test]
fn legacy_imported_speech_survives_v2_and_back() {
    let file = read_json(&fixtures().join("v3-legacy-speech.json"));
    let speech: SpeechBody = serde_json::from_value(file["body"].clone()).unwrap();
    let written = v3_round_trip(file["language"].as_str(), &speech, &[]);
    assert_eq!(serde_json::to_value(&written.speech).unwrap(), file["body"]);
}

#[test]
fn edits_made_in_v2_are_written_back_onto_the_base() {
    let file = read_json(&fixtures().join("v3-legacy-speech.json"));
    let speech: SpeechBody = serde_json::from_value(file["body"].clone()).unwrap();
    let media = media_facts();
    let mut doc = to_transcript_doc(&V3Documents {
        media: &media,
        language: Some("en"),
        speech: &speech,
        translations: &[],
    })
    .unwrap();
    // 改一个词的文本、拉长一个词、加一个新词、取消隐藏、加一个用户换行与一句译文。
    doc.words[0].text = "Well".into();
    doc.words[5].t1 = 3.95;
    doc.words.push(speech_doc::Word {
        id: "w-new".into(),
        t0: 4.0,
        t1: 4.1000001,
        text: "Bye.".into(),
        sp: "s2".into(),
        glue: false,
    });
    doc.hidden.clear();
    doc.breaks.insert("g1.3".into(), speech_doc::doc::BreakOverride::Break);
    doc.trans
        .insert("fr".into(), [("s-g2.0".to_owned(), "Merci à tous.".to_owned())].into());

    let source_basis = basis();
    let written = from_transcript_doc(
        &doc,
        &WriteBase {
            speech: Some(&speech),
            translations: &[],
            source_basis: Some(&source_basis),
        },
    )
    .unwrap();
    let body = serde_json::to_value(&written.speech).unwrap();
    assert_eq!(body["words"][0]["text"], json!("Well"));
    assert_eq!(body["words"][5]["end"], json!(3_950_000));
    assert_eq!(
        body["words"][6],
        json!({ "id": "w-new", "start": 4_000_000, "end": 4_100_000, "text": "Bye.", "speaker": "s2" })
    );
    assert!(body["words"][2].get("hidden").is_none());
    assert_eq!(body["sentences"], Value::Null, "词或隐藏变了：存下来的句子清成 null");
    assert_eq!(body["userBreaks"], json!({ "g1.3": "break" }));
    assert_eq!(body["legacy"], file["body"]["legacy"], "不认识的字段原样带回");
    assert_eq!(body["speakers"][1]["hue"], Value::Null);
    assert_eq!(written.report.rounded_times, 1);

    let fr = &written.translations[0];
    assert_eq!(fr.language, "fr");
    assert_eq!(fr.units[0].id, "t-s-g2.0");
    assert_eq!(fr.units[0].status, UnitStatus::Draft);
    assert_eq!(fr.units[0].source_fingerprint, "");
    let alignment = fr.units[0].alignment.as_ref().unwrap();
    assert_eq!(alignment.source_word_ids, ["g2.0", "g2.1"]);
    assert!(alignment.text_hash.starts_with("sha256:") && alignment.text_hash.len() == 71);
}

#[test]
fn inconsistent_inputs_are_rejected() {
    let file = read_json(&fixtures().join("v3-legacy-speech.json"));
    let speech: SpeechBody = serde_json::from_value(file["body"].clone()).unwrap();
    let media = media_facts();
    let to = |speech: &SpeechBody, translations: &[TranslationBody]| {
        to_transcript_doc(&V3Documents {
            media: &media,
            language: None,
            speech,
            translations,
        })
    };

    let mut wrong = speech.clone();
    wrong.schema = "baocut.speech/2".into();
    assert!(to(&wrong, &[]).is_err());
    let mut untimed = speech.clone();
    untimed.words[0].start = None;
    assert!(to(&untimed, &[]).is_err());

    let translation: TranslationBody = serde_json::from_value(read_json(&fixtures().join("v3-asr-translation.json"))).unwrap();
    let mut legacy = translation.clone();
    legacy.schema = "baocut.translation/1".into();
    assert!(to(&speech, &[legacy]).is_err(), "旧项目导入的 /1 译文不能换算");
    assert!(
        to(&speech, &[translation.clone(), translation.clone()]).is_err(),
        "同一语言两份译文"
    );
    let mut duplicated = translation.clone();
    duplicated.units.push(duplicated.units[0].clone());
    assert!(to(&speech, &[duplicated]).is_err(), "同一句两个单元");

    // 新语言没有 sourceBasis 时不能写。
    let mut doc = to(&speech, &[]).unwrap();
    doc.trans.insert("de".into(), [("s-g1.0".to_owned(), "Hallo".to_owned())].into());
    assert!(
        from_transcript_doc(
            &doc,
            &WriteBase {
                speech: Some(&speech),
                translations: &[],
                source_basis: None
            }
        )
        .is_err()
    );
    // transAlign 引用了没有 trans 的句子。
    doc.trans_align.insert(
        "de".into(),
        [(
            "s-g2.0".to_owned(),
            speech_doc::doc::TransAlign::new(speech_doc::doc::AlignMode::Independent, Vec::new(), Vec::new()),
        )]
        .into(),
    );
    let source_basis = basis();
    assert!(
        from_transcript_doc(
            &doc,
            &WriteBase {
                speech: Some(&speech),
                translations: &[],
                source_basis: Some(&source_basis)
            }
        )
        .is_err()
    );
}
