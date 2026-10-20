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
    /// User adjustments applied before validation and compilation; the scene stays as frozen.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub adjust: Option<crate::SceneAdjust>,
    /// Template provenance for restore and update hints; never read by rendering.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<crate::StyleOrigin>,
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
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub paint_style_bindings: Vec<PaintStyleBinding>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub paint_property_bindings: Vec<PaintPropertyBinding>,
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
    /// Finite list of `value_type` elements, readable only through `pick`
    /// (`caption-list-pick/1`). Omitted when false so older bodies stay byte-identical.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub list: bool,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub word_text_projection: Option<WordTextProjection>,
}
/// Instance display ranges; source word text and timing remain authoritative.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WordTextProjection {
    pub text_sha256: String,
    pub words: Vec<WordTextRange>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WordTextRange {
    pub word_id: String,
    pub start: usize,
    pub end: usize,
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
pub struct LayoutClock {
    pub time: Expression,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Layout {
    /// Cue-relative sampling clock; outer activation stays on timeline time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clock: Option<LayoutClock>,
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
    /// Entry `i` (0-based) holds the row word counts of the page that starts while
    /// `i + 1` words remain; larger remaining counts use the last entry.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remaining_word_page_plans: Option<Vec<Vec<usize>>>,
    /// What a fixed row wider than the layout width does; absent keeps it on one line.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fixed_line_overflow: Option<FixedLineOverflow>,
    /// Scales every fixed row of a page to the widest row; absent keeps the base size.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fixed_line_fit: Option<FixedLineFit>,
    /// `caption-page-tag/1`: one integer per `wordLinePattern` page, read as `unit.pageTag`;
    /// page `p` of a cue reads entry `p` modulo the pattern length.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_tags: Option<Vec<u32>>,
    /// `caption-pattern-select/1`: per-cue choice among fixed word line patterns.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pattern_select: Option<PatternSelect>,
    /// `caption-line-slots/1`: single-row pages that stay visible until `count` pages later and
    /// sit on `count` stacked rows.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line_slots: Option<LineSlots>,
    /// `caption-keyword-isolation/1`: hard row/page boundaries around tagged words.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub isolation: Vec<IsolationRule>,
    /// `caption-tag-run-isolation/1`: width-wrapped lines or pages never span a change of a
    /// word's tag state.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tag_runs: Option<TagRuns>,
}
/// A word is in the tagged state when `presentation.wordTags` lists `tag` for it; a boundary lies
/// between adjacent words whose state differs. `line` ends the display line there and `page` ends
/// the page, so a run is never split by a boundary but is still wrapped by width and quotas.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TagRuns {
    pub tag: String,
    pub mode: TagRunMode,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TagRunMode {
    Line,
    Page,
}
/// `caption-fixed-line-wrap/1`: a fixed row wider than the layout width continues on
/// further display lines, broken like width-wrapped text; row and page members stay frozen.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FixedLineOverflow {
    Wrap,
}
/// `caption-fixed-line-fit/1`: each fixed row of a page is reshaped at the base font size
/// times the widest row's width over its own. A last row narrower than `last_line_width_ratio`
/// of the widest scales by at most `last_line_max_scale`. Rows grow by `extra_line_height`
/// divided by the page's largest scale.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FixedLineFit {
    pub last_line_width_ratio: f64,
    pub last_line_max_scale: f64,
    pub extra_line_height: f64,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PatternSelect {
    pub by: PatternSelectBy,
    pub candidates: Vec<PatternCandidate>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PatternSelectBy {
    WordCount,
    Seed,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PatternCandidate {
    pub id: String,
    pub word_line_pattern: Vec<Vec<usize>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_page_rule: Option<LastPageRule>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_words: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_words: Option<usize>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IsolationRule {
    pub tag: String,
    pub mode: IsolationMode,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum IsolationMode {
    #[default]
    None,
    Line,
    Page,
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
        self.word_line_pattern.is_some()
            || self.text_line_pattern.is_some()
            || self.remaining_word_page_plans.is_some()
            || self.pattern_select.is_some()
    }
}
/// Rolling single-row pages. Page `k` (the global line index, 0-based) sits in slot
/// `k mod count`, slot 0 topmost, and its window ends where page `k + count` starts (or at the
/// end of the last page). `pitch` is the distance between neighbouring slots as a multiple of
/// the single line's line-box height.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LineSlots {
    pub count: usize,
    pub pitch: f64,
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
            remaining_word_page_plans: None,
            fixed_line_overflow: None,
            fixed_line_fit: None,
            page_tags: None,
            pattern_select: None,
            line_slots: None,
            isolation: vec![],
            tag_runs: None,
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
    /// Exact registered font bytes and face; overrides the display family for shaping.
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "deserialize_font_field")]
    pub font_source: Option<FontSource>,
    #[serde(default = "font_size")]
    pub font_size: Length,
    #[serde(default = "weight")]
    pub font_weight: u16,
    /// Optional unhinted scalable outlines; advances and shaping stay unchanged.
    #[serde(default, skip_serializing_if = "FontHinting::is_default")]
    pub font_hinting: FontHinting,
    /// Explicit nominal scalar mapping or normal OpenType shaping.
    #[serde(default, skip_serializing_if = "FontShaping::is_advanced")]
    pub font_shaping: FontShaping,
    #[serde(default)]
    pub italic: bool,
    #[serde(default)]
    pub letter_spacing: f64,
    #[serde(default = "line_height")]
    pub line_height: f64,
    /// Opt-in line boxes enclosing the actual glyph fonts rather than only an em height.
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "deserialize_font_line_box")]
    pub line_box: Option<FontLineBox>,
    #[serde(default = "white")]
    pub fill: String,
    pub stroke: Option<Stroke>,
    #[serde(default)]
    pub paints: Vec<PaintLayer>,
    /// Case mapping of the bound text before layout (`caption-text-transform/1`).
    #[serde(default, skip_serializing_if = "TextTransform::is_none")]
    pub text_transform: TextTransform,
}
/// Glyph shaping policy (`caption-font-shaping/1`); default preserves OpenType shaping.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FontShaping {
    #[default]
    Advanced,
    Nominal,
}
impl FontShaping {
    pub fn is_advanced(&self) -> bool {
        *self == Self::Advanced
    }
}
/// Outline hinting policy (`caption-font-hinting/1`); default preserves engine behavior.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FontHinting {
    #[default]
    Default,
    None,
}
impl FontHinting {
    pub fn is_default(&self) -> bool {
        *self == Self::Default
    }
}
/// An exact primary face reference (`caption-font-source/1`); missing resources fail.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FontSource {
    /// Lowercase SHA-256 of the complete registered font binary.
    pub sha256: String,
    /// Collection face index, default zero; the persistent contract allows 0..1023.
    #[serde(default)]
    pub face_index: u32,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FontLineBox {
    #[serde(default)]
    pub min_ascent: f64,
    #[serde(default)]
    pub min_descent: f64,
    #[serde(default)]
    pub metric_source: LineMetricSource,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "deserialize_font_field")]
    pub fallback_probe: Option<char>,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LineMetricSource {
    #[default]
    Font,
    Typographic,
}
fn deserialize_font_line_box<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<FontLineBox>, D::Error> {
    let value = Value::deserialize(d)?;
    if !value.is_object() {
        return Err(serde::de::Error::custom("lineBox requires an object"));
    }
    serde_json::from_value(value).map(Some).map_err(serde::de::Error::custom)
}
/// Locale-independent Unicode default case mapping. Units, selectors and word
/// timing bind to the mapped text, so a mapping that changes length (ß → SS)
/// stays one word.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TextTransform {
    #[default]
    None,
    Uppercase,
    Lowercase,
}
impl TextTransform {
    pub fn is_none(&self) -> bool {
        *self == Self::None
    }
    pub fn apply<'a>(&self, text: &'a str) -> std::borrow::Cow<'a, str> {
        match self {
            Self::None => text.into(),
            Self::Uppercase => text.to_uppercase().into(),
            Self::Lowercase => text.to_lowercase().into(),
        }
    }
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
            font_source: None,
            font_size: font_size(),
            font_weight: weight(),
            font_hinting: FontHinting::Default,
            font_shaping: FontShaping::Advanced,
            italic: false,
            letter_spacing: 0.0,
            line_height: line_height(),
            line_box: None,
            fill: white(),
            stroke: None,
            paints: vec![],
            text_transform: TextTransform::None,
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
    /// Post-origin progress policy (`caption-clock-tail/1`). Omitted when `none`
    /// so older bodies stay byte-identical.
    #[serde(default, skip_serializing_if = "ClockTail::is_none")]
    pub tail: ClockTail,
}
/// How keyframe progress continues after the clock origin. `tail` only shapes the
/// sampled value; `fill` still decides whether the track participates.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ClockTail {
    /// `u = elapsed / duration`, unbounded above.
    #[default]
    None,
    /// `u = min(elapsed, duration) / duration` after the origin.
    Clamp,
    /// `u = mod(elapsed, duration) / duration` after the origin; a period's end
    /// belongs to the next period.
    Repeat,
}
impl ClockTail {
    pub fn is_none(&self) -> bool {
        *self == Self::None
    }
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
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "deserialize_font_field")]
    pub capture: Option<CaptionLayerCapture>,
    #[serde(default)]
    pub materials: Vec<CaptionMaterial>,
    pub blend: CaptionLayerBlend,
}
/// Explicit local surface in completed-layout canvas coordinates.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CaptionLayerCapture {
    pub context_node_id: String,
    pub rect: MaterialDomain,
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CaptionLayerBlend {
    SourceOver,
    Screen,
    /// Independent per-component `S + D`, clamped; needs `caption-layer-add/1`.
    Add,
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
/// An ordered property patch on a selected word's existing logical paint layer.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PaintPropertyBinding {
    pub id: String,
    pub node_id: String,
    pub selector_id: String,
    pub paint_id: String,
    pub property: PaintProperty,
    pub composite: Composite,
    pub value: DynamicValue,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PaintProperty {
    Color,
    Blur,
}

/// A static paint-stack replacement selected by frozen word membership.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PaintStyleBinding {
    pub id: String,
    pub node_id: String,
    pub selector_id: String,
    pub style: PaintStylePatch,
}
/// The last matching binding replaces the complete stack, not individual layers.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PaintStylePatch {
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "deserialize_font_field")]
    pub fill: Option<String>,
    pub paints: Vec<PaintLayer>,
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
    /// Unit of strokeWidth, offset, spread and blur (`caption-paint-effects/1` for em).
    #[serde(default, skip_serializing_if = "PaintUnit::is_px")]
    pub unit: PaintUnit,
    /// Dilates the glyph silhouette (fill plus outline of this half-width) as one coverage.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub spread: f64,
    /// Gaussian standard deviation applied to the layer's combined coverage.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub blur: f64,
    /// Remaps isolated silhouette coverage after blur and before paint/instance alpha.
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "deserialize_font_field")]
    pub coverage: Option<PaintCoverage>,
    /// Intersects each painted glyph with its own independently positioned fill coverage.
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "deserialize_font_field")]
    pub mask: Option<PaintMask>,
    /// Replaces ordinary glyph coverage with bounded contour-distance bands.
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "deserialize_font_field")]
    pub distance_coverage: Option<GlyphDistanceCoverage>,
}
/// Distance is measured to all original flattened glyph contours. Nonzero
/// winding controls its sign; internal contours are not removed by a fill union.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GlyphDistanceCoverage {
    pub source: GlyphDistanceSource,
    pub bands: Vec<GlyphDistanceBand>,
    pub aa: GlyphDistanceAa,
    pub combine: GlyphDistanceCombine,
    pub zero_width: GlyphDistanceZeroWidth,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case", try_from = "String")]
pub enum GlyphDistanceSource {
    GlyphContours,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case", try_from = "String")]
pub enum GlyphDistanceCombine {
    Multiply,
}
/// Explicit generic policy for finite collapsed band endpoints.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case", try_from = "String")]
pub enum GlyphDistanceZeroWidth {
    Error,
    StepInclusive,
}
impl TryFrom<String> for GlyphDistanceSource {
    type Error = &'static str;
    fn try_from(value: String) -> std::result::Result<Self, Self::Error> {
        match value.as_str() {
            "glyph-contours" => Ok(Self::GlyphContours),
            _ => Err("unknown glyph distance source"),
        }
    }
}
impl TryFrom<String> for GlyphDistanceCombine {
    type Error = &'static str;
    fn try_from(value: String) -> std::result::Result<Self, Self::Error> {
        match value.as_str() {
            "multiply" => Ok(Self::Multiply),
            _ => Err("unknown glyph distance combine"),
        }
    }
}
impl TryFrom<String> for GlyphDistanceZeroWidth {
    type Error = &'static str;
    fn try_from(value: String) -> std::result::Result<Self, &'static str> {
        match value.as_str() {
            "error" => Ok(Self::Error),
            "step-inclusive" => Ok(Self::StepInclusive),
            _ => Err("unknown glyph distance zero-width policy"),
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GlyphDistanceBand {
    /// Positive offset moves the sampled contour in local paint-unit axes.
    pub offset: [f64; 2],
    pub threshold: f64,
    pub half_width: f64,
    /// Clamps the sampled signed distance before shared AA and band evaluation.
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "deserialize_font_field")]
    pub distance_clamp: Option<[f64; 2]>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "deserialize_font_field")]
    pub threshold_clamp: Option<[f64; 2]>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "deserialize_font_field")]
    pub edge_clamp: Option<[f64; 2]>,
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum GlyphDistanceAa {
    QuadDerivative {
        #[serde(rename = "sourceBand")]
        source_band: usize,
        scale: f64,
    },
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PaintMaskRasterization {
    #[default]
    Canvas,
    GlyphBounds,
}
impl PaintMaskRasterization {
    fn is_canvas(&self) -> bool {
        *self == Self::Canvas
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum PaintMask {
    GlyphFill {
        #[serde(default, skip_serializing_if = "is_zero")]
        spread: f64,
        /// Local mask offset in the owning paint unit; independent of paint offset.
        #[serde(default, skip_serializing_if = "is_zero_offset")]
        offset: [f64; 2],
        /// Multiplies by the complement of the mask alpha when true.
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        inverted: bool,
        /// Opt-in recording-time rasterization into a bounded device bitmap.
        #[serde(default, skip_serializing_if = "PaintMaskRasterization::is_canvas")]
        rasterization: PaintMaskRasterization,
    },
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PaintCoverage {
    pub lo: f64,
    pub hi: f64,
}
impl<'de> Deserialize<'de> for PaintCoverage {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Fields {
            lo: f64,
            hi: f64,
        }
        let value = Value::deserialize(deserializer)?;
        if !value.is_object() {
            return Err(serde::de::Error::custom("coverage requires an object"));
        }
        let Fields { lo, hi } = serde_json::from_value(value).map_err(serde::de::Error::custom)?;
        Ok(Self { lo, hi })
    }
}
fn is_zero(value: &f64) -> bool {
    *value == 0.0
}
fn is_zero_offset(value: &[f64; 2]) -> bool {
    *value == [0.0, 0.0]
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PaintUnit {
    /// Resolved canvas pixels, before the glyph transform.
    #[default]
    Px,
    /// Multiples of the glyph's resolved font size.
    Em,
}
impl PaintUnit {
    pub fn is_px(&self) -> bool {
        *self == Self::Px
    }
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
        /// Projection metric: local pixels by default, or the normalized line box.
        #[serde(default, skip_serializing_if = "GradientSpace::is_local")]
        space: GradientSpace,
        /// Base visual bounds used by both endpoint mapping and projection.
        #[serde(default, skip_serializing_if = "GradientDomain::is_line")]
        domain: GradientDomain,
        /// Glyph domain only: ink box growth per side, in the glyph's resolved font size.
        #[serde(rename = "glyphOutset", default, skip_serializing_if = "is_zero")]
        glyph_outset: f64,
    },
    /// PNG sampling in an explicit pre-pose glyph, line or page coordinate domain.
    Image {
        #[serde(rename = "resourceId")]
        resource_id: String,
        /// Canvas convention: U=a*x+c*y+e, V=b*x+d*y+f. No implicit fit mapping.
        #[serde(rename = "uvTransform")]
        uv_transform: [f64; 6],
        space: ImagePaintSpace,
        /// Glyph-normalized domain growth per side in the resolved glyph font size.
        #[serde(rename = "glyphOutset", default, skip_serializing_if = "is_zero")]
        glyph_outset: f64,
        #[serde(default, skip_serializing_if = "ImagePaintWrap::is_clamp")]
        wrap: ImagePaintWrap,
        #[serde(default, skip_serializing_if = "ImagePaintFilter::is_bilinear")]
        filter: ImagePaintFilter,
        /// Applied to the sampled image, before source-over onto the optional base.
        #[serde(default = "image_opacity", skip_serializing_if = "is_image_opacity")]
        opacity: f64,
        /// Scales the combined image and base; effect runs apply it after isolation/blur.
        #[serde(rename = "compositeOpacity", default = "image_opacity", skip_serializing_if = "is_image_opacity")]
        composite_opacity: f64,
        #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "deserialize_font_field")]
        base: Option<Box<ScenePaint>>,
        #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "deserialize_font_field")]
        phase: Option<ImagePaintPhase>,
        #[serde(rename = "phaseOffset", default, skip_serializing_if = "is_zero")]
        phase_offset: f64,
    },
    /// The glyph's resolved fill: node fill, fill animations and state styles.
    NodeFill,
}
fn image_opacity() -> f64 {
    1.0
}
fn is_image_opacity(value: &f64) -> bool {
    *value == 1.0
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ImagePaintSpace {
    GlyphEm,
    GlyphNormalized,
    LineNormalized,
    PageNormalized,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ImagePaintWrap {
    #[default]
    Clamp,
    Repeat,
    Mirror,
}
impl ImagePaintWrap {
    pub fn is_clamp(&self) -> bool {
        *self == Self::Clamp
    }
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ImagePaintFilter {
    Nearest,
    #[default]
    Bilinear,
}
impl ImagePaintFilter {
    pub fn is_bilinear(&self) -> bool {
        *self == Self::Bilinear
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImagePaintPhase {
    pub period: u32,
    pub source: ImagePaintPhaseSource,
    #[serde(default, skip_serializing_if = "ImagePhaseArithmetic::is_integer")]
    pub arithmetic: ImagePhaseArithmetic,
    /// Added to the input index before float32 division/fract; default zero.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub index_offset: f64,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ImagePhaseArithmetic {
    #[default]
    IntegerModulo,
    Float32,
}
impl ImagePhaseArithmetic {
    pub fn is_integer(&self) -> bool {
        *self == Self::IntegerModulo
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ImagePaintPhaseSource {
    /// Logical Unicode scalar start in the complete transformed cue (or label's own string).
    CueScalarIndex,
    /// Same logical scalar stream, relative to the layout page's source range.
    PageScalarIndex,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GradientSpace {
    #[default]
    Local,
    Normalized,
}
impl GradientSpace {
    pub fn is_local(&self) -> bool {
        *self == Self::Local
    }
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GradientDomain {
    #[default]
    Line,
    Page,
    /// Each glyph's own outline ink box, so every glyph carries the whole ramp.
    Glyph,
}
impl GradientDomain {
    pub fn is_line(&self) -> bool {
        *self == Self::Line
    }
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
    /// Time-independent size for the compile-time reference layout.
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "deserialize_font_field")]
    pub reference_value: Option<DynamicValue>,
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
    /// Exact face override. A family-only patch retains the named-family semantics.
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "deserialize_font_field")]
    pub font_source: Option<FontSource>,
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

fn deserialize_wave_context<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Option<String>, D::Error> {
    // Missing keeps the cue-only context; an explicit field must name a node.
    String::deserialize(deserializer).map(Some)
}
fn deserialize_glow_tint<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Option<DynamicValue>, D::Error> {
    // Missing means default white; an explicit field must contain a typed value.
    DynamicValue::deserialize(deserializer).map(Some)
}
fn deserialize_spacing_ramp<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Option<GaussianSpacingRamp>, D::Error> {
    GaussianSpacingRamp::deserialize(deserializer).map(Some)
}
fn deserialize_gaussian_sampling<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Option<GaussianSamplingDomain>, D::Error> {
    GaussianSamplingDomain::deserialize(deserializer).map(Some)
}
fn deserialize_gaussian_order<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Option<GaussianSampleOrder>, D::Error> {
    GaussianSampleOrder::deserialize(deserializer).map(Some)
}

fn deserialize_glow_color_matrix<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Option<[f64; 9]>, D::Error> {
    <[f64; 9]>::deserialize(deserializer).map(Some)
}
fn deserialize_gamma_channels<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Option<GammaChannels>, D::Error> {
    GammaChannels::deserialize(deserializer).map(Some)
}
fn deserialize_glow_aggregation<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Option<GlowAggregation>, D::Error> {
    GlowAggregation::deserialize(deserializer).map(Some)
}
fn deserialize_level_gains<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Option<Vec<f64>>, D::Error> {
    Vec::<f64>::deserialize(deserializer).map(Some)
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
        /// Optional Text node whose current page context evaluates the three uniforms.
        #[serde(
            rename = "contextNodeId",
            default,
            skip_serializing_if = "Option::is_none",
            deserialize_with = "deserialize_wave_context"
        )]
        context_node_id: Option<String>,
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
    /// Fixed v1 noise field shifts normalized domain UVs equally on both axes.
    NoiseDisplace {
        id: String,
        #[serde(rename = "contextNodeId")]
        context_node_id: String,
        domain: MaterialDomain,
        #[serde(rename = "noiseScale")]
        noise_scale: [f64; 2],
        phase: DynamicValue,
        brightness: DynamicValue,
        contrast: DynamicValue,
        strength: DynamicValue,
    },
    /// Two fractal gradient-noise fields move the sample point of the page domain along both axes.
    GradientNoiseDisplace {
        id: String,
        #[serde(rename = "contextNodeId")]
        context_node_id: String,
        domain: MaterialDomain,
        #[serde(rename = "uvY")]
        uv_y: MaterialUvY,
        field: GradientNoiseDisplaceField,
        brightness: DynamicValue,
        contrast: DynamicValue,
        range: DynamicValue,
    },
    /// One resampling of the page domain: evolving noise warp, a scanning stripe that
    /// stretches the content sideways, then scanline shimmer and a global gain.
    ScanWarp {
        id: String,
        #[serde(rename = "contextNodeId")]
        context_node_id: String,
        domain: MaterialDomain,
        #[serde(rename = "uvY")]
        uv_y: MaterialUvY,
        warp: ScanWarpField,
        stripe: ScanWarpStripe,
        scanlines: ScanWarpScanlines,
        gain: DynamicValue,
    },
    /// One resampling of the page domain about its centre: the sample point is pushed along its
    /// radius by a cubic term, then moved by a constant offset.
    RadialWarp {
        id: String,
        #[serde(rename = "contextNodeId")]
        context_node_id: String,
        domain: MaterialDomain,
        #[serde(rename = "uvY")]
        uv_y: MaterialUvY,
        /// Cubic radial coefficient `k` of `p * (1 + k * |p|^2)`; positive pulls the content inward.
        strength: DynamicValue,
        /// Sample offset per axis in domain fractions, along material y (see `uvY`).
        shift: [DynamicValue; 2],
    },
    AngularSampleBlend {
        id: String,
        #[serde(rename = "contextNodeId")]
        context_node_id: String,
        domain: MaterialDomain,
        aspect: DynamicValue,
        angle: DynamicValue,
    },
    /// Two samples of one immutable input ROI, foreground over background.
    AffineOver {
        id: String,
        #[serde(rename = "contextNodeId")]
        context_node_id: String,
        sampling: GaussianSamplingDomain,
        foreground: [DynamicValue; 6],
        background: [DynamicValue; 6],
        #[serde(rename = "backgroundOpacity")]
        background_opacity: DynamicValue,
        #[serde(rename = "backgroundRgbScale")]
        background_rgb_scale: DynamicValue,
        boundary: ComponentBoundary,
    },
    /// Equally weighted samples along an explicit normalized-UV affine path.
    AffineSampleBlend {
        id: String,
        #[serde(rename = "contextNodeId")]
        context_node_id: String,
        sampling: GaussianSamplingDomain,
        /// Each matrix maps (u, v) to (a*u+c*v+tx, b*u+d*v+ty).
        transforms: Vec<[DynamicValue; 6]>,
        #[serde(rename = "sampleRange")]
        sample_range: [u32; 2],
        #[serde(rename = "distanceRange")]
        distance_range: [f64; 2],
        boundary: ComponentBoundary,
    },
    GaussianUv {
        id: String,
        #[serde(rename = "contextNodeId")]
        context_node_id: String,
        sampling: GaussianSamplingDomain,
        samples: DynamicValue,
        #[serde(rename = "stepUv")]
        step_uv: [DynamicValue; 2],
        #[serde(rename = "sigmaUv")]
        sigma_uv: DynamicValue,
        #[serde(rename = "rgbGain")]
        rgb_gain: DynamicValue,
        boundary: ComponentBoundary,
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
        #[serde(
            rename = "spacingRamp",
            default,
            skip_serializing_if = "Option::is_none",
            deserialize_with = "deserialize_spacing_ramp"
        )]
        spacing_ramp: Option<GaussianSpacingRamp>,
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            deserialize_with = "deserialize_gaussian_sampling"
        )]
        sampling: Option<GaussianSamplingDomain>,
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
        #[serde(
            rename = "gammaChannels",
            default,
            skip_serializing_if = "Option::is_none",
            deserialize_with = "deserialize_gamma_channels"
        )]
        gamma_channels: Option<GammaChannels>,
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            deserialize_with = "deserialize_glow_aggregation"
        )]
        aggregation: Option<GlowAggregation>,
        #[serde(
            rename = "levelGains",
            default,
            skip_serializing_if = "Option::is_none",
            deserialize_with = "deserialize_level_gains"
        )]
        level_gains: Option<Vec<f64>>,
        #[serde(
            rename = "levelColor",
            default,
            skip_serializing_if = "Option::is_none",
            deserialize_with = "deserialize_glow_tint"
        )]
        level_color: Option<DynamicValue>,
        composite: GlowComposite,
    },
    Feedback {
        id: String,
        samples: u32,
        step: Time,
        decay: f64,
        #[serde(default)]
        offset: [f64; 2],
        /// Sample aggregation; omitted keeps the decaying source-over stack.
        #[serde(default, skip_serializing_if = "FeedbackComposite::is_decay_over")]
        composite: FeedbackComposite,
    },
}

/// How feedback combines its re-evaluated past samples.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FeedbackComposite {
    /// Oldest to newest source-over with weight `decay^i`.
    #[default]
    DecayOver,
    /// Equal-weight mean of the premultiplied samples inside the cue.
    Mean,
}

impl FeedbackComposite {
    pub fn is_decay_over(&self) -> bool {
        *self == Self::DecayOver
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MaterialUvY {
    Up,
    Down,
}

/// Spatial modulation of Gaussian tap distance; kernel weights remain unchanged.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GaussianSpacingRamp {
    pub domain: MaterialDomain,
    pub axis: WaveAxis,
    pub start: DynamicValue,
    pub end: DynamicValue,
    pub reverse: bool,
    pub evaluation: GaussianRampEvaluation,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "deserialize_gaussian_order")]
    pub sample_order: Option<GaussianSampleOrder>,
}
/// Explicit source texel view and output quad, evaluated after layout.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GaussianSamplingDomain {
    pub input: MaterialDomain,
    pub output: MaterialDomain,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GaussianSampleOrder {
    NegativeFirst,
    PositiveFirst,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GaussianRampEvaluation {
    Center,
    PreviousSample,
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

/// Noise warp of `scan-warp`: two fractal gradient-noise fields move the sample point.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScanWarpField {
    /// Noise lattice cells per domain height (the width is scaled by the aspect ratio).
    pub scale: f64,
    pub complexity: f64,
    pub sub_impact: f64,
    pub sub_scale: f64,
    pub evolution: DynamicValue,
    /// Noise-space translation subtracted from the lattice coordinate.
    pub offset: [DynamicValue; 2],
    /// Maximum sample displacement per axis, in domain fractions.
    pub strength: [DynamicValue; 2],
    #[serde(default)]
    pub swap_axes: bool,
}

/// Noise field of `gradient-noise-displace`: static lattice shape plus the page-driven placement.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GradientNoiseDisplaceField {
    pub complexity: f64,
    /// Number of distinct lattice generations before the evolution index wraps.
    pub cycle: f64,
    pub sub_impact: f64,
    /// Percent; each octave samples the previous one at `100 / subScale` times the frequency.
    pub sub_scale: f64,
    /// Degrees turned per octave.
    pub sub_rotation: f64,
    /// Shift per octave in pixels of a domain scaled to a 720-pixel shorter side.
    pub sub_offset: [f64; 2],
    /// Degrees; turns the shifted coordinate about its midpoint with the aspect of the domain.
    pub rotation: f64,
    /// Zoom divisor of the noise coordinate; also gates the displacement amount.
    pub scale: DynamicValue,
    /// Domain-fraction translation subtracted before rotating and scaling.
    pub offset: [DynamicValue; 2],
    pub evolution: DynamicValue,
}

/// Which side of the stripe centre the stretch applies to, along material y.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ScanWarpSide {
    Above,
    Below,
}

/// Horizontal stretch about the domain centre inside a thin band; lengths are output pixels.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScanWarpStripe {
    /// Band centre as a fraction of the domain height along material y.
    pub center: DynamicValue,
    pub core_half_height: DynamicValue,
    pub falloff: DynamicValue,
    /// Soft edge of the one-sided cut at the band centre; zero is a hard cut.
    pub gate: DynamicValue,
    pub amount: DynamicValue,
    pub side: ScanWarpSide,
}

/// Brightness ripple along material y: `1 - amount * sin(pitch * y - phase)`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScanWarpScanlines {
    pub amount: DynamicValue,
    /// Radians per output pixel.
    pub pitch: f64,
    pub phase: DynamicValue,
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
    OriginalOverScreen,
}
/// Channels that take the per-pass and aggregation gamma.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GammaChannels {
    Rgb,
    Rgba,
}
/// Cascade folding: `encoded` keeps the gain-shaped encoded fold, `linear`
/// folds gamma-decoded levels with per-level gains before encoding once.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GlowAggregation {
    Encoded,
    Linear,
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
