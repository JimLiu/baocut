//! whisper.cpp 的 Whisper large-v3 / large-v3 Turbo 句级转录器（从 v2 `bcut-speech` 的 `ggml_backend/whisper.rs` 原样移植）。
//!
//! 与 CoreML 版（[`crate::backend::coreml`]）同一口径：贪心解码、按 30 s 窗切、词级时间
//! 交给统一的 forced aligner；这里把「mel → 编码 → 解码」整段换成
//! `whisper_full`，切窗与温度回退用 whisper.cpp 自己的实现。
//!
//! v3 的边界：权重文件由加载器从清单里取（[`super::GgmlBackend`]）；识别经 [`SpeechRecognizer`] 接进转写流水线，
//! 提示（`hint`）作 initial prompt（v2 的 `HintKind::Prompt`）；设备由模型包决定（[`WhisperGgml::load_on`]）。

use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use anyhow::{Context, Result, bail};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use super::{GgmlDevice, default_device};
use crate::speech::{Recognition, RecognitionRequest, SpeechRecognizer};

/// whisper.cpp 解码线程上限；再多只会在小核上互相抢。
const MAX_THREADS: usize = 8;

/// ggml 版 Whisper。一个实例可复用多次 `transcribe`（每次新建 state）。
pub struct WhisperGgml {
    context: WhisperContext,
    device: GgmlDevice,
    threads: usize,
    cancel: Option<Arc<AtomicBool>>,
}

/// v2 `TranscriptionResult` 里 Whisper 用到的两项：句级文本与识别出的语言码。
#[derive(Debug)]
struct TranscriptionResult {
    text: String,
    language: Option<String>,
}

impl WhisperGgml {
    /// 加载单文件 GGML 权重（`ggml-large-v3-turbo-q8_0.bin` 之类），设备取本进程的默认设备。
    pub fn load(weights: &Path) -> Result<Self> {
        Self::load_on(weights, None)
    }

    /// 同 [`Self::load`]，`device` 给定时用它（模型包的设备是 `cpu` 时传 CPU 设备）。
    pub fn load_on(weights: &Path, device: Option<GgmlDevice>) -> Result<Self> {
        if !weights.is_file() {
            bail!("Whisper GGML 权重不存在：{}", weights.display());
        }
        // whisper.cpp / ggml 默认把加载日志直接打到 stderr；装一次钩子收掉，
        // 只保留我们自己的一行设备日志。
        whisper_rs::install_logging_hooks();
        let device = device.unwrap_or_else(default_device);
        let mut params = WhisperContextParameters::default();
        params.use_gpu(device.is_gpu);
        let context =
            WhisperContext::new_with_params(weights, params).with_context(|| format!("加载 Whisper GGML 权重 {}", weights.display()))?;
        let threads = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4)
            .clamp(1, MAX_THREADS);
        eprintln!(
            "whisper: backend={} device=\"{}\" model={}",
            device.label(),
            device.description,
            weights.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
        );
        Ok(Self {
            context,
            device,
            threads,
            cancel: None,
        })
    }

    /// 取消标志：置 true 后 whisper.cpp 在下一个解码步中断，`transcribe` 返回错误。
    pub fn with_cancel_flag(mut self, flag: Arc<AtomicBool>) -> Self {
        self.cancel = Some(flag);
        self
    }

    pub fn device(&self) -> &GgmlDevice {
        &self.device
    }

    fn transcribe_audio(&self, audio: &[f32], language_hint: Option<&str>, prompt: Option<&str>) -> Result<TranscriptionResult> {
        if audio.is_empty() {
            return Ok(TranscriptionResult {
                text: String::new(),
                language: language_hint.map(str::to_owned),
            });
        }
        let language = language_hint.map(whisper_language_code);
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_n_threads(self.threads as i32);
        params.set_translate(false);
        // 与 CoreML 版一致：每个 30 s 窗独立解码，不把上一窗文本当提示——
        // 长音频里的重复循环大多来自跨窗提示。
        params.set_no_context(true);
        params.set_single_segment(false);
        params.set_suppress_blank(true);
        params.set_suppress_nst(true);
        params.set_token_timestamps(false);
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        match language.as_deref() {
            Some(code) => params.set_language(Some(code)),
            None => {
                params.set_language(Some("auto"));
                params.set_detect_language(false);
            }
        }
        // 识别提示：whisper.cpp 把它 tokenize 进 `prompt_past`，模型当**前文**读。
        // `no_context` 在 initial prompt 之前清空历史，两者并存没有冲突；提示因此
        // 逐段都生效，而不是只喂给第一段。
        let prompt = prompt.map(sanitize_prompt);
        if let Some(text) = prompt.as_deref().filter(|text| !text.is_empty()) {
            params.set_initial_prompt(text);
        }
        if let Some(flag) = &self.cancel {
            let flag = Arc::clone(flag);
            params.set_abort_callback_safe(move || flag.load(Ordering::Relaxed));
        }

        let mut state = self.context.create_state().context("创建 whisper.cpp 解码状态")?;
        state.full(params, audio).context("whisper.cpp 解码失败")?;
        if self.cancel.as_ref().is_some_and(|flag| flag.load(Ordering::Relaxed)) {
            bail!("转录已取消");
        }

        let mut pieces = Vec::new();
        for segment in state.as_iter() {
            let text = segment.to_str_lossy().context("读取 whisper.cpp 段文本")?;
            let text = text.trim();
            if !text.is_empty() {
                pieces.push(text.to_owned());
            }
        }
        let detected = whisper_rs::get_lang_str(state.full_lang_id_from_state())
            .map(str::to_owned)
            .filter(|code| !code.is_empty());
        Ok(TranscriptionResult {
            text: join_segments(&pieces),
            language: detected.or_else(|| language_hint.map(str::to_owned)),
        })
    }
}

/// 转写流水线的一段：断言的语言作语言参数，识别提示作 initial prompt（v2 的 `HintKind::Prompt`）。
/// Whisper 报的是语言码（`en`、`yue`），不是 Qwen3-ASR 那样的语言名。
impl SpeechRecognizer for WhisperGgml {
    fn recognize(&mut self, audio: &[f32], request: &RecognitionRequest<'_>) -> Result<Recognition> {
        let result = self.transcribe_audio(audio, request.language, request.context)?;
        Ok(Recognition {
            text: result.text,
            language_name: result.language,
            degenerate: false,
        })
    }
}

/// `whisper_rs::FullParams::set_initial_prompt` 内部建 `CString`，**遇内嵌 NUL 会
/// panic**。提示词一路从用户输入过来，所以在这里把 NUL 换成空格而不是相信调用方。
fn sanitize_prompt(text: &str) -> String {
    text.replace('\0', " ").trim().to_owned()
}

/// 把 BaoCut 的语言标签（`zh-Hans` / `en-US` / `yue`）压成 whisper.cpp 认的两字母码。
pub fn whisper_language_code(hint: &str) -> String {
    let lowered = hint.trim().to_ascii_lowercase();
    let head = lowered.split(['-', '_']).next().unwrap_or("").to_owned();
    match head.as_str() {
        "" => "auto".to_owned(),
        "zh" | "cmn" => "zh".to_owned(),
        "jp" => "ja".to_owned(),
        "kr" => "ko".to_owned(),
        other => other.to_owned(),
    }
}

/// 与 CoreML 版 `transcribe_audio` 的拼接口径一致：段与段之间一个空格，整体 trim。
pub fn join_segments(pieces: &[String]) -> String {
    pieces.join(" ").trim().to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_RATE: u32 = 16_000;

    #[test]
    fn language_codes_collapse_to_whisper_form() {
        assert_eq!(whisper_language_code("zh-Hans"), "zh");
        assert_eq!(whisper_language_code("zh_TW"), "zh");
        assert_eq!(whisper_language_code("en-US"), "en");
        assert_eq!(whisper_language_code("  JA "), "ja");
        assert_eq!(whisper_language_code("jp"), "ja");
        assert_eq!(whisper_language_code("yue"), "yue");
        assert_eq!(whisper_language_code(""), "auto");
    }

    #[test]
    fn a_prompt_with_an_embedded_nul_does_not_reach_cstring() {
        assert_eq!(sanitize_prompt("  \u{0}\u{0}威科夫 \u{0}"), "威科夫");
        assert_eq!(sanitize_prompt("  "), "");
    }

    #[test]
    fn segments_join_like_coreml_chunks() {
        assert_eq!(join_segments(&[]), "");
        assert_eq!(join_segments(&["hello".into(), "world".into()]), "hello world");
        assert_eq!(join_segments(&["你好".into()]), "你好");
    }

    #[test]
    fn missing_weights_fail_before_touching_ggml() {
        let error = match WhisperGgml::load(Path::new("/nonexistent/ggml.bin")) {
            Ok(_) => panic!("missing weights must fail"),
            Err(error) => error,
        };
        assert!(format!("{error:#}").contains("不存在"));
    }

    /// 带权重的端到端只在真机手动跑：`BAOCUT_WHISPER_GGML=/path/ggml-large-v3-turbo-q8_0.bin`。
    #[test]
    #[ignore]
    fn transcribes_silence_with_real_weights() {
        let path = std::env::var("BAOCUT_WHISPER_GGML").expect("BAOCUT_WHISPER_GGML");
        let mut model = WhisperGgml::load(Path::new(&path)).unwrap();
        let silence = vec![0.0_f32; SAMPLE_RATE as usize * 2];
        let result = model
            .recognize(
                &silence,
                &RecognitionRequest {
                    language: Some("en"),
                    context: None,
                },
            )
            .unwrap();
        assert!(result.text.len() < 64, "{result:?}");
    }
}
