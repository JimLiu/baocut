// 「倒鸭子」跨句动态排版字幕：`CaptionSequencePlan` 的编译器与采样器。
//
// 原型参考实现是 `designs/baocut/app/model-daoyazi.js`（`BC_DZ`），设计稿
// `docs/design/subtitle/bcut-daoyazi-caption-design.md` §6–§9。这里是它的纯函数移植：
// 输入 cue / 词时序 / 词角色 / 用户参数，输出一份确定性的「世界排版 ＋ 镜头计划」，
// 任意时刻 `sample(t)` 出这一帧的相机姿态与每个词的可见状态。不做 I/O，不碰字体：
// 量宽由调用方注入（`measure(text, px)`），所以 CLI 与 App 同一份输入必然同一份世界。
//
// 与原型的口径差（都是有意的）：
// * 参考画布就是输出画布（`width × height` 像素），`font_px` 是解出来的原文行字号；
//   原型用 540 短边的参考画布再缩放到舞台。公式全是比例式，结果只差量化位。
// * 说话人来自 cue 的 `sp`（投影已把说话人写在 cue 上），词时序来自 transcript `words[]`。
// * 阶段 C（`docs/design/subtitle/bcut-daoyazi-caption-design.md` §3.2–§3.4 / §5.4）：`CaptionSequenceInput` 的
//   `pins`（行固定位置 / 角度，世界局部像素）、`seq_seeds`（按段换一版）与 cue 的 `break_before`
//   （手动断段）都进入排版；编辑态的总览取景与行命中见 `overview_frame` / `row_quads` / `pick_row`。

pub const CAPTION_SEQUENCE_COMPILER: &str = "typography-world";
pub const CAPTION_SEQUENCE_SCOPE: &str = "sequence";
pub const CAPTION_SEQUENCE_DEFAULT_SEED: u64 = 137;
const SEQ_RECIPE_VERSION: u32 = 1;
const SEQ_ALGORITHM_VERSION: u32 = 4; // 2026-09-18：同列等宽（逐行缩放字号）+ 整行入场 + 逐句换色
/// 世界坐标量化：1/64 像素。
const SEQ_QUANT: f64 = 64.0;
const SEQ_ZOOM_QUANT: f64 = 4096.0;
const SEQ_TIME_QUANT: f64 = 1000.0;
/// 世界最长边超过参考画布的这么多倍时报 `world-too-large`。
const SEQ_WORLD_LIMIT: f64 = 6.0;
/// typeMonkey.js `minWidthNum`：一行最短按两个字宽取景。
const SEQ_MIN_ROW_EM: f64 = 2.0;
/// typeMonkey.js `lineHeight`。
const SEQ_LINE_HEIGHT: f64 = 1.12;
/// 当前行屏幕字号 ≤ 画布高的 30%（两个字的行也能占满屏宽）。
const SEQ_ZOOM_FONT_CAP: f64 = 0.30;
/// 行盒量化到 1/32：半宽 / 半高与段内累计高度都落在 1/64 网格上，行中心不用再四舍五入。
const SEQ_ROW_QUANT: f64 = 32.0;
/// 同列等宽：每行按「列宽 / 自然宽」缩放字号，夹在这个区间里（主角词行放得更开）。
/// 量化到 1/16，免得浮点噪声换字号。
const SEQ_ROW_SCALE_MIN: f64 = 0.75;
const SEQ_ROW_SCALE_MAX: f64 = 2.0;
const SEQ_ROW_SCALE_HERO_MAX: f64 = 2.75;
const SEQ_ROW_SCALE_QUANT: f64 = 64.0;
/// 防「快闪」：一块字在镜头前至少停这么久（到下一块首词开口为止）。不够的并进相邻块——
/// 并完一行装不下就块内折行，折出来的每一行照样撑到列宽。
const SEQ_MIN_BLOCK_DWELL_S: f64 = 0.7;
/// 并块的上限：最多折成这么多行。
const SEQ_MERGE_MAX_LINES: f64 = 3.0;
/// 单行装得下的上限（预算的倍数）：字号缩到 `SEQ_ROW_SCALE_MIN` 仍不超列宽。
const SEQ_LINE_OVERFLOW: f64 = 1.0 / SEQ_ROW_SCALE_MIN;

// ---------------------------------------------------------------- 确定性随机
struct SeqRng(u64);

impl SeqRng {
    fn new(seed: u64) -> Self {
        Self(seed)
    }

    /// SplitMix64。
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    fn unit(&mut self) -> f64 {
        (self.next() >> 11) as f64 / (1u64 << 53) as f64
    }
}

// ---------------------------------------------------------------- 选项
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SeqCameraMotion {
    /// MonkeyCam Smooth：镜头在相邻两个焦点的整段间隔里飞，到达即 onset。
    Smooth,
    /// MonkeyCam Stop and Go：`[onset − lead, onset − lead + travel]`。
    StopAndGo,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SeqReveal {
    Word,
    Block,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SeqPresentationMode {
    Overlay,
    Stage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SeqViewportMode {
    Center,
    Bottom,
    Full,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SeqEnding {
    Hold,
    OverviewIfRoom,
}

/// 画幅档的排版 token（设计稿 §7.1；描述符 `layoutTokens.<aspect>` 同一份数）。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SeqLayoutTokens {
    pub viewport: [f64; 4],
    pub density: f64,
    pub fit: f64,
}

pub fn caption_sequence_layout_tokens(width: u32, height: u32) -> SeqLayoutTokens {
    let ratio = f64::from(width.max(1)) / f64::from(height.max(1));
    if ratio > 1.2 {
        SeqLayoutTokens {
            viewport: [0.06, 0.08, 0.88, 0.72],
            density: 0.65,
            fit: 0.60,
        }
    } else if ratio < 0.85 {
        SeqLayoutTokens {
            viewport: [0.06, 0.14, 0.88, 0.62],
            density: 0.55,
            fit: 0.66,
        }
    } else {
        SeqLayoutTokens {
            viewport: [0.06, 0.10, 0.88, 0.70],
            density: 0.60,
            fit: 0.62,
        }
    }
}

/// `wordAnimation.caption.options[].{kind:"object", key:"daoyazi"}.value` 解出来的用户参数。
/// 缺的键取默认值；`preset` 先于显式键生效（显式键赢）。
#[derive(Debug, Clone, PartialEq)]
pub struct CaptionSequenceOptions {
    pub preset: String,
    pub max_duration_ms: f64,
    pub max_blocks: usize,
    pub max_words: usize,
    pub pause_threshold_ms: f64,
    pub break_on_speaker_change: bool,
    pub fade_ms: f64,
    pub density: Option<f64>,
    pub turn_every: usize,
    pub camera_motion: SeqCameraMotion,
    pub dwell: f64,
    pub min_travel_ms: f64,
    pub max_travel_ms: f64,
    pub travel_ms: f64,
    pub anticipation: f64,
    pub max_turn_deg: f64,
    pub fit: Option<f64>,
    pub zoom_log: bool,
    pub entrance_ms: f64,
    pub entrance_pre: f64,
    pub reveal: SeqReveal,
    pub presentation: SeqPresentationMode,
    pub viewport: Option<[f64; 4]>,
    pub viewport_mode: SeqViewportMode,
    pub background: Option<SubtitleColor>,
    pub history_blocks: usize,
    pub history_opacity: f64,
    pub ending: SeqEnding,
    /// `light` 预设的动感上限。
    pub intensity_cap: Option<f64>,
}

impl Default for CaptionSequenceOptions {
    fn default() -> Self {
        Self {
            preset: "standard".to_owned(),
            max_duration_ms: 12000.0,
            max_blocks: 16,
            max_words: 48,
            pause_threshold_ms: 800.0,
            break_on_speaker_change: true,
            fade_ms: 200.0,
            density: None,
            turn_every: 2,
            camera_motion: SeqCameraMotion::Smooth,
            dwell: 0.25,
            min_travel_ms: 120.0,
            max_travel_ms: 1600.0,
            travel_ms: 300.0,
            anticipation: 0.5,
            max_turn_deg: 90.0,
            fit: None,
            zoom_log: true,
            entrance_ms: 300.0,
            entrance_pre: 0.5,
            reveal: SeqReveal::Block,
            presentation: SeqPresentationMode::Overlay,
            viewport: None,
            viewport_mode: SeqViewportMode::Center,
            background: None,
            history_blocks: 8,
            history_opacity: 1.0,
            ending: SeqEnding::Hold,
            intensity_cap: None,
        }
    }
}

fn seq_num(value: Option<&Value>, current: f64) -> f64 {
    value
        .and_then(Value::as_f64)
        .filter(|number| number.is_finite())
        .unwrap_or(current)
}

fn seq_usize(value: Option<&Value>, current: usize) -> usize {
    value
        .and_then(Value::as_f64)
        .filter(|number| number.is_finite() && *number >= 0.0)
        .map_or(current, |number| number.round() as usize)
}

fn seq_bool(value: Option<&Value>, current: bool) -> bool {
    value.and_then(Value::as_bool).unwrap_or(current)
}

fn seq_rect(value: Option<&Value>) -> Option<[f64; 4]> {
    let array = value?.as_array()?;
    if array.len() != 4 {
        return None;
    }
    let mut out = [0.0; 4];
    for (slot, item) in out.iter_mut().zip(array) {
        *slot = item.as_f64().filter(|number| number.is_finite())?;
    }
    (out[2] > 0.0 && out[3] > 0.0).then_some(out)
}

impl CaptionSequenceOptions {
    /// 从 `options.daoyazi` 那份对象解出来（`None` / 非对象 = 全默认）。
    pub fn from_value(value: Option<&Value>) -> Self {
        let mut out = Self::default();
        let Some(value) = value.filter(|value| value.is_object()) else {
            return out;
        };
        if let Some(preset) = value.get("preset").and_then(Value::as_str) {
            out.preset = preset.to_owned();
        }
        if out.preset == "light" {
            out.max_turn_deg = 0.0;
            out.anticipation = 0.3;
            out.dwell = 0.35;
            out.intensity_cap = Some(40.0);
        }
        let sequence = value.get("sequence").unwrap_or(&Value::Null);
        out.max_duration_ms = seq_num(sequence.get("maxDurationMs"), out.max_duration_ms);
        out.max_blocks = seq_usize(sequence.get("maxBlocks"), out.max_blocks).max(1);
        out.max_words = seq_usize(sequence.get("maxWords"), out.max_words).max(1);
        out.pause_threshold_ms = seq_num(sequence.get("pauseThresholdMs"), out.pause_threshold_ms);
        out.break_on_speaker_change = seq_bool(
            sequence.get("breakOnSpeakerChange"),
            out.break_on_speaker_change,
        );
        out.fade_ms = seq_num(sequence.get("fadeMs"), out.fade_ms).max(0.0);
        let layout = value.get("layout").unwrap_or(&Value::Null);
        out.density = layout
            .get("density")
            .and_then(Value::as_f64)
            .filter(|number| number.is_finite())
            .map(|number| number.clamp(0.0, 1.0));
        out.turn_every = seq_usize(layout.get("turnEvery"), out.turn_every);
        let camera = value.get("camera").unwrap_or(&Value::Null);
        if let Some(motion) = camera.get("motion").and_then(Value::as_str) {
            out.camera_motion = if motion == "stopAndGo" {
                SeqCameraMotion::StopAndGo
            } else {
                SeqCameraMotion::Smooth
            };
        }
        out.dwell = seq_num(camera.get("dwell"), out.dwell).clamp(0.0, 0.9);
        out.min_travel_ms = seq_num(camera.get("minTravelMs"), out.min_travel_ms).max(0.0);
        out.max_travel_ms = seq_num(camera.get("maxTravelMs"), out.max_travel_ms).max(1.0);
        out.travel_ms = seq_num(camera.get("travelMs"), out.travel_ms).max(1.0);
        out.anticipation = seq_num(camera.get("anticipation"), out.anticipation).clamp(0.0, 1.0);
        out.max_turn_deg = seq_num(camera.get("maxTurnDeg"), out.max_turn_deg).clamp(0.0, 180.0);
        out.fit = camera
            .get("fit")
            .and_then(Value::as_f64)
            .filter(|number| number.is_finite())
            .map(|number| number.clamp(0.3, 1.0));
        out.zoom_log = seq_bool(camera.get("zoomLog"), out.zoom_log);
        let entrance = value.get("entrance").unwrap_or(&Value::Null);
        out.entrance_ms = seq_num(entrance.get("durMs"), out.entrance_ms).max(1.0);
        out.entrance_pre = seq_num(entrance.get("pre"), out.entrance_pre).clamp(0.0, 1.0);
        if let Some(reveal) = value.get("reveal").and_then(Value::as_str) {
            out.reveal = if reveal == "block" {
                SeqReveal::Block
            } else {
                SeqReveal::Word
            };
        }
        let presentation = value.get("presentation").unwrap_or(&Value::Null);
        if let Some(mode) = presentation.get("mode").and_then(Value::as_str) {
            out.presentation = if mode == "stage" {
                SeqPresentationMode::Stage
            } else {
                SeqPresentationMode::Overlay
            };
        }
        out.viewport = seq_rect(presentation.get("viewport"));
        if let Some(mode) = presentation.get("viewportMode").and_then(Value::as_str) {
            out.viewport_mode = match mode {
                "bottom" => SeqViewportMode::Bottom,
                "full" => SeqViewportMode::Full,
                _ => SeqViewportMode::Center,
            };
        }
        out.background = presentation
            .get("background")
            .and_then(Value::as_str)
            .and_then(parse_css_color);
        let history = presentation.get("history").unwrap_or(&Value::Null);
        out.history_blocks = seq_usize(history.get("maxBlocks"), out.history_blocks);
        out.history_opacity = seq_num(history.get("opacity"), out.history_opacity).clamp(0.0, 1.0);
        if let Some(ending) = presentation.get("ending").and_then(Value::as_str) {
            out.ending = if ending == "overviewIfRoom" {
                SeqEnding::OverviewIfRoom
            } else {
                SeqEnding::Hold
            };
        }
        out
    }

    /// 字幕区域三档（§3.3）：`center` 跟画幅档 token；`bottom` / `full` 双语时收一截给译文行。
    pub fn viewport_fraction(&self, tokens: &SeqLayoutTokens, bilingual: bool) -> [f64; 4] {
        if let Some(explicit) = self.viewport {
            return explicit;
        }
        match (self.viewport_mode, bilingual) {
            (SeqViewportMode::Center, _) => tokens.viewport,
            (SeqViewportMode::Bottom, false) => [0.06, 0.42, 0.88, 0.50],
            (SeqViewportMode::Bottom, true) => [0.06, 0.40, 0.88, 0.42],
            (SeqViewportMode::Full, false) => [0.03, 0.04, 0.94, 0.92],
            (SeqViewportMode::Full, true) => [0.03, 0.04, 0.94, 0.78],
        }
    }
}

/// `DesignedCaption.options` 里倒鸭子那一条：`{kind:"object", key:"daoyazi", value:{…}}`。
pub fn caption_sequence_option_value(design: &DesignedCaption) -> Option<&Value> {
    design.options.iter().find_map(|option| {
        (option.get("key").and_then(Value::as_str) == Some("daoyazi")).then(|| {
            option
                .get("value")
                .filter(|value| value.is_object())
                .unwrap_or(option)
        })
    })
}

// ---------------------------------------------------------------- 输入
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SeqRole {
    Normal,
    Emphasis,
    Hero,
}

#[derive(Debug, Clone)]
pub struct CaptionSequenceCue {
    pub id: String,
    pub start: f64,
    pub end: f64,
    pub speaker: Option<String>,
    pub break_before: bool,
    pub words: Vec<Word>,
}

/// 固定住的一行（§3.4「固定布局」）：中心与角度都是**段局部**世界像素——排版时其他行绕开它，
/// 换一版也不动它。键是行首词 id（`SeqBlock::key`）。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SeqPin {
    pub center: [f64; 2],
    pub rot_deg: f64,
}

#[derive(Debug, Clone, Default)]
pub struct CaptionSequenceInput {
    pub cues: Vec<CaptionSequenceCue>,
    pub roles: HashMap<String, SeqRole>,
    pub duration: f64,
    /// 行首词 id → 固定位置。
    pub pins: HashMap<String, SeqPin>,
    /// 段键（段首词 id，`SeqSequence::key`）→ 这一段单独换的版号；缺省与整轨同种子。
    pub seq_seeds: HashMap<String, u64>,
}

#[derive(Debug, Clone)]
pub struct CaptionSequenceEnv {
    pub width: u32,
    pub height: u32,
    pub font_px: f64,
    pub bilingual: bool,
    pub seed: u64,
    /// 0–100。
    pub intensity: f64,
    pub speed: f64,
    pub tokens: SeqLayoutTokens,
    pub options: CaptionSequenceOptions,
}

// ---------------------------------------------------------------- 计划
#[derive(Debug, Clone, PartialEq)]
pub struct SeqWord {
    pub id: String,
    pub text: String,
    pub start: f64,
    pub end: f64,
    pub role: SeqRole,
    /// 块内坐标（像素），`y` 是行盒顶。
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub font: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SeqBlock {
    /// 首词 id。
    pub key: String,
    pub cue_id: String,
    pub hero: bool,
    pub first_t: f64,
    pub last_t: f64,
    /// 取景宽：文字宽与最短两字宽取大（typeMonkey.js 的 `rowWidth` 夹取）；镜头与枢转都按它。
    pub w: f64,
    pub h: f64,
    /// 实际文字宽。
    pub text_w: f64,
    pub lines: usize,
    pub font: f64,
    pub words: Vec<SeqWord>,
    /// 全局世界坐标。
    pub center: [f64; 2],
    /// 段局部世界坐标（`center − sequence.origin`）；固定布局写盘用它。
    pub local_center: [f64; 2],
    pub rot_deg: f64,
    /// 所属段（typeMonkey.js 的 tm-block）在本序列里的序号。
    pub para: usize,
    /// 这一行是用户固定住的（位置 / 角度来自 `CaptionSequenceInput::pins`）。
    pub pinned: bool,
    /// 这一行的底色档：0 主色 / 1 强调色 / 2 第二强调色。一句（cue）一档，按种子抽。
    pub tone: u8,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SeqPose {
    pub x: f64,
    pub y: f64,
    pub rot: f64,
    pub zoom: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SeqSegmentKind {
    Cut,
    Enter,
    Travel,
    Overview,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SeqSegment {
    pub t0: f64,
    pub t1: f64,
    pub from: SeqPose,
    pub to: SeqPose,
    pub d_rot: f64,
    pub block: Option<usize>,
    pub kind: SeqSegmentKind,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SeqBox {
    pub x0: f64,
    pub y0: f64,
    pub x1: f64,
    pub y1: f64,
}

impl SeqBox {
    fn w(&self) -> f64 {
        self.x1 - self.x0
    }

    fn h(&self) -> f64 {
        self.y1 - self.y0
    }

    fn empty() -> Self {
        Self {
            x0: f64::INFINITY,
            y0: f64::INFINITY,
            x1: f64::NEG_INFINITY,
            y1: f64::NEG_INFINITY,
        }
    }

    fn union(self, other: &SeqBox) -> Self {
        Self {
            x0: self.x0.min(other.x0),
            y0: self.y0.min(other.y0),
            x1: self.x1.max(other.x1),
            y1: self.y1.max(other.y1),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct SeqSequence {
    pub id: String,
    /// 段键 = 段首词 id；`seq_seeds` 与「换给当前动画段」按它寻址。
    pub key: String,
    /// 这一段单独换的版号（`None` = 跟整轨）。
    pub seq_seed: Option<u64>,
    pub start: f64,
    pub end: f64,
    pub blocks: Vec<SeqBlock>,
    pub origin: [f64; 2],
    pub world: SeqBox,
    pub segments: Vec<SeqSegment>,
    /// 镜头从这一刻起飞向本段（第一段：硬切）。
    pub cut_at: f64,
    pub visible_until: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CaptionSequencePlan {
    pub seed: u64,
    pub width: u32,
    pub height: u32,
    /// 字幕区域（像素）。
    pub viewport: [f64; 4],
    pub font_px: f64,
    pub density: f64,
    pub fit: f64,
    pub intensity: f64,
    pub speed: f64,
    pub reveal: SeqReveal,
    pub zoom_log: bool,
    /// 停走档：镜头段用 CSS `ease`（typeMonkey.js 的 transition 曲线）；平滑档用 smoothstep。
    pub css_ease: bool,
    pub entrance_dur: f64,
    pub entrance_pre: f64,
    pub fade_s: f64,
    pub history_blocks: usize,
    pub history_opacity: f64,
    pub presentation: SeqPresentationMode,
    pub background: Option<SubtitleColor>,
    pub duration: f64,
    pub sequences: Vec<SeqSequence>,
    pub diagnostics: Vec<String>,
    /// 状态离散变化的时刻（升序去重）：段切换、镜头段起止、词入场起止、词起止、淡出结束。
    pub events: Vec<f64>,
}

// ---------------------------------------------------------------- 文本
fn seq_is_cjk(ch: char) -> bool {
    matches!(
        ch as u32,
        0x3000..=0x303F | 0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0xF900..=0xFAFF | 0xFF00..=0xFFEF
    )
}

fn seq_is_latin(ch: char) -> bool {
    ch.is_ascii_alphanumeric()
}

pub fn caption_sequence_units(text: &str) -> f64 {
    text.chars()
        .map(|ch| {
            if seq_is_cjk(ch) {
                1.0
            } else if seq_is_latin(ch) {
                0.55
            } else {
                0.5
            }
        })
        .sum()
}

fn seq_latin_edge(text: &str, tail: bool) -> bool {
    let ch = if tail {
        text.chars().next_back()
    } else {
        text.chars().next()
    };
    ch.is_some_and(seq_is_latin)
}

fn seq_gap_between(a: &str, b: &str) -> f64 {
    let a_latin = seq_latin_edge(a, true);
    let b_latin = seq_latin_edge(b, false);
    if a_latin && b_latin {
        0.28
    } else if a_latin != b_latin {
        0.12
    } else {
        0.0
    }
}

fn seq_ends_sentence(text: &str) -> bool {
    text.chars().next_back().is_some_and(|ch| {
        matches!(
            ch,
            '，' | '。'
                | '！'
                | '？'
                | '；'
                | '：'
                | '、'
                | ','
                | '.'
                | '!'
                | '?'
                | ';'
                | ':'
                | '…'
                | '—'
        )
    })
}

fn seq_q(value: f64, scale: f64) -> f64 {
    (value * scale).round() / scale
}

fn seq_ease(u: f64) -> f64 {
    let u = u.clamp(0.0, 1.0);
    u * u * (3.0 - 2.0 * u)
}

fn seq_bez(t: f64, p1: f64, p2: f64) -> f64 {
    let mt = 1.0 - t;
    3.0 * mt * mt * t * p1 + 3.0 * mt * t * t * p2 + t * t * t
}

fn seq_bez_d(t: f64, p1: f64, p2: f64) -> f64 {
    let mt = 1.0 - t;
    3.0 * mt * mt * p1 + 6.0 * mt * t * (p2 - p1) + 3.0 * t * t * (1.0 - p2)
}

/// CSS `ease` = cubic-bezier(0.25, 0.1, 0.25, 1)：typeMonkey.js 的 transition / zoomIn 曲线。
/// x(t) 用牛顿法反解，定步数，与原型 `cssEase` 逐位一致。
fn seq_css_ease(u: f64) -> f64 {
    let u = u.clamp(0.0, 1.0);
    if u <= 0.0 {
        return 0.0;
    }
    if u >= 1.0 {
        return 1.0;
    }
    let mut t = u;
    for _ in 0..8 {
        let x = seq_bez(t, 0.25, 0.25) - u;
        if x.abs() < 1e-7 {
            break;
        }
        let dx = seq_bez_d(t, 0.25, 0.25);
        if dx == 0.0 {
            break;
        }
        t -= x / dx;
    }
    let t = t.clamp(0.0, 1.0);
    seq_bez(t, 0.1, 1.0)
}

fn seq_norm_rot(r: f64) -> f64 {
    ((r % 360.0) + 360.0) % 360.0
}

fn seq_turn_delta(from: f64, to: f64) -> f64 {
    let mut d = seq_norm_rot(to - from);
    if d > 180.0 {
        d -= 360.0;
    }
    if d == -180.0 {
        d = 180.0;
    }
    d
}

fn seq_is_sideways(rot: f64) -> bool {
    (seq_norm_rot(rot) % 180.0 - 90.0).abs() < 1e-6
}

fn seq_aabb(center: [f64; 2], w: f64, h: f64, rot: f64) -> SeqBox {
    let (sw, sh) = if seq_is_sideways(rot) { (h, w) } else { (w, h) };
    SeqBox {
        x0: center[0] - sw / 2.0,
        y0: center[1] - sh / 2.0,
        x1: center[0] + sw / 2.0,
        y1: center[1] + sh / 2.0,
    }
}

fn seq_overlap_area(a: &SeqBox, b: &SeqBox, margin: f64) -> f64 {
    let ox = a.x1.min(b.x1) - a.x0.max(b.x0) + margin;
    let oy = a.y1.min(b.y1) - a.y0.max(b.y0) + margin;
    if ox > 0.0 && oy > 0.0 { ox * oy } else { 0.0 }
}

// ---------------------------------------------------------------- 分块与块内排版
struct SeqRawBlock {
    cue_id: String,
    words: Vec<Word>,
    hero: bool,
}

fn seq_chunk_cue(
    cue: &CaptionSequenceCue,
    roles: &HashMap<String, SeqRole>,
    density: f64,
) -> Vec<SeqRawBlock> {
    // 行是最小单位：预算 `2.5 + 5 × density` 个 CJK 单位（density 0.65 → 5.75）
    let budget = 2.5 + 5.0 * density;
    let mut blocks = Vec::new();
    let mut current: Vec<Word> = Vec::new();
    let mut current_units = 0.0;
    let flush =
        |current: &mut Vec<Word>, current_units: &mut f64, blocks: &mut Vec<SeqRawBlock>| {
            if !current.is_empty() {
                blocks.push(SeqRawBlock {
                    cue_id: cue.id.clone(),
                    words: std::mem::take(current),
                    hero: false,
                });
                *current_units = 0.0;
            }
        };
    for word in &cue.words {
        if roles.get(&word.id) == Some(&SeqRole::Hero) {
            flush(&mut current, &mut current_units, &mut blocks);
            blocks.push(SeqRawBlock {
                cue_id: cue.id.clone(),
                words: vec![word.clone()],
                hero: true,
            });
            continue;
        }
        let units = caption_sequence_units(&word.text);
        if !current.is_empty() && current_units + units > budget {
            flush(&mut current, &mut current_units, &mut blocks);
        }
        current.push(word.clone());
        current_units += units;
        if seq_ends_sentence(&word.text) && current_units >= budget * 0.4 {
            flush(&mut current, &mut current_units, &mut blocks);
        }
    }
    flush(&mut current, &mut current_units, &mut blocks);
    blocks
}

struct SeqResolved {
    width: f64,
    height: f64,
    viewport: [f64; 4],
    font_px: f64,
    density: f64,
    fit: f64,
    intensity: f64,
    speed: f64,
    seed: u64,
    options: CaptionSequenceOptions,
}

fn seq_layout_block(
    raw: &SeqRawBlock,
    resolved: &SeqResolved,
    roles: &HashMap<String, SeqRole>,
    measure: &mut dyn FnMut(&str, f64) -> f64,
) -> SeqBlock {
    // 行内：词左对齐一路排过去（不居中）。**同列等宽**：先按基础字号量自然宽，再把这一行
    // 的字号缩放到列宽（`预算字数 × 基础字号`）——短句字大、长句字小，一列的左右两边都齐，
    // 镜头不必逐行变焦。并过块（防快闪）的长块按字数均分折成几行，每行各自撑到列宽：看上去
    // 与几个单行块一样，只是一起入场、镜头只停一次。
    let budget = 2.5 + 5.0 * resolved.density;
    let col_w = resolved.font_px * budget;
    let units: Vec<f64> = raw
        .words
        .iter()
        .map(|word| caption_sequence_units(&word.text))
        .collect();
    let total: f64 = units.iter().sum();
    let count = raw.words.len();
    let line_count = if raw.hero || total <= budget * SEQ_LINE_OVERFLOW {
        1
    } else {
        ((total / budget).ceil() as usize).clamp(1, count.max(1))
    };
    let mut ranges: Vec<std::ops::Range<usize>> = Vec::with_capacity(line_count);
    let (mut start, mut acc) = (0usize, 0.0);
    for line in 1..=line_count {
        if line == line_count {
            ranges.push(start..count);
            break;
        }
        let target = total * line as f64 / line_count as f64;
        let mut end = start;
        while end < count - (line_count - line)
            && (end == start || acc + units[end] / 2.0 <= target)
        {
            acc += units[end];
            end += 1;
        }
        ranges.push(start..end);
        start = end;
    }
    let cap = if raw.hero {
        SEQ_ROW_SCALE_HERO_MAX
    } else {
        SEQ_ROW_SCALE_MAX
    };
    let mut words = Vec::with_capacity(count);
    let (mut y, mut text_w, mut w, mut font) = (0.0f64, 0.0f64, 0.0f64, f64::MAX);
    for range in &ranges {
        let line = &raw.words[range.clone()];
        let mut natural = 0.0;
        for (index, word) in line.iter().enumerate() {
            if index > 0 {
                natural += seq_gap_between(&line[index - 1].text, &word.text) * resolved.font_px;
            }
            natural += measure(&word.text, resolved.font_px).max(0.0);
        }
        let row_scale = if natural > 1e-6 {
            seq_q(
                (col_w / natural).clamp(SEQ_ROW_SCALE_MIN, cap),
                SEQ_ROW_SCALE_QUANT,
            )
        } else {
            1.0
        };
        let base = resolved.font_px * row_scale;
        let line_h = base * SEQ_LINE_HEIGHT;
        let mut x = 0.0;
        for (index, word) in line.iter().enumerate() {
            if index > 0 {
                x += seq_gap_between(&line[index - 1].text, &word.text) * base;
            }
            let width = measure(&word.text, base).max(0.0);
            words.push(SeqWord {
                id: word.id.clone(),
                text: word.text.clone(),
                start: word.start,
                end: word.end,
                role: roles.get(&word.id).copied().unwrap_or(SeqRole::Normal),
                x: seq_q(x, SEQ_QUANT),
                y,
                w: seq_q(width, SEQ_QUANT),
                h: seq_q(line_h, SEQ_QUANT),
                font: base,
            });
            x += width;
        }
        text_w = text_w.max(seq_q(x, SEQ_QUANT));
        w = w.max(seq_q(x.max(SEQ_MIN_ROW_EM * base), SEQ_ROW_QUANT));
        // 行高量化到 1/32：累计出来的 y 与块高都落在网格上
        y += seq_q(line_h, SEQ_ROW_QUANT);
        font = font.min(base);
    }
    let h = y;
    let base = if font.is_finite() {
        font
    } else {
        resolved.font_px
    };
    let first_t = raw.words.first().map_or(0.0, |word| word.start);
    let last_t = raw
        .words
        .iter()
        .map(|word| word.end)
        .fold(first_t, f64::max);
    SeqBlock {
        key: raw
            .words
            .first()
            .map(|word| word.id.clone())
            .unwrap_or_default(),
        cue_id: raw.cue_id.clone(),
        hero: raw.hero,
        first_t,
        last_t,
        w,
        h,
        text_w,
        lines: ranges.len().max(1),
        font: base,
        words,
        center: [0.0, 0.0],
        local_center: [0.0, 0.0],
        rot_deg: 0.0,
        para: 0,
        pinned: false,
        tone: 0,
    }
}

/// 防「快闪」：停留不足 [`SEQ_MIN_BLOCK_DWELL_S`] 的块并进相邻块。停留 = 下一块首词开口 −
/// 本块首词开口（段尾块 = 末词收声 − 首词开口）。并块总是保住**较早**的那个入场时刻——
/// 字可以早一点出来，不能念完了才出来。邻块挑字数少的那个（一样多取前一块），所以一串
/// 都很短的块两两成对，不会滚成一大块。主角块不参与；换说话人不并；并完不超过
/// [`SEQ_MERGE_MAX_LINES`] 行。
fn seq_merge_flash_blocks(
    blocks: &mut Vec<SeqRawBlock>,
    budget: f64,
    speakers: &HashMap<String, Option<String>>,
) {
    let units = |block: &SeqRawBlock| -> f64 {
        block
            .words
            .iter()
            .map(|word| caption_sequence_units(&word.text))
            .sum()
    };
    let first = |block: &SeqRawBlock| block.words.first().map_or(0.0, |word| word.start);
    let mut index = 0;
    while index < blocks.len() {
        let block = &blocks[index];
        let dwell = match blocks.get(index + 1) {
            Some(next) => first(next) - first(block),
            None => {
                block
                    .words
                    .iter()
                    .map(|word| word.end)
                    .fold(first(block), f64::max)
                    - first(block)
            }
        };
        if block.hero || dwell >= SEQ_MIN_BLOCK_DWELL_S {
            index += 1;
            continue;
        }
        let fits = |other: &SeqRawBlock| {
            !other.hero
                && speakers.get(&other.cue_id) == speakers.get(&block.cue_id)
                && units(other) + units(block) <= budget * SEQ_MERGE_MAX_LINES
        };
        let prev = index.checked_sub(1).filter(|&i| fits(&blocks[i]));
        let next = Some(index + 1).filter(|&i| i < blocks.len() && fits(&blocks[i]));
        let into_prev = match (prev, next) {
            (Some(p), Some(n)) => units(&blocks[p]) <= units(&blocks[n]),
            (Some(_), None) => true,
            (None, Some(_)) => false,
            (None, None) => {
                index += 1;
                continue;
            }
        };
        if into_prev {
            let absorbed = blocks.remove(index);
            blocks[index - 1].words.extend(absorbed.words);
            // 不前进：原来的下一块现在落在 index 上
        } else {
            let absorbed = blocks.remove(index + 1);
            blocks[index].words.extend(absorbed.words);
            // 不前进：并完再量一次本块
        }
    }
}

// ---------------------------------------------------------------- 分段
struct SeqRawSequence {
    id: String,
    start: f64,
    end: f64,
    blocks: Vec<SeqRawBlock>,
    word_count: usize,
}

fn seq_segment(input: &CaptionSequenceInput, resolved: &SeqResolved) -> Vec<SeqRawSequence> {
    let options = &resolved.options;
    let mut out: Vec<SeqRawSequence> = Vec::new();
    let mut prev: Option<&CaptionSequenceCue> = None;
    for cue in &input.cues {
        if cue.words.is_empty() {
            continue;
        }
        let blocks = seq_chunk_cue(cue, &input.roles, resolved.density);
        let word_count = cue.words.len();
        let break_here = match (out.last(), prev) {
            (Some(current), Some(previous)) => {
                cue.break_before
                    || (options.break_on_speaker_change
                        && cue.speaker.is_some()
                        && previous.speaker.is_some()
                        && cue.speaker != previous.speaker)
                    || (cue.start - previous.end) * 1000.0 >= options.pause_threshold_ms
                    || (cue.end - current.start) * 1000.0 > options.max_duration_ms
                    || current.blocks.len() + blocks.len() > options.max_blocks
                    || current.word_count + word_count > options.max_words
            }
            _ => true,
        };
        if break_here {
            out.push(SeqRawSequence {
                id: format!("seq-{}", cue.words[0].id),
                start: cue.start,
                end: cue.end,
                blocks: Vec::new(),
                word_count: 0,
            });
        }
        let current = out.last_mut().expect("just pushed");
        current.blocks.extend(blocks);
        current.word_count += word_count;
        current.end = current.end.max(cue.end);
        prev = Some(cue);
    }
    let budget = 2.5 + 5.0 * resolved.density;
    let speakers: HashMap<String, Option<String>> = input
        .cues
        .iter()
        .map(|cue| (cue.id.clone(), cue.speaker.clone()))
        .collect();
    for sequence in &mut out {
        seq_merge_flash_blocks(&mut sequence.blocks, budget, &speakers);
    }
    out
}

// ---------------------------------------------------------------- 世界排版
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SeqSide {
    Right,
    Below,
    Left,
    Above,
}

const SEQ_SIDES: [SeqSide; 4] = [
    SeqSide::Right,
    SeqSide::Below,
    SeqSide::Left,
    SeqSide::Above,
];

/// 「顺着走」的方向：段自己坐标系里的下方——行就是往这个方向叠的。
fn seq_run_side_of(rot_deg: f64) -> SeqSide {
    let quarter = (seq_norm_rot(rot_deg) / 90.0).round() as usize;
    SEQ_SIDES[(1 + quarter) % 4]
}

/// 直角旋转一个向量（顺时针为正、y 向下），编译期不用三角函数。
/// `0.0 - x` 而不是 `-x`：不出 -0，量化后的坐标逐位稳定。
fn seq_rot_vec(rot: f64, v: [f64; 2]) -> [f64; 2] {
    let r = seq_norm_rot(rot);
    if (r - 90.0).abs() < 1e-6 {
        [0.0 - v[1], v[0]]
    } else if (r - 180.0).abs() < 1e-6 {
        [0.0 - v[0], 0.0 - v[1]]
    } else if (r - 270.0).abs() < 1e-6 {
        [v[1], 0.0 - v[0]]
    } else {
        v
    }
}

/// 段（typeMonkey.js 的 tm-block）：若干行左对齐往下叠成一列，整段一个角度。
/// `origin` 是段局部原点（首行左上角）的世界位置，`height` 是已叠的高度。
#[derive(Debug, Clone, Copy)]
struct SeqPara {
    origin: [f64; 2],
    rot: f64,
    height: f64,
}

impl SeqPara {
    fn new(origin: [f64; 2], rot: f64) -> Self {
        Self {
            origin,
            rot: seq_norm_rot(rot),
            height: 0.0,
        }
    }

    fn from_center(center: [f64; 2], rot: f64, w: f64, h: f64) -> Self {
        let r = seq_rot_vec(rot, [w / 2.0, h / 2.0]);
        Self::new([center[0] - r[0], center[1] - r[1]], rot)
    }

    fn row_center(&self, w: f64, h: f64) -> [f64; 2] {
        let r = seq_rot_vec(self.rot, [w / 2.0, self.height + h / 2.0]);
        [self.origin[0] + r[0], self.origin[1] + r[1]]
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SeqPivot {
    /// 绕上一行**左下角**，新段顺时针转 90°，新首行的左下角就是那个角。
    Lb,
    /// 绕上一行**右下角**，新段逆时针转 90°，新首行的右下角就是那个角。
    Rb,
}

impl SeqPivot {
    fn other(self) -> Self {
        match self {
            SeqPivot::Lb => SeqPivot::Rb,
            SeqPivot::Rb => SeqPivot::Lb,
        }
    }
}

/// 枢转（typeMonkey.js 的 `rotate: 'lb' | 'rb'`）。角取的是取景宽（`w`）的角。
fn seq_pivot_para(para: &SeqPara, prev_w: f64, w: f64, h: f64, dir: SeqPivot) -> SeqPara {
    let (pivot_local, rot, anchor) = match dir {
        SeqPivot::Lb => ([0.0, para.height], para.rot + 90.0, [0.0, h]),
        SeqPivot::Rb => ([prev_w, para.height], para.rot - 90.0, [w, h]),
    };
    let rot = seq_norm_rot(rot);
    let pv = seq_rot_vec(para.rot, pivot_local);
    let av = seq_rot_vec(rot, anchor);
    SeqPara::new(
        [
            para.origin[0] + pv[0] - av[0],
            para.origin[1] + pv[1] - av[1],
        ],
        rot,
    )
}

struct SeqWorldLayout {
    world: SeqBox,
    last_rot: f64,
}

/// 行种子串与原型 `layoutWorld` 同：`recipe|alg|seed|seqSeed|sourceId|clipId|key`，段版号缺省是空槽。
fn seq_block_seed(resolved: &SeqResolved, seq_seed: Option<u64>, key: &str) -> u64 {
    let seq_seed = seq_seed.map(|n| n.to_string()).unwrap_or_default();
    let text = format!(
        "{SEQ_RECIPE_VERSION}|{SEQ_ALGORITHM_VERSION}|{}|{seq_seed}|main|clip-01|{key}",
        resolved.seed
    );
    render_raster::drawop::fnv1a64(text.as_bytes())
}

/// 世界排版（与原型 `layoutWorld` 同步）：行一行一行地进来——
/// 1. 平常顺着当前段往下叠；
/// 2. 上次转向之后至少隔了 `turn_every` 行时，用行种子抽一次「转不转」：到句读或 cue 边界处
///    概率 `0.55 × min(intensity / 60, 1.6)`，行中间 `0.2 × …`（`max_turn_deg < 90` 恒否）；转的话先抽方向
///    （70% 与上一次相反），撞到已有行就换另一边；
/// 3. 顺着叠会撞上别的段时，节流允许就转，不允许就把新段**跳**到世界包围盒外顺着走的那一侧
///    （隔 0.6 个视口），角度不变——不接受重叠。
/// 种子只在「转不转」「往哪转」两处进入。
///
/// 固定住的行（`pins`）先登记进占位表：别的行绕开它；轮到它时按固定的位置 / 角度落下，
/// 并把段起点接到它身上（后面的行顺着它往下叠）——与原型同法。
fn seq_layout_world(
    seq_id: &str,
    seq_seed: Option<u64>,
    blocks: &mut [SeqBlock],
    resolved: &SeqResolved,
    pins: &HashMap<String, SeqPin>,
    diagnostics: &mut Vec<String>,
    start_rot: f64,
) -> SeqWorldLayout {
    let options = &resolved.options;
    let can_turn = options.max_turn_deg >= 90.0;
    let mut placed: Vec<(SeqBox, usize)> = Vec::with_capacity(blocks.len());
    for (index, block) in blocks.iter().enumerate() {
        if let Some(pin) = pins.get(&block.key) {
            let center = [
                seq_q(pin.center[0], SEQ_QUANT),
                seq_q(pin.center[1], SEQ_QUANT),
            ];
            placed.push((
                seq_aabb(center, block.w, block.h, seq_norm_rot(pin.rot_deg)),
                index,
            ));
        }
    }
    let mut para: Option<SeqPara> = None;
    let mut para_idx = 0usize;
    let mut since_turn = options.turn_every;
    let mut last_dir: Option<SeqPivot> = None;
    let mut tone = 0u8;
    let collides = |placed: &[(SeqBox, usize)],
                    center: [f64; 2],
                    w: f64,
                    h: f64,
                    rot: f64,
                    self_idx: usize| {
        let candidate = seq_aabb(center, w, h, rot);
        placed
            .iter()
            .any(|(bx, idx)| *idx != self_idx && seq_overlap_area(&candidate, bx, 0.0) > 0.0)
    };
    for index in 0..blocks.len() {
        let mut rng = SeqRng::new(seq_block_seed(resolved, seq_seed, &blocks[index].key));
        let _seed_hex = rng.next();
        let turn_roll = rng.unit();
        let dir_roll = rng.unit();
        let tone_roll = rng.unit();
        // 逐句换色：一句的各行同色；主色占一半，两档强调色不连着出
        if index == 0 || blocks[index - 1].cue_id != blocks[index].cue_id {
            let pick = if tone_roll < 0.5 {
                0
            } else if tone_roll < 0.78 {
                1
            } else {
                2
            };
            tone = if index > 0 && pick == tone { 0 } else { pick };
        }
        blocks[index].tone = tone;
        let (w, h) = (blocks[index].w, blocks[index].h);
        let commit = |blocks: &mut [SeqBlock],
                      placed: &mut Vec<(SeqBox, usize)>,
                      para: &mut SeqPara,
                      para_idx: usize,
                      center: [f64; 2],
                      pinned: bool| {
            let block = &mut blocks[index];
            block.center = [seq_q(center[0], SEQ_QUANT), seq_q(center[1], SEQ_QUANT)];
            block.rot_deg = para.rot;
            block.para = para_idx;
            block.pinned = pinned;
            if !pinned {
                placed.push((seq_aabb(block.center, w, h, para.rot), index));
            }
            para.height += h;
        };
        if let Some(pin) = pins.get(&blocks[index].key) {
            let rot = seq_norm_rot(pin.rot_deg);
            let center = [
                seq_q(pin.center[0], SEQ_QUANT),
                seq_q(pin.center[1], SEQ_QUANT),
            ];
            let mut next = SeqPara::from_center(center, rot, w, h);
            if para.is_some() {
                para_idx += 1;
            }
            commit(blocks, &mut placed, &mut next, para_idx, center, true);
            para = Some(next);
            since_turn += 1;
            continue;
        }
        let mut current = match para {
            Some(current) => current,
            None => {
                let mut first = SeqPara::new([0.0, 0.0], start_rot);
                let center = first.row_center(w, h);
                if !collides(&placed, center, w, h, first.rot, index) {
                    commit(blocks, &mut placed, &mut first, para_idx, center, false);
                    para = Some(first);
                    continue;
                }
                first
            }
        };
        let prev = index.checked_sub(1).map(|i| &blocks[i]);
        let prev_w = prev.map_or(w, |b| b.w);
        let prev_center = prev.map_or([0.0, 0.0], |b| b.center);
        let boundary = prev.is_none_or(|prev| {
            prev.cue_id != blocks[index].cue_id
                || prev
                    .words
                    .last()
                    .is_some_and(|word| seq_ends_sentence(&word.text))
        });
        let wish = can_turn
            && since_turn >= options.turn_every
            && turn_roll
                < if boundary { 0.55 } else { 0.2 } * (resolved.intensity / 60.0).clamp(0.0, 1.6);
        let straight = current.row_center(w, h);
        let straight_ok = !collides(&placed, straight, w, h, current.rot, index);
        if !wish && straight_ok {
            commit(blocks, &mut placed, &mut current, para_idx, straight, false);
            para = Some(current);
            since_turn += 1;
            continue;
        }
        let mut done = false;
        if can_turn && since_turn >= options.turn_every && prev.is_some() {
            let first = match last_dir {
                Some(last) => {
                    if dir_roll < 0.7 {
                        last.other()
                    } else {
                        last
                    }
                }
                None => {
                    if dir_roll < 0.5 {
                        SeqPivot::Lb
                    } else {
                        SeqPivot::Rb
                    }
                }
            };
            for dir in [first, first.other()] {
                let mut next = seq_pivot_para(&current, prev_w, w, h, dir);
                let center = next.row_center(w, h);
                if collides(&placed, center, w, h, next.rot, index) {
                    continue;
                }
                para_idx += 1;
                commit(blocks, &mut placed, &mut next, para_idx, center, false);
                para = Some(next);
                since_turn = 0;
                last_dir = Some(dir);
                done = true;
                break;
            }
        }
        if done {
            continue;
        }
        if straight_ok {
            commit(blocks, &mut placed, &mut current, para_idx, straight, false);
            para = Some(current);
            since_turn += 1;
            continue;
        }
        // 跳到世界外：同角度另起一段，放在顺着走的那一侧
        let world = placed
            .iter()
            .fold(SeqBox::empty(), |acc, (bx, _)| acc.union(bx));
        let zoom = seq_focus_for([0.0, 0.0], current.rot, w, h, blocks[index].font, resolved)
            .zoom
            .max(1e-6);
        let side = seq_run_side_of(current.rot);
        let box0 = seq_aabb([0.0, 0.0], w, h, current.rot);
        let [_, _, vw, vh] = resolved.viewport;
        let gap =
            0.6 * if matches!(side, SeqSide::Right | SeqSide::Left) {
                vw
            } else {
                vh
            } / zoom;
        let center = match side {
            SeqSide::Right => [world.x1 + gap + box0.w() / 2.0, prev_center[1]],
            SeqSide::Left => [world.x0 - gap - box0.w() / 2.0, prev_center[1]],
            SeqSide::Below => [prev_center[0], world.y1 + gap + box0.h() / 2.0],
            SeqSide::Above => [prev_center[0], world.y0 - gap - box0.h() / 2.0],
        };
        diagnostics.push(format!("layout-jump:{}", blocks[index].key));
        let center = [seq_q(center[0], SEQ_QUANT), seq_q(center[1], SEQ_QUANT)];
        let mut next = SeqPara::from_center(center, current.rot, w, h);
        para_idx += 1;
        commit(blocks, &mut placed, &mut next, para_idx, center, false);
        para = Some(next);
        since_turn += 1;
    }
    let world = placed
        .iter()
        .fold(SeqBox::empty(), |acc, (bx, _)| acc.union(bx));
    if world.w() > resolved.width * SEQ_WORLD_LIMIT || world.h() > resolved.height * SEQ_WORLD_LIMIT
    {
        diagnostics.push(format!("world-too-large:{seq_id}"));
    }
    SeqWorldLayout {
        world,
        last_rot: blocks.last().map_or(0.0, |block| block.rot_deg),
    }
}

/// 取景（typeMonkey.js 的 `scale = conWidth / rowWidth`）：镜头对着**当前行**，把它的取景宽
/// 放成视口宽的 `fit`——短行大、长行小，每行都占同一屏宽；行盒居中。
/// 可读性区间：屏幕字号 ≥ 画布高 3.2%，≤ 30%，且单行高 ≤ 视口高 × fit。
fn seq_focus_for(
    center: [f64; 2],
    rot: f64,
    w: f64,
    h: f64,
    font: f64,
    resolved: &SeqResolved,
) -> SeqPose {
    let [_, _, vw, vh] = resolved.viewport;
    let w = w.max(1e-6);
    let h = h.max(1e-6);
    // `font` 是这一块里最小的那行字号：同列等宽之后各行字号不同，可读性区间按它算。
    // 不从 `h` 反推——折行的块 h 是几行之和，镜头不转时传进来的 w / h 还是对调过的。
    let font = font.max(1e-6);
    let mut zoom = (vw * resolved.fit) / w;
    let zoom_min = (0.032 * resolved.height) / font;
    let zoom_max = ((vh * resolved.fit) / h).min((SEQ_ZOOM_FONT_CAP * resolved.height) / font);
    zoom = zoom.clamp(zoom_min.min(zoom_max), zoom_max.max(1e-6));
    SeqPose {
        x: center[0],
        y: center[1],
        rot,
        zoom: seq_q(zoom, SEQ_ZOOM_QUANT),
    }
}

fn seq_focus_block(block: &SeqBlock, resolved: &SeqResolved) -> SeqPose {
    seq_focus_for(
        block.center,
        block.rot_deg,
        block.w,
        block.h,
        block.font,
        resolved,
    )
}

fn seq_overview_for(world: &SeqBox, rot: f64, viewport: [f64; 4]) -> SeqPose {
    let [_, _, vw, vh] = viewport;
    let cx = (world.x0 + world.x1) / 2.0;
    let cy = (world.y0 + world.y1) / 2.0;
    let w = if world.w() > 0.0 { world.w() } else { 1.0 };
    let h = if world.h() > 0.0 { world.h() } else { 1.0 };
    let (sw, sh) = if seq_is_sideways(rot) { (h, w) } else { (w, h) };
    let zoom = (vw * 0.9 / sw).min(vh * 0.9 / sh);
    SeqPose {
        x: seq_q(cx, SEQ_QUANT),
        y: seq_q(cy, SEQ_QUANT),
        rot,
        zoom: seq_q(zoom, SEQ_ZOOM_QUANT),
    }
}

/// 把这一段的局部世界接到上一段旁边，返回全局原点。
fn seq_place_world(
    local: &SeqBox,
    first: &SeqBlock,
    prev: &SeqSequence,
    prev_worlds: &[SeqBox],
    resolved: &SeqResolved,
    run_side: SeqSide,
) -> [f64; 2] {
    let prev_last = prev.blocks.last().expect("sequence has blocks");
    let pw = &prev.world;
    let zoom = seq_focus_block(first, resolved).zoom.max(1e-6);
    let [_, _, vw, vh] = resolved.viewport;
    let mut order = vec![run_side];
    order.extend(SEQ_SIDES.iter().copied().filter(|side| *side != run_side));
    for k in 1..=4 {
        for &side in &order {
            let gap_x = 0.6 * f64::from(k) * vw / zoom;
            let gap_y = 0.6 * f64::from(k) * vh / zoom;
            let (ox, oy) = match side {
                SeqSide::Right => (
                    pw.x1 + gap_x - local.x0,
                    prev_last.center[1] - first.center[1],
                ),
                SeqSide::Left => (
                    pw.x0 - gap_x - local.x1,
                    prev_last.center[1] - first.center[1],
                ),
                SeqSide::Below => (
                    prev_last.center[0] - first.center[0],
                    pw.y1 + gap_y - local.y0,
                ),
                SeqSide::Above => (
                    prev_last.center[0] - first.center[0],
                    pw.y0 - gap_y - local.y1,
                ),
            };
            let candidate = SeqBox {
                x0: local.x0 + ox,
                y0: local.y0 + oy,
                x1: local.x1 + ox,
                y1: local.y1 + oy,
            };
            if prev_worlds
                .iter()
                .all(|world| seq_overlap_area(&candidate, world, 0.0) == 0.0)
            {
                return [ox, oy];
            }
        }
    }
    let far = prev_worlds
        .iter()
        .map(|world| world.x1)
        .fold(f64::NEG_INFINITY, f64::max);
    [
        far + 3.0 * vw / zoom - local.x0,
        prev_last.center[1] - first.center[1],
    ]
}

// ---------------------------------------------------------------- 相机
struct SeqCameraPlan {
    segments: Vec<SeqSegment>,
    end_pose: SeqPose,
    end_t: f64,
}

fn seq_plan_camera(
    world: &SeqBox,
    blocks: &[SeqBlock],
    resolved: &SeqResolved,
    next_seq_onset: Option<f64>,
    project_end: f64,
    entry: Option<(SeqPose, f64)>,
) -> SeqCameraPlan {
    let options = &resolved.options;
    let smooth = options.camera_motion != SeqCameraMotion::StopAndGo;
    let min_travel = options.min_travel_ms / 1000.0;
    let max_travel = (options.max_travel_ms / 1000.0) / resolved.speed;
    let travel_pref = (options.travel_ms / 1000.0) / resolved.speed;
    let onsets: Vec<f64> = blocks.iter().map(|block| block.first_t).collect();
    let mut segments: Vec<SeqSegment> = Vec::with_capacity(blocks.len() + 1);
    let mut prev_pose =
        entry.map_or_else(|| seq_focus_block(&blocks[0], resolved), |(pose, _)| pose);
    for (index, block) in blocks.iter().enumerate() {
        let to = seq_focus_block(block, resolved);
        if index == 0 && entry.is_none() {
            segments.push(SeqSegment {
                t0: onsets[0],
                t1: onsets[0],
                from: to,
                to,
                d_rot: 0.0,
                block: Some(0),
                kind: SeqSegmentKind::Cut,
            });
            prev_pose = to;
            continue;
        }
        let prev_end = if index == 0 {
            entry.map_or(onsets[0], |(_, t)| t)
        } else {
            segments.last().map_or(onsets[0], |segment| segment.t1)
        };
        let prev_ref = if index == 0 {
            entry.map_or(onsets[0], |(_, t)| t)
        } else {
            onsets[index - 1]
        };
        let next_onset = onsets.get(index + 1).copied();
        let (t0, t1) = if smooth {
            let interval = (onsets[index] - prev_ref).max(0.0);
            let mut travel =
                ((1.0 - options.dwell) * interval).clamp(min_travel, max_travel.max(min_travel));
            travel = travel.min((onsets[index] - prev_end).max(0.05));
            (onsets[index] - travel, onsets[index])
        } else {
            let mut travel = travel_pref;
            if let Some(next_onset) = next_onset {
                travel = travel.min(0.45 * (next_onset - onsets[index]));
            }
            let mut lead =
                (options.anticipation * travel).min(0.3 * (onsets[index] - prev_ref).max(0.0));
            let mut t0 = onsets[index] - lead;
            if t0 < prev_end {
                lead = (onsets[index] - prev_end).max(0.0);
                t0 = onsets[index] - lead;
            }
            if let Some(next_onset) = next_onset
                && t0 + travel > next_onset
            {
                travel = (next_onset - t0).max(0.05);
            }
            (t0, t0 + travel)
        };
        let travel = t1 - t0;
        let d_rot = seq_turn_delta(prev_pose.rot, to.rot);
        let no_turn = travel < min_travel && d_rot != 0.0;
        let to_adj = if no_turn {
            let swap = seq_is_sideways(block.rot_deg) != seq_is_sideways(prev_pose.rot);
            let (w, h) = if swap {
                (block.h, block.w)
            } else {
                (block.w, block.h)
            };
            let zoom = seq_focus_for(block.center, prev_pose.rot, w, h, block.font, resolved).zoom;
            SeqPose {
                rot: prev_pose.rot,
                zoom,
                ..to
            }
        } else {
            to
        };
        segments.push(SeqSegment {
            t0: seq_q(t0, SEQ_TIME_QUANT),
            t1: seq_q(t1, SEQ_TIME_QUANT),
            from: prev_pose,
            to: to_adj,
            d_rot: if no_turn { 0.0 } else { d_rot },
            block: Some(index),
            kind: if index == 0 {
                SeqSegmentKind::Enter
            } else {
                SeqSegmentKind::Travel
            },
        });
        prev_pose = to_adj;
    }
    let last_word_end = blocks
        .iter()
        .map(|block| block.last_t)
        .fold(f64::NEG_INFINITY, f64::max);
    let cut_at = next_seq_onset.unwrap_or(project_end);
    let room = cut_at - last_word_end;
    if options.ending == SeqEnding::OverviewIfRoom && room >= 1.2 {
        let overview = seq_overview_for(world, prev_pose.rot, resolved.viewport);
        let t0 = last_word_end + 0.3;
        segments.push(SeqSegment {
            t0: seq_q(t0, SEQ_TIME_QUANT),
            t1: seq_q(t0 + 0.6, SEQ_TIME_QUANT),
            from: prev_pose,
            to: overview,
            d_rot: 0.0,
            block: None,
            kind: SeqSegmentKind::Overview,
        });
        prev_pose = overview;
    }
    let end_t = segments.last().map_or(0.0, |segment| segment.t1);
    SeqCameraPlan {
        segments,
        end_pose: prev_pose,
        end_t,
    }
}

// ---------------------------------------------------------------- 编译
pub fn compile_caption_sequence(
    input: &CaptionSequenceInput,
    env: &CaptionSequenceEnv,
    measure: &mut dyn FnMut(&str, f64) -> f64,
) -> CaptionSequencePlan {
    let options = env.options.clone();
    let width = f64::from(env.width.max(1));
    let height = f64::from(env.height.max(1));
    let fraction = options.viewport_fraction(&env.tokens, env.bilingual);
    let viewport = [
        seq_q(fraction[0] * width, SEQ_QUANT),
        seq_q(fraction[1] * height, SEQ_QUANT),
        seq_q(fraction[2] * width, SEQ_QUANT),
        seq_q(fraction[3] * height, SEQ_QUANT),
    ];
    let mut intensity = env.intensity.clamp(0.0, 100.0);
    if let Some(cap) = options.intensity_cap {
        intensity = intensity.min(cap);
    }
    let resolved = SeqResolved {
        width,
        height,
        viewport,
        font_px: env.font_px.max(1.0),
        density: options.density.unwrap_or(env.tokens.density),
        fit: options.fit.unwrap_or(env.tokens.fit),
        intensity,
        speed: env.speed.clamp(0.25, 4.0),
        seed: env.seed,
        options,
    };
    let project_end = if input.duration > 0.0 {
        input.duration
    } else {
        input.cues.iter().map(|cue| cue.end).fold(0.0, f64::max)
    };
    let mut diagnostics = Vec::new();
    let mut sequences: Vec<SeqSequence> = Vec::new();
    for raw in seq_segment(input, &resolved) {
        let blocks: Vec<SeqBlock> = raw
            .blocks
            .iter()
            .map(|block| seq_layout_block(block, &resolved, &input.roles, measure))
            .collect();
        if blocks.is_empty() {
            continue;
        }
        let key = blocks[0].key.clone();
        let seq_seed = input.seq_seeds.get(&key).copied();
        sequences.push(SeqSequence {
            id: raw.id,
            key,
            seq_seed,
            start: raw.start,
            end: raw.end,
            blocks,
            origin: [0.0, 0.0],
            world: SeqBox::empty(),
            segments: Vec::new(),
            cut_at: 0.0,
            visible_until: project_end,
        });
    }
    let mut worlds: Vec<SeqBox> = Vec::with_capacity(sequences.len());
    let mut entry: Option<(SeqPose, f64)> = None;
    let next_onsets: Vec<Option<f64>> = (0..sequences.len())
        .map(|index| sequences.get(index + 1).map(|next| next.blocks[0].first_t))
        .collect();
    for index in 0..sequences.len() {
        let (before, rest) = sequences.split_at_mut(index);
        let seq = &mut rest[0];
        // 列顺着上一段的末角度续接：新段第一行接着同一方向往下叠
        let prev_last_rot = before
            .last()
            .map_or(0.0, |prev| prev.blocks.last().expect("blocks").rot_deg);
        let layout = seq_layout_world(
            &seq.id,
            seq.seq_seed,
            &mut seq.blocks,
            &resolved,
            &input.pins,
            &mut diagnostics,
            prev_last_rot,
        );
        let _ = layout.last_rot;
        let origin = match before.last() {
            None => [0.0, 0.0],
            Some(prev) => seq_place_world(
                &layout.world,
                &seq.blocks[0],
                prev,
                &worlds,
                &resolved,
                seq_run_side_of(prev_last_rot),
            ),
        };
        seq.origin = [seq_q(origin[0], SEQ_QUANT), seq_q(origin[1], SEQ_QUANT)];
        for block in &mut seq.blocks {
            block.local_center = block.center;
            block.center = [
                seq_q(block.center[0] + seq.origin[0], SEQ_QUANT),
                seq_q(block.center[1] + seq.origin[1], SEQ_QUANT),
            ];
        }
        seq.world = SeqBox {
            x0: seq_q(layout.world.x0 + seq.origin[0], SEQ_QUANT),
            y0: seq_q(layout.world.y0 + seq.origin[1], SEQ_QUANT),
            x1: seq_q(layout.world.x1 + seq.origin[0], SEQ_QUANT),
            y1: seq_q(layout.world.y1 + seq.origin[1], SEQ_QUANT),
        };
        worlds.push(seq.world);
        let camera = seq_plan_camera(
            &seq.world,
            &seq.blocks,
            &resolved,
            next_onsets[index],
            project_end,
            entry,
        );
        seq.cut_at = camera.segments[0].t0;
        seq.segments = camera.segments;
        entry = Some((camera.end_pose, camera.end_t));
    }
    for index in 0..sequences.len() {
        let until = sequences
            .get(index + 1)
            .map_or(project_end, |next| next.cut_at);
        sequences[index].visible_until = until;
    }
    let entrance_dur = (resolved.options.entrance_ms / 1000.0) / resolved.speed;
    let entrance_pre = seq_q(entrance_dur * resolved.options.entrance_pre, SEQ_TIME_QUANT);
    let entrance_dur = seq_q(entrance_dur, SEQ_TIME_QUANT);
    let fade_s = resolved.options.fade_ms / 1000.0;
    let mut events: Vec<f64> = Vec::new();
    for seq in &sequences {
        events.push(seq.cut_at);
        events.push(seq.visible_until);
        for segment in &seq.segments {
            events.push(segment.t0);
            events.push(segment.t1);
        }
        if let Some(first) = seq.segments.first() {
            events.push(first.t1 + fade_s);
        }
        for block in &seq.blocks {
            events.push(block.first_t - entrance_pre);
            events.push(block.first_t - entrance_pre + entrance_dur);
            for word in &block.words {
                events.push(word.start - entrance_pre);
                events.push(word.start - entrance_pre + entrance_dur);
                events.push(word.start);
                events.push(word.end);
            }
        }
    }
    events.retain(|time| time.is_finite());
    events.sort_by(f64::total_cmp);
    events.dedup();
    CaptionSequencePlan {
        seed: resolved.seed,
        width: env.width,
        height: env.height,
        viewport,
        font_px: resolved.font_px,
        density: resolved.density,
        fit: resolved.fit,
        intensity,
        speed: resolved.speed,
        reveal: resolved.options.reveal,
        zoom_log: resolved.options.zoom_log,
        css_ease: resolved.options.camera_motion == SeqCameraMotion::StopAndGo,
        entrance_dur,
        entrance_pre,
        fade_s,
        history_blocks: resolved.options.history_blocks,
        history_opacity: resolved.options.history_opacity,
        presentation: resolved.options.presentation,
        background: resolved.options.background,
        duration: project_end,
        sequences,
        diagnostics,
        events,
    }
}

// ---------------------------------------------------------------- 采样
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SeqFrameWord {
    pub opacity: f64,
    pub scale: f64,
    /// 入场缩放的原点 x（块内坐标；y 是词盒中线）：逐词时是词的左边，整块时是行的左边。
    pub pivot_x: f64,
    pub speaking: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SeqFrameBlock {
    pub idx: usize,
    pub rank: usize,
    pub opacity: f64,
    pub current: bool,
    pub words: Vec<SeqFrameWord>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SeqFrame {
    pub t: f64,
    pub seq: Option<usize>,
    pub camera: Option<SeqPose>,
    pub blocks: Vec<SeqFrameBlock>,
    /// 上一段还在淡出：`(段下标, alpha)`，用当前相机画。
    pub fading: Option<(usize, f64)>,
    /// 这一帧有连续变化（镜头在飞 / 词在入场 / 上一段在淡出）。
    pub animating: bool,
}

impl CaptionSequencePlan {
    pub fn seq_index_at(&self, t: f64) -> Option<usize> {
        let mut index = None;
        for (i, seq) in self.sequences.iter().enumerate() {
            if t >= seq.cut_at {
                index = Some(i);
            }
        }
        index
    }

    /// 某一段在 `t` 的相机姿态；返回值的第二项 = 镜头正在段内运动。
    pub fn pose_at(&self, seq: &SeqSequence, t: f64) -> (SeqPose, bool) {
        let Some(first) = seq.segments.first() else {
            return (
                SeqPose {
                    x: 0.0,
                    y: 0.0,
                    rot: 0.0,
                    zoom: 1.0,
                },
                false,
            );
        };
        if t < first.t0 {
            return (first.from, false);
        }
        let mut current = first.to;
        for segment in &seq.segments {
            if t < segment.t0 {
                break;
            }
            if t >= segment.t1 {
                current = segment.to;
                continue;
            }
            let u = (t - segment.t0) / (segment.t1 - segment.t0).max(1e-6);
            // 三个通道同一条曲线：位置、角度、缩放同时起步、同时停下
            let e = if self.css_ease {
                seq_css_ease(u)
            } else {
                seq_ease(u)
            };
            let zoom = if self.zoom_log {
                (segment.from.zoom.max(1e-9).ln()
                    + (segment.to.zoom.max(1e-9).ln() - segment.from.zoom.max(1e-9).ln()) * e)
                    .exp()
            } else {
                segment.from.zoom + (segment.to.zoom - segment.from.zoom) * e
            };
            return (
                SeqPose {
                    x: segment.from.x + (segment.to.x - segment.from.x) * e,
                    y: segment.from.y + (segment.to.y - segment.from.y) * e,
                    rot: segment.from.rot + segment.d_rot * e,
                    zoom,
                },
                true,
            );
        }
        (current, false)
    }

    pub fn sample(&self, t: f64) -> SeqFrame {
        let mut frame = SeqFrame {
            t,
            seq: None,
            camera: None,
            blocks: Vec::new(),
            fading: None,
            animating: false,
        };
        let Some(si) = self.seq_index_at(t) else {
            return frame;
        };
        let seq = &self.sequences[si];
        frame.seq = Some(si);
        let (camera, moving) = self.pose_at(seq, t);
        frame.camera = Some(camera);
        frame.animating |= moving;
        let pop_dur = self.entrance_dur.max(1e-6);
        let pre = self.entrance_pre;
        // typeMonkey.js `zoomIn`：从 `pop_from` 倍放大到 1，原点在左中，CSS `ease`；
        // 动感 60 时从 0.3 倍起（它的 `scale(.3)`），动感 0 不缩放
        // 整行入场（默认）柔一些：从 0.7 倍起，不逐字闪——中文一词一字，逐字弹太碎
        let pop_depth = match self.reveal {
            SeqReveal::Word => 0.7,
            SeqReveal::Block => 0.3,
        };
        let pop_from = 1.0 - pop_depth * (self.intensity / 60.0).clamp(0.0, 1.0);
        let mut visible: Vec<usize> = (0..seq.blocks.len())
            .filter(|&idx| seq.blocks[idx].first_t - pre <= t)
            .collect();
        visible.sort_by(|&a, &b| {
            seq.blocks[b]
                .first_t
                .total_cmp(&seq.blocks[a].first_t)
                .then_with(|| b.cmp(&a))
        });
        for (rank, &idx) in visible.iter().enumerate() {
            let block = &seq.blocks[idx];
            let opacity = if rank == 0 {
                1.0
            } else if rank <= self.history_blocks {
                self.history_opacity
            } else {
                0.0
            };
            if opacity <= 0.0 {
                continue;
            }
            let words = block
                .words
                .iter()
                .map(|word| {
                    let (onset, pivot_x) = match self.reveal {
                        SeqReveal::Word => (word.start, word.x),
                        SeqReveal::Block => (block.first_t, 0.0),
                    };
                    if onset - pre > t {
                        return SeqFrameWord {
                            opacity: 0.0,
                            scale: pop_from,
                            pivot_x,
                            speaking: false,
                        };
                    }
                    let k = ((t - (onset - pre)) / pop_dur).clamp(0.0, 1.0);
                    if k < 1.0 {
                        frame.animating = true;
                    }
                    let e = seq_css_ease(k);
                    SeqFrameWord {
                        opacity: e,
                        scale: pop_from + (1.0 - pop_from) * e,
                        pivot_x,
                        speaking: self.reveal == SeqReveal::Word
                            && rank == 0
                            && word.start <= t
                            && t < word.end,
                    }
                })
                .collect();
            frame.blocks.push(SeqFrameBlock {
                idx,
                rank,
                opacity,
                current: rank == 0,
                words,
            });
        }
        if si > 0 {
            let fade_end = seq.segments[0].t1 + self.fade_s;
            if t < fade_end {
                let alpha = 1.0 - seq_ease((t - seq.cut_at) / (fade_end - seq.cut_at).max(1e-6));
                frame.fading = Some((si - 1, alpha));
                frame.animating = true;
            }
        }
        frame
    }

    /// 编辑态取景（§3.3）：整段世界摊平在视口里（角度归零），与原型 `overviewFor(seq.world, 0)` 同。
    pub fn overview_pose(&self, seq_index: usize) -> Option<SeqPose> {
        let seq = self.sequences.get(seq_index)?;
        Some(seq_overview_for(&seq.world, 0.0, self.viewport))
    }

    /// 编辑态的一帧：总览相机、这一段**每一行**都实显（不看时间、不淡历史、不入场）。
    /// 后画的行排在后面（`rank` 反着给，画序照旧按 rank 降序）。
    pub fn overview_frame(&self, seq_index: usize) -> SeqFrame {
        let mut frame = SeqFrame {
            t: 0.0,
            seq: None,
            camera: None,
            blocks: Vec::new(),
            fading: None,
            animating: false,
        };
        let Some(seq) = self.sequences.get(seq_index) else {
            return frame;
        };
        frame.seq = Some(seq_index);
        frame.camera = self.overview_pose(seq_index);
        let count = seq.blocks.len();
        for (idx, block) in seq.blocks.iter().enumerate() {
            frame.blocks.push(SeqFrameBlock {
                idx,
                rank: count - 1 - idx,
                opacity: 1.0,
                current: true,
                words: block
                    .words
                    .iter()
                    .map(|word| SeqFrameWord {
                        opacity: 1.0,
                        scale: 1.0,
                        pivot_x: word.x,
                        speaking: false,
                    })
                    .collect(),
            });
        }
        frame
    }

    /// 某一段每一行在画布上的四角（顺时针：左上、右上、右下、左下），用给定相机投影；
    /// `center_override` 把某一行临时挪到别处（拖拽预览）。
    pub fn row_quads(
        &self,
        seq_index: usize,
        camera: &SeqPose,
        center_override: Option<(&str, [f64; 2])>,
    ) -> Vec<[[f64; 2]; 4]> {
        let Some(seq) = self.sequences.get(seq_index) else {
            return Vec::new();
        };
        let cam = self.camera_transform(camera);
        seq.blocks
            .iter()
            .map(|block| {
                let mut block_transform = block.transform();
                if let Some((key, center)) = center_override
                    && key == block.key
                {
                    block_transform = block.transform_at(center);
                }
                let m = block_transform.post_concat(cam);
                let corners = [
                    [0.0, 0.0],
                    [block.w, 0.0],
                    [block.w, block.h],
                    [0.0, block.h],
                ];
                corners.map(|[x, y]| {
                    let mut point = tiny_skia::Point::from_xy(x as f32, y as f32);
                    m.map_point(&mut point);
                    [f64::from(point.x), f64::from(point.y)]
                })
            })
            .collect()
    }

    /// 画布上一点落在哪一行（后画的优先——与画序一致）。
    pub fn pick_row(&self, seq_index: usize, camera: &SeqPose, point: [f64; 2]) -> Option<usize> {
        let quads = self.row_quads(seq_index, camera, None);
        quads
            .iter()
            .enumerate()
            .rev()
            .find(|(_, quad)| seq_point_in_quad(point, quad))
            .map(|(idx, _)| idx)
    }

    /// 画布位移 → 世界位移（按相机的角度与缩放反投影）。
    pub fn canvas_delta_to_world(&self, camera: &SeqPose, delta: [f64; 2]) -> [f64; 2] {
        let zoom = camera.zoom.max(1e-9);
        let v = seq_rot_vec(camera.rot, [delta[0] / zoom, delta[1] / zoom]);
        [v[0], v[1]]
    }

    /// 下一次离散状态变化（严格晚于 `t`）。
    pub fn next_event_after(&self, t: f64) -> Option<f64> {
        let index = self.events.partition_point(|event| *event <= t + 1e-9);
        self.events.get(index).copied()
    }

    /// 相机矩阵：世界 → 画布。`T(视口中心) · S(zoom) · R(−rot) · T(−cam)`。
    pub fn camera_transform(&self, camera: &SeqPose) -> Transform {
        let [vx, vy, vw, vh] = self.viewport;
        Transform::from_translate(-camera.x as f32, -camera.y as f32)
            .post_concat(Transform::from_rotate(-camera.rot as f32))
            .post_concat(Transform::from_scale(
                camera.zoom as f32,
                camera.zoom as f32,
            ))
            .post_concat(Transform::from_translate(
                (vx + vw / 2.0) as f32,
                (vy + vh / 2.0) as f32,
            ))
    }
}

/// 凸四边形内点判定（同向叉积）。
fn seq_point_in_quad(p: [f64; 2], quad: &[[f64; 2]; 4]) -> bool {
    let mut sign = 0i8;
    for i in 0..4 {
        let a = quad[i];
        let b = quad[(i + 1) % 4];
        let cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
        let s = if cross > 0.0 {
            1
        } else if cross < 0.0 {
            -1
        } else {
            0
        };
        if s == 0 {
            continue;
        }
        if sign == 0 {
            sign = s;
        } else if sign != s {
            return false;
        }
    }
    true
}

impl SeqBlock {
    /// 块矩阵：块内坐标 → 世界。`T(center) · R(rot) · T(−w/2, −h/2)`。
    pub fn transform(&self) -> Transform {
        self.transform_at(self.center)
    }

    /// 同 [`Self::transform`]，但中心换成给定的世界坐标（拖拽预览）。
    pub fn transform_at(&self, center: [f64; 2]) -> Transform {
        Transform::from_translate((-self.w / 2.0) as f32, (-self.h / 2.0) as f32)
            .post_concat(Transform::from_rotate(self.rot_deg as f32))
            .post_concat(Transform::from_translate(
                center[0] as f32,
                center[1] as f32,
            ))
    }
}

impl SeqWord {
    /// 入场缩放：绕 `(pivot_x, 词盒中线)` 放大 `scale`（块内坐标）——typeMonkey.js 的
    /// `transform-origin: left center`。
    pub fn pop_transform(&self, scale: f64, pivot_x: f64) -> Transform {
        if (scale - 1.0).abs() < 1e-6 {
            return Transform::identity();
        }
        let cx = pivot_x as f32;
        let cy = (self.y + self.h / 2.0) as f32;
        Transform::from_translate(-cx, -cy)
            .post_concat(Transform::from_scale(scale as f32, scale as f32))
            .post_concat(Transform::from_translate(cx, cy))
    }
}

/// 「换一版」的下一枚种子（LCG 一步；与原型 `reseed` 同式）。
pub fn caption_sequence_reseed(seed: u64) -> u64 {
    ((seed & 0xFFFF_FFFF) * 1_103_515_245 + 12345) % 2_147_483_647
}

#[cfg(test)]
mod caption_sequence_tests {
    use super::*;

    fn measure(text: &str, px: f64) -> f64 {
        caption_sequence_units(text) * px
    }

    fn cue(id: &str, start: f64, end: f64, speaker: &str, words: &[&str]) -> CaptionSequenceCue {
        let n = words.len().max(1) as f64;
        let dur = end - start;
        CaptionSequenceCue {
            id: id.to_owned(),
            start,
            end,
            speaker: Some(speaker.to_owned()),
            break_before: false,
            words: words
                .iter()
                .enumerate()
                .map(|(i, text)| Word {
                    id: format!("{id}:{i}"),
                    text: (*text).to_owned(),
                    start: start + dur * i as f64 / n,
                    end: start + dur * (i + 1) as f64 / n,
                })
                .collect(),
        }
    }

    fn demo_input() -> CaptionSequenceInput {
        CaptionSequenceInput {
            cues: vec![
                cue("c1", 0.2, 2.4, "a", &["今天", "我们", "聊聊", "动态排版。"]),
                cue("c2", 2.5, 4.9, "a", &["它", "不是", "一格", "动画，"]),
                cue("c3", 5.0, 7.2, "a", &["而是", "一份", "样式。"]),
                cue("c4", 8.4, 10.6, "b", &["换个", "人", "说话", "就另起一段"]),
                cue("c5", 10.7, 12.9, "b", &["镜头", "顺着", "文字", "走"]),
            ],
            roles: HashMap::from([("c3:2".to_owned(), SeqRole::Hero)]),
            duration: 14.0,
            pins: HashMap::new(),
            seq_seeds: HashMap::new(),
        }
    }

    fn overlaps(seq: &SeqSequence) -> usize {
        let boxes: Vec<SeqBox> = seq
            .blocks
            .iter()
            .map(|b| seq_aabb(b.center, b.w, b.h, b.rot_deg))
            .collect();
        let mut n = 0;
        for i in 0..boxes.len() {
            for j in (i + 1)..boxes.len() {
                if seq_overlap_area(&boxes[i], &boxes[j], 0.0) > 0.0 {
                    n += 1;
                }
            }
        }
        n
    }

    #[test]
    fn pinned_row_keeps_its_pose_and_the_others_avoid_it() {
        let base = plan(137);
        let seq0 = &base.sequences[0];
        assert!(seq0.blocks.len() >= 3, "demo has several rows");
        let key = seq0.blocks[2].key.clone();
        // 把第三行钉到远离自动排版的位置、竖过来
        let pin = SeqPin {
            center: [900.0, -300.0],
            rot_deg: 90.0,
        };
        let mut input = demo_input();
        input.pins.insert(key.clone(), pin);
        let pinned = compile_caption_sequence(&input, &env(137), &mut measure);
        let seq = &pinned.sequences[0];
        let row = seq.blocks.iter().find(|b| b.key == key).expect("row");
        assert!(row.pinned);
        assert_eq!(row.rot_deg, 90.0);
        assert!((row.local_center[0] - 900.0).abs() < 1e-6);
        assert!((row.local_center[1] + 300.0).abs() < 1e-6);
        assert!(seq.blocks.iter().filter(|b| b.pinned).count() == 1);
        assert_eq!(
            overlaps(seq),
            0,
            "auto rows must not overlap the pinned row"
        );
        // 后面的行顺着钉住的行往下叠（同一段、同角度）
        let next = &seq.blocks[3];
        assert_eq!(next.para, row.para);
        assert_eq!(next.rot_deg, row.rot_deg);
        // 另一段照常排（世界续接跟着上一段末角度走，位置可以不同，行数与键不变）
        let keys = |s: &SeqSequence| s.blocks.iter().map(|b| b.key.clone()).collect::<Vec<_>>();
        assert_eq!(keys(&pinned.sequences[1]), keys(&base.sequences[1]));
        assert!(pinned.sequences[1].blocks.iter().all(|b| !b.pinned));
    }

    #[test]
    fn per_sequence_seed_only_changes_that_sequence() {
        let base = plan(137);
        let key = base.sequences[1].key.clone();
        let mut input = demo_input();
        let mut changed = None;
        for n in 1..=8u64 {
            input.seq_seeds.insert(key.clone(), n);
            let p = compile_caption_sequence(&input, &env(137), &mut measure);
            assert_eq!(
                p.sequences[0].blocks, base.sequences[0].blocks,
                "first sequence untouched"
            );
            assert_eq!(p.sequences[1].seq_seed, Some(n));
            let poses = |s: &SeqSequence| {
                s.blocks
                    .iter()
                    .map(|b| (b.local_center, b.rot_deg))
                    .collect::<Vec<_>>()
            };
            if poses(&p.sequences[1]) != poses(&base.sequences[1]) {
                changed = Some(n);
                break;
            }
        }
        assert!(
            changed.is_some(),
            "some seq seed within 8 tries relayouts the second sequence"
        );
    }

    #[test]
    fn manual_break_starts_a_new_sequence() {
        let base = plan(137);
        let mut input = demo_input();
        input.cues[1].break_before = true;
        let p = compile_caption_sequence(&input, &env(137), &mut measure);
        assert_eq!(p.sequences.len(), base.sequences.len() + 1);
        assert_eq!(p.sequences[1].key, "c2:0");
        assert_eq!(p.sequences[1].blocks[0].cue_id, "c2");
    }

    #[test]
    fn overview_frame_shows_every_row_inside_the_viewport_and_picks_round_trip() {
        let p = plan(137);
        let frame = p.overview_frame(0);
        let seq = &p.sequences[0];
        assert_eq!(frame.blocks.len(), seq.blocks.len());
        assert!(frame.blocks.iter().all(|b| b.opacity == 1.0 && b.current));
        let camera = frame.camera.expect("camera");
        assert_eq!(camera.rot, 0.0);
        let [vx, vy, vw, vh] = p.viewport;
        let quads = p.row_quads(0, &camera, None);
        for quad in &quads {
            for [x, y] in quad {
                assert!(
                    *x >= vx - 1.0 && *x <= vx + vw + 1.0,
                    "x {x} inside viewport"
                );
                assert!(
                    *y >= vy - 1.0 && *y <= vy + vh + 1.0,
                    "y {y} inside viewport"
                );
            }
        }
        for (idx, quad) in quads.iter().enumerate() {
            let cx = quad.iter().map(|c| c[0]).sum::<f64>() / 4.0;
            let cy = quad.iter().map(|c| c[1]).sum::<f64>() / 4.0;
            assert_eq!(p.pick_row(0, &camera, [cx, cy]), Some(idx));
        }
        assert_eq!(p.pick_row(0, &camera, [-50.0, -50.0]), None);
        // 拖拽预览：中心换掉后四角整体平移
        let moved = p.row_quads(
            0,
            &camera,
            Some((
                &seq.blocks[0].key,
                [seq.blocks[0].center[0] + 10.0, seq.blocks[0].center[1]],
            )),
        );
        let dx = moved[0][0][0] - quads[0][0][0];
        assert!((dx - 10.0 * camera.zoom).abs() < 1e-3);
        let back = p.canvas_delta_to_world(&camera, [dx, 0.0]);
        assert!((back[0] - 10.0).abs() < 1e-6);
    }

    fn env(seed: u64) -> CaptionSequenceEnv {
        CaptionSequenceEnv {
            width: 960,
            height: 540,
            font_px: 36.0,
            bilingual: false,
            seed,
            intensity: 60.0,
            speed: 1.0,
            tokens: caption_sequence_layout_tokens(960, 540),
            options: CaptionSequenceOptions::default(),
        }
    }

    fn plan(seed: u64) -> CaptionSequencePlan {
        compile_caption_sequence(&demo_input(), &env(seed), &mut measure)
    }

    #[test]
    fn same_seed_same_world_and_other_seed_other_world() {
        let a = plan(137);
        let b = plan(137);
        assert_eq!(a, b);
        let c = plan(caption_sequence_reseed(137));
        let centers = |plan: &CaptionSequencePlan| {
            plan.sequences
                .iter()
                .flat_map(|seq| seq.blocks.iter().map(|block| (block.center, block.rot_deg)))
                .collect::<Vec<_>>()
        };
        assert_ne!(centers(&a), centers(&c));
    }

    #[test]
    fn blocks_never_overlap_and_worlds_chain_without_overlap() {
        let plan = plan(137);
        assert!(plan.sequences.len() >= 2, "{}", plan.sequences.len());
        for seq in &plan.sequences {
            let boxes: Vec<SeqBox> = seq
                .blocks
                .iter()
                .map(|block| seq_aabb(block.center, block.w, block.h, block.rot_deg))
                .collect();
            for i in 0..boxes.len() {
                for j in 0..i {
                    assert_eq!(
                        seq_overlap_area(&boxes[i], &boxes[j], 0.0),
                        0.0,
                        "{} blocks {i}/{j} overlap",
                        seq.id
                    );
                }
            }
        }
        for i in 1..plan.sequences.len() {
            for j in 0..i {
                assert_eq!(
                    seq_overlap_area(&plan.sequences[i].world, &plan.sequences[j].world, 0.0),
                    0.0
                );
            }
            let enter = plan.sequences[i].segments[0];
            assert_eq!(enter.kind, SeqSegmentKind::Enter);
            let prev_end = plan.sequences[i - 1]
                .segments
                .last()
                .map(|segment| segment.to)
                .unwrap();
            assert_eq!(enter.from, prev_end);
        }
        assert!(plan.diagnostics.is_empty(), "{:?}", plan.diagnostics);
    }

    #[test]
    fn speaker_change_and_pause_break_sequences() {
        let plan = plan(137);
        let starts: Vec<f64> = plan.sequences.iter().map(|seq| seq.start).collect();
        assert!(starts.contains(&8.4), "{starts:?}");
        assert!(starts.iter().all(|start| *start != 2.5), "{starts:?}");
    }

    #[test]
    fn hero_words_get_their_own_larger_block() {
        let plan = plan(137);
        let hero = plan
            .sequences
            .iter()
            .flat_map(|seq| seq.blocks.iter())
            .find(|block| block.hero)
            .expect("hero block");
        assert_eq!(hero.words.len(), 1);
        assert_eq!(hero.words[0].id, "c3:2");
        // 重点词单独成行，字号由「撑满列宽」定，封顶 SEQ_ROW_SCALE_HERO_MAX
        assert!(hero.font > 36.0 * 1.5, "{}", hero.font);
        assert!(hero.font <= 36.0 * SEQ_ROW_SCALE_HERO_MAX + 1e-9);
    }

    #[test]
    fn rows_are_justified_to_one_column_width() {
        let plan = plan(137);
        let col_w = 36.0 * (2.5 + 5.0 * plan.density);
        let mut justified = 0;
        for block in plan.sequences.iter().flat_map(|seq| seq.blocks.iter()) {
            let scale = block.font / 36.0;
            let cap = if block.hero {
                SEQ_ROW_SCALE_HERO_MAX
            } else {
                SEQ_ROW_SCALE_MAX
            };
            assert!(scale >= SEQ_ROW_SCALE_MIN - 1e-9 && scale <= cap + 1e-9);
            assert_eq!(
                scale * SEQ_ROW_SCALE_QUANT,
                (scale * SEQ_ROW_SCALE_QUANT).round()
            );
            // 没碰到上下限的行：文字宽与列宽差不到一档量化
            if scale > SEQ_ROW_SCALE_MIN && scale < cap {
                let natural = block.text_w / scale;
                assert!(
                    (block.text_w - col_w).abs() <= natural / SEQ_ROW_SCALE_QUANT,
                    "{} vs {col_w}",
                    block.text_w
                );
                justified += 1;
            }
        }
        assert!(justified > 0);
    }

    #[test]
    fn tone_is_rolled_per_cue_and_never_repeats_an_accent() {
        let plan = plan(137);
        for seq in &plan.sequences {
            for pair in seq.blocks.windows(2) {
                assert!(pair[1].tone <= 2);
                if pair[0].cue_id == pair[1].cue_id {
                    assert_eq!(pair[0].tone, pair[1].tone);
                } else if pair[1].tone != 0 {
                    assert_ne!(pair[0].tone, pair[1].tone);
                }
            }
        }
        assert_eq!(plan, self::plan(137));
    }

    #[test]
    fn zoom_stays_inside_the_readable_range() {
        let plan = plan(137);
        let zoom_min = 0.032 * 540.0 / 36.0;
        let zoom_max = SEQ_ZOOM_FONT_CAP * 540.0 / 36.0;
        for seq in &plan.sequences {
            for segment in &seq.segments {
                for pose in [segment.from, segment.to] {
                    assert!(
                        pose.zoom >= zoom_min - 1e-6 && pose.zoom <= zoom_max + 1e-6,
                        "{pose:?}"
                    );
                }
            }
        }
    }

    #[test]
    fn sampling_is_seek_safe_and_all_channels_share_one_ease() {
        let plan = plan(137);
        let a = plan.sample(3.7);
        let b = plan.sample(3.7);
        assert_eq!(a, b);
        let seq = &plan.sequences[0];
        let travel = seq
            .segments
            .iter()
            .find(|segment| segment.kind == SeqSegmentKind::Travel && segment.t1 > segment.t0)
            .expect("a travel segment");
        let mid = (travel.t0 + travel.t1) / 2.0;
        let (pose, moving) = plan.pose_at(seq, mid);
        assert!(moving);
        let half = |a: f64, b: f64| (a + b) / 2.0;
        assert!((pose.x - half(travel.from.x, travel.to.x)).abs() < 1e-6);
        assert!((pose.y - half(travel.from.y, travel.to.y)).abs() < 1e-6);
        assert!((pose.rot - (travel.from.rot + travel.d_rot / 2.0)).abs() < 1e-6);
        let expected_zoom = (travel.from.zoom.ln() + travel.to.zoom.ln()).exp().sqrt();
        assert!((pose.zoom - expected_zoom).abs() < 1e-6);
    }

    #[test]
    fn words_pop_in_before_their_onset_and_fade_the_previous_sequence() {
        let plan = plan(137);
        // 默认整行入场：一行的词共用行首时刻与行左缘原点，从 0.7 倍起，不标「正在说」
        assert_eq!(plan.reveal, SeqReveal::Block);
        let (row_idx, row) = plan.sequences[0]
            .blocks
            .iter()
            .enumerate()
            .skip(1)
            .find(|(_, block)| block.words.len() > 1)
            .expect("a later multi-word row");
        let before = plan.sample(row.first_t - plan.entrance_pre / 2.0);
        let block = before
            .blocks
            .iter()
            .find(|block| block.idx == row_idx)
            .unwrap();
        let state = block.words[1];
        assert!(state.opacity > 0.0 && state.opacity < 1.0);
        assert!(state.scale > 0.7 && state.scale < 1.0, "{state:?}");
        assert_eq!(state.pivot_x, 0.0);
        assert_eq!(block.words[0].scale, state.scale);
        assert!(before.animating);
        let said = plan.sample((row.words[1].start + row.words[1].end) / 2.0);
        assert!(
            said.blocks
                .iter()
                .all(|block| block.words.iter().all(|word| !word.speaking))
        );
        let second = &plan.sequences[1];
        let during = plan.sample((second.cut_at + second.segments[0].t1) / 2.0);
        assert_eq!(during.seq, Some(1));
        let (fading_index, alpha) = during.fading.expect("previous sequence still fading");
        assert_eq!(fading_index, 0);
        assert!(alpha > 0.0 && alpha < 1.0);
        let settled = plan.sample(second.segments[0].t1 + plan.fade_s + 0.01);
        assert!(settled.fading.is_none());
    }

    #[test]
    fn next_event_moves_forward_and_the_run_stays_mostly_straight() {
        let plan = plan(137);
        let mut t = 0.0;
        let mut steps = 0;
        while let Some(next) = plan.next_event_after(t) {
            assert!(next > t);
            t = next;
            steps += 1;
            assert!(steps < 10_000);
        }
        assert!(steps > 10);
        let mut travels = 0;
        let mut straight = 0;
        for seq in &plan.sequences {
            for segment in seq
                .segments
                .iter()
                .filter(|segment| segment.kind == SeqSegmentKind::Travel)
            {
                travels += 1;
                if segment.d_rot == 0.0 {
                    straight += 1;
                }
            }
        }
        assert!(travels > 0);
        assert!(
            straight as f64 >= 0.6 * travels as f64,
            "{straight}/{travels}"
        );
    }

    #[test]
    fn default_motion_turns_at_least_fifteen_percent_of_the_rows() {
        let plan = plan(137);
        let mut turns = 0usize;
        let mut total = 0usize;
        for seq in &plan.sequences {
            for pair in seq.blocks.windows(2) {
                total += 1;
                if pair[1].rot_deg != pair[0].rot_deg {
                    turns += 1;
                }
            }
        }
        assert!(total > 0);
        assert!(turns as f64 >= 0.15 * total as f64, "{turns}/{total}");
    }

    #[test]
    fn light_preset_never_turns_and_caps_the_intensity() {
        let mut light = env(137);
        light.options = CaptionSequenceOptions::from_value(Some(&serde_json::json!({
            "preset": "light"
        })));
        let plan = compile_caption_sequence(&demo_input(), &light, &mut measure);
        assert_eq!(plan.intensity, 40.0);
        for seq in &plan.sequences {
            for block in &seq.blocks {
                assert_eq!(block.rot_deg, 0.0);
            }
        }
    }

    #[test]
    fn bilingual_bottom_viewport_is_shorter_than_mono() {
        let options = CaptionSequenceOptions::from_value(Some(&serde_json::json!({
            "presentation": {"viewportMode": "bottom"}
        })));
        let tokens = caption_sequence_layout_tokens(960, 540);
        let mono = options.viewport_fraction(&tokens, false);
        let bi = options.viewport_fraction(&tokens, true);
        assert!(bi[3] < mono[3]);
        assert_eq!(
            CaptionSequenceOptions::default().viewport_fraction(&tokens, true),
            tokens.viewport
        );
    }

    #[test]
    fn stop_and_go_windows_never_run_past_the_next_onset() {
        let mut env = env(137);
        env.options = CaptionSequenceOptions::from_value(Some(&serde_json::json!({
            "camera": {"motion": "stopAndGo"}
        })));
        let plan = compile_caption_sequence(&demo_input(), &env, &mut measure);
        for seq in &plan.sequences {
            for pair in seq.segments.windows(2) {
                assert!(pair[0].t1 <= pair[1].t0 + 1e-9, "{pair:?}");
            }
            for segment in &seq.segments {
                if let Some(block) = segment.block {
                    assert!(segment.t0 <= seq.blocks[block].first_t + 1e-9);
                }
            }
        }
    }

    #[test]
    fn rows_are_left_aligned_stacked_lines_at_least_two_ems_wide() {
        let plan = plan(137);
        for seq in &plan.sequences {
            for block in &seq.blocks {
                assert!(block.lines >= 1 && block.lines as f64 <= SEQ_MERGE_MAX_LINES);
                assert_eq!(block.words[0].x, 0.0);
                assert_eq!(block.words[0].y, 0.0);
                // 行内从左往右不回头；换行时 x 归零、y 往下走一个行高
                let mut lines = 1;
                for pair in block.words.windows(2) {
                    if pair[1].y == pair[0].y {
                        assert!(pair[1].x >= pair[0].x + pair[0].w - 1e-9);
                    } else {
                        assert_eq!(pair[1].x, 0.0);
                        assert_eq!(
                            pair[1].y,
                            pair[0].y + seq_q(pair[0].font * SEQ_LINE_HEIGHT, SEQ_ROW_QUANT)
                        );
                        lines += 1;
                    }
                }
                assert_eq!(lines, block.lines);
                assert!(block.w >= SEQ_MIN_ROW_EM * block.font - 1e-9);
                assert!(block.w >= block.text_w - 1e-9);
                let last = block.words.last().unwrap();
                assert_eq!(
                    block.h,
                    last.y + seq_q(last.font * SEQ_LINE_HEIGHT, SEQ_ROW_QUANT)
                );
                assert_eq!(block.w * SEQ_ROW_QUANT, (block.w * SEQ_ROW_QUANT).round());
                assert_eq!(block.h * SEQ_ROW_QUANT, (block.h * SEQ_ROW_QUANT).round());
            }
        }
        // 一个字的行：取景宽夹到两个字宽，文字宽照实
        let one = cue("one", 0.0, 1.0, "a", &["走"]);
        let raw = SeqRawBlock {
            cue_id: one.id.clone(),
            words: one.words.clone(),
            hero: false,
        };
        let resolved = SeqResolved {
            width: 960.0,
            height: 540.0,
            viewport: plan.viewport,
            font_px: 36.0,
            density: plan.density,
            fit: plan.fit,
            intensity: 60.0,
            speed: 1.0,
            seed: 137,
            options: CaptionSequenceOptions::default(),
        };
        let row = seq_layout_block(&raw, &resolved, &HashMap::new(), &mut measure);
        // 一个字撑不满列宽：字号顶到 SEQ_ROW_SCALE_MAX
        assert_eq!(row.font, 36.0 * SEQ_ROW_SCALE_MAX);
        assert_eq!(row.text_w, row.font);
        assert_eq!(row.w, SEQ_MIN_ROW_EM * row.font);
        assert_eq!(row.h, seq_q(row.font * SEQ_LINE_HEIGHT, SEQ_ROW_QUANT));
    }

    fn flash_input() -> CaptionSequenceInput {
        let chars = |text: &str| text.chars().map(|c| c.to_string()).collect::<Vec<_>>();
        let fast = chars("这一句说得特别快一口气念完");
        let tail = chars("后面拖了一个字吗");
        CaptionSequenceInput {
            cues: vec![
                // 13 个字 1.3 s：按预算切成 5 / 5 / 3，每行只有 0.5 s 上下
                cue(
                    "f1",
                    0.0,
                    1.3,
                    "a",
                    &fast.iter().map(String::as_str).collect::<Vec<_>>(),
                ),
                // 8 个字 2.4 s：切成 5 / 3，尾巴「个字吗」…0.9 s，不算快闪
                cue(
                    "f2",
                    1.4,
                    3.8,
                    "a",
                    &tail.iter().map(String::as_str).collect::<Vec<_>>(),
                ),
                // 一个字的短句 0.3 s，紧跟着下一句
                cue("f3", 3.9, 4.2, "a", &["哦"]),
                cue("f4", 4.25, 6.0, "a", &["原来", "是", "这样", "啊"]),
            ],
            roles: HashMap::new(),
            duration: 6.5,
            pins: HashMap::new(),
            seq_seeds: HashMap::new(),
        }
    }

    #[test]
    fn flash_rows_are_merged_until_every_block_dwells_long_enough() {
        let plan = compile_caption_sequence(&flash_input(), &env(137), &mut measure);
        let mut folded = 0;
        for seq in &plan.sequences {
            for (index, block) in seq.blocks.iter().enumerate() {
                let dwell = match seq.blocks.get(index + 1) {
                    Some(next) => next.first_t - block.first_t,
                    None => block.last_t - block.first_t,
                };
                assert!(
                    dwell >= SEQ_MIN_BLOCK_DWELL_S - 1e-9,
                    "{} 只停 {dwell}s",
                    block.key
                );
                // 并块保住较早的入场时刻，词序与词时间不动
                assert_eq!(block.first_t, block.words[0].start);
                for pair in block.words.windows(2) {
                    assert!(pair[1].start >= pair[0].start);
                }
                if block.lines > 1 {
                    folded += 1;
                }
            }
        }
        assert!(folded > 0, "并完装不下一行的块应当折行");
        // 一个字都没丢
        let words: usize = plan
            .sequences
            .iter()
            .flat_map(|seq| seq.blocks.iter())
            .map(|block| block.words.len())
            .sum();
        assert_eq!(words, 13 + 8 + 1 + 4);
        // 「哦」并进了后一句，没有单独闪一下
        assert!(
            plan.sequences
                .iter()
                .flat_map(|seq| seq.blocks.iter())
                .all(|block| block.words.len() > 1)
        );
    }

    #[test]
    fn heroes_and_other_speakers_are_never_merged() {
        let mut input = flash_input();
        input.cues[2].speaker = Some("b".to_owned());
        let mut env = env(137);
        env.options.break_on_speaker_change = false;
        let plan = compile_caption_sequence(&input, &env, &mut measure);
        let lone = plan
            .sequences
            .iter()
            .flat_map(|seq| seq.blocks.iter())
            .find(|block| block.words[0].id == "f3:0")
            .expect("the other speaker's word keeps its own block");
        assert_eq!(lone.words.len(), 1);
        input.cues[2].speaker = Some("a".to_owned());
        input.roles.insert("f3:0".to_owned(), SeqRole::Hero);
        let plan = compile_caption_sequence(&input, &env, &mut measure);
        let hero = plan
            .sequences
            .iter()
            .flat_map(|seq| seq.blocks.iter())
            .find(|block| block.hero)
            .expect("hero block");
        assert_eq!(hero.words.len(), 1);
    }

    #[test]
    fn focus_normalizes_the_current_row_to_the_viewport_width() {
        let plan = plan(137);
        let [_, _, vw, _] = plan.viewport;
        let [_, _, _, vh] = plan.viewport;
        let mut normalized = 0;
        for seq in &plan.sequences {
            for segment in &seq.segments {
                let Some(index) = segment.block else { continue };
                if segment.kind == SeqSegmentKind::Overview {
                    continue;
                }
                let block = &seq.blocks[index];
                assert_eq!([segment.to.x, segment.to.y], block.center);
                // 上限按这一行自己的字号算：屏幕字号 ≤ 30% 画布高，行高 ≤ 视口高 × fit
                let cap = (SEQ_ZOOM_FONT_CAP * 540.0 / block.font).min(vh * plan.fit / block.h);
                if segment.to.zoom >= cap - 1e-2 {
                    continue;
                }
                assert!(
                    (segment.to.zoom * block.w - vw * plan.fit).abs() < vw * 1e-3,
                    "{} × {} ≠ {}",
                    segment.to.zoom,
                    block.w,
                    vw * plan.fit
                );
                normalized += 1;
            }
        }
        assert!(normalized > 0);
    }

    #[test]
    fn paragraphs_pivot_on_the_previous_row_corner() {
        let para = SeqPara {
            origin: [100.0, 50.0],
            rot: 0.0,
            height: 43.25,
        };
        let lb = seq_pivot_para(&para, 120.0, 80.0, 43.25, SeqPivot::Lb);
        assert_eq!(lb.rot, 90.0);
        let corner = seq_rot_vec(90.0, [0.0, 43.25]);
        assert_eq!(
            [lb.origin[0] + corner[0], lb.origin[1] + corner[1]],
            [100.0, 93.25]
        );
        let rb = seq_pivot_para(&para, 120.0, 80.0, 43.25, SeqPivot::Rb);
        assert_eq!(rb.rot, 270.0);
        let corner = seq_rot_vec(270.0, [80.0, 43.25]);
        assert_eq!(
            [rb.origin[0] + corner[0], rb.origin[1] + corner[1]],
            [220.0, 93.25]
        );
        assert_eq!(seq_rot_vec(90.0, [1.0, 0.0]), [0.0, 1.0]);
        assert_eq!(seq_rot_vec(270.0, [1.0, 0.0]), [0.0, -1.0]);
        assert_eq!(seq_rot_vec(180.0, [1.0, 2.0]), [-1.0, -2.0]);
        // 编译出来的段：同一段内相邻行左对齐紧贴往下叠；相邻段的角度差 ±90 或 0（跳段）
        let plan = plan(137);
        let mut turns = 0;
        for seq in &plan.sequences {
            for pair in seq.blocks.windows(2) {
                let (a, b) = (&pair[0], &pair[1]);
                if a.para == b.para {
                    let d = [b.center[0] - a.center[0], b.center[1] - a.center[1]];
                    let local = seq_rot_vec(360.0 - a.rot_deg, d);
                    assert!((local[1] - (a.h + b.h) / 2.0).abs() < 1e-6, "{a:?} → {b:?}");
                    assert!((local[0] - (b.w - a.w) / 2.0).abs() < 1e-6, "{a:?} → {b:?}");
                } else {
                    let dr = seq_norm_rot(b.rot_deg - a.rot_deg);
                    if dr == 90.0 || dr == 270.0 {
                        turns += 1;
                    } else {
                        assert_eq!(dr, 0.0);
                    }
                }
            }
        }
        assert!(turns > 0);
    }

    #[test]
    fn css_ease_matches_the_browser_curve_and_drives_stop_and_go() {
        assert_eq!(seq_css_ease(0.0), 0.0);
        assert_eq!(seq_css_ease(1.0), 1.0);
        assert!(
            (seq_css_ease(0.5) - 0.8024).abs() < 2e-3,
            "{}",
            seq_css_ease(0.5)
        );
        assert!((seq_css_ease(0.25) - 0.4085).abs() < 5e-3);
        let mut last = 0.0;
        for i in 1..=100 {
            let v = seq_css_ease(f64::from(i) / 100.0);
            assert!(v >= last - 1e-12);
            last = v;
        }
        let mut env = env(137);
        env.options = CaptionSequenceOptions::from_value(Some(&serde_json::json!({
            "camera": {"motion": "stopAndGo"}
        })));
        let plan = compile_caption_sequence(&demo_input(), &env, &mut measure);
        assert!(plan.css_ease);
        let seq = &plan.sequences[0];
        let travel = seq
            .segments
            .iter()
            .find(|segment| {
                segment.kind == SeqSegmentKind::Travel
                    && segment.d_rot == 0.0
                    && (segment.to.y - segment.from.y).abs() > 1.0
            })
            .expect("a straight travel");
        let (pose, _) = plan.pose_at(seq, (travel.t0 + travel.t1) / 2.0);
        let k = (pose.y - travel.from.y) / (travel.to.y - travel.from.y);
        assert!((k - seq_css_ease(0.5)).abs() < 1e-3, "{k}");
    }

    #[test]
    fn matrices_compose_like_the_prototype() {
        let plan = plan(137);
        let seq = &plan.sequences[0];
        let block = &seq.blocks[0];
        let camera = seq_focus_block(
            block,
            &SeqResolved {
                width: 960.0,
                height: 540.0,
                viewport: plan.viewport,
                font_px: 36.0,
                density: plan.density,
                fit: plan.fit,
                intensity: 60.0,
                speed: 1.0,
                seed: 137,
                options: CaptionSequenceOptions::default(),
            },
        );
        let tf = block
            .transform()
            .post_concat(plan.camera_transform(&camera));
        let mut center = tiny_skia::Point::from_xy((block.w / 2.0) as f32, (block.h / 2.0) as f32);
        tf.map_point(&mut center);
        let [vx, vy, vw, vh] = plan.viewport;
        assert!((f64::from(center.x) - (vx + vw / 2.0)).abs() < 0.01);
        assert!((f64::from(center.y) - (vy + vh / 2.0)).abs() < 0.01);
    }
}
