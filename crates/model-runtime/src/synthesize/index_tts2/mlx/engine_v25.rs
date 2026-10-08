//! `IndexTts25` 引擎：IndexTTS 2.5（`mlx-community/IndexTTS-2.5-fp16`）接到 `TtsEngine`。
//!
//! 对照官方 `IndexTTS2.infer_v2_5`，与 2.0 的差异：
//! - 文本：60 509 项 tiktoken 多语言词表（zh / en / ja / es / ar），每段带 `<|lang|> `
//!   前缀，语言 id 另经 `lang_embedding` 加到文本位置（[`crate::synthesize::index_tts2::v25::frontend`]）。
//! - GPT 条件：`[spk_emb_proj(CAM++ 风格) + 情感向量, 0, 0]`，没有音色 conformer /
//!   perceiver 与 speed 嵌入，也不再把 GPT latent 叠进 S2Mel 内容特征。
//! - 语义码经 `codec.decode`（码本 → Vocos 骨干 → ×2 上采样）得到 50 Hz 内容特征，
//!   长度规整到 `floor(2N × 1.72 / 语速)` 帧（`--speed`，缺省 1）；提示条件直接由参考音频的 w2v-BERT 隐状态规整，
//!   不经 MaskGCT 量化。
//!
//! w2v-BERT / CAM++ / BigVGAN / 统计量与情感特征表和 2.0 逐字节相同，不在 2.5 的仓库里：模型包另带一个
//! `aux` 组件（整个 `aufklarer/IndexTTS2-MLX-fp16` 仓库，与 IndexTTS2 模型包共用一份），从它的清单里取
//! `aux/` 下的权重与三个统计量文件。

use super::conditioning::ReferenceConditioning;
use super::engine_impl::{
    S2MEL_STEPS, SharedAux, SharedAuxFiles, clone_reference, emotion_plan, generation_options, resolve_emotion, run_segments,
    speaking_rate, target_frames,
};
use super::gpt::{ABORT_MESSAGE, SemanticGpt};
use super::s2mel::S2Mel;
use super::semantic_codec::CodecDecoderV25;
use super::v25_weights;
use super::weights::WeightMap;
use crate::bundle::VerifiedFiles;
use crate::synthesize::index_tts2::config::RuntimeConfig;
use crate::synthesize::index_tts2::sampling::GenerationOptions;
use crate::synthesize::index_tts2::v25::frontend::{self, DEFAULT_MAX_SEGMENT_TOKENS};
use crate::synthesize::index_tts2::v25::tiktoken::TiktokenTokenizer;
use crate::synthesize::tensor::host::ModelMemoryCacheGuard;
use crate::synthesize::tensor::host::{clear_memory_cache, configure_memory_cache};
use crate::synthesize::tensor::{Array, Dtype};
use crate::synthesize::types::{TtsAudio, TtsEngineKind, TtsProgress, TtsRequest};
use crate::synthesize::{ProgressSink, TtsEngine};
use anyhow::{Context, Result, bail, ensure};

const ENGINE_NAME: &str = "IndexTTS 2.5";

pub struct IndexTts25 {
    config: RuntimeConfig,
    tokenizer: TiktokenTokenizer,
    gpt: SemanticGpt,
    s2mel: S2Mel,
    codec: CodecDecoderV25,
    aux: SharedAux,
    /// 最后一个字段：权重先析构，再等 GPU 并清缓存。
    _cache_guard: ModelMemoryCacheGuard,
}

impl IndexTts25 {
    /// GPT → S2Mel → 语义码本解码器 → w2v-BERT → CAM++ → BigVGAN → 统计量 / 情感特征表。
    ///
    /// `model` 是 2.5 的主模型组件，必须带 `config.yaml`（没有它认不出 tiktoken 分词器）；`aux` 是辅助权重组件
    /// （IndexTTS2 仓库）。缺文件是 `MODEL_NOT_INSTALLED`，在碰 Metal 之前就报。
    pub fn load(model: &VerifiedFiles, aux: &VerifiedFiles) -> Result<Self> {
        Self::load_with_progress(model, aux, &mut |_| true)
    }

    pub fn load_with_progress(model: &VerifiedFiles, aux: &VerifiedFiles, progress: &mut dyn FnMut(TtsProgress) -> bool) -> Result<Self> {
        let config = RuntimeConfig::load(Some(model.require("config.yaml")?))?;
        ensure!(
            config.is_v25(),
            "不是 IndexTTS 2.5 权重（config.yaml 没有 tiktoken 分词器），请用 index-tts2 引擎加载"
        );
        let vocabulary = model.require(&config.bpe_model)?;
        let gpt_file = model.require("gpt.safetensors")?;
        let s2mel_file = model.require("s2mel.safetensors")?;
        let codec_file = model.require("codec.safetensors")?;
        let aux_files = SharedAuxFiles::resolve(aux)?;

        configure_memory_cache()?;
        // 先建守卫：后面任何一步加载失败，展开时也会等 GPU 并清掉已分配的缓存。
        let cache_guard = ModelMemoryCacheGuard;
        let tokenizer = TiktokenTokenizer::load(vocabulary).with_context(|| format!("加载 {ENGINE_NAME} 分词器 {}", config.bpe_model))?;

        let mut stage = |name: &str| -> Result<()> {
            if !progress(TtsProgress::Loading { stage: name.to_string() }) {
                bail!(ABORT_MESSAGE);
            }
            Ok(())
        };

        stage("gpt")?;
        let gpt = SemanticGpt::load_v25(WeightMap::load_file(gpt_file)?, &config.gpt, config.semantic_codec.codebook_size)
            .with_context(|| format!("加载 {ENGINE_NAME} GPT"))?;

        stage("s2mel")?;
        let mut s2mel_weights = WeightMap::load_file(s2mel_file)?;
        v25_weights::remap_s2mel(&mut s2mel_weights)?;
        let s2mel = S2Mel::load(s2mel_weights, config.s2mel.n_mels as i32).with_context(|| format!("加载 {ENGINE_NAME} S2Mel"))?;

        stage("codec")?;
        let codec =
            CodecDecoderV25::load(WeightMap::load_file(codec_file)?).with_context(|| format!("加载 {ENGINE_NAME} 语义码本解码器"))?;

        let aux = SharedAux::load(aux_files, &config, &mut stage)?;
        clear_memory_cache()?;

        Ok(Self {
            config,
            tokenizer,
            gpt,
            s2mel,
            codec,
            aux,
            _cache_guard: cache_guard,
        })
    }

    /// 每段：GPT 生成语义码 → 码本解码成 50 Hz 内容特征 → 长度规整 → 流匹配梅尔 → BigVGAN。
    fn synthesize_segment(
        &self,
        text_tokens: &[i32],
        language_id: usize,
        conditioning: &ReferenceConditioning,
        emotion: &Array,
        options: &GenerationOptions,
        rate: f32,
        token_progress: &mut dyn FnMut(usize) -> bool,
    ) -> Result<Vec<f32>> {
        let codes =
            self.gpt
                .generate_semantic_codes_v25(text_tokens, language_id, &conditioning.style, emotion, options, token_progress)?;
        if codes.is_empty() {
            bail!("{ENGINE_NAME} 语义 GPT 没有生成任何语音 token");
        }
        let content = self.codec.decode(&codes)?.as_dtype(Dtype::Float32)?; // [1, 2N, 1024]
        let generated_condition = self
            .s2mel
            .length_regulator
            .forward(&content, target_frames(content.dim(1) as usize, rate))?; // [1, target, 512]
        self.aux.render(&self.s2mel, &generated_condition, conditioning, S2MEL_STEPS)
    }
}

impl TtsEngine for IndexTts25 {
    fn kind(&self) -> TtsEngineKind {
        TtsEngineKind::IndexTts25
    }

    fn sample_rate(&self) -> u32 {
        self.config.output_sample_rate()
    }

    /// 模型自己没有说话人表；露出来的是随包的内置音色（`VoiceSpec::Preset` 的取值）。
    fn preset_speakers(&self) -> Vec<String> {
        crate::synthesize::voices::ids()
    }

    fn synthesize(&mut self, request: &TtsRequest, progress: ProgressSink<'_>) -> Result<TtsAudio> {
        let reference_audio = clone_reference(request, ENGINE_NAME)?;
        let plan = emotion_plan(request.emotion.as_ref(), ENGINE_NAME)?;
        let options = generation_options(&request.sampling, ENGINE_NAME)?;
        let rate = speaking_rate(request.speed, ENGINE_NAME)?;
        let prepared = frontend::prepare(
            &request.text,
            request.language.as_deref(),
            &self.tokenizer,
            DEFAULT_MAX_SEGMENT_TOKENS,
        )
        .with_context(|| format!("{ENGINE_NAME} 文本前端"))?;

        let conditioning = self
            .aux
            .prepare_conditioning(&self.config, &self.s2mel, None, &reference_audio, &plan, &mut *progress)?;
        let engine = &*self;
        let emotion = resolve_emotion(&engine.gpt, &conditioning, &plan)?;

        run_segments(
            prepared.token_ids.len(),
            engine.config.output_sample_rate(),
            progress,
            |index, token_progress| {
                let text_tokens: Vec<i32> = prepared.token_ids[index].iter().map(|&id| id as i32).collect();
                engine.synthesize_segment(
                    &text_tokens,
                    prepared.language_id,
                    &conditioning,
                    &emotion,
                    &options,
                    rate,
                    token_progress,
                )
            },
        )
    }
}
