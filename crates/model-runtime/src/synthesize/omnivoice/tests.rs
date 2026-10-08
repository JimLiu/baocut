//! 合成小权重单测：用确定性的小权重跑一遍完整的 MLX 模型图（v2 同一份测试，原样移植）。
//!
//! 小分词器：hop 6（降采样 [2, 3]）、语义采样率同为 24 kHz（重采样直通）、HuBERT 总步长 3
//! （两侧补 1 个零，对应真实模型总步长 320 补 160）、2 个量化器 × 16 码字。
//! 小主干：隐藏 8、2 层、2/1 头、2 码本 × 17（掩码 16）；文本词表 = 256 个字节符号 + 7 个特殊 token。

use std::collections::HashMap;

use super::backbone::{Backbone, predict};
use super::codec::Codec;
use super::config::{CodecConfig, OmniVoiceConfig};
use super::engine::{OmniVoice, Sampling};
use super::tokenizer::Tokenizer;
use crate::synthesize::TtsEngine;
use crate::synthesize::qwen3_tts::sampling::Rng;
use crate::synthesize::qwen3_tts::weights::Weights;
use crate::synthesize::tensor::Array;
use crate::synthesize::types::{TtsProgress, TtsRequest, VoiceSpec};

/// MLX 单测互斥并先确认 Metal：同一进程里并发提交 MLX 图会互相干扰（与 `backend::mlx` 的单测同一把锁）。
pub(crate) fn mlx_lock() -> std::sync::MutexGuard<'static, ()> {
    let guard = crate::synthesize::tensor::host::TEST_LOCK
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    crate::synthesize::tensor::host::ensure_device().expect("Metal 设备");
    guard
}

/// 确定性的小权重：LCG 出 `[-scale, scale)` 均匀值。
struct Filler {
    state: u64,
    tensors: HashMap<String, Array>,
}

impl Filler {
    fn new(seed: u64) -> Self {
        Self {
            state: seed,
            tensors: HashMap::new(),
        }
    }

    fn values(&mut self, n: usize, scale: f32) -> Vec<f32> {
        (0..n)
            .map(|_| {
                self.state = self.state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
                ((self.state >> 40) as f32 / (1u64 << 24) as f32 * 2.0 - 1.0) * scale
            })
            .collect()
    }

    fn rand(&mut self, key: &str, shape: &[i32], scale: f32) {
        let n = shape.iter().product::<i32>() as usize;
        let v = self.values(n, scale);
        self.tensors.insert(key.to_string(), Array::from_slice(&v, shape));
    }

    fn fill(&mut self, key: &str, shape: &[i32], value: f32) {
        let n = shape.iter().product::<i32>() as usize;
        self.tensors.insert(key.to_string(), Array::from_slice(&vec![value; n], shape));
    }

    fn linear(&mut self, prefix: &str, out: i32, input: i32, bias: bool) {
        self.rand(&format!("{prefix}.weight"), &[out, input], 1.0 / (input as f32).sqrt());
        if bias {
            self.rand(&format!("{prefix}.bias"), &[out], 0.1);
        }
    }

    /// PyTorch 布局 `[out, in, k]` 的 Conv1d。
    fn conv(&mut self, prefix: &str, out: i32, input: i32, kernel: i32, bias: bool) {
        let scale = 1.0 / ((input * kernel) as f32).sqrt();
        self.rand(&format!("{prefix}.weight"), &[out, input, kernel], scale);
        if bias {
            self.rand(&format!("{prefix}.bias"), &[out], 0.1);
        }
    }

    fn norm(&mut self, prefix: &str, dim: i32) {
        self.fill(&format!("{prefix}.weight"), &[dim], 1.0);
        self.fill(&format!("{prefix}.bias"), &[dim], 0.0);
    }

    fn snake(&mut self, prefix: &str, dim: i32) {
        self.fill(&format!("{prefix}.alpha"), &[1, dim, 1], 1.0);
    }

    fn dac_residuals(&mut self, prefix: &str, dim: i32) {
        for unit in ["res_unit1", "res_unit2", "res_unit3"] {
            let p = format!("{prefix}.{unit}");
            self.snake(&format!("{p}.snake1"), dim);
            self.conv(&format!("{p}.conv1"), dim, dim, 7, true);
            self.snake(&format!("{p}.snake2"), dim);
            self.conv(&format!("{p}.conv2"), dim, dim, 1, true);
        }
    }

    fn into_weights(self) -> Weights {
        Weights::from_tensors(self.tensors)
    }
}

fn codec_config() -> CodecConfig {
    CodecConfig::parse(
        &serde_json::json!({
            "sample_rate": 24000, "semantic_sample_rate": 24000, "downsample_factor": 3,
            "codebook_size": 16, "codebook_dim": 4, "kernel_size": 3, "unit_kernel_size": 3,
            "strides": [1, 1], "block_dilations": [1, 2], "channel_ratios": [1, 1],
            "target_bandwidths": [16, 32],
            "acoustic_model_config": {
                "encoder_hidden_size": 2, "decoder_hidden_size": 8, "hidden_size": 6,
                "hop_length": 6, "downsampling_ratios": [2, 3], "upsampling_ratios": [3, 2]
            },
            "semantic_model_config": {
                "hidden_size": 8, "num_attention_heads": 2, "num_hidden_layers": 2,
                "conv_dim": [4, 4], "conv_kernel": [3, 1], "conv_stride": [3, 1],
                "num_conv_pos_embeddings": 4, "num_conv_pos_embedding_groups": 2,
                "layer_norm_eps": 1e-5, "conv_bias": false,
                "feat_extract_norm": "group", "do_stable_layer_norm": false
            }
        })
        .to_string(),
    )
    .unwrap()
}

/// 小分词器的全部权重（PyTorch 布局），外加几项训练专用 / EMA 键验证加载时会丢弃。
fn codec_weights(f: &mut Filler) {
    // HuBERT：两层卷积 [3/3, 1/1]、group norm、投影、weight-norm 位置卷积（k4、2 组）、2 层。
    let h = "semantic_model";
    f.conv(&format!("{h}.feature_extractor.conv_layers.0.conv"), 4, 1, 3, false);
    f.norm(&format!("{h}.feature_extractor.conv_layers.0.layer_norm"), 4);
    f.conv(&format!("{h}.feature_extractor.conv_layers.1.conv"), 4, 4, 1, false);
    f.norm(&format!("{h}.feature_projection.layer_norm"), 4);
    f.linear(&format!("{h}.feature_projection.projection"), 8, 4, true);
    let pos = format!("{h}.encoder.pos_conv_embed.conv");
    f.rand(&format!("{pos}.parametrizations.weight.original0"), &[1, 1, 4], 1.0);
    f.rand(&format!("{pos}.parametrizations.weight.original1"), &[8, 4, 4], 1.0);
    f.rand(&format!("{pos}.bias"), &[8], 0.1);
    f.norm(&format!("{h}.encoder.layer_norm"), 8);
    for i in 0..2 {
        let p = format!("{h}.encoder.layers.{i}");
        for proj in ["q_proj", "k_proj", "v_proj", "out_proj"] {
            f.linear(&format!("{p}.attention.{proj}"), 8, 8, true);
        }
        f.norm(&format!("{p}.layer_norm"), 8);
        f.linear(&format!("{p}.feed_forward.intermediate_dense"), 16, 8, true);
        f.linear(&format!("{p}.feed_forward.output_dense"), 8, 16, true);
        f.norm(&format!("{p}.final_layer_norm"), 8);
    }
    // 语义编码器：conv k3 无偏置；两块 × 两个残差单元（无偏置）+ 块卷积（stride 1 → k3，有偏置）。
    f.conv("encoder_semantic.conv", 8, 8, 3, false);
    for i in 0..2 {
        let p = format!("encoder_semantic.conv_blocks.{i}");
        for j in 0..2 {
            f.conv(&format!("{p}.res_units.{j}.conv1"), 8, 8, 3, false);
            f.conv(&format!("{p}.res_units.{j}.conv2"), 8, 8, 1, false);
        }
        f.conv(&format!("{p}.conv"), 8, 8, 3, true);
    }
    // DAC 编码器：2 → 4 → 8 通道，输出 6。
    f.conv("acoustic_encoder.conv1", 2, 1, 7, true);
    for (i, (dim, stride)) in [(2, 2), (4, 3)].into_iter().enumerate() {
        let p = format!("acoustic_encoder.block.{i}");
        f.dac_residuals(&p, dim);
        f.snake(&format!("{p}.snake1"), dim);
        f.conv(&format!("{p}.conv1"), 2 * dim, dim, 2 * stride, true);
    }
    f.snake("acoustic_encoder.snake1", 8);
    f.conv("acoustic_encoder.conv2", 6, 8, 3, true);
    // DAC 解码器：6 → 8 → 4 → 2 → 1；转置卷积权重 `[in, out, 2·stride]`。
    f.conv("acoustic_decoder.conv1", 8, 6, 7, true);
    for (i, (dim, stride)) in [(8, 3), (4, 2)].into_iter().enumerate() {
        let p = format!("acoustic_decoder.block.{i}");
        f.snake(&format!("{p}.snake1"), dim);
        f.rand(
            &format!("{p}.conv_t1.weight"),
            &[dim, dim / 2, 2 * stride],
            1.0 / (dim as f32).sqrt(),
        );
        f.rand(&format!("{p}.conv_t1.bias"), &[dim / 2], 0.1);
        f.dac_residuals(&p, dim / 2);
    }
    f.snake("acoustic_decoder.snake1", 2);
    f.conv("acoustic_decoder.conv2", 1, 2, 7, true);
    // 拼接后的 14 维（声学 6 + 语义 8）、2 个量化器（码本 16 × 4）。
    f.linear("fc", 14, 14, true);
    f.linear("fc2", 6, 14, true);
    for i in 0..2 {
        let p = format!("quantizer.quantizers.{i}");
        f.rand(&format!("{p}.codebook.embed"), &[16, 4], 1.0);
        f.linear(&format!("{p}.project_in"), 4, 14, true);
        f.linear(&format!("{p}.project_out"), 14, 4, true);
        f.fill(&format!("{p}.codebook.cluster_size"), &[16], 1.0);
        f.fill(&format!("{p}.codebook.embed_avg"), &[16, 4], 0.0);
        f.fill(&format!("{p}.codebook.inited"), &[1], 1.0);
    }
    f.linear("fc1", 8, 14, true);
    f.conv("decoder_semantic.conv1", 8, 8, 3, false);
}

fn tiny_codec() -> Codec {
    let mut f = Filler::new(21);
    codec_weights(&mut f);
    let mut weights = f.into_weights();
    let codec = Codec::load(&mut weights, &codec_config()).unwrap();
    assert!(weights.keys().is_empty(), "{:?}", weights.keys());
    codec
}

const SPECIALS: [&str; 7] = [
    "<|denoise|>",
    "<|lang_start|>",
    "<|lang_end|>",
    "<|instruct_start|>",
    "<|instruct_end|>",
    "<|text_start|>",
    "<|text_end|>",
];
const TEXT_VOCAB: i32 = 256 + SPECIALS.len() as i32;

/// 字节级词表（无 merge）+ 7 个特殊 token（id 256 起）。
fn tiny_tokenizer() -> Tokenizer {
    let mut vocab = serde_json::Map::new();
    for b in 0..=255u8 {
        // GPT-2 的字节 → 可见字符映射由分词器内部生成；这里直接按同一张表造词表。
        vocab.insert(byte_char(b).to_string(), serde_json::Value::from(b as u64));
    }
    let added: Vec<serde_json::Value> = SPECIALS
        .iter()
        .enumerate()
        .map(|(i, s)| serde_json::json!({"id": 256 + i, "content": s}))
        .collect();
    Tokenizer::from_json(&serde_json::json!({
        "model": {"type": "BPE", "vocab": vocab, "merges": []},
        "added_tokens": added
    }))
    .unwrap()
}

fn byte_char(b: u8) -> char {
    let mut extra = 0u32;
    for x in 0..=255u32 {
        let printable = (0x21..=0x7e).contains(&x) || (0xa1..=0xac).contains(&x) || (0xae..=0xff).contains(&x);
        let c = if printable {
            char::from_u32(x).unwrap()
        } else {
            extra += 1;
            char::from_u32(256 + extra - 1).unwrap()
        };
        if x == u32::from(b) {
            return c;
        }
    }
    unreachable!()
}

fn backbone_config() -> OmniVoiceConfig {
    OmniVoiceConfig::parse(
        &serde_json::json!({
            "audio_mask_id": 16, "audio_vocab_size": 17, "num_audio_codebook": 2,
            "llm_config": {
                "hidden_size": 8, "intermediate_size": 16, "num_attention_heads": 2,
                "num_hidden_layers": 2, "num_key_value_heads": 1, "head_dim": 4,
                "rms_norm_eps": 1e-6, "rope_parameters": {"rope_theta": 10000},
                "vocab_size": TEXT_VOCAB
            }
        })
        .to_string(),
    )
    .unwrap()
}

fn backbone_weights(f: &mut Filler) {
    f.rand("llm.embed_tokens.weight", &[TEXT_VOCAB, 8], 1.0);
    f.rand("audio_embeddings.weight", &[2 * 17, 8], 1.0);
    for i in 0..2 {
        let p = format!("llm.layers.{i}");
        let a = format!("{p}.self_attn");
        f.linear(&format!("{a}.q_proj"), 8, 8, false);
        f.linear(&format!("{a}.k_proj"), 4, 8, false);
        f.linear(&format!("{a}.v_proj"), 4, 8, false);
        f.linear(&format!("{a}.o_proj"), 8, 8, false);
        f.fill(&format!("{a}.q_norm.weight"), &[4], 1.0);
        f.fill(&format!("{a}.k_norm.weight"), &[4], 1.0);
        f.linear(&format!("{p}.mlp.gate_proj"), 16, 8, false);
        f.linear(&format!("{p}.mlp.up_proj"), 16, 8, false);
        f.linear(&format!("{p}.mlp.down_proj"), 8, 16, false);
        f.fill(&format!("{p}.input_layernorm.weight"), &[8], 1.0);
        f.fill(&format!("{p}.post_attention_layernorm.weight"), &[8], 1.0);
    }
    f.fill("llm.norm.weight", &[8], 1.0);
    // 输出头放大些，让各候选的对数概率拉开，贪心结果对浮点误差不敏感。
    f.rand("audio_heads.weight", &[2 * 17, 8], 3.0);
}

fn tiny_backbone() -> Backbone {
    let mut f = Filler::new(31);
    backbone_weights(&mut f);
    let mut weights = f.into_weights();
    let backbone = Backbone::load(&mut weights, &backbone_config()).unwrap();
    assert!(weights.keys().is_empty(), "{:?}", weights.keys());
    backbone
}

fn tiny_model() -> OmniVoice {
    OmniVoice::assemble(tiny_tokenizer(), tiny_backbone(), tiny_codec()).unwrap()
}

fn host(x: &Array) -> Vec<f32> {
    x.as_dtype(crate::synthesize::tensor::Dtype::Float32)
        .unwrap()
        .as_slice::<f32>()
        .to_vec()
}

fn wave(n: usize) -> Vec<f32> {
    (0..n)
        .map(|i| (i as f32 * 0.37).sin() * 0.4 + (i as f32 * 0.051).cos() * 0.2)
        .collect()
}

#[test]
fn tiny_codec_config_matches_hf_derivations() {
    let _mlx = mlx_lock();
    let config = codec_config();
    assert_eq!(config.hop_length(), 6);
    assert_eq!(config.frame_rate(), 4000);
    assert_eq!(config.semantic_downsample_factor(), 2);
    // 1000·32 // (4000 · 4 bit) = 2 个量化器。
    assert_eq!(config.num_quantizers(), 2);
}

#[test]
fn codec_encodes_one_frame_per_hop_and_decodes_back_to_hop_samples() {
    let _mlx = mlx_lock();
    let codec = tiny_codec();
    assert_eq!((codec.num_codebooks(), codec.hop()), (2, 6));
    let frames = 7;
    let codes = codec.encode(&wave(6 * frames)).unwrap();
    assert_eq!(codes.len(), 2 * frames);
    assert!(codes.iter().all(|&c| (0..16).contains(&c)), "{codes:?}");
    // 编码是确定性的。
    assert_eq!(codec.encode(&wave(6 * frames)).unwrap(), codes);
    let audio = codec.decode(&codes, frames).unwrap();
    assert_eq!(audio.len(), 6 * frames);
    assert!(audio.iter().all(|s| s.is_finite()));
    // 长度不是 hop 的整数倍、形状不符都报错。
    assert!(codec.encode(&wave(6 * frames + 1)).is_err());
    assert!(codec.decode(&codes, frames + 1).is_err());
}

#[test]
fn codec_load_keeps_unknown_keys_for_the_leftover_check() {
    let _mlx = mlx_lock();
    let mut f = Filler::new(21);
    codec_weights(&mut f);
    f.fill("quantizer.quantizers.2.codebook.embed", &[16, 4], 0.0);
    let mut weights = f.into_weights();
    Codec::load(&mut weights, &codec_config()).unwrap();
    // 第 3 个量化器不在配置里：不能被静默丢弃，引擎据此报「未使用的权重」。
    assert_eq!(weights.keys(), vec!["quantizer.quantizers.2.codebook.embed"]);
}

#[test]
fn backbone_attention_is_bidirectional() {
    let _mlx = mlx_lock();
    let backbone = tiny_backbone();
    let prefix = backbone.embed_text(&[1, 2, 3]).unwrap();
    let logits_for = |codes: &[u32]| {
        let target = backbone.embed_audio(codes, 3).unwrap();
        let x = crate::synthesize::tensor::ops::concatenate_axis(&[&prefix, &target], 1).unwrap();
        let logits = backbone.logits(&x, 3).unwrap();
        assert_eq!(logits.shape(), vec![2, 3, 17]);
        host(&logits)
    };
    let a = logits_for(&[16, 16, 16, 16, 16, 16]);
    // 只改最后一帧的 token：因果注意力下第 0 帧不受影响，双向注意力下会变。
    let b = logits_for(&[16, 16, 5, 16, 16, 7]);
    let first_frame = |v: &[f32]| v[..17].to_vec();
    assert_ne!(first_frame(&a), first_frame(&b));
}

#[test]
fn predict_applies_guidance_in_log_space_and_never_picks_mask() {
    let _mlx = mlx_lock();
    // 1 码本 × 1 帧、词表 3（掩码 = 2）。
    let cond = Array::from_slice(&[0.0f32, 1.0, 10.0], &[1, 1, 3]);
    let (pred, score) = predict(&cond, None, 0.0, 2).unwrap();
    assert_eq!(pred, vec![1]);
    let lse = (0f64.exp() + 1f64.exp() + 10f64.exp()).ln();
    assert!((f64::from(score[0]) - (1.0 - lse)).abs() < 1e-4, "{score:?}");

    // 有引导：log_softmax(lp_c + g·(lp_c − lp_u))，再在非掩码项里取最大。
    let uncond = Array::from_slice(&[0.0f32, 3.0, 0.0], &[1, 1, 3]);
    let (pred, score) = predict(&cond, Some(&uncond), 2.0, 2).unwrap();
    let ls = |v: [f64; 3]| {
        let lse = v.iter().map(|x| x.exp()).sum::<f64>().ln();
        v.map(|x| x - lse)
    };
    let c = ls([0.0, 1.0, 10.0]);
    let u = ls([0.0, 3.0, 0.0]);
    let g = ls([0, 1, 2].map(|i| c[i] + 2.0 * (c[i] - u[i])));
    let best = if g[0] > g[1] { 0 } else { 1 };
    assert_eq!(pred, vec![best as u32]);
    assert!((f64::from(score[0]) - g[best]).abs() < 1e-4, "{score:?} vs {g:?}");
}

fn sampling(steps: usize, max_tokens: usize) -> Sampling {
    Sampling {
        cfg: 2.0,
        steps,
        max_tokens,
    }
}

#[test]
fn generate_fills_every_position_and_is_seeded() {
    let _mlx = mlx_lock();
    let model = tiny_model();
    let run = |seed: u64, cfg: f32| {
        let mut steps = Vec::new();
        let tokens = model
            .generate(
                "ab",
                5,
                None,
                Some("English"),
                Some("female"),
                Sampling { cfg, ..sampling(4, 100) },
                &mut Rng::new(seed),
                &mut |s| {
                    steps.push(s);
                    true
                },
            )
            .unwrap();
        assert_eq!(steps, vec![1, 2, 3, 4]);
        tokens
    };
    let a = run(7, 2.0);
    assert_eq!(a.len(), 2 * 5);
    assert!(a.iter().all(|&t| t < 16), "{a:?}");
    assert_eq!(run(7, 2.0), a);
    // cfg = 0 跳过无条件分支，也能跑完。
    assert!(run(7, 0.0).iter().all(|&t| t < 16));
}

#[test]
fn generate_can_be_cancelled_between_steps() {
    let _mlx = mlx_lock();
    let model = tiny_model();
    let err = model
        .generate("ab", 4, None, None, None, sampling(4, 100), &mut Rng::new(1), &mut |s| s < 2)
        .unwrap_err();
    assert!(err.to_string().contains("合成已取消"), "{err}");
}

#[test]
fn prefix_marks_reference_with_denoise_and_wraps_text() {
    let _mlx = mlx_lock();
    let model = tiny_model();
    let ids = model.prefix_ids("b", Some("a."), true, Some("English"), None);
    let text: String = ids
        .iter()
        .map(|&id| match id {
            256..=262 => SPECIALS[(id - 256) as usize].to_string(),
            b => (b as u8 as char).to_string(),
        })
        .collect();
    assert_eq!(
        text,
        "<|denoise|><|lang_start|>English<|lang_end|><|instruct_start|>None<|instruct_end|>\
         <|text_start|>a. b<|text_end|>"
    );
    let ids = model.prefix_ids("b", None, false, None, Some("male"));
    assert_eq!(ids[0], 257, "无参考时不带 <|denoise|>");
}

fn collect_progress(events: &mut Vec<String>) -> impl FnMut(TtsProgress) -> bool + '_ {
    move |p| {
        events.push(match p {
            TtsProgress::ChunkStarted { index, count } => format!("start {index}/{count}"),
            TtsProgress::Tokens { index, generated } => format!("tok {index}:{generated}"),
            TtsProgress::ChunkFinished { index, .. } => format!("done {index}"),
            TtsProgress::Loading { stage } => format!("load {stage}"),
        });
        true
    }
}

#[test]
fn voice_design_chunks_reuse_the_first_chunk_as_reference() {
    let _mlx = mlx_lock();
    let model = tiny_model();
    let chunks = vec!["ab.".to_string(), "cd.".to_string()];
    let mut events = Vec::new();
    let mut sink = collect_progress(&mut events);
    let audio = model
        .synthesize_chunks(
            &chunks,
            None,
            None,
            Some("female"),
            None,
            1.0,
            sampling(2, 6),
            &mut Rng::new(3),
            &mut sink,
        )
        .unwrap();
    drop(sink);
    assert_eq!(
        events,
        vec![
            "start 0/2",
            "tok 0:1",
            "tok 0:2",
            "done 0",
            "start 1/2",
            "tok 1:1",
            "tok 1:2",
            "done 1"
        ]
    );
    // 两侧各补 0.1 s。
    assert!(audio.len() >= 2 * 2400, "{}", audio.len());
    assert!(audio.iter().all(|s| s.is_finite() && s.abs() <= 1.0));
}

#[test]
fn clone_prompt_encodes_reference_and_duration_fixes_target_length() {
    let _mlx = mlx_lock();
    let model = tiny_model();
    // 0.01 s 的参考：240 个样本 = 40 帧。
    let prompt = model.prompt_from_samples(&wave(240), Some("ab")).unwrap();
    let mut events = Vec::new();
    let mut sink = collect_progress(&mut events);
    let audio = model
        .synthesize_chunks(
            &["cd".to_string()],
            Some(&prompt),
            Some("English"),
            None,
            // 4000 Hz 帧率下 0.002 s = 8 帧 = 48 个样本。
            Some(0.002),
            1.0,
            sampling(2, 100),
            &mut Rng::new(5),
            &mut sink,
        )
        .unwrap();
    drop(sink);
    assert_eq!(events.first().map(String::as_str), Some("start 0/1"));
    assert!(audio.iter().all(|s| s.is_finite()));
}

#[test]
fn engine_voice_design_is_deterministic_under_a_seed() {
    let _mlx = mlx_lock();
    let mut model = tiny_model();
    let mut request = TtsRequest::new("ab cd", VoiceSpec::Default);
    request.instruct = Some("female, low pitch".into());
    request.sampling.steps = Some(2);
    request.sampling.max_tokens = Some(6);
    request.sampling.seed = Some(9);
    let a = model.synthesize(&request, &mut |_| true).unwrap();
    assert_eq!(a.sample_rate, 24_000);
    let b = model.synthesize(&request, &mut |_| true).unwrap();
    assert_eq!(a.samples, b.samples);

    // 取消、未知 instruct、认不出的内置音色都报错（v2 这里测的是未解析的声音档案；v3 的声音档案在 Runtime 里
    // 解析成参考音频，引擎只见 `Clone`，改测同样走 `reference_for` 拒掉的未知预置音色）。
    let err = model.synthesize(&request, &mut |_| false).unwrap_err();
    assert!(err.to_string().contains("合成已取消"), "{err}");
    request.instruct = Some("robot".into());
    assert!(model.synthesize(&request, &mut |_| true).is_err());
    request.instruct = None;
    request.voice = VoiceSpec::Preset { speaker: "p1".into() };
    assert!(model.synthesize(&request, &mut |_| true).is_err());
}

#[test]
fn engine_clones_a_reference_file() {
    let _mlx = mlx_lock();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("ref.wav");
    crate::synthesize::wav::write_wav_pcm16(&path, &wave(2400), 24_000).unwrap();
    let mut model = tiny_model();
    let mut request = TtsRequest::new(
        "cd",
        VoiceSpec::Clone {
            reference_audio: path,
            reference_text: Some("ab".into()),
        },
    );
    request.sampling.steps = Some(2);
    request.sampling.max_tokens = Some(6);
    let mut events = Vec::new();
    let audio = model.synthesize(&request, &mut collect_progress(&mut events)).unwrap();
    assert_eq!(events.first().map(String::as_str), Some("load reference"));
    assert!(!audio.samples.is_empty());
}
