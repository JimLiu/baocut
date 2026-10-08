//! 已有转写的识别说话人：提案（聚类复用已有说话人、新说话人编号、译文重切的试算）与应用（改名、切句、译文重切）。

use editor_wasm::speakers::{apply_speakers, speaker_proposal};
use editor_wasm::speech_sentences;
use serde_json::{Value, json};

/// 两句：「Hello there, how are you?」与「Fine.」；词时间连续（不因停顿断句）。
fn speech(speaker: Option<&str>) -> Value {
    let texts = ["Hello", "there,", "how", "are", "you?", "Fine."];
    let words: Vec<Value> = texts
        .iter()
        .enumerate()
        .map(|(index, text)| {
            let start = index as i64 * 500;
            // 前两词与末词长，中间三词短：聚类 A 与已有说话人重叠最多。
            let end = start + if (2..5).contains(&index) { 200 } else { 450 };
            let mut word = json!({ "id": format!("w{index}"), "start": start, "end": end, "text": text });
            if let Some(speaker) = speaker {
                word["speaker"] = json!(speaker);
            }
            word
        })
        .collect();
    let mut body = json!({ "schema": "baocut.speech/1", "timescale": 1000, "words": words, "sentences": null });
    if let Some(speaker) = speaker {
        body["speakers"] = json!([{ "id": speaker, "name": "说话人 1" }]);
    }
    body
}

/// 每句一条已审的中文译文，指纹按句子规则现算（新鲜的译文）。
fn translation(speech: &Value) -> Value {
    let sentences: Value = serde_json::from_str(&speech_sentences(speech.to_string().as_bytes()).unwrap()).unwrap();
    let texts = ["你好，你最近怎么样？", "还好。"];
    let units: Vec<Value> = sentences["sentences"]
        .as_array()
        .unwrap()
        .iter()
        .zip(texts)
        .map(|(sentence, text)| {
            json!({
                "id": format!("t-{}", sentence["id"].as_str().unwrap()),
                "sourceSentenceId": sentence["id"],
                "sourceFingerprint": sentence["fingerprint"],
                "naturalText": text,
                "alignment": null,
                "status": "reviewed",
            })
        })
        .collect();
    json!({
        "schema": "baocut.translation/2",
        "language": "zh-Hans",
        "sourceBasis": {
            "speechRef": { "id": "doc-speech", "revision": "1" },
            "sequenceId": "seq-1",
            "scopeLineage": [],
            "editViewHash": sentences["editViewHash"],
        },
        "units": units,
    })
}

fn propose(input: Value) -> Value {
    serde_json::from_str(&speaker_proposal(input.to_string().as_bytes()).unwrap()).unwrap()
}

fn apply(input: Value) -> Value {
    serde_json::from_str(&apply_speakers(input.to_string().as_bytes()).unwrap()).unwrap()
}

#[test]
fn a_matching_cluster_keeps_the_existing_speaker_and_renaming_leaves_translations_alone() {
    let speech = speech(Some("a"));
    let translation = translation(&speech);
    let proposal = propose(json!({
        "speech": speech,
        "translations": [translation],
        "labels": ["spk-1", "spk-1", "spk-1", "spk-1", "spk-1", "spk-1"],
    }));
    assert_eq!(proposal["relabeled"], 0);
    assert_eq!(proposal["wordSpeakers"], json!({}));
    assert_eq!(proposal["translationsSplit"], 0);
    let speakers = proposal["speakers"].as_array().unwrap();
    assert_eq!(speakers.len(), 1);
    assert_eq!(speakers[0]["id"], "a");
    assert_eq!(speakers[0]["name"], "说话人 1");
    assert_eq!(speakers[0]["isNew"], false);
    assert_eq!(speakers[0]["words"], 6);
    assert_eq!(speakers[0]["sentences"], 2);
    assert_eq!(speakers[0]["clips"].as_array().unwrap().len(), 2);

    let applied = apply(json!({
        "speech": speech,
        "translations": [translation],
        "wordSpeakers": {},
        "speakers": [{ "id": "a", "name": " 主持人 " }],
    }));
    assert_eq!(applied["speech"]["speakers"], json!([{ "id": "a", "name": "主持人" }]));
    let mut expected = speech.clone();
    expected["speakers"] = json!([{ "id": "a", "name": "主持人" }]);
    assert_eq!(applied["speech"], expected, "只改了名字");
    assert_eq!(applied["translations"], json!([null]), "译文没变");
    assert_eq!(applied["translationsSplit"], 0);
}

#[test]
fn a_new_speaker_boundary_splits_the_sentence_and_its_translation_without_retranslating() {
    let speech = speech(Some("a"));
    let translation = translation(&speech);
    let labels = json!(["A", "A", "B", "B", "B", "A"]);
    let proposal = propose(json!({ "speech": speech, "translations": [translation], "labels": labels }));
    assert_eq!(proposal["wordSpeakers"], json!({ "w2": "spk-2", "w3": "spk-2", "w4": "spk-2" }));
    assert_eq!(proposal["relabeled"], 3);
    assert_eq!(proposal["translationsSplit"], 1);
    let speakers = proposal["speakers"].as_array().unwrap();
    assert_eq!(
        speakers
            .iter()
            .map(|s| (s["id"].clone(), s["name"].clone(), s["isNew"].clone()))
            .collect::<Vec<_>>(),
        [
            (json!("a"), json!("说话人 1"), json!(false)),
            // 「说话人 1」这个名字已被占用：ID 与名字都往后排。
            (json!("spk-2"), json!("说话人 2"), json!(true)),
        ]
    );
    assert_eq!(speakers[0]["sentences"], 2);
    assert_eq!(speakers[1]["sentences"], 1);
    assert_eq!(speakers[1]["words"], 3);
    let clip = &speakers[1]["clips"][0];
    assert_eq!(clip["sentenceId"], "s-w2");
    assert_eq!((clip["start"].as_i64(), clip["end"].as_i64()), (Some(1000), Some(2200)));
    assert_eq!(clip["text"], "how are you?");

    let applied = apply(json!({
        "speech": speech,
        "translations": [translation],
        "wordSpeakers": proposal["wordSpeakers"],
        "speakers": [{ "id": "a", "name": "说话人 1" }, { "id": "spk-2", "name": "嘉宾" }],
    }));
    let body = &applied["speech"];
    assert_eq!(
        body["speakers"],
        json!([{ "id": "a", "name": "说话人 1" }, { "id": "spk-2", "name": "嘉宾" }])
    );
    let word_speakers: Vec<&str> = body["words"]
        .as_array()
        .unwrap()
        .iter()
        .map(|w| w["speaker"].as_str().unwrap())
        .collect();
    assert_eq!(word_speakers, ["a", "a", "spk-2", "spk-2", "spk-2", "a"]);
    assert_eq!(applied["translationsSplit"], 1);
    assert_eq!(applied["sentencesSplit"], 1);
    assert_eq!(applied["dropped"], json!([]));

    // 译文：原来的第一句切成两句，各自带上新句子的指纹，拼起来还是原来的译文。
    let translations = applied["translations"].as_array().unwrap();
    assert_eq!(translations.len(), 1);
    let units = translations[0]["units"].as_array().unwrap();
    let sentences: Value = serde_json::from_str(&speech_sentences(body.to_string().as_bytes()).unwrap()).unwrap();
    let ids: Vec<&str> = sentences["sentences"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, ["s-w0", "s-w2", "s-w5"]);
    let by_sentence = |id: &str| units.iter().find(|u| u["sourceSentenceId"] == id).unwrap();
    let joined = format!(
        "{}{}",
        by_sentence("s-w0")["naturalText"].as_str().unwrap(),
        by_sentence("s-w2")["naturalText"].as_str().unwrap()
    );
    assert_eq!(joined.replace(' ', ""), "你好，你最近怎么样？");
    for sentence in sentences["sentences"].as_array().unwrap() {
        assert_eq!(
            by_sentence(sentence["id"].as_str().unwrap())["sourceFingerprint"],
            sentence["fingerprint"]
        );
    }
    assert_eq!(by_sentence("s-w5")["naturalText"], "还好。");
}

#[test]
fn a_transcript_without_speakers_gets_numbered_speakers_in_order_of_appearance() {
    let speech = speech(None);
    let proposal = propose(json!({
        "speech": speech,
        "labels": ["X", "X", "Y", "Y", null, "X"],
    }));
    let speakers = proposal["speakers"].as_array().unwrap();
    assert_eq!(
        speakers.iter().map(|s| (s["id"].clone(), s["name"].clone())).collect::<Vec<_>>(),
        [(json!("spk-1"), json!("说话人 1")), (json!("spk-2"), json!("说话人 2"))]
    );
    // 拿不到证据的词保持原样（没有说话人）。
    assert!(proposal["wordSpeakers"].get("w4").is_none());
    assert_eq!(proposal["relabeled"], 5);
    assert_eq!(proposal["translationsSplit"], 0);
}

#[test]
fn bad_inputs_are_reported() {
    let speech = speech(Some("a"));
    let error = speaker_proposal(json!({ "speech": speech, "labels": ["A"] }).to_string().as_bytes()).unwrap_err();
    assert_eq!(error.code, "INVALID_PROPOSAL");
    let error = apply_speakers(
        json!({ "speech": speech, "wordSpeakers": { "w0": "ghost" }, "speakers": [] })
            .to_string()
            .as_bytes(),
    )
    .unwrap_err();
    assert_eq!(error.code, "INVALID_PROPOSAL");
    let error = speaker_proposal(b"{}").unwrap_err();
    assert_eq!(error.code, "INVALID_INPUT");
}

#[test]
fn two_translations_in_the_same_language_are_split_separately() {
    let speech = speech(Some("a"));
    let first = translation(&speech);
    let mut second = first.clone();
    second["units"][0]["naturalText"] = json!("嗨，你还好吗？");
    let labels = json!(["A", "A", "B", "B", "B", "A"]);
    let proposal = propose(json!({ "speech": speech, "translations": [first, second], "labels": labels }));
    assert_eq!(proposal["translationsSplit"], 2);
    let applied = apply(json!({
        "speech": speech,
        "translations": [first, second],
        "wordSpeakers": proposal["wordSpeakers"],
        "speakers": [{ "id": "spk-2", "name": "说话人 2" }],
    }));
    let translations = applied["translations"].as_array().unwrap();
    assert_eq!(translations.len(), 2);
    for (written, original) in translations.iter().zip(["你好，你最近怎么样？", "嗨，你还好吗？"]) {
        assert_eq!(written["language"], "zh-Hans");
        let units = written["units"].as_array().unwrap();
        assert_eq!(units.len(), 3);
        let joined: String = units[..2].iter().map(|u| u["naturalText"].as_str().unwrap()).collect();
        assert_eq!(joined.replace(' ', ""), original);
    }
}
