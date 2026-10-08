//! Fixed provider responses exercise production code; semantic references are review aids.
use serde_json::Value;
use speech_doc::asr_rows::RowIn;
use speech_doc::{
    atomize::{atomize_words, join_word_texts},
    build::build_doc,
    doc::{DocEngine, DocMedia, TranscriptDoc},
    engines::polish::{PolishOptions, run_polish_file_contract},
    filepipe::{lines, lines_translation, parse_translate_source, polish_txt},
    llm::{LlmError, LlmJson, LlmRequest},
    rebind::SeqIds,
};

fn cases() -> Vec<Value> {
    let data: Value = serde_json::from_str(include_str!(
        "fixtures/subtitle-multilingual-cases/cases.json"
    ))
    .unwrap();
    data["cases"].as_array().unwrap().clone()
}
fn text<'a>(v: &'a Value, k: &str) -> &'a str {
    v[k].as_str().unwrap()
}
fn document(source: &str, lang: &str) -> TranscriptDoc {
    build_doc(
        &[RowIn::new(0.0, 16.0, source)],
        DocMedia {
            id: None,
            path: None,
            hash: "synthetic-test".into(),
            duration: 16.0,
            sample_rate: None,
        },
        lang,
        DocEngine {
            name: "fixture".into(),
            version: None,
            aligned_words: false,
        },
        None,
    )
}
struct RecordedPolish {
    answer: String,
    calls: usize,
}
impl LlmJson for RecordedPolish {
    fn complete(&mut self, request: &LlmRequest) -> Result<String, LlmError> {
        self.calls += 1;
        assert!(self.calls <= 3, "unexpected retries: {}", request.kind);
        assert_eq!(request.kind, "polish");
        let (before, rest) = request
            .user
            .split_once(polish_txt::FENCE_EDIT_BEGIN)
            .unwrap();
        let (_, after) = rest.split_once(polish_txt::FENCE_EDIT_END).unwrap();
        Ok(format!(
            "{before}{}\n{}\n{}{after}",
            polish_txt::FENCE_EDIT_BEGIN,
            self.answer,
            polish_txt::FENCE_EDIT_END
        ))
    }
}

#[test]
fn multilingual_polish_rebinds_recorded_corrections_without_fallback() {
    for c in cases() {
        let id = text(&c, "id");
        let mut doc = document(text(&c["polish"], "input"), text(&c, "sourceLang"));
        let before = doc.words.clone();
        let expected = document(text(&c["polish"], "reference"), text(&c, "sourceLang"));
        let mut provider = RecordedPolish {
            answer: text(&c["polish"], "reference").into(),
            calls: 0,
        };
        let result = run_polish_file_contract(
            &mut doc,
            &mut provider,
            &PolishOptions {
                language: text(&c, "sourceLang").into(),
                instructions: Some(text(&c["polish"], "instruction").into()),
                autocorrect: false,
                speaker_names: false,
                speaker_repair: false,
                ..PolishOptions::default()
            },
            &mut SeqIds::default(),
            &mut |_| {},
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(result.fallback_pages, 0, "{id}");
        assert!(!result.sentences.iter().any(|s| s.fallback), "{id}");
        assert_eq!(
            join_word_texts(doc.words.iter()),
            join_word_texts(expected.words.iter()),
            "{id}"
        );
        assert_eq!(
            doc.words.len(),
            before.len(),
            "{id}: this local correction must preserve word count"
        );
        for (old, new) in before.iter().zip(&doc.words) {
            assert_eq!((old.t0, old.t1), (new.t0, new.t1), "{id}: stable timing");
            if old.text == new.text {
                assert_eq!(old.id, new.id, "{id}: unchanged word identity");
            }
        }
    }
}
fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

#[test]
fn multilingual_translation_accepts_references_and_rejects_copied_source() {
    for c in cases() {
        let id = text(&c, "id");
        let source = text(&c, "source");
        let words = atomize_words(source);
        let numbered = words
            .iter()
            .enumerate()
            .map(|(i, (w, _))| format!("[{}]{w}", i + 1))
            .collect::<Vec<_>>()
            .join(" ");
        let html = format!(
            "<article lang=\"{}\" data-target=\"{}\" data-bcut-format=\"translation-source/1\" data-project-fp=\"test\"><section id=\"p\"><p id=\"{id}\" data-align-words=\"{}\" data-align-needed=\"true\">{}</p></section></article>",
            text(&c, "sourceLang"),
            text(&c, "targetLang"),
            escape(&numbered),
            escape(source)
        );
        let page = parse_translate_source(&html).unwrap();
        let input = lines_translation::render(&page);
        for (target, accepted) in [
            (text(&c["translation"], "reference"), true),
            (source, false),
        ] {
            let response = lines::render(&lines::Record {
                n: 1,
                rewrite: false,
                chunks: vec![lines::Chunk {
                    reference: lines::Reference::Quote {
                        left: source.into(),
                        right: source.into(),
                    },
                    text: target.into(),
                    marks: vec![],
                }],
            });
            let parsed = lines_translation::parse(&page, &input, &response);
            assert_eq!(
                parsed.translation.translations.contains_key(id),
                accepted,
                "{id}: {:?}",
                parsed.translation.diagnostics
            );
            if accepted {
                assert_eq!(parsed.translation.translations[id], target, "{id}");
            } else {
                assert!(parsed.translation.retry_ids.iter().any(|x| x == id), "{id}");
            }
        }
    }
}

/// Reading units per second of display time, as production sizes a budget
/// (`engines::translate::reading_budget_duration`).
fn budget_for(seconds: f64, target_lang: &str) -> usize {
    let cps = match target_lang.split('-').next().unwrap() {
        "zh" => 9.0,
        "ja" | "ko" => 13.0,
        _ => 21.0,
    };
    ((seconds * cps).floor() as usize).max(1)
}

/// Letters of the scripts whose stored words come from a word model.
fn model_segmented(ch: char) -> bool {
    matches!(
        ch as u32,
        0x0E00..=0x0EFF | 0x1000..=0x109F | 0x1780..=0x17FF | 0x19E0..=0x19FF | 0xA9E0..=0xA9FF | 0xAA60..=0xAA7F
    )
}

/// With a production-style budget every case is shown in pieces. A piece mark
/// between two letters of a script without spaces must sit where the
/// dictionary segmenter also breaks: the model translates each piece on its
/// own, and a mark inside `หน้าต่าง` ("window") came back as "front panel".
#[test]
fn multilingual_piece_marks_never_cut_inside_a_word() {
    for c in cases() {
        let id = text(&c, "id");
        let source = text(&c, "source");
        let target = text(&c, "targetLang");
        let numbered = atomize_words(source)
            .iter()
            .enumerate()
            .map(|(i, (w, _))| format!("[{}]{w}", i + 1))
            .collect::<Vec<_>>()
            .join(" ");
        let html = format!(
            "<article lang=\"{}\" data-target=\"{target}\" data-bcut-format=\"translation-source/1\" data-project-fp=\"test\"><section id=\"p\"><p id=\"{id}\" data-align-words=\"{}\" data-align-needed=\"true\">{}</p></section></article>",
            text(&c, "sourceLang"),
            escape(&numbered),
            escape(source)
        );
        let mut page = parse_translate_source(&html).unwrap();
        let seconds = c["syntheticDurationSeconds"].as_f64().unwrap();
        page.sections[0].sentences[0].budget = Some(budget_for(seconds, target));
        let input = lines_translation::render(&page);
        let line = input
            .lines()
            .find(|line| line.starts_with("1 "))
            .unwrap_or_else(|| panic!("{id}: {input}"));
        let shown = line.split_once(" ≥").map_or(line, |(_, rest)| rest);
        let shown = shown.split_once(' ').map_or(shown, |(_, rest)| rest);
        let pieces: Vec<&str> = shown.split(" ¦ ").collect();
        if !source.chars().any(model_segmented) {
            continue;
        }
        assert!(pieces.len() > 1, "{id}: {line}");
        let breaks = speech_doc::word_breaks::dictionary_word_boundaries(source);
        let mut at = 0;
        for piece in &pieces[..pieces.len() - 1] {
            at = source[at..].find(piece).unwrap() + at + piece.len();
            let before = source[..at].chars().last().unwrap();
            let after = source[at..].chars().next().unwrap();
            if model_segmented(before) && model_segmented(after) {
                assert!(breaks.contains(&at), "{id}: mark inside a word: {line}");
            }
        }
    }
}
