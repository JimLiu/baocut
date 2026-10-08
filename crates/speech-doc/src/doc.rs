//! §18 词原子 Transcript 文档模型（bcutTranscript 0.5，0.3 / 0.4 只读兼容）。
//!
//! `words[]` 是唯一持久化的文本与时间来源；Cue/Sentence/Para 是派生投影
//! （见 `cue` / `sentence` 模块）；用户与 AI 的结构性干预落在以词 id 为键的
//! 稀疏覆盖表。0.3 相对 0.2 的增量（v0.3 设计 §4）：`trans` 从 Cue 键改为
//! **句键真相**（`s-<首词id>` → 完整自然译句），新增 `transAlign` 对齐覆盖
//! 层（每句的展示切分：mode + 源 Cue 结构快照 + pieces）。
//!
//! 0.4 相对 0.3 的增量（对齐块设计 §5）：
//! - `autoBreaks[profile]`：布局优化器按 `LayoutProfile` 键控的自动断点 pin，
//!   与用户显式意图 `breaks` 分离；派生时 `breaks` 覆盖同键自动 pin；
//! - `transDisplay[lang][sid]`：只在触发"单调化显示改写"时存在的字幕用译文，
//!   自然译句 `trans` 保持不变；
//! - `transAlign` 条目新增 `blocks[]`（最小单调对齐块）、`correspondence`
//!   （`block` | `sentence`，取代旧 `crossing`）、`textBasis`（pieces 拼接
//!   等于 `trans` 还是 `transDisplay`）与 `aligner` 来源标识。
//!
//! 0.5 相对 0.4 的增量（韩文按空格分词，`bcut-korean-word-spacing-design.md`）：
//! - 拼接规则变了：谚文与谚文之间按词加空格（[`crate::atomize::sep_len`]），
//!   新建的韩文文稿一个어절一个词；
//! - `words[].glue`（稀疏）：这个词与前一个词之间不加空格，不论规则怎么判。
//!   0.5 之前的韩文文稿每个音节一个词，读入时给规则变化会撑开的词缝打上
//!   标记（[`mark_legacy_glue`]），词 id、覆盖表、指纹、显示都不变。任何途径
//!   反序列化出来的 [`TranscriptDoc`] 都已做过这一步，版本号同时升到当前。
//!   泰、老挝、缅甸、高棉、藏文这类词间不写空格的文字，新建稿时按词切开，
//!   短语内的词缝也带这个标记（[`crate::atomize::atomize_words`]，
//!   `bcut-unspaced-script-segmentation-design.md`）；格式仍是 0.5，已有文稿不迁移。

use std::collections::BTreeMap;

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};

/// 词原子。字段名刻意极短——几万词要进 JSON。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Word {
    /// 文档内唯一、一经分配永不复用。导入 `g<行>.<列>`；编辑新造 `w<base36ms>-<n>`。
    pub id: String,
    /// 起止媒体源秒，`t0 <= t1`，厘秒精度。
    pub t0: f64,
    pub t1: f64,
    pub text: String,
    /// 说话人 id，必须存在于 `speakers` 表。
    pub sp: String,
    /// 「贴前」：为真时这个词与前一个词之间不加空格，不论拼接规则怎么判
    /// （0.5 起；稀疏，缺省省略）。词不存空白，空格每次由
    /// [`crate::atomize::sep_len`] 现算；规则答不对的地方靠它记住原样。
    /// 拼接、量宽、断点判断都要认它（[`crate::atomize::JoinWord`]）。
    #[serde(default, skip_serializing_if = "is_false")]
    pub glue: bool,
}

impl crate::atomize::JoinWord for Word {
    fn join_text(&self) -> &str {
        &self.text
    }
    fn glued(&self) -> bool {
        self.glue
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Speaker {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hue: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Chapter {
    pub id: String,
    pub title: String,
    pub start: f64,
    pub end: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocMedia {
    /// 项目清单里的媒体 id（有项目容器时）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// CLI 平铺项目模式下的媒体路径。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    pub hash: String,
    pub duration: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sample_rate: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocEngine {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// true = 引擎给出真实词时间戳；false = 按字符权重合成。
    pub aligned_words: bool,
}

/// 分句覆盖：`break` 强制断 / `nobreak` 抑制默认断点。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BreakOverride {
    Break,
    Nobreak,
}

/// 对齐策略（v0.3 §5）：句内译文如何切成展示行。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AlignMode {
    /// 各自对齐：译文按目标语自身习惯切行，不与源 Cue 建立对应（零 LLM）。
    #[serde(rename = "independent")]
    Independent,
    /// 多对一：译片锚定到连续源词区间；源 Cue 只负责独立换行。**默认策略**。
    #[serde(rename = "manyToOne")]
    ManyToOne,
    /// 旧版强制源 Cue 一对一模式，仅用于读取历史项目；新对齐不再生成。
    #[serde(rename = "oneToOne")]
    OneToOne,
}

/// 译文展示片。manyToOne 的 `from..=to` 是句内源词下标区间；independent
/// 不带（通常由字符占比锚定到句内词边缘；片数多于源词时在整句词时窗内按
/// 阅读长度排时）。旧版 Cue 锚定片只为反序列化兼容保留，不再视为有效对齐。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TransPiece {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to: Option<usize>,
    pub text: String,
}

/// 双语对应粒度（对齐块设计 §4.5 / §5）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Correspondence {
    /// 每片译文与其 `from..=to` 源词区间语义对应（片边界只落在对齐块边界上）。
    Block,
    /// 只保证整句对应：源、译共用整句时窗，不宣称逐片对应。
    Sentence,
}

/// `pieces` 拼接等于哪份译文文本。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum TextBasis {
    /// 自然译句 `trans[lang][sid]`（缺省）。
    #[default]
    Trans,
    /// 单调化显示改写 `transDisplay[lang][sid].text`。
    Display,
}

/// 最小单调对齐块（对齐块设计 §4.3）：源侧 `src = (from, to)` 是句内词序闭区间
/// （与 `TransPiece.from/to` 同一下标空间，指向 `TransAlign.words`），目标侧
/// `tgt = (from, to)` 是 `concat(pieces.text)` 上的字符半开区间。块之间按序
/// 单调、互不重叠、连续覆盖；块内允许多对多与局部乱序。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AlignBlock {
    pub src: (usize, usize),
    pub tgt: (usize, usize),
    /// 支撑该块两侧边界的对齐边最小权重；缺省表示未知/确定性构造。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f32>,
    /// `local-reorder`（块内存在交叉边）、`anchor`（含硬锚）、`weak`（仅软边）等。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub flags: Vec<String>,
}

/// 单调化显示改写（对齐块设计 §4.5 / §6.3）：为满足字幕硬上限而按源语顺序
/// 改写的译句。只在触发改写时存在；`trans` 仍是自然译句真相。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransDisplay {
    pub text: String,
    /// 改写来源标识，如 `monotonic-rewrite`。
    pub basis: String,
    /// 改写所依据的 `trans` 文本指纹；不符 ⇒ `display-stale`（删改写与该句对齐）。
    pub trans_fingerprint: String,
}

/// 一句译文的对齐覆盖层（v0.3 §4，0.4 增补见模块文档）。不变量（violated ⇒
/// align-stale，展示降级整句上屏）：`normalize(concat(pieces.text)) ==
/// normalize(基准文本)`，基准文本由 `text_basis` 决定；manyToOne 的 `words`
/// 是当前句内完整词序列，或时间线 cut 后的有序可见词子序列；锚定片的
/// from/to 连续、无重叠并覆盖 `words`；`blocks` 非空时每片边界必须落在块
/// 边界上。independent 可用同一 `words` 子序列限定展示时窗，空数组仍表示
/// 完整句。翻译流不依赖源 Cue 结构。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransAlign {
    pub mode: AlignMode,
    /// 旧版语序交叉标记，仅用于读取已经生成的项目：读入时按
    /// `correspondence = sentence` 解释（见 [`TransAlign::correspondence`]）。
    /// 新对齐恒写 false，且该字段不再放宽目标片 hard 上限；缺字段按 false 解释。
    #[serde(default, skip_serializing_if = "is_false")]
    pub crossing: bool,
    /// 旧版源 Cue 快照，仅用于读取历史项目；新写入恒为空，校验不读取。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cues: Vec<String>,
    /// manyToOne 的句内源词 id 快照；空数组/缺字段表示无词锚或旧 Cue 条目。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub words: Vec<String>,
    /// 显式对应粒度；缺省由 mode/crossing 推导（[`TransAlign::correspondence`]）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub correspondence: Option<Correspondence>,
    /// `pieces` 拼接等于哪份文本；缺省 `trans`。
    #[serde(default, skip_serializing_if = "text_basis_is_trans")]
    pub text_basis: TextBasis,
    /// 对齐边来源标识（如 `llm-chunk+anchor/1`、`deterministic/1`）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aligner: Option<String>,
    /// 最小单调对齐块；空 = 无块层（旧条目或 independent），此时每片视为一块。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub blocks: Vec<AlignBlock>,
    pub pieces: Vec<TransPiece>,
}

impl TransAlign {
    /// 新写入条目的最小构造：无旧字段、无块层、缺省 `trans` 基准。
    pub fn new(mode: AlignMode, words: Vec<String>, pieces: Vec<TransPiece>) -> Self {
        Self {
            mode,
            crossing: false,
            cues: Vec::new(),
            words,
            correspondence: None,
            text_basis: TextBasis::Trans,
            aligner: None,
            blocks: Vec::new(),
            pieces,
        }
    }

    /// 生效的对应粒度：显式字段优先；否则旧 `crossing`、`independent` 与
    /// 无词锚条目都只保证整句对应，其余 manyToOne 词锚条目按块对应。
    pub fn correspondence(&self) -> Correspondence {
        if let Some(explicit) = self.correspondence {
            return explicit;
        }
        if self.crossing || self.mode != AlignMode::ManyToOne || self.words.is_empty() {
            Correspondence::Sentence
        } else {
            Correspondence::Block
        }
    }
}

fn text_basis_is_trans(value: &TextBasis) -> bool {
    *value == TextBasis::Trans
}

/// 阶段戳（§3.3）：谁写/谁读/何时过期见管线设计的规则表。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stages {
    /// 内容指纹：转录完成时的文本。不符 ⇒ 存在人工文本编辑。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asr: Option<String>,
    /// 版式指纹：breaks+paraBreaks+hidden 排序串。不符 ⇒ 存在人工版式干预。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asr_layout: Option<String>,
    /// 内容指纹：润色提交时。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub polish: Option<String>,
    /// 结构指纹（id）：分段提交时。纯文本润色不使其过期；重转录使其过期。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub segment: Option<String>,
    /// 内容指纹：章节提交时。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chapters: Option<String>,
    /// 文稿对齐戳（`bcut transcribe --script`）：词时间来自强制对齐而不是 ASR。
    /// 重转录（ASR）时不带这一项。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aligned: Option<AlignedStage>,
}

/// `stages.aligned`：`mode` 目前只有 `script`；`coverage` 是对齐到有效时长（≥ 20 ms）
/// 的字符占文稿字符的比例；`lowConfidence` 是时长塌成 0 的词 id，供 Agent 复核。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlignedStage {
    pub mode: String,
    pub coverage: f64,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub low_confidence: Vec<String>,
}

impl Stages {
    pub fn is_empty(&self) -> bool {
        self == &Stages::default()
    }
}

fn is_false(value: &bool) -> bool {
    !*value
}

/// 这个版本号的文稿是否早于「贴前」标记（0.5）：读入时要按旧拼接规则补标记。
fn predates_glue(version: Option<&str>) -> bool {
    version.is_some_and(|version| {
        version != TRANSCRIPT_VERSION && SUPPORTED_TRANSCRIPT_VERSIONS.contains(&version)
    })
}

/// 0.5 之前的文稿里每个词该不该带「贴前」标记，按词序给出。
///
/// 判据是 [`crate::atomize::legacy_glue`]：旧规则不加空格、新规则会加的词缝。
/// 可见词与它前面**最近的可见词**比（显示、导出、发给模型的文本拼的都是
/// 可见词，这样迁移前后逐字相同）；隐藏词与紧挨着的前一个词比。已知取舍：
/// 两个谚文词之间夹着一个不以谚文收尾的隐藏词（带逗号的语气词、拉丁词）
/// 时，标记记的是「隐藏时贴着」，把那个词恢复显示后它后面会少一个空格。
fn legacy_glue_flags<'a>(words: impl Iterator<Item = (&'a str, bool)>) -> Vec<bool> {
    let mut flags = Vec::new();
    let mut previous: Option<&str> = None;
    let mut previous_visible: Option<&str> = None;
    for (text, hidden) in words {
        let against = if hidden { previous } else { previous_visible };
        flags.push(against.is_some_and(|against| crate::atomize::legacy_glue(against, text)));
        previous = Some(text);
        if !hidden {
            previous_visible = Some(text);
        }
    }
    flags
}

/// 给 0.5 之前建的词补「贴前」标记（已有的标记保留）。`hidden` 是文稿的隐藏表。
pub fn mark_legacy_glue(words: &mut [Word], hidden: &BTreeMap<String, bool>) {
    let flags = legacy_glue_flags(words.iter().map(|word| {
        (
            word.text.as_str(),
            hidden.get(&word.id).copied().unwrap_or(false),
        )
    }));
    for (word, flag) in words.iter_mut().zip(flags) {
        word.glue |= flag;
    }
}

/// [`mark_legacy_glue`] 的 JSON 版：给不经 [`TranscriptDoc`]、直接改写
/// `transcript.json` 的升级路径用。只在文稿版本早于 0.5 时动 `words[]`，返回
/// 新打上标记的词数；版本号由调用方改写。
pub fn mark_legacy_glue_in_json(value: &mut serde_json::Value) -> usize {
    if !predates_glue(value["bcutTranscript"].as_str()) {
        return 0;
    }
    let flags = json_legacy_glue_flags(value);
    let Some(words) = value["words"].as_array_mut() else {
        return 0;
    };
    let mut marked = 0;
    for (word, flag) in words.iter_mut().zip(flags) {
        if flag
            && word["glue"].as_bool() != Some(true)
            && let Some(word) = word.as_object_mut()
        {
            word.insert("glue".to_owned(), serde_json::Value::Bool(true));
            marked += 1;
        }
    }
    marked
}

fn json_legacy_glue_flags(value: &serde_json::Value) -> Vec<bool> {
    let hidden = &value["hidden"];
    let words = value["words"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default();
    legacy_glue_flags(words.iter().map(|word| {
        (
            word["text"].as_str().unwrap_or_default(),
            word["id"]
                .as_str()
                .and_then(|id| hidden[id].as_bool())
                .unwrap_or(false),
        )
    }))
}

/// 从 transcript JSON 的 `words[]` 按数组顺序取每个词的「贴前」标记，不过滤任何
/// 元素。给不经 [`TranscriptDoc`] 反序列化、直接读 JSON 拼正文的调用方用。
/// 0.5 之前的文稿没有存标记，按 [`mark_legacy_glue`] 的同一条规则现算。
pub fn word_glue_flags(value: &serde_json::Value) -> Vec<bool> {
    let stored = value["words"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .map(|item| item["glue"].as_bool().unwrap_or(false))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if !predates_glue(value["bcutTranscript"].as_str()) {
        return stored;
    }
    stored
        .into_iter()
        .zip(json_legacy_glue_flags(value))
        .map(|(stored, legacy)| stored || legacy)
        .collect()
}

// `remote = "Self"`：derive 生成的是同名的固有函数，trait 实现写在下面——
// 反序列化之后要过一遍 [`TranscriptDoc::adopt_current_version`]。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", remote = "Self")]
pub struct TranscriptDoc {
    pub bcut_transcript: String,
    pub media: DocMedia,
    /// 主语言（BCP-47）。
    pub lang: String,
    pub engine: DocEngine,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,

    pub words: Vec<Word>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub speakers: BTreeMap<String, Speaker>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub chapters: Vec<Chapter>,

    /// 用户显式断句意图（0.4 起不再承载优化器结果）。
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub breaks: BTreeMap<String, BreakOverride>,
    /// 布局优化器输出：`LayoutProfile` id → 词 id → 自动 pin。派生 Cue 时与
    /// `breaks` 合并，同键以 `breaks` 为准（[`TranscriptDoc::effective_breaks`]）。
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub auto_breaks: BTreeMap<String, BTreeMap<String, BreakOverride>>,
    /// 当前编辑/派生所用的 `LayoutProfile` id；缺省 [`DEFAULT_LAYOUT_PROFILE`]。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout_profile: Option<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub para_breaks: BTreeMap<String, bool>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub hidden: BTreeMap<String, bool>,
    /// 译文真相：lang → 句 id（`s-<首词id>`）→ 完整自然译句（Phase-1）。
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub trans: BTreeMap<String, BTreeMap<String, String>>,
    /// 单调化显示改写：lang → 句 id → 字幕用译句。只在触发改写时存在。
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub trans_display: BTreeMap<String, BTreeMap<String, TransDisplay>>,
    /// 对齐覆盖层：lang → 句 id → 展示切分（Phase-2）。无条目 = 未对齐
    /// （合法中间态，展示降级整句上屏）。
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub trans_align: BTreeMap<String, BTreeMap<String, TransAlign>>,

    #[serde(default, skip_serializing_if = "Stages::is_empty")]
    pub stages: Stages,
    /// lang → { 句 id → 该句源文指纹 }。不符 ⇒ translation-stale。
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub trans_src: BTreeMap<String, BTreeMap<String, String>>,

    /// 写入必须经 CLI；直接手改会破坏指纹与不变量。
    #[serde(default, skip_serializing_if = "is_false")]
    pub read_only_note: bool,
}

impl Serialize for TranscriptDoc {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        Self::serialize(self, serializer)
    }
}

/// 不论从哪里反序列化（`from_json`、审阅候选、`project init --transcript`），
/// 拿到手的文稿都已是当前版本的语义：旧版的词缝补好了「贴前」标记。
impl<'de> Deserialize<'de> for TranscriptDoc {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let mut doc = Self::deserialize(deserializer)?;
        doc.adopt_current_version();
        Ok(doc)
    }
}

/// 当前写出的 transcript 版本。
///
/// 移植自 BaoCut v2 `bcut-protocol` 的 `versions::TRANSCRIPT_CURRENT`（值不变）。
pub const TRANSCRIPT_VERSION: &str = "0.5";
/// 可读取的版本：旧版是当前版本的子集（0.4、0.5 都只增字段），读入后按当前
/// 语义处理；0.5 改了拼接规则，旧版的词在读入时补「贴前」标记保持原样。
///
/// 移植自 BaoCut v2 `bcut-protocol` 的 `versions::TRANSCRIPT_SUPPORTED`（值不变）。
pub const SUPPORTED_TRANSCRIPT_VERSIONS: &[&str] = &["0.3", "0.4", TRANSCRIPT_VERSION];
/// 缺省 `LayoutProfile` id：数值即 0.3 时代的全部常量。
pub const DEFAULT_LAYOUT_PROFILE: &str = "default";

impl TranscriptDoc {
    pub fn new(media: DocMedia, lang: impl Into<String>, engine: DocEngine) -> Self {
        Self {
            bcut_transcript: TRANSCRIPT_VERSION.to_owned(),
            media,
            lang: lang.into(),
            engine,
            created_at: None,
            words: Vec::new(),
            speakers: BTreeMap::new(),
            chapters: Vec::new(),
            breaks: BTreeMap::new(),
            auto_breaks: BTreeMap::new(),
            layout_profile: None,
            para_breaks: BTreeMap::new(),
            hidden: BTreeMap::new(),
            trans: BTreeMap::new(),
            trans_display: BTreeMap::new(),
            trans_align: BTreeMap::new(),
            stages: Stages::default(),
            trans_src: BTreeMap::new(),
            read_only_note: false,
        }
    }

    /// 生效的 `LayoutProfile` id。
    pub fn layout_profile_id(&self) -> &str {
        self.layout_profile
            .as_deref()
            .unwrap_or(DEFAULT_LAYOUT_PROFILE)
    }

    /// 派生 Cue 用的合并 pin 表：`autoBreaks[profile]` 打底，`breaks` 覆盖同键。
    /// 三端（Rust / Swift / JS）替换 §18.5 里对 `breaks` 的读取即可，派生算法不变。
    pub fn effective_breaks(&self, profile: &str) -> BTreeMap<String, BreakOverride> {
        let mut merged = self.auto_breaks.get(profile).cloned().unwrap_or_default();
        for (id, value) in &self.breaks {
            merged.insert(id.clone(), *value);
        }
        merged
    }

    /// 版式串：breaks/paraBreaks/hidden 的排序序列化，供 `stages.asrLayout`。
    /// 只统计用户意图，`autoBreaks` 不参与——优化器重跑不算人工版式干预。
    pub fn layout_strings(&self) -> Vec<String> {
        let mut items = Vec::new();
        for (id, value) in &self.breaks {
            let tag = match value {
                BreakOverride::Break => "break",
                BreakOverride::Nobreak => "nobreak",
            };
            items.push(format!("b:{id}={tag}"));
        }
        for (id, value) in &self.para_breaks {
            if *value {
                items.push(format!("p:{id}"));
            }
        }
        for (id, value) in &self.hidden {
            if *value {
                items.push(format!("h:{id}"));
            }
        }
        items.sort();
        items
    }

    /// schema + 语义校验（`transcript-word-order` 等）。
    pub fn validate(&self) -> Result<()> {
        if !SUPPORTED_TRANSCRIPT_VERSIONS.contains(&self.bcut_transcript.as_str()) {
            // 版本不认识不是数据损坏：多半是这个 CLI 比项目旧。把「我支持什么、
            // 项目是什么、去哪查我是谁」一次讲全，别让调用方以为 transcript 坏了。
            bail!(
                "不支持的 transcript 版本 {}（本 CLI 只认 {}）：这不是文件损坏，多半是当前 bcut 比项目旧；用 `bcut --json version` 核对正在运行的二进制与提交，再升级到能写出 {} 的构建",
                self.bcut_transcript,
                SUPPORTED_TRANSCRIPT_VERSIONS.join(" / "),
                self.bcut_transcript,
            );
        }
        if !self.media.duration.is_finite() || self.media.duration < 0.0 {
            bail!("media.duration 必须是非负有限数");
        }
        let mut seen = std::collections::HashSet::with_capacity(self.words.len());
        let mut previous: Option<&Word> = None;
        for (index, word) in self.words.iter().enumerate() {
            let check = |ok: bool, message: &str| -> Result<()> {
                if ok {
                    Ok(())
                } else {
                    bail!("words[{index}] ({}): {message}", word.id)
                }
            };
            check(!word.id.is_empty(), "id 不能为空")?;
            check(seen.insert(word.id.as_str()), "id 重复")?;
            check(!word.text.is_empty(), "text 不能为空")?;
            check(
                word.t0.is_finite() && word.t1.is_finite() && word.t0 >= 0.0 && word.t1 >= word.t0,
                "时间范围无效",
            )?;
            // 容忍浮点/厘秒取整边界的半 tick 逃逸。
            check(
                word.t1 <= self.media.duration + 0.005,
                "词时间越出 media.duration",
            )?;
            check(
                self.speakers.contains_key(&word.sp),
                "sp 不在 speakers 表中",
            )?;
            if let Some(previous) = previous {
                check(
                    word.t0 >= previous.t0,
                    "transcript-word-order：t0 必须非降序",
                )?;
                check(
                    word.t0 >= previous.t1 - 0.005,
                    "transcript-word-order：词区间不得交叠",
                )?;
            }
            previous = Some(word);
        }
        let mut chapter_previous: Option<&Chapter> = None;
        for chapter in &self.chapters {
            if !chapter.start.is_finite() || chapter.end < chapter.start {
                bail!("chapter {} 时间区间无效", chapter.id);
            }
            if let Some(previous) = chapter_previous
                && chapter.start < previous.end
            {
                bail!("chapter {} 与前一章节交叠", chapter.id);
            }
            chapter_previous = Some(chapter);
        }
        Ok(())
    }

    /// 覆盖表/译文表引用不存在词 id 的孤儿键（warn 级，`transcript-orphan-override`）。
    pub fn orphan_overrides(&self) -> Vec<String> {
        let ids: std::collections::HashSet<&str> =
            self.words.iter().map(|word| word.id.as_str()).collect();
        let mut orphans = Vec::new();
        for id in self
            .breaks
            .keys()
            .chain(self.auto_breaks.values().flat_map(|table| table.keys()))
            .chain(self.para_breaks.keys())
            .chain(self.hidden.keys())
        {
            if !ids.contains(id.as_str()) {
                orphans.push(id.clone());
            }
        }
        orphans.sort();
        orphans.dedup();
        orphans
    }

    /// 删除覆盖表中已经无法指向当前词流的键，并返回删除数量。
    ///
    /// 文本重绑定可能替换词 id；这些旧键继续留在文档里既不能恢复用户意图，
    /// 还会让交付检查永久报 `transcript-orphan-override`。调用方应在完成一次
    /// 原子化文本替换后、重算版式指纹前执行本收尾。
    pub fn prune_orphan_overrides(&mut self) -> usize {
        let ids: std::collections::HashSet<String> =
            self.words.iter().map(|word| word.id.clone()).collect();
        let auto_len = |doc: &Self| -> usize { doc.auto_breaks.values().map(BTreeMap::len).sum() };
        let before =
            self.breaks.len() + auto_len(self) + self.para_breaks.len() + self.hidden.len();
        self.breaks.retain(|id, _| ids.contains(id));
        for table in self.auto_breaks.values_mut() {
            table.retain(|id, _| ids.contains(id));
        }
        self.auto_breaks.retain(|_, table| !table.is_empty());
        self.para_breaks.retain(|id, _| ids.contains(id));
        self.hidden.retain(|id, _| ids.contains(id));
        before - (self.breaks.len() + auto_len(self) + self.para_breaks.len() + self.hidden.len())
    }

    /// 旧版（仍在支持范围内）的文稿升到当前版本的语义：给规则变化会撑开的
    /// 词缝补「贴前」标记，版本号改成 [`TRANSCRIPT_VERSION`]。不认识的版本
    /// 原样留着，由 [`TranscriptDoc::validate`] 拒绝。幂等。
    fn adopt_current_version(&mut self) {
        if !predates_glue(Some(&self.bcut_transcript)) {
            return;
        }
        mark_legacy_glue(&mut self.words, &self.hidden);
        self.bcut_transcript = TRANSCRIPT_VERSION.to_owned();
    }

    /// 解析并按当前版本语义读入：旧版文档只增不改，读入后版本号升为
    /// [`TRANSCRIPT_VERSION`]（回写即完成升级；旧字段 `crossing`/`cues` 原样保留，
    /// 由 [`TransAlign::correspondence`] 等读取侧解释；0.5 之前的词补
    /// 「贴前」标记——反序列化时已做）。
    pub fn from_json(bytes: &[u8]) -> Result<Self> {
        let doc: TranscriptDoc = serde_json::from_slice(bytes).context("解析 transcript JSON")?;
        doc.validate()?;
        Ok(doc)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc_with(words: Vec<Word>) -> TranscriptDoc {
        let mut doc = TranscriptDoc::new(
            DocMedia {
                id: None,
                path: Some("talk.wav".to_owned()),
                hash: "sha256-00".to_owned(),
                duration: 100.0,
                sample_rate: Some(16_000),
            },
            "zh",
            DocEngine {
                name: "test".to_owned(),
                version: None,
                aligned_words: true,
            },
        );
        doc.speakers.insert(
            "s1".to_owned(),
            Speaker {
                name: "S1".to_owned(),
                hue: None,
            },
        );
        doc.words = words;
        doc
    }

    fn word(id: &str, t0: f64, t1: f64) -> Word {
        Word {
            id: id.to_owned(),
            t0,
            t1,
            text: "字".to_owned(),
            sp: "s1".to_owned(),
            glue: false,
        }
    }

    #[test]
    fn validate_accepts_touching_words_and_rejects_overlap() {
        let doc = doc_with(vec![word("g1.0", 0.0, 0.5), word("g1.1", 0.5, 1.0)]);
        doc.validate().unwrap();
        let bad = doc_with(vec![word("g1.0", 0.0, 0.6), word("g1.1", 0.5, 1.0)]);
        assert!(bad.validate().unwrap_err().to_string().contains("交叠"));
    }

    #[test]
    fn validate_rejects_unknown_speaker_and_duplicate_id() {
        let mut doc = doc_with(vec![word("g1.0", 0.0, 0.5)]);
        doc.words[0].sp = "s9".to_owned();
        assert!(doc.validate().is_err());
        let doc = doc_with(vec![word("g1.0", 0.0, 0.5), word("g1.0", 0.5, 1.0)]);
        assert!(doc.validate().unwrap_err().to_string().contains("重复"));
    }

    #[test]
    fn orphan_overrides_reports_missing_ids_only() {
        let mut doc = doc_with(vec![word("g1.0", 0.0, 0.5)]);
        doc.breaks.insert("g1.0".to_owned(), BreakOverride::Break);
        doc.para_breaks.insert("gone".to_owned(), true);
        assert_eq!(doc.orphan_overrides(), vec!["gone".to_owned()]);
    }

    #[test]
    fn prune_orphan_overrides_keeps_only_current_word_ids() {
        let mut doc = doc_with(vec![word("g1.0", 0.0, 0.5)]);
        doc.breaks.insert("g1.0".to_owned(), BreakOverride::Break);
        doc.breaks
            .insert("gone-break".to_owned(), BreakOverride::Nobreak);
        doc.para_breaks.insert("gone-para".to_owned(), true);
        doc.hidden.insert("gone-hidden".to_owned(), true);

        assert_eq!(doc.prune_orphan_overrides(), 3);
        assert_eq!(doc.breaks.len(), 1);
        assert!(doc.breaks.contains_key("g1.0"));
        assert!(doc.para_breaks.is_empty());
        assert!(doc.hidden.is_empty());
        assert!(doc.orphan_overrides().is_empty());
    }

    #[test]
    fn the_glue_flag_is_sparse_on_disk_and_round_trips() {
        let plain = Word {
            id: "w1".to_owned(),
            t0: 0.0,
            t1: 0.5,
            text: "ab".to_owned(),
            sp: "s1".to_owned(),
            glue: false,
        };
        let glued = Word {
            id: "w2".to_owned(),
            glue: true,
            ..plain.clone()
        };
        let plain_json = serde_json::to_value(&plain).unwrap();
        assert!(plain_json.get("glue").is_none(), "{plain_json}");
        let glued_json = serde_json::to_value(&glued).unwrap();
        assert_eq!(glued_json["glue"], true);
        assert_eq!(serde_json::from_value::<Word>(plain_json).unwrap(), plain);
        assert_eq!(serde_json::from_value::<Word>(glued_json).unwrap(), glued);
        let rows = serde_json::json!({"words": [plain, glued]});
        assert_eq!(word_glue_flags(&rows), [false, true]);
    }

    fn legacy_korean_json(version: &str) -> serde_json::Value {
        // 0.5 之前建的韩文文稿：每个音节一个词，`~k` 是同一个转录词切出来的。
        let texts = [
            "저", "는", "내", "일", "iPhone", "을", "샀", "다.", "어,", "그", "래", "요",
        ];
        let words: Vec<serde_json::Value> = texts
            .iter()
            .enumerate()
            .map(|(index, text)| {
                serde_json::json!({
                    "id": format!("g1.{index}"),
                    "t0": index as f64,
                    "t1": index as f64 + 0.5,
                    "text": text,
                    "sp": "s1",
                })
            })
            .collect();
        serde_json::json!({
            "bcutTranscript": version,
            "media": {"path": "talk.wav", "hash": "sha256-00", "duration": 100.0},
            "lang": "ko",
            "engine": {"name": "test", "alignedWords": true},
            "words": words,
            "speakers": {"s1": {"name": "S1"}},
            "breaks": {"g1.4": "break"},
        })
    }

    /// 旧版韩文文稿读进来：词 id、文本、时间、覆盖表、指纹一个不变，只多出
    /// 「贴前」标记；按新规则拼出来的文本与 0.5 之前逐字相同。
    #[test]
    fn a_pre_0_5_korean_document_reads_with_glue_and_the_same_text() {
        for version in ["0.3", "0.4"] {
            let json = legacy_korean_json(version);
            let doc = TranscriptDoc::from_json(&serde_json::to_vec(&json).unwrap()).unwrap();
            assert_eq!(doc.bcut_transcript, "0.5");
            let ids: Vec<&str> = doc.words.iter().map(|word| word.id.as_str()).collect();
            let expected_ids: Vec<String> = (0..12).map(|index| format!("g1.{index}")).collect();
            assert_eq!(ids, expected_ids);
            assert_eq!(doc.breaks.len(), 1);
            let glue: Vec<bool> = doc.words.iter().map(|word| word.glue).collect();
            assert_eq!(
                glue,
                [
                    false, true, true, true, false, false, true, true, false, false, true, true
                ]
            );
            assert_eq!(
                crate::atomize::join_word_texts(doc.words.iter()),
                "저는내일 iPhone 을샀다. 어, 그래요"
            );
            // 直接读 JSON 的调用方拿到同一组标记。
            assert_eq!(word_glue_flags(&json), glue);
            // JSON 升级路径打上同一组标记，且幂等。
            let mut upgraded = json.clone();
            assert_eq!(mark_legacy_glue_in_json(&mut upgraded), 7);
            upgraded["bcutTranscript"] = serde_json::json!(TRANSCRIPT_VERSION);
            assert_eq!(mark_legacy_glue_in_json(&mut upgraded), 0);
            assert_eq!(word_glue_flags(&upgraded), glue);
            let reread = TranscriptDoc::from_json(&serde_json::to_vec(&upgraded).unwrap()).unwrap();
            assert_eq!(reread, doc);
            // 写出再读回：标记落盘，不再靠规则现算。
            let written = serde_json::to_value(&doc).unwrap();
            assert_eq!(written["bcutTranscript"], "0.5");
            assert_eq!(written["words"][1]["glue"], true);
            assert!(written["words"][4].get("glue").is_none());
            assert_eq!(
                serde_json::from_value::<TranscriptDoc>(written).unwrap(),
                doc
            );
        }
        // 不经 `from_json` 的反序列化（审阅候选、`project init --transcript`）
        // 同样补标记。
        let direct: TranscriptDoc = serde_json::from_value(legacy_korean_json("0.4")).unwrap();
        assert!(direct.words[1].glue);
        assert_eq!(direct.bcut_transcript, "0.5");
    }

    /// 隐藏词：可见词与前面最近的可见词比，显示出来的文本迁移前后相同。
    #[test]
    fn legacy_glue_follows_the_visible_neighbour_across_a_hidden_word() {
        let mut json = legacy_korean_json("0.4");
        // 「어,」被隐藏：0.5 之前「다.」后面直接显示「그」，中间有空格（句号
        // 之后）；把「다.」换成不带句号的「다」，旧显示就是贴着的「다그」。
        json["words"][7]["text"] = serde_json::json!("다");
        json["hidden"] = serde_json::json!({"g1.8": true});
        let doc = TranscriptDoc::from_json(&serde_json::to_vec(&json).unwrap()).unwrap();
        assert!(doc.words[9].glue, "「그」贴着前一个可见词「다」");
        let visible = doc
            .words
            .iter()
            .filter(|word| !doc.hidden.contains_key(&word.id));
        assert_eq!(
            crate::atomize::join_word_texts(visible),
            "저는내일 iPhone 을샀다그래요"
        );
    }

    /// 0.5 的文稿不再按规则补标记：新建的韩文文稿一个어절一个词，没有标记。
    #[test]
    fn a_0_5_document_is_read_as_written() {
        let mut json = legacy_korean_json("0.5");
        let doc = TranscriptDoc::from_json(&serde_json::to_vec(&json).unwrap()).unwrap();
        assert!(doc.words.iter().all(|word| !word.glue));
        assert_eq!(word_glue_flags(&json), vec![false; 12]);
        assert_eq!(mark_legacy_glue_in_json(&mut json), 0);
        // 中文、日文、英文的旧文稿读进来没有任何词带标记。
        for texts in [
            vec!["你", "好，", "世", "界。"],
            vec!["他", "用", "Agent", "来", "做"],
            vec!["い", "い", "天", "気", "です。"],
            vec!["Hello,", "world."],
        ] {
            let mut json = legacy_korean_json("0.4");
            json["breaks"] = serde_json::json!({});
            json["words"] = texts
                .iter()
                .enumerate()
                .map(|(index, text)| {
                    serde_json::json!({
                        "id": format!("g1.{index}"), "t0": index as f64, "t1": index as f64 + 0.5,
                        "text": text, "sp": "s1",
                    })
                })
                .collect();
            let doc = TranscriptDoc::from_json(&serde_json::to_vec(&json).unwrap()).unwrap();
            assert!(doc.words.iter().all(|word| !word.glue), "{texts:?}");
        }
    }

    #[test]
    fn json_round_trip_preserves_overrides_and_stages() {
        let mut doc = doc_with(vec![word("g1.0", 0.0, 0.5)]);
        doc.breaks.insert("g1.0".to_owned(), BreakOverride::Nobreak);
        doc.stages.asr = Some("1:g1.0:g1.0:abc".to_owned());
        doc.trans
            .entry("zh".to_owned())
            .or_default()
            .insert("s-g1.0".to_owned(), "一句译文。".to_owned());
        doc.auto_breaks
            .entry(DEFAULT_LAYOUT_PROFILE.to_owned())
            .or_default()
            .insert("g1.0".to_owned(), BreakOverride::Break);
        doc.trans_display
            .entry("zh".to_owned())
            .or_default()
            .insert(
                "s-g1.0".to_owned(),
                TransDisplay {
                    text: "译文一句。".to_owned(),
                    basis: "monotonic-rewrite".to_owned(),
                    trans_fingerprint: "fp".to_owned(),
                },
            );
        let mut entry = TransAlign::new(
            AlignMode::ManyToOne,
            vec!["g1.0".to_owned()],
            vec![TransPiece {
                from: Some(0),
                to: Some(0),
                text: "译文一句。".to_owned(),
            }],
        );
        entry.correspondence = Some(Correspondence::Block);
        entry.text_basis = TextBasis::Display;
        entry.aligner = Some("deterministic/1".to_owned());
        entry.blocks = vec![AlignBlock {
            src: (0, 0),
            tgt: (0, 5),
            confidence: Some(1.0),
            flags: vec!["anchor".to_owned()],
        }];
        doc.trans_align
            .entry("zh".to_owned())
            .or_default()
            .insert("s-g1.0".to_owned(), entry);
        let bytes = serde_json::to_vec(&doc).unwrap();
        let parsed = TranscriptDoc::from_json(&bytes).unwrap();
        assert_eq!(parsed, doc);
        let value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(value["bcutTranscript"], "0.5");
        assert_eq!(value["breaks"]["g1.0"], "nobreak");
        assert_eq!(value["autoBreaks"]["default"]["g1.0"], "break");
        assert_eq!(
            value["transDisplay"]["zh"]["s-g1.0"]["basis"],
            "monotonic-rewrite"
        );
        assert_eq!(
            value["transDisplay"]["zh"]["s-g1.0"]["transFingerprint"],
            "fp"
        );
        let align = &value["transAlign"]["zh"]["s-g1.0"];
        assert_eq!(align["mode"], "manyToOne");
        assert!(align.get("crossing").is_none());
        assert_eq!(align["correspondence"], "block");
        assert_eq!(align["textBasis"], "display");
        assert_eq!(align["aligner"], "deterministic/1");
        assert_eq!(align["blocks"][0]["src"], serde_json::json!([0, 0]));
        assert_eq!(align["blocks"][0]["tgt"], serde_json::json!([0, 5]));
        assert_eq!(align["blocks"][0]["flags"][0], "anchor");
        assert_eq!(align["pieces"][0]["from"], 0);
        // independent 片不落 from/to 键；缺省 textBasis/correspondence 不落键。
        doc.trans_align.get_mut("zh").unwrap().insert(
            "s-g1.0".to_owned(),
            TransAlign::new(
                AlignMode::Independent,
                Vec::new(),
                vec![TransPiece {
                    from: None,
                    to: None,
                    text: "一句译文。".to_owned(),
                }],
            ),
        );
        let value: serde_json::Value =
            serde_json::from_slice(&serde_json::to_vec(&doc).unwrap()).unwrap();
        let align = &value["transAlign"]["zh"]["s-g1.0"];
        assert_eq!(align["mode"], "independent");
        for absent in [
            "cues",
            "crossing",
            "correspondence",
            "textBasis",
            "aligner",
            "blocks",
        ] {
            assert!(align.get(absent).is_none(), "{absent} 不应落键");
        }
        assert!(align["pieces"][0].get("from").is_none());
    }

    #[test]
    fn legacy_0_3_document_reads_as_current_and_crossing_means_sentence_correspondence() {
        let json = serde_json::json!({
            "bcutTranscript": "0.3",
            "media": {"path": "talk.wav", "hash": "sha256-00", "duration": 100.0},
            "lang": "en",
            "engine": {"name": "test", "alignedWords": true},
            "words": [{"id": "g1.0", "t0": 0.0, "t1": 0.5, "text": "hi", "sp": "s1"}],
            "speakers": {"s1": {"name": "S1"}},
            "breaks": {"g1.0": "break"},
            "trans": {"zh": {"s-g1.0": "你好。"}},
            "transAlign": {"zh": {"s-g1.0": {
                "mode": "manyToOne", "crossing": true, "words": ["g1.0"],
                "pieces": [{"from": 0, "to": 0, "text": "你好。"}]
            }}}
        });
        let doc = TranscriptDoc::from_json(serde_json::to_vec(&json).unwrap().as_slice()).unwrap();
        assert_eq!(doc.bcut_transcript, "0.5");
        assert_eq!(doc.layout_profile_id(), DEFAULT_LAYOUT_PROFILE);
        assert!(doc.auto_breaks.is_empty());
        assert!(doc.trans_display.is_empty());
        let entry = &doc.trans_align["zh"]["s-g1.0"];
        assert!(entry.crossing);
        assert_eq!(entry.correspondence(), Correspondence::Sentence);
        assert_eq!(entry.text_basis, TextBasis::Trans);
        assert!(entry.blocks.is_empty());
        // 未标 crossing 的词锚 manyToOne 条目按块对应；independent 按整句对应。
        let mut plain = entry.clone();
        plain.crossing = false;
        assert_eq!(plain.correspondence(), Correspondence::Block);
        plain.mode = AlignMode::Independent;
        assert_eq!(plain.correspondence(), Correspondence::Sentence);
        // 支持范围之外的版本仍拒绝。
        let mut bad = json.clone();
        bad["bcutTranscript"] = serde_json::json!("0.2");
        assert!(TranscriptDoc::from_json(serde_json::to_vec(&bad).unwrap().as_slice()).is_err());
    }

    #[test]
    fn effective_breaks_lets_user_pins_override_auto_pins() {
        let mut doc = doc_with(vec![word("g1.0", 0.0, 0.5), word("g1.1", 0.5, 1.0)]);
        let auto = doc.auto_breaks.entry("default".to_owned()).or_default();
        auto.insert("g1.0".to_owned(), BreakOverride::Break);
        auto.insert("g1.1".to_owned(), BreakOverride::Break);
        doc.breaks.insert("g1.0".to_owned(), BreakOverride::Nobreak);
        let merged = doc.effective_breaks("default");
        assert_eq!(merged["g1.0"], BreakOverride::Nobreak);
        assert_eq!(merged["g1.1"], BreakOverride::Break);
        // 未知 profile 只剩用户 pin；版式指纹只看用户 pin。
        assert_eq!(doc.effective_breaks("portrait").len(), 1);
        assert_eq!(doc.layout_strings(), vec!["b:g1.0=nobreak".to_owned()]);
        // 孤儿清理覆盖 autoBreaks。
        auto_orphan(&mut doc);
        assert_eq!(doc.orphan_overrides(), vec!["gone".to_owned()]);
        assert_eq!(doc.prune_orphan_overrides(), 1);
        assert!(doc.orphan_overrides().is_empty());
    }

    fn auto_orphan(doc: &mut TranscriptDoc) {
        doc.auto_breaks
            .get_mut("default")
            .unwrap()
            .insert("gone".to_owned(), BreakOverride::Break);
    }
}
