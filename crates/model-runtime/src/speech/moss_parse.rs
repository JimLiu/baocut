//! MOSS 输出 `[start][Sxx]text[end]` 的增量解析、生成预算与结果适配。移植自 v2 `bcut-speech-core`。

use super::{LiveSegment, RowIn};

#[derive(Debug, Clone, PartialEq)]
pub struct MossOutputSegment {
    pub start: f64,
    pub end: f64,
    pub speaker: String,
    pub text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum State {
    SeekStart,
    ReadStart,
    ExpectSpeakerOpen,
    ReadSpeaker,
    ReadText,
    ReadEnd,
    AfterEnd,
}

/// `[start][Sxx]text[end]` 增量解析器。
pub struct MossOutputParser {
    state: State,
    token: String,
    text: String,
    pending_after_end: String,
    start: Option<f64>,
    end: Option<f64>,
    end_token: String,
    speaker: Option<String>,
}

impl Default for MossOutputParser {
    fn default() -> Self {
        Self {
            state: State::SeekStart,
            token: String::new(),
            text: String::new(),
            pending_after_end: String::new(),
            start: None,
            end: None,
            end_token: String::new(),
            speaker: None,
        }
    }
}

impl MossOutputParser {
    pub fn feed(&mut self, chunk: &str) -> Vec<MossOutputSegment> {
        let mut segments = Vec::new();
        for character in chunk.chars() {
            match self.state {
                State::SeekStart => self.seek_start(character),
                State::ReadStart => self.read_start(character),
                State::ExpectSpeakerOpen => self.expect_speaker_open(character),
                State::ReadSpeaker => self.read_speaker(character),
                State::ReadText => self.read_text(character),
                State::ReadEnd => self.read_end(character),
                State::AfterEnd => self.after_end(character, &mut segments),
            }
        }
        segments
    }

    pub fn close(&mut self) -> Vec<MossOutputSegment> {
        let segment = (self.state == State::AfterEnd).then(|| self.completed_segment()).flatten();
        self.reset(None);
        segment.into_iter().collect()
    }

    pub fn parse(output: &str) -> Vec<MossOutputSegment> {
        let mut parser = Self::default();
        let mut segments = parser.feed(output);
        segments.extend(parser.close());
        segments
    }

    fn seek_start(&mut self, character: char) {
        if character == '[' {
            self.token.clear();
            self.state = State::ReadStart;
        }
    }

    fn read_start(&mut self, character: char) {
        if character == ']' {
            if let Some(value) = timestamp(&self.token) {
                self.start = Some(value);
                self.token.clear();
                self.state = State::ExpectSpeakerOpen;
            } else {
                self.reset(None);
            }
        } else if is_timestamp_character(character) && self.token.len() < 32 {
            self.token.push(character);
        } else {
            self.reset(Some(character));
        }
    }

    fn expect_speaker_open(&mut self, character: char) {
        if character == '[' {
            self.token.clear();
            self.state = State::ReadSpeaker;
        } else if !character.is_whitespace() {
            self.reset(Some(character));
        }
    }

    fn read_speaker(&mut self, character: char) {
        if character == ']' {
            let valid =
                self.token.len() >= 2 && self.token.starts_with('S') && self.token[1..].chars().all(|character| character.is_numeric());
            if valid {
                self.speaker = Some(std::mem::take(&mut self.token));
                self.text.clear();
                self.state = State::ReadText;
            } else {
                self.reset(None);
            }
        } else if (character == 'S' || character.is_numeric()) && self.token.len() < 16 {
            self.token.push(character);
        } else if is_timestamp_character(character)
            && self
                .token
                .chars()
                .all(|candidate| candidate.is_numeric() || matches!(candidate, '.' | ','))
            && self.token.len() < 32
        {
            self.token.push(character);
            self.clear_segment();
            self.state = State::ReadStart;
        } else {
            self.reset(Some(character));
        }
    }

    fn read_text(&mut self, character: char) {
        if character == '[' {
            self.token.clear();
            self.state = State::ReadEnd;
        } else {
            self.text.push(character);
        }
    }

    fn read_end(&mut self, character: char) {
        if character == ']' {
            if let (Some(value), Some(start)) = (timestamp(&self.token), self.start)
                && value >= start
            {
                self.end = Some(value);
                self.end_token = std::mem::take(&mut self.token);
                self.pending_after_end.clear();
                self.state = State::AfterEnd;
                return;
            }
            self.text.push('[');
            self.text.push_str(&self.token);
            self.text.push(']');
            self.token.clear();
            self.state = State::ReadText;
        } else if is_timestamp_character(character) && self.token.len() < 32 {
            self.token.push(character);
        } else {
            self.text.push('[');
            self.text.push_str(&self.token);
            self.text.push(character);
            self.token.clear();
            self.state = State::ReadText;
        }
    }

    fn after_end(&mut self, character: char, segments: &mut Vec<MossOutputSegment>) {
        if character == '[' {
            if let Some(segment) = self.completed_segment() {
                segments.push(segment);
            }
            self.clear_segment();
            self.token.clear();
            self.state = State::ReadStart;
        } else if character.is_whitespace() {
            self.pending_after_end.push(character);
        } else {
            self.text.push('[');
            self.text.push_str(&self.end_token);
            self.text.push(']');
            self.text.push_str(&self.pending_after_end);
            self.text.push(character);
            self.pending_after_end.clear();
            self.end = None;
            self.end_token.clear();
            self.state = State::ReadText;
        }
    }

    fn completed_segment(&self) -> Option<MossOutputSegment> {
        let text = self.text.trim();
        if text.is_empty() {
            return None;
        }
        Some(MossOutputSegment {
            start: self.start?,
            end: self.end?,
            speaker: self.speaker.clone()?,
            text: text.to_string(),
        })
    }

    fn reset(&mut self, restarting_at: Option<char>) {
        self.state = State::SeekStart;
        self.token.clear();
        self.clear_segment();
        if restarting_at == Some('[') {
            self.state = State::ReadStart;
        }
    }

    fn clear_segment(&mut self) {
        self.text.clear();
        self.pending_after_end.clear();
        self.start = None;
        self.end = None;
        self.end_token.clear();
        self.speaker = None;
    }
}

fn timestamp(raw: &str) -> Option<f64> {
    if raw.is_empty() {
        return None;
    }
    let normalized = raw.replace(',', ".");
    if normalized.chars().filter(|character| *character == '.').count() > 1
        || !normalized.chars().any(|character| character.is_numeric())
        || !normalized.chars().all(|character| character.is_numeric() || character == '.')
    {
        return None;
    }
    normalized.parse().ok()
}

fn is_timestamp_character(character: char) -> bool {
    character.is_numeric() || matches!(character, '.' | ',')
}

/// 字节流增量解码器：按任意切点接收解码字节，只把合法 UTF-8 前缀喂给
/// [`MossOutputParser`]，不完整的多字节序列留到下一批。
///
/// 替换语义与 `String::from_utf8_lossy` 一致：真正非法的序列换成一个
/// `U+FFFD`，因此任意切分下的产出都等于对整段字节做一次性 lossy 解码再解析。
#[derive(Default)]
pub struct MossStreamDecoder {
    parser: MossOutputParser,
    pending: Vec<u8>,
}

impl MossStreamDecoder {
    pub fn push(&mut self, bytes: &[u8]) -> Vec<MossOutputSegment> {
        self.pending.extend_from_slice(bytes);
        let mut segments = Vec::new();
        loop {
            match std::str::from_utf8(&self.pending) {
                Ok(text) => {
                    if !text.is_empty() {
                        segments.extend(self.parser.feed(text));
                    }
                    self.pending.clear();
                    break;
                }
                Err(error) => {
                    let valid = error.valid_up_to();
                    if valid > 0 {
                        let text = std::str::from_utf8(&self.pending[..valid]).unwrap_or_default();
                        segments.extend(self.parser.feed(text));
                    }
                    match error.error_len() {
                        Some(invalid) => {
                            segments.extend(self.parser.feed("\u{FFFD}"));
                            self.pending.drain(..valid + invalid);
                        }
                        // 尾部只是被切断的合法序列，等下一批字节。
                        None => {
                            self.pending.drain(..valid);
                            break;
                        }
                    }
                }
            }
        }
        segments
    }

    pub fn finish(&mut self) -> Vec<MossOutputSegment> {
        let mut segments = Vec::new();
        if !self.pending.is_empty() {
            let text = String::from_utf8_lossy(&self.pending).into_owned();
            segments.extend(self.parser.feed(&text));
            self.pending.clear();
        }
        segments.extend(self.parser.close());
        segments
    }
}

pub fn preview_segment(segment: &MossOutputSegment) -> (LiveSegment, bool) {
    let suppressed = segment.text.contains('\u{FFFD}');
    (
        LiveSegment {
            start: segment.start,
            end: segment.end,
            text: if suppressed { String::new() } else { segment.text.clone() },
        },
        suppressed,
    )
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MossGenerationPlan {
    pub max_tokens: usize,
    pub chunk_duration: f64,
}

impl MossGenerationPlan {
    /// 产品默认分块时长。1800 s 的超长上下文会让 MOSS 把非中文音频翻译成中文输出
    /// （语言漂移），且解码速度随上下文膨胀显著下降；300 s 同时修掉这两个问题。
    pub const CHUNK_DURATION: f64 = 300.0;
    pub const MIN_CHUNK_DURATION: f64 = 60.0;
    /// 实验旋钮的上界：仍允许手工拉到 1800 s 复现长上下文行为。
    pub const MAX_CHUNK_DURATION: f64 = 1_800.0;
    pub const MIN_TOKENS: usize = 5_120;
    pub const MAX_TOKENS: usize = 65_536;
    pub const TOKENS_PER_SECOND: f64 = 32.0;

    pub fn make(audio_duration: f64) -> Self {
        Self::make_with_chunk_duration(audio_duration, Self::CHUNK_DURATION)
    }

    /// 实验旋钮入口：用给定分块时长驱动同一套 token 预算逻辑，时长先按合法区间收敛。
    pub fn make_with_chunk_duration(audio_duration: f64, chunk_duration: f64) -> Self {
        let chunk_duration = Self::clamp_chunk_duration(chunk_duration);
        let finite = if audio_duration.is_finite() { audio_duration.max(0.0) } else { 0.0 };
        let per_chunk = finite.min(chunk_duration);
        let estimated = (per_chunk * Self::TOKENS_PER_SECOND).ceil() as usize;
        Self {
            max_tokens: estimated.clamp(Self::MIN_TOKENS, Self::MAX_TOKENS),
            chunk_duration,
        }
    }

    pub fn clamp_chunk_duration(chunk_duration: f64) -> f64 {
        if chunk_duration.is_finite() {
            chunk_duration.clamp(Self::MIN_CHUNK_DURATION, Self::MAX_CHUNK_DURATION)
        } else {
            Self::CHUNK_DURATION
        }
    }

    /// 解析 `BCUT_MOSS_CHUNK_SECONDS` 的原始取值；缺省或非法时回落到默认分块时长。
    pub fn chunk_duration_from_env(raw: Option<&str>) -> f64 {
        raw.and_then(|value| value.trim().parse::<f64>().ok())
            .filter(|value| value.is_finite())
            .map_or(Self::CHUNK_DURATION, Self::clamp_chunk_duration)
    }

    pub fn stopped_at_token_limit(self, generation_tokens: usize, last_segment_end: f64, audio_duration: f64) -> bool {
        audio_duration <= self.chunk_duration && generation_tokens >= self.max_tokens && last_segment_end < audio_duration - 5.0
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct SpeakerRange {
    pub start: f64,
    pub end: f64,
    pub cluster: usize,
    /// 该区间所属的全局 chunk 序号；`adapt_output` 只产出单 chunk 结果，
    /// 统一填 0，由 host 侧的分块拼接循环回填真实序号。
    pub chunk: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MossTranscriptionOutcome {
    pub rows: Vec<RowIn>,
    pub speaker_ranges: Vec<SpeakerRange>,
}

pub fn adapt_output(segments: &[MossOutputSegment], duration: f64, identify: bool) -> MossTranscriptionOutcome {
    use std::collections::HashMap;

    let mut rows = Vec::new();
    let mut speaker_ranges = Vec::new();
    let mut clusters: HashMap<String, usize> = HashMap::new();
    for segment in segments {
        let start = segment.start.clamp(0.0, duration);
        let end = segment.end.max(start).min(duration);
        let text = segment.text.trim();
        if end <= start || text.is_empty() {
            continue;
        }
        let mut row = RowIn::new(start, end, text);
        row.speaker = identify.then(|| segment.speaker.clone());
        rows.push(row);
        if identify {
            let chunk = (start / MossGenerationPlan::CHUNK_DURATION) as usize;
            let key = format!("{chunk}:{}", segment.speaker);
            let next_cluster = clusters.len();
            let cluster = *clusters.entry(key).or_insert(next_cluster);
            speaker_ranges.push(SpeakerRange {
                start,
                end,
                cluster,
                chunk: 0,
            });
        }
    }
    MossTranscriptionOutcome { rows, speaker_ranges }
}

pub fn moss_quantization_bits(environment: &std::collections::HashMap<String, String>, preference: &str) -> Option<usize> {
    if let Some(bits) = environment
        .get("BCUT_MOSS_QUANT")
        .or_else(|| environment.get("BAOCUT_MOSS_QUANT"))
        .and_then(|raw| raw.parse::<usize>().ok())
        .filter(|bits| matches!(bits, 4 | 8))
    {
        return Some(bits);
    }
    (preference == "speed").then_some(8)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn moss_stream_decoder_matches_whole_stream_parse_at_any_split() {
        // 同时覆盖被切断的多字节字符与真正非法的字节（0xFF）。
        let mut bytes = "[0.00][S01]你好世界[1.00][1.00][S02]".as_bytes().to_vec();
        bytes.push(0xFF);
        bytes.extend_from_slice("坏字[2.00][2.00][S01]tail[3.00]".as_bytes());

        let expected = MossOutputParser::parse(&String::from_utf8_lossy(&bytes));
        assert_eq!(expected.len(), 3);
        assert_eq!(expected[0].text, "你好世界");
        assert!(expected[1].text.contains('\u{FFFD}'));
        assert!(preview_segment(&expected[1]).1);

        for step in [1_usize, 2, 3, 5, 7, 16, bytes.len()] {
            let mut decoder = MossStreamDecoder::default();
            let mut segments = Vec::new();
            for slice in bytes.chunks(step) {
                segments.extend(decoder.push(slice));
            }
            segments.extend(decoder.finish());
            assert_eq!(segments, expected, "分批长度 {step}");
        }
    }

    #[test]
    fn moss_parser_generation_plan_and_adapter_match_reference() {
        let mut parser = MossOutputParser::default();
        assert!(parser.feed("noise[0.48][S01]hel").is_empty());
        assert_eq!(
            parser.feed("lo [aside][1.66][2.00]"),
            vec![MossOutputSegment {
                start: 0.48,
                end: 1.66,
                speaker: "S01".to_string(),
                text: "hello [aside]".to_string(),
            }]
        );
        assert!(parser.feed("[S02]世界[3,50]").is_empty());
        assert_eq!(parser.close()[0].text, "世界");

        let malformed = "[bad][S01]x[1.0][1.0][Sx]bad[2.0]\
            [2.0][S02]   [3.0][3.0][S03]kept[4.0]";
        assert_eq!(MossOutputParser::parse(malformed)[0].text, "kept");
        assert_eq!(MossGenerationPlan::make(300.0).max_tokens, 9_600);
        assert_eq!(MossGenerationPlan::make(f64::INFINITY).max_tokens, 5_120);
        // token 上限判据只对「整段音频装得进一个分块」的情形成立；默认分块 300 s 之后
        // 1_338 s 的整片时长不再满足该前提，判据改由块级时长驱动。
        let plan = MossGenerationPlan::make(280.0);
        assert!(plan.stopped_at_token_limit(plan.max_tokens, 152.11, 280.0));
        assert!(!MossGenerationPlan::make(1_338.42).stopped_at_token_limit(MossGenerationPlan::MAX_TOKENS, 152.11, 1_338.42));

        // 产品默认分块 300 s；旋钮上界 1800 s 与默认值必须是两个不同的常量。
        assert_eq!(MossGenerationPlan::CHUNK_DURATION, 300.0);
        assert_eq!(MossGenerationPlan::MAX_CHUNK_DURATION, 1_800.0);
        assert_eq!(MossGenerationPlan::make(1_800.0).chunk_duration, 300.0);

        // 分块时长旋钮：缺省与非法取值回落到默认 300，合法取值同时收敛分块与 token 预算。
        for raw in [None, Some("abc"), Some(""), Some("nan"), Some("inf")] {
            assert_eq!(MossGenerationPlan::chunk_duration_from_env(raw), MossGenerationPlan::CHUNK_DURATION);
        }
        assert_eq!(MossGenerationPlan::chunk_duration_from_env(Some(" 360 ")), 360.0);
        assert_eq!(MossGenerationPlan::chunk_duration_from_env(Some("10")), 60.0);
        // 旋钮可以拉到默认值以上，直到 MAX_CHUNK_DURATION 才截断。
        assert_eq!(MossGenerationPlan::chunk_duration_from_env(Some("1200")), 1_200.0);
        assert_eq!(
            MossGenerationPlan::chunk_duration_from_env(Some("9000")),
            MossGenerationPlan::MAX_CHUNK_DURATION
        );
        let short = MossGenerationPlan::make_with_chunk_duration(3_600.0, 360.0);
        assert_eq!(short.chunk_duration, 360.0);
        assert_eq!(short.max_tokens, 11_520);
        // 60s 分块的估算 1920 token 仍被 MIN_TOKENS 抬到 5120。
        assert_eq!(
            MossGenerationPlan::make_with_chunk_duration(3_600.0, 60.0).max_tokens,
            MossGenerationPlan::MIN_TOKENS
        );
        assert_eq!(
            MossGenerationPlan::make_with_chunk_duration(3_600.0, MossGenerationPlan::CHUNK_DURATION),
            MossGenerationPlan::make(3_600.0)
        );

        let outcome = adapt_output(
            &[
                MossOutputSegment {
                    start: -1.0,
                    end: 2.0,
                    speaker: "S01".into(),
                    text: " first ".into(),
                },
                MossOutputSegment {
                    start: 1_800.0,
                    end: 1_802.0,
                    speaker: "S01".into(),
                    text: "next".into(),
                },
            ],
            1_900.0,
            true,
        );
        assert_eq!(
            outcome.rows.iter().map(|row| row.text.as_str()).collect::<Vec<_>>(),
            vec!["first", "next"]
        );
        assert_eq!(
            outcome.speaker_ranges.iter().map(|range| range.cluster).collect::<Vec<_>>(),
            vec![0, 1]
        );
        // adapt_output 只看单块结果，chunk 一律填 0，由 host 的拼接循环回填真实序号。
        assert!(outcome.speaker_ranges.iter().all(|range| range.chunk == 0));

        let damaged = MossOutputSegment {
            start: 1.0,
            end: 2.0,
            speaker: "S01".into(),
            text: "坏\u{FFFD}字".into(),
        };
        let (preview, suppressed) = preview_segment(&damaged);
        assert!(suppressed);
        assert!(preview.text.is_empty());
    }
}
