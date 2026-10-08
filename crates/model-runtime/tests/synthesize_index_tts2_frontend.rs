//! IndexTTS2 纯逻辑冒烟测试（移植自 v2 `bcut-tts/tests/index_tts2_smoke.rs` 的前半部分）：
//! 切段、采样缺省值、情感向量校验、缺省配置、数字规范化与前端特征。全平台都能跑。
//!
//! `real_vocabulary_pinyin_pieces_tokenize` 只读真 `bpe.model`、不装权重：设了
//! `BAOCUT_TEST_MODELS_DIR` 且其下装有 IndexTTS2 时才跑，否则跳过。

use model_runtime::synthesize::index_tts2::config::RuntimeConfig;
use model_runtime::synthesize::index_tts2::dsp;
use model_runtime::synthesize::index_tts2::emotion::EmotionControl;
use model_runtime::synthesize::index_tts2::normalizer::TextNormalizer;
use model_runtime::synthesize::index_tts2::sampling::GenerationOptions;
use model_runtime::synthesize::index_tts2::segmenter::TextSegmenter;
use model_runtime::synthesize::index_tts2::tokenizer::{Token, Tokenizer};
use model_runtime::synthesize::readings::{PIECE_CLOSE, PIECE_OPEN, parse, render_inline_pinyin};

fn token(id: usize, piece: &str) -> Token {
    Token {
        id,
        piece: piece.to_string(),
    }
}

/// 真 `bpe.model` 的拼音片：注音渲染出的哨兵包住的片整片进分词、数字照常规范化；`render_inline_pinyin`
/// 按真词表换片或报 dropped。
#[test]
fn real_vocabulary_pinyin_pieces_tokenize() {
    let Some(model) = std::env::var_os("BAOCUT_TEST_MODELS_DIR")
        .map(|dir| std::path::PathBuf::from(dir).join("aufklarer/IndexTTS2-MLX-fp16/bpe.model"))
        .filter(|path| path.exists())
    else {
        eprintln!("跳过：未设置 BAOCUT_TEST_MODELS_DIR 或其下没有 IndexTTS2 的 bpe.model");
        return;
    };
    let tokenizer = Tokenizer::load(&model).unwrap();
    let pieces = tokenizer.pinyin_pieces();
    let has = |p: &str| pieces.contains(p);
    assert!(pieces.len() > 1000, "{}", pieces.len());
    assert!(has("XING2") && has("HANG2") && has("ZHONG4") && has("LVE4"));
    // ü：j / q / x 后词表写 V（`JV4`），y 后写 U（`YU2`）。
    assert!(has("JV4") && !has("JU4") && has("YU2"));

    let text = format!("他在这一{PIECE_OPEN}HANG2{PIECE_CLOSE}做了3年，才{PIECE_OPEN}XING2{PIECE_CLOSE}");
    let tokens = tokenizer.tokenize(&text).unwrap();
    let texts: Vec<&str> = tokens.iter().map(|t| t.piece.as_str()).collect();
    let unk = tokenizer.unknown_token_id;
    assert!(tokens.iter().all(|t| Some(t.id) != unk), "{texts:?}");
    assert_eq!(texts.iter().filter(|p| p.ends_with("HANG2")).count(), 1, "{texts:?}");
    assert_eq!(texts.iter().filter(|p| p.ends_with("XING2")).count(), 1, "{texts:?}");
    assert!(texts.contains(&"三"), "数字照常规范化：{texts:?}");

    // 注音渲染走真词表：`ju4` 换成 `JV4`；词表没有 `LU4` 时 `lu4` 进 dropped。
    let annotated = parse("他在这一<行|hang2>做了3年，才<行|xing2>，<绿|lu4>灯，<句|ju4>");
    let rendered = render_inline_pinyin(&annotated, Some(pieces));
    let tokens = tokenizer.tokenize(&rendered.text).unwrap();
    let texts: Vec<&str> = tokens.iter().map(|t| t.piece.as_str()).collect();
    assert!(tokens.iter().all(|t| Some(t.id) != unk), "{texts:?}");
    assert_eq!(texts.iter().filter(|p| p.ends_with("HANG2")).count(), 1, "{texts:?}");
    assert_eq!(texts.iter().filter(|p| p.ends_with("XING2")).count(), 1, "{texts:?}");
    assert!(texts.contains(&"三"), "数字照常规范化：{texts:?}");
    assert!(texts.iter().any(|p| p.ends_with("JV4")), "{texts:?}");
    assert_eq!(
        rendered.dropped.iter().map(|r| r.reading.as_str()).collect::<Vec<_>>(),
        if has("LU4") { vec![] } else { vec!["lu4"] }
    );
}

#[test]
fn segmenter_splits_long_text_under_budget() {
    // 三句话，每句 5 个 token，预算 8：应切成三段而不是塞进一段。
    let mut tokens = Vec::new();
    for sentence in 0..3 {
        for word in 0..4 {
            tokens.push(token(sentence * 10 + word, &format!("▁w{word}")));
        }
        tokens.push(token(sentence * 10 + 9, "."));
    }
    let segments = TextSegmenter::split(&tokens, 8);
    assert_eq!(segments.len(), 3);
    assert!(segments.iter().all(|s| s.len() <= 8));
    let flattened: Vec<usize> = segments.iter().flatten().map(|t| t.id).collect();
    assert_eq!(flattened, tokens.iter().map(|t| t.id).collect::<Vec<_>>());
}

#[test]
fn segmenter_keeps_short_text_whole() {
    let tokens = vec![token(1, "▁hello"), token(2, "▁world"), token(3, ".")];
    let segments = TextSegmenter::split(&tokens, TextSegmenter::DEFAULT_MAX_TOKENS);
    assert_eq!(segments.len(), 1);
    assert_eq!(segments[0].len(), 3);
    assert!(TextSegmenter::split(&[], 120).is_empty());
}

#[test]
fn generation_defaults_match_speech_swift() {
    let options = GenerationOptions::default();
    assert_eq!(options.max_semantic_tokens, 1500);
    assert!(!options.greedy);
    assert_eq!(options.temperature, 0.8);
    assert_eq!(options.top_k, 30);
    assert_eq!(options.top_p, 0.8);
    assert_eq!(options.repetition_penalty, 10.0);
    assert_eq!(options.seed, 11);
    assert_eq!(options.beam_width, 3);
}

#[test]
fn emotion_control_validation() {
    // 官方网页：calm 偏置 0.5625，未超 0.8 不缩；alpha = 1 不截断。
    let ok = EmotionControl::from_sliders([0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.8], 1.0).unwrap();
    assert!((ok.weight_sum() - 0.45).abs() < 1e-6);
    // 合计超 0.8 照官方缩放，不报错；越出 0–1 的滑块才报错。
    let capped = EmotionControl::from_sliders([0.5, 0.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0], 1.0).unwrap();
    assert!((capped.weight_sum() - 0.8).abs() < 1e-6);
    assert!(EmotionControl::from_sliders([1.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0], 1.0).is_err());
    assert!(EmotionControl::from_slice(&[0.1; 7], 1.0).is_err());
}

#[test]
fn runtime_config_fallback_is_index_tts2_v2() {
    let config = RuntimeConfig::fallback();
    assert_eq!(config.output_sample_rate(), 22_050);
    assert_eq!(config.emo_num.iter().sum::<usize>(), 73);
    assert_eq!(config.gpt.condition_type, "conformer_perceiver");
    assert_eq!(config.semantic_codec.codebook_size, 8192);
    assert!(!config.is_v25());
    // 清单没列 config.yaml 时用的就是它。
    assert!(!RuntimeConfig::load(None).unwrap().is_v25());
}

#[test]
fn normalizer_and_front_end_features_are_pure() {
    assert!(!TextNormalizer::normalize("宝剪是一个本地视频工作流工具").is_empty());
    let (features, frames) = dsp::seamless_input_features(&[0.0f32; 100]);
    assert_eq!(frames, 0);
    assert!(features.is_empty());
    let audio: Vec<f32> = (0..16_000).map(|i| ((i as f32) * 0.01).sin() * 0.1).collect();
    let (features, frames) = dsp::seamless_input_features(&audio);
    assert!(frames > 0);
    assert_eq!(features.len(), frames * dsp::SEAMLESS_FEATURE_DIM);
}
