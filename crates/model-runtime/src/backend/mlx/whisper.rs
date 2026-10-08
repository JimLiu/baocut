//! Whisper large-v3 / large-v3 Turbo 的 MLX 实现（mlx-community 的 fp16 safetensors）。
//!
//! 网络结构与数学参照 ml-explore/mlx-examples 的 `whisper/mlx_whisper/`（MIT 许可）：编码器是两层卷积（第二层
//! stride 2）+ 正弦位置编码 + pre-LN Transformer；解码器是学习的位置嵌入 + 自注意力（KV cache）+ 交叉注意力 +
//! MLP，logits 与词嵌入共享权重。这里是用 mlx-rs 按那套结构自己写的 Rust，没有照搬代码。
//!
//! 解码口径与 Core ML 版（[`crate::backend::coreml`]）、whisper.cpp 版（[`crate::backend::ggml`]）一致，规则都在
//! [`crate::speech::whisper_decoding`]：每 30 s 一个窗独立解码；有语言提示就用它的语言 token，没有就在
//! `<|startoftranscript|>` 一步前向的 logits 里取语言 token 中最大的；前缀是「可选的 `<|startofprev|>` 加提示」
//! 接上 `<|startoftranscript|><|lang|><|transcribe|><|notimestamps|>`，一次前向预填充；之后贪心，按
//! `should_suppress` 抑制，遇 `<|endoftext|>` 或复读停，每窗「提示 + 前缀 + 生成」不超过
//! [`DECODER_TOKEN_BUDGET`]。词级时间由统一的强制对齐器补。
//!
//! 设备是 Metal，权重以 f16 常驻；mel 在 CPU 上算（[`WhisperFeaturePipeline::moss`]，标准 400 点 FFT），每窗补零到
//! 30 s，恰好 3000 帧。

use std::path::{Path, PathBuf};
use std::time::Instant;

use anyhow::{Context, Result, bail, ensure};
use mlx_rs::fast::{self, ScaledDotProductAttentionMask};
use mlx_rs::ops::indexing::{IndexOp, argmax_axis};
use mlx_rs::{Array, Dtype, ops, transforms};
use serde_json::Value;

use super::qwen3::{Dense, KvCache, LayerNorm, WeightStore, gelu_same_dtype};
use super::runtime::{MemoryCacheGuard, ModelMemoryCacheGuard, ensure_metal_device, load_safetensors_filtered, speech_timing_enabled};
use crate::speech::mel::WhisperFeaturePipeline;
use crate::speech::whisper_decoding::{
    DECODER_TOKEN_BUDGET, GenerationConfig, WINDOW_SAMPLES, WhisperTokenizer, argmax_where, prompt_tokens, should_stop_for_repeated_words,
};
use crate::speech::{Recognition, RecognitionRequest, SpeechRecognizer};

const SAMPLE_RATE: usize = 16_000;
/// 一个 30 s 窗的 mel 帧数（hop 160）：编码器的两层卷积把它减半成 1500 个位置。
const WINDOW_FRAMES: i32 = 3_000;
/// Whisper 的 LayerNorm 是 PyTorch 默认的 eps。
const LAYER_NORM_EPS: f32 = 1e-5;
/// 抑制掩码里「不能出」的 token 加的值：f16 下足够把它压到所有正常 logit 之下，又不至于溢出成 NaN。
const SUPPRESSED_LOGIT: f32 = -60_000.0;
/// mlx-community 的转换在权重里附带的对齐头表（词级时间戳用），这里不用。
const UNUSED_WEIGHT_KEYS: [&str; 1] = ["alignment_heads"];

/// `config.json`（mlx-community 的 Whisper 转换）里网络的形状。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WhisperConfig {
    pub n_mels: usize,
    pub n_audio_ctx: usize,
    pub n_audio_state: usize,
    pub n_audio_head: usize,
    pub n_audio_layer: usize,
    pub n_vocab: usize,
    pub n_text_ctx: usize,
    pub n_text_state: usize,
    pub n_text_head: usize,
    pub n_text_layer: usize,
}

impl WhisperConfig {
    /// 读 `config.json`。形状不合（比如不是 30 s 窗 → 1500 个位置、头数除不尽宽度）时返回说明。
    pub fn parse(raw: &Value) -> std::result::Result<Self, String> {
        let field = |name: &str| -> std::result::Result<usize, String> {
            raw.get(name)
                .and_then(Value::as_u64)
                .filter(|value| *value > 0)
                .map(|value| value as usize)
                .ok_or_else(|| format!("Whisper config.json 缺少正整数字段 {name}"))
        };
        let config = Self {
            n_mels: field("n_mels")?,
            n_audio_ctx: field("n_audio_ctx")?,
            n_audio_state: field("n_audio_state")?,
            n_audio_head: field("n_audio_head")?,
            n_audio_layer: field("n_audio_layer")?,
            n_vocab: field("n_vocab")?,
            n_text_ctx: field("n_text_ctx")?,
            n_text_state: field("n_text_state")?,
            n_text_head: field("n_text_head")?,
            n_text_layer: field("n_text_layer")?,
        };
        if config.n_audio_ctx * 2 != WINDOW_FRAMES as usize {
            return Err(format!("Whisper n_audio_ctx 应为 1500（30 s 窗），实际 {}", config.n_audio_ctx));
        }
        if !config.n_audio_state.is_multiple_of(config.n_audio_head) || !config.n_text_state.is_multiple_of(config.n_text_head) {
            return Err("Whisper 的注意力头数除不尽隐藏宽度".into());
        }
        if config.n_text_ctx < DECODER_TOKEN_BUDGET {
            return Err(format!(
                "Whisper n_text_ctx {} 小于解码预算 {DECODER_TOKEN_BUDGET}",
                config.n_text_ctx
            ));
        }
        Ok(config)
    }
}

/// 一个 MLX Whisper 模型包要的文件：`asr` 组件的 `config.json` 与 safetensors，`tokenizer` 组件（取自
/// `openai/whisper-large-v3`）的 `tokenizer.json` 与 `generation_config.json`。
#[derive(Debug, Clone)]
pub struct WhisperFiles {
    pub config: PathBuf,
    pub weights: Vec<PathBuf>,
    pub tokenizer: PathBuf,
    pub generation_config: PathBuf,
}

/// 多头注意力的四个投影（`key` 没有偏置）。
struct Attention {
    query: Dense,
    key: Dense,
    value: Dense,
    out: Dense,
    heads: i32,
}

impl Attention {
    fn load(store: &mut WeightStore, prefix: &str, heads: usize) -> Result<Self> {
        Ok(Self {
            query: Dense::load(store, &format!("{prefix}.query"))?,
            key: Dense::load(store, &format!("{prefix}.key"))?,
            value: Dense::load(store, &format!("{prefix}.value"))?,
            out: Dense::load(store, &format!("{prefix}.out"))?,
            heads: heads as i32,
        })
    }

    /// `[1, T, D]` → `[1, heads, T, D / heads]`。
    fn split_heads(&self, input: &Array) -> Result<Array> {
        let (batch, sequence, width) = (input.dim(0), input.dim(1), input.dim(2));
        Ok(input
            .reshape(&[batch, sequence, self.heads, width / self.heads])?
            .transpose_axes(&[0, 2, 1, 3])?)
    }

    /// 由 `source` 算出 K、V（已拆好头）。
    fn keys_values(&self, source: &Array) -> Result<(Array, Array)> {
        Ok((
            self.split_heads(&self.key.forward(source)?)?,
            self.split_heads(&self.value.forward(source)?)?,
        ))
    }

    /// `input` 作查询，对给定的 K、V 做缩放点积注意力，合并头后过输出投影。
    fn attend(&self, input: &Array, keys: &Array, values: &Array, mask: Option<ScaledDotProductAttentionMask<'_>>) -> Result<Array> {
        let (batch, sequence, width) = (input.dim(0), input.dim(1), input.dim(2));
        let query = self.split_heads(&self.query.forward(input)?)?;
        let scale = ((width / self.heads) as f32).sqrt().recip();
        let attended = fast::scaled_dot_product_attention(&query, keys, values, scale, mask, None)?;
        let merged = attended.transpose_axes(&[0, 2, 1, 3])?.reshape(&[batch, sequence, width])?;
        self.out.forward(&merged)
    }
}

/// 两层 MLP（GELU）。
struct Mlp {
    up: Dense,
    down: Dense,
}

impl Mlp {
    fn load(store: &mut WeightStore, prefix: &str) -> Result<Self> {
        Ok(Self {
            up: Dense::load(store, &format!("{prefix}.mlp1"))?,
            down: Dense::load(store, &format!("{prefix}.mlp2"))?,
        })
    }

    fn forward(&self, input: &Array) -> Result<Array> {
        // `nn::gelu` 的常量是 f32，会把 f16 激活整段提升成 f32；用保持 dtype 的版本。
        self.down.forward(&gelu_same_dtype(&self.up.forward(input)?)?)
    }
}

/// 编码器的一层：pre-LN 自注意力（无掩码）+ pre-LN MLP。
struct EncoderBlock {
    attention: Attention,
    attention_norm: LayerNorm,
    mlp: Mlp,
    mlp_norm: LayerNorm,
}

impl EncoderBlock {
    fn load(store: &mut WeightStore, prefix: &str, heads: usize) -> Result<Self> {
        Ok(Self {
            attention: Attention::load(store, &format!("{prefix}.attn"), heads)?,
            attention_norm: LayerNorm::load(store, &format!("{prefix}.attn_ln"), LAYER_NORM_EPS)?,
            mlp: Mlp::load(store, prefix)?,
            mlp_norm: LayerNorm::load(store, &format!("{prefix}.mlp_ln"), LAYER_NORM_EPS)?,
        })
    }

    fn forward(&self, input: &Array) -> Result<Array> {
        let normalized = self.attention_norm.forward(input)?;
        let (keys, values) = self.attention.keys_values(&normalized)?;
        let hidden = input + &self.attention.attend(&normalized, &keys, &values, None)?;
        Ok(&hidden + &self.mlp.forward(&self.mlp_norm.forward(&hidden)?)?)
    }
}

/// 音频编码器：mel `[1, 3000, n_mels]` → `[1, 1500, n_audio_state]`。
struct AudioEncoder {
    conv1_weight: Array,
    conv1_bias: Array,
    conv2_weight: Array,
    conv2_bias: Array,
    positional: Array,
    blocks: Vec<EncoderBlock>,
    final_norm: LayerNorm,
}

impl AudioEncoder {
    fn load(store: &mut WeightStore, config: &WhisperConfig) -> Result<Self> {
        let conv1_weight = store.take("encoder.conv1.weight")?;
        ensure!(
            conv1_weight.shape() == [config.n_audio_state as i32, 3, config.n_mels as i32],
            "encoder.conv1.weight 的形状 {:?} 不是 [out, 3, n_mels] 布局",
            conv1_weight.shape()
        );
        let dtype = conv1_weight.dtype();
        let mut blocks = Vec::with_capacity(config.n_audio_layer);
        for index in 0..config.n_audio_layer {
            blocks.push(EncoderBlock::load(store, &format!("encoder.blocks.{index}"), config.n_audio_head)?);
        }
        Ok(Self {
            conv1_weight,
            conv1_bias: store.take("encoder.conv1.bias")?,
            conv2_weight: store.take("encoder.conv2.weight")?,
            conv2_bias: store.take("encoder.conv2.bias")?,
            positional: sinusoids(config.n_audio_ctx, config.n_audio_state).as_dtype(dtype)?,
            blocks,
            final_norm: LayerNorm::load(store, "encoder.ln_post", LAYER_NORM_EPS)?,
        })
    }

    fn forward(&self, mel: &Array) -> Result<Array> {
        // conv 权重是 `[out, kernel, in]`，正是 MLX conv1d 的原生布局（输入 `[N, L, C_in]`），不用转置。
        let hidden = ops::conv1d(mel, &self.conv1_weight, 1, 1, None, None)?;
        let hidden = gelu_same_dtype(&(&hidden + &self.conv1_bias))?;
        let hidden = ops::conv1d(&hidden, &self.conv2_weight, 2, 1, None, None)?;
        let mut hidden = &gelu_same_dtype(&(&hidden + &self.conv2_bias))? + &self.positional;
        for block in &self.blocks {
            hidden = block.forward(&hidden)?;
        }
        self.final_norm.forward(&hidden)
    }
}

/// Whisper 编码器的正弦位置编码：前半是 sin、后半是 cos，时间尺度从 1 到 10000 按几何级数分布。
fn sinusoids(length: usize, channels: usize) -> Array {
    let half = channels / 2;
    let increment = 10_000_f32.ln() / (half as f32 - 1.0);
    let mut values = vec![0.0_f32; length * channels];
    for position in 0..length {
        let row = &mut values[position * channels..(position + 1) * channels];
        for index in 0..half {
            let angle = position as f32 * (-increment * index as f32).exp();
            row[index] = angle.sin();
            row[half + index] = angle.cos();
        }
    }
    Array::from_slice(&values, &[length as i32, channels as i32])
}

/// 解码器的一层：pre-LN 自注意力（带 KV cache）+ pre-LN 交叉注意力 + pre-LN MLP。
struct DecoderBlock {
    attention: Attention,
    attention_norm: LayerNorm,
    cross_attention: Attention,
    cross_attention_norm: LayerNorm,
    mlp: Mlp,
    mlp_norm: LayerNorm,
}

impl DecoderBlock {
    fn load(store: &mut WeightStore, prefix: &str, heads: usize) -> Result<Self> {
        Ok(Self {
            attention: Attention::load(store, &format!("{prefix}.attn"), heads)?,
            attention_norm: LayerNorm::load(store, &format!("{prefix}.attn_ln"), LAYER_NORM_EPS)?,
            cross_attention: Attention::load(store, &format!("{prefix}.cross_attn"), heads)?,
            cross_attention_norm: LayerNorm::load(store, &format!("{prefix}.cross_attn_ln"), LAYER_NORM_EPS)?,
            mlp: Mlp::load(store, prefix)?,
            mlp_norm: LayerNorm::load(store, &format!("{prefix}.mlp_ln"), LAYER_NORM_EPS)?,
        })
    }

    fn forward(&self, input: &Array, cache: &mut KvCache, cross: &(Array, Array)) -> Result<Array> {
        let normalized = self.attention_norm.forward(input)?;
        let (keys, values) = self.attention.keys_values(&normalized)?;
        let (keys, values) = cache.update(keys, values)?;
        // 多 token 预填充要因果掩码（MLX 把查询对齐到 key 的末尾，带 cache 偏移也对）；单步解码不要。
        let mask = (input.dim(1) > 1).then_some(ScaledDotProductAttentionMask::Causal);
        let hidden = input + &self.attention.attend(&normalized, &keys, &values, mask)?;
        let normalized = self.cross_attention_norm.forward(&hidden)?;
        let hidden = &hidden + &self.cross_attention.attend(&normalized, &cross.0, &cross.1, None)?;
        Ok(&hidden + &self.mlp.forward(&self.mlp_norm.forward(&hidden)?)?)
    }
}

/// 文本解码器。
struct TextDecoder {
    token_embedding: Array,
    positional: Array,
    blocks: Vec<DecoderBlock>,
    final_norm: LayerNorm,
}

impl TextDecoder {
    fn load(store: &mut WeightStore, config: &WhisperConfig) -> Result<Self> {
        let token_embedding = store.take("decoder.token_embedding.weight")?;
        ensure!(
            token_embedding.shape() == [config.n_vocab as i32, config.n_text_state as i32],
            "decoder.token_embedding.weight 的形状 {:?} 与 config.json 不符",
            token_embedding.shape()
        );
        let mut blocks = Vec::with_capacity(config.n_text_layer);
        for index in 0..config.n_text_layer {
            blocks.push(DecoderBlock::load(store, &format!("decoder.blocks.{index}"), config.n_text_head)?);
        }
        Ok(Self {
            token_embedding,
            positional: store.take("decoder.positional_embedding")?,
            blocks,
            final_norm: LayerNorm::load(store, "decoder.ln", LAYER_NORM_EPS)?,
        })
    }

    fn new_cache(&self) -> Vec<KvCache> {
        self.blocks.iter().map(|_| KvCache::new()).collect()
    }

    /// 每层交叉注意力的 K、V：一个窗只算一次。
    fn cross_keys_values(&self, audio: &Array) -> Result<Vec<(Array, Array)>> {
        let pairs = self
            .blocks
            .iter()
            .map(|block| block.cross_attention.keys_values(audio))
            .collect::<Result<Vec<_>>>()?;
        transforms::eval(pairs.iter().flat_map(|(keys, values)| [keys, values]))?;
        Ok(pairs)
    }

    /// 送入 `tokens`（接在 cache 已有的位置之后），返回最后一个位置的 logits `[n_vocab]`（与词嵌入共享权重）。
    fn forward(&self, tokens: &[i32], cache: &mut [KvCache], cross: &[(Array, Array)]) -> Result<Array> {
        let offset = cache.first().map(KvCache::offset).unwrap_or(0);
        let count = tokens.len() as i32;
        let ids = Array::from_slice(tokens, &[1, count]);
        let positions = self.positional.index(offset..offset + count);
        let mut hidden = &self.token_embedding.index(&ids) + &positions;
        for ((block, layer_cache), layer_cross) in self.blocks.iter().zip(cache.iter_mut()).zip(cross) {
            hidden = block.forward(&hidden, layer_cache, layer_cross)?;
        }
        let last = self.final_norm.forward(&hidden.index((0, count - 1)))?;
        Ok(ops::matmul(&last, self.token_embedding.t())?)
    }
}

/// MLX 上的 Whisper 句级转录器。词级时间由统一的强制对齐器补齐。
pub struct WhisperMlx {
    config: WhisperConfig,
    encoder: AudioEncoder,
    decoder: TextDecoder,
    tokenizer: WhisperTokenizer,
    generation: GenerationConfig,
    features: WhisperFeaturePipeline,
    /// 第一个生成 token 的抑制掩码（加到 logits 上）：另含 begin_suppress。
    first_step_mask: Array,
    /// 之后各步的抑制掩码。
    step_mask: Array,
    // 字段按声明顺序析构：先释放权重，再清缓存。
    _memory_cache_guard: ModelMemoryCacheGuard,
}

impl WhisperMlx {
    pub fn load(files: &WhisperFiles) -> Result<Self> {
        ensure_metal_device()?;
        // 加载中途出错时也要清掉已读入的权重。
        let memory_cache_guard = ModelMemoryCacheGuard;
        let raw: Value = serde_json::from_slice(&std::fs::read(&files.config).with_context(|| format!("读取 {}", files.config.display()))?)
            .context("解析 Whisper config.json")?;
        let config = WhisperConfig::parse(&raw).map_err(anyhow::Error::msg)?;
        let tokenizer = WhisperTokenizer::load(&files.tokenizer)?;
        let generation = GenerationConfig::load(&files.generation_config)?;

        let weights = files.weights.iter().map(PathBuf::as_path).collect::<Vec<_>>();
        // 逐张量物化，不把 1.6–3 GB 的权重塞进同一个 Metal command buffer。
        let raw_weights = load_safetensors_filtered(&weights, |key| !UNUSED_WEIGHT_KEYS.contains(&key))?;
        let mut store = WeightStore::from_arrays(raw_weights)?;
        let encoder = AudioEncoder::load(&mut store, &config)?;
        let decoder = TextDecoder::load(&mut store, &config)?;
        let remaining = store.remaining();
        if !remaining.is_empty() {
            bail!("Whisper 权重里有认不出的张量：{}", remaining.join(", "));
        }
        transforms::eval([&encoder.positional])?;

        let dtype = decoder.token_embedding.dtype();
        let first_step_mask = suppression_mask(&generation, config.n_vocab, 0, dtype)?;
        let step_mask = suppression_mask(&generation, config.n_vocab, 1, dtype)?;
        Ok(Self {
            config,
            encoder,
            decoder,
            tokenizer,
            generation,
            features: WhisperFeaturePipeline::moss(config.n_mels),
            first_step_mask,
            step_mask,
            _memory_cache_guard: memory_cache_guard,
        })
    }

    /// 预热：一秒静音走一遍 mel、编码器、语言检测与一步解码，让 Metal 内核在第一段识别之前编译好。编码器的形状与
    /// 正式识别完全相同（每窗都补到 30 s）。
    pub fn warmup(&mut self) -> Result<()> {
        let _memory_cache_guard = MemoryCacheGuard::new();
        let audio = self.encode_window(&vec![0.0; SAMPLE_RATE])?;
        let cross = self.decoder.cross_keys_values(&audio)?;
        let language = self.detect_language(&cross)?;
        let mut cache = self.decoder.new_cache();
        let mut prefix = self.generation.task_tokens(language).to_vec();
        prefix.push(self.generation.no_timestamps());
        let logits = self.decoder.forward(&prefix, &mut cache, &cross)?;
        let first = self.pick(&logits, &self.first_step_mask)?;
        let logits = self.decoder.forward(&[first], &mut cache, &cross)?;
        self.pick(&logits, &self.step_mask)?;
        Ok(())
    }

    /// 整段音频 → 文本与语言码：按 30 s 切窗、各窗独立解码，空格拼接；语言取第一个窗检测到的（之后的窗沿用）。
    pub fn transcribe(&self, audio: &[f32], language_hint: Option<&str>, prompt: Option<&str>) -> Result<(String, Option<String>)> {
        if audio.is_empty() {
            return Ok((String::new(), language_hint.map(str::to_owned)));
        }
        let prompt_tokens = prompt_tokens(&self.tokenizer, &self.generation, prompt, DECODER_TOKEN_BUDGET);
        let mut texts = Vec::new();
        let mut resolved_language = None;
        for window in audio.chunks(WINDOW_SAMPLES) {
            let hint = language_hint.or(resolved_language.as_deref());
            let (text, language) = self.transcribe_window(window, hint, &prompt_tokens)?;
            if !text.is_empty() {
                texts.push(text);
            }
            if resolved_language.is_none() {
                resolved_language = language;
            }
        }
        Ok((
            texts.join(" ").trim().to_owned(),
            resolved_language.or_else(|| language_hint.map(str::to_owned)),
        ))
    }

    fn transcribe_window(&self, audio: &[f32], language_hint: Option<&str>, prompt_tokens: &[i32]) -> Result<(String, Option<String>)> {
        // 每个窗的 mel、编码器输出、KV cache 都是临时 Metal 缓冲区；窗结束时归还。
        let _memory_cache_guard = MemoryCacheGuard::new();
        let timing = speech_timing_enabled();
        let started = Instant::now();
        let audio_features = self.encode_window(audio)?;
        let cross = self.decoder.cross_keys_values(&audio_features)?;
        let encoded = started.elapsed();

        let language_token = match language_hint.and_then(|hint| self.generation.language_token(hint)) {
            Some(token) => token,
            None => self.detect_language(&cross)?,
        };
        let language = self.generation.language_code(language_token);
        let generated = self.decode_greedy(&cross, language_token, prompt_tokens)?;
        if timing {
            eprintln!(
                "[whisper-mlx] window {:.1}s: encode {:.0} ms, decode {} tokens {:.0} ms",
                audio.len() as f64 / SAMPLE_RATE as f64,
                encoded.as_secs_f64() * 1000.0,
                generated.len(),
                (started.elapsed() - encoded).as_secs_f64() * 1000.0,
            );
        }
        Ok((self.tokenizer.decode(&generated).trim().to_owned(), language))
    }

    /// 一个窗（≤ 30 s）→ 编码器输出 `[1, 1500, n_audio_state]`（已求值）。不足 30 s 的补零到 30 s 再提特征。
    fn encode_window(&self, audio: &[f32]) -> Result<Array> {
        let mut padded = vec![0.0_f32; WINDOW_SAMPLES];
        let count = audio.len().min(WINDOW_SAMPLES);
        padded[..count].copy_from_slice(&audio[..count]);
        let mel = self.features.extract(&padded)?;
        ensure!(
            mel.time_frames == WINDOW_FRAMES as usize,
            "30 s 窗的 mel 应有 {WINDOW_FRAMES} 帧，实际 {}",
            mel.time_frames
        );
        let dtype = self.decoder.token_embedding.dtype();
        let mel = Array::from_slice(&mel.data, &[1, WINDOW_FRAMES, self.config.n_mels as i32]).as_dtype(dtype)?;
        let output = self.encoder.forward(&mel)?;
        output.eval()?;
        Ok(output)
    }

    /// `<|startoftranscript|>` 一步前向，在语言 token 里取 logit 最大的；一个也取不到时当英语。
    fn detect_language(&self, cross: &[(Array, Array)]) -> Result<i32> {
        let mut cache = self.decoder.new_cache();
        let logits = self
            .decoder
            .forward(&[self.generation.start_of_transcript()], &mut cache, cross)?
            .as_dtype(Dtype::Float32)?;
        logits.eval()?;
        Ok(
            argmax_where(logits.as_slice::<f32>(), |token| !self.generation.is_language_token(token as i32))
                .unwrap_or(self.generation.english_token()),
        )
    }

    /// 贪心解码。前缀一次前向预填充；之后每步送上一步的 token。语义与早先 Core ML 版逐项相同：第一个生成 token 用
    /// 另一张抑制掩码，`<|endoftext|>` 停，特殊 token 不进结果，复读停；位置用满预算前一格为止。
    fn decode_greedy(&self, cross: &[(Array, Array)], language_token: i32, prompt_tokens: &[i32]) -> Result<Vec<i32>> {
        let mut prefix = prompt_tokens.to_vec();
        prefix.extend(self.generation.task_tokens(language_token));
        // `<|notimestamps|>` 是第一步解码的输入，它的位置就是第一个生成 token 的位置。
        let mut position = prefix.len();
        prefix.push(self.generation.no_timestamps());
        let last_position = DECODER_TOKEN_BUDGET.saturating_sub(1);
        let mut generated = Vec::new();
        if position >= last_position {
            return Ok(generated);
        }

        let mut cache = self.decoder.new_cache();
        let mut logits = self.decoder.forward(&prefix, &mut cache, cross)?;
        loop {
            let mask = if generated.is_empty() {
                &self.first_step_mask
            } else {
                &self.step_mask
            };
            let sampled = self.pick(&logits, mask)?;
            if sampled == self.generation.end_token() {
                break;
            }
            if sampled < self.generation.special_token_begin() {
                generated.push(sampled);
                if should_stop_for_repeated_words(&self.tokenizer, &generated) {
                    generated.pop();
                    break;
                }
            }
            position += 1;
            if position >= last_position {
                break;
            }
            logits = self.decoder.forward(&[sampled], &mut cache, cross)?;
        }
        Ok(generated)
    }

    /// logits 加上抑制掩码后在设备上取最大，只把一个 token 拉回主机。
    fn pick(&self, logits: &Array, mask: &Array) -> Result<i32> {
        let token = argmax_axis(&(logits + mask), -1, false)?;
        Ok(token.try_item::<u32>()? as i32)
    }
}

/// 第 `generated_count` 步的抑制掩码：[`GenerationConfig::should_suppress`] 说不能出的 token 加一个很大的负数。
/// 抑制只分「第一个生成 token」与「之后」两种，所以两张掩码就够。
fn suppression_mask(generation: &GenerationConfig, vocabulary: usize, generated_count: usize, dtype: Dtype) -> Result<Array> {
    let values = (0..vocabulary)
        .map(|token| {
            if generation.should_suppress(token as i32, generated_count) {
                SUPPRESSED_LOGIT
            } else {
                0.0
            }
        })
        .collect::<Vec<_>>();
    let mask = Array::from_slice(&values, &[vocabulary as i32]).as_dtype(dtype)?;
    mask.eval()?;
    Ok(mask)
}

/// 转写流水线的一段：断言的语言作语言 token，识别提示作 initial prompt。Whisper 报的是语言码（`en`、`yue`），
/// 不是 Qwen3-ASR 那样的语言名。
impl SpeechRecognizer for WhisperMlx {
    fn recognize(&mut self, audio: &[f32], request: &RecognitionRequest<'_>) -> Result<Recognition> {
        let (text, language) = self.transcribe(audio, request.language, request.context)?;
        Ok(Recognition {
            text,
            language_name: language,
            degenerate: false,
        })
    }
}

/// 从路径取文件（测试与基准用）：`dir` 下的 `config.json` 与 `*.safetensors`，分词器目录下的两只 JSON。
pub fn files_in(weights_dir: &Path, tokenizer_dir: &Path) -> Result<WhisperFiles> {
    let mut weights = std::fs::read_dir(weights_dir)
        .with_context(|| format!("读取 {}", weights_dir.display()))?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.extension().is_some_and(|extension| extension == "safetensors"))
        .collect::<Vec<_>>();
    weights.sort();
    ensure!(!weights.is_empty(), "{} 里没有 safetensors", weights_dir.display());
    Ok(WhisperFiles {
        config: weights_dir.join("config.json"),
        weights,
        tokenizer: tokenizer_dir.join("tokenizer.json"),
        generation_config: tokenizer_dir.join("generation_config.json"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::mlx::runtime::MLX_TEST_LOCK;

    #[test]
    fn config_reads_the_mlx_community_shape() {
        let turbo = serde_json::json!({
            "n_mels": 128, "n_audio_ctx": 1500, "n_audio_state": 1280, "n_audio_head": 20, "n_audio_layer": 32,
            "n_vocab": 51866, "n_text_ctx": 448, "n_text_state": 1280, "n_text_head": 20, "n_text_layer": 4,
        });
        let config = WhisperConfig::parse(&turbo).unwrap();
        assert_eq!((config.n_text_layer, config.n_audio_layer, config.n_vocab), (4, 32, 51_866));
        let mut wrong = turbo.clone();
        wrong["n_audio_ctx"] = 750.into();
        assert!(WhisperConfig::parse(&wrong).unwrap_err().contains("n_audio_ctx"));
        let mut missing = turbo;
        missing.as_object_mut().unwrap().remove("n_text_layer");
        assert!(WhisperConfig::parse(&missing).unwrap_err().contains("n_text_layer"));
    }

    #[test]
    fn sinusoids_are_sin_then_cos() {
        let _lock = MLX_TEST_LOCK.lock().unwrap_or_else(|poison| poison.into_inner());
        if ensure_metal_device().is_err() {
            return;
        }
        let table = sinusoids(3, 8);
        table.eval().unwrap();
        let values = table.as_slice::<f32>();
        // 位置 0：sin 全 0，cos 全 1。
        assert_eq!(&values[..8], &[0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0]);
        // 位置 1、第 0 个频率（时间尺度 1）：sin(1)、cos(1)；最后一个频率的时间尺度是 10000。
        assert!((values[8] - 1_f32.sin()).abs() < 1e-6);
        assert!((values[12] - 1_f32.cos()).abs() < 1e-6);
        assert!((values[11] - (1.0e-4_f32).sin()).abs() < 1e-6);
    }

    /// 真实权重的端到端识别与计时（`--release` 跑）：`BAOCUT_WHISPER_MLX_DIR` 是 mlx-community 的 fp16 仓库目录
    /// （`config.json` + safetensors），`BAOCUT_WHISPER_TOKENIZER_DIR` 是 `openai/whisper-large-v3` 的分词器目录
    /// （`tokenizer.json` + `generation_config.json`），`BAOCUT_WHISPER_AUDIO` 是 16 kHz 单声道 WAV。
    /// `BAOCUT_WHISPER_EXPECT` 给了就核对文本开头。
    #[test]
    #[ignore = "needs BAOCUT_WHISPER_MLX_DIR, BAOCUT_WHISPER_TOKENIZER_DIR and BAOCUT_WHISPER_AUDIO"]
    fn transcribes_a_real_recording() {
        let _lock = MLX_TEST_LOCK.lock().unwrap_or_else(|poison| poison.into_inner());
        let env = |name: &str| PathBuf::from(std::env::var(name).unwrap_or_else(|_| panic!("set {name}")));
        let files = files_in(&env("BAOCUT_WHISPER_MLX_DIR"), &env("BAOCUT_WHISPER_TOKENIZER_DIR")).unwrap();
        let audio = crate::audio::decode_mono(&env("BAOCUT_WHISPER_AUDIO"), SAMPLE_RATE as u32).unwrap();
        super::super::runtime::configure_memory_cache().unwrap();

        let started = Instant::now();
        let mut model = WhisperMlx::load(&files).unwrap();
        let load = started.elapsed();
        let started = Instant::now();
        model.warmup().unwrap();
        let warmup = started.elapsed();
        let (language, prompt) = (
            std::env::var("BAOCUT_WHISPER_LANGUAGE").ok(),
            std::env::var("BAOCUT_WHISPER_PROMPT").ok(),
        );
        let request = RecognitionRequest {
            language: language.as_deref(),
            context: prompt.as_deref(),
        };
        let mut runs = Vec::new();
        for _ in 0..2 {
            let started = Instant::now();
            let recognition = model.recognize(&audio, &request).unwrap();
            runs.push((started.elapsed(), recognition));
        }
        let (first, ref recognition) = runs[0];
        let second = runs[1].0;
        let preview = recognition.text.chars().take(200).collect::<String>();
        println!(
            "whisper-mlx: audio {:.1}s, load {:.2}s, warmup {:.2}s, recognize {:.2}s / {:.2}s, language {:?}\n{preview}",
            audio.len() as f64 / SAMPLE_RATE as f64,
            load.as_secs_f64(),
            warmup.as_secs_f64(),
            first.as_secs_f64(),
            second.as_secs_f64(),
            recognition.language_name,
        );
        assert_eq!(runs[1].1.text, recognition.text, "贪心解码两次应逐字相同");
        if let Ok(expected) = std::env::var("BAOCUT_WHISPER_EXPECT") {
            assert!(recognition.text.starts_with(&expected), "{preview}");
        }
    }
}
