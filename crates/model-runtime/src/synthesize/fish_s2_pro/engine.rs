//! Adapted from soniqo/speech-swift Sources/FishAudioTTS (Apache-2.0).
//! Copyright 2025 Ivan Digital; Rust/MLX/Candle changes. License and scope: mod.rs.
use super::{
    SAMPLE_RATE,
    backbone::{Backbone, State},
    codec::Codec,
    config::Config,
    prompt,
    sampling::Sampling,
    vocabulary::{COMPACT_EOS, Vocabulary},
};
use crate::bundle::VerifiedFiles;
use crate::synthesize::qwen3_tts::{sampling::Rng, weights::Weights};
use crate::synthesize::tensor::Dtype;
use crate::synthesize::tensor::host::{ModelMemoryCacheGuard, configure_memory_cache, ensure_device};
use crate::synthesize::voices::reference_for;
use crate::synthesize::{ProgressSink, TtsAudio, TtsEngine, TtsEngineKind, TtsProgress, TtsRequest};
use anyhow::{Result, bail, ensure};
use tokenizers::Tokenizer;
pub struct FishS2Pro {
    tokenizer: Tokenizer,
    backbone: Option<Backbone>,
    config: Config,
    model_files: VerifiedFiles,
    codec_files: VerifiedFiles,
    _guard: ModelMemoryCacheGuard,
    _memory: super::memory::MemoryGuard,
}
impl FishS2Pro {
    pub fn load(model: &VerifiedFiles, codec_files: &VerifiedFiles) -> Result<Self> {
        let config = Config::load(model.require("config.json")?)?;
        let tokenizer = Tokenizer::from_file(model.require("tokenizer.json")?).map_err(|e| anyhow::anyhow!("Fish tokenizer: {e}"))?;
        for (token, id) in [
            ("<|im_end|>", config.eos_token_id),
            ("<|semantic:0|>", config.semantic_start_token_id),
            ("<|semantic:4095|>", config.semantic_end_token_id),
        ] {
            ensure!(
                tokenizer.token_to_id(token) == Some(id as u32),
                "Fish tokenizer/config token mismatch: {token}"
            );
        }
        ensure!(
            tokenizer.token_to_id("<|im_start|>").is_some() && tokenizer.token_to_id("<|voice|>").is_some(),
            "Fish tokenizer lacks chat tokens"
        );
        codec_files.require("codec.safetensors")?;
        ensure_device()?;
        configure_memory_cache()?;
        let memory = super::memory::MemoryGuard::new()?;
        let guard = ModelMemoryCacheGuard;
        // Validate the actual transformer during model.load. During synthesis
        // it is reloaded only for code generation, never alongside the codec.
        let backbone = Self::load_backbone(model, config.clone(), &[])?;
        drop(backbone);
        drop(ModelMemoryCacheGuard);
        Ok(Self {
            tokenizer,
            backbone: None,
            config,
            model_files: model.clone(),
            codec_files: codec_files.clone(),
            _guard: guard,
            _memory: memory,
        })
    }
    fn load_backbone(model: &VerifiedFiles, config: Config, prompt: &[i32]) -> Result<Backbone> {
        let started = std::time::Instant::now();
        let _cache = ModelMemoryCacheGuard;
        let weights = model.require_extension_in("", "safetensors")?;
        let weights: Vec<_> = weights
            .into_iter()
            .filter(|p| p.file_name().is_some_and(|n| n.to_string_lossy().starts_with("model")))
            .collect();
        ensure!(!weights.is_empty(), "Fish transformer weights missing");
        let vocabulary = Vocabulary::new(&config, prompt)?;
        let mut weights = Weights::load_filtered_rows(&weights, |_| true, None, |key| vocabulary.rows(key))?;
        let mut flat = weights.split_prefix("model.");
        let backbone = if flat.keys().is_empty() {
            Backbone::load(&mut weights, config, vocabulary)?
        } else {
            ensure!(weights.keys().is_empty(), "unexpected Fish weights outside model prefix");
            Backbone::load(&mut flat, config, vocabulary)?
        };
        if crate::backend::speech_timing_enabled() {
            eprintln!("[fish-s2-pro] transformer loaded in {:?}", started.elapsed());
        }
        Ok(backbone)
    }
    fn unload_backbone(&mut self) {
        self.backbone = None;
        // Submitted GPU commands may still own buffers after the Rust arrays
        // drop. Synchronize before clearing their cache and loading the codec.
        drop(ModelMemoryCacheGuard);
        super::memory::trace("transformer-unloaded");
    }
    fn codec(&self, encode: bool) -> Result<Codec> {
        ensure!(self.backbone.is_none(), "Fish transformer must be unloaded before the codec");
        let path = self.codec_files.require("codec.safetensors")?;
        let mut weights = Weights::load_filtered(&[path], |key| super::codec::keep_weight(key, encode), Some(Dtype::Float32))?;
        super::memory::trace(if encode { "codec-encode-weights" } else { "codec-decode-weights" });
        let codec = Codec::load(&mut weights, encode)?;
        super::memory::trace(if encode { "codec-encode-ready" } else { "codec-decode-ready" });
        Ok(codec)
    }
    fn generate(
        &self,
        mut rows: Vec<Vec<i32>>,
        sampling: &Sampling,
        rng: &mut Rng,
        index: usize,
        progress: &mut dyn FnMut(TtsProgress) -> bool,
    ) -> Result<Vec<Vec<i32>>> {
        let backbone = self
            .backbone
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Fish transformer not loaded"))?;
        let c = &backbone.config;
        ensure!(
            rows[0].len() + sampling.max_tokens <= c.text_config.max_seq_len,
            "Fish prompt exceeds context length"
        );
        let mut state = State::new(c.text_config.n_layer);
        let mut previous = Vec::new();
        let mut codes = vec![Vec::new(); super::CODEBOOKS];
        for step in 0..=sampling.max_tokens {
            if !progress(TtsProgress::Tokens { index, generated: step }) {
                bail!("synthesis cancelled");
            }
            let (logits, h) = if step == 0 {
                backbone.prefill(&rows, &mut state)?
            } else {
                backbone.slow(&rows, &mut state)?
            };
            logits.eval()?;
            let token = sampling.semantic(&logits.as_slice::<f32>(), 0..=COMPACT_EOS - 1, COMPACT_EOS, &previous, rng)?;
            if token == COMPACT_EOS {
                ensure!(!codes[0].is_empty(), "Fish generated no audio");
                return Ok(codes);
            }
            ensure!(step < sampling.max_tokens, "Fish generation reached token limit before EOS");
            previous.push(token);
            let first = token;
            let mut frame = vec![first];
            let mut fast = State::new(c.audio_decoder_config.n_layer);
            backbone.fast(&h, &mut fast)?.eval()?;
            for _ in 1..super::CODEBOOKS {
                let logits = backbone.fast(&backbone.code_embedding(*frame.last().unwrap())?, &mut fast)?;
                logits.eval()?;
                frame.push(sampling.sample(&logits.as_slice::<f32>(), 0..1024, rng)?);
            }
            rows = vec![vec![c.semantic_start_token_id + token]];
            for (i, id) in frame.into_iter().enumerate() {
                codes[i].push(id);
                rows.push(vec![id]);
            }
        }
        unreachable!()
    }
}
impl TtsEngine for FishS2Pro {
    fn kind(&self) -> TtsEngineKind {
        TtsEngineKind::FishS2Pro
    }
    fn sample_rate(&self) -> u32 {
        SAMPLE_RATE
    }
    fn synthesize(&mut self, request: &TtsRequest, progress: ProgressSink<'_>) -> Result<TtsAudio> {
        self.unload_backbone();
        ensure!(
            request.instruct.is_none()
                && request.emotion.is_none()
                && request.speed.is_none()
                && request.target_duration_seconds.is_none()
                && request.sampling.cfg.is_none()
                && request.sampling.steps.is_none(),
            "Fish supports inline instructions in text only"
        );
        let reference = reference_for(request, "Fish Audio S2 Pro")?;
        let reference_text = reference
            .text
            .as_deref()
            .filter(|t| !t.trim().is_empty())
            .ok_or_else(|| anyhow::anyhow!("Fish voice cloning requires a reference transcript"))?;
        if !progress(TtsProgress::Loading { stage: "reference".into() }) {
            bail!("synthesis cancelled");
        }
        let audio = reference.audio.samples(SAMPLE_RATE)?;
        ensure!(audio.len() <= 30 * SAMPLE_RATE as usize, "Fish reference audio exceeds 30 seconds");
        let reference_codes = {
            let _cache = ModelMemoryCacheGuard;
            let codec = self.codec(true)?;
            codec.encode(&audio)?
        };
        let chunks = crate::synthesize::text::chunk_with_breaks(&request.text, 60);
        ensure!(!chunks.is_empty(), "empty Fish text");
        let sampling = Sampling::new(&request.sampling)?;
        let mut rng = Rng::from_optional_seed(request.sampling.seed);
        let mut stitcher = crate::synthesize::stitch::Stitcher::new(SAMPLE_RATE, chunks.len());
        for (index, chunk) in chunks.iter().enumerate() {
            if !progress(TtsProgress::ChunkStarted {
                index,
                count: chunks.len(),
            }) {
                bail!("synthesis cancelled");
            }
            let rows = prompt::build(
                &chunk.text,
                reference_text,
                &reference_codes,
                self.config.semantic_start_token_id,
                |s| {
                    self.tokenizer
                        .encode(s, false)
                        .map(|e| e.get_ids().to_vec())
                        .map_err(|e| anyhow::anyhow!("Fish tokenizer: {e}"))
                },
            )?;
            if !progress(TtsProgress::Loading {
                stage: "transformer".into(),
            }) {
                bail!("synthesis cancelled");
            }
            self.backbone = Some(Self::load_backbone(&self.model_files, self.config.clone(), &rows[0])?);
            super::memory::trace("transformer-ready");
            let generated = self.generate(rows, &sampling, &mut rng, index, progress);
            // Also release the transformer on cancellation or generation failure.
            self.unload_backbone();
            let codes = generated?;
            let audio = {
                let _cache = ModelMemoryCacheGuard;
                let codec = self.codec(false)?;
                codec.decode(&codes)?
            };
            stitcher.push(&audio, chunk.after);
            if !progress(TtsProgress::ChunkFinished {
                index,
                seconds: stitcher.seconds(),
            }) {
                bail!("synthesis cancelled");
            }
        }
        Ok(TtsAudio {
            samples: stitcher.finish(),
            sample_rate: SAMPLE_RATE,
            ..Default::default()
        })
    }
}
