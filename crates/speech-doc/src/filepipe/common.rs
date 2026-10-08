//! filepipe 公共层：协议常量、错误码、诊断通道、载体元数据、输入清洗。
//!
//! 本模块零 I/O、零时钟、零随机；所有函数都是纯函数。

use serde::{Deserialize, Serialize};

/// 文件契约协议版本（写入 manifest.json 的 `protocolVersion`）。
pub const PROTOCOL_VERSION: &str = "file-v1";

/// 历史 JSON 单轮契约的协议版本。
///
/// 文件契约 kind 已单轨化到 [`PROTOCOL_VERSION`]；该常量只用于仍是单轮
/// JSON 载荷的 kind（`polish-retry`、`segment`、`broll`、`cleanup`）及历史任务
/// 目录的识别（含 2026-08 之前 NDJSON 契约的 `chapters` 任务）。
pub const PROTOCOL_VERSION_JSON: &str = "json-v0";

/// 某个 LLM 调用 kind 是否走 file-v1 文件载体。
///
/// core 与宿主执行层共用这一个判据：`make_llm` 构造出来的执行器在一条命令里会被
/// 多个阶段共享（translate 与 align 同用一个 `AgentLlm`），只有这个函数能保证
/// 「谁写 `.html` / 谁标 `file-v1`」两边不会各判各的。
///
/// 判据是**字面全等**的 kind 列表：`polish-retry`（低相似单句重试）仍然是
/// json-v0 单轮契约，绝不会被 `polish` 这一项捎带进文件载体。
/// `segment-repair`（polish 波次后的定向补分段：带行号句行块，答案只回行号
/// 区间）、`seam-repair`（polish 波次后的页缝判定：页 k 末段尾窗 + 页 k+1
/// 首段头窗一块，同一索引载体）、`punct-repair`（polish 波次后对超长句只加
/// 句末标点的定向修复）与 `speaker-repair`（polish **前置**的说话人归属修复：
/// 按词编号的窗口，答案只回 `起-止 标签` 区间）与 `speaker-names`（polish
/// **收尾**的说话人实名推断：开场白与首次登场证据，答案只回 `标签 = 名字` 行）
/// 都是纯文本文件载体。
/// `align-edges`（块对齐边，缺省对齐载体）与 `align-rewrite`（单调化显示改写）
/// 都是 HTML 表格载体（对齐块设计 §6）。
/// `chapters`（Map 页：段落 HTML → 章节标题/概要/首段锚）与 `chapters-outline`
/// （Reduce：话题单元大纲 → 全局章节）都是 HTML 载体（[`super::chapters_html`]）。
/// `translate-lines`（`--align-fusion lines`）是翻译的行文本载体
/// （[`super::lines_translation`]），纯文本。
pub fn uses_file_contract(kind: &str) -> bool {
    matches!(
        kind,
        "translate"
            | "translate-lines"
            | "polish"
            | "align"
            | "align-edges"
            | "align-rewrite"
            | "analysis"
            | "translate-brief"
            | "segment-repair"
            | "seam-repair"
            | "punct-repair"
            | "speaker-repair"
            | "speaker-names"
            | "chapters"
            | "chapters-outline"
    )
}

/// 一次页级尝试的材料，供宿主写 `ai/<stage>/…/vNNN/`（§4/§11）。
///
/// core 不做 I/O、不取时钟、不哈希：文件名、`sha256` 与时间戳全部由宿主补。
/// translate 与 polish 共用同一形状（见各自的类型别名），避免宿主为每个阶段
/// 各写一份产物落盘器。
#[derive(Debug, Clone)]
pub struct PageAttempt<'a> {
    /// 页 id（`p001`…；translate 跨页的全局残余波次为 `residual`）。
    pub page_id: &'a str,
    /// 该页的第几次尝试，1 起。
    pub attempt: u32,
    /// 实际发出的渲染文本（即 `DocumentRequest.input.content`）。
    pub input: &'a str,
    /// 模型原样输出。
    pub output: &'a str,
    /// 解析出的 §10 问题。
    pub problems: &'a [Problem],
    /// 本页是否整体被接受。
    pub accepted: bool,
}

/// translate 载体的 `data-bcut-format` 值。
pub const TRANSLATION_SOURCE_FORMAT: &str = "translation-source/1";
/// align 载体的 `data-bcut-format` 值。
pub const ALIGN_TABLE_FORMAT: &str = "align-table/1";
/// align 缺省载体（对齐块设计 §6.1）：块对齐边表的 `data-bcut-format` 值。
pub const ALIGN_EDGES_FORMAT: &str = "align-edges/1";
/// 单调化显示改写窄任务（对齐块设计 §6.3）的 `data-bcut-format` 值。
pub const ALIGN_REWRITE_FORMAT: &str = "align-rewrite/1";
/// polish 载体的格式标识（纯文本无处安放属性，仅用于 manifest/请求元数据）。
pub const POLISH_TEXT_FORMAT: &str = "polish-text/1";
/// context.md 载体的格式标识（写入 frontmatter 的 `format`）。
pub const CONTEXT_DOC_FORMAT: &str = "context-doc/1";

/// 输出尺寸上限系数（§16）。
///
/// **硬顶语义**（重试策略重设计 R2）：护栏不再是「答案是否偏长」的质量判据，
/// 而是「载荷是否还值得解析」的最后一道闸。偏长但结构完整的答案（例如 analysis
/// 把常用词也写成术语行）由各 kind 的单元级规则去重/截断，只有超过硬顶才判
/// page-fatal。系数因此从 4× 上调到 8×。
pub const OUTPUT_SIZE_MULTIPLIER: usize = 8;
/// 输出尺寸上限下限值，避免极短输入把阈值压到不可用。
pub const OUTPUT_SIZE_FLOOR_CHARS: usize = 4096;

/// 输入字符数 → 允许的最大输出字符数。
pub fn max_output_chars(input_chars: usize) -> usize {
    input_chars
        .saturating_mul(OUTPUT_SIZE_MULTIPLIER)
        .max(OUTPUT_SIZE_FLOOR_CHARS)
}

/// §10 协议错误码（闭集）。只有这些码可以进入重试/审计账本。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProblemCode {
    /// 文档被截断（期望 id 的连续后缀缺失）。
    DocumentTruncated,
    /// 输出被包裹在代码块/寒暄里且无法零成本剥离。
    DocumentWrapped,
    /// 输入自身的冻结内容与行数约束互相冲突；需先修正计划。
    InputConflict,
    /// 输出体积超过按输入估算的上限（§16 附加码）。
    DocumentOversize,
    /// 只读区/源文被修改。
    SourceDrift,
    /// 期望的 id 未出现（散点缺失）。
    MissingId,
    /// 译文为空。
    EmptyTranslation,
    /// 同一 id 出现多次。
    DuplicateId,
    /// 出现协议外的 id。
    UnknownId,
    /// 句子被搬到了别的段落/分组。
    ParagraphMove,
    /// 冻结内容（`data-editable="false"`）被修改。
    FrozenModified,
    /// 锁定术语未出现在译文中。
    GlossaryMissing,
    /// 译文主体文字脚本与目标语言明显不符。
    TargetLanguageMismatch,
    /// 译文是 TODO / Translation. / 待翻译等占位文本。
    TranslationPlaceholder,
    /// 译文逐字复制源文。
    TranslationSourceCopy,
    /// 长源句只返回异常短译文。
    TranslationTooShort,
    /// 一页大量句子塌缩成同一个短字符串。
    TranslationDuplicateCollapse,
    /// 行文本载体：相邻两块正文几乎相同——模型为凑 `≥k` 块数把同一段译文
    /// 写了两遍。该句拒收重问，不让重复文字进字幕。
    TranslationChunkRepeat,
    /// 行片拼接结果与句级译文不一致。
    AlignContentDrift,
    /// 行片超过硬上限。
    AlignOverHard,
    /// 行片切分落在非法接缝上。
    AlignIllegalSeam,
    /// 块对齐边载体：`span` 文本拼接与译文不一致（对齐块设计 §6.1）。
    AlignEdgeText,
    /// 块对齐边载体：`data-src` 序号非法（越界、不可解析、跨块重复）。
    AlignEdgeOrdinal,
    /// context 文档结构或取值非法（未知 Category、表头不符、缺必需小节）。
    ///
    /// §10 表面向分页编辑阶段，未覆盖 context.md 的结构校验；本码是本实现
    /// 相对设计文档的第二处补充（第一处是 [`ProblemCode::DocumentOversize`]）。
    ContextInvalid,
    /// 单个段落超过词数阈值（分段退化：模型没分段，糊成超长段落）。
    /// 主 polish 页**不因它拒收**（正文首轮即接受）；它只出现在波次后的
    /// `segment-repair` 索引契约答案里：某块只回了一个区间而整块超限，
    /// detail 即定向重试指令（含最少段数）。轮次耗尽后由引擎按停顿等级
    /// 确定性收口，出口不再有超限段落。
    ParagraphOversize,
    /// 索引契约（`segment-repair` / `seam-repair`）答案的行号区间非法：缺块、
    /// 没有区间、不从 1 开始、不首尾相接、不覆盖到末行或越界。detail 定位
    /// 首个缺陷，是下一轮的定向指令。
    RangeInvalid,
    /// 单个映射句超过跨度上限（源字符 / 时长 / 显示单位）且模型没有把它切开。
    /// 主 polish 页**不因它拒收**（正文首轮即接受）；它只出现在波次后的
    /// `punct-repair` 定向修复答案里：某句被原样复述却一个句末标点都没加，
    /// detail 即定向重试指令。轮次耗尽后由引擎按源时间轴确定性切句兜底。
    SentenceOversize,
    /// 章节标题为空（chapters 载体：标题元素内无文字）。
    EmptyTitle,
    /// 章节数明显超过 `data-aim`（chapters-outline 载体：Reduce 只是照抄大纲、没有合并）。
    ChapterOverflow,
    /// 表面级瑕疵：冲突相邻标点、20+ 字母粘连的 Latin 串、悬垂假句末。
    ///
    /// 这类问题**从不拒页**（重试策略重设计 R1「advisory / unit」）：能代码归一
    /// 的先归一，剩下的按**句**进补做队列（`polish-retry` 的 `reason =
    /// surface-artifact`），耗尽后保留模型文本并计数。本码替代 polish /
    /// punct-repair 里对 [`ProblemCode::DocumentOversize`] 的误用——那让一句的
    /// 表面瑕疵拒掉整页并重掷全部句子。
    SurfaceArtifact,
    /// `speaker-names` 答案里的实名不合法：不是 `标签 = 名字` 形式、空值、
    /// 超长（模型把整句介绍抄了回来）、含 `=`，或名字本身仍是占位标签。
    SpeakerNameInvalid,
}

impl ProblemCode {
    /// 机器可读的码字符串（kebab-case，与 §10 表一致）。
    pub fn as_str(self) -> &'static str {
        match self {
            Self::DocumentTruncated => "document-truncated",
            Self::DocumentWrapped => "document-wrapped",
            Self::InputConflict => "input-conflict",
            Self::DocumentOversize => "document-oversize",
            Self::SourceDrift => "source-drift",
            Self::MissingId => "missing-id",
            Self::EmptyTranslation => "empty-translation",
            Self::DuplicateId => "duplicate-id",
            Self::UnknownId => "unknown-id",
            Self::ParagraphMove => "paragraph-move",
            Self::FrozenModified => "frozen-modified",
            Self::GlossaryMissing => "glossary-missing",
            Self::TargetLanguageMismatch => "target-language-mismatch",
            Self::TranslationPlaceholder => "translation-placeholder",
            Self::TranslationSourceCopy => "translation-source-copy",
            Self::TranslationTooShort => "translation-too-short",
            Self::TranslationDuplicateCollapse => "translation-duplicate-collapse",
            Self::TranslationChunkRepeat => "translation-chunk-repeat",
            Self::AlignContentDrift => "align-content-drift",
            Self::AlignOverHard => "align-over-hard",
            Self::AlignIllegalSeam => "align-illegal-seam",
            Self::AlignEdgeText => "align-edge-text",
            Self::AlignEdgeOrdinal => "align-edge-ordinal",
            Self::ContextInvalid => "context-invalid",
            Self::ParagraphOversize => "paragraph-oversize",
            Self::RangeInvalid => "range-invalid",
            Self::SentenceOversize => "sentence-oversize",
            Self::EmptyTitle => "empty-title",
            Self::ChapterOverflow => "chapter-overflow",
            Self::SpeakerNameInvalid => "speaker-name-invalid",
            Self::SurfaceArtifact => "surface-artifact",
        }
    }
}

impl std::fmt::Display for ProblemCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// 非协议诊断码：只做可观测性，不参与重试账本。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WarningCode {
    /// 剥掉了单层代码块包裹（零成本恢复）。
    WrapperStripped,
    /// 剥掉了非法控制/不可见字符。
    ControlStripped,
    /// 合并了 ≥3 连续换行。
    BlankLinesCollapsed,
    /// 残留的软标记被剥除。
    MarkerResidue,
    /// 丢弃了不安全节点（script/style/iframe…）。
    NodeDropped,
    /// 丢弃了非白名单属性。
    AttributeDropped,
    /// 渲染时中和了与哨兵字面量冲突的源文。
    SentinelNeutralized,
    /// `rowspan` 与实际组内行数不符（纯冗余校验）。
    RowspanMismatch,
    /// 出现在协议外、被忽略的内容。
    ContentIgnored,
    /// 程序按 ⏹ 强制补回的段落边界。
    BoundaryForced,
    /// 对齐行片超过 hard 且译文不存在合法切分（巨型 Latin 记号、每条缝都是
    /// 客观语病）：提交期放行，引擎按 hard 机械硬切。片内或整句存在合法切分
    /// 时仍报 [`ProblemCode::AlignOverHard`]（带切法提示）。
    AlignOverHardUncuttable,
    /// chapters 载体：模型写的锚 id 不存在，已按开头片段唯一命中的段落修复。
    AnchorRepaired,
    /// chapters 载体：锚 id 存在，但锚上的开头片段与该段实际开头不符（以 id 为准）。
    AnchorTextMismatch,
    /// 同一 id / Source 出现多次，已代码合并或取首个（R2 代码先修）。
    DuplicateId,
    /// 行被确定性修复后接受：列数补齐/并回、未知取值降级、垃圾行丢弃。
    RowRepaired,
    /// 哨兵栅栏缺失，已由相邻栅栏推断出核心区边界（polish `recover_fences`）。
    FenceRecovered,
    /// 冲突的相邻标点已被代码归一（保留表达该边界的那一个）。
    PunctuationNormalized,
    /// 表面级瑕疵（悬垂假句末 / 粘连 Latin 串），只记诊断、不拒收；引擎按句
    /// 进补做队列（见 [`ProblemCode::SurfaceArtifact`]）。
    SurfaceArtifact,
    /// 冻结内容被改动或被搬动，已忽略模型文本、保留既有译文。
    FrozenIgnored,
}

impl WarningCode {
    /// 机器可读的码字符串。
    pub fn as_str(self) -> &'static str {
        match self {
            Self::WrapperStripped => "wrapper-stripped",
            Self::ControlStripped => "control-stripped",
            Self::BlankLinesCollapsed => "blank-lines-collapsed",
            Self::MarkerResidue => "marker-residue",
            Self::NodeDropped => "node-dropped",
            Self::AttributeDropped => "attribute-dropped",
            Self::SentinelNeutralized => "sentinel-neutralized",
            Self::RowspanMismatch => "rowspan-mismatch",
            Self::ContentIgnored => "content-ignored",
            Self::BoundaryForced => "boundary-forced",
            Self::AlignOverHardUncuttable => "align-over-hard-uncuttable",
            Self::AnchorRepaired => "anchor-repaired",
            Self::AnchorTextMismatch => "anchor-text-mismatch",
            Self::DuplicateId => "duplicate-id",
            Self::RowRepaired => "row-repaired",
            Self::FenceRecovered => "fence-recovered",
            Self::PunctuationNormalized => "punctuation-normalized",
            Self::SurfaceArtifact => "surface-artifact",
            Self::FrozenIgnored => "frozen-ignored",
        }
    }
}

impl std::fmt::Display for WarningCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// 问题定位信息。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ProblemScope {
    /// 整份文档。
    Document,
    /// 某一页。
    Page {
        /// 页 id（如 `p001`）。
        id: String,
    },
    /// 某个句子/分组 id（如 `s-g1.0`）。
    Sentence {
        /// 句 id。
        id: String,
    },
    /// 核心区里的第 n 个段落（0 基）。
    Paragraph {
        /// 段落序号。
        index: usize,
    },
}

impl ProblemScope {
    /// 人读定位串。
    pub fn describe(&self) -> String {
        match self {
            Self::Document => "document".to_owned(),
            Self::Page { id } => format!("page {id}"),
            Self::Sentence { id } => format!("sentence {id}"),
            Self::Paragraph { index } => format!("paragraph #{index}"),
        }
    }
}

/// 协议级问题：机器可读 code + 人读 message + 定位。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Problem {
    /// §10 错误码。
    pub code: ProblemCode,
    /// 定位信息。
    pub scope: ProblemScope,
    /// 人读说明（用于回灌给模型）。
    pub detail: String,
}

impl Problem {
    /// 文档级问题。
    pub fn document(code: ProblemCode, detail: impl Into<String>) -> Self {
        Self {
            code,
            scope: ProblemScope::Document,
            detail: detail.into(),
        }
    }

    /// 页级问题。
    pub fn page(code: ProblemCode, id: impl Into<String>, detail: impl Into<String>) -> Self {
        Self {
            code,
            scope: ProblemScope::Page { id: id.into() },
            detail: detail.into(),
        }
    }

    /// 句级问题。
    pub fn sentence(code: ProblemCode, id: impl Into<String>, detail: impl Into<String>) -> Self {
        Self {
            code,
            scope: ProblemScope::Sentence { id: id.into() },
            detail: detail.into(),
        }
    }

    /// 段落级问题。
    pub fn paragraph(code: ProblemCode, index: usize, detail: impl Into<String>) -> Self {
        Self {
            code,
            scope: ProblemScope::Paragraph { index },
            detail: detail.into(),
        }
    }

    /// 单行人读描述。
    pub fn message(&self) -> String {
        format!("[{}] {}: {}", self.code, self.scope.describe(), self.detail)
    }
}

/// 非协议诊断。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Warning {
    /// 诊断码。
    pub code: WarningCode,
    /// 定位信息。
    pub scope: ProblemScope,
    /// 人读说明。
    pub detail: String,
}

impl Warning {
    /// 文档级诊断。
    pub fn document(code: WarningCode, detail: impl Into<String>) -> Self {
        Self {
            code,
            scope: ProblemScope::Document,
            detail: detail.into(),
        }
    }

    /// 页级诊断。
    pub fn page(code: WarningCode, id: impl Into<String>, detail: impl Into<String>) -> Self {
        Self {
            code,
            scope: ProblemScope::Page { id: id.into() },
            detail: detail.into(),
        }
    }

    /// 句级诊断。
    pub fn sentence(code: WarningCode, id: impl Into<String>, detail: impl Into<String>) -> Self {
        Self {
            code,
            scope: ProblemScope::Sentence { id: id.into() },
            detail: detail.into(),
        }
    }

    /// 段落级诊断。
    pub fn paragraph(code: WarningCode, index: usize, detail: impl Into<String>) -> Self {
        Self {
            code,
            scope: ProblemScope::Paragraph { index },
            detail: detail.into(),
        }
    }
}

/// 一次解析的全部诊断输出。
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostics {
    /// 协议级问题（进重试账本）。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub problems: Vec<Problem>,
    /// 非协议诊断（仅可观测性）。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<Warning>,
}

impl Diagnostics {
    /// 空诊断。
    pub fn new() -> Self {
        Self::default()
    }

    /// 追加协议问题。
    pub fn push_problem(&mut self, problem: Problem) {
        self.problems.push(problem);
    }

    /// 追加诊断。
    pub fn push_warning(&mut self, warning: Warning) {
        self.warnings.push(warning);
    }

    /// 是否存在协议问题。
    pub fn has_problems(&self) -> bool {
        !self.problems.is_empty()
    }

    /// 出现过的协议错误码（去重、有序）。
    pub fn codes(&self) -> Vec<ProblemCode> {
        let mut codes: Vec<ProblemCode> = self.problems.iter().map(|p| p.code).collect();
        codes.sort_unstable();
        codes.dedup();
        codes
    }

    /// 是否命中某个错误码。
    pub fn has_code(&self, code: ProblemCode) -> bool {
        self.problems.iter().any(|p| p.code == code)
    }
}

/// 载体格式。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DocumentFormat {
    /// 纯文本（polish）。
    Txt,
    /// Markdown（context/analysis）。
    Markdown,
    /// HTML（translate/align）。
    Html,
    /// JSON（manifest 等结构化产物）。
    Json,
}

impl DocumentFormat {
    /// 文件扩展名（不含点）。
    pub fn extension(self) -> &'static str {
        match self {
            Self::Txt => "txt",
            Self::Markdown => "md",
            Self::Html => "html",
            Self::Json => "json",
        }
    }

    /// 协议里使用的格式名。
    pub fn as_str(self) -> &'static str {
        self.extension()
    }
}

/// §9.1 文档产物。core 不做 I/O：`sha256` 由宿主计算后填入。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentArtifact {
    /// 逻辑文件名（如 `p001.src.html`），不含路径。
    pub name: String,
    /// 载体格式。
    pub format: DocumentFormat,
    /// 文档全文。
    pub content: String,
    /// 宿主计算的内容摘要；core 内部不计算也不校验。
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub sha256: String,
}

impl DocumentArtifact {
    /// 构造产物（`sha256` 留空，由宿主补齐）。
    pub fn new(
        name: impl Into<String>,
        format: DocumentFormat,
        content: impl Into<String>,
    ) -> Self {
        Self {
            name: name.into(),
            format,
            content: content.into(),
            sha256: String::new(),
        }
    }

    /// 附上宿主计算的摘要。
    pub fn with_sha256(mut self, sha256: impl Into<String>) -> Self {
        self.sha256 = sha256.into();
        self
    }
}

/// §9.1 文档请求：执行层与 LLM 之间的载体无关约定。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentRequest {
    /// 阶段名（`analysis` / `polish` / `translate` / `align`）。
    pub kind: String,
    /// 契约正文（提示词/规则说明）。
    pub contract: String,
    /// 待编辑的输入文档。
    pub input: DocumentArtifact,
    /// 只读参考文档（context.md、术语表等）。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub references: Vec<DocumentArtifact>,
    /// 期望的输出格式。
    pub output_format: DocumentFormat,
    /// 第几次尝试（0 基）。
    pub attempt: u32,
    /// 上一次尝试的协议问题（回灌给模型）。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub problems: Vec<Problem>,
    /// 采样温度。
    pub temperature: f32,
}

impl DocumentRequest {
    /// 构造首次请求。
    pub fn new(
        kind: impl Into<String>,
        contract: impl Into<String>,
        input: DocumentArtifact,
        output_format: DocumentFormat,
    ) -> Self {
        Self {
            kind: kind.into(),
            contract: contract.into(),
            input,
            references: Vec::new(),
            output_format,
            attempt: 0,
            problems: Vec::new(),
            temperature: 0.0,
        }
    }
}

/// 是否为不允许进入载体的控制/不可见字符（§16）。
///
/// 保留 `\n`、`\t` 以及 ZWJ/ZWNJ（emoji 与印度语系/波斯语必需）。
pub fn is_illegal_payload_char(ch: char) -> bool {
    match ch {
        '\n' | '\t' => false,
        '\u{200C}' | '\u{200D}' => false,
        c if (c as u32) < 0x20 => true,
        '\u{7F}'..='\u{9F}' => true,
        // 方向控制与不可见空白
        '\u{200B}' | '\u{200E}' | '\u{200F}' | '\u{FEFF}' => true,
        '\u{202A}'..='\u{202E}' => true,
        '\u{2060}'..='\u{2064}' => true,
        '\u{2066}'..='\u{2069}' => true,
        // 行/段分隔符：语义上等价换行，但会破坏行导向解析
        '\u{2028}' | '\u{2029}' => true,
        _ => false,
    }
}

/// 是否含非法控制/不可见字符。
pub fn contains_illegal_chars(text: &str) -> bool {
    text.chars().any(is_illegal_payload_char)
}

/// 渲染侧清洗：统一换行为 `\n` 并删除非法控制/不可见字符。
pub fn sanitize_payload_text(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '\r' => {
                if chars.peek() == Some(&'\n') {
                    chars.next();
                }
                output.push('\n');
            }
            c if is_illegal_payload_char(c) => {}
            c => output.push(c),
        }
    }
    output
}

/// 单行清洗：在 [`sanitize_payload_text`] 基础上把换行/制表折成空格并压缩空白。
pub fn sanitize_inline_text(text: &str) -> String {
    let cleaned = sanitize_payload_text(text);
    cleaned.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// 归一化后的模型输出。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NormalizedOutput {
    /// 归一化文本。
    pub text: String,
    /// 是否剥掉了 BOM。
    pub bom_stripped: bool,
    /// 是否做过换行归一（CR / CRLF → LF）。
    pub newlines_normalized: bool,
    /// 是否剥掉了非法控制字符。
    pub control_stripped: bool,
    /// 是否剥掉了单层代码块包裹。
    pub wrapper_stripped: bool,
}

impl NormalizedOutput {
    /// 把归一化过程中的动作转成诊断项。
    pub fn warnings(&self) -> Vec<Warning> {
        let mut warnings = Vec::new();
        if self.wrapper_stripped {
            warnings.push(Warning::document(
                WarningCode::WrapperStripped,
                "剥离了单层代码块包裹",
            ));
        }
        if self.control_stripped {
            warnings.push(Warning::document(
                WarningCode::ControlStripped,
                "剥离了非法控制或不可见字符",
            ));
        }
        warnings
    }
}

/// 四种载体共用的解析前归一化（§10.2 零成本恢复）：
/// 去 BOM → 换行归一 → 删非法控制字符 → 剥单层代码块包裹。
pub fn normalize_llm_output(raw: &str) -> NormalizedOutput {
    let (body, bom_stripped) = match raw.strip_prefix('\u{FEFF}') {
        Some(rest) => (rest, true),
        None => (raw, false),
    };
    let newlines_normalized = body.contains('\r');
    let cleaned = sanitize_payload_text(body);
    let control_stripped = body
        .chars()
        .any(|c| c != '\r' && is_illegal_payload_char(c));
    let (text, wrapper_stripped) = strip_single_code_fence(&cleaned);
    NormalizedOutput {
        text,
        bom_stripped,
        newlines_normalized,
        control_stripped,
        wrapper_stripped,
    }
}

/// 剥掉恰好一层完整的 ``` / ~~~ 代码块包裹；不满足条件时原样返回。
fn strip_single_code_fence(text: &str) -> (String, bool) {
    let lines: Vec<&str> = text.lines().collect();
    let fence_indices: Vec<usize> = lines
        .iter()
        .enumerate()
        .filter(|(_, line)| {
            let trimmed = line.trim();
            trimmed.starts_with("```") || trimmed.starts_with("~~~")
        })
        .map(|(index, _)| index)
        .collect();
    if fence_indices.len() != 2 {
        return (text.to_owned(), false);
    }
    let (first, last) = (fence_indices[0], fence_indices[1]);
    let leading_ok = lines[..first].iter().all(|line| line.trim().is_empty());
    let trailing_ok = lines[last + 1..].iter().all(|line| line.trim().is_empty());
    let closing_bare = {
        let trimmed = lines[last].trim();
        trimmed.chars().all(|c| c == '`') || trimmed.chars().all(|c| c == '~')
    };
    if !leading_ok || !trailing_ok || !closing_bare || last <= first {
        return (text.to_owned(), false);
    }
    let mut body = lines[first + 1..last].join("\n");
    if text.ends_with('\n') {
        body.push('\n');
    }
    (body, true)
}

/// 输出体积护栏（§16）：超过 [`max_output_chars`] 即报 `document-oversize`。
pub fn guard_output_size(input: &str, output: &str) -> Option<Problem> {
    let limit = max_output_chars(input.chars().count());
    let actual = output.chars().count();
    if actual > limit {
        return Some(Problem::document(
            ProblemCode::DocumentOversize,
            format!("输出 {actual} 字符超过上限 {limit} 字符"),
        ));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn problem_codes_render_kebab_case() {
        assert_eq!(
            ProblemCode::DocumentTruncated.as_str(),
            "document-truncated"
        );
        assert_eq!(ProblemCode::AlignIllegalSeam.as_str(), "align-illegal-seam");
        let json = serde_json::to_string(&ProblemCode::MissingId).unwrap();
        assert_eq!(json, "\"missing-id\"");
    }

    #[test]
    fn problem_message_includes_scope() {
        let problem = Problem::sentence(ProblemCode::EmptyTranslation, "s-g1.0", "译文为空");
        assert_eq!(
            problem.message(),
            "[empty-translation] sentence s-g1.0: 译文为空"
        );
    }

    #[test]
    fn sanitize_keeps_emoji_joiners_and_drops_bidi() {
        let text = "a\u{202E}b\u{200B}c\u{0007}d\u{200D}e";
        assert_eq!(sanitize_payload_text(text), "abcd\u{200D}e");
        assert!(contains_illegal_chars(text));
        assert!(!contains_illegal_chars("hello 你好 👍"));
    }

    #[test]
    fn sanitize_normalizes_crlf() {
        assert_eq!(sanitize_payload_text("a\r\nb\rc"), "a\nb\nc");
    }

    #[test]
    fn normalize_strips_single_code_fence() {
        let normalized = normalize_llm_output("```html\n<p>hi</p>\n```\n");
        assert_eq!(normalized.text, "<p>hi</p>\n");
        assert!(normalized.wrapper_stripped);
    }

    #[test]
    fn normalize_keeps_multiple_fences_intact() {
        let raw = "```\na\n```\n中间\n```\nb\n```";
        let normalized = normalize_llm_output(raw);
        assert!(!normalized.wrapper_stripped);
        assert_eq!(normalized.text, raw);
    }

    #[test]
    fn normalize_reports_control_strip() {
        let normalized = normalize_llm_output("\u{FEFF}he\u{0000}llo\r\n");
        assert_eq!(normalized.text, "hello\n");
        assert!(normalized.bom_stripped);
        assert!(normalized.control_stripped);
        assert!(normalized.newlines_normalized);
    }

    /// 硬顶语义（R2）：8× 输入才拒。真实事故里 11k 字输入配 50–67k 字答案
    /// （flash 把常用词也写成术语行）曾越过 4× 旧线而整页重试三轮全灭；抬到
    /// 8× 后照常解析，多出的行由 analysis 的单元级规则去重与截断。
    #[test]
    fn output_size_guard_uses_input_multiple() {
        assert_eq!(max_output_chars(10), OUTPUT_SIZE_FLOOR_CHARS);
        assert_eq!(max_output_chars(10_000), 80_000);
        let input = "x".repeat(11_000);
        assert!(guard_output_size(&input, &"y".repeat(67_000)).is_none());
        assert!(guard_output_size(&input, &"y".repeat(88_000)).is_none());
        let problem = guard_output_size(&input, &"y".repeat(88_001)).unwrap();
        assert_eq!(problem.code, ProblemCode::DocumentOversize);
    }

    #[test]
    fn diagnostics_dedupe_codes() {
        let mut diagnostics = Diagnostics::new();
        diagnostics.push_problem(Problem::sentence(ProblemCode::MissingId, "a", ""));
        diagnostics.push_problem(Problem::sentence(ProblemCode::MissingId, "b", ""));
        diagnostics.push_warning(Warning::document(WarningCode::ContentIgnored, ""));
        assert_eq!(diagnostics.codes(), vec![ProblemCode::MissingId]);
        assert!(diagnostics.has_code(ProblemCode::MissingId));
        assert!(diagnostics.has_problems());
    }
}
