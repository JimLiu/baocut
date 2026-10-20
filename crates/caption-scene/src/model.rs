use crate::{Expression, ValueType};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SceneStyle {
    pub schema: String,
    pub scene: SceneSource,
    #[serde(default)]
    pub parameters: BTreeMap<String, Value>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum SceneSource {
    Inline { value: Scene },
}
impl SceneStyle {
    pub fn scene(&self) -> &Scene {
        let SceneSource::Inline { value } = &self.scene;
        value
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Scene {
    pub schema: String,
    pub evaluation_version: u32,
    #[serde(default)]
    pub required_capabilities: Vec<String>,
    #[serde(default)]
    pub parameters: Vec<Parameter>,
    pub layout: Layout,
    #[serde(default)]
    pub resources: Vec<ImageResource>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sequences: Vec<ImageSequenceResource>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub render_layers: Vec<CaptionRenderLayer>,
    #[serde(default)]
    pub speech_state: SpeechState,
    pub nodes: Vec<Node>,
    #[serde(default)]
    pub selectors: Vec<Selector>,
    #[serde(default)]
    pub functions: Vec<PureFunction>,
    #[serde(default)]
    pub animations: Vec<Animation>,
    #[serde(default)]
    pub materials: Vec<CaptionMaterial>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Parameter {
    pub id: String,
    #[serde(rename = "type")]
    pub value_type: ValueType,
    pub default: Value,
    pub min: Option<f64>,
    pub max: Option<f64>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PureFunction {
    pub id: String,
    pub arguments: Vec<Argument>,
    pub returns: ValueType,
    pub body: Expression,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Argument {
    pub name: String,
    #[serde(rename = "type")]
    pub value_type: ValueType,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Presentation {
    #[serde(default)]
    pub parameters: BTreeMap<String, Value>,
    #[serde(default)]
    pub cue_overrides: Vec<CueOverride>,
    #[serde(default)]
    pub word_tags: BTreeMap<String, Vec<String>>,
    #[serde(default = "seed")]
    pub seed: String,
}
impl Default for Presentation {
    fn default() -> Self {
        Self {
            parameters: BTreeMap::new(),
            cue_overrides: vec![],
            word_tags: BTreeMap::new(),
            seed: seed(),
        }
    }
}
fn seed() -> String {
    "0000000000000000".into()
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CueOverride {
    pub cue_id: String,
    pub occurrence_id: Option<String>,
    pub parameters: BTreeMap<String, Value>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Length {
    pub value: f64,
    pub parameter: Option<String>,
    pub basis: LengthBasis,
    #[serde(default)]
    pub offset: f64,
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LengthBasis {
    Absolute,
    CanvasWidth,
    CanvasHeight,
    CanvasShortEdge,
}
impl Length {
    pub fn resolve(&self, w: u32, h: u32, parameters: &BTreeMap<String, crate::Evaluated>) -> crate::Result<f64> {
        let factor = match &self.parameter {
            Some(id) => parameters
                .get(&format!("params.{id}"))
                .ok_or_else(|| crate::invalid(id, "missing layout parameter"))?
                .number()?,
            None => 1.0,
        };
        let basis = match self.basis {
            LengthBasis::Absolute => 1.0,
            LengthBasis::CanvasWidth => w as f64,
            LengthBasis::CanvasHeight => h as f64,
            LengthBasis::CanvasShortEdge => w.min(h) as f64,
        };
        let value = self.value * factor * basis + self.offset;
        if !value.is_finite() || value.abs() > 1_000_000.0 {
            return Err(crate::invalid("length", "resolved length out of range"));
        }
        Ok(value)
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Layout {
    #[serde(default)]
    pub layout_evaluation: LayoutEvaluation,
    #[serde(default)]
    pub bindings: Vec<LayoutBinding>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub font_size_bindings: Vec<FontSizeBinding>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub font_style_bindings: Vec<FontStyleBinding>,
    #[serde(default)]
    pub overflow: LayoutOverflow,
    pub width: Length,
    pub x: Length,
    pub y: Length,
    #[serde(default = "lines")]
    pub max_lines: usize,
    #[serde(default)]
    pub pagination: Pagination,
    #[serde(default)]
    pub align: Align,
    #[serde(default)]
    pub leading_gap: LeadingGap,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_window: Option<PageWindow>,
}
/// Explicit display windows derived from neighboring input word gaps.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PageWindow {
    pub gap_threshold: Time,
    pub short_gap: GapRatios,
    pub long_gap: GapRatios,
    pub boundary: PageWindowBoundary,
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GapRatios {
    pub before: f64,
    pub after: f64,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PageWindowBoundary {
    StartInclusiveEndExclusive,
    FirstStartInclusiveEndInclusive,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LayoutEvaluation {
    #[default]
    Static,
    PerSample,
}
fn lines() -> usize {
    2
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Pagination {
    #[serde(default = "word_unit")]
    pub unit: UnitKind,
    pub max_units_per_page: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_units_per_line: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub word_page_pattern: Option<Vec<usize>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub word_line_pattern: Option<Vec<Vec<usize>>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_line_pattern: Option<TextLinePattern>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_page_rule: Option<LastPageRule>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tail_word_rule: Option<TailWordRule>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TextLinePattern {
    pub unit: TextCountUnit,
    pub lines: Vec<Vec<usize>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cluster_rules: Option<ScalarClusterRules>,
}
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScalarClusterRules {
    #[serde(default)]
    pub attachments: Vec<ScalarAttachmentRule>,
    #[serde(default)]
    pub consume_following_after: Vec<[u32; 2]>,
    #[serde(default)]
    pub joiners: Vec<u32>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScalarAttachmentRule {
    pub next: Vec<[u32; 2]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub previous: Option<Vec<[u32; 2]>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub head_excluded: Option<Vec<[u32; 2]>>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TextCountUnit {
    UnicodeScalar,
    Grapheme,
    ScalarCluster,
}
impl Pagination {
    pub fn has_fixed_lines(&self) -> bool {
        self.word_line_pattern.is_some() || self.text_line_pattern.is_some()
    }
}
/// What happens to a lone word on the last row of an incomplete final page.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TailWordRule {
    JoinPreviousLine,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LastPageRule {
    pub if_row_count_is: usize,
    pub previous_page_lines: Vec<usize>,
}
fn word_unit() -> UnitKind {
    UnitKind::Word
}
impl Default for Pagination {
    fn default() -> Self {
        Self {
            unit: UnitKind::Word,
            max_units_per_page: None,
            max_units_per_line: None,
            word_page_pattern: None,
            word_line_pattern: None,
            text_line_pattern: None,
            last_page_rule: None,
            tail_word_rule: None,
        }
    }
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Align {
    Left,
    #[default]
    Center,
    Right,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LeadingGap {
    #[default]
    Show,
    Hide,
}
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SpeechState {
    #[serde(default)]
    pub gap_policy: GapPolicy,
    #[serde(default)]
    pub tail_policy: TailPolicy,
    #[serde(default)]
    pub timing_policy: TimingPolicy,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GapPolicy {
    #[default]
    None,
    HoldPrevious,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TailPolicy {
    #[default]
    None,
    HoldLast,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TimingPolicy {
    #[default]
    RequireWordTiming,
    Estimated,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Node {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: NodeKind,
    #[serde(default)]
    pub z_index: i32,
    #[serde(default)]
    pub children: Vec<Node>,
    pub selector_id: Option<String>,
    pub resource_id: Option<String>,
    #[serde(default)]
    pub fit: ImageFit,
    #[serde(default)]
    pub style: TextStyle,
    #[serde(default)]
    pub state_styles: StateStyles,
    #[serde(default)]
    pub properties: BTreeMap<String, DynamicValue>,
    pub text: Option<TextBinding>,
    /// `caption-shape-paint/1`: a shape filled with a solid or linear paint over its drawn rect.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill_paint: Option<ScenePaint>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "source", rename_all = "kebab-case", deny_unknown_fields)]
pub enum TextBinding {
    Cue,
    Static { text: String },
}
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StateStyles {
    #[serde(default = "word_unit")]
    pub unit: UnitKind,
    pub active: Option<StatePaint>,
    pub read: Option<StatePaint>,
    pub unread: Option<StatePaint>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StatePaint {
    pub fill: String,
}
impl StateStyles {
    pub fn get(&self, state: &WordState) -> Option<&String> {
        match state {
            WordState::Active => &self.active,
            WordState::Read => &self.read,
            WordState::Unread => &self.unread,
        }
        .as_ref()
        .map(|p| &p.fill)
    }
    pub fn is_empty(&self) -> bool {
        self.active.is_none() && self.read.is_none() && self.unread.is_none()
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum NodeKind {
    Group,
    Text,
    Label,
    Shape,
    Image,
    Repeat,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TextStyle {
    #[serde(default = "font")]
    pub font_family: String,
    #[serde(default = "font_size")]
    pub font_size: Length,
    #[serde(default = "weight")]
    pub font_weight: u16,
    #[serde(default)]
    pub italic: bool,
    #[serde(default)]
    pub letter_spacing: f64,
    #[serde(default = "line_height")]
    pub line_height: f64,
    #[serde(default = "white")]
    pub fill: String,
    pub stroke: Option<Stroke>,
    #[serde(default)]
    pub paints: Vec<PaintLayer>,
}
fn font() -> String {
    "Noto Sans SC".into()
}
fn font_size() -> Length {
    Length {
        value: 0.055,
        parameter: None,
        basis: LengthBasis::CanvasShortEdge,
        offset: 0.0,
    }
}
fn weight() -> u16 {
    700
}
fn line_height() -> f64 {
    1.2
}
fn white() -> String {
    "#FFFFFF".into()
}
impl Default for TextStyle {
    fn default() -> Self {
        Self {
            font_family: font(),
            font_size: font_size(),
            font_weight: weight(),
            italic: false,
            letter_spacing: 0.0,
            line_height: line_height(),
            fill: white(),
            stroke: None,
            paints: vec![],
        }
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Stroke {
    pub width: f64,
    pub color: String,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum UnitKind {
    Cue,
    Page,
    Line,
    Word,
    Grapheme,
}
impl Default for UnitKind {
    fn default() -> Self {
        Self::Word
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WordState {
    Active,
    Read,
    Unread,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Selector {
    #[serde(default)]
    pub include_whitespace: bool,
    pub id: String,
    pub node_id: String,
    pub unit: UnitKind,
    #[serde(default)]
    pub filter: Filter,
}
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Filter {
    #[default]
    All,
    State {
        value: WordState,
    },
    Tag {
        value: String,
    },
    Range {
        start: usize,
        end: usize,
    },
    Parity {
        odd: bool,
    },
    And {
        filters: Vec<Filter>,
    },
    Or {
        filters: Vec<Filter>,
    },
    Not {
        filter: Box<Filter>,
    },
}
impl Filter {
    pub fn matches(&self, index: usize, state: WordState, tags: &[String]) -> bool {
        match self {
            Self::All => true,
            Self::State { value } => *value == state,
            Self::Tag { value } => tags.contains(value),
            Self::Range { start, end } => index >= *start && index < *end,
            Self::Parity { odd } => (index % 2 == 1) == *odd,
            Self::And { filters } => filters.iter().all(|f| f.matches(index, state, tags)),
            Self::Or { filters } => filters.iter().any(|f| f.matches(index, state, tags)),
            Self::Not { filter } => !filter.matches(index, state, tags),
        }
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Animation {
    pub id: String,
    pub target: Target,
    pub property: String,
    pub value: DynamicValue,
    pub composite: Composite,
    #[serde(default)]
    pub priority: i32,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Target {
    pub node_id: String,
    pub selector_id: Option<String>,
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Composite {
    Replace,
    Add,
    Multiply,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum DynamicValue {
    Constant {
        value: Value,
    },
    Expression {
        expression: Expression,
    },
    Keyframes {
        clock: Clock,
        keys: Vec<Keyframe>,
        #[serde(default)]
        interpolation: Interpolation,
        #[serde(default)]
        fill: Fill,
    },
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Interpolation {
    #[default]
    Linear,
    Step,
    EaseOutQuad,
    CubicBezier {
        x1: f64,
        y1: f64,
        x2: f64,
        y2: f64,
    },
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Keyframe {
    pub at: f64,
    pub value: Value,
}
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Fill {
    #[serde(default)]
    pub before: FillMode,
    #[serde(default)]
    pub after: FillMode,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FillMode {
    #[default]
    None,
    Hold,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Clock {
    pub unit: UnitKind,
    pub origin: Origin,
    #[serde(default)]
    pub offset: Time,
    pub duration: Duration,
    #[serde(default)]
    pub stagger: Time,
    pub repeat: Option<ClockRepeat>,
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Origin {
    Start,
    End,
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Time {
    pub ticks: i64,
    pub timescale: u32,
}
impl Default for Time {
    fn default() -> Self {
        Self { ticks: 0, timescale: 1000 }
    }
}
impl Time {
    pub fn seconds(self) -> f64 {
        self.ticks as f64 / self.timescale as f64
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Duration {
    Fixed { ticks: i64, timescale: u32 },
    UnitSpan,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClockRepeat {
    pub iterations: u32,
    pub mode: RepeatMode,
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RepeatMode {
    Loop,
    Yoyo,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImageResource {
    pub id: String,
    pub asset_ref: ResourceRef,
    pub content_hash: String,
}
/// Ordered independent surfaces. Nodes remain available for layout even when not selected.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CaptionRenderLayer {
    pub id: String,
    pub source: CaptionLayerSource,
    #[serde(default)]
    pub materials: Vec<CaptionMaterial>,
    pub blend: CaptionLayerBlend,
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CaptionLayerBlend {
    SourceOver,
    Screen,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum CaptionLayerSource {
    Nodes {
        #[serde(rename = "nodeIds")]
        node_ids: Vec<String>,
    },
    ImageSequence {
        #[serde(rename = "contextNodeId")]
        context_node_id: String,
        #[serde(rename = "sequenceId")]
        sequence_id: String,
        frame: DynamicValue,
        domain: MaterialDomain,
        #[serde(rename = "uvScale")]
        uv_scale: [f64; 2],
        #[serde(rename = "uvOffset")]
        uv_offset: [f64; 2],
    },
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImageSequenceResource {
    pub id: String,
    pub frames: Vec<ImageResource>,
    pub premultiply: SequencePremultiply,
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SequencePremultiply {
    Rounded,
    ShiftedByte,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResourceRef {
    pub id: String,
    pub revision: String,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ImageFit {
    #[default]
    Contain,
    Cover,
    Stretch,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PaintLayer {
    pub id: String,
    pub paint: ScenePaint,
    #[serde(default)]
    pub stroke_width: f64,
    #[serde(default)]
    pub offset: [f64; 2],
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum ScenePaint {
    Solid {
        color: String,
    },
    Linear {
        from: [f64; 2],
        to: [f64; 2],
        stops: Vec<PaintStop>,
    },
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PaintStop {
    pub at: f64,
    pub color: String,
}

/// Reflow never changes the baseline page membership or display window.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LayoutOverflow {
    #[default]
    Error,
    Visible,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LayoutBinding {
    pub node_id: Option<String>,
    pub property: String,
    pub value: DynamicValue,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FontSizeBinding {
    pub id: String,
    pub node_id: String,
    pub selector_id: String,
    pub value: DynamicValue,
}
/// A static font patch selected by frozen semantic membership.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FontStyleBinding {
    pub id: String,
    pub node_id: String,
    pub selector_id: String,
    pub style: FontStylePatch,
}
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FontStylePatch {
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "deserialize_font_field")]
    pub font_family: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "deserialize_font_field")]
    pub font_weight: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "deserialize_font_field")]
    pub italic: Option<bool>,
}
fn deserialize_font_field<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

fn deserialize_glow_tint<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Option<DynamicValue>, D::Error> {
    // Missing means default white; an explicit field must contain a typed value.
    DynamicValue::deserialize(deserializer).map(Some)
}

fn deserialize_glow_color_matrix<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Option<[f64; 9]>, D::Error> {
    <[f64; 9]>::deserialize(deserializer).map(Some)
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum CaptionMaterial {
    NoisySweep {
        id: String,
        #[serde(rename = "contextNodeId")]
        context_node_id: String,
        domain: MaterialDomain,
        position: DynamicValue,
        #[serde(rename = "maskScale")]
        mask_scale: [f64; 2],
        reveal: bool,
        #[serde(rename = "uvY")]
        uv_y: MaterialUvY,
    },
    GradientSmear {
        id: String,
        #[serde(rename = "contextNodeId")]
        context_node_id: String,
        domain: MaterialDomain,
        #[serde(rename = "rectScale")]
        rect_scale: [DynamicValue; 2],
        evolution: DynamicValue,
        seed: DynamicValue,
        stretch: DynamicValue,
        progress: DynamicValue,
        strength: [DynamicValue; 2],
        noise: GradientSmearNoise,
        #[serde(rename = "uvY")]
        uv_y: MaterialUvY,
    },
    Blur {
        id: String,
        radius: DynamicValue,
        #[serde(default = "one_pass")]
        passes: u32,
    },
    WaveDisplace {
        id: String,
        amplitude: DynamicValue,
        wavelength: DynamicValue,
        phase: DynamicValue,
        axis: WaveAxis,
    },
    SoftBand {
        id: String,
        #[serde(rename = "contextNodeId")]
        context_node_id: String,
        axis: WaveAxis,
        center: DynamicValue,
        #[serde(rename = "halfWidth")]
        half_width: DynamicValue,
        feather: DynamicValue,
        amount: DynamicValue,
        opacity: DynamicValue,
    },
    NoisePaletteMix {
        id: String,
        #[serde(rename = "contextNodeId")]
        context_node_id: String,
        #[serde(rename = "paletteResourceId")]
        palette_resource_id: String,
        #[serde(rename = "palettePosition")]
        palette_position: DynamicValue,
        phase: DynamicValue,
        domain: MaterialDomain,
    },
    AngularSampleBlend {
        id: String,
        #[serde(rename = "contextNodeId")]
        context_node_id: String,
        domain: MaterialDomain,
        aspect: DynamicValue,
        angle: DynamicValue,
    },
    GaussianAxis {
        id: String,
        #[serde(rename = "contextNodeId")]
        context_node_id: String,
        axis: WaveAxis,
        samples: DynamicValue,
        #[serde(rename = "stepUv")]
        step_uv: DynamicValue,
        #[serde(rename = "sigmaUv")]
        sigma_uv: DynamicValue,
        gamma: f64,
        boundary: ComponentBoundary,
    },
    GlowCascade {
        id: String,
        #[serde(rename = "contextNodeId")]
        context_node_id: String,
        levels: Vec<GlowLevel>,
        gamma: f64,
        intensity: DynamicValue,
        #[serde(rename = "originalOpacity")]
        original_opacity: DynamicValue,
        #[serde(
            rename = "glowTint",
            default,
            skip_serializing_if = "Option::is_none",
            deserialize_with = "deserialize_glow_tint"
        )]
        glow_tint: Option<DynamicValue>,
        #[serde(
            rename = "glowColorMatrix",
            default,
            skip_serializing_if = "Option::is_none",
            deserialize_with = "deserialize_glow_color_matrix"
        )]
        glow_color_matrix: Option<[f64; 9]>,
        composite: GlowComposite,
    },
    Feedback {
        id: String,
        samples: u32,
        step: Time,
        decay: f64,
        #[serde(default)]
        offset: [f64; 2],
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MaterialUvY {
    Up,
    Down,
}

/// Frozen, bounded octave settings; all angles are radians.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GradientSmearNoise {
    pub complexity: f64,
    pub cycle: f64,
    pub brightness: f64,
    pub range: f64,
    pub scale1: [f64; 2],
    pub scale2: [f64; 2],
    pub offset: [f64; 2],
    pub rotation: f64,
    pub sub_impact: f64,
    pub sub_scale: f64,
    pub sub_rotation: f64,
    pub sub_offset: [f64; 2],
}

/// Explicit axis-aligned canvas coordinates for a material's local texture domain.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MaterialDomain {
    pub x: DynamicValue,
    pub y: DynamicValue,
    pub width: DynamicValue,
    pub height: DynamicValue,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ComponentBoundary {
    Normalize,
    Replicate,
    Transparent,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GlowComposite {
    Screen,
    SourceOverGlow,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SurfaceScale {
    pub num: u32,
    pub den: u32,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GaussianStage {
    pub scale: SurfaceScale,
    pub samples: DynamicValue,
    pub step_uv: DynamicValue,
    pub sigma_uv: DynamicValue,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GlowLevel {
    pub horizontal: GaussianStage,
    pub vertical: GaussianStage,
}
fn one_pass() -> u32 {
    1
}

/// Displacement direction; the sine varies along the other canvas axis.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WaveAxis {
    X,
    Y,
}
