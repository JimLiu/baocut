//! 参考音频条件（对照官方 `infer_v2.py` / `infer_v2_5.py` 的 `infer()`）。
//!
//! 一次合成前，从音色参考（与可选的情感参考）音频算出 GPT / S2Mel 需要的全部
//! 条件：w2v-BERT 第 17 层隐状态（音色 / 情感）、语义码本量化嵌入、提示梅尔谱、
//! 长度规整后的提示条件、CAM++ 风格向量，以及显式 8 维情感向量（可选）。
//!
//! 音频读法照官方：音色参考按 22050 Hz 读入并裁到 15 秒（`librosa.load` 缺省；按原生
//! 采样率解码后用拟合 soxr_hq 的 [`dsp::librosa_resample`] 重采样），梅尔谱用它；
//! w2v-BERT 与 CAM++ 用它经 [`dsp::torchaudio_resample`] 降到 16 kHz 的版本。情感参考
//! （没有时就是音色参考文件本身）另按 16 kHz 读入、单独过一遍 w2v-BERT。
//! 显式情感向量给出时不用情感参考音频。
//!
//! 参考音频是 [`ReferenceAudio`]：调用方给的文件，或内置音色的随包录音（在内存里解码，不落盘）。

use super::campplus::CampPlus;
use super::s2mel::S2Mel;
use super::semantic_codec::SemanticCodec;
use super::w2v_bert::Wav2Vec2Bert;
use crate::synthesize::index_tts2::config::RuntimeConfig;
use crate::synthesize::index_tts2::dsp::{self, SEAMLESS_FEATURE_DIM, SEAMLESS_FRAME_LENGTH, SlaneyMelConfig};
use crate::synthesize::index_tts2::emotion::{self, EmotionControl};
use crate::synthesize::tensor::Array;
use crate::synthesize::voices::{self, ReferenceAudio};
use crate::synthesize::wav::decode_wav_pcm16;
use anyhow::{Context, Result, bail};
use std::path::PathBuf;
use std::time::SystemTime;

/// 参考音频最长取 15 秒（官方 `_load_and_cut_audio(…, 15)`）。
pub const MAX_REFERENCE_SECONDS: usize = 15;

/// 一次合成共用的参考条件。音频推出的部分按 [`ConditioningKey`] 跨合成缓存
/// （[`ConditioningCache`]），`explicit_emotion` 随请求现算。
#[derive(Clone)]
pub struct ReferenceConditioning {
    /// 音色参考的 w2v-BERT 隐状态 `[1, T, 1024]`（f32），官方的 `spk_cond_emb`。
    pub speaker_hidden: Array,
    /// 情感参考的隐状态 `[1, T', 1024]`，官方的 `emo_cond_emb`（16 kHz 直读，与音色
    /// 参考同一文件时也单独算）。
    pub emotion_hidden: Array,
    /// 提示梅尔谱 `[1, 80, Tp]`。
    pub prompt_mel: Array,
    /// 长度规整后的提示条件 `[1, Tp, 512]`。
    pub prompt_condition: Array,
    /// CAM++ 风格向量 `[1, 192]`。
    pub style: Array,
    /// 显式情感向量 `[1, 1280]` 与其权重和（给了 `EmotionControl` 时才有）。
    pub explicit_emotion: Option<(Array, f32)>,
}

/// 计算条件所需的模型与统计量（由引擎持有，按引用借出）。
pub struct ConditioningModels<'a> {
    pub config: &'a RuntimeConfig,
    pub w2v_bert: &'a Wav2Vec2Bert,
    /// MaskGCT 语义码本（2.0）；IndexTTS 2.5 为 `None`，提示条件直接由隐状态规整。
    pub semantic_codec: Option<&'a SemanticCodec>,
    pub campplus: &'a CampPlus,
    pub s2mel: &'a S2Mel,
    /// w2v-BERT 隐状态统计量 `[1024]`（host f32）。
    pub w2v_mean: &'a [f32],
    pub w2v_var: &'a [f32],
    /// `feat1.safetensors` 的 `[73, 192]` 行主序数据。
    pub speaker_rows: &'a [f32],
    /// `feat2.safetensors` 的 `[73, 1280]` 行主序数据。
    pub emotion_rows: &'a [f32],
}

/// 显式情感向量 `[1, 1280]` 与其权重和；没给 `control` 时为 `None`。只依赖风格向量与
/// 两张特征表，缓存命中时照样现算。
pub fn explicit_emotion(
    config: &RuntimeConfig,
    speaker_rows: &[f32],
    emotion_rows: &[f32],
    control: Option<&EmotionControl>,
    style: &Array,
) -> Result<Option<(Array, f32)>> {
    let Some(control) = control else {
        return Ok(None);
    };
    let style_host: Vec<f32> = style.as_slice::<f32>().to_vec();
    let (vector, weight_sum) = emotion::explicit_emotion_vector(
        control,
        &style_host,
        speaker_rows,
        emotion_rows,
        &config.emo_num,
        style_host.len(),
        config.gpt.model_dim,
    )?;
    let dim = vector.len() as i32;
    Ok(Some((Array::from_slice(&vector, &[1, dim]), weight_sum)))
}

/// 条件准备里情感参考的实际来源：给了显式情感向量时用音色参考，否则用情感参考
/// 音频，缺省也是音色参考。
pub fn emotion_source<'p>(
    reference_audio: &'p ReferenceAudio,
    emotion_audio: Option<&'p ReferenceAudio>,
    emotion_control: Option<&EmotionControl>,
) -> &'p ReferenceAudio {
    if emotion_control.is_some() {
        reference_audio
    } else {
        emotion_audio.unwrap_or(reference_audio)
    }
}

/// 一段参考音频的身份。文件：路径 + 长度 + 修改时刻，同一路径的文件被改写后算新文件；
/// 内置音色：音色 id（录音随包编译进来，不会变）。
#[derive(Clone, Debug, PartialEq, Eq)]
enum AudioIdentity {
    File {
        path: PathBuf,
        len: u64,
        modified: Option<SystemTime>,
    },
    Builtin(&'static str),
}

impl AudioIdentity {
    fn of(audio: &ReferenceAudio) -> Option<Self> {
        match audio {
            ReferenceAudio::File(path) => {
                let meta = std::fs::metadata(path).ok()?;
                Some(Self::File {
                    path: path.clone(),
                    len: meta.len(),
                    modified: meta.modified().ok(),
                })
            }
            ReferenceAudio::Builtin(id) => Some(Self::Builtin(id)),
        }
    }
}

/// 参考条件缓存键：音色参考 + 情感来源。显式情感向量不进键（随请求现算）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConditioningKey {
    reference: AudioIdentity,
    emotion: AudioIdentity,
}

impl ConditioningKey {
    /// 读不到任一文件的元数据时返回 `None`：不缓存，让条件准备照常报错。
    pub fn new(reference_audio: &ReferenceAudio, emotion_source: &ReferenceAudio) -> Option<Self> {
        Some(Self {
            reference: AudioIdentity::of(reference_audio)?,
            emotion: AudioIdentity::of(emotion_source)?,
        })
    }
}

/// 最多留几份参考条件。每份是两段 `[1, ≤750, 1024]` f32 隐状态加提示梅尔 / 条件，
/// 约 10 MB；配音按说话人取参考，8 份够一部多人片子来回切。
pub const CONDITIONING_CACHE_CAPACITY: usize = 8;

/// 最近用过的参考条件（LRU）。批量合成同一音色时 w2v-BERT 只跑一次，也不必常驻。
pub struct ConditioningCache<V> {
    entries: Vec<(ConditioningKey, V)>,
    capacity: usize,
}

impl<V: Clone> ConditioningCache<V> {
    pub fn new(capacity: usize) -> Self {
        Self {
            entries: Vec::new(),
            capacity: capacity.max(1),
        }
    }

    /// 命中时把这一项挪到最近端并返回副本。
    pub fn get(&mut self, key: &ConditioningKey) -> Option<V> {
        let index = self.entries.iter().position(|(k, _)| k == key)?;
        let entry = self.entries.remove(index);
        let value = entry.1.clone();
        self.entries.push(entry);
        Some(value)
    }

    /// 放入（同键覆盖）；超出容量时淘汰最久没用的一项。
    pub fn insert(&mut self, key: ConditioningKey, value: V) {
        self.entries.retain(|(k, _)| k != &key);
        if self.entries.len() >= self.capacity {
            self.entries.remove(0);
        }
        self.entries.push((key, value));
    }
}

/// 官方 `librosa.load(path)` 不指定 `sr` 时的缺省采样率。
const LIBROSA_DEFAULT_SAMPLE_RATE: u32 = 22_050;

/// 读取并裁到 15 秒的单声道参考音频。
pub fn load_clipped_audio(audio: &ReferenceAudio, sample_rate: u32) -> Result<Vec<f32>> {
    // 照 `librosa.load(path, sr=…)`：按原生采样率解码成单声道，再用拟合 soxr_hq 的
    // 重采样到目标采样率。探测不到采样率时先解到 48 kHz 再重采样。只取前 16 秒：
    // 多出的 1 秒让 15 秒截断处的重采样核两侧都有真实样本。
    let (mut decoded, native) = decode_native(audio)?;
    decoded.truncate(native as usize * (MAX_REFERENCE_SECONDS + 1));
    let mut samples = dsp::librosa_resample(&decoded, native, sample_rate);
    let max_samples = sample_rate as usize * MAX_REFERENCE_SECONDS;
    if samples.len() > max_samples {
        samples.truncate(max_samples);
    }
    Ok(samples)
}

/// 探测不到原生采样率时的中间解码采样率。
const FALLBACK_DECODE_RATE: u32 = 48_000;

/// 按原生采样率解成单声道，返回样本与采样率。文件：WAV 从文件头读采样率；其他格式不探测，
/// 经 ffmpeg 解到 [`FALLBACK_DECODE_RATE`]。内置音色：随包录音（16 kHz）在内存里解码。
fn decode_native(audio: &ReferenceAudio) -> Result<(Vec<f32>, u32)> {
    match audio {
        ReferenceAudio::File(path) => {
            let native = hound::WavReader::open(path)
                .ok()
                .map(|reader| reader.spec().sample_rate)
                .filter(|rate| *rate > 0)
                .unwrap_or(FALLBACK_DECODE_RATE);
            let decoded = crate::audio::decode_mono(path, native).with_context(|| format!("解码参考音频 {} 失败", path.display()))?;
            Ok((decoded, native))
        }
        ReferenceAudio::Builtin(id) => {
            let voice = voices::find(id).with_context(|| format!("没有内置音色 {id}"))?;
            decode_wav_pcm16(voices::wav(voice))
        }
    }
}

/// 报错里怎么称呼一段参考音频。
fn describe(audio: &ReferenceAudio) -> String {
    match audio {
        ReferenceAudio::File(path) => path.display().to_string(),
        ReferenceAudio::Builtin(id) => format!("内置音色 {id}"),
    }
}

/// SeamlessM4T 前端特征 `[1, frames, 160]`；不足一帧时报「参考太短」。
fn semantic_front_end_features(audio_16k: &[f32], source: &ReferenceAudio) -> Result<Array> {
    if audio_16k.len() < SEAMLESS_FRAME_LENGTH {
        bail!(
            "参考音频 {} 太短（{} 个采样，至少需要 {} 个）",
            describe(source),
            audio_16k.len(),
            SEAMLESS_FRAME_LENGTH
        );
    }
    let (features, frames) = dsp::seamless_input_features(audio_16k);
    if frames == 0 {
        bail!("参考音频 {} 太短，无法提取前端特征", describe(source));
    }
    Ok(Array::from_slice(&features, &[1, frames as i32, SEAMLESS_FEATURE_DIM as i32]))
}

impl<'a> ConditioningModels<'a> {
    /// `(hidden − mean) / sqrt(var)`，与 Swift `normalizeSemanticHidden` 相同。
    fn normalize_semantic_hidden(&self, hidden: &Array) -> Result<Array> {
        let dim = self.w2v_mean.len() as i32;
        let mean = Array::from_slice(self.w2v_mean, &[1, 1, dim]);
        let std = Array::from_slice(self.w2v_var, &[1, 1, dim]).sqrt()?;
        Ok((hidden - mean) / std)
    }

    /// 16 kHz 音频 → 归一化后的 w2v-BERT 第 17 层隐状态 `[1, T, 1024]`。
    fn semantic_hidden(&self, audio_16k: &[f32], source: &ReferenceAudio) -> Result<Array> {
        let features = semantic_front_end_features(audio_16k, source)?;
        let hidden = self.w2v_bert.hidden_state_17(&features)?;
        let normalized = self.normalize_semantic_hidden(&hidden)?;
        normalized.eval()?;
        Ok(normalized)
    }

    /// 提示梅尔谱 `[1, 80, Tp]`：先做 `(n_fft − hop)/2` 的自定义反射填充，再取
    /// Slaney 对数梅尔（fmin 0、fmax sr/2、幅度谱、floor 1e-5、无 center、周期 Hann）。
    fn prompt_mel(&self, audio_22k: &[f32]) -> Result<Array> {
        let s2mel = &self.config.s2mel;
        let pad = (s2mel.n_fft - s2mel.hop_length) / 2;
        let padded = dsp::prompt_reflect_pad(audio_22k, pad);
        let cfg = SlaneyMelConfig {
            sample_rate: s2mel.sample_rate,
            n_fft: s2mel.n_fft,
            hop: s2mel.hop_length,
            win: s2mel.win_length,
            n_mels: s2mel.n_mels,
            fmin: 0.0,
            fmax: s2mel.sample_rate as f32 / 2.0,
            power: 1.0,
            log_mel: true,
            log_floor: 1e-5,
            center_pad: false,
            periodic_hann: true,
        };
        let (mel, frames) = dsp::slaney_mel(&padded, &cfg);
        if frames == 0 {
            bail!("参考音频太短，无法提取提示梅尔谱");
        }
        let mel = Array::from_slice(&mel, &[frames as i32, s2mel.n_mels as i32]);
        Ok(mel.t().expand_dims(0)?)
    }

    /// 对照官方 `infer()` 的条件准备段。
    ///
    /// `emotion_audio`：情感参考音频；`emotion_control` 给出时忽略它，缺省时音色参考
    /// 文件同时充当情感参考。`progress` 返回 false 表示取消。
    pub fn prepare(
        &self,
        reference_audio: &ReferenceAudio,
        emotion_audio: Option<&ReferenceAudio>,
        emotion_control: Option<&EmotionControl>,
        progress: &mut dyn FnMut(f32, &str) -> bool,
    ) -> Result<ReferenceConditioning> {
        if !progress(0.05, "读取参考音频") {
            bail!(super::gpt::ABORT_MESSAGE);
        }
        let loaded = load_clipped_audio(reference_audio, LIBROSA_DEFAULT_SAMPLE_RATE)?;
        let reference_16k = dsp::torchaudio_resample(&loaded, LIBROSA_DEFAULT_SAMPLE_RATE, dsp::SEAMLESS_SAMPLE_RATE);
        let reference_22k = dsp::torchaudio_resample(&loaded, LIBROSA_DEFAULT_SAMPLE_RATE, self.config.s2mel.sample_rate);

        if !progress(0.25, "提取音色语义特征") {
            bail!(super::gpt::ABORT_MESSAGE);
        }
        let speaker_hidden = self.semantic_hidden(&reference_16k, reference_audio)?;
        // 2.0 把隐状态量化成 MaskGCT 嵌入再做提示条件；官方 `infer_v2_5` 直接用隐状态。
        let prompt_content = match self.semantic_codec {
            Some(codec) => {
                let encoded = codec.encoder.forward(&speaker_hidden)?;
                codec.quantizer.quantize(&encoded)?.1
            }
            None => speaker_hidden.clone(),
        };

        if !progress(0.55, "提取情感特征") {
            bail!(super::gpt::ABORT_MESSAGE);
        }
        let emotion_source = emotion_source(reference_audio, emotion_audio, emotion_control);
        let emotion_16k = load_clipped_audio(emotion_source, dsp::SEAMLESS_SAMPLE_RATE)?;
        let emotion_hidden = self.semantic_hidden(&emotion_16k, emotion_source)?;

        if !progress(0.75, "计算提示梅尔谱与风格向量") {
            bail!(super::gpt::ABORT_MESSAGE);
        }
        let prompt_mel = self.prompt_mel(&reference_22k)?;
        let prompt_frames = prompt_mel.dim(2);
        let prompt_condition = self.s2mel.length_regulator.forward(&prompt_content, prompt_frames)?;
        let style = self.campplus.inference(&reference_16k)?;

        style.eval()?;
        let explicit_emotion = explicit_emotion(self.config, self.speaker_rows, self.emotion_rows, emotion_control, &style)?;

        prompt_mel.eval()?;
        prompt_condition.eval()?;
        if !progress(1.0, "参考条件就绪") {
            bail!(super::gpt::ABORT_MESSAGE);
        }
        Ok(ReferenceConditioning {
            speaker_hidden,
            emotion_hidden,
            prompt_mel,
            prompt_condition,
            style,
            explicit_emotion,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::path::Path;

    fn file(dir: &Path, name: &str, bytes: &[u8]) -> ReferenceAudio {
        let path = dir.join(name);
        std::fs::write(&path, bytes).unwrap();
        ReferenceAudio::File(path)
    }

    #[test]
    fn conditioning_cache_evicts_the_least_recently_used_entry() {
        let dir = tempfile::tempdir().unwrap();
        let a = file(dir.path(), "a.wav", b"a");
        let b = file(dir.path(), "b.wav", b"b");
        let c = file(dir.path(), "c.wav", b"c");
        let key = |audio: &ReferenceAudio| ConditioningKey::new(audio, audio).unwrap();
        let mut cache = ConditioningCache::new(2);
        cache.insert(key(&a), 1);
        cache.insert(key(&b), 2);
        assert_eq!(cache.get(&key(&a)), Some(1), "命中后 a 变成最近用过");
        cache.insert(key(&c), 3);
        assert_eq!(cache.get(&key(&b)), None, "淘汰最久没用的 b");
        assert_eq!(cache.get(&key(&a)), Some(1));
        assert_eq!(cache.get(&key(&c)), Some(3));
        cache.insert(key(&c), 4);
        assert_eq!(cache.entries.len(), 2, "同键覆盖不占新位");
        assert_eq!(cache.get(&key(&c)), Some(4));
    }

    #[test]
    fn conditioning_key_tracks_the_emotion_source_and_file_contents() {
        let dir = tempfile::tempdir().unwrap();
        let voice = file(dir.path(), "voice.wav", b"voice");
        let mood = file(dir.path(), "mood.wav", b"mood");
        assert_ne!(
            ConditioningKey::new(&voice, &voice),
            ConditioningKey::new(&voice, &mood),
            "情感参考不同就是不同的条件"
        );
        let before = ConditioningKey::new(&voice, &voice).unwrap();
        let ReferenceAudio::File(path) = &voice else { unreachable!() };
        std::fs::write(path, b"re-recorded voice").unwrap();
        assert_ne!(ConditioningKey::new(&voice, &voice), Some(before), "同一路径改写后不能命中旧条件");
        assert_eq!(
            ConditioningKey::new(&ReferenceAudio::File(dir.path().join("missing.wav")), &voice),
            None,
            "读不到文件就不缓存"
        );
        // 内置音色按 id 认，不碰文件系统。
        let builtin = ReferenceAudio::Builtin("zh-female");
        assert_eq!(ConditioningKey::new(&builtin, &builtin), ConditioningKey::new(&builtin, &builtin));
        assert!(ConditioningKey::new(&builtin, &builtin).is_some());
        assert_ne!(
            ConditioningKey::new(&builtin, &builtin),
            ConditioningKey::new(&ReferenceAudio::Builtin("en-male"), &ReferenceAudio::Builtin("en-male"))
        );
    }

    #[test]
    fn explicit_emotion_uses_the_speaker_reference_as_emotion_source() {
        let voice = &ReferenceAudio::File("voice.wav".into());
        let mood = &ReferenceAudio::File("mood.wav".into());
        let control = EmotionControl::from_sliders([0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.8], 1.0).unwrap();
        assert_eq!(emotion_source(voice, Some(mood), None), mood);
        assert_eq!(emotion_source(voice, None, None), voice);
        assert_eq!(emotion_source(voice, Some(mood), Some(&control)), voice);
    }
}
