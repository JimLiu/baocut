//! 界面与 Node 共用的纯语义 WASM 入口（架构设计 §1.4、§13.1、§13.6）：界面要的领域规则在这里调 Rust 的那一份，
//! 不在 TS 里另写。
//!
//! - 转写正文的句子与原文指纹（字幕与翻译核心的规则，经 `speech-doc-bridge`）：翻译流程冻结原文、译文核对、配音判过期、
//!   内容索引与界面的逐句对照都调这一个；
//! - 舞台的框（[`stage`]）：`place` 与画布像素框互换、种类的缺省落位，与帧计划画层同一个实现（`render_graph::item_box`）；
//! - 引擎的取值区间与缺省值（[`ranges`]）：效果、闪避、音量、关键帧、动画与彩纸，界面的数字框按它们封顶；
//! - 元素的样式目录（[`presets`]）：声波、进度条与彩纸的款式与默认参数，读渲染用的同一份内置配方。
//!
//! 与 `preview-wasm` 同一套约定，不用 wasm-bindgen，JSON 经线性内存进出：
//!
//! - `bc_alloc(len)` / `bc_free(ptr, len)`：宿主写入输入用的缓冲；
//! - `bc_<名字>(ptr, len)`：输入是 JSON，返回 0 表示成功，输出区（`bc_output_ptr` / `bc_output_len`）是结果 JSON；
//!   否则输出区是 `{code, message}`；
//! - `bc_speech_sentences`：输入是 `baocut.speech/1` 正文，结果是
//!   `{ derivation, timescale, editViewHash, contentFingerprint, sentences: [{ id, wordIds, text, fingerprint, speaker?, start, end }] }`，
//!   `start` / `end` 是正文 `timescale` 下的整数刻度（边界上不出现浮点秒）；
//! - `bc_stage_box` / `bc_stage_place` / `bc_place_default`：见 [`stage`] 里的同名函数；
//! - `bc_engine_ranges`：见 [`ranges::engine_ranges`]；
//! - `bc_element_presets`：见 [`presets::element_presets`]；
//! - `bc_speaker_proposal` / `bc_apply_speakers`：已有转写的识别说话人，见 [`speakers`]；
//! - `bc_source_chapters`：来源自带章节（平台的 `chapters[]`、简介里的时间戳大纲或显式大纲）的解析与吸附，见 [`source_chapters`]。

pub mod presets;
pub mod ranges;
pub mod source_chapters;
pub mod speakers;
pub mod stage;

use std::cell::RefCell;

use serde::Serialize;
use speech_doc_bridge::sentences::source_sentences;
use video_model::speech::SpeechBody;

/// 调用失败：`code` 是稳定的错误码。
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct EntryError {
    pub code: &'static str,
    pub message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SentencesOutput<'a> {
    derivation: &'a str,
    timescale: i64,
    edit_view_hash: &'a str,
    content_fingerprint: &'a str,
    sentences: Vec<SentenceOutput<'a>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SentenceOutput<'a> {
    id: &'a str,
    word_ids: &'a [String],
    text: &'a str,
    fingerprint: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    speaker: Option<&'a str>,
    start: i64,
    end: i64,
}

thread_local! {
    static OUTPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

/// 转写正文的句子（JSON）。正文读不懂、不是 `baocut.speech/1`、词缺源时间或说话人不合法时 `INVALID_SPEECH`。
pub fn speech_sentences(input: &[u8]) -> Result<String, EntryError> {
    let invalid = |message: String| EntryError {
        code: "INVALID_SPEECH",
        message,
    };
    let body: SpeechBody = serde_json::from_slice(input).map_err(|error| invalid(format!("转写正文读不懂：{error}")))?;
    let derived = source_sentences(&body).map_err(|error| invalid(error.message))?;
    let output = SentencesOutput {
        derivation: derived.derivation,
        timescale: derived.timescale,
        edit_view_hash: &derived.edit_view_hash,
        content_fingerprint: &derived.content_fingerprint,
        sentences: derived
            .sentences
            .iter()
            .map(|sentence| SentenceOutput {
                id: &sentence.id,
                word_ids: &sentence.word_ids,
                text: &sentence.text,
                fingerprint: &sentence.fingerprint,
                speaker: sentence.speaker.as_deref(),
                start: sentence.start,
                end: sentence.end,
            })
            .collect(),
    };
    Ok(serde_json::to_string(&output).expect("句子总能序列化"))
}

/// 输入读不懂（不是约定的 JSON 形状）。
pub(crate) fn invalid_input(error: serde_json::Error) -> EntryError {
    EntryError {
        code: "INVALID_INPUT",
        message: format!("输入读不懂：{error}"),
    }
}

fn finish(result: Result<String, EntryError>) -> u32 {
    let (status, bytes) = match result {
        Ok(json) => (0, json.into_bytes()),
        Err(error) => (1, serde_json::to_vec(&error).expect("错误总能序列化")),
    };
    OUTPUT.with_borrow_mut(|output| *output = bytes);
    status
}

#[unsafe(no_mangle)]
pub extern "C" fn bc_alloc(len: usize) -> *mut u8 {
    let mut buffer = Vec::<u8>::with_capacity(len);
    let ptr = buffer.as_mut_ptr();
    std::mem::forget(buffer);
    ptr
}

/// # Safety
/// `ptr` 与 `len` 必须来自同一次 `bc_alloc`。
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bc_free(ptr: *mut u8, len: usize) {
    if !ptr.is_null() {
        drop(unsafe { Vec::from_raw_parts(ptr, 0, len) });
    }
}

/// 导出一个 `bc_<名字>(ptr, len) -> u32`：读输入、调函数、把结果或错误写进输出区。
macro_rules! export {
    ($($name:ident => $function:path;)*) => {$(
        /// # Safety
        /// `ptr` 指向 `len` 个已写入的字节。
        #[unsafe(no_mangle)]
        pub unsafe extern "C" fn $name(ptr: *const u8, len: usize) -> u32 {
            let input = unsafe { std::slice::from_raw_parts(ptr, len) };
            finish($function(input))
        }
    )*};
}

export! {
    bc_speech_sentences => speech_sentences;
    bc_stage_box => stage::stage_box;
    bc_stage_place => stage::stage_place;
    bc_place_default => stage::place_default;
    bc_engine_ranges => ranges::engine_ranges;
    bc_element_presets => presets::element_presets;
    bc_speaker_proposal => speakers::speaker_proposal;
    bc_apply_speakers => speakers::apply_speakers;
    bc_source_chapters => source_chapters::source_chapters;
}

#[unsafe(no_mangle)]
pub extern "C" fn bc_output_ptr() -> *const u8 {
    OUTPUT.with_borrow(|output| output.as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn bc_output_len() -> usize {
    OUTPUT.with_borrow(|output| output.len())
}
