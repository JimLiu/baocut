//! 编辑器预览的 WASM 入口（架构设计 §2「纯语义模块编译为 WASM」、§9.7、§13.1）。
//!
//! 界面把视频快照送进来，每一帧按播放头取一份 render-graph 的帧计划，再把计划交给 frame-render 画成一帧 RGBA。
//! 计划与像素都和原生导出出自同一个实现；界面只负责把媒体元素这一刻的画面（视频与位图）、Lottie 与 SVG 图片素材的
//! 字节与字体送进来（SVG 在这里按输出的长边光栅，贴纸的换色也在这里做，与导出同一份）。
//!
//! 不用 wasm-bindgen：只有几个函数，数据经线性内存进出，构建只需要 rustup 的 `wasm32-unknown-unknown`
//! 目标，不依赖与 crate 版本严格对齐的 CLI。约定：
//!
//! - `bc_alloc(len)` / `bc_free(ptr, len)`：宿主写入输入用的缓冲；
//! - `bc_set_video(ptr, len)`：`{"video": VideoSnapshot, "sequenceId"?: Id}`；
//! - `bc_plan(seconds)`：当前视频在这一刻的计划；
//! - `bc_font_files()`：要注入的字体文件名（JSON 数组，次序即注入次序，第一份是回退字体）；
//! - `bc_add_font(ptr, len)`：按上面的次序逐份注入字体字节；缓冲（`bc_alloc` 来的）交给内核，宿主不再 `bc_free`
//!   （本机的大字体集合不再多拷一份）；
//! - `bc_set_documents(ptr, len)`：字幕与字幕样式文档的冻结正文（`FrozenDocument` 数组）；
//! - `bc_set_speech(ptr, len)`：视频里的转写（`[{documentId, sourceAssetId?, body}]`）：投到序列上的有效词流是按文稿
//!   触发的闪避的触发区间，计划与导出的声音计划用同一份（`render_graph::audio_plan::speech_activity`）；按说话人分开的
//!   区间（`speaker_activity`）给声波的 `speaker`，与导出同一份。一份转写都没有时声波当作视频里没有转写。字幕的词也从这里
//!   取（字幕文档的 `sourceDocumentId` 指向的转写，与导出冻结的同一份），不另送一遍；
//! - `bc_set_picture(key_ptr, key_len, ptr, len, width, height)`：实例这一刻的画面（非预乘 RGBA，键是实例 ID）；
//!   `bc_clear_pictures()` 清掉上一帧的；
//! - `bc_set_asset(key_ptr, key_len, ptr, len)`：素材字节（键是 `素材ID@版本`，Lottie 与 SVG 图片要读）；
//! - `bc_set_spectrum(key_ptr, key_len, ptr, len)`：声波实例现成的整轨频谱（BCS1，键是实例 ID，缩略图用）；
//!   `bc_clear_spectra()` 全清；
//! - `bc_set_audio_spectrum(key_ptr, key_len, ptr, len)`：素材频谱（BCS1，键是 `素材ID@版本`），声波按序列的声音计划拼；
//!   `bc_clear_audio_spectra()` 全清；
//! - `bc_spectrum_begin()` / `bc_spectrum_push(ptr, len)` / `bc_spectrum_finish()`：算素材频谱。按块送 48 kHz 单声道
//!   的 f32 小端样本，结束时输出区是 BCS1 字节（与原生导出同一份分析）；
//! - `bc_render(seconds, width, height, flags)`：求这一刻的计划并画出来，输出区是
//!   `{plan, warnings, skipped, spectra, fonts, faces}`，画面在 `bc_frame_ptr` / `bc_frame_len`。`spectra` 是声波用到、还没送进来的
//!   素材频谱（`[{itemId, asset}]`）；`fonts` 是这一帧用到、字体库里没有的字体族名；`faces` 是到目前为止排字时点了名的
//!   face（`[{family, weight, italic}]`，常设）：宿主对照报过缺的族去要本机字体的那一个 face，经 `bc_add_font` 送进来再画。
//!   `flags` 的第 0 位：画字幕层；第 1 位：不铺背景（缩略图），画面是非预乘的 RGBA，
//!   否则是不透明的 RGBA。
//! - `bc_measure_text(ptr, len)`：`{text, style, wrapWidth?, canvas: {width, height}}`，输出区是文字元素要多大的框
//!   `{width, height}`（序列像素，`frame_render::text_measure`）：与画字同一台排版引擎、同一批字体，要先注入字体。
//! - 返回 0 表示成功，输出区（`bc_output_ptr` / `bc_output_len`）是结果 JSON；否则输出区是 `{code, message}`。
//!
//! 渲染器按输出尺寸留两台（播放中的降分辨率与停住时的原尺寸来回切，不重建排版与缓存），送进来的字体、文档、转写与
//! 频谱的作废对每一台都做。

use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::Arc;

use frame_render::{Documents, FrameRenderer, FrozenDocument, LayerMedia, RenderError, RenderOptions, SpeakerActivity};
use render_graph::audio_plan::{speaker_activity, speech_activity};
use render_graph::{PlanDocument, PlanError, VisualLayer, plan_interactive_with_speech};
use serde::Deserialize;
use serde_json::{Value, json};
use tiny_skia::Pixmap;
use video_model::{DocumentRecord, VersionRef};
use waveform::bcs1::SpectrumBackend;
use waveform::dsp::SpectrumStream;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MeasureText {
    text: String,
    #[serde(default)]
    style: Value,
    #[serde(default)]
    wrap_width: Option<f64>,
    canvas: Size,
}

#[derive(Deserialize)]
struct Size {
    width: f64,
    height: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetVideo {
    video: PlanDocument,
    #[serde(default)]
    sequence_id: Option<String>,
}

/// 界面送进来的画面、素材字节与频谱。
#[derive(Default)]
struct Media {
    pictures: HashMap<String, Pixmap>,
    assets: HashMap<String, Vec<u8>>,
    spectra: HashMap<String, Vec<u8>>,
    audio_spectra: HashMap<String, Vec<u8>>,
}

impl LayerMedia for Media {
    fn picture(&mut self, layer: &VisualLayer) -> Result<Option<&Pixmap>, RenderError> {
        Ok(self.pictures.get(&layer.item_id))
    }

    fn asset_bytes(&mut self, asset: &VersionRef) -> Option<Vec<u8>> {
        self.assets.get(&format!("{}@{}", asset.id, asset.revision)).cloned()
    }

    fn spectrum(&mut self, item_id: &str) -> Option<Vec<u8>> {
        self.spectra.get(item_id).cloned()
    }

    fn audio_spectrum(&mut self, asset: &VersionRef) -> Option<Vec<u8>> {
        self.audio_spectra.get(&format!("{}@{}", asset.id, asset.revision)).cloned()
    }
}

/// 一份转写：文档 ID、它描述的素材与当前版本的正文。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpeechInput {
    document_id: String,
    #[serde(default)]
    source_asset_id: Option<String>,
    body: Value,
}

impl SpeechInput {
    /// 存成渲染器读的冻结文档（字幕取词与投词流共用一份正文）。
    fn frozen(self) -> Arc<FrozenDocument> {
        Arc::new(FrozenDocument {
            document_id: self.document_id,
            kind: Some("speech".into()),
            schema: self.body.get("schema").and_then(Value::as_str).map(str::to_string),
            line_kind: None,
            source_document_id: None,
            source_asset_id: self.source_asset_id,
            body: self.body,
        })
    }
}

/// 投词流只读记录的 ID、种类与素材，其余字段留空。
fn speech_record(document: &FrozenDocument) -> DocumentRecord {
    DocumentRecord {
        id: document.document_id.clone(),
        kind: "speech".into(),
        name: String::new(),
        language: None,
        source_asset_id: document.source_asset_id.clone(),
        source_document_id: None,
        current_revision: String::new(),
        revisions: Default::default(),
        extensions: Default::default(),
    }
}

/// 渲染器读的文档：字幕与样式文档，加上转写（同一个 ID 时字幕那一侧为准）。
fn renderer_documents(documents: &[Arc<FrozenDocument>], speech: &[Arc<FrozenDocument>]) -> Documents {
    Documents::shared(speech.iter().chain(documents).cloned())
}

#[derive(Default)]
struct State {
    video: Option<(PlanDocument, String)>,
    speech_documents: Vec<Arc<FrozenDocument>>,
    /// 有效词流在序列上的区间：视频或转写换了就作废，下一次求计划时重算。
    speech: Option<Vec<(f64, f64)>>,
    /// 各说话人的区间（外层 `None` 是还没算；内层 `None` 是一份转写都没有），与 `speech` 一起作废。
    speakers: Option<Option<Arc<SpeakerActivity>>>,
    /// 注入的字体（内置的一批，加上宿主按族名送来的本机字体）；渲染器与这里共享字节。
    fonts: Vec<Arc<Vec<u8>>>,
    documents: Vec<Arc<FrozenDocument>>,
    /// 按输出尺寸留着的渲染器，最近画过的在末尾（[`frame`] 取它的画面），最多 [`RENDERER_SLOTS`] 台。
    renderers: Vec<FrameRenderer>,
    media: Media,
    output: Vec<u8>,
    /// 正在算的素材频谱。
    analysis: Option<SpectrumStream>,
    /// 透明底那一帧还原成非预乘的字节；不透明的帧直接用渲染器的画面，这里是空的。
    straight: Vec<u8>,
}

/// 同时留着几台渲染器：预览播放与停住各用一种尺寸（`render-planner` 的播放画质），来回切时各自的排版、字幕编译与
/// 素材缓存都还在；改尺寸（`FrameRenderer::resize`）会把它们全部作废，要重建零点几秒到一秒多。
const RENDERER_SLOTS: usize = 2;

/// 把画 `width`×`height` 的那台渲染器挪到末尾（最近用过）。没有这个尺寸的：不满就新建一台，满了就把最久没用的那台
/// 改成这个尺寸。返回是不是换了一台（末尾原来不是它）。
fn renderer_for(
    renderers: &mut Vec<FrameRenderer>,
    width: u32,
    height: u32,
    create: impl FnOnce() -> Result<FrameRenderer, RenderError>,
) -> Result<bool, RenderError> {
    let size = |renderer: &FrameRenderer| (renderer.frame().width(), renderer.frame().height());
    let index = renderers.iter().position(|renderer| size(renderer) == (width, height));
    if index.is_some_and(|index| index + 1 == renderers.len()) {
        return Ok(false);
    }
    if let Some(index) = index {
        let renderer = renderers.remove(index);
        renderers.push(renderer);
    } else if renderers.len() < RENDERER_SLOTS {
        renderers.push(create()?);
    } else {
        let mut renderer = renderers.remove(0);
        renderer.resize(width, height)?;
        renderers.push(renderer);
    }
    Ok(true)
}

thread_local! {
    static STATE: RefCell<State> = RefCell::new(State::default());
}

fn failure(code: &str, message: impl Into<String>) -> PlanError {
    PlanError {
        code: code.into(),
        message: message.into(),
    }
}

/// 送进一个视频；没有指定序列时用根序列。
pub fn set_video(input: &[u8]) -> Result<(), PlanError> {
    let request: SetVideo = serde_json::from_slice(input).map_err(|error| failure("INVALID_VIDEO", format!("视频快照读不懂：{error}")))?;
    let sequence_id = request.sequence_id.unwrap_or_else(|| request.video.root_sequence_id.clone());
    if !request.video.sequences.contains_key(&sequence_id) {
        return Err(failure("SEQUENCE_NOT_FOUND", format!("没有序列 {sequence_id}")));
    }
    STATE.with_borrow_mut(|state| {
        state.video = Some((request.video, sequence_id));
        state.speech = None;
        state.speakers = None;
        // 渲染器按剪辑记下的字幕签名随新快照作废。
        for renderer in &mut state.renderers {
            renderer.sequence_changed();
        }
    });
    Ok(())
}

/// 换一批转写（视频里 `kind: speech` 的文档）。
pub fn set_speech(input: &[u8]) -> Result<(), PlanError> {
    let documents: Vec<SpeechInput> =
        serde_json::from_slice(input).map_err(|error| failure("INVALID_DOCUMENTS", format!("转写读不懂：{error}")))?;
    STATE.with_borrow_mut(|state| {
        state.speech_documents = documents.into_iter().map(SpeechInput::frozen).collect();
        state.speech = None;
        state.speakers = None;
        for renderer in &mut state.renderers {
            renderer.set_documents(renderer_documents(&state.documents, &state.speech_documents));
        }
    });
    Ok(())
}

/// 当前视频的有效词流（算过就用缓存的）。
fn speech_of<'a>(
    video: &PlanDocument,
    sequence_id: &str,
    documents: &[Arc<FrozenDocument>],
    cache: &'a mut Option<Vec<(f64, f64)>>,
) -> Result<&'a [(f64, f64)], PlanError> {
    if cache.is_none() {
        let records: Vec<DocumentRecord> = documents.iter().map(|d| speech_record(d)).collect();
        let pairs: Vec<_> = records.iter().zip(documents).map(|(record, d)| (record, &d.body)).collect();
        *cache = Some(if pairs.is_empty() {
            Vec::new()
        } else {
            speech_activity(video.view(), sequence_id, &pairs)?
        });
    }
    Ok(cache.as_deref().unwrap_or_default())
}

/// 当前视频各说话人的区间（算过就用缓存的）；一份转写都没有时是 `None`。
fn speakers_of(
    video: &PlanDocument,
    sequence_id: &str,
    documents: &[Arc<FrozenDocument>],
    cache: &mut Option<Option<Arc<SpeakerActivity>>>,
) -> Result<Option<Arc<SpeakerActivity>>, PlanError> {
    if cache.is_none() {
        let records: Vec<DocumentRecord> = documents.iter().map(|d| speech_record(d)).collect();
        let pairs: Vec<_> = records.iter().zip(documents).map(|(record, d)| (record, &d.body)).collect();
        *cache = Some(if pairs.is_empty() {
            None
        } else {
            Some(Arc::new(speaker_activity(video.view(), sequence_id, &pairs)?))
        });
    }
    Ok(cache.clone().flatten())
}

/// 当前视频在 `seconds` 的计划（JSON）。
pub fn plan(seconds: f64) -> Result<String, PlanError> {
    STATE.with_borrow_mut(|state| {
        let State {
            video,
            speech_documents,
            speech,
            ..
        } = state;
        let (video, sequence_id) = video.as_ref().ok_or_else(|| failure("NO_VIDEO", "还没有送进视频"))?;
        let speech = speech_of(video, sequence_id, speech_documents, speech)?;
        let plan = plan_interactive_with_speech(video.view(), sequence_id, seconds, Some(speech))?;
        Ok(serde_json::to_string(&plan).expect("计划总能序列化"))
    })
}

/// 要注入的字体文件名（JSON）。
pub fn font_files() -> String {
    serde_json::to_string(frame_render::BUNDLED_FONT_FILES).expect("字符串数组总能序列化")
}

/// 注入一份字体：先按 [`font_files`] 的次序注入内置的一批；之后宿主按 `render` 报的缺字体族与用到的 face 送来本机字体
/// 的那一个 face（与导出同一份解析与抽法）。已经建好的渲染器装上它，下一帧按新的字体库重排。
pub fn add_font(bytes: Vec<u8>) -> Result<(), PlanError> {
    if bytes.is_empty() {
        return Err(failure("INVALID_FONT", "字体是空的"));
    }
    STATE.with_borrow_mut(|state| {
        let bytes = Arc::new(bytes);
        state.fonts.push(bytes.clone());
        for renderer in &mut state.renderers {
            renderer.add_fonts(vec![bytes.clone()]);
        }
    });
    Ok(())
}

/// 换一批字幕与字幕样式文档。
pub fn set_documents(input: &[u8]) -> Result<(), PlanError> {
    let documents: Vec<FrozenDocument> =
        serde_json::from_slice(input).map_err(|error| failure("INVALID_DOCUMENTS", format!("文档读不懂：{error}")))?;
    STATE.with_borrow_mut(|state| {
        state.documents = documents.into_iter().map(Arc::new).collect();
        for renderer in &mut state.renderers {
            renderer.set_documents(renderer_documents(&state.documents, &state.speech_documents));
        }
    });
    Ok(())
}

/// 送进实例这一刻的画面（非预乘 RGBA）。
pub fn set_picture(key: &str, rgba: Vec<u8>, width: u32, height: u32) -> Result<(), PlanError> {
    if rgba.len() != width as usize * height as usize * 4 {
        return Err(failure("INVALID_PICTURE", format!("画面 {key} 的字节数与 {width}×{height} 不符")));
    }
    let picture = frame_render::premultiplied(width, height, rgba).ok_or_else(|| failure("INVALID_PICTURE", "画面尺寸不可用"))?;
    STATE.with_borrow_mut(|state| state.media.pictures.insert(key.to_string(), picture));
    Ok(())
}

pub fn clear_pictures() {
    STATE.with_borrow_mut(|state| state.media.pictures.clear());
}

/// 送进素材字节（键是 `素材ID@版本`）。
pub fn set_asset(key: &str, bytes: Vec<u8>) {
    STATE.with_borrow_mut(|state| state.media.assets.insert(key.to_string(), bytes));
}

/// 送进声波实例的整轨频谱（BCS1，键是实例 ID）：已推好的频谱轨作废。
pub fn set_spectrum(item_id: &str, bytes: Vec<u8>) {
    STATE.with_borrow_mut(|state| {
        state.media.spectra.insert(item_id.to_string(), bytes);
        for renderer in &mut state.renderers {
            renderer.clear_spectra();
        }
    });
}

/// 清掉全部频谱。
pub fn clear_spectra() {
    STATE.with_borrow_mut(|state| {
        state.media.spectra.clear();
        for renderer in &mut state.renderers {
            renderer.clear_spectra();
        }
    });
}

/// 送进素材频谱（BCS1，键是 `素材ID@版本`）：已拼好的频谱轨作废。
pub fn set_audio_spectrum(key: &str, bytes: Vec<u8>) {
    STATE.with_borrow_mut(|state| {
        state.media.audio_spectra.insert(key.to_string(), bytes);
        for renderer in &mut state.renderers {
            renderer.clear_spectra();
        }
    });
}

/// 清掉全部素材频谱。
pub fn clear_audio_spectra() {
    STATE.with_borrow_mut(|state| {
        state.media.audio_spectra.clear();
        for renderer in &mut state.renderers {
            renderer.clear_spectra();
        }
    });
}

/// 开始算一份素材频谱（丢掉没算完的）。
pub fn spectrum_begin() {
    STATE.with_borrow_mut(|state| state.analysis = Some(SpectrumStream::new()));
}

/// 接着送一块 48 kHz 单声道样本（f32 小端）。
pub fn spectrum_push(bytes: &[u8]) -> Result<(), PlanError> {
    if !bytes.len().is_multiple_of(4) {
        return Err(failure("INVALID_AUDIO", "样本字节数不是 4 的倍数"));
    }
    let samples: Vec<f32> = bytes
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect();
    STATE.with_borrow_mut(|state| {
        let stream = state.analysis.as_mut().ok_or_else(|| failure("NO_ANALYSIS", "还没有开始算频谱"))?;
        stream
            .push(&samples)
            .map_err(|error| failure("INVALID_AUDIO", format!("{error:#}")))
    })
}

/// 送完了：交出 BCS1 字节。
pub fn spectrum_finish() -> Result<Vec<u8>, PlanError> {
    let stream = STATE
        .with_borrow_mut(|state| state.analysis.take())
        .ok_or_else(|| failure("NO_ANALYSIS", "还没有开始算频谱"))?;
    // 解码是浏览器做的：头里的来源记成纯 Rust 解码（BCS1 只分这两种，内容一样）。
    stream
        .finish(SpectrumBackend::Symphonia)
        .map_err(|error| failure("INVALID_AUDIO", format!("{error:#}")))
}

/// 求 `seconds` 这一刻的计划并画出来（`width`×`height`，与序列画布同比例）。画不出来的东西跳过、报在 `skipped` 里，
/// 预览照常出画面。`transparent` 时不铺背景，画面是非预乘的 RGBA（缩略图）。返回 `{plan, warnings, skipped, spectra, fonts, faces, captionHits}`
/// （`spectra` 是还没送进来的素材频谱，`fonts` 是这一帧用到、字体库里没有的字体族，`faces` 是排字时点了名的 face）；
/// `captionHits` 是这一帧字幕行的序列画布几何与所属实例；画面经 [`frame`] 取。
pub fn render(seconds: f64, width: u32, height: u32, captions: bool, transparent: bool) -> Result<String, PlanError> {
    STATE.with_borrow_mut(|state| {
        let State {
            video,
            speech_documents,
            speech,
            speakers,
            fonts,
            documents,
            renderers,
            media,
            straight,
            ..
        } = state;
        let (video, sequence_id) = video.as_ref().ok_or_else(|| failure("NO_VIDEO", "还没有送进视频"))?;
        let speech = speech_of(video, sequence_id, speech_documents, speech)?;
        let speakers = speakers_of(video, sequence_id, speech_documents, speakers)?;
        let plan = plan_interactive_with_speech(video.view(), sequence_id, seconds, Some(speech))?;
        let render_failure = |error: RenderError| failure(&error.code, error.message);
        let switched = renderer_for(renderers, width, height, || {
            FrameRenderer::with_shared_fonts(
                RenderOptions {
                    width,
                    height,
                    skip_unsupported: true,
                    captions,
                },
                renderer_documents(documents, speech_documents),
                fonts.clone(),
            )
        })
        .map_err(render_failure)?;
        let active = renderers.len() - 1;
        let (others, active) = renderers.split_at_mut(active);
        let renderer = &mut active[0];
        renderer.set_captions(captions);
        renderer.set_collect_caption_hits(true);
        renderer.set_transparent(transparent);
        renderer.set_speakers(speakers);
        // 换了一台：声波的频谱轨与尺寸无关，从上一次画的那台拿过来，不重拼。
        if switched && let Some(previous) = others.last() {
            renderer.share_spectra_from(previous);
        }
        renderer.clear_reports();
        renderer.render(video.view(), &plan, seconds, media).map_err(render_failure)?;
        *straight = if transparent {
            frame_render::demultiplied(renderer.frame().data())
        } else {
            Vec::new()
        };
        let spectra: Vec<Value> = renderer
            .missing_spectra()
            .iter()
            .map(|(item_id, asset)| json!({ "itemId": item_id, "asset": asset }))
            .collect();
        let output = json!({
            "plan": plan,
            "warnings": renderer.warnings(),
            "skipped": renderer.skipped(),
            "spectra": spectra,
            "captionHits": renderer.caption_hits(),
            "fonts": renderer.missing_fonts(),
            "faces": renderer
                .used_faces()
                .into_iter()
                .map(|(family, weight, italic)| json!({ "family": family, "weight": weight, "italic": italic }))
                .collect::<Vec<_>>(),
        });
        Ok(output.to_string())
    })
}

/// 量一段文字作为文字元素要多大的框（`{width, height}`，序列像素）。还没画过帧时先建渲染器（尺寸随下一次画帧改）。
pub fn measure_text(input: &[u8]) -> Result<String, PlanError> {
    let input: MeasureText =
        serde_json::from_slice(input).map_err(|error| failure("INVALID_PARAMS", format!("量字的参数读不懂：{error}")))?;
    let canvas = |side: f64| {
        if side.is_finite() {
            side.round().clamp(1.0, 65_535.0) as u32
        } else {
            1
        }
    };
    let style = if input.style.is_null() { json!({}) } else { input.style };
    STATE.with_borrow_mut(|state| {
        let State {
            fonts,
            documents,
            speech_documents,
            renderers,
            ..
        } = state;
        // 量字与尺寸无关：用最近画过的那一台，不改次序（[`frame`] 还是上一次画的）。
        if renderers.is_empty() {
            renderers.push(
                FrameRenderer::with_shared_fonts(
                    RenderOptions {
                        width: 1,
                        height: 1,
                        skip_unsupported: true,
                        captions: true,
                    },
                    renderer_documents(documents, speech_documents),
                    fonts.clone(),
                )
                .map_err(|error| failure(&error.code, error.message))?,
            );
        }
        let renderer = renderers.last_mut().expect("至少有一台");
        let measured = renderer.measure_text(
            &input.text,
            &style,
            input.wrap_width,
            (canvas(input.canvas.width), canvas(input.canvas.height)),
        );
        Ok(json!(measured).to_string())
    })
}

/// 上一次 [`render`] 画好的帧。
pub fn frame() -> Vec<u8> {
    STATE.with_borrow(|state| frame_bytes(state).to_vec())
}

fn frame_bytes(state: &State) -> &[u8] {
    if !state.straight.is_empty() {
        return &state.straight;
    }
    state.renderers.last().map_or(&[], |r| r.frame().data())
}

fn finish(result: Result<Vec<u8>, PlanError>) -> u32 {
    let (status, bytes) = match result {
        Ok(bytes) => (0, bytes),
        Err(error) => (1, serde_json::to_vec(&error).expect("错误总能序列化")),
    };
    STATE.with_borrow_mut(|state| state.output = bytes);
    status
}

/// # Safety
/// `ptr` 指向 `len` 个已写入的字节。
unsafe fn bytes<'a>(ptr: *const u8, len: usize) -> &'a [u8] {
    if len == 0 {
        &[]
    } else {
        unsafe { std::slice::from_raw_parts(ptr, len) }
    }
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

/// # Safety
/// `ptr` 指向 `len` 个已写入的字节。
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bc_set_video(ptr: *const u8, len: usize) -> u32 {
    finish(set_video(unsafe { bytes(ptr, len) }).map(|()| Vec::new()))
}

#[unsafe(no_mangle)]
pub extern "C" fn bc_plan(seconds: f64) -> u32 {
    finish(plan(seconds).map(String::into_bytes))
}

#[unsafe(no_mangle)]
pub extern "C" fn bc_font_files() -> u32 {
    finish(Ok(font_files().into_bytes()))
}

/// 缓冲直接成为字体的存储（本机字体集合可达几十 MB，拷一份会让线性内存的高水位翻倍，而线性内存不会缩回去）。
///
/// # Safety
/// `ptr` 与 `len` 必须来自同一次 `bc_alloc` 且已写满；调用之后缓冲归内核，宿主不得再 `bc_free`。
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bc_add_font(ptr: *mut u8, len: usize) -> u32 {
    let bytes = if ptr.is_null() {
        Vec::new()
    } else {
        unsafe { Vec::from_raw_parts(ptr, len, len) }
    };
    finish(add_font(bytes).map(|()| Vec::new()))
}

/// # Safety
/// `ptr` 指向 `len` 个已写入的字节。
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bc_set_documents(ptr: *const u8, len: usize) -> u32 {
    finish(set_documents(unsafe { bytes(ptr, len) }).map(|()| Vec::new()))
}

/// # Safety
/// `ptr` 指向 `len` 个已写入的字节。
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bc_set_speech(ptr: *const u8, len: usize) -> u32 {
    finish(set_speech(unsafe { bytes(ptr, len) }).map(|()| Vec::new()))
}

/// # Safety
/// 两段输入各自指向已写入的字节。
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bc_set_picture(key_ptr: *const u8, key_len: usize, ptr: *const u8, len: usize, width: u32, height: u32) -> u32 {
    let key = String::from_utf8_lossy(unsafe { bytes(key_ptr, key_len) }).into_owned();
    finish(set_picture(&key, unsafe { bytes(ptr, len) }.to_vec(), width, height).map(|()| Vec::new()))
}

#[unsafe(no_mangle)]
pub extern "C" fn bc_clear_pictures() {
    clear_pictures();
}

/// # Safety
/// 两段输入各自指向已写入的字节。
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bc_set_asset(key_ptr: *const u8, key_len: usize, ptr: *const u8, len: usize) {
    let key = String::from_utf8_lossy(unsafe { bytes(key_ptr, key_len) }).into_owned();
    set_asset(&key, unsafe { bytes(ptr, len) }.to_vec());
}

/// # Safety
/// 两段输入各自指向已写入的字节。
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bc_set_spectrum(key_ptr: *const u8, key_len: usize, ptr: *const u8, len: usize) {
    let key = String::from_utf8_lossy(unsafe { bytes(key_ptr, key_len) }).into_owned();
    set_spectrum(&key, unsafe { bytes(ptr, len) }.to_vec());
}

#[unsafe(no_mangle)]
pub extern "C" fn bc_clear_spectra() {
    clear_spectra();
}

/// # Safety
/// 两段输入各自指向已写入的字节。
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bc_set_audio_spectrum(key_ptr: *const u8, key_len: usize, ptr: *const u8, len: usize) {
    let key = String::from_utf8_lossy(unsafe { bytes(key_ptr, key_len) }).into_owned();
    set_audio_spectrum(&key, unsafe { bytes(ptr, len) }.to_vec());
}

#[unsafe(no_mangle)]
pub extern "C" fn bc_clear_audio_spectra() {
    clear_audio_spectra();
}

#[unsafe(no_mangle)]
pub extern "C" fn bc_spectrum_begin() {
    spectrum_begin();
}

/// # Safety
/// `ptr` 指向 `len` 个已写入的字节。
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bc_spectrum_push(ptr: *const u8, len: usize) -> u32 {
    finish(spectrum_push(unsafe { bytes(ptr, len) }).map(|()| Vec::new()))
}

#[unsafe(no_mangle)]
pub extern "C" fn bc_spectrum_finish() -> u32 {
    finish(spectrum_finish())
}

#[unsafe(no_mangle)]
pub extern "C" fn bc_render(seconds: f64, width: u32, height: u32, flags: u32) -> u32 {
    finish(render(seconds, width, height, flags & 1 != 0, flags & 2 != 0).map(String::into_bytes))
}

/// # Safety
/// `ptr` 指向 `len` 个已写入的字节。
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bc_measure_text(ptr: *const u8, len: usize) -> u32 {
    finish(measure_text(unsafe { bytes(ptr, len) }).map(String::into_bytes))
}

#[unsafe(no_mangle)]
pub extern "C" fn bc_frame_ptr() -> *const u8 {
    STATE.with_borrow(|state| frame_bytes(state).as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn bc_frame_len() -> usize {
    STATE.with_borrow(|state| frame_bytes(state).len())
}

#[unsafe(no_mangle)]
pub extern "C" fn bc_output_ptr() -> *const u8 {
    STATE.with_borrow(|state| state.output.as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn bc_output_len() -> usize {
    STATE.with_borrow(|state| state.output.len())
}
