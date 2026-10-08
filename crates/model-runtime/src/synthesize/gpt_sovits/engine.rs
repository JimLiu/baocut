//! `GptSovits` 引擎：GPT-SoVITS v2 接到 `TtsEngine`，对照官方
//! `GPT_SoVITS/inference_webui.py::get_tts_wav`（v2，逐句串行路径）。
//!
//! - 参考音频限 3~10 秒。有参考文本时，16 kHz 波形尾部补 `zero_wav` 后经 HuBERT +
//!   `ssl_proj` + VQ 得到提示语义 token，提示文本的音素 / BERT 特征拼在每句目标文本前；
//!   没有参考文本走 ref_free，T2S 不带提示。
//! - 32 kHz 参考波形峰值超过 1 时按 `min(2, peak)` 缩放，再算线性谱给 SoVITS 取音色。
//! - 每句：T2S 生成语义 token → SoVITS 只用目标文本音素解码 → 峰值超过 1 时归一；
//!   句间插 0.3 秒静音。

use super::bert::{Bert, FEATURE_DIM};
use super::hubert::Hubert;
use super::sampling::SamplingParams;
use super::sovits::{NOISE_SCALE, Sovits};
use super::spec::{self, Spectrogram};
use super::t2s::{MAX_STEPS, T2s};
use super::weights::WeightMap;
use super::{ABORT_MESSAGE, text};
use crate::bundle::VerifiedFiles;
use crate::synthesize::qwen3_tts::sampling::Rng;
use crate::synthesize::tensor::host::{ModelMemoryCacheGuard, clear_memory_cache, configure_memory_cache, ensure_device};
use crate::synthesize::types::{TtsAudio, TtsEngineKind, TtsProgress, TtsRequest};
use crate::synthesize::voices::ReferenceAudio;
use crate::synthesize::{ProgressSink, TtsEngine};
use anyhow::{Context, Result, bail, ensure};

pub const ENGINE_NAME: &str = "GPT-SoVITS";
pub const SAMPLE_RATE: u32 = 32_000;
const SSL_SAMPLE_RATE: u32 = 16_000;
const HUBERT_FILE: &str = "chinese-hubert-base/model.safetensors";
const BERT_FILE: &str = "chinese-roberta-wwm-ext-large/model.safetensors";
const BERT_TOKENIZER_FILE: &str = "chinese-roberta-wwm-ext-large/tokenizer.json";
const T2S_FILE: &str = "gsv-v2final-pretrained/s1bert25hz-5kh-longer-epoch=12-step=369668.safetensors";
const SOVITS_FILE: &str = "gsv-v2final-pretrained/s2G2333k.safetensors";
/// 官方只接受 3~10 秒的参考音频（按 16 kHz 样本数判断）。
const MIN_REFERENCE_SAMPLES: usize = super::REFERENCE_SECONDS_WITH_TEXT[0] as usize * SSL_SAMPLE_RATE as usize;
const MAX_REFERENCE_SAMPLES: usize = super::REFERENCE_SECONDS_WITH_TEXT[1] as usize * SSL_SAMPLE_RATE as usize;
/// 官方的 `zero_wav`（32 kHz × 0.3 秒）：既插在句间，也原样接在 16 kHz 参考波形尾部。
const ZERO_WAV_SAMPLES: usize = 9_600;

pub struct GptSovits {
    hubert: Hubert,
    bert: Bert,
    t2s: T2s,
    sovits: Sovits,
    /// 最后一个字段：权重先析构，再等 GPU 并清缓存。
    _cache_guard: ModelMemoryCacheGuard,
}

/// 克隆提示：语义 token 与提示文本的音素 / BERT 特征；ref_free 时三者皆空。
struct Prompt {
    semantic: Vec<u32>,
    phones: Vec<i32>,
    bert: Vec<f32>,
}

impl GptSovits {
    /// chinese-hubert → chinese-roberta → T2S → SoVITS，文件按清单取（模型包是一个组件，
    /// 五个文件都在 `PJMixers-Dev/lj1995_GPT-SoVITS-safetensors` 里）。缺文件是 `MODEL_NOT_INSTALLED`，
    /// 在碰 Metal 之前就报。
    pub fn load(model: &VerifiedFiles) -> Result<Self> {
        Self::load_with_progress(model, &mut |_| true)
    }

    pub fn load_with_progress(model: &VerifiedFiles, progress: &mut dyn FnMut(TtsProgress) -> bool) -> Result<Self> {
        let hubert_path = model.require(HUBERT_FILE)?;
        let bert_path = model.require(BERT_FILE)?;
        let tokenizer_path = model.require(BERT_TOKENIZER_FILE)?;
        let t2s_path = model.require(T2S_FILE)?;
        let sovits_path = model.require(SOVITS_FILE)?;
        ensure_device()?;
        configure_memory_cache()?;
        // 先建守卫：后面任何一步加载失败，展开时也会等 GPU 并清掉已分配的缓存。
        let cache_guard = ModelMemoryCacheGuard;

        let mut stage = |name: &str| -> Result<()> {
            if !progress(TtsProgress::Loading { stage: name.to_string() }) {
                bail!(ABORT_MESSAGE);
            }
            Ok(())
        };

        stage("hubert")?;
        let hubert = Hubert::load(WeightMap::load_file(hubert_path)?).with_context(|| format!("加载 {ENGINE_NAME} chinese-hubert-base"))?;
        stage("bert")?;
        let bert = Bert::load(WeightMap::load_file(bert_path)?, tokenizer_path)
            .with_context(|| format!("加载 {ENGINE_NAME} chinese-roberta-wwm-ext-large"))?;
        stage("t2s")?;
        let t2s = T2s::load(WeightMap::load_file(t2s_path)?).with_context(|| format!("加载 {ENGINE_NAME} T2S"))?;
        stage("sovits")?;
        let sovits = Sovits::load(WeightMap::load_file(sovits_path)?).with_context(|| format!("加载 {ENGINE_NAME} SoVITS"))?;
        clear_memory_cache()?;

        Ok(Self {
            hubert,
            bert,
            t2s,
            sovits,
            _cache_guard: cache_guard,
        })
    }

    /// `get_phones_and_bert`：中文片段取 BERT 逐音素特征，其余语言补零。
    fn phones_and_bert(&self, text: &str, language: text::Language) -> Result<(Vec<i32>, Vec<f32>)> {
        let mut phones = Vec::new();
        let mut bert = Vec::new();
        for piece in text::phonemize(text, language)? {
            match &piece.word2ph {
                Some(word2ph) => bert.extend(self.bert.phone_features(&piece.norm_text, word2ph)?),
                None => bert.resize(bert.len() + piece.phones.len() * FEATURE_DIM, 0.0),
            }
            phones.extend_from_slice(&piece.phones);
            ensure!(
                bert.len() == phones.len() * FEATURE_DIM,
                "{ENGINE_NAME} 文本前端的 word2ph 与音素数不一致：{}",
                piece.norm_text
            );
        }
        ensure!(!phones.is_empty(), "{ENGINE_NAME} 文本没有可发音的内容：{text}");
        Ok((phones, bert))
    }

    fn prompt(&self, reference_audio: &ReferenceAudio, reference_text: Option<&str>) -> Result<Prompt> {
        let Some(reference_text) = reference_text else {
            return Ok(Prompt {
                semantic: Vec::new(),
                phones: Vec::new(),
                bert: Vec::new(),
            });
        };
        let mut wav16k = decode_reference(reference_audio, SSL_SAMPLE_RATE)?;
        ensure!(
            (MIN_REFERENCE_SAMPLES..=MAX_REFERENCE_SAMPLES).contains(&wav16k.len()),
            "{ENGINE_NAME} 参考音频需 3~10 秒，当前 {:.1} 秒：{}",
            wav16k.len() as f64 / f64::from(SSL_SAMPLE_RATE),
            describe(reference_audio)
        );
        wav16k.extend(std::iter::repeat_n(0.0f32, ZERO_WAV_SAMPLES));
        let hidden = self.hubert.forward(&wav16k)?;
        let semantic = self.sovits.extract_codes(&hidden)?;
        let language = text::Language::resolve(None, reference_text)?;
        let prompt_text = text::with_terminal_punctuation(reference_text, language);
        let (phones, bert) = self
            .phones_and_bert(&prompt_text, language)
            .with_context(|| format!("{ENGINE_NAME} 参考文本前端"))?;
        Ok(Prompt { semantic, phones, bert })
    }
}

/// 参考音频解成 `sample_rate` 的单声道：文件走 ffmpeg 解码，内置音色在内存里解码再重采样
/// （[`ReferenceAudio::samples`]）。
fn decode_reference(audio: &ReferenceAudio, sample_rate: u32) -> Result<Vec<f32>> {
    audio
        .samples(sample_rate)
        .with_context(|| format!("解码 {ENGINE_NAME} 参考音频 {}", describe(audio)))
}

fn describe(audio: &ReferenceAudio) -> String {
    match audio {
        ReferenceAudio::File(path) => path.display().to_string(),
        ReferenceAudio::Builtin(id) => format!("内置音色 {id}"),
    }
}

/// `get_spepc`：32 kHz 波形峰值超过 1 时按 `min(2, peak)` 缩放后取线性谱。
fn reference_spectrogram(audio: &ReferenceAudio) -> Result<Spectrogram> {
    let mut wav32k = decode_reference(audio, SAMPLE_RATE)?;
    let peak = peak(&wav32k);
    if peak > 1.0 {
        let divisor = peak.min(2.0);
        wav32k.iter_mut().for_each(|sample| *sample /= divisor);
    }
    spec::spectrogram(&wav32k)
}

fn peak(samples: &[f32]) -> f32 {
    samples.iter().fold(0.0f32, |max, sample| max.max(sample.abs()))
}

/// 这一次合成拿哪段参考音频与它的原文：调用方给的文件，或内置音色（`Preset`
/// 按 id、`Default` 按语言）。内置音色一律连原文一起带上——GPT-SoVITS 有参考
/// 文本时更像，八段录音都在带文本要求的 3–10 秒之内。
fn reference(request: &TtsRequest) -> Result<(ReferenceAudio, Option<String>)> {
    let picked = crate::synthesize::voices::reference_for(request, ENGINE_NAME)?;
    Ok((picked.audio, picked.text))
}

impl TtsEngine for GptSovits {
    fn kind(&self) -> TtsEngineKind {
        TtsEngineKind::GptSovits
    }

    fn sample_rate(&self) -> u32 {
        SAMPLE_RATE
    }

    /// 模型自己没有说话人表；露出来的是随包的内置音色（`VoiceSpec::Preset` 的取值）。
    fn preset_speakers(&self) -> Vec<String> {
        crate::synthesize::voices::ids()
    }

    fn synthesize(&mut self, request: &TtsRequest, progress: ProgressSink<'_>) -> Result<TtsAudio> {
        let (reference_audio, reference_text) = reference(request)?;
        let params = SamplingParams::from_options(&request.sampling, ENGINE_NAME)?;
        let max_steps = request.sampling.max_tokens.unwrap_or(MAX_STEPS);
        ensure!(max_steps > 0, "{ENGINE_NAME} max_tokens 必须大于 0");
        let language = text::Language::resolve(request.language.as_deref(), &request.text)?;
        let sentences = text::split_sentences(&request.text, language)?;
        ensure!(!sentences.is_empty(), "{ENGINE_NAME} 要合成的文本为空");

        let prompt = self.prompt(&reference_audio, reference_text.as_deref())?;
        let refer = reference_spectrogram(&reference_audio)?;
        let mut rng = Rng::from_optional_seed(request.sampling.seed);

        let count = sentences.len();
        let mut output: Vec<f32> = Vec::new();
        for (index, sentence) in sentences.iter().enumerate() {
            if !progress(TtsProgress::ChunkStarted { index, count }) {
                bail!(ABORT_MESSAGE);
            }
            let (phones, bert) = self
                .phones_and_bert(sentence, language)
                .with_context(|| format!("{ENGINE_NAME} 文本前端"))?;
            let mut all_phones = prompt.phones.clone();
            all_phones.extend_from_slice(&phones);
            let mut all_bert = prompt.bert.clone();
            all_bert.extend_from_slice(&bert);
            let codes = self.t2s.generate(
                &all_phones,
                &all_bert,
                &prompt.semantic,
                &params,
                max_steps,
                &mut rng,
                &mut |generated| progress(TtsProgress::Tokens { index, generated }),
            )?;
            if !codes.is_empty() {
                let mut audio = self.sovits.decode(&codes, &phones, &refer, NOISE_SCALE, rng.next_u64())?;
                let peak = peak(&audio);
                if peak > 1.0 {
                    audio.iter_mut().for_each(|sample| *sample /= peak);
                }
                if !output.is_empty() {
                    output.extend(std::iter::repeat_n(0.0f32, ZERO_WAV_SAMPLES));
                }
                output.extend_from_slice(&audio);
            }
            clear_memory_cache()?;
            let seconds = output.len() as f64 / f64::from(SAMPLE_RATE);
            if !progress(TtsProgress::ChunkFinished { index, seconds }) {
                bail!(ABORT_MESSAGE);
            }
        }
        Ok(TtsAudio {
            samples: output,
            sample_rate: SAMPLE_RATE,
            readings_dropped: Vec::new(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bundle::{FAMILY_GPT_SOVITS, FileEntry, ModelFiles};
    use std::path::{Path, PathBuf};

    /// `BAOCUT_TEST_MODELS_DIR/<repo>/.bcut-manifest.json` 列出的文件（与集成测试同一口径）。
    fn model_files() -> VerifiedFiles {
        let root = PathBuf::from(std::env::var_os("BAOCUT_TEST_MODELS_DIR").expect("BAOCUT_TEST_MODELS_DIR"));
        let dir = root.join("PJMixers-Dev/lj1995_GPT-SoVITS-safetensors");
        let manifest: serde_json::Value = serde_json::from_slice(&std::fs::read(dir.join(".bcut-manifest.json")).unwrap()).unwrap();
        let files = manifest["files"]
            .as_array()
            .unwrap()
            .iter()
            .map(|file| FileEntry {
                path: file["path"].as_str().unwrap().to_owned(),
                sha256: file["sha256"].as_str().unwrap_or_default().to_owned(),
                byte_length: file["size"].as_u64().unwrap(),
            })
            .collect();
        ModelFiles {
            family: FAMILY_GPT_SOVITS.into(),
            revision: manifest["revision"].as_str().unwrap_or_default().to_owned(),
            dir: dir.to_string_lossy().into_owned(),
            files,
        }
        .verify("tts")
        .unwrap()
    }

    fn fixture() -> ReferenceAudio {
        ReferenceAudio::File(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/test-sample.wav"))
    }

    /// 真权重：参考音频自己的语义 token 经 SoVITS 重建，应能听出原句（`BAOCUT_TEST_OUTPUT_DIR`
    /// 给定时写 WAV 供回听）；再让 T2S 以它为提示续写几步，确认整条图能跑。
    #[test]
    #[ignore = "needs the GPT-SoVITS bundle under BAOCUT_TEST_MODELS_DIR"]
    fn real_weights_reconstruct_reference_speech() {
        let _lock = crate::synthesize::tensor::host::TEST_LOCK
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let engine = GptSovits::load(&model_files()).unwrap();
        let reference = fixture();
        let mut wav16k = decode_reference(&reference, SSL_SAMPLE_RATE).unwrap();
        wav16k.extend(std::iter::repeat_n(0.0f32, ZERO_WAV_SAMPLES));
        let hidden = engine.hubert.forward(&wav16k).unwrap();
        let codes = engine.sovits.extract_codes(&hidden).unwrap();
        let expected = wav16k.len() / 320 / 2;
        assert!(codes.len().abs_diff(expected) <= 2, "{} codes", codes.len());

        let refer = reference_spectrogram(&reference).unwrap();
        let phones: Vec<i32> = (100..140).collect();
        let audio = engine.sovits.decode(&codes, &phones, &refer, NOISE_SCALE, 7).unwrap();
        assert_eq!(audio.len(), codes.len() * 2 * 640);
        assert!(audio.iter().all(|sample| sample.is_finite()));
        assert!(peak(&audio) > 0.05, "peak {}", peak(&audio));
        if let Some(out) = std::env::var_os("BAOCUT_TEST_OUTPUT_DIR") {
            let path = PathBuf::from(out).join("gpt-sovits-reconstruct.wav");
            crate::synthesize::wav::write_wav_pcm16(&path, &audio, SAMPLE_RATE).unwrap();
            println!("重建 → {}", path.display());
        }

        let bert = vec![0.0f32; phones.len() * FEATURE_DIM];
        let mut rng = Rng::new(7);
        let generated = engine
            .t2s
            .generate(&phones, &bert, &codes, &SamplingParams::default(), 20, &mut rng, &mut |_| true)
            .unwrap();
        assert!(!generated.is_empty() && generated.len() <= 20);
        assert!(generated.iter().all(|&token| (token as usize) < super::super::t2s::EOS));
    }
}
