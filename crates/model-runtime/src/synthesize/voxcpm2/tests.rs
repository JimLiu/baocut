//! 合成小权重单测：用确定性的小权重跑一遍完整的 MLX 模型图（v2 同一份测试，原样移植）。

use std::collections::HashMap;

use super::audio_vae::AudioVae;
use super::config::{AudioVaeConfig, VoxCpm2Config};
use super::engine::VoxCpm2;
use super::minicpm::{Dims, Fsq, LocDit, LocEnc, LongRope, MiniCpm, solve_euler, time_span};
use super::tokenizer::Tokenizer;
use crate::synthesize::qwen3_tts::weights::Weights;
use crate::synthesize::tensor::Array;
use crate::synthesize::tensor::ops::indexing::IndexOp;

/// MLX 单测互斥并先确认 Metal：同一进程里并发提交 MLX 图会互相干扰（与 `backend::mlx` 的单测同一把锁）。
pub(crate) fn mlx_lock() -> std::sync::MutexGuard<'static, ()> {
    let guard = crate::synthesize::tensor::host::TEST_LOCK
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    crate::synthesize::tensor::host::ensure_device().expect("Metal 设备");
    guard
}

/// 确定性的小权重：LCG 出 `[-scale, scale)` 均匀值。
pub(crate) struct Filler {
    state: u64,
    pub tensors: HashMap<String, Array>,
}

impl Filler {
    pub fn new(seed: u64) -> Self {
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

    pub fn rand(&mut self, key: &str, shape: &[i32], scale: f32) {
        let n = shape.iter().product::<i32>() as usize;
        let v = self.values(n, scale);
        self.tensors.insert(key.to_string(), Array::from_slice(&v, shape));
    }

    pub fn fill(&mut self, key: &str, shape: &[i32], value: f32) {
        let n = shape.iter().product::<i32>() as usize;
        self.tensors.insert(key.to_string(), Array::from_slice(&vec![value; n], shape));
    }

    pub fn linear(&mut self, prefix: &str, out: i32, input: i32, bias: bool) {
        let scale = 1.0 / (input as f32).sqrt();
        self.rand(&format!("{prefix}.weight"), &[out, input], scale);
        if bias {
            self.rand(&format!("{prefix}.bias"), &[out], 0.1);
        }
    }

    pub fn minicpm(&mut self, prefix: &str, dims: &Dims, ffn: i32, embed: Option<i32>) {
        let h = dims.hidden as i32;
        let q = (dims.heads * dims.head_dim) as i32;
        let kv = (dims.kv_heads * dims.head_dim) as i32;
        if let Some(vocab) = embed {
            self.rand(&format!("{prefix}.embed_tokens.weight"), &[vocab, h], 1.0);
        }
        for i in 0..dims.layers {
            let p = format!("{prefix}.layers.{i}");
            self.linear(&format!("{p}.self_attn.q_proj"), q, h, false);
            self.linear(&format!("{p}.self_attn.k_proj"), kv, h, false);
            self.linear(&format!("{p}.self_attn.v_proj"), kv, h, false);
            self.linear(&format!("{p}.self_attn.o_proj"), h, q, false);
            self.linear(&format!("{p}.mlp.gate_proj"), ffn, h, false);
            self.linear(&format!("{p}.mlp.up_proj"), ffn, h, false);
            self.linear(&format!("{p}.mlp.down_proj"), h, ffn, false);
            self.fill(&format!("{p}.input_layernorm.weight"), &[h], 1.0);
            self.fill(&format!("{p}.post_attention_layernorm.weight"), &[h], 1.0);
        }
        self.fill(&format!("{prefix}.norm.weight"), &[h], 1.0);
    }

    fn residual(&mut self, prefix: &str, dim: i32) {
        for r in ["res1", "res2", "res3"] {
            let p = format!("{prefix}.{r}");
            self.fill(&format!("{p}.snake1.alpha"), &[1, 1, dim], 1.0);
            self.fill(&format!("{p}.snake2.alpha"), &[1, 1, dim], 1.0);
            self.rand(&format!("{p}.conv1.weight"), &[dim, 7, 1], 0.3);
            self.rand(&format!("{p}.conv1.bias"), &[dim], 0.05);
            self.rand(&format!("{p}.conv2.weight"), &[dim, 1, dim], 0.3);
            self.rand(&format!("{p}.conv2.bias"), &[dim], 0.05);
        }
    }

    /// `audio_vae.` 之下的全部键（深度可分离）。
    pub fn audio_vae(&mut self, c: &AudioVaeConfig) {
        let mut dim = c.encoder_dim as i32;
        self.rand("audio_vae.encoder.conv_in.weight", &[dim, 7, 1], 0.5);
        self.rand("audio_vae.encoder.conv_in.bias", &[dim], 0.05);
        for (i, &s) in c.encoder_rates.iter().enumerate() {
            let p = format!("audio_vae.encoder.blocks.layers.{i}");
            self.residual(&p, dim);
            self.fill(&format!("{p}.snake.alpha"), &[1, 1, dim], 1.0);
            self.rand(&format!("{p}.conv.weight"), &[dim * 2, 2 * s as i32, dim], 0.3);
            self.rand(&format!("{p}.conv.bias"), &[dim * 2], 0.05);
            dim *= 2;
        }
        let latent = c.latent_dim as i32;
        self.rand("audio_vae.encoder.fc_mu.weight", &[latent, 3, dim], 0.3);
        self.rand("audio_vae.encoder.fc_mu.bias", &[latent], 0.05);
        let channels = c.decoder_dim as i32;
        self.rand("audio_vae.decoder.conv_in.layers.0.weight", &[latent, 7, 1], 0.3);
        self.rand("audio_vae.decoder.conv_in.layers.0.bias", &[latent], 0.05);
        self.rand("audio_vae.decoder.conv_in.layers.1.weight", &[channels, 1, latent], 0.3);
        self.rand("audio_vae.decoder.conv_in.layers.1.bias", &[channels], 0.05);
        let buckets = c.sr_bin_boundaries.len() as i32 + 1;
        for (i, &s) in c.decoder_rates.iter().enumerate() {
            let input = channels >> i;
            let output = channels >> (i + 1);
            let p = format!("audio_vae.decoder.blocks.layers.{i}");
            let sr = format!("audio_vae.decoder.sr_cond_layers.{i}");
            self.rand(&format!("{sr}.scale_embed.weight"), &[buckets, input], 1.0);
            self.rand(&format!("{sr}.bias_embed.weight"), &[buckets, input], 0.1);
            self.fill(&format!("{p}.snake.alpha"), &[1, 1, input], 1.0);
            self.rand(&format!("{p}.conv_t.weight"), &[output, 2 * s as i32, input], 0.3);
            self.rand(&format!("{p}.conv_t.bias"), &[output], 0.05);
            self.residual(&p, output);
        }
        let last = channels >> c.decoder_rates.len();
        self.fill("audio_vae.decoder.snake_out.alpha", &[1, 1, last], 1.0);
        self.rand("audio_vae.decoder.conv_out.weight", &[1, 7, last], 0.3);
        self.rand("audio_vae.decoder.conv_out.bias", &[1], 0.0);
        self.tensors.insert(
            "audio_vae.decoder._sr_boundaries".into(),
            Array::from_slice(&[20000i32, 30000, 40000], &[3]),
        );
    }

    pub fn into_weights(self) -> Weights {
        Weights::from_tensors(self.tensors)
    }
}

fn local_dims() -> Dims {
    Dims {
        hidden: 8,
        heads: 2,
        kv_heads: 1,
        head_dim: 4,
        layers: 2,
        eps: 1e-5,
        residual_scale: 1.0,
    }
}

fn rope() -> LongRope {
    LongRope::new(4, 10000.0, 32, None)
}

fn host(x: &Array) -> Vec<f32> {
    x.as_dtype(crate::synthesize::tensor::Dtype::Float32)
        .unwrap()
        .as_slice::<f32>()
        .to_vec()
}

fn assert_close(a: &[f32], b: &[f32], tol: f32) {
    assert_eq!(a.len(), b.len());
    for (i, (x, y)) in a.iter().zip(b).enumerate() {
        assert!((x - y).abs() <= tol, "#{i}: {x} vs {y}");
    }
}

#[test]
fn long_rope_tables_start_at_identity_and_divide_by_factors() {
    let _mlx = mlx_lock();
    let scaling = super::config::RopeScaling {
        short_factor: vec![1.0, 2.0],
        long_factor: vec![4.0, 4.0],
        original_max_position_embeddings: 32,
    };
    let rope = LongRope::new(4, 10000.0, 32, Some(&scaling));
    let (cos, sin) = rope.tables(0, 2);
    assert_eq!(cos.shape(), vec![1, 2, 1, 4]);
    let (cos, sin) = (host(&cos), host(&sin));
    assert_close(&cos[..4], &[1.0; 4], 1e-6);
    assert_close(&sin[..4], &[0.0; 4], 1e-6);
    // 位置 1：freq_0 = 1/1，freq_1 = 10000^(-1/2)/2 = 0.005（short_factor，因为未超出原长）。
    let expect = [1f32.sin(), 0.005f32.sin(), 1f32.sin(), 0.005f32.sin()];
    assert_close(&sin[4..], &expect, 1e-6);
}

#[test]
fn incremental_decode_with_cache_matches_full_causal_prefill() {
    let _mlx = mlx_lock();
    let dims = local_dims();
    let mut f = Filler::new(1);
    f.minicpm("lm", &dims, 16, None);
    let mut w = f.into_weights();
    let model = MiniCpm::load(&mut w, "lm", &dims, Some(rope()), (64, 0)).unwrap();
    assert!(w.keys().is_empty());
    let mut g = Filler::new(9);
    g.rand("x", &[1, 5, 8], 1.0);
    let x = g.tensors.remove("x").unwrap();
    let (full, _) = model.forward(&x, None, true).unwrap();
    let (_, cache) = model.forward(&x.index((.., ..4, ..)), None, true).unwrap();
    assert_eq!(cache[0].len(), 4);
    let (step, cache) = model.forward(&x.index((.., 4..5, ..)), Some(&cache), true).unwrap();
    assert_eq!(cache[1].len(), 5);
    assert_close(&host(&full.index((.., 4..5, ..))), &host(&step), 1e-4);
    // 因果：前 4 个位置的输出不受第 5 个输入影响。
    let (prefix, _) = model.forward(&x.index((.., ..4, ..)), None, true).unwrap();
    assert_close(&host(&full.index((.., ..4, ..))), &host(&prefix), 1e-4);
}

#[test]
fn local_encoder_takes_the_cls_row_per_patch_independently() {
    let _mlx = mlx_lock();
    let dims = local_dims();
    let mut f = Filler::new(2);
    f.linear("feat_encoder.in_proj", 8, 3, true);
    f.rand("feat_encoder.special_token", &[1, 1, 1, 8], 1.0);
    f.minicpm("feat_encoder.encoder", &dims, 16, None);
    let mut w = f.into_weights();
    let enc = LocEnc::load(&mut w, &dims, rope(), (64, 0)).unwrap();
    assert!(w.keys().is_empty());
    let mut g = Filler::new(3);
    g.rand("x", &[1, 3, 2, 3], 1.0);
    let x = g.tensors.remove("x").unwrap();
    let out = enc.forward(&x).unwrap();
    assert_eq!(out.shape(), vec![1, 3, 8]);
    let alone = enc.forward(&x.index((.., 1..2, .., ..))).unwrap();
    assert_close(&host(&out.index((.., 1..2, ..))), &host(&alone), 1e-5);
}

fn dit(out_scale: f32) -> LocDit {
    let dims = local_dims();
    let mut f = Filler::new(4);
    let p = "feat_decoder.estimator";
    f.linear(&format!("{p}.in_proj"), 8, 3, true);
    f.linear(&format!("{p}.cond_proj"), 8, 3, true);
    f.rand(&format!("{p}.out_proj.weight"), &[3, 8], out_scale);
    f.fill(&format!("{p}.out_proj.bias"), &[3], 0.0);
    for m in ["time_mlp", "delta_time_mlp"] {
        f.linear(&format!("{p}.{m}.linear_1"), 8, 8, true);
        f.linear(&format!("{p}.{m}.linear_2"), 8, 8, true);
    }
    f.minicpm(&format!("{p}.decoder"), &dims, 16, None);
    let mut w = f.into_weights();
    let dit = LocDit::load(&mut w, &dims, rope(), (64, 0)).unwrap();
    assert!(w.keys().is_empty());
    dit
}

#[test]
fn time_span_matches_sway_sampling_formula() {
    let _mlx = mlx_lock();
    let span = time_span(2);
    let mid = 0.5 + ((std::f64::consts::FRAC_PI_4).cos() - 1.0 + 0.5);
    assert_close(&span, &[1.0, mid as f32, 0.0], 1e-6);
}

#[test]
fn euler_zero_star_skips_first_step_and_is_deterministic() {
    let _mlx = mlx_lock();
    let mut g = Filler::new(5);
    g.rand("noise", &[1, 3, 2], 1.0);
    g.rand("mu", &[1, 16], 1.0);
    g.rand("cond", &[1, 3, 2], 1.0);
    let noise = g.tensors.remove("noise").unwrap();
    let mu = g.tensors.remove("mu").unwrap();
    let cond = g.tensors.remove("cond").unwrap();
    let estimator = dit(0.5);
    // 一步时唯一一步落在 zero-init 里：输出就是噪声。
    let one = solve_euler(&estimator, noise.clone(), &mu, &cond, 1, 2.0).unwrap();
    assert_close(&host(&one), &host(&noise), 0.0);
    let a = solve_euler(&estimator, noise.clone(), &mu, &cond, 4, 2.0).unwrap();
    let b = solve_euler(&estimator, noise.clone(), &mu, &cond, 4, 2.0).unwrap();
    assert_eq!(a.shape(), vec![1, 3, 2]);
    assert_close(&host(&a), &host(&b), 0.0);
    assert!(host(&a).iter().zip(host(&noise)).any(|(x, y)| (x - y).abs() > 1e-4));
    // 速度场为零（out_proj 全零）时 x 一路不动。
    let still = solve_euler(&dit(0.0), noise.clone(), &mu, &cond, 4, 2.0).unwrap();
    assert_close(&host(&still), &host(&noise), 1e-6);
}

#[test]
fn fsq_rounds_tanh_levels_to_ninths() {
    let _mlx = mlx_lock();
    let mut f = Filler::new(6);
    let eye = [1.0f32, 0.0, 0.0, 1.0];
    f.tensors
        .insert("fsq_layer.in_proj.weight".into(), Array::from_slice(&eye, &[2, 2]));
    f.tensors
        .insert("fsq_layer.out_proj.weight".into(), Array::from_slice(&eye, &[2, 2]));
    let mut w = f.into_weights();
    let fsq = Fsq::load(&mut w, 9, (64, 0)).unwrap();
    // tanh(0.3)·9 = 2.62 → 3；tanh(-10)·9 ≈ −9 → −9。
    let x = Array::from_slice(&[0.3f32, -10.0], &[1, 2]);
    assert_close(&host(&fsq.forward(&x).unwrap()), &[3.0 / 9.0, -1.0], 1e-6);
}

pub(crate) fn tiny_vae_config() -> AudioVaeConfig {
    serde_json::from_value(serde_json::json!({
        "encoder_dim": 2,
        "encoder_rates": [2, 3],
        "latent_dim": 3,
        "decoder_dim": 8,
        "decoder_rates": [3, 2, 2],
        "sr_bin_boundaries": [20000, 30000, 40000],
        "sample_rate": 16000,
        "out_sample_rate": 48000
    }))
    .unwrap()
}

#[test]
fn audio_vae_is_causal_with_expected_hop_lengths() {
    let _mlx = mlx_lock();
    let config = tiny_vae_config();
    let mut f = Filler::new(7);
    f.audio_vae(&config);
    let mut all = f.into_weights();
    let mut w = all.split_prefix("audio_vae.");
    let vae = AudioVae::load(&mut w, &config).unwrap();
    let _ = w.take_optional("decoder._sr_boundaries");
    assert!(w.keys().is_empty(), "{:?}", w.keys());
    assert_eq!((vae.hop, vae.decode_hop), (6, 12));

    let mut g = Filler::new(8);
    g.rand("wave", &[1, 24, 1], 0.5);
    let wave = g.tensors.remove("wave").unwrap();
    let z = vae.encode(&wave).unwrap();
    assert_eq!(z.shape(), vec![1, 4, 3]);
    // 改最后 6 个样本只影响最后一帧 latent（左补零的因果卷积）。
    let mut tail = host(&wave);
    tail[20] += 1.0;
    let z2 = vae.encode(&Array::from_slice(&tail, &[1, 24, 1])).unwrap();
    assert_close(&host(&z.index((.., ..3, ..))), &host(&z2.index((.., ..3, ..))), 1e-6);

    let audio = vae.decode(&z).unwrap();
    assert_eq!(audio.shape(), vec![1, 48]);
    assert!(host(&audio).iter().all(|s| s.is_finite() && s.abs() <= 1.0));
    let head = vae.decode(&z.index((.., ..2, ..))).unwrap();
    assert_close(&host(&audio)[..24], &host(&head), 1e-5);
}

/// 整机小模型：隐藏 8、局部 8、patch 2、latent 3、VAE 6→12 样本/帧；词表 128（够放 101–104）。
pub(crate) fn tiny_model() -> VoxCpm2 {
    let config: VoxCpm2Config = serde_json::from_value(serde_json::json!({
        "lm_config": {
            "hidden_size": 8, "intermediate_size": 16, "max_position_embeddings": 64,
            "num_attention_heads": 2, "num_hidden_layers": 2, "num_key_value_heads": 1,
            "rms_norm_eps": 1e-5, "rope_theta": 10000.0, "kv_channels": 4, "vocab_size": 128,
            "use_mup": false, "scale_emb": 12, "scale_depth": 1.4,
            "rope_scaling": { "type": "longrope", "short_factor": [1.0, 1.5],
                "long_factor": [2.0, 2.0], "original_max_position_embeddings": 64 }
        },
        "patch_size": 2, "feat_dim": 3,
        "scalar_quantization_latent_dim": 4, "scalar_quantization_scale": 9,
        "residual_lm_num_layers": 1, "residual_lm_no_rope": true,
        "encoder_config": { "hidden_dim": 8, "ffn_dim": 16, "num_heads": 2, "num_layers": 1, "kv_channels": 4 },
        "dit_config": { "hidden_dim": 8, "ffn_dim": 16, "num_heads": 2, "num_layers": 1, "kv_channels": 4,
            "mean_mode": false, "cfm_config": { "inference_cfg_rate": 2.0 } },
        "audio_vae_config": tiny_vae_config_json()
    }))
    .unwrap();
    let base = Dims {
        hidden: 8,
        heads: 2,
        kv_heads: 1,
        head_dim: 4,
        layers: 2,
        eps: 1e-5,
        residual_scale: 1.0,
    };
    let local = Dims { layers: 1, ..base };
    let mut f = Filler::new(11);
    f.minicpm("base_lm", &base, 16, Some(128));
    f.minicpm("residual_lm", &Dims { layers: 1, ..base }, 16, None);
    f.linear("feat_encoder.in_proj", 8, 3, true);
    f.rand("feat_encoder.special_token", &[1, 1, 1, 8], 1.0);
    f.minicpm("feat_encoder.encoder", &local, 16, None);
    let p = "feat_decoder.estimator";
    f.linear(&format!("{p}.in_proj"), 8, 3, true);
    f.linear(&format!("{p}.cond_proj"), 8, 3, true);
    f.linear(&format!("{p}.out_proj"), 3, 8, true);
    for m in ["time_mlp", "delta_time_mlp"] {
        f.linear(&format!("{p}.{m}.linear_1"), 8, 8, true);
        f.linear(&format!("{p}.{m}.linear_2"), 8, 8, true);
    }
    f.minicpm(&format!("{p}.decoder"), &local, 16, None);
    f.linear("fsq_layer.in_proj", 4, 8, true);
    f.linear("fsq_layer.out_proj", 8, 4, true);
    f.linear("enc_to_lm_proj", 8, 8, true);
    f.linear("lm_to_dit_proj", 8, 8, true);
    f.linear("res_to_dit_proj", 8, 8, true);
    f.linear("fusion_concat_proj", 8, 16, true);
    f.linear("stop_proj", 8, 8, true);
    f.linear("stop_head", 2, 8, false);
    f.audio_vae(&config.audio_vae_config);
    let mut weights = f.into_weights();

    let chars = ["<unk>", "\u{2581}", "a", "b", "c"];
    let mut vocab: HashMap<String, u32> = chars.iter().enumerate().map(|(i, t)| (t.to_string(), i as u32)).collect();
    vocab.insert("\u{2581}a".into(), 5);
    let tokenizer = Tokenizer::from_parts(vocab, vec![("\u{2581}".into(), "a".into())], Some(0)).unwrap();
    let model = VoxCpm2::from_weights(config, tokenizer, &mut weights, &mut |_| Ok(())).unwrap();
    assert!(weights.keys().is_empty(), "{:?}", weights.keys());
    model
}

/// 48 kHz 输出版的 [`tiny_vae_config`]（整机要求输出 48 kHz）。
fn tiny_vae_config_json() -> serde_json::Value {
    serde_json::json!({
        "encoder_dim": 2,
        "encoder_rates": [2, 3],
        "latent_dim": 3,
        "decoder_dim": 8,
        "decoder_rates": [3, 2, 2],
        "sr_bin_boundaries": [20000, 30000, 40000],
        "sample_rate": 16000,
        "out_sample_rate": 48000
    })
}
