//! WASM 入口在原生上的行为：同一套导出函数，界面与 Node 经线性内存调用的就是这些。

use editor_wasm::{bc_alloc, bc_free, bc_output_len, bc_output_ptr, bc_speech_sentences, speech_sentences};
use serde_json::{Value, json};

fn output() -> Value {
    let bytes = unsafe { std::slice::from_raw_parts(bc_output_ptr(), bc_output_len()) };
    serde_json::from_slice(bytes).unwrap()
}

fn call(input: &[u8]) -> u32 {
    let ptr = bc_alloc(input.len());
    unsafe {
        std::ptr::copy_nonoverlapping(input.as_ptr(), ptr, input.len());
        let status = bc_speech_sentences(ptr, input.len());
        bc_free(ptr, input.len());
        status
    }
}

fn speech() -> Value {
    json!({
        "schema": "baocut.speech/1",
        "timescale": 1000,
        "words": [
            { "id": "w0", "start": 0, "end": 400, "text": "你好；", "speaker": "a" },
            { "id": "w1", "start": 500, "end": 900, "text": "世界。", "speaker": "a" },
            { "id": "w2", "start": 1000, "end": 1300, "text": "第二句", "speaker": "b" }
        ]
    })
}

#[test]
fn sentences_come_back_as_json_with_integer_ticks() {
    assert_eq!(call(speech().to_string().as_bytes()), 0);
    let result = output();
    assert_eq!(result["derivation"], "speech-doc/sentences");
    assert_eq!(result["timescale"], 1000);
    assert!(result["editViewHash"].as_str().unwrap().starts_with("sha256:"));
    let sentences = result["sentences"].as_array().unwrap();
    assert_eq!(sentences.len(), 2);
    assert_eq!(sentences[0]["id"], "s-w0");
    assert_eq!(sentences[0]["wordIds"], json!(["w0", "w1"]));
    assert_eq!(sentences[0]["text"], "你好；世界。");
    assert_eq!(sentences[0]["speaker"], "a");
    assert_eq!((sentences[0]["start"].as_i64(), sentences[0]["end"].as_i64()), (Some(0), Some(900)));
    assert!(sentences[0]["fingerprint"].as_str().unwrap().starts_with("2:w0:w1:"));
    assert_eq!(sentences[1]["id"], "s-w2");
}

#[test]
fn same_body_same_answer() {
    let first = speech_sentences(speech().to_string().as_bytes()).unwrap();
    let second = speech_sentences(speech().to_string().as_bytes()).unwrap();
    assert_eq!(first, second);
}

#[test]
fn unreadable_bodies_are_invalid_speech() {
    assert_eq!(call(b"not json"), 1);
    assert_eq!(output()["code"], "INVALID_SPEECH");
    let missing_time = json!({ "schema": "baocut.speech/1", "words": [{ "id": "w0", "text": "x" }] });
    assert_eq!(
        speech_sentences(missing_time.to_string().as_bytes()).unwrap_err().code,
        "INVALID_SPEECH"
    );
}
