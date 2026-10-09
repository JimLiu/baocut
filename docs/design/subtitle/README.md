> 移植自 BaoCut v2；文中的数据模型名（TranscriptDoc 等）指 v2 的模型，与 v3 文档模型的对应见[架构设计 §14](../../architecture/architecture-design.md#14-待评审事项)。

# docs/design/subtitle/ — 字幕 AI 管线

转录之后的字幕管线：Transcript 数据模型，润色 / 分段 / 分章节 / 翻译 / 对齐各阶段，LLM 交换契约与验收。核心不变量（`words[]` 是唯一真相、`trans` / `transAlign` 两层、翻译对齐先定译文 Cue、本地 Agent 与 Cloud 两条路径同步）见根 [`AGENTS.md`](../../../AGENTS.md)「Transcript 与 AI 管线」。

## 总纲与数据模型

| 文件 | 内容与状态 |
| --- | --- |
| [`bcut-ai-pipeline-design.md`](bcut-ai-pipeline-design.md) | **AI 管线总纲**：AI flow、指纹与增量语义、各阶段契约（实现对齐版 v0.4）。正文在 [`bcut-ai-pipeline-design/`](bcut-ai-pipeline-design/) |
| [`bcut-transcript-v03-design.md`](bcut-transcript-v03-design.md) | Transcript v0.3：`words[]` 真相、句子一等公民、`trans` 句级译文与 `transAlign` 展示覆盖层（已确认，现行数据结构规格） |
| [`bcut-subtitle-pipeline-implementation.md`](bcut-subtitle-pipeline-implementation.md) | 转录后 segment → polish → translate → align 的实现说明，四个阶段的边界 |
| [`bcut-file-contract-subtitle-ai-design.md`](bcut-file-contract-subtitle-ai-design.md) | 文件契约管线 v0.3：LLM 交换格式从 JSON 换成 txt / HTML（M0–M4 已实现，是**实现规范**）。正文在 [`bcut-file-contract-subtitle-ai-design/`](bcut-file-contract-subtitle-ai-design/) |
| [`bcut-incremental-edit-design.md`](bcut-incremental-edit-design.md) | 编辑写路径审计、`patchTranscript` 局部补丁与增量编辑收口 |
| [`bcut-korean-word-spacing-design.md`](bcut-korean-word-spacing-design.md) | 韩文的词与空格：逐音节分词丢空格的现状、S / W / B / L 四个问题的调用点普查、「贴前」标记与文稿 0.5 的迁移方案（**提案，待裁决，未实施** 2026-09-30） |
| [`bcut-unspaced-script-segmentation-design.md`](bcut-unspaced-script-segmentation-design.md) | 泰、老挝、缅甸、高棉、藏文的分词：新建文稿用 ICU4X LSTM 按词存，短语内的词缝带「贴前」标记；改写区间锚定旧词、引文 Snap 级；已有文稿不迁移（已实施 2026-10-01） |

## 分段、对齐与译文修复

| 文件 | 内容与状态 |
| --- | --- |
| [`bcut-asr-initial-segment-design.md`](bcut-asr-initial-segment-design.md) | ASR segment 初始软分段：可提升投影、`RowSegmentation` 来源标注（已实施 2026-08-26） |
| [`bcut-alignment-block-subtitle-split-design.md`](bcut-alignment-block-subtitle-split-design.md) | 字幕切分四层分离、`autoBreaks` / `LayoutProfile`、最小单调对齐块、`transDisplay`（已确认，实施记录见 §12） |
| [`bcut-translation-row-repair-design.md`](bcut-translation-row-repair-design.md) | 译文黏结检测与二次校正：`align-row-deficit` 判据、`--align-density paired` 定向重切（M1–M3、M5 已完成） |
| [`bcut-lean-llm-carrier-design.md`](bcut-lean-llm-carrier-design.md) | `lines/1` 首尾引用与代码判交叉；M0 基础和实验工具已实施，第二轮（分片提示、联合定位、行归属门、补做轮）在 DeepSeek V4.1 Flash 508 句上 491 / 0 / 17 对 旧载体 378 / 97 / 33、费用约 0.4×；第三轮盲检后加块缝整理 / 块复述拒收两道护栏，provider 直连路径已 opt-in 接入 `bcut translate --align-fusion lines`（默认仍 `rows`，Agent 路径与 §5 状态机待实施）（2026-09-30） |
| [`bcut-translate-prompt-ab-runbook.md`](bcut-translate-prompt-ab-runbook.md) | 翻译提示词 A/B 验收门（英文），脚本在 `scripts/bench/translate_prompt_ab.py`。它验收的两版提示词升级设计稿已归档在 [`../../archive/subtitle/`](../../archive/subtitle/README.md) |

`lines/1` 的[多语言固定基准](../../../scripts/bench/fixtures/lean-carrier-multilingual-2026-09-30/README.md)保存三个真实视频项目的抽样、六种合成源语言、模型回答与离线回放结果。

[2026-10-01 多语言验收](../../../scripts/bench/fixtures/lean-carrier-acceptance-2026-10-01/README.md)保存新版固定响应回放、新模型测试、逐句评分和对比图。

[915bfef13 多语言复验](../../../scripts/bench/fixtures/lean-carrier-acceptance-2026-10-01-915bfef13/README.md)记录印地文引用修复、泰文分词与模拟预算测试，以及仍未通过的语义和架构检查。

[9bb2a8f62 多语言验收](../../../scripts/bench/fixtures/lean-carrier-acceptance-2026-10-01-9bb2a8f62/README.md)记录相同阅读预算下的新旧版本对比、润色与翻译回归，以及尚存的语义错误。

**新建验收页要带阅读预算。** 生产里可编辑的句子都有预算，`chunk_hint` 的 `≥k` 与 `¦` 分片都从预算来。不带预算的页只会走「没有预算」的分支，所以那次复验主表里德文、泰文的「切分过粗」大多是这样来的，不代表生产行为。

写法是 `<p>` 上的 `data-budget="整句≤N字"`（目标语是中文、日文、韩文时单位写「字」，其余写「字符」）：

- `N` 按生产口径 `reading_budget_duration` 算，即显示秒数 × 目标语 cps（`zh` 9，`ja` / `ko` 13，其余 21），向下取整。
- 生产的解析器忽略这个属性；`lean_carrier_grade` 读页时（`render`、`render-fix`、`grade` 等子命令都经 `load_page`）会把它复原成 `Sentence.budget`。
- 合成用例没有真实时长时，用 `syntheticDurationSeconds` 或按参考译文估一个时长，并在验收记录里写明这是假设。
- 测试 `multilingual_piece_marks_never_cut_inside_a_word` 用同一口径给每个用例加预算。

## Agent 工作流、术语与样式

[多语言润色与翻译用例](../../../scripts/bench/fixtures/subtitle-multilingual-cases/README.md)提供12种源语言、25个场景、50个任务，含参考输出、错误反例、生产路径回归和模型任务导出。

| 文件 | 内容与状态 |
| --- | --- |
| [`bcut-subtitle-agent-workflow.md`](bcut-subtitle-agent-workflow.md) | 字幕 Agent 阶段编排、对齐策略、worker 与续跑经验（内部开发资料，不复制回 `skills/`） |
| [`bcut-glossary-design.md`](bcut-glossary-design.md) | 术语库：跨项目专名表，分转录术语表与翻译术语表，按命中编译进 `ai/context.md`；转录选表与自定义提示词（2026-09-20 原型先行，产品规格 [§15.10](../product/product-design/15-glossary.md)） |
| [`caption-style-model-design.md`](caption-style-model-design.md) | **字幕样式模型**：七个独立维度（字体 / 涂装 / 落位 / 当前词 / 动效 / 强调词 / 排版模式）组合出样式，预设只是取值；每份预设自带当前词样式，KTV 扫色是当前词的一种模式，倒鸭子是排版模式；新正文到 Studio 样式的编译表（提案，原型先行 2026-10-09） |
| [`bcut-daoyazi-caption-design.md`](bcut-daoyazi-caption-design.md) | 「倒鸭子」跨句动态排版字幕：`CaptionSequencePlan` 复用 `MotionProgram`、`wordAnimation.caption.seed` + `options.daoyazi`（核心与 App v2 已落地 2026-09-17） |
| [`bcut-daoyazi-caption-style.example.json`](bcut-daoyazi-caption-style.example.json) | 上一篇的示例载荷 |
| [`bcut-subtitle-style-motion-design.md`](bcut-subtitle-style-motion-design.md) | 31 套字幕/文字设计与 17 个动画原语的行为分析、BaoCut 能力差异、共享渲染迁移与验收方案（提案，尚未实施） |

面向用户的讲解页在 [`../../guide/explainers/`](../../guide/explainers/README.md)；可分发的字幕流程在 [`skills/baocut`](../../../skills/baocut/SKILL.md)。
