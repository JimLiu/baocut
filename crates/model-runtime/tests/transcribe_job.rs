//! `transcribe::run` 的编排：用假的 VAD 与识别器跑真实的解码、分段、tick 换算、结果组装与自检，
//! 不需要模型文件，也不依赖推理后端。自己切段的模型（MOSS 那一类）用假的 [`SegmentingRecognizer`] 跑。

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use anyhow::Result;
use model_runtime::asr_result::{self, AsrResult, LanguageSource, Outcome, TimingQuality, WarningCode};
use model_runtime::backend::{LoadedModel, RunMode};
use model_runtime::bundle::{self, ModelBundle, VerifiedBundle};
use model_runtime::protocol::{ErrorBody, JobOutcome, JobRunParams, JobRunResult, MemorySnapshot};
use model_runtime::speech::pyannote_common::{DiarizedSegment, PyannoteCallbacks, PyannoteCancelled, PyannoteOptions};
use model_runtime::speech::{
    AlignedWord, ForcedAlignment, Recognition, RecognitionRequest, RowIn, SegmentedTranscription, SegmentingCallbacks, SegmentingCancelled,
    SegmentingRecognizer, SpeakerDiarization, SpeakerEmbedding, SpeakerRange, SpeechRecognizer, StreamingVad,
};
use model_runtime::transcribe::{self, JobSink};
use serde_json::{Value, json};

/// 样本绝对值就是语音概率。
struct AmplitudeVad;

impl StreamingVad for AmplitudeVad {
    fn process_chunk(&mut self, samples: &[f32]) -> Result<f32> {
        Ok(samples.iter().fold(0.0_f32, |max, value| max.max(value.abs())))
    }

    fn reset_state(&mut self) {}
}

/// 按顺序吐出预设的文本；可以在第一次调用时替 Runtime 按下取消。
struct ScriptedRecognizer {
    texts: VecDeque<&'static str>,
    language_name: Option<&'static str>,
    /// 逐次调用自报的语言名；用完后回到 `language_name`。
    language_names: VecDeque<Option<&'static str>>,
    requests: Vec<(usize, Option<String>, Option<String>)>,
    cancel_on_first_call: Option<Arc<AtomicBool>>,
}

impl SpeechRecognizer for ScriptedRecognizer {
    fn recognize(&mut self, audio: &[f32], request: &RecognitionRequest<'_>) -> Result<Recognition> {
        self.requests
            .push((audio.len(), request.language.map(str::to_owned), request.context.map(str::to_owned)));
        if let Some(cancel) = self.cancel_on_first_call.take() {
            cancel.store(true, Ordering::SeqCst);
        }
        let text = self.texts.pop_front().unwrap_or("more words");
        let language_name = self.language_names.pop_front().unwrap_or(self.language_name);
        Ok(Recognition {
            text: text.into(),
            language_name: language_name.map(str::to_owned),
            degenerate: false,
        })
    }
}

/// 假的强制对齐器：`align` 给出预设的词（相对所给音频的秒，同 v2 流水线测试里的 hello/world）、报错或什么都不给；
/// `align_long`（`capability: 'align'`）给出预设的整段词。记下每次收到的样本数、文本与语言。
enum AlignerScript {
    Words(Vec<(&'static str, f32, f32)>),
    Fail,
    Empty,
}

struct FakeAligner {
    script: AlignerScript,
    calls: Vec<(usize, String, Option<String>)>,
}

impl FakeAligner {
    fn new(script: AlignerScript) -> Self {
        Self { script, calls: Vec::new() }
    }

    fn hello_world() -> Self {
        Self::new(AlignerScript::Words(vec![("hello", 0.0, 0.1), ("world", 0.12, 0.2)]))
    }
}

impl ForcedAlignment for FakeAligner {
    fn align(&mut self, audio: &[f32], text: &str, language: Option<&str>) -> Result<Vec<AlignedWord>> {
        self.calls.push((audio.len(), text.to_owned(), language.map(str::to_owned)));
        match &self.script {
            AlignerScript::Words(words) => Ok(words
                .iter()
                .map(|&(text, start, end)| AlignedWord {
                    text: text.to_owned(),
                    start,
                    end,
                })
                .collect()),
            AlignerScript::Fail => Err(anyhow::anyhow!("aligner exploded")),
            AlignerScript::Empty => Ok(Vec::new()),
        }
    }
}

/// 假的说话人区分：给出预设的区间（相对解码起点的秒）、报错或报取消；记下收到的样本数与选项，报一次进度。
enum DiarizerScript {
    Segments(Vec<(f64, f64, usize)>),
    Fail,
    Cancel,
}

struct FakeDiarizer {
    script: DiarizerScript,
    calls: Vec<(usize, PyannoteOptions)>,
}

impl SpeakerDiarization for FakeDiarizer {
    fn diarize(
        &mut self,
        samples: &[f32],
        options: &PyannoteOptions,
        callbacks: &mut PyannoteCallbacks<'_>,
    ) -> Result<Vec<DiarizedSegment>> {
        self.calls.push((samples.len(), *options));
        if let Some(progress) = callbacks.on_progress.as_deref_mut() {
            progress(2.0, 2.0);
        }
        match &self.script {
            DiarizerScript::Segments(segments) => Ok(segments
                .iter()
                .map(|&(start, end, speaker)| DiarizedSegment { start, end, speaker })
                .collect()),
            DiarizerScript::Fail => Err(anyhow::anyhow!("pyannote exploded")),
            DiarizerScript::Cancel => Err(PyannoteCancelled.into()),
        }
    }
}

struct FakeModel {
    vad: AmplitudeVad,
    asr: ScriptedRecognizer,
    aligner: Option<FakeAligner>,
    /// 说话人区分的文件在（`has_diarizer`），但 `diarizer` 可能是 `None`（加载失败）。
    diarizer_installed: bool,
    diarizer: Option<FakeDiarizer>,
    finished: usize,
}

impl FakeModel {
    fn new(texts: &[&'static str]) -> Self {
        Self {
            vad: AmplitudeVad,
            asr: ScriptedRecognizer {
                texts: texts.iter().copied().collect(),
                language_name: Some("English"),
                language_names: VecDeque::new(),
                requests: Vec::new(),
                cancel_on_first_call: None,
            },
            aligner: None,
            diarizer_installed: false,
            diarizer: None,
            finished: 0,
        }
    }

    fn with_diarizer(texts: &[&'static str], script: DiarizerScript) -> Self {
        Self {
            diarizer_installed: true,
            diarizer: Some(FakeDiarizer { script, calls: Vec::new() }),
            ..Self::new(texts)
        }
    }

    fn with_aligner(texts: &[&'static str], aligner: FakeAligner) -> Self {
        Self {
            aligner: Some(aligner),
            ..Self::new(texts)
        }
    }
}

impl LoadedModel for FakeModel {
    fn run_mode(&mut self) -> RunMode<'_> {
        RunMode::Pipeline {
            vad: &mut self.vad,
            recognizer: &mut self.asr,
        }
    }

    fn aligner(&mut self) -> Option<&mut dyn ForcedAlignment> {
        self.aligner.as_mut().map(|aligner| aligner as &mut dyn ForcedAlignment)
    }

    fn has_diarizer(&self) -> bool {
        self.diarizer_installed
    }

    fn diarizer(&mut self) -> Option<&mut dyn SpeakerDiarization> {
        self.diarizer.as_mut().map(|diarizer| diarizer as &mut dyn SpeakerDiarization)
    }

    fn finish_job(&mut self) {
        self.finished += 1;
    }

    fn memory(&self) -> Option<MemorySnapshot> {
        Some(MemorySnapshot {
            active: 1,
            cache: 2,
            peak: 3,
        })
    }

    fn warmup_ms(&self) -> u64 {
        0
    }

    fn resident_bytes(&self) -> Option<u64> {
        None
    }
}

/// 按顺序吐出预设的嵌入向量（用完了就报错）。
struct ScriptedEmbedder {
    vectors: VecDeque<Vec<f32>>,
    calls: Vec<usize>,
}

impl SpeakerEmbedding for ScriptedEmbedder {
    fn embed(&mut self, samples: &[f32]) -> Result<Vec<f32>> {
        self.calls.push(samples.len());
        self.vectors.pop_front().ok_or_else(|| anyhow::anyhow!("no more embeddings"))
    }
}

/// 自己切段的假模型：整段音频进，预设的行出；记下收到的语言，报一次进度。可以带上说话人区间、对齐器与说话人模型
/// （MOSS 的两个可选助手），并数 `finish_job` 的次数。
struct SegmentingModel {
    rows: Vec<RowIn>,
    speaker_ranges: Vec<SpeakerRange>,
    warnings: Vec<String>,
    cancel: bool,
    calls: Vec<(usize, Option<String>)>,
    aligner: Option<FakeAligner>,
    embedder: Option<ScriptedEmbedder>,
    /// 对齐器的文件在（`has_aligner`），但 `aligner` 可能是 `None`（加载失败）。
    aligner_installed: bool,
    finished: usize,
}

impl SegmentingModel {
    fn new(rows: Vec<RowIn>) -> Self {
        Self {
            rows,
            speaker_ranges: Vec::new(),
            warnings: Vec::new(),
            cancel: false,
            calls: Vec::new(),
            aligner: None,
            embedder: None,
            aligner_installed: false,
            finished: 0,
        }
    }
}

impl SegmentingRecognizer for SegmentingModel {
    fn transcribe(
        &mut self,
        audio: &[f32],
        language: Option<&str>,
        callbacks: &mut SegmentingCallbacks<'_>,
    ) -> Result<SegmentedTranscription> {
        self.calls.push((audio.len(), language.map(str::to_owned)));
        let total = audio.len() as f64 / 16_000.0;
        if let Some(progress) = callbacks.on_progress.as_deref_mut() {
            progress(total, total);
        }
        if self.cancel {
            return Err(SegmentingCancelled.into());
        }
        Ok(SegmentedTranscription {
            rows: self.rows.clone(),
            speaker_ranges: self.speaker_ranges.clone(),
            warnings: self.warnings.clone(),
            ..SegmentedTranscription::default()
        })
    }
}

impl LoadedModel for SegmentingModel {
    fn run_mode(&mut self) -> RunMode<'_> {
        RunMode::SelfSegmenting(self)
    }

    fn aligner(&mut self) -> Option<&mut dyn ForcedAlignment> {
        self.aligner.as_mut().map(|aligner| aligner as &mut dyn ForcedAlignment)
    }

    fn has_aligner(&mut self) -> bool {
        self.aligner_installed || self.aligner.is_some()
    }

    fn speaker_embedder(&mut self) -> Option<&mut dyn SpeakerEmbedding> {
        self.embedder.as_mut().map(|embedder| embedder as &mut dyn SpeakerEmbedding)
    }

    fn finish_job(&mut self) {
        self.finished += 1;
    }

    fn memory(&self) -> Option<MemorySnapshot> {
        None
    }

    fn warmup_ms(&self) -> u64 {
        0
    }

    fn resident_bytes(&self) -> Option<u64> {
        None
    }
}

#[derive(Default)]
struct Events {
    events: Vec<(String, Value)>,
    memory: Vec<MemorySnapshot>,
}

impl JobSink for Events {
    fn event(&mut self, name: &str, params: Value) {
        self.events.push((name.to_owned(), params));
    }

    fn memory(&mut self, snapshot: MemorySnapshot) {
        self.memory.push(snapshot);
    }
}

impl Events {
    fn named(&self, name: &str) -> Vec<&Value> {
        self.events
            .iter()
            .filter(|(event, _)| event == name)
            .map(|(_, params)| params)
            .collect()
    }
}

struct Fixture {
    dir: tempfile::TempDir,
    bundle: VerifiedBundle,
}

impl Fixture {
    fn new() -> Self {
        Self::with_families("qwen3-asr", Some("silero-vad"))
    }

    /// `asr` 用 `asr_family`；`vad_family` 为 `None` 时不带 VAD（自己切段的模型）。
    fn with_families(asr_family: &str, vad_family: Option<&str>) -> Self {
        Self::with_components(asr_family, vad_family, false, false)
    }

    /// Qwen3-ASR + Silero VAD + 可选的对齐器组件。
    fn with_aligner() -> Self {
        Self::with_components("qwen3-asr", Some("silero-vad"), true, false)
    }

    /// MOSS + 可选的对齐器与说话人模型。
    fn with_moss_helpers() -> Self {
        Self::with_components("moss-transcribe-diarize", None, true, true)
    }

    /// Qwen3-ASR + Silero VAD + 「说话人区分」模型包的两个组件（Pyannote 分段与 WeSpeaker）。
    fn with_diarization() -> Self {
        Self::build("qwen3-asr", Some("silero-vad"), false, true, true)
    }

    fn with_components(asr_family: &str, vad_family: Option<&str>, aligner: bool, speaker: bool) -> Self {
        Self::build(asr_family, vad_family, aligner, speaker, false)
    }

    fn build(asr_family: &str, vad_family: Option<&str>, aligner: bool, speaker: bool, segmentation: bool) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let models = dir.path().join("models");
        std::fs::create_dir_all(&models).unwrap();
        std::fs::write(models.join("model.safetensors"), b"weights").unwrap();
        let files = json!([{ "path": "model.safetensors", "sha256": "0".repeat(64), "byteLength": 7 }]);
        let mut components = json!({
            "asr": { "family": asr_family, "revision": "asr-rev", "dir": models.to_string_lossy(), "files": files },
        });
        if let Some(family) = vad_family {
            components["vad"] = json!({ "family": family, "revision": "vad-rev", "dir": models.to_string_lossy(), "files": files });
        }
        if aligner {
            components["aligner"] =
                json!({ "family": "qwen3-forced-aligner", "revision": "aligner-rev", "dir": models.to_string_lossy(), "files": files });
        }
        if speaker {
            components["speaker"] =
                json!({ "family": "wespeaker", "revision": "speaker-rev", "dir": models.to_string_lossy(), "files": files });
        }
        if segmentation {
            components["segmentation"] = json!({
                "family": "pyannote-segmentation", "revision": "segmentation-rev", "dir": models.to_string_lossy(), "files": files
            });
        }
        let bundle: ModelBundle = serde_json::from_value(json!({
            "bundleId": "fake@test",
            "backend": "mlx",
            "device": "metal",
            "components": components,
            "threads": 1,
            "memoryBudgetBytes": null,
        }))
        .unwrap();
        let bundle = bundle::verify(&bundle).unwrap();
        Self { dir, bundle }
    }

    /// 16 kHz 单声道 WAV：`(秒数, 幅度)` 依次拼接。
    fn wav(&self, name: &str, parts: &[(f64, f32)]) -> PathBuf {
        let path = self.dir.path().join(name);
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: 16_000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut writer = hound::WavWriter::create(&path, spec).unwrap();
        for &(seconds, level) in parts {
            for _ in 0..(seconds * 16_000.0) as usize {
                writer.write_sample((level * f32::from(i16::MAX)) as i16).unwrap();
            }
        }
        writer.finalize().unwrap();
        path
    }

    fn staging(&self, name: &str) -> PathBuf {
        let path = self.dir.path().join("staging").join(name);
        std::fs::create_dir_all(&path).unwrap();
        path
    }
}

fn params(file: &Path, staging: &Path, options: Value, range: Option<Value>) -> JobRunParams {
    let mut input = json!({ "file": file.to_string_lossy(), "contentHash": "sha256:abc", "track": 0 });
    if let Some(range) = range {
        input["range"] = range;
    }
    serde_json::from_value(json!({
        "jobId": "job-1",
        "runGeneration": 3,
        "capability": "transcribe",
        "input": input,
        "options": options,
        "staging": staging.to_string_lossy(),
        "outputContract": "baocut.asr-result/v1",
    }))
    .unwrap()
}

fn prefer_auto() -> Value {
    json!({ "language": { "mode": "prefer", "tag": null }, "diarize": false, "timescale": 1_000_000 })
}

fn run(fixture: &Fixture, model: &mut FakeModel, params: &JobRunParams, events: &mut Events) -> Result<JobRunResult, ErrorBody> {
    transcribe::run(model, &fixture.bundle, params, &AtomicBool::new(false), events)
}

fn read_result(result: &JobRunResult) -> AsrResult {
    let output = result.output.as_ref().expect("completed jobs have an output");
    let bytes = std::fs::read(&output.path).unwrap();
    assert_eq!(output.sha256, asr_result::sha256_hex(&bytes));
    assert_eq!(output.byte_length, bytes.len() as u64);
    serde_json::from_slice(&bytes).unwrap()
}

/// 两段语音：1–3 秒与 4–5 秒（文件时间）。
const TWO_PHRASES: &[(f64, f32)] = &[(1.0, 0.0), (2.0, 0.9), (1.0, 0.0), (1.0, 0.9), (1.0, 0.0)];

#[test]
fn range_jobs_report_ticks_on_the_asset_clock() {
    let fixture = Fixture::new();
    let wav = fixture.wav("two.wav", TWO_PHRASES);
    let staging = fixture.staging("range");
    let mut model = FakeModel::new(&["Hello there, world.", "Bye now."]);
    let mut events = Events::default();
    let range = json!({ "start": 500, "end": 5_500, "timescale": 1_000 });
    let job = params(&wav, &staging, prefer_auto(), Some(range));
    let result = run(&fixture, &mut model, &job, &mut events).unwrap();
    assert_eq!(result.outcome, JobOutcome::Completed);
    assert!(
        result.stats.speech_seconds > 2.5 && result.stats.speech_seconds < 3.5,
        "{:?}",
        result.stats
    );

    let asr = read_result(&result);
    asr_result::validate(&asr, None).unwrap();
    assert_eq!(asr.outcome, Outcome::Transcribed);
    assert_eq!(asr.duration, 5_500_000);
    assert_eq!((asr.coverage[0].start, asr.coverage[0].end), (500_000, 5_500_000));
    assert_eq!(asr.segments.len(), 2);
    let [first, second] = [&asr.segments[0], &asr.segments[1]];
    assert_eq!((first.id.as_str(), second.id.as_str()), ("seg-0001", "seg-0002"));
    // 语音从素材 1.0 秒开始，补边 0.15 秒；VAD 的块是 32 ms。
    assert!((800_000..=900_000).contains(&first.start), "{}", first.start);
    assert!((3_100_000..=3_250_000).contains(&first.end), "{}", first.end);
    assert!((3_800_000..=3_900_000).contains(&second.start), "{}", second.start);
    assert!(first.end <= second.start);
    assert_eq!(
        first.words.iter().map(|word| word.text.as_str()).collect::<Vec<_>>(),
        ["Hello", "there,", "world."]
    );
    assert!(first.words.iter().all(|word| word.timing_quality == TimingQuality::Estimated));
    assert_eq!((first.words[0].start, first.words[2].end), (first.start, first.end));

    assert_eq!(asr.language.tag.as_deref(), Some("en"));
    assert_eq!(asr.language.source, LanguageSource::Detected);
    assert_eq!(asr.provenance.input_hash, "sha256:abc");
    assert_eq!(asr.provenance.run_generation, 3);
    assert_eq!(asr.provenance.models.asr.as_ref().unwrap().revision, "asr-rev");
    assert!(asr.provenance.models.aligner.is_none());

    // 自动识别：每段都不指定语言，由模型自己判断；任务的语言在第一段定下，只推送一次。
    let languages: Vec<Option<&str>> = model.asr.requests.iter().map(|(_, language, _)| language.as_deref()).collect();
    assert_eq!(languages, [None, None]);
    assert_eq!(
        events.named("job.language"),
        [&json!({ "jobId": "job-1", "tag": "en", "confidence": null })]
    );
    let phases: Vec<&str> = events
        .named("job.phase")
        .iter()
        .map(|params| params["phase"].as_str().unwrap())
        .collect();
    assert_eq!(phases, ["decoding", "vad", "transcribing", "finalizing"]);
    assert_eq!(events.named("job.segment").len(), 2);
    assert_eq!(events.memory.len(), 2);

    // segments.jsonl：头一行，之后与结果相同。
    let lines: Vec<Value> = std::fs::read_to_string(result.segments_file.as_ref().unwrap())
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(
        lines[0],
        json!({ "header": true, "jobId": "job-1", "contentHash": "sha256:abc", "bundleId": "fake@test",
                "workerVersion": model_runtime::WORKER_VERSION, "timescale": 1_000_000 })
    );
    assert_eq!(
        lines[1..],
        [serde_json::to_value(first).unwrap(), serde_json::to_value(second).unwrap()]
    );
}

#[test]
fn empty_recognitions_are_skipped_and_ids_stay_dense() {
    let fixture = Fixture::new();
    let wav = fixture.wav("two.wav", TWO_PHRASES);
    let staging = fixture.staging("skip");
    let mut model = FakeModel::new(&["  ", "Second phrase."]);
    let options = json!({ "language": { "mode": "assert", "tag": "en-US" }, "diarize": true, "hint": "BaoCut", "timescale": 48_000 });
    let mut events = Events::default();
    let result = run(&fixture, &mut model, &params(&wav, &staging, options, None), &mut events).unwrap();
    let asr = read_result(&result);
    asr_result::validate(&asr, Some("en-US")).unwrap();
    assert_eq!(asr.timescale, 48_000);
    assert_eq!(asr.duration, 6 * 48_000);
    assert_eq!(asr.segments.len(), 1);
    assert_eq!(asr.segments[0].id, "seg-0001");
    assert_eq!(asr.segments[0].text, "Second phrase.");
    assert_eq!(asr.language.tag.as_deref(), Some("en-US"));
    assert_eq!(asr.language.source, LanguageSource::Asserted);
    // 断言的语言与提示原样交给识别器。
    assert!(
        model
            .asr
            .requests
            .iter()
            .all(|(_, language, context)| language.as_deref() == Some("en") && context.as_deref() == Some("BaoCut"))
    );
    assert!(events.named("job.language").is_empty());
    assert_eq!(
        asr.warnings.iter().map(|warning| warning.code).collect::<Vec<_>>(),
        [WarningCode::DiarizationUnavailable]
    );
    assert_eq!(events.named("job.warning").len(), 1);
}

/// 说话人区分（§6.6）：识别完成后跑一遍，区间投影到词，段取说话最多的人；id 按在时间上第一次出现编号，一个词都
/// 没分到的说话人排在后面。已经流出去的段不带说话人，`result.json` 才有。
#[test]
fn pipeline_models_diarize_after_recognition_and_label_words() {
    let fixture = Fixture::with_diarization();
    let wav = fixture.wav("two.wav", TWO_PHRASES);
    let staging = fixture.staging("diarize");
    // 两段语音约在 0.85–3.15 秒与 3.85–5.15 秒；第一个说话的人是簇 1，簇 2 只在末尾的静音里出现。
    let script = DiarizerScript::Segments(vec![(0.8, 3.3, 1), (3.8, 5.2, 0), (5.6, 5.9, 2)]);
    let mut model = FakeModel::with_diarizer(&["Hello there, world.", "Bye now."], script);
    let options = json!({ "language": { "mode": "prefer", "tag": null }, "diarize": true, "timescale": 1_000_000 });
    let mut events = Events::default();
    let result = run(&fixture, &mut model, &params(&wav, &staging, options, None), &mut events).unwrap();
    let asr = read_result(&result);
    asr_result::validate(&asr, None).unwrap();
    assert!(asr.warnings.is_empty(), "{:?}", asr.warnings);
    assert_eq!(phases(&events), ["decoding", "vad", "transcribing", "diarizing", "finalizing"]);
    let diarizer = model.diarizer.as_ref().unwrap();
    assert_eq!(diarizer.calls.len(), 1);
    assert_eq!(diarizer.calls[0].0, 6 * 16_000, "the whole decoded audio");
    assert_eq!(diarizer.calls[0].1.max_speakers, None);
    assert_eq!(model.finished, 1);
    assert!(
        events
            .named("job.progress")
            .iter()
            .any(|params| params["phase"] == "diarizing" && params["unit"] == "steps")
    );

    let ids: Vec<&str> = asr.speakers.iter().map(|speaker| speaker.id.as_str()).collect();
    assert_eq!(ids, ["spk-1", "spk-2", "spk-3"]);
    assert!(asr.speakers.iter().all(|speaker| speaker.label.is_none()));
    assert_eq!(asr.segments[0].speaker_id.as_deref(), Some("spk-1"));
    assert_eq!(asr.segments[1].speaker_id.as_deref(), Some("spk-2"));
    for segment in &asr.segments {
        assert!(
            segment.words.iter().all(|word| word.speaker_id == segment.speaker_id),
            "{segment:?}"
        );
    }
    assert_eq!(asr.provenance.models.segmentation.as_ref().unwrap().revision, "segmentation-rev");
    assert_eq!(asr.provenance.models.speaker.as_ref().unwrap().revision, "speaker-rev");

    // 流出去的段（job.segment 与 segments.jsonl）在说话人区分之前，不带说话人。
    for streamed in events.named("job.segment") {
        assert_eq!(streamed["segment"]["speakerId"], Value::Null);
    }
    let lines = std::fs::read_to_string(result.segments_file.as_ref().unwrap()).unwrap();
    assert!(!lines.contains("spk-"), "{lines}");

    // 不要说话人时不跑说话人区分，也不报警告。
    let staging = fixture.staging("no-diarize");
    let mut model = FakeModel::with_diarizer(&["Hello there, world.", "Bye now."], DiarizerScript::Fail);
    let mut events = Events::default();
    let result = run(&fixture, &mut model, &params(&wav, &staging, prefer_auto(), None), &mut events).unwrap();
    let asr = read_result(&result);
    assert!(asr.speakers.is_empty() && asr.warnings.is_empty());
    assert!(asr.provenance.models.segmentation.is_none() && asr.provenance.models.speaker.is_none());
    assert!(model.diarizer.as_ref().unwrap().calls.is_empty());
    assert_eq!(phases(&events), ["decoding", "vad", "transcribing", "finalizing"]);
}

/// 说话人区分出错或加载不了：报 `diarization-unavailable`，保留不带说话人的转录。取消照常是 `cancelled`。
#[test]
fn diarization_failures_keep_the_transcript_and_cancel_stops_the_job() {
    let fixture = Fixture::with_diarization();
    let wav = fixture.wav("two.wav", TWO_PHRASES);
    let options = json!({ "language": { "mode": "prefer", "tag": null }, "diarize": true, "timescale": 1_000_000 });
    for (name, mut model) in [
        (
            "fail",
            FakeModel::with_diarizer(&["Hello there.", "Bye now."], DiarizerScript::Fail),
        ),
        (
            "unloadable",
            FakeModel {
                diarizer_installed: true,
                ..FakeModel::new(&["Hello there.", "Bye now."])
            },
        ),
    ] {
        let staging = fixture.staging(name);
        let mut events = Events::default();
        let result = run(&fixture, &mut model, &params(&wav, &staging, options.clone(), None), &mut events).unwrap();
        let asr = read_result(&result);
        asr_result::validate(&asr, None).unwrap();
        assert_eq!(asr.segments.len(), 2, "{name}");
        assert!(asr.speakers.is_empty(), "{name}");
        assert!(asr.segments.iter().all(|segment| segment.speaker_id.is_none()), "{name}");
        assert_eq!(
            asr.warnings.iter().map(|warning| warning.code).collect::<Vec<_>>(),
            [WarningCode::DiarizationUnavailable],
            "{name}"
        );
        assert!(asr.provenance.models.segmentation.is_none(), "{name}");
    }

    let staging = fixture.staging("cancel");
    let mut model = FakeModel::with_diarizer(&["Hello there.", "Bye now."], DiarizerScript::Cancel);
    let mut events = Events::default();
    let result = run(&fixture, &mut model, &params(&wav, &staging, options, None), &mut events).unwrap();
    assert_eq!(result.outcome, JobOutcome::Cancelled);
    assert!(result.output.is_none());
    assert_eq!(model.finished, 1);
}

/// 没听出话的片段（空文本）上模型照样自报语言（常是英语）：不拿它锁定，等第一段有字的片段再定。
#[test]
fn an_empty_segment_does_not_lock_the_detected_language() {
    let fixture = Fixture::new();
    let wav = fixture.wav("two.wav", TWO_PHRASES);
    let staging = fixture.staging("empty-language");
    let mut model = FakeModel::new(&["", "今天下午我们开会讨论发布计划。"]);
    model.asr.language_names = [Some("English"), Some("Chinese")].into_iter().collect();
    let mut events = Events::default();
    let result = run(&fixture, &mut model, &params(&wav, &staging, prefer_auto(), None), &mut events).unwrap();
    let asr = read_result(&result);
    assert_eq!(asr.language.tag.as_deref(), Some("zh"));
    assert_eq!(asr.language.source, LanguageSource::Detected);
    assert_eq!(asr.language.confidence, None);
    let languages: Vec<Option<&str>> = model.asr.requests.iter().map(|(_, language, _)| language.as_deref()).collect();
    assert_eq!(languages, [None, None], "nothing is locked after the empty segment");
    assert_eq!(
        events.named("job.language"),
        [&json!({ "jobId": "job-1", "tag": "zh", "confidence": null })]
    );
}

/// 自动识别时先定下的语言不强加给之后的段（中英混说的素材）：每段都交给模型自己判断；对齐器与词时间估计用模型在
/// 这一段上自报的语言，报不出时用任务的语言。任务的语言是第一段有字的段上定下的那个。
#[test]
fn later_segments_are_not_forced_into_the_first_detected_language() {
    let fixture = Fixture::with_aligner();
    let wav = fixture.wav(
        "three.wav",
        &[(0.5, 0.0), (1.0, 0.9), (1.0, 0.0), (1.0, 0.9), (1.0, 0.0), (1.0, 0.9), (0.5, 0.0)],
    );
    let staging = fixture.staging("mixed-language");
    let mut model = FakeModel::with_aligner(
        &["Let me show you.", "首先打开设置页面。", "然后点击导出。"],
        FakeAligner::new(AlignerScript::Empty),
    );
    model.asr.language_names = [Some("English"), Some("Chinese"), None].into_iter().collect();
    let mut events = Events::default();
    let result = run(&fixture, &mut model, &params(&wav, &staging, prefer_auto(), None), &mut events).unwrap();
    let asr = read_result(&result);
    asr_result::validate(&asr, None).unwrap();
    let languages: Vec<Option<&str>> = model.asr.requests.iter().map(|(_, language, _)| language.as_deref()).collect();
    assert_eq!(languages, [None, None, None]);
    let aligned: Vec<Option<&str>> = model
        .aligner
        .as_ref()
        .unwrap()
        .calls
        .iter()
        .map(|(_, _, language)| language.as_deref())
        .collect();
    assert_eq!(aligned, [Some("en"), Some("zh"), Some("en")]);
    assert_eq!(asr.language.tag.as_deref(), Some("en"));
    assert_eq!(asr.language.source, LanguageSource::Detected);
    assert_eq!(
        events.named("job.language"),
        [&json!({ "jobId": "job-1", "tag": "en", "confidence": null })]
    );
    assert_eq!(asr.segments.len(), 3);
}

#[test]
fn cancel_takes_effect_at_the_next_segment() {
    let fixture = Fixture::new();
    let wav = fixture.wav("two.wav", TWO_PHRASES);
    let staging = fixture.staging("cancel");
    let mut model = FakeModel::new(&["First.", "Second."]);
    let cancel = Arc::new(AtomicBool::new(false));
    model.asr.cancel_on_first_call = Some(cancel.clone());
    let mut events = Events::default();
    let result = transcribe::run(
        &mut model,
        &fixture.bundle,
        &params(&wav, &staging, prefer_auto(), None),
        &cancel,
        &mut events,
    )
    .unwrap();
    assert_eq!(result.outcome, JobOutcome::Cancelled);
    assert!(result.output.is_none());
    assert!(!staging.join(asr_result::RESULT_FILE).exists());
    // 取消前已经开始的那一段照常完成并写出。
    assert_eq!(model.asr.requests.len(), 1);
    assert_eq!(events.named("job.segment").len(), 1);
    let lines = std::fs::read_to_string(result.segments_file.unwrap()).unwrap();
    assert_eq!(lines.lines().count(), 2);
}

#[test]
fn silence_is_no_speech_and_a_missing_track_is_no_audio_track() {
    let fixture = Fixture::new();
    let wav = fixture.wav("silence.wav", &[(2.0, 0.0)]);

    let staging = fixture.staging("silence");
    let mut model = FakeModel::new(&[]);
    let result = run(
        &fixture,
        &mut model,
        &params(&wav, &staging, prefer_auto(), None),
        &mut Events::default(),
    )
    .unwrap();
    let asr = read_result(&result);
    assert_eq!(asr.outcome, Outcome::NoSpeech);
    assert!(asr.segments.is_empty());
    assert_eq!(asr.duration, 2_000_000);
    assert_eq!((asr.coverage[0].start, asr.coverage[0].end), (0, 2_000_000));
    assert_eq!(asr.language.tag, None);
    assert_eq!(asr.language.source, LanguageSource::Unknown);
    assert!(model.asr.requests.is_empty());

    let staging = fixture.staging("no-track");
    let mut job = params(&wav, &staging, json!({ "language": { "mode": "prefer", "tag": "de" } }), None);
    job.input.track = 1;
    let result = run(&fixture, &mut model, &job, &mut Events::default()).unwrap();
    let asr = read_result(&result);
    assert_eq!(asr.outcome, Outcome::NoAudioTrack);
    assert!(asr.coverage.is_empty());
    assert_eq!(asr.language.tag.as_deref(), Some("de"));
    assert_eq!(asr.language.source, LanguageSource::Unknown);
}

#[test]
fn bad_requests_are_rejected_before_any_work() {
    let fixture = Fixture::new();
    let wav = fixture.wav("two.wav", TWO_PHRASES);
    let staging = fixture.staging("bad");
    let mut model = FakeModel::new(&[]);
    let code = |job: JobRunParams, model: &mut FakeModel| run(&fixture, model, &job, &mut Events::default()).unwrap_err().code;

    let mut job = params(&wav, &staging, prefer_auto(), None);
    job.capability = serde_json::from_value(json!("align")).unwrap();
    assert_eq!(code(job, &mut model), "MODEL_UNSUPPORTED");

    let mut job = params(&wav, &staging, prefer_auto(), None);
    job.output_contract = "baocut.asr-result/v2".into();
    assert_eq!(code(job, &mut model), "INVALID_PARAMS");

    let job = params(&wav, &staging, json!({ "language": { "mode": "assert", "tag": "sw" } }), None);
    assert_eq!(code(job, &mut model), "MODEL_UNSUPPORTED");

    let job = params(
        &wav,
        &staging,
        json!({ "language": { "mode": "assert", "tag": "not a tag" } }),
        None,
    );
    assert_eq!(code(job, &mut model), "INVALID_PARAMS");

    let job = params(
        &wav,
        &staging,
        json!({ "language": { "mode": "prefer", "tag": null }, "hint": "x".repeat(1_201) }),
        None,
    );
    assert_eq!(code(job, &mut model), "INVALID_PARAMS");

    let job = params(
        &wav,
        &staging,
        json!({ "language": { "mode": "prefer", "tag": null }, "surprise": 1 }),
        None,
    );
    assert_eq!(code(job, &mut model), "INVALID_PARAMS");

    let job = params(&wav, &staging, prefer_auto(), Some(json!({ "start": 5, "end": 5, "timescale": 1 })));
    assert_eq!(code(job, &mut model), "INVALID_PARAMS");

    let job = params(&wav, Path::new("relative/staging"), prefer_auto(), None);
    assert_eq!(code(job, &mut model), "INVALID_PARAMS");

    let missing = fixture.dir.path().join("missing.wav");
    let job = params(&missing, &staging, prefer_auto(), None);
    let error = run(&fixture, &mut model, &job, &mut Events::default()).unwrap_err();
    assert_eq!(error.code, "INPUT_UNREADABLE");
    assert!(!error.message.contains(&*missing.to_string_lossy()));
    assert!(model.asr.requests.is_empty());
}

#[test]
fn a_range_past_the_end_is_clamped_with_a_warning() {
    let fixture = Fixture::new();
    let wav = fixture.wav("two.wav", TWO_PHRASES);
    let staging = fixture.staging("clamped");
    let mut model = FakeModel::new(&["Bye now."]);
    let range = json!({ "start": 3_500, "end": 9_000, "timescale": 1_000 });
    let result = run(
        &fixture,
        &mut model,
        &params(&wav, &staging, prefer_auto(), Some(range)),
        &mut Events::default(),
    )
    .unwrap();
    let asr = read_result(&result);
    asr_result::validate(&asr, None).unwrap();
    assert_eq!(asr.duration, 6_000_000);
    assert_eq!((asr.coverage[0].start, asr.coverage[0].end), (3_500_000, 6_000_000));
    assert!(asr.warnings.iter().any(|warning| warning.code == WarningCode::RangeClamped));
    assert_eq!(asr.segments.len(), 1);
    assert!(asr.segments[0].start >= 3_500_000);
}

fn row(start: f64, end: f64, text: &str, speaker: Option<&str>) -> RowIn {
    RowIn {
        speaker: speaker.map(str::to_owned),
        ..RowIn::new(start, end, text)
    }
}

#[test]
fn self_segmenting_models_skip_vad_and_keep_speakers_only_when_asked() {
    let fixture = Fixture::with_families("moss-transcribe-diarize", None);
    let wav = fixture.wav("two.wav", TWO_PHRASES);
    // 乱序、重叠、带一行空文本与一行越界：排序、从中点分开、丢空行、夹到音频长度。
    let rows = vec![
        row(4.0, 5.2, "Habari.", Some("S02")),
        row(0.9, 3.1, "Jambo, rafiki.", Some("S01")),
        row(3.0, 3.5, "  ", Some("S03")),
        row(5.0, 9.0, "Kwaheri.", Some("S01")),
    ];
    // Qwen3-ASR 不认斯瓦希里语，MOSS 认：断言的语言按模型族把关。
    let options = json!({ "language": { "mode": "assert", "tag": "sw" }, "diarize": true, "hint": "BaoCut", "timescale": 1_000 });
    let mut model = SegmentingModel::new(rows.clone());
    model.warnings.push("a chunk ended early".into());
    model.warnings.push("moss-incomplete: 第 2 块未完整转录".into());
    let mut events = Events::default();
    let staging = fixture.staging("diarized");
    let result = transcribe::run(
        &mut model,
        &fixture.bundle,
        &params(&wav, &staging, options.clone(), None),
        &AtomicBool::new(false),
        &mut events,
    )
    .unwrap();
    let asr = read_result(&result);
    asr_result::validate(&asr, Some("sw")).unwrap();
    assert_eq!(
        model.calls,
        [(6 * 16_000, Some("sw".to_owned()))],
        "整段音频一次交出，只送断言的语言"
    );
    let spans: Vec<(u64, u64, &str, Option<&str>)> = asr
        .segments
        .iter()
        .map(|segment| (segment.start, segment.end, segment.text.as_str(), segment.speaker_id.as_deref()))
        .collect();
    assert_eq!(
        spans,
        [
            (900, 3_100, "Jambo, rafiki.", Some("spk-1")),
            (4_000, 5_100, "Habari.", Some("spk-2")),
            (5_100, 6_000, "Kwaheri.", Some("spk-1")),
        ]
    );
    assert_eq!(
        asr.speakers.iter().map(|speaker| speaker.id.as_str()).collect::<Vec<_>>(),
        ["spk-1", "spk-2"]
    );
    // 自己切段的模型带说话人，只有一块时不报 diarization-unavailable；没有提示通道，带了提示报 hint-ignored；
    // 没切完的块报 segment-incomplete，其余的模型警告只进日志。
    assert_eq!(
        asr.warnings.iter().map(|warning| warning.code).collect::<Vec<_>>(),
        [WarningCode::HintIgnored, WarningCode::SegmentIncomplete]
    );
    assert_eq!(asr.warnings[1].detail.as_deref(), Some("第 2 块未完整转录"));
    assert!(asr.provenance.models.vad.is_none());
    assert!(asr.provenance.models.aligner.is_none());
    assert!(asr.provenance.models.speaker.is_none());
    assert_eq!(model.finished, 1, "任务结束时放下助手模型");
    let phases: Vec<&str> = events
        .named("job.phase")
        .iter()
        .map(|params| params["phase"].as_str().unwrap())
        .collect();
    assert_eq!(phases, ["decoding", "transcribing", "finalizing"]);
    assert_eq!(events.named("job.segment").len(), 3);
    assert!(
        events
            .named("job.progress")
            .iter()
            .any(|params| params["phase"] == "transcribing" && params["unit"] == "seconds")
    );

    // 不要说话人：标签丢掉。
    let mut options = options;
    options["diarize"] = json!(false);
    let mut model = SegmentingModel::new(rows);
    let staging = fixture.staging("plain");
    let result = transcribe::run(
        &mut model,
        &fixture.bundle,
        &params(&wav, &staging, options, None),
        &AtomicBool::new(false),
        &mut Events::default(),
    )
    .unwrap();
    let asr = read_result(&result);
    assert_eq!(asr.segments.len(), 3);
    assert!(asr.speakers.is_empty());
    assert!(asr.segments.iter().all(|segment| segment.speaker_id.is_none()));

    // 自动识别：不送语言；模型的取消错误是取消，不是失败。
    let mut model = SegmentingModel::new(Vec::new());
    model.cancel = true;
    let staging = fixture.staging("cancelled");
    let result = transcribe::run(
        &mut model,
        &fixture.bundle,
        &params(&wav, &staging, prefer_auto(), None),
        &AtomicBool::new(false),
        &mut Events::default(),
    )
    .unwrap();
    assert_eq!(result.outcome, JobOutcome::Cancelled);
    assert_eq!(model.calls, [(6 * 16_000, None)]);
    assert!(!staging.join(asr_result::RESULT_FILE).exists());
}

/// 两块各一个说话人（块内标签都是 `S01`）：MOSS 的行与说话人区间。第一行长于 5 秒且没有词时间。
fn two_chunk_rows() -> (Vec<RowIn>, Vec<SpeakerRange>) {
    let rows = vec![
        row(0.0, 5.2, "Hello world.", Some("S01")),
        row(
            5.2,
            6.0,
            "This is the second speaker, and we are talking about the weather.",
            Some("S01"),
        ),
    ];
    let ranges = vec![
        SpeakerRange {
            start: 0.0,
            end: 5.2,
            cluster: 0,
            chunk: 0,
        },
        SpeakerRange {
            start: 5.2,
            end: 6.0,
            cluster: 1,
            chunk: 1,
        },
    ];
    (rows, ranges)
}

#[test]
fn self_segmenting_models_merge_speakers_across_chunks_and_align_long_rows() {
    let fixture = Fixture::with_moss_helpers();
    let wav = fixture.wav("two.wav", TWO_PHRASES);
    let options = json!({ "language": { "mode": "prefer", "tag": null }, "diarize": true });
    let (rows, ranges) = two_chunk_rows();

    // 两块的嵌入正交：块内同名的 S01 其实是两个人。
    let mut model = SegmentingModel::new(rows.clone());
    model.speaker_ranges = ranges.clone();
    model.aligner = Some(FakeAligner::hello_world());
    model.embedder = Some(ScriptedEmbedder {
        vectors: VecDeque::from([vec![1.0, 0.0], vec![0.0, 1.0]]),
        calls: Vec::new(),
    });
    let mut events = Events::default();
    let staging = fixture.staging("merged");
    let result = transcribe::run(
        &mut model,
        &fixture.bundle,
        &params(&wav, &staging, options.clone(), None),
        &AtomicBool::new(false),
        &mut events,
    )
    .unwrap();
    let asr = read_result(&result);
    asr_result::validate(&asr, None).unwrap();
    assert_eq!(phases(&events), ["decoding", "transcribing", "diarizing", "aligning", "finalizing"]);
    assert_eq!(
        model.embedder.as_ref().unwrap().calls,
        [(5.2 * 16_000.0) as usize, (0.8 * 16_000.0) as usize]
    );
    assert_eq!(
        asr.segments.iter().map(|segment| segment.speaker_id.as_deref()).collect::<Vec<_>>(),
        [Some("spk-1"), Some("spk-2")]
    );
    assert_eq!(asr.speakers.len(), 2);
    // 没断言语言时按全文猜一次，作为结果的语言并推送一次 `job.language`。
    assert_eq!(asr.language.tag.as_deref(), Some("en"));
    assert_eq!(asr.language.source, LanguageSource::Detected);
    assert_eq!(events.named("job.language").len(), 1);
    // 只有长于 5 秒、没有词时间的行送去对齐；没断言语言时按全文猜。
    let aligner = model.aligner.as_ref().unwrap();
    assert_eq!(aligner.calls.len(), 1);
    assert_eq!(aligner.calls[0].1, "Hello world.");
    assert_eq!(aligner.calls[0].2.as_deref(), Some("en"));
    assert!(
        asr.segments[0]
            .words
            .iter()
            .all(|word| word.timing_quality == TimingQuality::Aligned)
    );
    assert!(
        asr.segments[1]
            .words
            .iter()
            .all(|word| word.timing_quality != TimingQuality::Aligned)
    );
    assert!(asr.warnings.is_empty(), "{:?}", asr.warnings);
    assert!(asr.provenance.models.aligner.is_some());
    assert!(asr.provenance.models.speaker.is_some());
    assert!(
        events
            .named("job.progress")
            .iter()
            .any(|params| params["phase"] == "aligning" && params["unit"] == "segments")
    );
    assert_eq!(model.finished, 1);

    // 嵌入相同：合并成一个人。
    let mut model = SegmentingModel::new(rows.clone());
    model.speaker_ranges = ranges.clone();
    model.aligner_installed = true;
    model.embedder = Some(ScriptedEmbedder {
        vectors: VecDeque::from([vec![1.0, 0.0], vec![1.0, 0.0]]),
        calls: Vec::new(),
    });
    let staging = fixture.staging("same");
    let result = transcribe::run(
        &mut model,
        &fixture.bundle,
        &params(&wav, &staging, options.clone(), None),
        &AtomicBool::new(false),
        &mut Events::default(),
    )
    .unwrap();
    let asr = read_result(&result);
    assert_eq!(
        asr.segments.iter().map(|segment| segment.speaker_id.as_deref()).collect::<Vec<_>>(),
        [Some("spk-1"), Some("spk-1")]
    );
    // 对齐器文件在、但没加载起来：一条 alignment-failed，词时间估计，provenance 不写对齐器。
    assert_eq!(
        asr.warnings.iter().map(|warning| warning.code).collect::<Vec<_>>(),
        [WarningCode::AlignmentFailed]
    );
    assert!(asr.warnings[0].segment_id.is_none());
    assert!(asr.provenance.models.aligner.is_none());
}

#[test]
fn self_segmenting_models_keep_chunk_labels_with_a_warning_when_speakers_cannot_merge() {
    let fixture = Fixture::with_moss_helpers();
    let wav = fixture.wav("two.wav", TWO_PHRASES);
    let options = json!({ "language": { "mode": "assert", "tag": "en" }, "diarize": true });
    let (rows, ranges) = two_chunk_rows();

    // 说话人模型加载不了，对齐器对唯一的长行失败。
    let mut model = SegmentingModel::new(rows);
    model.speaker_ranges = ranges;
    model.aligner = Some(FakeAligner::new(AlignerScript::Fail));
    let staging = fixture.staging("unmerged");
    let result = transcribe::run(
        &mut model,
        &fixture.bundle,
        &params(&wav, &staging, options, None),
        &AtomicBool::new(false),
        &mut Events::default(),
    )
    .unwrap();
    let asr = read_result(&result);
    asr_result::validate(&asr, Some("en")).unwrap();
    assert_eq!(model.aligner.as_ref().unwrap().calls[0].2.as_deref(), Some("en"));
    assert_eq!(
        asr.segments.iter().map(|segment| segment.speaker_id.as_deref()).collect::<Vec<_>>(),
        [Some("spk-1"), Some("spk-1")]
    );
    let warnings: Vec<_> = asr
        .warnings
        .iter()
        .map(|warning| (warning.code, warning.segment_id.as_deref()))
        .collect();
    assert_eq!(
        warnings,
        [
            (WarningCode::DiarizationUnavailable, None),
            (WarningCode::AlignmentFailed, Some(asr.segments[0].id.as_str())),
        ]
    );
    assert!(asr.provenance.models.speaker.is_none());
    assert!(
        asr.segments[0]
            .words
            .iter()
            .all(|word| word.timing_quality != TimingQuality::Aligned)
    );
    assert_eq!(model.finished, 1);
}

fn phases(events: &Events) -> Vec<&str> {
    events
        .named("job.phase")
        .iter()
        .map(|params| params["phase"].as_str().unwrap())
        .collect()
}

fn align_params(file: &Path, staging: &Path, language: &str, text: &str, range: Option<Value>) -> JobRunParams {
    let options = json!({ "language": { "mode": "assert", "tag": language }, "text": text, "timescale": 1_000_000 });
    let mut job = params(file, staging, options, range);
    job.capability = serde_json::from_value(json!("align")).unwrap();
    job
}

#[test]
fn aligned_words_are_absolute_strictly_increasing_and_name_the_aligner() {
    let fixture = Fixture::with_aligner();
    let wav = fixture.wav("two.wav", TWO_PHRASES);
    let staging = fixture.staging("aligned");
    let mut model = FakeModel::with_aligner(&["hello world", "hello world"], FakeAligner::hello_world());
    let mut events = Events::default();
    let range = json!({ "start": 500, "end": 5_500, "timescale": 1_000 });
    let job = params(&wav, &staging, prefer_auto(), Some(range));
    let result = run(&fixture, &mut model, &job, &mut events).unwrap();
    let asr = read_result(&result);
    asr_result::validate(&asr, None).unwrap();
    assert_eq!(asr.segments.len(), 2);
    for segment in &asr.segments {
        assert_eq!(
            segment.words.iter().map(|word| word.text.as_str()).collect::<Vec<_>>(),
            ["hello", "world"]
        );
        assert!(segment.words.iter().all(|word| word.timing_quality == TimingQuality::Aligned));
        // 对齐器的时间相对识别区间（补过边）的起点；换到素材时间后第一个词正好落在段首。
        assert_eq!(segment.words[0].start, segment.start);
        let second = segment.words[1].start - segment.start;
        assert!((119_000..=121_000).contains(&second), "{second}");
        assert!(segment.words[0].end <= segment.words[1].start);
        assert!(segment.words[1].end <= segment.end);
    }
    assert!(asr.warnings.is_empty(), "{:?}", asr.warnings);
    let aligner = asr.provenance.models.aligner.as_ref().expect("the aligner is named in provenance");
    assert_eq!(
        (aligner.family.as_str(), aligner.revision.as_str()),
        ("qwen3-forced-aligner", "aligner-rev")
    );
    // 每段一次，收到与识别器相同的音频、识别出的文本与模型在这一段上自报的语言。
    let calls = &model.aligner.as_ref().unwrap().calls;
    assert_eq!(calls.len(), 2);
    for ((samples, text, language), (asr_samples, _, _)) in calls.iter().zip(&model.asr.requests) {
        assert_eq!(
            (samples, text.as_str(), language.as_deref()),
            (asr_samples, "hello world", Some("en"))
        );
    }
    assert_eq!(phases(&events), ["decoding", "vad", "transcribing", "finalizing"]);
}

#[test]
fn alignment_failures_fall_back_to_estimated_words_with_a_warning() {
    for script in [AlignerScript::Fail, AlignerScript::Empty] {
        let fixture = Fixture::with_aligner();
        let wav = fixture.wav("two.wav", TWO_PHRASES);
        let staging = fixture.staging("fallback");
        let mut model = FakeModel::with_aligner(&["Hello there, world.", "Bye now."], FakeAligner::new(script));
        let mut events = Events::default();
        let result = run(&fixture, &mut model, &params(&wav, &staging, prefer_auto(), None), &mut events).unwrap();
        let asr = read_result(&result);
        asr_result::validate(&asr, None).unwrap();
        assert_eq!(asr.segments.len(), 2);
        assert!(
            asr.segments
                .iter()
                .flat_map(|segment| &segment.words)
                .all(|word| word.timing_quality == TimingQuality::Estimated)
        );
        let warnings: Vec<_> = asr
            .warnings
            .iter()
            .map(|warning| (warning.code, warning.segment_id.as_deref()))
            .collect();
        assert_eq!(
            warnings,
            [
                (WarningCode::AlignmentFailed, Some("seg-0001")),
                (WarningCode::AlignmentFailed, Some("seg-0002"))
            ]
        );
        assert_eq!(events.named("job.warning").len(), 2);
    }
}

#[test]
fn align_segments_known_text_by_pauses_and_sentence_ends() {
    let fixture = Fixture::with_aligner();
    let wav = fixture.wav("two.wav", TWO_PHRASES);
    let staging = fixture.staging("align");
    // 解码从素材 0.5 秒开始：对齐器的时间相对解码起点。
    let words = vec![
        ("Hello", 0.5, 0.9),
        ("there.", 1.0, 1.5),
        ("Bye", 3.5, 3.9),
        ("now", 4.0, 4.3),
        ("then", 5.4, 5.6),
    ];
    let mut model = FakeModel::with_aligner(&[], FakeAligner::new(AlignerScript::Words(words)));
    let mut events = Events::default();
    let range = json!({ "start": 500, "end": 5_500, "timescale": 1_000 });
    let job = align_params(&wav, &staging, "en", "Hello there. Bye now then", Some(range));
    let result = run(&fixture, &mut model, &job, &mut events).unwrap();
    assert_eq!(result.stats.vad_ms, 0);
    let asr = read_result(&result);
    asr_result::validate(&asr, Some("en")).unwrap();
    assert_eq!(asr.outcome, Outcome::Transcribed);
    // 句末标点另起一段；落在解码出来的音频之外的词丢掉。
    assert_eq!(
        asr.segments.iter().map(|segment| segment.text.as_str()).collect::<Vec<_>>(),
        ["Hello there.", "Bye now"]
    );
    assert_eq!((asr.segments[0].start, asr.segments[0].end), (1_000_000, 2_000_000));
    assert_eq!((asr.segments[1].start, asr.segments[1].end), (4_000_000, 4_800_000));
    assert!(
        asr.segments
            .iter()
            .flat_map(|segment| &segment.words)
            .all(|word| word.timing_quality == TimingQuality::Aligned)
    );
    assert_eq!(asr.language.source, LanguageSource::Asserted);
    assert!(asr.provenance.models.aligner.is_some());
    assert!(model.asr.requests.is_empty(), "align does not run the recognizer");
    let calls = &model.aligner.as_ref().unwrap().calls;
    assert_eq!(calls.len(), 1);
    assert_eq!(
        (calls[0].0, calls[0].1.as_str(), calls[0].2.as_deref()),
        (5 * 16_000, "Hello there. Bye now then", Some("en"))
    );
    assert_eq!(phases(&events), ["decoding", "aligning", "finalizing"]);
    assert_eq!(events.named("job.segment").len(), 2);

    // 停顿超过 0.8 秒另起一段；中日文之间不加空格。
    let staging = fixture.staging("align-zh");
    let words = vec![("你", 0.1, 0.2), ("好，", 0.2, 0.4), ("世", 1.5, 1.6), ("界", 1.6, 1.6)];
    let mut model = FakeModel::with_aligner(&[], FakeAligner::new(AlignerScript::Words(words)));
    let job = align_params(&wav, &staging, "zh", "你好，世界", None);
    let asr = read_result(&run(&fixture, &mut model, &job, &mut Events::default()).unwrap());
    asr_result::validate(&asr, Some("zh")).unwrap();
    assert_eq!(
        asr.segments.iter().map(|segment| segment.text.as_str()).collect::<Vec<_>>(),
        ["你好，", "世界"]
    );
}

#[test]
fn align_requests_are_checked_before_any_work() {
    let fixture = Fixture::with_aligner();
    let wav = fixture.wav("two.wav", TWO_PHRASES);
    let staging = fixture.staging("align-bad");
    let mut model = FakeModel::with_aligner(&[], FakeAligner::hello_world());
    let code = |job: JobRunParams, model: &mut FakeModel| run(&fixture, model, &job, &mut Events::default()).unwrap_err().code;

    let mut job = align_params(&wav, &staging, "en", "text", None);
    job.options = json!({ "language": { "mode": "prefer", "tag": "en" }, "text": "text", "timescale": 1_000_000 });
    assert_eq!(code(job, &mut model), "INVALID_PARAMS");
    assert_eq!(code(align_params(&wav, &staging, "en", "  ", None), &mut model), "INVALID_PARAMS");
    assert_eq!(
        code(align_params(&wav, &staging, "sw", "text", None), &mut model),
        "MODEL_UNSUPPORTED"
    );
    let mut job = align_params(&wav, &staging, "en", "text", None);
    job.options["diarize"] = json!(false);
    assert_eq!(code(job, &mut model), "INVALID_PARAMS");
    assert!(model.aligner.as_ref().unwrap().calls.is_empty());

    // 模型包没有对齐器：MODEL_UNSUPPORTED，原因是 aligner-not-loaded。
    let mut model = FakeModel::new(&[]);
    let job = align_params(&wav, &staging, "en", "text", None);
    let error = run(&fixture, &mut model, &job, &mut Events::default()).unwrap_err();
    assert_eq!(error.code, "MODEL_UNSUPPORTED");
    assert_eq!(error.details.unwrap()["reason"], "aligner-not-loaded");
}
