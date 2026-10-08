//! 来源自带章节：结构化 `chapters[]`、简介里的时间戳大纲与显式大纲三种来源，吸附到转写的结构起点（matched / ambiguous /
//! unanchored），以及清洗后的行。

use editor_wasm::source_chapters::source_chapters;
use serde_json::{Value, json};

/// 一段转写（毫秒刻度）：0 秒起说话人 a 两句；120 秒起说话人 b 一句；300 秒 a、301 秒 b 各一句（同一秒窗里两个段落起点）。
fn speech() -> Value {
    let words = [
        ("w0", 0, 400, "Hello", "a"),
        ("w1", 400, 800, "there.", "a"),
        ("w2", 1000, 1400, "Second", "a"),
        ("w3", 1400, 1800, "sentence.", "a"),
        ("w4", 120_000, 120_400, "Bye", "b"),
        ("w5", 120_400, 120_800, "now.", "b"),
        ("w6", 300_000, 300_400, "Yes.", "a"),
        ("w7", 301_000, 301_400, "No.", "b"),
    ];
    json!({
        "schema": "baocut.speech/1",
        "timescale": 1000,
        "speakers": [{ "id": "a", "name": "A" }, { "id": "b", "name": "B" }],
        "words": words
            .iter()
            .map(|(id, start, end, text, speaker)| json!({ "id": id, "start": start, "end": end, "text": text, "speaker": speaker }))
            .collect::<Vec<_>>(),
        "sentences": null,
    })
}

fn run(input: Value) -> Value {
    serde_json::from_str(&source_chapters(input.to_string().as_bytes()).unwrap()).unwrap()
}

fn statuses(result: &Value) -> Vec<&str> {
    result["entries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["status"].as_str().unwrap())
        .collect()
}

#[test]
fn structured_chapters_snap_to_paragraph_starts() {
    let result = run(json!({
        "speech": speech(),
        "source": {
            "title": "Talk",
            "chapters": [
                { "start": 0, "end": 119, "title": " Intro " },
                { "start": 119, "end": 300, "title": "Goodbye" },
                { "start": 300, "end": 500, "title": "Debate" },
                { "start": 500, "title": "Silence" },
                { "start": 700, "title": "" }
            ],
            "description": "0:00 ignored\n1:00 ignored"
        },
        "durationSeconds": 600.0,
    }));
    assert_eq!(result["sourceChapters"].as_array().unwrap().len(), 4);
    assert_eq!(result["sourceChapters"][0], json!({ "start": 0.0, "end": 119.0, "title": "Intro" }));
    assert_eq!(statuses(&result), vec!["matched", "matched", "ambiguous", "unanchored"]);

    // 119 → 段落起点 120（作者的时间写早了一秒）。
    let goodbye = &result["entries"][1];
    assert_eq!(goodbye["source"], json!({ "start": 119.0, "title": "Goodbye" }));
    assert_eq!(goodbye["at"], 120.0);
    assert_eq!(goodbye["anchor"]["tier"], "paragraph");
    assert_eq!(goodbye["anchor"]["id"], "p-w4");
    assert!(goodbye["anchor"]["snippet"].as_str().unwrap().starts_with("Bye now."));

    // 300：同一秒窗里两个段落起点，缺省取最近的，候选都列出来。
    let debate = &result["entries"][2];
    assert_eq!(debate["at"], 300.0);
    assert_eq!(debate["candidates"].as_array().unwrap().len(), 2);
    assert_eq!(debate["candidates"][1]["time"], 301.0);

    // 500：附近没有任何结构起点，保留原时间、没有锚。
    let silence = &result["entries"][3];
    assert_eq!(silence["at"], 500.0);
    assert!(silence.get("anchor").is_none());
    assert_eq!(silence["candidates"], json!([]));

    assert_eq!(
        result["rows"],
        json!([
            { "title": "Intro", "start": 0.0, "end": 120.0, "status": "matched" },
            { "title": "Goodbye", "start": 120.0, "end": 300.0, "status": "matched" },
            { "title": "Debate", "start": 300.0, "end": 500.0, "status": "ambiguous" },
            { "title": "Silence", "start": 500.0, "end": 600.0, "status": "unanchored" },
        ])
    );
    assert_eq!(
        result["summary"],
        json!({ "entries": 4, "matched": 2, "ambiguous": 1, "snapped": 0, "unanchored": 1 })
    );
}

#[test]
fn the_wide_window_only_takes_paragraph_and_sentence_starts() {
    let result = run(json!({
        "speech": speech(),
        "source": { "chapters": [
            { "start": 0, "title": "Intro" },
            { "start": 116, "title": "Early" },
            { "start": 124.3, "title": "Late" }
        ] },
        "durationSeconds": 600.0,
    }));
    assert_eq!(statuses(&result), vec!["matched", "snapped", "unanchored"]);
    // 116：同一秒窗 [115, 118] 里没有起点，放宽窗 [112, 122] 里有 120 的段落起点。
    let early = &result["entries"][1];
    assert_eq!(early["at"], 120.0);
    assert_eq!(early["anchor"]["tier"], "paragraph");
    assert_eq!(early["candidates"].as_array().unwrap().len(), 1);
    // 124.3：放宽窗 [120.3, 130.3] 里只有词起点（120.4 的 now.），词不进放宽窗；同一秒窗里也没有词，保留原时间。
    assert_eq!(result["entries"][2]["at"], 124.3);
    assert_eq!(
        result["summary"],
        json!({ "entries": 3, "matched": 1, "ambiguous": 0, "snapped": 1, "unanchored": 1 })
    );
}

#[test]
fn description_outline_is_parsed_when_there_are_no_structured_chapters() {
    let result = run(json!({
        "speech": speech(),
        "source": {
            "chapters": null,
            "description": "A talk.\n\nTimestamps:\n0:00 - Intro\n1:59 - Goodbye\n\nFollow me."
        },
        "durationSeconds": 600.0,
    }));
    assert_eq!(
        result["sourceChapters"],
        json!([{ "start": 0.0, "title": "Intro" }, { "start": 119.0, "title": "Goodbye" }])
    );
    assert_eq!(result["rows"][1]["start"], 120.0);
}

#[test]
fn an_explicit_outline_wins_over_the_source() {
    let source = json!({ "chapters": [{ "start": 0, "title": "From source" }, { "start": 10, "title": "Other" }] });
    let rows = run(json!({
        "speech": speech(),
        "source": source,
        "outline": [{ "at": 299.5, "title": "Debate" }, { "at": 1, "title": "Opening" }],
        "durationSeconds": 600.0,
    }));
    assert_eq!(
        rows["sourceChapters"],
        json!([{ "start": 1.0, "title": "Opening" }, { "start": 299.5, "title": "Debate" }])
    );
    // 首章钳到 0，状态仍是它自己那一条的。
    assert_eq!(
        rows["rows"][0],
        json!({ "title": "Opening", "start": 0.0, "end": 300.0, "status": "matched" })
    );

    let text = run(json!({
        "speech": speech(),
        "source": source,
        "outline": "00:00 Opening\n02:00 Goodbye",
        "durationSeconds": 600.0,
    }));
    assert_eq!(text["sourceChapters"][1], json!({ "start": 120.0, "title": "Goodbye" }));
    assert_eq!(statuses(&text), vec!["matched", "matched"]);
}

#[test]
fn without_a_transcript_or_with_snap_off_every_entry_keeps_its_own_time() {
    let source = json!({ "chapters": [{ "start_time": 0, "end_time": 119, "title": "Intro" }, { "start_time": 119, "title": "Goodbye" }] });
    for input in [
        json!({ "source": source, "durationSeconds": 600.0 }),
        json!({ "speech": speech(), "source": source, "durationSeconds": 600.0, "snap": false }),
    ] {
        let result = run(input);
        assert_eq!(statuses(&result), vec!["unanchored", "unanchored"]);
        assert_eq!(result["rows"][1]["start"], 119.0);
        assert_eq!(result["summary"]["unanchored"], 2);
    }
}

#[test]
fn no_source_chapters_is_an_empty_result() {
    for source in [
        json!({ "title": "x" }),
        json!({ "description": "Watch until 12:34 for the reveal." }),
    ] {
        let result = run(json!({ "speech": speech(), "source": source, "durationSeconds": 60.0 }));
        assert_eq!(result["sourceChapters"], json!([]));
        assert_eq!(result["rows"], json!([]));
        assert_eq!(result["summary"]["entries"], 0);
    }
    let result = run(json!({ "durationSeconds": 60.0 }));
    assert_eq!(result["entries"], json!([]));
}

#[test]
fn unknown_fields_and_bad_speech_are_rejected() {
    let error = source_chapters(json!({ "durationSeconds": 1.0, "extra": true }).to_string().as_bytes()).unwrap_err();
    assert_eq!(error.code, "INVALID_INPUT");
    let bad = json!({
        "speech": { "schema": "baocut.speech/1", "words": [{ "id": "w0", "text": "x" }] },
        "outline": [{ "at": 0, "title": "A" }],
        "durationSeconds": 1.0,
    });
    let error = source_chapters(bad.to_string().as_bytes()).unwrap_err();
    assert_eq!(error.code, "INVALID_SPEECH");
}
