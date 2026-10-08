//! 引擎常量与 `tests/fixtures/speech-engine-limits.json` 一致：同一份夹具也由 `packages/models` 的
//! `speech-bundles.test.ts` 对照 Runtime 的模型包描述，两侧改了一边另一边的测试就会失败。
//! 语言表里的每个码引擎自己都认（v2 `language_codes_are_accepted_by_the_engines`）。

use std::path::Path;

use model_runtime::synthesize::gpt_sovits::text::Language;
use model_runtime::synthesize::index_tts2::{self, v25::tiktoken};
use model_runtime::synthesize::{omnivoice, qwen3_tts, voxcpm2};
use serde_json::Value;

fn limits() -> Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/speech-engine-limits.json");
    serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
}

fn range(limits: &Value, engine: &str, knob: &str) -> [f64; 4] {
    let knob = &limits["knobs"][engine][knob];
    ["min", "max", "step", "default"].map(|key| knob[key].as_f64().unwrap_or_else(|| panic!("{engine}.{key}")))
}

fn languages<'a>(limits: &'a Value, engine: &str) -> Vec<&'a str> {
    limits["languages"][engine]
        .as_array()
        .unwrap()
        .iter()
        .map(|code| code.as_str().unwrap())
        .collect()
}

fn close(actual: [f64; 4], expected: [f64; 4], what: &str) {
    for (a, e) in actual.iter().zip(expected) {
        assert!((a - e).abs() < 1e-6, "{what}: engine {actual:?} vs fixture {expected:?}");
    }
}

#[test]
fn knob_ranges_and_defaults_match_the_shared_fixture() {
    let limits = limits();
    let (min, max, step) = voxcpm2::CFG_RANGE;
    close(
        [min, max, step, voxcpm2::DEFAULT_CFG].map(f64::from),
        range(&limits, "voxcpm2", "cfg"),
        "voxcpm2 cfg",
    );
    let (min, max, step) = voxcpm2::STEPS_RANGE;
    close(
        [min, max, step, voxcpm2::DEFAULT_STEPS].map(|v| v as f64),
        range(&limits, "voxcpm2", "steps"),
        "voxcpm2 steps",
    );

    let (min, max, step) = omnivoice::SPEED_RANGE;
    close(
        [min, max, step, 1.0].map(f64::from),
        range(&limits, "omnivoice", "speed"),
        "omnivoice speed",
    );
    let (min, max, step) = omnivoice::CFG_RANGE;
    close(
        [min, max, step, omnivoice::DEFAULT_CFG].map(f64::from),
        range(&limits, "omnivoice", "cfg"),
        "omnivoice cfg",
    );
    let (min, max, step) = omnivoice::STEPS_RANGE;
    close(
        [min, max, step, omnivoice::DEFAULT_STEPS].map(|v| v as f64),
        range(&limits, "omnivoice", "steps"),
        "omnivoice steps",
    );

    // IndexTTS 2.5 的引擎只有区间，步长与默认值（1 倍）只在 Runtime 一侧。
    let [min, max, ..] = range(&limits, "index-tts2.5", "speed");
    let (engine_min, engine_max) = index_tts2::SPEAKING_RATE_RANGE;
    assert_eq!((f64::from(engine_min), f64::from(engine_max)), (min, max));
}

#[test]
fn language_codes_are_accepted_by_the_engines() {
    let limits = limits();
    for code in languages(&limits, "qwen3-tts") {
        assert!(qwen3_tts::tokens::language_id(code).is_some(), "Qwen3-TTS does not know {code}");
    }
    for code in languages(&limits, "index-tts2.5") {
        assert!(tiktoken::language_id(code).is_some(), "IndexTTS 2.5 does not know {code}");
    }
    for code in languages(&limits, "gpt-sovits") {
        assert!(Language::resolve(Some(code), "text").is_ok(), "GPT-SoVITS does not know {code}");
    }
    // 严格的引擎拒绝表外的语言；地区与书写变体归到主语言。
    assert!(Language::resolve(Some("ja"), "text").is_err());
    assert_eq!(Language::resolve(Some("zh-Hans"), "text").unwrap(), Language::Zh);
    assert!(qwen3_tts::tokens::language_id("ar").is_none());
}
